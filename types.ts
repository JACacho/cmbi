
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
  CLASSROOM = 'Google Classroom',
  GENERATED = 'AI Generated (Augmentation)',
  SEGMENT = 'Document Segment'
}

export type SentimentLabel = 'Positive' | 'Negative' | 'Neutral';

export interface SentimentResult {
  score: number; // Range from -1.0 to 1.0
  label: SentimentLabel;
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

export interface CorpusDocument {
  id: string;
  parallelId?: string; // Tracks ID of translated counterpart
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
  posData?: PosBreakdown; // Added for automated grammar storage
  media?: string; // Base64 data URI for images/thumbnails
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
  referenceUrl?: string; // Real URL for consultation
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}
