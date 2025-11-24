import { GoogleGenAI, Type } from "@google/genai";
import { GlossaryItem, SourceType, DocumentType, Language, PosBreakdown } from "../types";
import { cleanCorpusText } from "../utils/nlp";

const getAIClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found in environment");
  return new GoogleGenAI({ apiKey });
};

export const transcribeMedia = async (base64Data: string, mimeType: string): Promise<string> => {
  const ai = getAIClient();
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Data,
          },
        },
        {
          text: "Analyze this document/image. Extract ALL text content. Preserve the visual structure in the text output by using headers, lists, and spacing. If it is a poster or infographic, describe the layout briefly then list all text.",
        },
      ],
    },
  });

  return response.text || ""; 
};

export const fetchContentFromUrl = async (url: string): Promise<{ title: string, content: string }> => {
  const ai = getAIClient();

  // 1. Initial Attempt: Direct Visit
  let response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Please visit the following URL: ${url}. 
    
    Instructions:
    1. Extract the MAIN Title of the page.
    2. Extract the FULL text content. Do NOT summarize. Get every paragraph, header, and list item.
    3. If it is a long article or paper, retrieve the entire body.
    4. Ignore navigation bars, footer copyrights, and advertisements.
    5. Return the result in this specific format:
    
    Title: [The Title]
    Content: [The Full Content HTML-like structure or Markdown]`,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  let text = response.text || "";
  
  let titleMatch = text.match(/Title:\s*(.+)/);
  let contentMatch = text.match(/Content:\s*([\s\S]+)/);

  let title = titleMatch ? titleMatch[1].trim() : "Web Page Import";
  let content = contentMatch ? contentMatch[1].trim() : text.replace(/Title:.*\n/, '');

  // 2. Quality Check
  // Detect if the fetch was blocked (e.g., CAPTCHA, Paywall, Short Error Message)
  const isPoorQuality = content.length < 500 || 
                        /access denied|robot check|captcha|please verify|enable javascript|403 forbidden|404 not found/i.test(content);

  if (isPoorQuality) {
      // 3. Fallback: Academic/Reliable Source Search
      // If direct access fails, try to find the content via academic repositories using the URL as a key reference.
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `The direct access to the URL (${url}) failed or was restricted.
        
        Task:
        1. Identify the likely Academic Paper, Article, or Topic associated with this URL.
        2. Search for this specific content on reliable academic repositories (e.g., arXiv, Springer, IEEE, PubMed, ResearchGate, Semantic Scholar).
        3. Retrieve the full abstract and as much of the body text as possible from these accessible sources.
        
        Return the result in this format:
        Title: [Correct Academic Title]
        Content: [The retrieved content/abstract/summary from academic sources]`,
        config: {
            tools: [{ googleSearch: {} }],
        }
      });

      const fbText = fallbackResponse.text || "";
      const fbTitleMatch = fbText.match(/Title:\s*(.+)/);
      const fbContentMatch = fbText.match(/Content:\s*([\s\S]+)/);

      // Only swap if fallback found substantial content
      if (fbContentMatch && fbContentMatch[1].trim().length > content.length) {
          title = fbTitleMatch ? fbTitleMatch[1].trim() : title;
          content = fbContentMatch[1].trim();
      }
  }

  return {
    title,
    content: content 
  };
};

export const askCorpusQuestion = async (
  query: string, 
  contextDocs: string[]
): Promise<string> => {
  const ai = getAIClient();
  
  const joinedContext = contextDocs.join("\n\n---\n\n").substring(0, 30000); 

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: `You are an expert linguistic analyst assistant for the CMBI project. 
      You have access to a corpus of text provided in the context. 
      Answer the user's question based STRICTLY on the information, patterns, and examples found in the provided corpus.
      If the information is not in the corpus, state that.
      Cite specific documents or examples from the text where possible.
      IMPORTANT: Answer in the same language as the User's Question (English or Spanish).`,
    },
    contents: `Corpus Context:\n${joinedContext}\n\nUser Question: ${query}`,
  });

  return response.text || "I could not generate a response.";
};

export const generateGlossary = async (contextText: string, targetLang: Language = Language.SPANISH): Promise<GlossaryItem[]> => {
  const ai = getAIClient();
  
  // Use Flash for speed, prioritize quantity and format
  const truncatedContext = contextText.substring(0, 40000);
  const targetLangName = targetLang === Language.SPANISH ? "Spanish" : "English";

  const prompt = `Task: Create a specialized bilingual glossary from the text provided.
  
  CRITICAL INSTRUCTIONS:
  1. Detect the dominant language of the source text.
  2. Extract AT LEAST 15 specialized, technical, or academic terms found in the text.
  3. If the source text is Spanish, the 'term' MUST be in Spanish. If English, 'term' is English.
  4. 'translation' must be in ${targetLangName}.
  5. 'definition' must be in the SOURCE language.
  6. 'targetDefinition' must be in ${targetLangName}.
  7. Provide 2-3 synonyms in ${targetLangName}.
  8. Provide a real URL for reference.
  
  If the text is short, extract as many distinct nouns/verbs as possible to fill the list.
  
  Return a valid JSON array.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Text Context:\n${truncatedContext}\n\n${prompt}`,
    config: {
      responseMimeType: "application/json",
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
  });

  try {
    const jsonStr = response.text || "[]";
    const result = JSON.parse(jsonStr);
    
    if (Array.isArray(result)) {
        return result.map((item: any) => ({
            term: item.term || "Unknown",
            translation: item.translation || "",
            definition: item.definition || "",
            targetDefinition: item.targetDefinition || "",
            synonyms: Array.isArray(item.synonyms) ? item.synonyms : [],
            example: item.example || "",
            referenceUrl: item.referenceUrl || ""
        }));
    }
    return [];
  } catch (e) {
    console.error("Glossary JSON error", e);
    return [];
  }
};

// --- Professional Translator & Layout Engine Service ---

export const detectTopic = async (text: string): Promise<string> => {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Identify the main topic/theme of this text in 2-5 words. Return ONLY the topic name. Text: "${text.substring(0, 1000)}"`
    });
    return response.text?.trim() || "General";
};

export const translateProfessional = async (
    content: string, 
    targetLang: Language
): Promise<string> => {
    const ai = getAIClient();
    const langName = targetLang === Language.SPANISH ? "Spanish" : "English";

    const systemInstruction = `You are a high-fidelity "Parallel Transfer" Localization Engine. 
    Your task is to translate the text content of the provided HTML document into ${langName} while preserving the DOM structure with bit-perfect accuracy.

    CRITICAL STRUCTURAL RULES:
    1. **Immutable Structure**: Do NOT add, remove, or reorder ANY HTML tags.
    2. **Immutable Attributes**: Do NOT touch classes, IDs, or styles.
    3. **Content Only**: Only translate the *visible text nodes*.
    
    Output ONLY the valid HTML string.`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', // Switched to Flash for speed as requested
        config: { systemInstruction },
        contents: content
    });

    let html = response.text || "";
    html = html.replace(/^```html\s*/, "").replace(/^```\s*/, "").replace(/```$/, "");
    return html;
};

// --- Corpus Builder Service ---

export interface SyntheticDoc {
  title: string;
  content: string;
  sourceType: SourceType;
  docType: DocumentType;
  language: Language;
  author: string;
  url: string;
  date: string;
  posData?: PosBreakdown; // Included directly
}

export const analyzePosDistribution = async (text: string): Promise<PosBreakdown> => {
  const ai = getAIClient();
  // Optimized: Smaller chunk for faster POS tagging
  const truncatedText = text.substring(0, 5000); 

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Analyze grammatical categories. Return JSON integers (percentage 0-100) for: nouns, verbs, adjectives, adverbs, pronouns, determiners, conjunctions, others. Text: "${truncatedText}"`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          nouns: { type: Type.NUMBER },
          verbs: { type: Type.NUMBER },
          adjectives: { type: Type.NUMBER },
          adverbs: { type: Type.NUMBER },
          pronouns: { type: Type.NUMBER },
          determiners: { type: Type.NUMBER },
          conjunctions: { type: Type.NUMBER },
          others: { type: Type.NUMBER }
        }
      }
    }
  });

  try {
    return JSON.parse(response.text || "{}") as PosBreakdown;
  } catch (e) {
    return { nouns: 0, verbs: 0, adjectives: 0, adverbs: 0, pronouns: 0, determiners: 0, conjunctions: 0, others: 0 };
  }
};

export const generateSyntheticCorpusData = async (
  topic: string,
  sourceType: SourceType,
  language: Language
): Promise<SyntheticDoc> => {
  const ai = getAIClient();

  let systemInstruction = "";
  let prompt = "";
  let tools: any[] = [];
  
  const langName = language === Language.SPANISH ? "Spanish" : "English";

  if (sourceType === SourceType.SOCIAL) {
      systemInstruction = "You are a social media archivist. Capture REAL-TIME usage, slang, and sentiment.";
      prompt = `Generate a collection of 5-10 realistic social media posts (Tweets, Reddit threads, FB comments) about "${topic}" in ${langName}.
      
      Instructions:
      1. Search for CURRENT sentiment/news on this topic using Google Search.
      2. If search returns results, use them to create authentic posts with dates/handles.
      3. If search fails, SYNTHESIZE highly realistic tweets/posts mimicking today's style (short, emojis, hashtags).
      4. DO NOT FAIL. Always return text formatted as social media posts.
      5. Include a mix of platforms (X, Instagram captions, Telegram messages).`;
      
      tools = [{googleSearch: {}}];
  } else if (sourceType === SourceType.YOUTUBE) {
      systemInstruction = "You are a YouTube transcription bot.";
      prompt = `Generate a TRANSCRIPT of a video about "${topic}" in ${langName}. Include timestamps. Style: Spoken, informal/educational.`;
  } else {
      systemInstruction = "You are an academic retrieval system.";
      prompt = `Generate an Academic Paper excerpt about "${topic}" in ${langName}. Formal register. Include Abstract and Introduction.`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    config: { 
        systemInstruction,
        tools: tools.length > 0 ? tools : undefined
    },
    contents: prompt
  });

  const text = cleanCorpusText(response.text || "");
  const titleMatch = text.match(/^(Title:|Subject:|Video:)?\s*(.+)$/m);
  const title = titleMatch ? titleMatch[2].trim().substring(0, 50) : `${sourceType} - ${topic}`;
  
  // OPTIMIZATION: Calculate Grammar concurrently with generation return
  // We do it here so the doc arrives "fully baked"
  const posData = await analyzePosDistribution(text);

  return {
    title,
    content: text,
    sourceType,
    docType: sourceType === SourceType.YOUTUBE ? DocumentType.VIDEO : DocumentType.TEXT,
    language,
    author: sourceType === SourceType.ACADEMIC ? "Dr. AI Scholar" : "Netizen_User",
    url: "https://generated.source",
    date: new Date().toLocaleDateString(),
    posData
  };
};

export const simulateClassroomFetch = async (folderUrl: string, taskName: string): Promise<SyntheticDoc[]> => {
    const ai = getAIClient();
    const count = 5; 
    const results: SyntheticDoc[] = [];
    
    for (let i = 0; i < count; i++) {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Write a short student essay (150 words) for task: "${taskName}". Language: Spanish or English. Authentically imperfect.`
        });
        
        const text = cleanCorpusText(response.text || "");
        results.push({
            title: `Student Work ${i+1}`,
            content: text,
            sourceType: SourceType.CLASSROOM,
            docType: DocumentType.TEXT,
            language: i % 2 === 0 ? Language.ENGLISH : Language.SPANISH,
            author: `Student ${i+1}`,
            url: folderUrl,
            date: new Date().toLocaleDateString(),
            posData: await analyzePosDistribution(text)
        });
    }
    return results;
};