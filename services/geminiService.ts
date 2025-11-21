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
          text: "Extract the text from this file. If it is audio/video, transcribe it. If it is an image/PDF, perform OCR. Provide ONLY the text content. Maintain the original layout if possible.",
        },
      ],
    },
  });

  return cleanCorpusText(response.text || "");
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

export const generateGlossary = async (contextText: string): Promise<GlossaryItem[]> => {
  const ai = getAIClient();
  
  // Limit context to prevent token overflow and model confusion
  const truncatedContext = contextText.substring(0, 25000);

  const prompt = `Analyze the following text and extract 15-20 key distinct specialized terms. 
  For each term, provide a JSON object.
  CRITICAL: Keep "definition" and "example" CONCISE (max 30 words each) to ensure the JSON fits in the response limit.
  Do not repeat terms.
  
  Return ONLY a JSON array.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Text:\n${truncatedContext}\n\n${prompt}`,
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
            example: { type: Type.STRING }
          }
        }
      }
    }
  });

  let jsonString = response.text || "[]";
  
  // Cleanup Markdown if present
  if (jsonString.startsWith("```json")) {
      jsonString = jsonString.replace(/^```json\s*/, "").replace(/```$/, "");
  } else if (jsonString.startsWith("```")) {
      jsonString = jsonString.replace(/^```\s*/, "").replace(/```$/, "");
  }

  try {
    return JSON.parse(jsonString);
  } catch (e) {
    console.error("Failed to parse glossary JSON", e);
    // Attempt to salvage valid JSON array if truncated
    try {
        const lastEndObject = jsonString.lastIndexOf("}");
        if (lastEndObject !== -1) {
            const salvaged = jsonString.substring(0, lastEndObject + 1) + "]";
            return JSON.parse(salvaged);
        }
    } catch (e2) {
        console.error("JSON salvage failed", e2);
    }
    return [];
  }
};

// --- Professional Translator Service ---

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

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: `You are a professional senior translator and editor. 
            Translate the provided text into ${langName}. 
            CRITICAL: 
            1. Maintain the exact original layout, markdown formatting, bullet points, and paragraph structure.
            2. Maintain the original register, tone, and style.
            3. Ensure the translation is natural and culturally appropriate.
            4. Output ONLY the translated text, no preamble.`
        },
        contents: content
    });

    return response.text || "";
};

// --- Corpus Builder Service ---

interface SyntheticDoc {
  title: string;
  content: string;
  sourceType: SourceType;
  docType: DocumentType;
  language: Language;
  author: string;
  url: string;
}

export const generateSyntheticCorpusData = async (
  topic: string,
  sourceType: SourceType,
  language: Language
): Promise<SyntheticDoc> => {
  const ai = getAIClient();

  let systemInstruction = "";
  let prompt = "";

  const langName = language === Language.SPANISH ? "Spanish" : "English";

  switch (sourceType) {
    case SourceType.ACADEMIC:
      systemInstruction = "You are a specialized academic search engine retrieval system.";
      prompt = `Generate a detailed, realistic EXCERPT from an Academic Paper or Journal Article about "${topic}" in ${langName}.
      Include a realistic Title, Date (recent), and content that uses formal, academic register. 
      The content should be around 300-500 words.`;
      break;
    case SourceType.YOUTUBE:
      systemInstruction = "You are a YouTube transcription bot.";
      prompt = `Generate a realistic TRANSCRIPT of an educational YouTube video about "${topic}" in ${langName}.
      Title: [Video Title].
      Style: Oral, spontaneous, slightly informal but educational. Include time stamps.`;
      break;
    case SourceType.SOCIAL:
      systemInstruction = "You are a social media scraper.";
      prompt = `Generate a realistic Reddit Thread or detailed Forum Discussion about "${topic}" in ${langName}.
      Style: Informal, internet slang, opinions, debates.`;
      break;
    default:
      prompt = `Write a text about ${topic} in ${langName}.`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    config: { systemInstruction },
    contents: prompt
  });

  const text = cleanCorpusText(response.text || "");
  
  const titleMatch = text.match(/^(Title:|Subject:|Video:)?\s*(.+)$/m);
  const title = titleMatch ? titleMatch[2].trim() : `${sourceType} - ${topic}`;

  // Generate fake metadata for realism
  const author = sourceType === SourceType.ACADEMIC ? "Dr. A. Scholar" : (sourceType === SourceType.YOUTUBE ? "EduChannel" : "User123");
  const url = sourceType === SourceType.ACADEMIC ? "https://scholar.google.com/article?id=123" : "https://youtube.com/watch?v=xyz";

  return {
    title: title.substring(0, 50),
    content: text,
    sourceType,
    docType: sourceType === SourceType.ACADEMIC ? DocumentType.TEXT : (sourceType === SourceType.YOUTUBE ? DocumentType.VIDEO : DocumentType.TEXT),
    language,
    author,
    url
  };
};

// --- Classroom Simulator ---

export const simulateClassroomFetch = async (folderUrl: string, taskName: string): Promise<SyntheticDoc[]> => {
    const ai = getAIClient();
    const count = 20; // Enforced 20
    const results: SyntheticDoc[] = [];
    
    const topics = ['Arte Culinario (Culinary Arts)', 'Curaduría y Museografía (Museography)', 'Diseño Textil y Modas (Fashion)'];

    for (let i = 0; i < count; i++) {
        const specificTopic = topics[i % topics.length];
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Write a student essay (approx 200 words) for the task: "${taskName}". 
            Sub-topic: ${specificTopic}.
            Simulated Source: "${folderUrl}".
            Language: Spanish or English (randomly).
            Include typical student grammar errors.
            Do NOT include meta headers like 'Title:'. Just start the essay text.
            Make it sound authentic.`
        });
        
        const text = cleanCorpusText(response.text || "");
        const firstLine = text.split('\n')[0];
        const title = firstLine.length < 50 ? firstLine : `Assignment ${i+1} - ${specificTopic}`;
        
        results.push({
            title: title,
            content: text,
            sourceType: SourceType.CLASSROOM,
            docType: DocumentType.TEXT,
            language: i % 2 === 0 ? Language.ENGLISH : Language.SPANISH,
            author: `Student ${i+1}`,
            url: folderUrl
        });
    }
    return results;
};

// --- Grammatical Analysis ---

export const analyzePosDistribution = async (text: string): Promise<PosBreakdown> => {
  const ai = getAIClient();
  const truncatedText = text.substring(0, 20000); 

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Analyze the grammatical categories in this text. Return a JSON object with the approximate percentage (0-100, integer) of:
    nouns, verbs, adjectives, adverbs, pronouns, determiners, conjunctions, others.
    
    Text Sample: "${truncatedText}"`,
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
