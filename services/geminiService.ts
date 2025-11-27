import { GoogleGenAI, Type } from "@google/genai";
import { GlossaryItem, SourceType, DocumentType, Language, PosBreakdown } from "../types";
import { cleanCorpusText } from "../utils/nlp";

// --- CONFIGURATION & CACHE ---

const API_KEY = process.env.API_KEY;

// Cache system to save API calls and speed up response
const RESPONSE_CACHE = new Map<string, string>();
const MAX_CACHE_SIZE = 100;

const addToCache = (key: string, value: string) => {
    if (RESPONSE_CACHE.size >= MAX_CACHE_SIZE) {
        const firstKey = RESPONSE_CACHE.keys().next().value;
        if (firstKey) RESPONSE_CACHE.delete(firstKey);
    }
    RESPONSE_CACHE.set(key, value);
};

// Fallback Model List (Order of preference for speed/cost)
const MODELS = [
    'gemini-2.5-flash',          // Primary: Best balance
    'gemini-2.5-flash-lite-preview', // Secondary: Faster/Cheaper
    'gemini-1.5-flash',          // Fallback: Stability
];

// Local LLM Configuration (e.g., Ollama running on localhost:11434)
const LOCAL_LLM_URL = "http://localhost:11434/api/generate";
const LOCAL_MODEL = "llama3"; // Or mistral, qwen, etc.

// --- AI PROVIDER MANAGER ---

class AIManager {
    private googleClient: GoogleGenAI | null = null;

    constructor() {
        if (API_KEY) {
            this.googleClient = new GoogleGenAI({ apiKey: API_KEY });
        }
    }

    private async callLocalLLM(prompt: string, systemInstruction?: string): Promise<string> {
        try {
            const fullPrompt = systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for local check

            const response = await fetch(LOCAL_LLM_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: LOCAL_MODEL,
                    prompt: fullPrompt,
                    stream: false
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error("Local LLM unavailable");
            const data = await response.json();
            return data.response;
        } catch (e) {
            throw new Error("Local AI failed");
        }
    }

    async generate(
        prompt: string | any, 
        config: any = {}, 
        preferJson: boolean = false
    ): Promise<{ text: string }> {
        const cacheKey = JSON.stringify({ prompt, config });
        if (RESPONSE_CACHE.has(cacheKey)) {
            console.log("⚡ Serving from Cache");
            return { text: RESPONSE_CACHE.get(cacheKey) || "" };
        }

        let lastError = null;

        // 1. Try Google Gemini Models (Cascade)
        if (this.googleClient) {
            for (const modelName of MODELS) {
                try {
                    // console.log(`Attempting with model: ${modelName}`);
                    const finalConfig = { ...config };
                    
                    // Remove unsupported configs for certain models if necessary
                    if (modelName.includes('lite') && finalConfig.thinkingConfig) {
                        delete finalConfig.thinkingConfig;
                    }

                    const response = await this.googleClient.models.generateContent({
                        model: modelName,
                        contents: prompt,
                        config: finalConfig
                    });

                    const text = response.text || "";
                    addToCache(cacheKey, text);
                    return { text };
                } catch (e: any) {
                    console.warn(`Model ${modelName} failed:`, e.message);
                    lastError = e;
                    // If it's a safety block or invalid arg, don't retry other Gemini models, might be prompt issue
                    if (e.message.includes("400") || e.message.includes("SAFETY")) break;
                    // If 429 (Quota) or 503 (Overloaded), continue loop
                }
            }
        }

        // 2. Fallback to Local LLM (Ollama/Qwen/etc) if Gemini fails or no key
        try {
            console.log("⚠️ Cloud APIs failed/exhausted. Attempting Local AI...");
            const system = config.systemInstruction;
            // Extract text from object prompt if necessary
            const textPrompt = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
            const localText = await this.callLocalLLM(textPrompt, system);
            return { text: localText };
        } catch (localErr) {
            console.warn("Local AI not available.");
        }

        // 3. Ultimate Fallback (Mock/Error)
        throw lastError || new Error("All AI providers (Cloud & Local) failed. Please check connection or API quotas.");
    }
}

const aiManager = new AIManager();

// --- EXPORTED FUNCTIONS ---

export const transcribeMedia = async (base64Data: string, mimeType: string): Promise<string> => {
  try {
      const response = await aiManager.generate({
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Data } },
          { text: "Analyze this document/image. Reconstruct its layout using semantic HTML. CRITICAL: Use HTML TABLES (`<table>`) to replicate multi-column layouts, side-by-side text, and legal captions (e.g., 'Plaintiff v. Defendant'). Preserve exact bolding, italics, and structure. Return ONLY valid HTML code." },
        ],
      });
      let text = response.text || "";
      // Strip markdown code blocks if present to ensure clean HTML
      text = text.replace(/^```html\s*/, "").replace(/^```\s*/, "").replace(/```$/, "");
      return text;
  } catch (e) {
      console.error(e);
      return "<p>[Error: Could not transcribe media. Check API Key or File format]</p>";
  }
};

export const fetchContentFromUrl = async (url: string): Promise<{ title: string, content: string }> => {
  // Try direct fetch first to save AI token
  try {
      // Note: This often fails due to CORS, but worth a try in some environments
      // If fails, we fall back to AI search tool
  } catch (e) {}

  const response = await aiManager.generate(
    `Visit URL: ${url}. Extract Title and Full Content. Format:\nTitle: ...\nContent: ...`,
    { tools: [{ googleSearch: {} }] }
  );

  let text = response.text || "";
  let titleMatch = text.match(/Title:\s*(.+)/);
  let contentMatch = text.match(/Content:\s*([\s\S]+)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : "Web Import",
    content: contentMatch ? contentMatch[1].trim() : text
  };
};

export const askCorpusQuestion = async (query: string, contextDocs: string[]): Promise<string> => {
  // Optimization: If context is massive, summarize it first or pick top chunks (RAG-lite)
  const joinedContext = contextDocs.join("\n\n---\n\n").substring(0, 30000); 

  const response = await aiManager.generate(
    `Corpus Context:\n${joinedContext}\n\nUser Question: ${query}`,
    {
      systemInstruction: `Answer based on the corpus. Language: Same as question.`,
    }
  );
  return response.text;
};

export const generateGlossary = async (contextText: string, targetLang: Language = Language.SPANISH): Promise<GlossaryItem[]> => {
  const truncatedContext = contextText.substring(0, 45000);
  const targetLangName = targetLang === Language.SPANISH ? "Spanish" : "English";

  const prompt = `Extract 20 specialized terms from the text. Return JSON array.
  Fields: term, translation (${targetLangName}), definition (source lang), targetDefinition (${targetLangName}), synonyms (array), example, referenceUrl (reliable source, NO Wikipedia).`;

  try {
      const response = await aiManager.generate(
        `Text:\n${truncatedContext}\n\n${prompt}`,
        {
          responseMimeType: "application/json",
          // Schema helps Gemini, but Local LLM might ignore it. We parse JSON manually below.
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING },
                translation: { type: Type.STRING },
                definition: { type: Type.STRING },
                targetDefinition: { type: Type.STRING },
                synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
                example: { type: Type.STRING },
                referenceUrl: { type: Type.STRING }
              }
            }
          }
        }
      );

      const jsonStr = response.text.replace(/```json|```/g, "").trim();
      return JSON.parse(jsonStr);
  } catch (e) {
      console.error("Glossary error", e);
      return [];
  }
};

export const detectTopic = async (text: string): Promise<string> => {
    const response = await aiManager.generate(`Identify topic in 3 words. Text: "${text.substring(0, 500)}"`);
    return response.text.trim();
};

export const detectLanguageAI = async (text: string): Promise<Language> => {
    const response = await aiManager.generate(`Detect language (EN/ES). Return ONLY code. Text: "${text.substring(0, 200)}"`);
    const result = response.text.trim().toUpperCase();
    return result.includes("ES") ? Language.SPANISH : Language.ENGLISH;
}

// NEW: Analyze context for professional enrichment
export const analyzeDocumentContext = async (text: string): Promise<{ topic: string, domain: string, tone: string, type: SourceType }> => {
    const prompt = `Analyze the following text. Return a JSON object with: 
    - "topic": (Specific subject, e.g. "Divorce Decree", "Photosynthesis")
    - "domain": (Broad field, e.g. "Legal", "Medical", "Academic")
    - "tone": (e.g. "Formal", "Colloquial", "Technical")
    - "suggestedSourceType": (One of: "Academic", "Manual Upload", "Social Media", "YouTube")
    
    Text: "${text.substring(0, 1000)}..."`;

    try {
        const response = await aiManager.generate(prompt, { responseMimeType: "application/json" });
        const json = JSON.parse(response.text);
        return {
            topic: json.topic || "General",
            domain: json.domain || "General",
            tone: json.tone || "Neutral",
            type: json.suggestedSourceType === "Academic" ? SourceType.ACADEMIC : SourceType.MANUAL_UPLOAD
        };
    } catch (e) {
        return { topic: "General", domain: "General", tone: "Formal", type: SourceType.MANUAL_UPLOAD };
    }
};

export const translateProfessional = async (content: string, targetLang: Language, context: string = ""): Promise<string> => {
    const langName = targetLang === Language.SPANISH ? "Spanish" : "English";
    
    // Updated instruction to strictly enforce layout preservation and use heavy corpus context
    let systemInstruction = `You are a professional legal translator for ${langName}.
    
    TASK: Translate the content while strictly preserving the HTML structure and visual layout.
    
    CONTEXT USAGE:
    You are provided with an EXTENSIVE CORPUS of parallel registers (Terminology, Case Law Excerpts, Phrasing).
    You MUST use this corpus to ensure the translation uses the correct specific register for the domain.
    Do not guess terms if they appear in the provided Glossaries.
    
    CRITICAL RULES:
    1. Do NOT flatten HTML tables. Keep side-by-side layouts (e.g., Plaintiff vs Defendant headers) exactly as tables.
    2. Maintain all formatting tags (<b>, <i>, <u>).
    3. If the input is plain text but looks like a legal document, reconstruction the layout using HTML Tables.
    4. Use professional legal terminology suitable for the domain found in the corpus.
    5. Return ONLY the valid HTML string.`;

    if (context) {
        systemInstruction += `\n\nSTYLE GUIDE & CONTEXT:\nRefer to the provided "Reference Materials" for terminology and tone.`;
    }

    // Allow larger context window for the massive corpus registers
    const contextPrompt = context ? `\n--- EXTENSIVE CORPUS REGISTERS (Terminology, Phrasing, Similar Texts) ---\n${context.substring(0, 25000)}\n--- END CORPUS ---\n` : "";

    const response = await aiManager.generate(
        `${contextPrompt}\n\nContent to Translate:\n${content}`,
        { systemInstruction }
    );
    
    let html = response.text || "";
    return html.replace(/^```html\s*/, "").replace(/^```\s*/, "").replace(/```$/, "");
};

// NEW: Second pass for Convention Analysis
export const refineTranslationConventions = async (sourceText: string, draftTranslation: string, targetLang: Language): Promise<string> => {
    const langName = targetLang === Language.SPANISH ? "Spanish" : "English";
    
    const prompt = `
    You are a Senior Editor and Localization Expert. 
    Review the "Draft Translation" against the "Source Text".
    
    CRITICAL TASK: Fix "Language Conventions" and "Register Mismatches" WITHOUT breaking the HTML Layout.
    
    SPECIFIC RULES:
    1. Legal Headers: 'PRESENTE' != 'PRESENT'. Use 'TO THE HONORABLE JUDGE' or context appropriate.
    2. False Cognates: 'Presente escrito' -> 'This document'/'This writ'.
    3. LAYOUT SAFETY: Do not remove <table>, <tr>, or <td> tags. The visual structure must remain identical to the draft.
    
    Output the FINAL polished HTML.
    
    Source Text (Context):
    ${sourceText.substring(0, 2000)}...
    
    Draft Translation:
    ${draftTranslation}
    `;

    const response = await aiManager.generate(prompt, {
        systemInstruction: `You are a strict editor for ${langName}. Preserve HTML tags.`
    });

    let html = response.text || "";
    return html.replace(/^```html\s*/, "").replace(/^```\s*/, "").replace(/```$/, "");
};

export const analyzePosDistribution = async (text: string): Promise<PosBreakdown> => {
  const truncatedText = text.substring(0, 1500); 
  try {
      const response = await aiManager.generate(
        `Analyze grammar % for: "${truncatedText}". Return JSON {nouns, verbs, adjectives, adverbs, pronouns, determiners, conjunctions, others}. Integers only.`,
        { responseMimeType: "application/json" }
      );
      return JSON.parse(response.text);
  } catch (e) {
      return { nouns: 0, verbs: 0, adjectives: 0, adverbs: 0, pronouns: 0, determiners: 0, conjunctions: 0, others: 0 };
  }
};

export const generateSyntheticCorpusData = async (topic: string, sourceType: SourceType, language: Language, focusAspect: string = "General Content"): Promise<any> => {
  const langName = language === Language.SPANISH ? "Spanish" : "English";
  
  // Enhanced prompt to generate dense registers based on 'focusAspect'
  let prompt = `Generate a ${sourceType} document about "${topic}" in ${langName}.
  FOCUS: ${focusAspect}.
  
  If Focus is 'Terminology', generate a dense list of specialized terms and definitions.
  If Focus is 'Phrasing', generate a list of standard sentences, connectors, and clauses used in this domain.
  If Focus is 'Style/Parallel Text', generate a high-quality 3-paragraph excerpt mimicking a real document of this type.
  `;

  let tools = [];
  
  if (sourceType === SourceType.SOCIAL) {
      prompt += " Authentic tweets/posts with slang.";
      tools.push({googleSearch: {}});
  } else if (sourceType === SourceType.ACADEMIC) {
      prompt += " Academic tone, abstract & intro.";
  } else if (sourceType === SourceType.MANUAL_UPLOAD) {
      prompt += " Professional/Standard document style.";
  }

  const response = await aiManager.generate(prompt, { tools: tools.length > 0 ? tools : undefined });
  
  // Basic parsing of the result
  const text = cleanCorpusText(response.text);
  let title = `${sourceType} - ${topic}`;
  
  // Try to extract a title if generated
  const titleMatch = text.match(/Title:\s*(.+)/);
  if (titleMatch) title = titleMatch[1];
  else title = `${focusAspect} - ${topic.substring(0, 20)}`;

  const posData = await analyzePosDistribution(text);

  return {
    title,
    content: text,
    sourceType,
    docType: sourceType === SourceType.YOUTUBE ? DocumentType.VIDEO : DocumentType.TEXT,
    language,
    author: "AI_Generator",
    url: "https://generated.source",
    date: new Date().toLocaleDateString(),
    posData
  };
};

export const simulateClassroomFetch = async (folderUrl: string, taskName: string): Promise<any[]> => {
    // This function mimics fetching, so we just generate 3-5 variations
    const results = [];
    for (let i = 0; i < 3; i++) {
        const doc = await generateSyntheticCorpusData(taskName, SourceType.CLASSROOM, i % 2 === 0 ? Language.ENGLISH : Language.SPANISH);
        doc.title = `Student Submission ${i+1}`;
        results.push(doc);
    }
    return results;
};
