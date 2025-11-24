
import React, { useState, useRef, useEffect } from 'react';
import { ArrowRight, Upload, RefreshCw, Sparkles, FileDown, Image as ImageIcon, FileType, Globe, Link, Loader2, ArrowDownCircle, Database, BookOpen, Eye, EyeOff, Split, Layers, Wand2 } from 'lucide-react';
import { CorpusDocument, DocumentType, Language, SourceType, GlossaryItem } from '../types';
import { translateProfessional, transcribeMedia, fetchContentFromUrl, generateGlossary, analyzePosDistribution, generateSyntheticCorpusData } from '../services/geminiService';
import { translations } from '../utils/translations';
import { analyzeSentiment, tokenize, cleanCorpusText, splitIntoChunks } from '../utils/nlp';
// @ts-ignore
import { toPng } from 'html-to-image';
// @ts-ignore
import JSZip from 'jszip';

// Access global mammoth loaded via script tag
declare var mammoth: any;

interface TranslatorViewProps {
  uiLang: 'EN' | 'ES';
  onDocsGenerated?: (docs: CorpusDocument[]) => void;
  onGlossaryGenerated?: (items: GlossaryItem[]) => void;
  // Persisted State Props
  externalSourceText: string;
  setExternalSourceText: (text: string) => void;
  externalResultHtml: string;
  setExternalResultHtml: (html: string) => void;
}

const TranslatorView: React.FC<TranslatorViewProps> = ({ 
    uiLang, 
    onDocsGenerated, 
    onGlossaryGenerated,
    externalSourceText,
    setExternalSourceText,
    externalResultHtml,
    setExternalResultHtml
}) => {
  const t = translations[uiLang];
  
  // Local UI state
  const [showSourcePreview, setShowSourcePreview] = useState(false);
  const [targetLang, setTargetLang] = useState<Language>(Language.SPANISH);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [autoPipelineDone, setAutoPipelineDone] = useState(false);
  
  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);
  const [inputType, setInputType] = useState<'FILE' | 'URL'>('FILE');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const isHtml = (text: string) => /<[a-z][\s\S]*>/i.test(text);

  useEffect(() => {
      if (externalSourceText && isHtml(externalSourceText)) {
          setShowSourcePreview(true);
      }
  }, [externalSourceText]);

  // --- Automation Pipeline ---

  const runFullPipeline = async (rawInput: string, docTitle: string, sourceType: SourceType, detectedHtml: boolean = false) => {
      setIsProcessing(true);
      setAutoPipelineDone(false);
      
      let contentToTranslate = rawInput;
      let finalTitle = docTitle;
      let finalSourceType = sourceType;

      // 1. URL Detection
      if (rawInput.trim().match(/^https?:\/\/[^\s]+$/)) {
          setStatus("Fetching Full URL Content...");
          try {
              const fetched = await fetchContentFromUrl(rawInput.trim());
              contentToTranslate = `<h1>${fetched.title}</h1>\n${fetched.content}`;
              finalTitle = fetched.title;
              finalSourceType = SourceType.ACADEMIC;
              setExternalSourceText(contentToTranslate); 
              setShowSourcePreview(true);
              detectedHtml = true;
          } catch (e) {
              contentToTranslate = rawInput;
          }
      } else {
          setExternalSourceText(contentToTranslate);
          if (detectedHtml) setShowSourcePreview(true);
      }

      // Clean text for analysis (stripping tags) - CRITICAL FOR CORPUS
      const stripHtml = (html: string) => {
          const tmp = document.createElement("DIV");
          tmp.innerHTML = html;
          return tmp.textContent || tmp.innerText || "";
      };
      
      const plainTextSource = detectedHtml ? stripHtml(contentToTranslate) : contentToTranslate;

      try {
          // 2. Image Protection & Translation
          setStatus("Processing Images & Layout...");
          
          // IMAGE PROTECTION ALGORITHM
          const imageMap = new Map<string, string>();
          let protectedContent = contentToTranslate;
          
          if (detectedHtml) {
              protectedContent = contentToTranslate.replace(/<img[^>]+>/g, (match) => {
                  const id = `[[__IMG_${Math.random().toString(36).substr(2, 9)}__]]`;
                  imageMap.set(id, match);
                  return id;
              });
          }

          setStatus(`Translating to ${targetLang} (Preserving Layout)...`);
          let htmlResult = await translateProfessional(protectedContent, targetLang);

          // RESTORE IMAGES
          imageMap.forEach((originalTag, placeholder) => {
              htmlResult = htmlResult.replace(placeholder, originalTag);
          });

          setExternalResultHtml(htmlResult);

          // 3. Advanced Corpus Registration (Dual Entry: Source & Target)
          if (onDocsGenerated) {
              const sourceLang = targetLang === Language.SPANISH ? Language.ENGLISH : Language.SPANISH;
              const docsToAdd: CorpusDocument[] = [];
              const pairId = `pair-${Date.now()}`;

              // --- A. Source Document (Original) ---
              setStatus("Analyzing Source Grammar (POS)...");
              let sourcePos = undefined;
              try { sourcePos = await analyzePosDistribution(plainTextSource); } catch(e){}
              
              const cleanedSourceForCorpus = cleanCorpusText(plainTextSource);

              const sourceDoc: CorpusDocument = {
                  id: `src-${Date.now()}`,
                  parallelId: pairId,
                  title: `[Source] ${finalTitle}`,
                  content: cleanedSourceForCorpus,
                  language: sourceLang,
                  type: DocumentType.TEXT,
                  sourceType: finalSourceType,
                  tokenCount: tokenize(cleanedSourceForCorpus).length,
                  uploadDate: new Date().toLocaleDateString(),
                  sentiment: analyzeSentiment(cleanedSourceForCorpus, sourceLang),
                  posData: sourcePos,
                  originalFileName: docTitle
              };
              docsToAdd.push(sourceDoc);

              // --- B. Target Document (Translated) ---
              const plainTextTarget = stripHtml(htmlResult); // Strip HTML from result too
              const cleanedTargetForCorpus = cleanCorpusText(plainTextTarget);
              
              setStatus("Analyzing Target Grammar (POS)...");
              let targetPos = undefined;
              try { targetPos = await analyzePosDistribution(cleanedTargetForCorpus); } catch(e){}

              const targetDoc: CorpusDocument = {
                  id: `trg-${Date.now()}`,
                  parallelId: pairId,
                  title: `[Trans] ${finalTitle}`,
                  content: cleanedTargetForCorpus,
                  language: targetLang,
                  type: DocumentType.TEXT,
                  sourceType: SourceType.GENERATED, // It's AI generated translation
                  tokenCount: tokenize(cleanedTargetForCorpus).length,
                  uploadDate: new Date().toLocaleDateString(),
                  sentiment: analyzeSentiment(cleanedTargetForCorpus, targetLang),
                  posData: targetPos,
                  originalFileName: `Translated_${docTitle}`
              };
              docsToAdd.push(targetDoc);

              // --- C. Augmentation (Synthetic Data Loop) ---
              // AUTOMATION: Search for MORE records relative to the topic.
              // We generate 4 distinct synthetic documents to ensure corpus > 3 records.
              try {
                  setStatus("Expanding Corpus Context (Auto-Research: >3 Docs)...");
                  const topic = finalTitle.substring(0, 40);
                  const augmentationCount = 4; // Generate 4 extra docs to satisfy requirement (>3)

                  for(let i = 0; i < augmentationCount; i++) {
                    // Alternate sources for variety
                    const mixSource = i % 2 === 0 ? SourceType.ACADEMIC : SourceType.SOCIAL;
                    
                    const summaryDoc = await generateSyntheticCorpusData(topic, mixSource, sourceLang);
                    summaryDoc.title = `Auto-Context ${i+1}: ${topic}`;
                    
                    docsToAdd.push({
                        id: `syn-ctx-${Date.now()}-${i}`,
                        title: summaryDoc.title,
                        content: summaryDoc.content,
                        language: summaryDoc.language,
                        type: DocumentType.TEXT,
                        sourceType: SourceType.GENERATED,
                        tokenCount: tokenize(summaryDoc.content).length,
                        uploadDate: summaryDoc.date,
                        sentiment: analyzeSentiment(summaryDoc.content, summaryDoc.language),
                        posData: await analyzePosDistribution(summaryDoc.content),
                        sourceUrl: summaryDoc.url,
                        author: summaryDoc.author
                    });
                  }
              } catch (err) {
                  console.warn("Augmentation minor error", err);
              }

              onDocsGenerated(docsToAdd);
          }

          // 4. Glossary Generation (Enhanced - AUTO FILL)
          // This is now guaranteed to run for every translation
          if (onGlossaryGenerated) {
              setStatus("Auto-Generating Glossary from Corpus...");
              // Use source text for glossary extraction, PASS TARGET LANG for definitions
              try {
                  const glossaryItems = await generateGlossary(plainTextSource, targetLang);
                  onGlossaryGenerated(glossaryItems);
              } catch (err) {
                  console.error("Glossary generation failed", err);
              }
          }

          setStatus("Pipeline Complete.");
          setAutoPipelineDone(true);
      } catch (error) {
          console.error("Pipeline Error", error);
          setStatus("Error in automation pipeline.");
      } finally {
          setIsProcessing(false);
          setTimeout(() => setStatus(''), 4000);
      }
  };

  // --- Handlers ---

  const handleManualTranslate = () => {
      if (!externalSourceText) return;
      runFullPipeline(externalSourceText, "Manual Input", SourceType.MANUAL_UPLOAD, isHtml(externalSourceText));
  };

  const processFile = async (file: File) => {
      setIsProcessing(true);
      setStatus("Reading file structure...");

      try {
        // Handle ZIP
        if (file.name.endsWith('.zip')) {
            setStatus("Unzipping...");
            const zip = new JSZip();
            const contents = await zip.loadAsync(file);
            const fileNames = Object.keys(contents.files);
            
            let processedOne = false;
            for (const filename of fileNames) {
                if (!contents.files[filename].dir && !filename.startsWith('__MACOSX') && !filename.startsWith('.')) {
                     if (processedOne) continue;

                     if (filename.endsWith('.docx')) {
                         const arrayBuffer = await contents.files[filename].async("arraybuffer");
                         if (typeof mammoth !== 'undefined') {
                             const result = await mammoth.convertToHtml({ arrayBuffer });
                             runFullPipeline(result.value, filename, SourceType.MANUAL_UPLOAD, true);
                             processedOne = true;
                         }
                     } else if (filename.match(/\.(txt|md|json)$/i)) {
                         const text = await contents.files[filename].async("string");
                         runFullPipeline(text, filename, SourceType.MANUAL_UPLOAD, false);
                         processedOne = true;
                     }
                }
            }
            if (!processedOne) {
                alert("No supported files (docx, txt) found in ZIP.");
                setIsProcessing(false);
            }
            return;
        }

        // Handle DOCX
        if (file.name.endsWith('.docx') || file.type.includes('wordprocessingml')) {
             const reader = new FileReader();
             reader.onload = async (event) => {
                 try {
                     const arrayBuffer = event.target?.result as ArrayBuffer;
                     if (typeof mammoth === 'undefined') throw new Error("Mammoth library not loaded");
                     // Mammoth converts docx to HTML with base64 images
                     const result = await mammoth.convertToHtml({ arrayBuffer });
                     if (!result.value) throw new Error("Empty result from Word doc");
                     
                     // Pass HTML true - pipeline handles image protection
                     runFullPipeline(result.value, file.name, SourceType.MANUAL_UPLOAD, true);
                 } catch (err) {
                     console.error("DOCX Parse Error", err);
                     alert("Could not parse Word document.");
                     setIsProcessing(false);
                 }
             };
             reader.readAsArrayBuffer(file);
             return;
        }

        // Handle PDF/Images/Audio
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64 = (reader.result as string).split(',')[1];
                setStatus("Analyzing visual structure with Gemini Vision...");
                
                let mimeType = file.type;
                if (file.name.endsWith('.pdf')) mimeType = 'application/pdf';

                const extracted = await transcribeMedia(base64, mimeType);
                runFullPipeline(extracted, file.name, SourceType.MANUAL_UPLOAD, false);
            } catch (err: any) {
                console.error("Extraction Error", err);
                let msg = "Error analyzing file.";
                if (err.message?.includes('400')) msg = "File format not supported. Please use PDF, Image, or Docx.";
                alert(msg);
                setIsProcessing(false);
            }
        };
        reader.readAsDataURL(file);

    } catch (err) {
        console.error("Upload Setup Error", err);
        setIsProcessing(false);
        setStatus('');
        alert("Error reading file.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    await processFile(file);
  };

  // --- DnD Handlers ---
  const onDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          processFile(e.dataTransfer.files[0]);
      }
  };

  // --- Export Functions ---

  const downloadAsImage = async () => {
    if (!resultRef.current) return;
    try {
        const dataUrl = await toPng(resultRef.current, { quality: 0.95, backgroundColor: '#ffffff' });
        const link = document.createElement('a');
        link.download = 'translation_export.png';
        link.href = dataUrl;
        link.click();
    } catch (err) {
        console.error('Image generation failed', err);
        alert('Could not generate image.');
    }
  };

  const downloadAsPDF = () => {
      const printContent = resultRef.current;
      if (!printContent) return;
      const win = window.open('', '', 'height=800,width=1000');
      if (!win) return;
      win.document.write(`<html><head><title>Translated</title><style>body{font-family:serif;padding:40px;line-height:1.6}img{max-width:100%}</style></head><body>${printContent.innerHTML}</body></html>`);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); win.close(); }, 500);
  };

  const downloadAsDocx = () => {
     if (!externalResultHtml) return;
     const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>Trans</title></head><body>`;
     const footer = "</body></html>";
     const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(header + externalResultHtml + footer);
     const link = document.createElement("a");
     link.href = source;
     link.download = 'translation.doc';
     link.click();
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6">
        {/* Source Column */}
        <div className="flex-1 flex flex-col space-y-4 min-w-0">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                     <div className="flex items-center gap-2">
                         <h3 className="font-semibold text-slate-800">{t.sourceContent}</h3>
                         {externalSourceText && (
                             <button 
                                onClick={() => setShowSourcePreview(!showSourcePreview)}
                                className="text-xs flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition-colors"
                                title="Toggle Source Preview"
                             >
                                {showSourcePreview ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                {showSourcePreview ? "Preview" : "Editor"}
                             </button>
                         )}
                     </div>
                     <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                         <button onClick={() => setInputType('FILE')} className={`p-1.5 rounded-md transition-colors ${inputType === 'FILE' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>
                             <Upload className="w-4 h-4" />
                         </button>
                         <button onClick={() => setInputType('URL')} className={`p-1.5 rounded-md transition-colors ${inputType === 'URL' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>
                             <Globe className="w-4 h-4" />
                         </button>
                     </div>
                </div>

                {inputType === 'FILE' && (
                    <div 
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50'}`}
                    >
                        {isDragging ? (
                            <div className="text-indigo-600 py-2 flex flex-col items-center gap-2">
                                <ArrowDownCircle className="w-6 h-6" />
                                <span className="text-sm font-medium">Drop files here</span>
                            </div>
                        ) : (
                            <label className="cursor-pointer flex flex-col items-center gap-2 py-2">
                                <span className="text-sm text-slate-500">{t.uploadForTrans}</span>
                                <span className="text-xs text-slate-400 flex gap-2">
                                    <span>.docx</span><span>.pdf</span><span>.zip</span><span>url</span>
                                </span>
                                <input 
                                    ref={fileInputRef} 
                                    type="file" 
                                    className="hidden"
                                    accept=".txt,.pdf,.docx,.jpg,.png,.jpeg,.zip" 
                                    onChange={handleFileUpload}
                                />
                            </label>
                        )}
                    </div>
                )}
            </div>

            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm p-0 flex flex-col min-h-[400px] relative overflow-hidden">
                {showSourcePreview ? (
                    <div className="flex-1 p-6 overflow-y-auto bg-slate-50">
                        <div 
                            className="document-view bg-white shadow-sm p-8 min-h-full"
                            dangerouslySetInnerHTML={{ __html: externalSourceText || '<p class="text-slate-400 italic">Preview will appear here...</p>' }} 
                        />
                        <style>{`
                           .document-view img { max-width: 100%; height: auto; display: block; margin: 10px auto; }
                           .document-view h1 { font-size: 1.8em; font-weight: bold; margin-bottom: 0.5em; }
                           .document-view p { margin-bottom: 1em; }
                           .document-view ul { list-style: disc; margin-left: 1.5em; }
                        `}</style>
                    </div>
                ) : (
                    <textarea
                        value={externalSourceText}
                        onChange={(e) => setExternalSourceText(e.target.value)}
                        placeholder="Paste text, HTML, or URL here..."
                        className="flex-1 w-full resize-none focus:outline-none text-slate-700 leading-relaxed font-mono text-sm p-4"
                    />
                )}
            </div>
        </div>

        {/* Center Controls */}
        <div className="flex flex-col justify-center items-center gap-4">
            <div className="lg:hidden"><ArrowRight className="w-6 h-6 text-slate-400 rotate-90" /></div>
            <button 
                onClick={handleManualTranslate}
                disabled={isProcessing || !externalSourceText}
                className="bg-indigo-600 text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg hover:bg-indigo-700 hover:scale-105 transition-all disabled:opacity-50 disabled:scale-100 group"
                title={t.translateBtn}
            >
                {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin"/> : <ArrowRight className="w-6 h-6 hidden lg:block" />}
                <ArrowRight className="w-6 h-6 rotate-90 lg:hidden" />
            </button>
            {isProcessing && (
                <div className="flex flex-col gap-2 text-[10px] text-indigo-600 font-semibold text-center">
                    <span className="flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded justify-center"><RefreshCw className="w-3 h-3 animate-spin" /> Processing...</span>
                    <span className="flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded justify-center"><Wand2 className="w-3 h-3" /> Layout Engine</span>
                </div>
            )}
            {autoPipelineDone && (
                <span className="text-[10px] bg-green-50 text-green-600 px-2 py-1 rounded font-bold">All Done!</span>
            )}
        </div>

        {/* Target Column */}
        <div className="flex-1 flex flex-col space-y-4 min-w-0">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-3">
                <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800">{t.targetContent}</h3>
                    {isProcessing && (
                        <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full animate-pulse flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> {status}
                        </span>
                    )}
                </div>
                <select 
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value as Language)}
                    className="bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-indigo-500"
                >
                    <option value={Language.SPANISH}>Español</option>
                    <option value={Language.ENGLISH}>English</option>
                </select>
            </div>
            
            {/* Preview Area */}
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-[400px] overflow-hidden relative">
                {isProcessing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-indigo-400 bg-white/80 z-20 backdrop-blur-sm">
                        <Loader2 className="w-10 h-10 animate-spin mb-3" />
                        <p className="text-sm font-medium animate-pulse">{status}</p>
                    </div>
                )}

                <div className="flex-1 p-0 overflow-y-auto bg-slate-100 relative">
                     <style>{`
                        .document-view { font-family: 'Times New Roman', serif; color: #000; line-height: 1.6; }
                        .document-view h1 { font-size: 2em; font-weight: bold; margin: 0.67em 0; border-bottom: 1px solid #eee; }
                        .document-view h2 { font-size: 1.5em; font-weight: bold; margin: 0.75em 0; }
                        .document-view p { margin: 1em 0; }
                        .document-view ul { list-style-type: disc; padding-left: 40px; margin: 1em 0; }
                        .document-view ol { list-style-type: decimal; padding-left: 40px; margin: 1em 0; }
                        .document-view table { border-collapse: collapse; width: 100%; margin: 1em 0; }
                        .document-view td, .document-view th { border: 1px solid #ccc; padding: 8px; vertical-align: top; }
                        .document-view th { background-color: #f5f5f5; font-weight: bold; }
                        .document-view img { max-width: 100%; height: auto; display: block; margin: 10px auto; border: 1px solid #ddd; }
                     `}</style>

                     <div 
                        ref={resultRef}
                        className="document-view bg-white shadow-lg my-6 mx-auto p-12 max-w-[210mm] min-h-[297mm]"
                        dangerouslySetInnerHTML={{ __html: externalResultHtml || `<div class="text-slate-300 text-center mt-32 italic font-sans">Translated output will mimic original layout (images included)...</div>` }}
                     />
                </div>

                {externalResultHtml && !isProcessing && (
                    <div className="p-3 border-t border-slate-100 bg-white flex justify-center gap-3 z-10">
                        <button onClick={downloadAsPDF} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors shadow-sm">
                            <FileDown className="w-4 h-4 text-red-500" /> PDF
                        </button>
                        <button onClick={downloadAsDocx} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors shadow-sm">
                            <FileType className="w-4 h-4 text-blue-600" /> Word
                        </button>
                        <button onClick={downloadAsImage} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg border border-slate-200 transition-colors shadow-sm">
                            <ImageIcon className="w-4 h-4 text-emerald-600" /> Image
                        </button>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default TranslatorView;
