
import React, { useState, useMemo, useEffect } from 'react';
import { BookOpen, RefreshCw, Download, ExternalLink } from 'lucide-react';
import { CorpusDocument, GlossaryItem } from '../types';
import { generateGlossary } from '../services/geminiService';
import { translations } from '../utils/translations';

interface GlossaryViewProps {
  documents: CorpusDocument[];
  uiLang: 'EN' | 'ES';
  glossaryItems: GlossaryItem[];
  onGlossaryGenerated: (items: GlossaryItem[]) => void;
}

const GlossaryView: React.FC<GlossaryViewProps> = ({ documents, uiLang, glossaryItems, onGlossaryGenerated }) => {
  const [isLoading, setIsLoading] = useState(false);
  const t = translations[uiLang];

  // Automated Glossary Trigger
  useEffect(() => {
      if (documents.length > 0 && glossaryItems.length === 0 && !isLoading) {
          handleGenerate();
      }
  }, [documents.length, glossaryItems.length]);

  const processedGlossary = useMemo(() => {
      // Deduplicate by term (case insensitive)
      const uniqueMap = new Map<string, GlossaryItem>();
      glossaryItems.forEach(item => {
          if (!item || !item.term) return; // Safety check
          const key = item.term.toLowerCase().trim();
          if (!uniqueMap.has(key)) {
              uniqueMap.set(key, item);
          }
      });
      
      // Sort Alphabetically
      return Array.from(uniqueMap.values()).sort((a, b) => 
          a.term.localeCompare(b.term, undefined, { sensitivity: 'base' })
      );
  }, [glossaryItems]);

  const handleGenerate = async () => {
    if (documents.length === 0) return;
    setIsLoading(true);
    
    const fullText = documents.map(d => d.content).join(" ").substring(0, 50000);
    
    try {
      // Default batch generation assumes Spanish target for now, or mixed.
      const items = await generateGlossary(fullText); 
      onGlossaryGenerated(items);
    } catch (err) {
      console.error(err);
      alert("Failed to generate glossary via AI.");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadCSV = () => {
    if (processedGlossary.length === 0) return;
    const headers = ["Term", "Translation", "Definition (Source)", "Definition (Target)", "Synonyms", "Example", "Reference URL"];
    const rows = processedGlossary.map(item => [
        `"${item.term || ''}"`,
        `"${item.translation || ''}"`,
        `"${item.definition || ''}"`,
        `"${item.targetDefinition || ''}"`,
        `"${(item.synonyms || []).join(", ")}"`,
        `"${item.example || ''}"`,
        `"${item.referenceUrl || ''}"`
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n" 
        + rows.join("\n");
        
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "cmbi_glossary.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-600" /> 
                {t.glossaryTitle}
            </h2>
            <p className="text-sm text-slate-500">{t.glossaryDesc}</p>
        </div>
        <div className="flex gap-3">
             {processedGlossary.length > 0 && (
                 <button onClick={downloadCSV} className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium">
                    <Download className="w-4 h-4" /> {t.exportCSV}
                 </button>
             )}
            <button 
                onClick={handleGenerate}
                disabled={isLoading || documents.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm font-medium"
            >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                {processedGlossary.length > 0 ? t.regenerateBtn : t.generateBtn}
            </button>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {processedGlossary.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                {isLoading ? (
                    <div className="flex flex-col items-center">
                         <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                         <p className="animate-pulse">Generating Glossary from Corpus...</p>
                    </div>
                ) : (
                    <>
                        <BookOpen className="w-12 h-12 mb-4 opacity-20" />
                        <p>{t.emptyState}</p>
                    </>
                )}
            </div>
        ) : (
            <div className="overflow-y-auto h-full">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                        <tr>
                            <th className="p-4 font-semibold text-slate-700 w-[15%]">{t.term}</th>
                            <th className="p-4 font-semibold text-slate-700 w-[15%]">{t.translation}</th>
                            <th className="p-4 font-semibold text-slate-700 w-[25%]">{t.definition} <span className="text-slate-400 font-normal text-xs">(Source)</span></th>
                            <th className="p-4 font-semibold text-slate-700 w-[15%]">{t.synonyms} <span className="text-indigo-500 font-normal text-xs">(Target)</span></th>
                            <th className="p-4 font-semibold text-slate-700 w-[20%]">{t.context}</th>
                            <th className="p-4 font-semibold text-slate-700 w-[10%]">Ref</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {processedGlossary.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                <td className="p-4 align-top">
                                    <span className="font-bold text-indigo-700 block">{item.term}</span>
                                </td>
                                <td className="p-4 text-slate-600 italic align-top">{item.translation}</td>
                                <td className="p-4 align-top">
                                    <div className="mb-2 text-slate-700">{item.definition}</div>
                                    {item.targetDefinition && (
                                        <div className="text-slate-500 pt-2 border-t border-slate-100 mt-2 italic text-xs">
                                            <span className="font-semibold text-slate-400 mr-1">Target:</span>
                                            {item.targetDefinition}
                                        </div>
                                    )}
                                </td>
                                <td className="p-4 align-top">
                                    <div className="flex flex-wrap gap-1">
                                        {/* Added Safety Check for map */}
                                        {(item.synonyms || []).map((s, i) => (
                                            <span key={`${s}-${i}`} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-xs border border-slate-200">{s}</span>
                                        ))}
                                    </div>
                                </td>
                                <td className="p-4 text-slate-500 font-mono text-xs align-top">
                                    <div className="bg-amber-50/30 p-2 rounded border border-amber-50">"{item.example}"</div>
                                </td>
                                <td className="p-4 align-top">
                                    {item.referenceUrl ? (
                                        <a 
                                            href={item.referenceUrl} 
                                            target="_blank" 
                                            rel="noopener noreferrer" 
                                            className="text-indigo-500 hover:text-indigo-700 flex items-center gap-1 text-xs font-medium"
                                            title={item.referenceUrl}
                                        >
                                            Link <ExternalLink className="w-3 h-3" />
                                        </a>
                                    ) : <span className="text-slate-300 text-xs">-</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>
    </div>
  );
};

export default GlossaryView;
