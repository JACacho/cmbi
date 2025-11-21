
import React, { useState, useRef } from 'react';
import { Upload, FileText, FileAudio, Loader2, FolderInput, FileSpreadsheet } from 'lucide-react';
import { DocumentType, Language, SourceType } from '../types';
import { transcribeMedia } from '../services/geminiService';
import { translations } from '../utils/translations';
import { cleanCorpusText } from '../utils/nlp';
// @ts-ignore
import * as XLSX from 'xlsx';

interface FileUploaderProps {
  onUpload: (title: string, content: string, type: DocumentType, lang: Language, source?: SourceType) => void;
  uiLang: 'EN' | 'ES';
}

const FileUploader: React.FC<FileUploaderProps> = ({ onUpload, uiLang }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const t = translations[uiLang];

  // --- Single File Handler ---
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setStatusMessage(t.analyzing);

    const file = files[0];
    const fileType = file.type;

    try {
      if (fileType.startsWith('text/') || file.name.endsWith('.txt')) {
        const text = await file.text();
        const cleaned = cleanCorpusText(text);
        onUpload(file.name, cleaned, DocumentType.TEXT, detectLanguage(cleaned), SourceType.MANUAL_UPLOAD);
        setStatusMessage(t.uploadComplete);
      } else if (fileType.startsWith('audio/') || fileType.startsWith('video/')) {
        setStatusMessage(t.transcribing);
        const base64 = await fileToBase64(file);
        const transcript = await transcribeMedia(base64, fileType);
        onUpload(file.name, transcript, fileType.startsWith('audio') ? DocumentType.AUDIO : DocumentType.VIDEO, detectLanguage(transcript), SourceType.MANUAL_UPLOAD);
        setStatusMessage(t.transcriptionComplete);
      } else {
         // Fallback for other text formats if needed, currently supporting text/media
         alert('Please upload supported formats.');
      }
    } catch (error) {
      console.error(error);
      setStatusMessage(t.error);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  // --- Folder Handler ---
  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setStatusMessage(`Processing ${files.length} files from folder...`);

    let processed = 0;

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // Skip hidden files
        if (file.name.startsWith('.')) continue;

        try {
            if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
                const text = await file.text();
                const cleaned = cleanCorpusText(text);
                onUpload(file.name, cleaned, DocumentType.TEXT, detectLanguage(cleaned), SourceType.MANUAL_UPLOAD);
                processed++;
            }
        } catch (err) {
            console.error(`Failed to process ${file.name}`, err);
        }
    }

    setStatusMessage(`Imported ${processed} text files.`);
    setIsProcessing(false);
    if (folderInputRef.current) folderInputRef.current.value = '';
    setTimeout(() => setStatusMessage(''), 3000);
  };

  // --- Excel Handler ---
  const handleExcelChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
     const file = e.target.files?.[0];
     if (!file) return;

     setIsProcessing(true);
     setStatusMessage('Reading Excel file...');

     try {
         const data = await file.arrayBuffer();
         const workbook = XLSX.read(data, { type: 'array' });
         const firstSheetName = workbook.SheetNames[0];
         const worksheet = workbook.Sheets[firstSheetName];
         const json = XLSX.utils.sheet_to_json(worksheet);

         let count = 0;
         json.forEach((row: any) => {
             // Try to find the content column: 'documentos', 'content', 'text', 'body'
             const content = row['documentos'] || row['content'] || row['text'] || row['body'] || row['Documentos'] || '';
             const title = row['title'] || row['titulo'] || row['filename'] || `Excel_Row_${count+1}`;
             
             if (content && typeof content === 'string' && content.trim().length > 0) {
                 const cleaned = cleanCorpusText(content);
                 onUpload(title, cleaned, DocumentType.TEXT, detectLanguage(cleaned), SourceType.MANUAL_UPLOAD);
                 count++;
             }
         });

         setStatusMessage(`Imported ${count} records from Excel.`);

     } catch (err) {
         console.error(err);
         setStatusMessage('Error parsing Excel.');
     } finally {
         setIsProcessing(false);
         if (excelInputRef.current) excelInputRef.current.value = '';
         setTimeout(() => setStatusMessage(''), 3000);
     }
  };

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

  return (
    <div className="p-6 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
      <div className="flex flex-col items-center justify-center space-y-4">
        <div className="p-4 bg-indigo-100 rounded-full text-indigo-600">
          {isProcessing ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
        </div>
        
        <div className="text-center">
          <h3 className="text-lg font-semibold text-slate-800">{t.importTitle}</h3>
          <p className="text-sm text-slate-500 mt-1">
            {t.importDesc}
          </p>
        </div>

        {isProcessing ? (
          <p className="text-sm font-medium text-indigo-600">{statusMessage}</p>
        ) : (
          <div className="flex flex-wrap justify-center gap-3">
             {/* Single File */}
             <label className="cursor-pointer px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 shadow-sm transition-all flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4" /> File
                <input 
                  ref={fileInputRef}
                  type="file" 
                  className="hidden" 
                  accept=".txt,audio/*,video/*"
                  onChange={handleFileChange}
                />
              </label>
              
              {/* Folder Upload */}
              <label className="cursor-pointer px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 shadow-sm transition-all flex items-center gap-2 text-sm">
                <FolderInput className="w-4 h-4" /> Folder
                <input 
                  ref={folderInputRef}
                  type="file" 
                  className="hidden" 
                  // @ts-ignore - webkitdirectory is non-standard but supported in most modern browsers
                  webkitdirectory="" 
                  directory=""
                  multiple
                  onChange={handleFolderChange}
                />
              </label>

              {/* Excel Upload */}
              <label className="cursor-pointer px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 shadow-sm transition-all flex items-center gap-2 text-sm">
                <FileSpreadsheet className="w-4 h-4" /> Excel
                <input 
                  ref={excelInputRef}
                  type="file" 
                  className="hidden" 
                  accept=".xlsx, .xls, .csv"
                  onChange={handleExcelChange}
                />
              </label>
          </div>
        )}
        
        <div className="flex gap-4 text-xs text-slate-400 mt-4">
          <span className="flex items-center gap-1"><FileText className="w-3 h-3"/> {t.textLabel}</span>
          <span className="flex items-center gap-1"><FileAudio className="w-3 h-3"/> {t.mediaLabel}</span>
          <span className="flex items-center gap-1"><FileSpreadsheet className="w-3 h-3"/> .xlsx</span>
        </div>
      </div>
    </div>
  );
};

export default FileUploader;
