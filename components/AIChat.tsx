
import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import { ChatMessage, CorpusDocument } from '../types';
import { askCorpusQuestion } from '../services/geminiService';
import { translations } from '../utils/translations';

interface AIChatProps {
  documents: CorpusDocument[];
  uiLang: 'EN' | 'ES';
}

const AIChat: React.FC<AIChatProps> = ({ documents, uiLang }) => {
  const t = translations[uiLang];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  // Initialize welcome message when lang changes or on mount
  useEffect(() => {
    if (messages.length === 0) {
        setMessages([{ role: 'model', content: t.chatIntro, timestamp: Date.now() }]);
    }
  }, [t.chatIntro]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: input, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Gather content for context
      const contextDocs = documents.map(d => `[Document: ${d.title}]\n${d.content}`);
      // Pass the current UI Language so the model knows preferred output language if ambiguous
      const answer = await askCorpusQuestion(userMsg.content, contextDocs);
      
      const botMsg: ChatMessage = { role: 'model', content: answer, timestamp: Date.now() };
      setMessages(prev => [...prev, botMsg]);
    } catch (error) {
        console.error(error);
      const errorMsg: ChatMessage = { role: 'model', content: t.errorAI, timestamp: Date.now() };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-white flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-indigo-500" />
        <h3 className="font-semibold text-slate-800">{t.chatTitle}</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${msg.role === 'user' ? 'bg-slate-700 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed ${
              msg.role === 'user' 
                ? 'bg-slate-700 text-white rounded-tr-sm' 
                : 'bg-slate-100 text-slate-800 rounded-tl-sm'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3">
             <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-slate-50 p-3 rounded-2xl rounded-tl-sm text-slate-400 text-sm italic flex items-center gap-2">
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-100"></span>
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-200"></span>
              {t.thinking}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-slate-100">
        <form onSubmit={handleSend} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.inputPlaceholder}
            className="w-full pl-4 pr-12 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
            disabled={isLoading}
          />
          <button 
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default AIChat;
