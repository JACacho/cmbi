import React, { useState, useMemo, useEffect } from 'react';
import { LayoutDashboard, Library, MessageSquareText, BookA, Menu, X, Database, Bot, Globe, Download, FileDown, GraduationCap, Languages, Link, Search, ArrowUpDown, ArrowUp, ArrowDown, Trash2, FileText, FileAudio, Video, Image as ImageIcon, Loader2 } from 'lucide-react';
import { CorpusDocument, DocumentType, Language, SourceType, GlossaryItem, PosBreakdown } from './types';
import { tokenize, analyzeSentiment, cleanCorpusText } from './utils/nlp';
import { translations } from './utils/translations';
import { simulateClassroomFetch, analyzePosDistribution, generateGlossary } from './services/geminiService';
import FileUploader from './components/FileUploader';
import AnalysisView from './components/AnalysisView';
import AIChat from './components/AIChat';
import GlossaryView from './components/GlossaryView';
import { CorpusBuilder } from './components/CorpusBuilder';
import TranslatorView from './components/TranslatorView';
// @ts-ignore
import JSZip from 'jszip';

enum Tab {
  DASHBOARD = 'dashboard',
  BUILDER = 'builder',
  ANALYSIS = 'analysis',
  CHAT = 'chat',
  GLOSSARY = 'glossary',
  TRANSLATOR = 'translator'
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>(Tab.DASHBOARD);
  const [documents, setDocuments] = useState<CorpusDocument[]>([]);
  const [glossaryItems, setGlossaryItems] = useState<GlossaryItem[]>([]); 
  const [corpusPosData, setCorpusPosData] = useState<PosBreakdown | null>(null); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [uiLang, setUiLang] = useState<'EN' | 'ES'>('ES'); 
  
  const [isGeneratingGlossary, setIsGeneratingGlossary] = useState(false);

  // --- Persisted Translator State ---
  const [transSourceText, setTransSourceText] = useState('');
  const [transResultHtml, setTransResultHtml] = useState('');

  // Classroom States
  const [isImportingClassroom, setIsImportingClassroom] = useState(false);
  const [classUrl, setClassUrl] = useState('');
  const [classTask, setClassTask] = useState('');

  // --- Search & Sort State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof CorpusDocument | 'sentiment', direction: 'asc' | 'desc' }>({ key: 'uploadDate', direction: 'desc' });

  const t = translations[uiLang];

  // --- AUTOMATION: Auto-Generate Glossary when Corpus is Stable ---
  useEffect(() => {
    // Only auto-generate if we have docs and no glossary yet
    if (documents.length > 0 && glossaryItems.length === 0 && !isGeneratingGlossary) {
        const timer = setTimeout(async () => {
            console.log("Auto-triggering Glossary Generation...");
            setIsGeneratingGlossary(true);
            try {
                // Combine first 50k chars of corpus for context
                const fullText = documents.map(d => d.content).join(" ").substring(0, 50000);
                
                // Determine dominant language
                const enCount = documents.filter(d => d.language === Language.ENGLISH).length;
                const dominantLang = enCount > documents.length / 2 ? Language.ENGLISH : Language.SPANISH;
                const targetLang = dominantLang === Language.SPANISH ? Language.ENGLISH : Language.SPANISH;

                const items = await generateGlossary(fullText, targetLang);
                if (items.length > 0) {
                   setGlossaryItems(prev => [...prev, ...items]);
                }
            } catch (e) {
                console.error("Auto Glossary Failed", e);
            } finally {
                setIsGeneratingGlossary(false);
            }
        }, 3000); // Wait 3 seconds after last update to ensure batch is done
        
        return () => clearTimeout(timer);
    }
  }, [documents, glossaryItems.length, isGeneratingGlossary]);


  // --- Filtering & Sorting Logic ---
  const filteredAndSortedDocs = useMemo(() => {
    let docs = [...documents];

    if (searchTerm.trim()) {
        try {
            if (searchTerm.startsWith('/') && searchTerm.length > 2) {
                const parts = searchTerm.match(/^\/(.*?)\/([gimsuy]*)$/);
                if (parts) {
                    const regex = new RegExp(parts[1], parts[2]);
                    docs = docs.filter(doc => regex.test(doc.title) || regex.test(doc.content));
                } else {
                     const term = searchTerm.toLowerCase();
                     docs = docs.filter(doc => doc.title.toLowerCase().includes(term));
                }
            } else {
                const term = searchTerm.toLowerCase();
                docs = docs.filter(doc => 
                    doc.title.toLowerCase().includes(term) || 
                    (doc.sourceType || '').toLowerCase().includes(term) ||
                    (doc.author || '').toLowerCase().includes(term)
                );
            }
        } catch (e) {
             const term = searchTerm.toLowerCase();
             docs = docs.filter(doc => doc.title.toLowerCase().includes(term));
        }
    }

    docs.sort((a, b) => {
        const key = sortConfig.key;
        let aVal: any = a[key as keyof CorpusDocument];
        let bVal: any = b[key as keyof CorpusDocument];

        if (key === 'sentiment') {
             const getScore = (s: any) => {
                 if (!s) return 0;
                 if (s.label === 'Positive') return 3;
                 if (s.label === 'Neutral') return 2;
                 if (s.label === 'Negative') return 1;
                 return 0;
             };
             aVal = getScore(a.sentiment);
             bVal = getScore(b.sentiment);
        } else if (key === 'tokenCount') {
            aVal = Number(aVal || 0);
            bVal = Number(bVal || 0);
        }

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    return docs;
  }, [documents, searchTerm, sortConfig]);

  const requestSort = (key: keyof CorpusDocument | 'sentiment') => {
      let direction: 'asc' | 'desc' = 'asc';
      if (sortConfig.key === key && sortConfig.direction === 'asc') {
          direction = 'desc';
      }
      setSortConfig({ key, direction });
  };

  const deleteDocument = (id: string) => {
      if (confirm(uiLang === 'EN' ? "Delete this document?" : "¿Eliminar este documento?")) {
          setDocuments(prev => prev.filter(d => d.id !== id));
      }
  };

  const SortIcon = ({ column }: { column: string }) => {
      if (sortConfig.key !== column) return <ArrowUpDown className="w-3 h-3 text-slate-300 opacity-50 group-hover:opacity-100" />;
      return sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-indigo-600" /> : <ArrowDown className="w-3 h-3 text-indigo-600" />;
  };

  const getTypeIcon = (type: DocumentType) => {
    switch (type) {
        case DocumentType.AUDIO: return <FileAudio className="w-4 h-4 text-amber-500" />;
        case DocumentType.VIDEO: return <Video className="w-4 h-4 text-rose-500" />;
        case DocumentType.IMAGE: return <ImageIcon className="w-4 h-4 text-emerald-500" />;
        default: return <FileText className="w-4 h-4 text-slate-400" />;
    }
  };

  const handleUpload = async (title: string, content: string, type: DocumentType, lang: Language) => {
    const cleanedContent = cleanCorpusText(content);
    const sentiment = analyzeSentiment(cleanedContent, lang);
    
    // OPTIMIZATION: Calculate POS Immediately on Upload
    let posData = undefined;
    try {
        if (cleanedContent.length > 50) {
            posData = await analyzePosDistribution(cleanedContent);
        }
    } catch (e) {
        console.warn("Auto POS failed", e);
    }

    const newDoc: CorpusDocument = {
      id: Math.random().toString(36).substr(2, 9),
      title,
      content: cleanedContent,
      type,
      language: lang,
      sourceType: SourceType.MANUAL_UPLOAD,
      tokenCount: tokenize(cleanedContent).length,
      uploadDate: new Date().toLocaleDateString(),
      sentiment: sentiment,
      author: 'Unknown',
      sourceUrl: 'Local File',
      posData: posData
    };
    setDocuments(prev => [...prev, newDoc]);
  };

  const handleAutoGeneratedDocs = (newDocs: CorpusDocument[]) => {
    // New docs coming from Builder already have posData calculated by the service
    setDocuments(prev => [...prev, ...newDocs]);
  };

  const handleGlossaryUpdate = (newItems: GlossaryItem[]) => {
    setGlossaryItems(prev => [...prev, ...newItems]);
  };

  const handleClassroomImport = async () => {
      if (!classUrl.trim() || !classTask.trim()) {
          alert(uiLang === 'EN' ? 'Please enter URL and Task Name' : 'Por favor ingresa la URL y el Nombre de la Tarea');
          return;
      }
      setIsImportingClassroom(true);
      try {
          const docs = await simulateClassroomFetch(classUrl, classTask);
          const processedDocs = docs.map(d => ({
              ...d,
              id: Math.random().toString(36).substr(2, 9),
              tokenCount: tokenize(d.content).length,
              uploadDate: new Date().toLocaleDateString(),
              sentiment: analyzeSentiment(d.content, d.language),
              type: DocumentType.TEXT,
              sourceUrl: d.url
          } as CorpusDocument));
          
          setDocuments(prev => [...prev, ...processedDocs]);
          setClassUrl('');
          setClassTask('');
          alert(`Imported ${docs.length} assignments from "${classTask}".`);
      } catch (error) {
          console.error(error);
          alert("Error connecting to Classroom simulator.");
      } finally {
          setIsImportingClassroom(false);
      }
  };

  const handleDownloadZip = async () => {
      if (documents.length === 0) return;
      
      const defaultName = "proyecto_corpus";
      const topicName = prompt(uiLang === 'EN' ? "Enter Corpus Name (Topic):" : "Nombre del Corpus (Tema):", defaultName) || defaultName;
      const safeTopicName = topicName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      const zip = new JSZip();
      const root = zip.folder(safeTopicName);
      if(!root) return;

      const enFolder = root.folder("en");
      const esFolder = root.folder("es");
      const completeFolder = root.folder("completo");

      let enCount = 1;
      let esCount = 1;

      let metadataRows = "ID_Documento,ID_Fuente_Paralelo,Idioma,Source_Type,Titulo,Fuente_URL,Longitud_Palabras_Estimada,Fecha_Publicacion,Nombre_Archivo\n";

      documents.forEach(doc => {
          let filename = "";
          let id = "";
          let folder = null;
          const isEn = doc.language === Language.ENGLISH;

          if (isEn) {
             id = `en_${String(enCount).padStart(3, '0')}`;
             filename = `${id}.txt`;
             folder = enFolder;
             enCount++;
          } else {
             id = `es_${String(esCount).padStart(3, '0')}`;
             filename = `${id}.txt`;
             folder = esFolder;
             esCount++;
          }

          if (folder) {
              folder.file(filename, doc.content);
              completeFolder?.file(filename, doc.content);

              const safeTitle = (doc.title || "").replace(/"/g, '""');
              const url = doc.sourceUrl || "N/A";
              const words = doc.tokenCount || 0;
              const date = doc.uploadDate || new Date().toLocaleDateString();
              const type = doc.sourceType || "Manual";
              const lang = isEn ? "English" : "Spanish";
              const parallelId = doc.parallelId || ""; 

              metadataRows += `${id},${parallelId},${lang},${type},"${safeTitle}","${url}",${words},"${date}",${filename}\n`;
          }
      });

      root.file("metadata.csv", metadataRows);

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTopicName}_corpus_output.zip`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleDownloadSingleFile = () => {
      if (documents.length === 0) return;
      const allContent = documents.map(d => `### ${d.title} (${d.language})\n${d.content}\n\n`).join("------------------------------------------------\n");
      const blob = new Blob([allContent], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Full_Corpus_Concatenated.txt";
      a.click();
      URL.revokeObjectURL(url);
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const toggleLanguage = () => setUiLang(prev => prev === 'EN' ? 'ES' : 'EN');

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 font-inter">
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={toggleSidebar}></div>
      )}

      <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-72 bg-slate-900 text-white transform transition-transform duration-300 lg:transform-none flex flex-col ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 bg-slate-950 border-b border-slate-800">
            <div className="flex flex-col items-center space-y-4">
                <div className="flex items-center justify-between w-full px-2">
                    <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center p-1 overflow-hidden shadow-lg border-2 border-green-600">
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Escudo-UABC-2020-color.png/240px-Escudo-UABC-2020-color.png" alt="UABC" className="w-full h-full object-contain" onError={(e) => {e.currentTarget.style.display='none'; e.currentTarget.parentElement!.innerText='UABC'}} />
                    </div>
                    <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center p-1 overflow-hidden shadow-lg border-2 border-yellow-500">
                        <img src="https://idiomas.tij.uabc.mx/images/logo.png" alt="Idiomas" className="w-full h-full object-contain" onError={(e) => {e.currentTarget.style.display='none'; e.currentTarget.parentElement!.innerText='F.I.'}} />
                    </div>
                </div>
                <div className="text-center space-y-1">
                    <h1 className="text-2xl font-extrabold tracking-tight text-white">CMBI</h1>
                    <p className="text-[10px] text-slate-300 uppercase font-medium tracking-wider leading-tight">Corpus Multifuente<br/>Bilingüe Inteligente</p>
                </div>
            </div>
        </div>
        
        <div className="flex justify-end px-4 py-2 border-b border-slate-800 bg-slate-900">
             <button onClick={toggleLanguage} className="flex items-center gap-2 text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors">
                <Globe className="w-3 h-3" />
                {uiLang === 'EN' ? 'Switch to ES' : 'Cambiar a EN'}
            </button>
        </div>
        
        <nav className="p-4 space-y-2 flex-1 overflow-y-auto bg-slate-900">
          <button onClick={() => { setActiveTab(Tab.DASHBOARD); setIsSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === Tab.DASHBOARD ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            <LayoutDashboard className="w-5 h-5" />
            <span className="font-medium">{t.manageCorpus}</span>
          </button>
          <button onClick={() => { setActiveTab(Tab.TRANSLATOR); setIsSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === Tab.TRANSLATOR ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            <Languages className="w-5 h-5" />
            <span className="font-medium">{t.translator}</span>
          </button>
          <button onClick={() => { setActiveTab(Tab.BUILDER); setIsSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === Tab.BUILDER ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            <Bot className="w-5 h-5" />
            <span className="font-medium">{t.autoBuild}</span>
          </button>
          <button onClick={() => { setActiveTab(Tab.ANALYSIS); setIsSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === Tab.ANALYSIS ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            <Library className="w-5 h-5" />
            <span className="font-medium">{t.analysis}</span>
          </button>
          <button onClick={() => { setActiveTab(Tab.CHAT); setIsSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === Tab.CHAT ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            <MessageSquareText className="w-5 h-5" />
            <span className="font-medium">{t.aiInquiry}</span>
          </button>
          <button onClick={() => { setActiveTab(Tab.GLOSSARY); setIsSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${activeTab === Tab.GLOSSARY ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
            <BookA className="w-5 h-5" />
            <span className="font-medium">{t.glossary}</span>
          </button>
        </nav>

        <div className="p-6 bg-slate-950 z-10 border-t border-slate-800">
           <div className="bg-slate-900 rounded-xl p-4 shadow-inner border border-slate-800">
             <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-400">{t.totalDocs}</p>
                <Database className="w-4 h-4 text-indigo-500" />
             </div>
             <p className="text-3xl font-bold text-white">{documents.length}</p>
             <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-2">
                {isGeneratingGlossary ? (
                    <>
                        <Loader2 className="w-2 h-2 text-indigo-400 animate-spin" />
                        <p className="text-[10px] text-indigo-400 uppercase tracking-wider animate-pulse">Building Glossary...</p>
                    </>
                ) : (
                    <>
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">System Online</p>
                    </>
                )}
             </div>
           </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="bg-white border-b border-slate-200 p-4 flex items-center justify-between lg:hidden z-20 relative shadow-sm">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-xs">CMBI</div>
                <span className="font-bold text-slate-800">Corpus Lab</span>
            </div>
            <button onClick={toggleSidebar} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                {isSidebarOpen ? <X className="w-6 h-6"/> : <Menu className="w-6 h-6"/>}
            </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-slate-50/50">
            <div className="max-w-7xl mx-auto h-full">
                {activeTab === Tab.DASHBOARD && (
                    <div className="space-y-8 animate-fade-in">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900">{t.corpusManagement}</h2>
                                <p className="text-slate-500">{t.corpusDesc}</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setActiveTab(Tab.BUILDER)} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors shadow-sm">
                                    <Bot className="w-4 h-4 text-indigo-600" /> {t.openBuilder}
                                </button>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2">
                                <FileUploader onUpload={handleUpload} uiLang={uiLang} />
                            </div>
                            <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-xl p-5 shadow-sm">
                                <div className="flex items-center gap-2 mb-3 text-amber-800">
                                    <GraduationCap className="w-5 h-5" />
                                    <h3 className="font-semibold">{t.classroomTitle}</h3>
                                </div>
                                <div className="space-y-3">
                                    <div className="relative">
                                        <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                                        <input type="text" value={classUrl} onChange={(e) => setClassUrl(e.target.value)} placeholder={t.classroomUrlPlaceholder} className="w-full pl-9 pr-3 py-2 text-sm border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white" />
                                    </div>
                                    <input type="text" value={classTask} onChange={(e) => setClassTask(e.target.value)} placeholder={t.classroomTaskPlaceholder} className="w-full px-3 py-2 text-sm border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none bg-white" />
                                    <button onClick={handleClassroomImport} disabled={isImportingClassroom} className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg text-sm font-medium transition-colors flex justify-center items-center gap-2 shadow-sm">
                                        {isImportingClassroom ? <span className="animate-spin">⟳</span> : <GraduationCap className="w-4 h-4" />}
                                        {t.classroomBtn}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-semibold text-slate-800">{t.docsInMemory}</h3>
                                        <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs border border-indigo-200">{documents.length}</span>
                                    </div>
                                    {documents.length > 0 && (
                                        <div className="hidden md:block text-xs text-slate-400 border-l pl-4 border-slate-200">
                                            {filteredAndSortedDocs.length} visible
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-1 max-w-md items-center gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                        <input type="text" placeholder={uiLang === 'EN' ? "Search title or /regex/" : "Buscar título o /regex/"} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 transition-all font-mono" />
                                    </div>
                                </div>

                                <div className="flex gap-2">
                                    <button onClick={handleDownloadZip} disabled={documents.length === 0} className="flex items-center gap-1 text-xs bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-3 py-2 rounded-lg transition-colors font-medium">
                                        <Download className="w-3.5 h-3.5" /> {t.downloadZip}
                                    </button>
                                     <button onClick={handleDownloadSingleFile} disabled={documents.length === 0} className="flex items-center gap-1 text-xs bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-3 py-2 rounded-lg transition-colors font-medium">
                                        <FileDown className="w-3.5 h-3.5" /> {t.downloadSingle}
                                    </button>
                                </div>
                            </div>

                            {documents.length === 0 ? (
                                <div className="p-12 text-center text-slate-400 flex flex-col items-center">
                                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                                        <Database className="w-8 h-8 text-slate-300" />
                                    </div>
                                    <p>{t.noDocs}</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 border-b border-slate-100">
                                        <tr>
                                            <th onClick={() => requestSort('title')} className="px-6 py-3 font-medium text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors group select-none"><div className="flex items-center gap-2">{t.tableTitle}<SortIcon column="title" /></div></th>
                                            <th onClick={() => requestSort('sourceType')} className="px-6 py-3 font-medium text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors group select-none"><div className="flex items-center gap-2">{t.tableSource}<SortIcon column="sourceType" /></div></th>
                                            <th onClick={() => requestSort('type')} className="px-6 py-3 font-medium text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors group select-none"><div className="flex items-center gap-2">{t.tableType}<SortIcon column="type" /></div></th>
                                            <th className="px-6 py-3 font-medium text-slate-500">{t.tableLang}</th>
                                            <th onClick={() => requestSort('tokenCount')} className="px-6 py-3 font-medium text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors group select-none"><div className="flex items-center gap-2">{t.tableTokens}<SortIcon column="tokenCount" /></div></th>
                                            <th onClick={() => requestSort('sentiment')} className="px-6 py-3 font-medium text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors group select-none"><div className="flex items-center gap-2">{t.tableSentiment}<SortIcon column="sentiment" /></div></th>
                                             <th onClick={() => requestSort('uploadDate')} className="px-6 py-3 font-medium text-slate-500 cursor-pointer hover:bg-slate-100 transition-colors group select-none"><div className="flex items-center gap-2">Date<SortIcon column="uploadDate" /></div></th>
                                            <th className="px-6 py-3 font-medium text-slate-500 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredAndSortedDocs.map(doc => (
                                            <tr key={doc.id} className="hover:bg-slate-50 transition-colors group">
                                                <td className="px-6 py-3 font-medium text-slate-800 max-w-[200px]" title={doc.title}>
                                                    <div className="flex items-center gap-3">
                                                        {getTypeIcon(doc.type)}
                                                        <div className="truncate flex-1 flex items-center gap-2">
                                                            {doc.title}
                                                            {doc.posData && (
                                                                <span className="text-[9px] uppercase tracking-wide bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 font-semibold" title="Grammar Data Ready">POS</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3 text-slate-500 text-xs truncate max-w-[150px]">{doc.sourceType || SourceType.MANUAL_UPLOAD}</td>
                                                <td className="px-6 py-3">
                                                    <span className={`px-2 py-1 rounded-full text-[10px] uppercase font-bold ${doc.type === DocumentType.AUDIO ? 'bg-amber-100 text-amber-700' : doc.type === DocumentType.VIDEO ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                                                        {doc.type}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3 text-slate-600 flex items-center gap-1">
                                                    {doc.language === Language.ENGLISH ? "🇬🇧 EN" : "🇪🇸 ES"}
                                                </td>
                                                <td className="px-6 py-3 text-slate-600 font-mono text-xs">{doc.tokenCount.toLocaleString()}</td>
                                                <td className="px-6 py-3">
                                                   {doc.sentiment && (
                                                       <div className="flex items-center gap-2">
                                                           <div className={`w-2 h-2 rounded-full ${doc.sentiment.label === 'Positive' ? 'bg-emerald-500' : doc.sentiment.label === 'Negative' ? 'bg-red-500' : 'bg-slate-400'}`}></div>
                                                           <span className="text-xs text-slate-600">{doc.sentiment.label}</span>
                                                       </div>
                                                   )}
                                                </td>
                                                <td className="px-6 py-3 text-xs text-slate-400 font-mono">
                                                    {doc.uploadDate}
                                                </td>
                                                <td className="px-6 py-3 text-right">
                                                    <button onClick={(e) => { e.stopPropagation(); deleteDocument(doc.id); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Delete Document">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === Tab.BUILDER && (
                    <CorpusBuilder onDocsGenerated={handleAutoGeneratedDocs} uiLang={uiLang} />
                )}

                {activeTab === Tab.ANALYSIS && (
                    <AnalysisView 
                        documents={documents} 
                        uiLang={uiLang} 
                        globalPosData={corpusPosData}
                        onUpdatePosData={setCorpusPosData}
                    />
                )}

                {activeTab === Tab.CHAT && (
                    <AIChat documents={documents} uiLang={uiLang} />
                )}
                
                {activeTab === Tab.GLOSSARY && (
                    <GlossaryView 
                        documents={documents} 
                        uiLang={uiLang} 
                        glossaryItems={glossaryItems}
                        onGlossaryGenerated={handleGlossaryUpdate}
                    />
                )}

                {activeTab === Tab.TRANSLATOR && (
                    <TranslatorView 
                        uiLang={uiLang} 
                        onDocsGenerated={handleAutoGeneratedDocs} 
                        onGlossaryGenerated={handleGlossaryUpdate}
                        externalSourceText={transSourceText}
                        setExternalSourceText={setTransSourceText}
                        externalResultHtml={transResultHtml}
                        setExternalResultHtml={setTransResultHtml}
                    />
                )}
            </div>
        </div>
      </main>
    </div>
  );
};

export default App;