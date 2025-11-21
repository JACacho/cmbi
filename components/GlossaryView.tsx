import React, { useState, useMemo } from 'react';
import { BookOpen, RefreshCw, Download } from 'lucide-react';
import { CorpusDocument, GlossaryItem } from '../types';
import { generateGlossary } from '../services/geminiService';
import { translations } from '../utils/translations';

interface GlossaryViewProps {
  documents: CorpusDocument[];
  uiLang: 'EN' | 'ES';
}

const GlossaryView: React.FC<GlossaryViewProps> = ({ documents, uiLang }) => {
  const [rawGlossary, setRawGlossary] = useState<GlossaryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const t = translations[uiLang];

  const processedGlossary = useMemo(() => {
      // Deduplicate by term (case insensitive)
      const uniqueMap = new Map<string, GlossaryItem>();
      rawGlossary.forEach(item => {
          const key = item.term.toLowerCase().trim();
          if (!uniqueMap.has(key)) {
              uniqueMap.set(key, item);
          }
      });
      
      // Sort Alphabetically
      return Array.from(uniqueMap.values()).sort((a, b) => 
          a.term.localeCompare(b.term, undefined, { sensitivity: 'base' })
      );
  }, [rawGlossary]);

  const handleGenerate = async () => {
    if (documents.length === 0) return;
    setIsLoading(true);
    
    const fullText = documents.map(d => d.content).join(" ").substring(0, 50000);
    
    try {
      // Append new results to existing if any, or replace? 
      // Let's replace to keep it clean based on current corpus state
      const items = await generateGlossary(fullText);
      setRawGlossary(items);
    } catch (err) {
      console.error(err);
      alert("Failed to generate glossary via AI.");
    } finally {
      setIsLoading(false);
    }
  };

  const downloadCSV = () => {
    if (processedGlossary.length === 0) return;
    const headers = ["Term", "Translation", "Definition (Source)", "Definition (Target)", "Synonyms", "Example"];
    const rows = processedGlossary.map(item => [
        `"${item.term}"`,
        `"${item.translation}"`,
        `"${item.definition}"`,
        `"${item.targetDefinition || ''}"`,
        `"${item.synonyms.join(", ")}"`,
        `"${item.example}"`
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
                <BookOpen className="w-12 h-12 mb-4 opacity-20" />
                <p>{t.emptyState}</p>
            </div>
        ) : (
            <div className="overflow-y-auto h-full">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                        <tr>
                            <th className="p-4 font-semibold text-slate-700">{t.term}</th>
                            <th className="p-4 font-semibold text-slate-700">{t.translation}</th>
                            <th className="p-4 font-semibold text-slate-700 w-1/5">{t.definition}</th>
                            <th className="p-4 font-semibold text-slate-700 w-1/5">{t.targetDef}</th>
                            <th className="p-4 font-semibold text-slate-700">{t.synonyms}</th>
                            <th className="p-4 font-semibold text-slate-700 w-1/5">{t.context}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {processedGlossary.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                <td className="p-4 font-bold text-indigo-700">{item.term}</td>
                                <td className="p-4 text-slate-600 italic">{item.translation}</td>
                                <td className="p-4 text-slate-600 text-xs">{item.definition}</td>
                                <td className="p-4 text-slate-600 text-xs">{item.targetDefinition}</td>
                                <td className="p-4">
                                    <div className="flex flex-wrap gap-1">
                                        {item.synonyms.map(s => (
                                            <span key={s} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-xs border border-slate-200">{s}</span>
                                        ))}
                                    </div>
                                </td>
                                <td className="p-4 text-slate-500 font-mono text-xs bg-amber-50/30 rounded m-2">
                                    "{item.example}"
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