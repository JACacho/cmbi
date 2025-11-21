import { CorpusDocument, KwicResult, TokenFrequency, Language, SentimentResult } from '../types';

// Clean text from AI artifacts, markdown, and meta headers specifically requested
export const cleanCorpusText = (text: string): string => {
  return text
    .replace(/\*\*/g, '') // Remove bold markdown
    .replace(/#{1,6}\s/g, '') // Remove heading markers if desired, or keep them for structure. User asked to remove 'Title:'.
    .replace(/^(Title:|Subject:|Here is a text|Video:|Assignment:|Student:|Date:|Instruction:).+$/gim, '') // Remove meta headers lines
    .replace(/(Write a .*|Here is the .*|Please generate .*)/gi, '') // Remove common AI prompts included in text
    .replace(/\[.*?\]/g, '') // Remove placeholders like [Student Name]
    .replace(/_+/g, '') // Remove underscores lines
    .replace(/^\s*[-*]\s+/gm, '') // Remove list bullets if they are solitary clutter
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines to double
    .trim();
};

// Basic tokenizer that handles English and Spanish basic punctuation
export const tokenize = (text: string): string[] => {
  return text.toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()"\u201C\u201D\u00AB\u00BB]/g, "") // Include quotes
    .replace(/\s{2,}/g, " ")
    .split(" ")
    .filter(t => t.length > 0);
};

export const calculateFrequencies = (docs: CorpusDocument[]): TokenFrequency[] => {
  const frequencyMap: Record<string, number> = {};
  let totalTokens = 0;

  docs.forEach(doc => {
    const tokens = tokenize(doc.content);
    totalTokens += tokens.length;
    tokens.forEach(token => {
      frequencyMap[token] = (frequencyMap[token] || 0) + 1;
    });
  });

  return Object.entries(frequencyMap)
    .map(([token, count]) => ({
      token,
      count,
      frequency: count / totalTokens
    }))
    .sort((a, b) => b.count - a.count);
};

export const generateKwic = (docs: CorpusDocument[], keyword: string, windowSize: number = 60): KwicResult[] => {
  const results: KwicResult[] = [];
  const normalizedKeyword = keyword.toLowerCase();

  docs.forEach(doc => {
    const text = doc.content;
    // Simple token-based check to avoid partial word matches usually requires regex, 
    // but substring search is faster for real-time. We will add spaces for boundary check.
    const lowerText = text.toLowerCase();
    let startIndex = 0;
    let index = lowerText.indexOf(normalizedKeyword, startIndex);

    while (index !== -1) {
      // Basic word boundary check (start or space before, end or space/punct after)
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