
import React, { useState, useRef } from 'react';
import { Upload, FileText, FileAudio, Loader2, Link, Archive, ArrowDownCircle, Globe, FileSpreadsheet, FolderUp, Tag } from 'lucide-react';
import { DocumentType, Language, SourceType } from '../types';
import { transcribeMedia, fetchContentFromUrl } from '../services/geminiService';
import { translations } from '../utils/translations';
import { cleanCorpusText } from '../utils/nlp';
// @ts-ignore
import * as XLSX from 'xlsx';
// @ts-ignore
import JSZip from 'jszip';

interface FileUploaderProps {
  onUpload: (title: string, content: string, type: DocumentType, lang: Language, source?: SourceType) => void;
  uiLang: 'EN' | 'ES';
}

const FileUploader: React.FC<FileUploaderProps> = ({ onUpload, uiLang }) => {
  const [mode, setMode] = useState<'FILE' | 'URL'>('FILE');
  const [urlInput, setUrlInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  // New State for Source Category
  const [selectedSourceType, setSelectedSourceType] = useState<SourceType>(SourceType.MANUAL_UPLOAD);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const t = translations[uiLang];

  // --- Helpers ---

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const detectLanguage = (text: string): Language => {
    const spanishWords = ['el', 'la', 'de', 'que', 'y', 'en', 'un', 'ser', 'por', 'para'];
    const englishWords = ['the', 'and', 'of', 'to', 'a', 'in', 'is', 'you', 'that', 'it'];
    
    const tokens = text.toLowerCase().split(/\s+/).slice(0, 100);
    let esCount = 0;
    let enCount = 0;

    tokens.forEach(t => {
      if (spanishWords.includes(t)) esCount++;
      if (englishWords.includes(t)) enCount++;
    });

    if (esCount > enCount) return Language.SPANISH;
    return Language.ENGLISH;
  };

  // --- Handlers ---

  const parseExcel = async (file: File) => {
     try {
         setStatusMessage('Reading Spreadsheet...');
         const data = await file.arrayBuffer();
         const workbook = XLSX.read(data, { type: 'array' });
         const firstSheetName = workbook.SheetNames[0];
         const worksheet = workbook.Sheets[firstSheetName];
         const json = XLSX.utils.sheet_to_json(worksheet);

         let count = 0;
         json.forEach((row: any) => {
             const content = row['documentos'] || row['content'] || row['text'] || row['body'] || row['Documentos'] || '';
             const title = row['title'] || row['titulo'] || row['filename'] || `Excel_Row_${count+1}`;
             
             if (content && typeof content === 'string' && content.trim().length > 0) {
                 const cleaned = cleanCorpusText(content);
                 onUpload(title, cleaned, DocumentType.TEXT, detectLanguage(cleaned), selectedSourceType);
                 count++;
             }
         });
         setStatusMessage(`Imported ${count} records from Spreadsheet.`);
     } catch (err) {
         console.error(err);
         setStatusMessage('Error parsing Excel.');
     }
  };

  const processSingleFile = async (file: File) => {
      const fileType = file.type;
      const originalName = file.name.toLowerCase();
      
      // Prefer webkitRelativePath (e.g. "MyFolder/doc.txt") for title if available, else filename
      // @ts-ignore
      const displayTitle = file.webkitRelativePath || file.name;

      // 1. Handle Zip
      if (originalName.endsWith('.zip')) {
          await handleZipFile(file);
          return;
      }

      // 2. Handle Excel
      if (originalName.endsWith('.xlsx') || originalName.endsWith('.xls') || originalName.endsWith('.csv')) {
          await parseExcel(file);
          return;
      }

      // 3. Handle Text/Markdown
      if (fileType.startsWith('text/') || originalName.endsWith('.txt') || originalName.endsWith('.md')) {
        const text = await file.text();
        const cleaned = cleanCorpusText(text);
        onUpload(displayTitle, cleaned, DocumentType.TEXT, detectLanguage(cleaned), selectedSourceType);
      
      // 4. Handle Media/PDF
      } else if (fileType.startsWith('audio/') || fileType.startsWith('video/') || fileType.startsWith('image/') || originalName.endsWith('.pdf')) {
        setStatusMessage(`${t.transcribing}: ${file.name}`);
        const base64 = await fileToBase64(file);
        let docType = DocumentType.IMAGE;
        if (fileType.startsWith('audio')) docType = DocumentType.AUDIO;
        if (fileType.startsWith('video')) docType = DocumentType.VIDEO;
        
        const transcript = await transcribeMedia(base64, fileType || 'application/pdf');
        onUpload(displayTitle, transcript, docType, detectLanguage(transcript), selectedSourceType);
      
      // 5. Handle DOCX via Mammoth
      } else if (originalName.endsWith('.docx')) {
           const arrayBuffer = await file.arrayBuffer();
           // @ts-ignore
           if (typeof mammoth !== 'undefined') {
               // @ts-ignore
               const result = await mammoth.extractRawText({ arrayBuffer });
               const cleaned = cleanCorpusText(result.value);
               onUpload(displayTitle, cleaned, DocumentType.TEXT, detectLanguage(cleaned), selectedSourceType);
           } else {
               alert("DOCX processor not loaded.");
           }
      } else {
         console.warn("Skipping unsupported file type:", file.name);
      }
  };

  const handleZipFile = async (file: File) => {
      setStatusMessage("Unzipping archive...");
      try {
          const zip = new JSZip();
          const contents = await zip.loadAsync(file);
          const fileNames = Object.keys(contents.files);
          
          setStatusMessage(`Found ${fileNames.length} files in zip. Processing...`);
          
          let processedCount = 0;
          for (const filename of fileNames) {
              const zipEntry = contents.files[filename];
              if (!zipEntry.dir && !filename.startsWith('__MACOSX') && !filename.startsWith('.')) {
                  // Check extension
                  if (filename.match(/\.(txt|md|csv|json)$/i)) {
                      const text = await zipEntry.async("string");
                      const cleaned = cleanCorpusText(text);
                      // filename inside zip includes path
                      onUpload(filename, cleaned, DocumentType.TEXT, detectLanguage(cleaned), selectedSourceType);
                      processedCount++;
                  } else if (filename.match(/\.(docx)$/i)) {
                       const arrayBuffer = await zipEntry.async("arraybuffer");
                       // @ts-ignore
                       if (typeof mammoth !== 'undefined') {
                           // @ts-ignore
                           const result = await mammoth.extractRawText({ arrayBuffer });
                           const cleaned = cleanCorpusText(result.value);
                           onUpload(filename, cleaned, DocumentType.TEXT, detectLanguage(cleaned), selectedSourceType);
                           processedCount++;
                       }
                  }
              }
          }
          setStatusMessage(`Extracted ${processedCount} valid documents from ZIP.`);
      } catch (e) {
          console.error(e);
          alert("Error reading ZIP file.");
      }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    handleFiles(Array.from(files));
    
    // Reset inputs so same file can be selected again if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleFiles = async (files: File[]) => {
      setIsProcessing(true);
      setStatusMessage(t.analyzing);

      try {
          for (const file of files) {
              await processSingleFile(file);
          }
          setStatusMessage(t.uploadComplete);
      } catch (error) {
          console.error(error);
          setStatusMessage(t.error);
      } finally {
          setIsProcessing(false);
          setTimeout(() => setStatusMessage(''), 3000);
      }
  };

  const handleUrlFetch = async () => {
      if (!urlInput.trim()) return;
      setIsProcessing(true);
      setStatusMessage("Scraping URL...");
      
      try {
          const result = await fetchContentFromUrl(urlInput);
          // Use selectedSourceType unless it's manual, then default to Academic/General
          const finalType = selectedSourceType === SourceType.MANUAL_UPLOAD ? SourceType.ACADEMIC : selectedSourceType;
          onUpload(result.title, result.content, DocumentType.TEXT, detectLanguage(result.content), finalType);
          setUrlInput('');
          setStatusMessage("URL imported successfully.");
      } catch (e) {
          console.error(e);
          setStatusMessage("Error fetching URL.");
      } finally {
          setIsProcessing(false);
          setTimeout(() => setStatusMessage(''), 3000);
      }
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
          handleFiles(Array.from(e.dataTransfer.files));
      }
  };

  return (
    <div className="space-y-4">
        {/* Simplified Mode Selection without File Subtypes */}
        <div className="flex justify-between items-center border-b border-slate-200">
            <div className="flex gap-2">
                <button 
                    onClick={() => setMode('FILE')}
                    className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${mode === 'FILE' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <Upload className="w-4 h-4" /> Upload
                </button>
                <button 
                    onClick={() => setMode('URL')}
                    className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${mode === 'URL' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <Globe className="w-4 h-4" /> URL
                </button>
            </div>
            
            {/* Source Tag Selector */}
            <div className="flex items-center gap-2 pb-2 pr-2">
                <Tag className="w-4 h-4 text-slate-400" />
                <select 
                    value={selectedSourceType}
                    onChange={(e) => setSelectedSourceType(e.target.value as SourceType)}
                    className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-600 focus:ring-2 focus:ring-indigo-500"
                    title={t.categoryLabel}
                >
                    <option value={SourceType.MANUAL_UPLOAD}>General / Manual</option>
                    <option value={SourceType.ACADEMIC}>Academic / Paper</option>
                    <option value={SourceType.SOCIAL}>{t.catSocial}</option>
                    <option value={SourceType.YOUTUBE}>Transcript / Subs</option>
                </select>
            </div>
        </div>

        {mode === 'FILE' && (
            <div 
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={`p-10 border-2 border-dashed rounded-xl transition-all text-center ${
                    isDragging 
                    ? 'border-indigo-500 bg-indigo-50 scale-[1.01]' 
                    : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
                }`}
            >
                <div className="flex flex-col items-center justify-center space-y-4">
                    <div className={`p-4 rounded-full transition-colors ${isDragging ? 'bg-indigo-200 text-indigo-700' : 'bg-indigo-100 text-indigo-600'}`}>
                        {isProcessing ? <Loader2 className="w-10 h-10 animate-spin" /> : (isDragging ? <ArrowDownCircle className="w-10 h-10" /> : <Upload className="w-10 h-10" />)}
                    </div>
                    
                    <div className="text-center">
                        <h3 className="text-xl font-semibold text-slate-800">{isDragging ? "Drop anything here" : t.importTitle}</h3>
                        <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
                            Drag & Drop ANY content: Documents, Folders (Zip), Spreadsheets (Excel), Images or Media.
                        </p>
                        <p className="text-xs text-indigo-600 mt-1 font-medium">
                            Current Tag: {selectedSourceType === SourceType.SOCIAL ? 'Social Media' : selectedSourceType}
                        </p>
                    </div>

                    {isProcessing ? (
                    <p className="text-sm font-medium text-indigo-600 animate-pulse">{statusMessage}</p>
                    ) : (
                    <div className="flex flex-wrap justify-center gap-3 pt-2">
                        <label className="cursor-pointer px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 shadow-sm transition-all flex items-center gap-2 text-sm">
                            <FileText className="w-4 h-4" /> {t.selectFile}
                            <input 
                                ref={fileInputRef}
                                type="file" 
                                className="hidden" 
                                accept=".txt,.pdf,.docx,.zip,.xlsx,.xls,.csv,audio/*,video/*,image/*"
                                multiple
                                onChange={handleFileChange}
                            />
                        </label>
                        
                        <label className="cursor-pointer px-6 py-3 bg-white text-indigo-700 border border-indigo-200 rounded-lg font-medium hover:bg-indigo-50 shadow-sm transition-all flex items-center gap-2 text-sm">
                            <FolderUp className="w-4 h-4" /> {t.selectFolder}
                            <input 
                                ref={folderInputRef}
                                type="file" 
                                className="hidden"
                                multiple
                                {...({ webkitdirectory: "", directory: "" } as any)}
                                onChange={handleFileChange}
                            />
                        </label>
                    </div>
                    )}
                    
                    <div className="flex flex-wrap justify-center gap-6 text-xs text-slate-400 mt-6">
                        <span className="flex items-center gap-1"><FileText className="w-3 h-3"/> Docs</span>
                        <span className="flex items-center gap-1"><FileSpreadsheet className="w-3 h-3"/> Excel</span>
                        <span className="flex items-center gap-1"><Archive className="w-3 h-3"/> Zip</span>
                        <span className="flex items-center gap-1"><FolderUp className="w-3 h-3"/> Folders</span>
                    </div>
                </div>
            </div>
        )}

        {mode === 'URL' && (
             <div className="p-8 border border-slate-200 rounded-xl bg-white shadow-sm">
                 <div className="flex flex-col items-center justify-center space-y-4 max-w-lg mx-auto">
                    <div className="p-4 bg-blue-50 rounded-full text-blue-600">
                        <Globe className="w-8 h-8" />
                    </div>
                    <div className="text-center w-full">
                         <h3 className="text-lg font-semibold text-slate-800">Import Web Content</h3>
                         <p className="text-sm text-slate-500 mb-4">Paste a URL to scrape its main content into the corpus.</p>
                         
                         <div className="flex gap-2 w-full">
                            <input 
                                type="url" 
                                value={urlInput}
                                onChange={(e) => setUrlInput(e.target.value)}
                                placeholder="https://twitter.com/username/status/..."
                                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                disabled={isProcessing}
                            />
                            <button 
                                onClick={handleUrlFetch}
                                disabled={isProcessing || !urlInput}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center gap-2"
                            >
                                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
                                Fetch
                            </button>
                         </div>
                         <div className="mt-2 text-xs text-slate-400">
                            Auto-assigned to: <span className="font-semibold text-indigo-500">{selectedSourceType}</span>
                         </div>
                         {isProcessing && <p className="text-sm text-blue-600 mt-2">{statusMessage}</p>}
                    </div>
                 </div>
             </div>
        )}
    </div>
  );
};

export default FileUploader;
