
export enum Language {
  ENGLISH = 'EN',
  SPANISH = 'ES',
  UNKNOWN = 'UNK'
}

export enum DocumentType {
  TEXT = 'TEXT',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  IMAGE = 'IMAGE'
}

export enum SourceType {
  MANUAL_UPLOAD = 'Manual Upload',
  ACADEMIC = 'Google Scholar/Academic',
  YOUTUBE = 'YouTube Transcript',
  SOCIAL = 'Social Media/Forum',
  CLASSROOM = 'Google Classroom'
}

export type SentimentLabel = 'Positive' | 'Negative' | 'Neutral';

export interface SentimentResult {
  score: number; // Range from -1.0 to 1.0
  label: SentimentLabel;
}

export interface CorpusDocument {
  id: string;
  title: string;
  content: string; // The raw text or transcribed text
  language: Language;
  type: DocumentType;
  sourceType: SourceType;
  tokenCount: number;
  originalFileName?: string;
  uploadDate: string;
  author?: string;
  sourceUrl?: string;
  sentiment?: SentimentResult;
}

export interface KwicResult {
  left: string;
  node: string;
  right: string;
  docId: string;
}

export interface TokenFrequency {
  token: string;
  count: number;
  frequency: number;
}

export interface GlossaryItem {
  term: string;
  translation: string;
  definition: string; // Definition in source language
  targetDefinition: string; // Definition in target language (for translation purposes)
  synonyms: string[];
  example: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export interface PosBreakdown {
  nouns: number;
  verbs: number;
  adjectives: number;
  adverbs: number;
  pronouns: number;
  determiners: number; // Articles included
  conjunctions: number;
  others: number;
}
