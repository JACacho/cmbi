import React, { useState, useRef, useEffect } from 'react';
import { ArrowRight, Upload, RefreshCw, Sparkles, FileDown, Image as ImageIcon, FileType, Globe, Link, Loader2, ArrowDownCircle, Database, BookOpen, Eye, EyeOff, Split, Layers, Wand2 } from 'lucide-react';
import { CorpusDocument, DocumentType, Language, SourceType, GlossaryItem } from '../types';
import { translateProfessional, refineTranslationConventions, transcribeMedia, fetchContentFromUrl, generateGlossary, analyzePosDistribution, generateSyntheticCorpusData, detectLanguageAI, analyzeDocumentContext } from '../services/geminiService';
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
  const [sourceLangMode, setSourceLangMode] = useState<'AUTO' | Language>('AUTO');
  const [targetLang, setTargetLang] = useState<Language>(Language.SPANISH);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [autoPipelineDone, setAutoPipelineDone] = useState(false);
  const [currentDocTitle, setCurrentDocTitle] = useState('Document'); // Track source filename
  
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
      setCurrentDocTitle(docTitle); // Save title for export
      
      let contentToTranslate = rawInput;
      let finalTitle = docTitle;
      
      // 1. URL Detection
      if (rawInput.trim().match(/^https?:\/\/[^\s]+$/)) {
          setStatus("Fetching Full URL Content...");
          try {
              const fetched = await fetchContentFromUrl(rawInput.trim());
              contentToTranslate = `<h1>${fetched.title}</h1>\n${fetched.content}`;
              finalTitle = fetched.title;
              setCurrentDocTitle(fetched.title);
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
          // 2. Language Detection & Setup
          setStatus("Detecting Source Language...");
          let detectedSourceLang = sourceLangMode === 'AUTO' 
              ? await detectLanguageAI(plainTextSource) 
              : sourceLangMode;
          
          let finalTargetLang = targetLang;

          // AUTO-FLIP: If Source is same as Target, Flip Target.
          if (detectedSourceLang === targetLang) {
              finalTargetLang = targetLang === Language.SPANISH ? Language.ENGLISH : Language.SPANISH;
              setTargetLang(finalTargetLang);
              console.log(`Auto-flipped target to ${finalTargetLang} because source was ${detectedSourceLang}`);
          }

          // 3. CONTEXT & CORPUS ENRICHMENT (DEEP MINING MODE)
          setStatus("Analyzing Document Context & Domain...");
          const contextAnalysis = await analyzeDocumentContext(plainTextSource);
          const { topic, domain, tone, type: suggestedType } = contextAnalysis;
          console.log("Context Analysis:", contextAnalysis);
          
          let referenceContext = "";
          const enrichmentDocs: CorpusDocument[] = [];
          
          if (onDocsGenerated) {
              // Create 3 specific aspects to generate a dense, multi-register corpus
              const aspects = [
                  "Specialized Terminology & Glossary", // Register 1: Lexicon
                  "Standard Legal Clauses & Phrasing",  // Register 2: Phraseology
                  "Parallel Text & Tone Samples"        // Register 3: Style
              ];

              for (let i = 0; i < aspects.length; i++) {
                  const aspect = aspects[i];
                  setStatus(`Mining Corpus [${i+1}/3]: Fetching ${aspect} for ${domain}...`);
                  
                  try {
                      // Generate Source Lang Reference
                      const refSource = await generateSyntheticCorpusData(`${topic} (${domain})`, suggestedType, detectedSourceLang, aspect);
                      // Generate Target Lang Reference
                      const refTarget = await generateSyntheticCorpusData(`${topic} (${domain})`, suggestedType, finalTargetLang, aspect);
                      
                      referenceContext += `\n--- REGISTER GROUP ${i+1}: ${aspect} ---\nSource (${detectedSourceLang}):\n${refSource.content}\n\nTarget (${finalTargetLang}):\n${refTarget.content}\n`;
                      
                      // Add to UI Corpus
                      [refSource, refTarget].forEach((ref, idx) => {
                           enrichmentDocs.push({
                               id: `ref-ctx-${Date.now()}-${i}-${idx}`,
                               title: `[Ref: ${aspect}] ${ref.title}`,
                               content: ref.content,
                               language: ref.language,
                               type: DocumentType.TEXT,
                               sourceType: SourceType.GENERATED,
                               tokenCount: tokenize(ref.content).length,
                               uploadDate: ref.date,
                               sentiment: analyzeSentiment(ref.content, ref.language),
                               posData: ref.posData
                           });
                      });
                  } catch (e) {
                      console.warn(`Enrichment pass ${i} failed`, e);
                  }
              }
              
              if (enrichmentDocs.length > 0) {
                  onDocsGenerated(enrichmentDocs);
                  setStatus(`Enriched Corpus with ${enrichmentDocs.length} new registers.`);
              }
          }

          // 4. Image Protection & Translation
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

          setStatus(`Translating to ${finalTargetLang} using Domain Context: ${domain}...`);
          // Pass the generated reference context to the translator
          let draftHtml = await translateProfessional(protectedContent, finalTargetLang, referenceContext);
          
          // 5. CONVENTION REFINEMENT
          setStatus("Refining Language Conventions (e.g., Legal Headers)...");
          let finalHtml = await refineTranslationConventions(protectedContent, draftHtml, finalTargetLang);

          // RESTORE IMAGES
          imageMap.forEach((originalTag, placeholder) => {
              finalHtml = finalHtml.replace(placeholder, originalTag);
          });

          setExternalResultHtml(finalHtml);

          // 6. Corpus Registration (Source & Target)
          if (onDocsGenerated) {
              setStatus("Registering translation in Corpus...");
              const docsToAdd: CorpusDocument[] = [];
              const pairId = `pair-${Date.now()}`;

              // --- A. Source Document (Original) ---
              let sourcePos = undefined;
              try { sourcePos = await analyzePosDistribution(plainTextSource); } catch(e){}
              
              const cleanedSourceForCorpus = cleanCorpusText(plainTextSource);

              const sourceDoc: CorpusDocument = {
                  id: `src-${Date.now()}`,
                  parallelId: pairId,
                  title: `[Source] ${finalTitle}`,
                  content: cleanedSourceForCorpus,
                  language: detectedSourceLang,
                  type: DocumentType.TEXT,
                  sourceType: suggestedType, // Use detected type
                  tokenCount: tokenize(cleanedSourceForCorpus).length,
                  uploadDate: new Date().toLocaleDateString(),
                  sentiment: analyzeSentiment(cleanedSourceForCorpus, detectedSourceLang),
                  posData: sourcePos,
                  originalFileName: docTitle
              };
              docsToAdd.push(sourceDoc);

              // --- B. Target Document (Translated) ---
              const plainTextTarget = stripHtml(finalHtml); // Strip HTML from result too
              const cleanedTargetForCorpus = cleanCorpusText(plainTextTarget);
              
              let targetPos = undefined;
              try { targetPos = await analyzePosDistribution(cleanedTargetForCorpus); } catch(e){}

              const targetDoc: CorpusDocument = {
                  id: `trg-${Date.now()}`,
                  parallelId: pairId,
                  title: `[Trans] ${finalTitle}`,
                  content: cleanedTargetForCorpus,
                  language: finalTargetLang,
                  type: DocumentType.TEXT,
                  sourceType: SourceType.GENERATED, // It's AI generated translation
                  tokenCount: tokenize(cleanedTargetForCorpus).length,
                  uploadDate: new Date().toLocaleDateString(),
                  sentiment: analyzeSentiment(cleanedTargetForCorpus, finalTargetLang),
                  posData: targetPos,
                  originalFileName: `Translated_${docTitle}`
              };
              docsToAdd.push(targetDoc);

              onDocsGenerated(docsToAdd);
          }

          // 7. Glossary Generation (Enhanced - AUTO FILL)
          if (onGlossaryGenerated) {
              setStatus("Auto-Generating Glossary from Corpus...");
              try {
                  const glossaryItems = await generateGlossary(plainTextSource, finalTargetLang);
                  onGlossaryGenerated(glossaryItems);
              } catch (err) {
                  console.error("Glossary generation failed", err);
              }
          }

          setStatus("Pipeline Complete. Reviewed for Conventions.");
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
      runFullPipeline(externalSourceText, "Manual_Input", SourceType.MANUAL_UPLOAD, isHtml(externalSourceText));
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
                // Now explicitly treat transcription as HTML because transcribeMedia returns HTML
                runFullPipeline(extracted, file.name, SourceType.MANUAL_UPLOAD, true);
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

  const getCleanFilename = (suffix: string, ext: string) => {
      // Remove original extension if present
      const cleanName = currentDocTitle.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]/gi, '_').substring(0, 30);
      return `${cleanName}_${suffix}_${targetLang}.${ext}`;
  };

  const downloadAsImage = async () => {
    if (!resultRef.current) return;
    try {
        const dataUrl = await toPng(resultRef.current, { quality: 0.95, backgroundColor: '#ffffff' });
        const link = document.createElement('a');
        link.download = getCleanFilename('Traduccion', 'png');
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
      win.document.write(`<html><head><title>${currentDocTitle} - Translated</title><style>body{font-family:serif;padding:40px;line-height:1.6}img{max-width:100%}</style></head><body>${printContent.innerHTML}</body></html>`);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); win.close(); }, 500);
  };

  const downloadAsDocx = () => {
     if (!externalResultHtml) return;
     
     // Enhanced Word-compatible HTML wrapper
     const header = `
     <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
     <head>
        <meta charset='utf-8'>
        <title>${currentDocTitle}</title>
        <!--[if gte mso 9]>
        <xml>
        <w:WordDocument>
        <w:View>Print</w:View>
        <w:Zoom>100</w:Zoom>
        <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
            @page {
                size: 21.59cm 27.94cm;
                margin: 2.54cm 2.54cm 2.54cm 2.54cm;
                mso-page-orientation: portrait;
            }
            body {
                font-family: 'Times New Roman', serif;
                font-size: 12pt;
                line-height: 1.5;
            }
            table {
                border-collapse: collapse;
                width: 100%;
            }
            td {
                vertical-align: top;
                padding: 5px;
            }
        </style>
     </head>
     <body>`;
     
     const footer = "</body></html>";
     const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(header + externalResultHtml + footer);
     const link = document.createElement("a");
     link.href = source;
     link.download = getCleanFilename('Traduccion', 'doc');
     link.click();
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-6">
        {/* Source Column */}
        <div className="flex-1 flex flex-col space-y-4 min-w-0">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex flex-col gap-3">
                     <div className="flex justify-between items-center">
                         <h3 className="font-semibold text-slate-800">{t.sourceContent}</h3>
                         <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                             <button onClick={() => setInputType('FILE')} className={`p-1.5 rounded-md transition-colors ${inputType === 'FILE' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>
                                 <Upload className="w-4 h-4" />
                             </button>
                             <button onClick={() => setInputType('URL')} className={`p-1.5 rounded-md transition-colors ${inputType === 'URL' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>
                                 <Globe className="w-4 h-4" />
                             </button>
                         </div>
                     </div>
                     <div className="flex items-center gap-2">
                         <span className="text-xs text-slate-500">From:</span>
                         <select 
                            value={sourceLangMode}
                            onChange={(e) => setSourceLangMode(e.target.value as 'AUTO' | Language)}
                            className="text-xs bg-slate-50 border border-slate-300 rounded px-2 py-1 focus:ring-2 focus:ring-indigo-500"
                         >
                            <option value="AUTO">Auto-Detect</option>
                            <option value={Language.ENGLISH}>English</option>
                            <option value={Language.SPANISH}>Español</option>
                         </select>
                         {externalSourceText && (
                             <button 
                                onClick={() => setShowSourcePreview(!showSourcePreview)}
                                className="ml-auto text-xs flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition-colors"
                             >
                                {showSourcePreview ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                {showSourcePreview ? "Preview" : "Editor"}
                             </button>
                         )}
                     </div>
                </div>

                {inputType === 'FILE' && (
                    <div 
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        className={`mt-4 border-2 border-dashed rounded-lg p-4 text-center transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50'}`}
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
                <div className="flex flex-col gap-2 text-[10px] text-indigo-600 font-semibold text-center bg-white p-2 rounded shadow-sm border border-indigo-100">
                    <span className="flex items-center gap-1 justify-center"><RefreshCw className="w-3 h-3 animate-spin" /> Processing</span>
                    <span className="text-xs opacity-75">Step: {status.split('...')[0]}</span>
                </div>
            )}
            {autoPipelineDone && (
                <span className="text-[10px] bg-green-50 text-green-600 px-2 py-1 rounded font-bold">Reviewed ✓</span>
            )}
        </div>

        {/* Target Column */}
        <div className="flex-1 flex flex-col space-y-4 min-w-0">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-3">
                <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800">{t.targetContent}</h3>
                    {isProcessing && (
                        <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full animate-pulse flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Working...
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                     <span className="text-xs text-slate-500">To:</span>
                     <select 
                        value={targetLang}
                        onChange={(e) => setTargetLang(e.target.value as Language)}
                        className="bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 text-sm font-medium focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value={Language.SPANISH}>Español</option>
                        <option value={Language.ENGLISH}>English</option>
                    </select>
                </div>
            </div>
            
            {/* Preview Area */}
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-[400px] overflow-hidden relative">
                {isProcessing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-indigo-400 bg-white/90 z-20 backdrop-blur-sm p-4 text-center">
                        <Loader2 className="w-10 h-10 animate-spin mb-3" />
                        <p className="text-sm font-medium animate-pulse">{status}</p>
                        <p className="text-xs text-slate-400 mt-2">Checking corpus, enriching context, and reviewing conventions...</p>
                    </div>
                )}

                <div className="flex-1 p-0 overflow-y-auto bg-slate-100 relative">
                     <style>{`
                        /* Professional Document Layout Styles */
                        .document-view { 
                            font-family: 'Merriweather', 'Georgia', 'Times New Roman', serif; 
                            color: #1a1a1a; 
                            line-height: 1.8; 
                            font-size: 11pt;
                            box-sizing: border-box;
                        }
                        
                        /* Headers */
                        .document-view h1, .document-view h2, .document-view h3, .document-view h4 {
                            font-family: 'Inter', 'Segoe UI', sans-serif;
                            font-weight: 700;
                            color: #0f172a;
                            margin-top: 1.5em;
                            margin-bottom: 0.8em;
                            line-height: 1.3;
                        }
                        .document-view h1 { font-size: 24pt; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; }
                        .document-view h2 { font-size: 18pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
                        .document-view h3 { font-size: 14pt; }
                        
                        /* Body Text */
                        .document-view p { margin-bottom: 1.2em; text-align: justify; }
                        
                        /* Lists */
                        .document-view ul, .document-view ol { margin: 1em 0; padding-left: 2em; }
                        .document-view li { margin-bottom: 0.5em; }
                        
                        /* Blockquotes */
                        .document-view blockquote {
                            border-left: 4px solid #6366f1;
                            background: #f8fafc;
                            padding: 1em 1.5em;
                            margin: 1.5em 0;
                            font-style: italic;
                            color: #475569;
                            border-radius: 0 8px 8px 0;
                        }
                        
                        /* Tables */
                        .document-view table { 
                            border-collapse: collapse; 
                            width: 100%; 
                            margin: 1.5em 0; 
                            font-size: 0.95em;
                            border: 1px solid #cbd5e1;
                        }
                        .document-view th { 
                            background-color: #f1f5f9; 
                            color: #334155; 
                            font-weight: 600; 
                            padding: 12px; 
                            text-align: left;
                            border-bottom: 2px solid #cbd5e1;
                        }
                        .document-view td { 
                            padding: 10px; 
                            border-bottom: 1px solid #e2e8f0;
                            vertical-align: top;
                        }
                        .document-view tr:nth-child(even) { background-color: #f8fafc; }
                        
                        /* Images */
                        .document-view img { 
                            max-width: 100%; 
                            height: auto; 
                            display: block; 
                            margin: 20px auto; 
                            border-radius: 4px;
                            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); 
                        }
                        
                        /* Code Blocks */
                        .document-view pre {
                            background: #1e293b;
                            color: #f1f5f9;
                            padding: 1em;
                            border-radius: 8px;
                            overflow-x: auto;
                            font-family: 'Consolas', 'Monaco', monospace;
                            font-size: 0.9em;
                        }
                     `}</style>

                     <div 
                        ref={resultRef}
                        className="document-view bg-white shadow-xl my-6 mx-auto p-12 max-w-[210mm] min-h-[297mm] transition-all"
                        dangerouslySetInnerHTML={{ __html: externalResultHtml || `<div class="flex flex-col items-center justify-center h-64 text-slate-400 italic font-sans"><p>Translated document will appear here...</p><p class="text-xs mt-2">Format will mimic professional A4 paper layout.</p></div>` }}
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
