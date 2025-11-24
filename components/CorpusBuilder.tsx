import React, { useState, useEffect, useRef } from 'react';
import { Bot, Play, StopCircle, Database, Globe, BookOpen, Youtube, MessageCircle, Share2 } from 'lucide-react';
import { SourceType, Language, DocumentType, CorpusDocument } from '../types';
import { generateSyntheticCorpusData } from '../services/geminiService';
import { analyzeSentiment, tokenize } from '../utils/nlp';
import { translations } from '../utils/translations';

interface CorpusBuilderProps {
  onDocsGenerated: (docs: CorpusDocument[]) => void;
  uiLang: 'EN' | 'ES';
}

export const CorpusBuilder: React.FC<CorpusBuilderProps> = ({ onDocsGenerated, uiLang }) => {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [isBuilding, setIsBuilding] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [selectedLangs, setSelectedLangs] = useState<Language[]>([Language.ENGLISH, Language.SPANISH]);
  const [selectedSources, setSelectedSources] = useState<SourceType[]>([SourceType.ACADEMIC, SourceType.YOUTUBE, SourceType.SOCIAL]);
  
  const stopRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const t = translations[uiLang];

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleLangToggle = (lang: Language) => {
    setSelectedLangs(prev => 
      prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang]
    );
  };

  const handleSourceToggle = (source: SourceType) => {
    setSelectedSources(prev => 
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    );
  };

  const startBuild = async () => {
    if (!topic.trim()) return;
    if (selectedLangs.length === 0) {
      alert("Please select at least one language.");
      return;
    }
    if (selectedSources.length === 0) {
      alert(uiLang === 'EN' ? "Please select at least one source type." : "Selecciona al menos una fuente.");
      return;
    }

    setIsBuilding(true);
    stopRef.current = false;
    setLogs(['Initializing CMBI Collection Agent...', `Target Topic: "${topic}"`, `Target Count: ${count} documents`]);
    setProgress(0);

    const newDocs: CorpusDocument[] = [];

    try {
      for (let i = 0; i < count; i++) {
        if (stopRef.current) {
          addLog("Process stopped by user.");
          break;
        }

        // Logic to ensure rotation of selected sources
        const currentSource = selectedSources[i % selectedSources.length];
        const currentLang = selectedLangs[i % selectedLangs.length];
        
        addLog(`[${i + 1}/${count}] Fetching ${currentSource} (${currentLang})...`);

        await new Promise(r => setTimeout(r, 600)); // Slight delay

        try {
            const data = await generateSyntheticCorpusData(topic, currentSource, currentLang);
            
            const sentiment = analyzeSentiment(data.content, currentLang);
            const doc: CorpusDocument = {
                id: `auto-${Date.now()}-${i}`,
                title: data.title,
                content: data.content,
                language: currentLang,
                type: data.docType,
                sourceType: currentSource,
                tokenCount: tokenize(data.content).length,
                uploadDate: data.date, 
                sentiment: sentiment,
                sourceUrl: data.url,
                author: data.author,
                posData: data.posData // NOW INCLUDED
            };

            newDocs.push(doc);
            onDocsGenerated([doc]); 
            addLog(`✓ Successfully retrieved: "${doc.title.substring(0, 30)}..."`);

        } catch (error) {
            console.error(error);
            addLog(`✗ Error fetching document ${i+1}. Retrying...`);
        }

        setProgress(((i + 1) / count) * 100);
      }
      addLog("Collection complete. Post-processing starting automatically in background...");
    } catch (e) {
      addLog("Critical Error in collection agent.");
    } finally {
      setIsBuilding(false);
    }
  };

  const stopBuild = () => {
    stopRef.current = true;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* Control Panel */}
      <div className="lg:col-span-1 space-y-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
             <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                <Bot className="w-6 h-6" />
             </div>
             <div>
                <h3 className="font-bold text-slate-800">{t.agentTitle}</h3>
                <p className="text-xs text-slate-500">{t.agentDesc}</p>
             </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t.topicLabel}</label>
              <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={isBuilding} placeholder={t.topicPlaceholder} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>

            <div>
               <label className="block text-sm font-medium text-slate-700 mb-1">{t.sizeLabel}: {count} docs</label>
               <input type="range" min="3" max="100" value={count} onChange={(e) => setCount(parseInt(e.target.value))} disabled={isBuilding} className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
               <div className="flex justify-between text-xs text-slate-400 mt-1"><span>3</span><span>50</span><span>100</span></div>
            </div>

            <div>
               <label className="block text-sm font-medium text-slate-700 mb-2">{t.langLabel}</label>
               <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedLangs.includes(Language.ENGLISH)} onChange={() => handleLangToggle(Language.ENGLISH)} disabled={isBuilding} className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500" />
                    <span className="text-sm text-slate-600">English</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedLangs.includes(Language.SPANISH)} onChange={() => handleLangToggle(Language.SPANISH)} disabled={isBuilding} className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500" />
                    <span className="text-sm text-slate-600">Español</span>
                  </label>
               </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">{t.sourcesLabel}</label>
                <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer bg-slate-50 p-2 rounded border border-slate-100 hover:bg-slate-100 transition-colors">
                        <input type="checkbox" checked={selectedSources.includes(SourceType.ACADEMIC)} onChange={() => handleSourceToggle(SourceType.ACADEMIC)} disabled={isBuilding} className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500" />
                        <div className="flex items-center gap-2 text-sm text-slate-700"><BookOpen className="w-4 h-4 text-emerald-600" /> <span>Academic / Scholar</span></div>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer bg-slate-50 p-2 rounded border border-slate-100 hover:bg-slate-100 transition-colors">
                        <input type="checkbox" checked={selectedSources.includes(SourceType.YOUTUBE)} onChange={() => handleSourceToggle(SourceType.YOUTUBE)} disabled={isBuilding} className="w-4 h-4 text-red-600 rounded focus:ring-red-500" />
                        <div className="flex items-center gap-2 text-sm text-slate-700"><Youtube className="w-4 h-4 text-red-600" /> <span>YouTube Transcripts</span></div>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer bg-slate-50 p-2 rounded border border-slate-100 hover:bg-slate-100 transition-colors">
                        <input type="checkbox" checked={selectedSources.includes(SourceType.SOCIAL)} onChange={() => handleSourceToggle(SourceType.SOCIAL)} disabled={isBuilding} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                        <div className="flex items-center gap-2 text-sm text-slate-700"><Share2 className="w-4 h-4 text-blue-600" /> <span>Social Media (FB, X, Telegram)</span></div>
                    </label>
                </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
                {!isBuilding ? (
                    <button onClick={startBuild} className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg transition-colors shadow-sm"><Play className="w-4 h-4" /> {t.startBtn}</button>
                ) : (
                    <button onClick={stopBuild} className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-medium py-2.5 rounded-lg transition-colors"><StopCircle className="w-4 h-4" /> {t.stopBtn}</button>
                )}
            </div>
        </div>
      </div>

      <div className="lg:col-span-2 flex flex-col space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
             <div className="flex justify-between items-center mb-2">
                <h4 className="font-semibold text-slate-700">{t.statusTitle}</h4>
                <span className={`text-xs font-mono px-2 py-1 rounded ${isBuilding ? 'bg-green-100 text-green-700 animate-pulse' : 'bg-slate-100 text-slate-500'}`}>{isBuilding ? t.running : t.idle}</span>
             </div>
             <div className="w-full bg-slate-100 rounded-full h-2.5 mb-1">
                <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
             </div>
             <p className="text-xs text-right text-slate-400">{Math.round(progress)}% {t.complete}</p>
          </div>

          <div className="flex-1 bg-slate-900 rounded-xl shadow-lg overflow-hidden flex flex-col font-mono text-sm">
            <div className="bg-slate-800 px-4 py-2 flex items-center gap-2 border-b border-slate-700">
                <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                </div>
                <span className="text-slate-400 text-xs ml-2">cmbi-agent --verbose --grammar=auto --social=fallback</span>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-1 text-green-400">
                {logs.length === 0 ? <span className="text-slate-600 opacity-50">{t.waiting}</span> : logs.map((log, idx) => (<div key={idx} className="break-words"><span className="text-slate-500 mr-2">$</span>{log}</div>))}
                <div ref={logsEndRef} />
            </div>
          </div>
      </div>
    </div>
  );
};