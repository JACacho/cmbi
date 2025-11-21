import React, { useState, useRef } from 'react';
import { Languages, ArrowRight, FileText, Upload, RefreshCw, Sparkles, FilePlus } from 'lucide-react';
import { CorpusDocument, DocumentType, Language, SourceType } from '../types';
import { translateProfessional, transcribeMedia, detectTopic, generateSyntheticCorpusData } from '../services/geminiService';
import { translations } from '../utils/translations';
import { analyzeSentiment, tokenize } from '../utils/nlp';

interface TranslatorViewProps {
  uiLang: 'EN' | 'ES';
  onDocsGenerated?: (docs: CorpusDocument[]) => void;
}

const TranslatorView: React.FC<TranslatorViewProps> = ({ uiLang, onDocsGenerated }) => {
  const t = translations[uiLang];
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [targetLang, setTargetLang] = useState<Language>(Language.SPANISH);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTranslate = async () => {
    if (!sourceText.trim()) return;
    setIsProcessing(true);
    setStatus(t.translating);

    try {
        // 1. Analyze Topic
        if (sourceText.length > 100 && onDocsGenerated) {
             setStatus("Analyzing topic & context...");
             const topic = await detectTopic(sourceText);
             
             setStatus(`Building corpus context for: "${topic}"...`);
             // 2. Generate Synthetic Corpus Docs to Enrich Context
             const newDocs: CorpusDocument[] = [];
             // Generate 3 quick docs
             for (let i = 0; i < 3; i++) {
                const srcType = i === 0 ? SourceType.ACADEMIC : SourceType.SOCIAL;
                const docData = await generateSyntheticCorpusData(topic, srcType, targetLang);
                newDocs.push({
                    id: `trans-auto-${Date.now()}-${i}`,
                    title: docData.title,
                    content: docData.content,
                    language: targetLang,
                    type: DocumentType.TEXT,
                    sourceType: srcType,
                    tokenCount: tokenize(docData.content).length,
                    uploadDate: new Date().toLocaleDateString(),
                    sentiment: analyzeSentiment(docData.content, targetLang)
                });
             }
             onDocsGenerated(newDocs);
        }

        // 3. Translate with High Fidelity Layout
        setStatus(t.translating);
        const result = await translateProfessional(sourceText, targetLang);
        setTranslatedText(result);
    } catch (error) {
        console.error(error);
        setTranslatedText("Error during translation process.");
    } finally {
        setIsProcessing(false);
        setStatus('');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsProcessing(true);
    setStatus("Reading file...");
    try {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64 = (reader.result as string).split(',')[1];
            setStatus("Extracting text & layout...");
            const extracted = await transcribeMedia(base64, file.type);
            setSourceText(extracted);
            setIsProcessing(false);
            setStatus('');
        };
    } catch (err) {
        console.error(err);
        setIsProcessing(false);
        setStatus("Error reading file");
    }
  };

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Source Column */}
        <div className="flex flex-col space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center">
                <h3 className="font-semibold text-slate-800">{t.sourceContent}</h3>
                <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer text-sm transition-colors">
                    <Upload className="w-4 h-4 text-slate-600" />
                    <span>{t.uploadForTrans}</span>
                    <input 
                        ref={fileInputRef} 
                        type="file" 
                        className="hidden"
                        accept=".txt,.pdf,.docx,.jpg,.png,.jpeg" 
                        onChange={handleFileUpload}
                    />
                </label>
            </div>
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col">
                <textarea
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    placeholder="Paste text or upload document..."
                    className="flex-1 w-full resize-none focus:outline-none text-slate-700 leading-relaxed font-mono text-sm"
                />
                <div className="mt-2 text-xs text-slate-400 flex justify-between">
                    <span>{sourceText.length} chars</span>
                    <span>{t.detected}</span>
                </div>
            </div>
        </div>

        {/* Controls (Mobile) / Center Arrow */}
        <div className="lg:hidden flex justify-center">
            <ArrowRight className="w-6 h-6 text-slate-400 rotate-90" />
        </div>

        {/* Target Column */}
        <div className="flex flex-col space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-3">
                <h3 className="font-semibold text-slate-800">{t.targetContent}</h3>
                
                {/* Processing Status Indicator */}
                {isProcessing && (
                   <div className="flex items-center gap-2 text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full animate-pulse">
                      <Sparkles className="w-3 h-3" /> {status}
                   </div>
                )}

                <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-500">{t.translateTo}</span>
                    <select 
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value as Language)}
                        className="bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value={Language.SPANISH}>Español</option>
                        <option value={Language.ENGLISH}>English</option>
                    </select>
                    <button 
                        onClick={handleTranslate}
                        disabled={isProcessing || !sourceText}
                        className="ml-2 bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1 shadow-sm"
                    >
                        {isProcessing ? <RefreshCw className="w-3 h-3 animate-spin"/> : <Languages className="w-3 h-3" />}
                        {t.translateBtn}
                    </button>
                </div>
            </div>
            <div className="flex-1 bg-indigo-50/30 rounded-xl border border-indigo-100 shadow-sm p-4 overflow-y-auto relative">
                {isProcessing ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-indigo-400 bg-white/50 backdrop-blur-sm z-10">
                        <RefreshCw className="w-8 h-8 animate-spin mb-2" />
                        <p className="text-sm font-medium">{status}</p>
                    </div>
                ) : null}
                
                <div className="prose prose-sm max-w-none text-slate-800 leading-relaxed whitespace-pre-wrap">
                        {translatedText || <span className="text-slate-400 italic opacity-50">Translation will appear here maintaining original layout...</span>}
                </div>
            </div>
        </div>
    </div>
  );
};

export default TranslatorView;