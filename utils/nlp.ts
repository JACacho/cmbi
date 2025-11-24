
import { CorpusDocument, KwicResult, TokenFrequency, Language, SentimentResult } from '../types';

// Clean text from AI artifacts, markdown, and meta headers specifically requested
export const cleanCorpusText = (text: string): string => {
  return text
    .replace(/\*\*/g, '') // Remove bold markdown
    .replace(/#{1,6}\s/g, '') // Remove heading markers if desired
    .replace(/^(Title:|Subject:|Here is a text|Video:|Assignment:|Student:|Date:|Instruction:).+$/gim, '') // Remove meta headers lines
    .replace(/(Write a .*|Here is the .*|Please generate .*)/gi, '') // Remove common AI prompts included in text
    .replace(/\[.*?\]/g, '') // Remove placeholders like [Student Name]
    .replace(/_+/g, '') // Remove underscores lines
    .replace(/^\s*[-*]\s+/gm, '') // Remove list bullets if they are solitary clutter
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines to double
    .trim();
};

export const STOPWORDS = {
  EN: new Set(['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me']),
  ES: new Set(['de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con', 'no', 'una', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'le', 'ya', 'o', 'este', 'sí', 'porque', 'esta', 'entre', 'cuando', 'muy', 'sin', 'sobre', 'también', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde', 'todo', 'nos'])
};

// Basic tokenizer that handles English and Spanish basic punctuation
export const tokenize = (text: string, removeStopwords: boolean = false, lang: Language = Language.ENGLISH): string[] => {
  let tokens = text.toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()"\u201C\u201D\u00AB\u00BB]/g, "") // Include quotes
    .replace(/\s{2,}/g, " ")
    .split(" ")
    .filter(t => t.length > 0);

  if (removeStopwords) {
    const set = lang === Language.SPANISH ? STOPWORDS.ES : STOPWORDS.EN;
    tokens = tokens.filter(t => !set.has(t));
  }
  
  return tokens;
};

export const generateNgrams = (tokens: string[], n: number): TokenFrequency[] => {
  if (tokens.length < n) return [];
  
  const frequencyMap: Record<string, number> = {};
  
  for (let i = 0; i < tokens.length - n + 1; i++) {
    const gram = tokens.slice(i, i + n).join(" ");
    frequencyMap[gram] = (frequencyMap[gram] || 0) + 1;
  }

  const totalNgrams = tokens.length - n + 1;

  return Object.entries(frequencyMap)
    .map(([token, count]) => ({
      token,
      count,
      frequency: count / totalNgrams
    }))
    .sort((a, b) => b.count - a.count);
};

// Split text into logical segments to robustify corpus
export const splitIntoChunks = (text: string, minLength: number = 100): string[] => {
  // Split by double newline (paragraphs)
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = "";

  paragraphs.forEach(para => {
      const cleanPara = para.trim();
      if (cleanPara.length === 0) return;

      if ((currentChunk.length + cleanPara.length) < 1000) {
          currentChunk += cleanPara + "\n\n";
      } else {
          if (currentChunk.length > minLength) chunks.push(currentChunk.trim());
          currentChunk = cleanPara + "\n\n";
      }
  });

  if (currentChunk.length > minLength) chunks.push(currentChunk.trim());
  
  // If text was too short to split but is valid, return as one chunk
  if (chunks.length === 0 && text.length > 0) return [text];

  return chunks;
};

export const calculateFrequencies = (docs: CorpusDocument[], removeStopwords: boolean = false): TokenFrequency[] => {
  const frequencyMap: Record<string, number> = {};
  let totalTokens = 0;

  docs.forEach(doc => {
    const tokens = tokenize(doc.content, removeStopwords, doc.language);
    totalTokens += tokens.length;
    tokens.forEach(token => {
      frequencyMap[token] = (frequencyMap[token] || 0) + 1;
    });
  });

  return Object.entries(frequencyMap)
    .map(([token, count]) => ({
      token,
      count,
      frequency: totalTokens > 0 ? count / totalTokens : 0
    }))
    .sort((a, b) => b.count - a.count);
};

export const generateKwic = (docs: CorpusDocument[], keyword: string, windowSize: number = 60): KwicResult[] => {
  const results: KwicResult[] = [];
  const normalizedKeyword = keyword.toLowerCase();

  docs.forEach(doc => {
    const text = doc.content;
    const lowerText = text.toLowerCase();
    let startIndex = 0;
    let index = lowerText.indexOf(normalizedKeyword, startIndex);

    while (index !== -1) {
      const charBefore = index > 0 ? lowerText[index - 1] : ' ';
      const charAfter = index + keyword.length < lowerText.length ? lowerText[index + keyword.length] : ' ';
      
      const isWordStart = /[\s\.,;:¡!¿?(\["']/.test(charBefore);
      const isWordEnd = /[\s\.,;:¡!¿?)\].'"]/.test(charAfter);

      if (isWordStart && isWordEnd) {
          const start = Math.max(0, index - windowSize);
          const end = Math.min(text.length, index + keyword.length + windowSize);

          results.push({
            left: text.substring(start, index),
            node: text.substring(index, index + keyword.length),
            right: text.substring(index + keyword.length, end),
            docId: doc.title
          });
      }

      startIndex = index + keyword.length;
      index = lowerText.indexOf(normalizedKeyword, startIndex);
    }
  });

  return results;
};

export const calculateTypeTokenRatio = (docs: CorpusDocument[]): number => {
    let allTokens: string[] = [];
    docs.forEach(d => {
        allTokens = [...allTokens, ...tokenize(d.content)];
    });
    if (allTokens.length === 0) return 0;
    const uniqueTypes = new Set(allTokens);
    return uniqueTypes.size / allTokens.length;
};

// --- Sentiment Analysis Logic ---

const LEXICON = {
  en: {
    pos: ['good', 'great', 'excellent', 'amazing', 'wonderful', 'happy', 'joy', 'love', 'best', 'beautiful', 'success', 'win', 'positive', 'perfect', 'better', 'fun', 'enjoy', 'glad', 'cool', 'nice', 'brilliant'],
    neg: ['bad', 'terrible', 'awful', 'worst', 'hate', 'sad', 'angry', 'fail', 'negative', 'wrong', 'pain', 'ugly', 'boring', 'poor', 'broken', 'error', 'stupid', 'disaster', 'fear', 'hard', 'difficult']
  },
  es: {
    pos: ['bueno', 'bien', 'excelente', 'increíble', 'maravilloso', 'feliz', 'alegría', 'amor', 'mejor', 'hermoso', 'éxito', 'ganar', 'positivo', 'perfecto', 'divertido', 'disfrutar', 'contento', 'genial', 'agradable', 'bonito', 'brillante'],
    neg: ['mal', 'malo', 'terrible', 'peor', 'odio', 'triste', 'enojado', 'fallar', 'negativo', 'error', 'dolor', 'feo', 'aburrido', 'pobre', 'roto', 'estúpido', 'desastre', 'miedo', 'difícil', 'duro', 'horrible']
  }
};

export const analyzeSentiment = (text: string, lang: Language): SentimentResult => {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { score: 0, label: 'Neutral' };

  let score = 0;
  const targetLang = lang === Language.SPANISH ? 'es' : 'en';
  const lexicon = LEXICON[targetLang];

  tokens.forEach(token => {
    if (lexicon.pos.includes(token)) score += 1;
    if (lexicon.neg.includes(token)) score -= 1;
  });

  const relevantTokens = tokens.filter(t => lexicon.pos.includes(t) || lexicon.neg.includes(t)).length;
  const normalizedScore = relevantTokens > 0 ? score / relevantTokens : 0;

  let label: SentimentResult['label'] = 'Neutral';
  if (normalizedScore > 0.1) label = 'Positive';
  else if (normalizedScore < -0.1) label = 'Negative';

  return {
    score: parseFloat(normalizedScore.toFixed(2)),
    label
  };
};
