import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { Search, BarChart3, AlignLeft, Hash, HeartPulse, ArrowRight, Filter, BookText } from 'lucide-react';
import { CorpusDocument, KwicResult, SourceType, PosBreakdown } from '../types';
import { calculateFrequencies, calculateTypeTokenRatio, generateKwic } from '../utils/nlp';
import { translations } from '../utils/translations';
import { analyzePosDistribution } from '../services/geminiService';

interface AnalysisViewProps {
  documents: CorpusDocument[];
  uiLang: 'EN' | 'ES';
}

const AnalysisView: React.FC<AnalysisViewProps> = ({ documents, uiLang }) => {
  const [activeTab, setActiveTab] = useState<'stats' | 'kwic' | 'sentiment' | 'grammar'>('stats');
  const [kwicKeyword, setKwicKeyword] = useState('');
  const [kwicResults, setKwicResults] = useState<KwicResult[]>([]);
  const [selectedSource, setSelectedSource] = useState<SourceType | 'ALL'>('ALL');
  
  // Grammar State
  const [isAnalyzingGrammar, setIsAnalyzingGrammar] = useState(false);
  const [posData, setPosData] = useState<PosBreakdown | null>(null);

  const t = translations[uiLang];

  const filteredDocuments = useMemo(() => {
      if (selectedSource === 'ALL') return documents;
      return documents.filter(d => d.sourceType === selectedSource);
  }, [documents, selectedSource]);

  const frequencies = useMemo(() => calculateFrequencies(filteredDocuments), [filteredDocuments]);
  const typeTokenRatio = useMemo(() => calculateTypeTokenRatio(filteredDocuments), [filteredDocuments]);
  const totalTokens = useMemo(() => filteredDocuments.reduce((acc, doc) => acc + doc.tokenCount, 0), [filteredDocuments]);
  const top20 = frequencies.slice(0, 20); // Only for chart

  const sentimentData = useMemo(() => {
    const dist = { Positive: 0, Negative: 0, Neutral: 0 };
    filteredDocuments.forEach(doc => {
        if (doc.sentiment) dist[doc.sentiment.label]++;
    });
    return Object.entries(dist).map(([name, value]) => ({ name, value }));
  }, [filteredDocuments]);

  const documentScores = useMemo(() => {
      return filteredDocuments.map(doc => ({
          name: doc.title.length > 15 ? doc.title.substring(0, 12) + '...' : doc.title,
          score: doc.sentiment ? doc.sentiment.score : 0,
          fullTitle: doc.title,
          label: doc.sentiment ? doc.sentiment.label : 'Neutral'
      }));
  }, [filteredDocuments]);

  const SENTIMENT_COLORS = {
    Positive: '#10b981',
    Neutral: '#94a3b8',
    Negative: '#ef4444'
  };

  const POS_COLORS = ['#4f46e5', '#06b6d4', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#f43f5e', '#94a3b8'];

  const handleSearchKwic = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!kwicKeyword.trim()) return;
    const results = generateKwic(filteredDocuments, kwicKeyword);
    setKwicResults(results);
  };

  const jumpToKwic = (word: string) => {
    setKwicKeyword(word);
    setActiveTab('kwic');
    const results = generateKwic(filteredDocuments, word);
    setKwicResults(results);
  };

  const handleAnalyzeGrammar = async () => {
      if (filteredDocuments.length === 0) return;
      setIsAnalyzingGrammar(true);
      try {
          const combinedText = filteredDocuments.map(d => d.content).join(" ").substring(0, 15000);
          const result = await analyzePosDistribution(combinedText);
          setPosData(result);
      } catch (error) {
          console.error(error);
          alert("Error analyzing grammar.");
      } finally {
          setIsAnalyzingGrammar(false);
      }
  };

  const formatPosChartData = (data: PosBreakdown | null) => {
      if (!data) return [];
      return [
          { name: t.nouns, value: data.nouns },
          { name: t.verbs, value: data.verbs },
          { name: t.adjectives, value: data.adjectives },
          { name: t.adverbs, value: data.adverbs },
          { name: t.pronouns, value: data.pronouns },
          { name: t.determiners, value: data.determiners },
          { name: t.conjunctions, value: data.conjunctions },
          { name: t.others, value: data.others },
      ].filter(item => item.value > 0);
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex space-x-1 bg-slate-100 p-1 rounded-lg overflow-x-auto">
            <button
            onClick={() => setActiveTab('stats')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'stats' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
            >
            <BarChart3 className="w-4 h-4" /> {t.tabStats}
            </button>
            <button
            onClick={() => setActiveTab('kwic')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'kwic' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
            >
            <AlignLeft className="w-4 h-4" /> {t.tabKwic}
            </button>
            <button
            onClick={() => setActiveTab('sentiment')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'sentiment' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
            >
            <HeartPulse className="w-4 h-4" /> {t.tabSentiment}
            </button>
            <button
            onClick={() => setActiveTab('grammar')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 whitespace-nowrap ${
                activeTab === 'grammar' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
            >
            <BookText className="w-4 h-4" /> {t.tabGrammar}
            </button>
        </div>
        
        <div className="flex items-center gap-2 px-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-600 hidden md:inline">{t.filterSource}</span>
            <select 
                value={selectedSource}
                onChange={(e) => { setSelectedSource(e.target.value as SourceType | 'ALL'); setKwicResults([]); }}
                className="text-sm border-none bg-slate-50 focus:ring-0 text-slate-700 font-medium rounded-md cursor-pointer hover:bg-slate-100 py-1"
            >
                <option value="ALL">{t.allSources}</option>
                <option value={SourceType.ACADEMIC}>Academic</option>
                <option value={SourceType.YOUTUBE}>YouTube</option>
                <option value={SourceType.SOCIAL}>Social Media</option>
                <option value={SourceType.CLASSROOM}>Classroom/Tasks</option>
                <option value={SourceType.MANUAL_UPLOAD}>Manual Uploads</option>
            </select>
        </div>
      </div>

      {activeTab === 'stats' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
          <div className="md:col-span-1 space-y-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3 mb-2 text-slate-500">
                <Hash className="w-5 h-5" />
                <span className="text-sm font-medium uppercase tracking-wider">{t.totalTokens}</span>
              </div>
              <p className="text-3xl font-bold text-slate-800">{totalTokens.toLocaleString()}</p>
              <p className="text-xs text-slate-400 mt-1">Filtered: {filteredDocuments.length} docs</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3 mb-2 text-slate-500">
                <BarChart3 className="w-5 h-5" />
                <span className="text-sm font-medium uppercase tracking-wider">{t.ttr}</span>
              </div>
              <p className="text-3xl font-bold text-emerald-600">{typeTokenRatio.toFixed(4)}</p>
              <p className="text-xs text-slate-400 mt-2">{t.ttrDesc}</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm h-96 overflow-hidden flex flex-col">
                <div className="mb-3 flex justify-between items-end">
                    <div>
                        <h4 className="font-semibold text-slate-700">{t.wordList}</h4>
                        <p className="text-xs text-slate-400">{t.wordListDesc}</p>
                    </div>
                    <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">{frequencies.length} words</span>
                </div>
                <div className="overflow-y-auto flex-1 pr-2 custom-scrollbar">
                    {/* UNLIMITED LIST as requested */}
                    <ul className="space-y-1 text-sm">
                        {frequencies.map((f, i) => (
                            <li 
                                key={f.token} 
                                onClick={() => jumpToKwic(f.token)}
                                className="group flex justify-between items-center border-b border-slate-50 last:border-0 py-1.5 cursor-pointer hover:bg-indigo-50 px-2 rounded transition-colors"
                            >
                                <span className="text-slate-600 group-hover:text-indigo-700 font-medium flex items-center gap-2">
                                    <span className="text-xs text-slate-300 w-6">{i+1}</span> {f.token}
                                </span>
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-slate-400 group-hover:text-indigo-500 text-xs">{f.count}</span>
                                    <ArrowRight className="w-3 h-3 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
          </div>

          <div className="md:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
            <h3 className="text-lg font-semibold text-slate-800 mb-6">{t.freqDist}</h3>
            <div className="flex-1 min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top20} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                  <XAxis type="number" />
                  <YAxis dataKey="token" type="category" width={80} tick={{fontSize: 12}} />
                  <Tooltip 
                    cursor={{fill: '#f1f5f9'}}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="count" fill="#4f46e5" radius={[0, 4, 4, 0]}>
                    {top20.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index < 3 ? '#4f46e5' : '#818cf8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'kwic' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-[500px] animate-fade-in">
          <div className="p-4 border-b border-slate-100 flex items-center gap-4">
            <form onSubmit={handleSearchKwic} className="flex-1 flex gap-2">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  value={kwicKeyword}
                  onChange={(e) => setKwicKeyword(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium">
                {t.generateKwic}
              </button>
            </form>
            <div className="text-sm text-slate-500">
                {t.found}: <span className="font-semibold text-indigo-600">{kwicResults.length}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-0">
            {kwicResults.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <AlignLeft className="w-12 h-12 mb-2 opacity-20" />
                <p>{t.enterTerm}</p>
              </div>
            ) : (
              <table className="w-full text-sm border-collapse table-fixed">
                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                  <tr>
                    <th className="p-3 text-right w-[42%] text-slate-500 font-medium">{t.leftContext}</th>
                    <th className="p-3 text-center w-[16%] text-indigo-600 font-bold bg-indigo-50">{t.node}</th>
                    <th className="p-3 text-left w-[42%] text-slate-500 font-medium">{t.rightContext}</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs md:text-sm">
                  {kwicResults.map((res, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 border-b border-slate-100 transition-colors">
                      <td className="p-2 text-right text-slate-600 whitespace-nowrap overflow-hidden" title={res.left}>{res.left}</td>
                      <td className="p-2 text-center text-indigo-700 font-bold bg-indigo-50/50">{res.node}</td>
                      <td className="p-2 text-left text-slate-600 whitespace-nowrap overflow-hidden" title={res.right}>{res.right}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      
      {/* Grammar and Sentiment tabs remain the same as previous correct version */}
      {activeTab === 'grammar' && (
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full animate-fade-in">
              <div className="flex justify-between items-start mb-6">
                  <div>
                      <h3 className="text-lg font-semibold text-slate-800">{t.tabGrammar}</h3>
                      <p className="text-sm text-slate-500">{t.grammarDesc}</p>
                  </div>
                  <button 
                    onClick={handleAnalyzeGrammar}
                    disabled={isAnalyzingGrammar || filteredDocuments.length === 0}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                      {isAnalyzingGrammar ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <BookText className="w-4 h-4" />}
                      {t.analyzeGrammar}
                  </button>
              </div>

              <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                  <div className="h-[300px] w-full">
                      {posData ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={formatPosChartData(posData)}
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={100}
                                    innerRadius={60}
                                    paddingAngle={2}
                                    dataKey="value"
                                >
                                    {formatPosChartData(posData).map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={POS_COLORS[index % POS_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend layout="vertical" verticalAlign="middle" align="right" />
                            </PieChart>
                        </ResponsiveContainer>
                      ) : (
                          <div className="h-full flex items-center justify-center bg-slate-50 rounded-xl text-slate-400 border border-dashed border-slate-200">
                              <p>{t.waiting}</p>
                          </div>
                      )}
                  </div>
                  <div>
                      {posData ? (
                          <div className="bg-slate-50 rounded-xl overflow-hidden border border-slate-100">
                              <table className="w-full text-sm">
                                  <thead className="bg-slate-100">
                                      <tr>
                                          <th className="p-3 text-left font-medium text-slate-600">Category</th>
                                          <th className="p-3 text-right font-medium text-slate-600">%</th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                      {formatPosChartData(posData).map((row, idx) => (
                                          <tr key={idx} className="hover:bg-slate-100">
                                              <td className="p-3 flex items-center gap-2">
                                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: POS_COLORS[idx % POS_COLORS.length] }}></div>
                                                  {row.name}
                                              </td>
                                              <td className="p-3 text-right font-mono font-semibold text-slate-700">{row.value}%</td>
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      ) : (
                          <div className="space-y-4 opacity-30">
                              <div className="h-8 bg-slate-200 rounded w-full"></div>
                              <div className="h-8 bg-slate-200 rounded w-3/4"></div>
                              <div className="h-8 bg-slate-200 rounded w-5/6"></div>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'sentiment' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">{t.corpusSentiment}</h3>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={sentimentData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={100}
                                paddingAngle={5}
                                dataKey="value"
                            >
                                {sentimentData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={SENTIMENT_COLORS[entry.name as keyof typeof SENTIMENT_COLORS]} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                 <h3 className="text-lg font-semibold text-slate-800 mb-2">{t.docScores}</h3>
                 <div className="h-[300px] w-full">
                    {documentScores.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={documentScores} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                                <XAxis dataKey="name" hide />
                                <YAxis domain={[-1, 1]} />
                                <Tooltip 
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const data = payload[0].payload;
                                            return (
                                                <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-sm">
                                                    <p className="font-bold text-slate-800">{data.fullTitle}</p>
                                                    <p className="text-slate-600">{t.score}: <span className="font-mono font-bold">{data.score}</span></p>
                                                    <p className="text-slate-500 capitalize">{t.label}: {data.label}</p>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Bar dataKey="score">
                                    {documentScores.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.score >= 0 ? SENTIMENT_COLORS.Positive : SENTIMENT_COLORS.Negative} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-400">No documents loaded</div>
                    )}
                 </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default AnalysisView;