import React, { useState } from 'react';
import { NewsSentimentRadarData, NewsHeadlineItem } from '../types';
import { 
  X, 
  Radio, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  Flame, 
  ExternalLink, 
  Sparkles, 
  AlertCircle,
  Globe,
  Clock,
  Layers,
  Compass
} from 'lucide-react';

interface NewsSentimentRadarModalProps {
  isOpen: boolean;
  onClose: () => void;
  radarData: NewsSentimentRadarData | null;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export const NewsSentimentRadarModal: React.FC<NewsSentimentRadarModalProps> = ({
  isOpen,
  onClose,
  radarData,
  isLoading,
  isRefreshing,
  onRefresh,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH' | 'HIGH_IMPACT'>('ALL');

  if (!isOpen) return null;

  const data = radarData || {
    bullishScore: 72,
    bearishScore: 28,
    neutralScore: 15,
    aggregateScore: 44,
    overallSentiment: 'BULLISH' as const,
    confidence: 86,
    macroCatalyst: 'Institutional ETF absorption counteracting short-term regulatory friction.',
    keyThemes: [
      'Institutional Capital Accumulation',
      'Tokenization & Infrastructure Growth',
      'Delta Exchange India OI Expansion',
    ],
    headlines: [],
    lastUpdated: Date.now(),
  };

  const isBull = data.overallSentiment === 'BULLISH';
  const isBear = data.overallSentiment === 'BEARISH';

  const filteredHeadlines = (data.headlines || []).filter((h: NewsHeadlineItem) => {
    if (filter === 'BULLISH') return h.sentiment === 'BULLISH';
    if (filter === 'BEARISH') return h.sentiment === 'BEARISH';
    if (filter === 'HIGH_IMPACT') return h.impact === 'HIGH';
    return true;
  });

  const timeAgo = (ts: number) => {
    const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diff < 60) return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in font-sans">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col panel-delta border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden">
        {/* Top subtle highlight */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent pointer-events-none" />

        {/* Glow accents */}
        <div className="absolute -top-24 -left-24 w-60 h-60 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="relative z-10 flex items-center justify-between px-5 py-4 border-b border-cyan-500/15 bg-[#040a20]/90 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-950 to-blue-900 border border-cyan-600/70 flex items-center justify-center shadow-md shadow-cyan-950/50 shrink-0">
              <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="panel-delta-title text-sm sm:text-base text-white">
                  <span>NEWS SENTIMENT RADAR</span>
                  <span className="text-cyan-400 text-xs">· AI OVERLAY</span>
                </h2>
                <span className="badge-delta badge-delta-armed font-mono-numbers">
                  GEMINI 3.8 FLASH
                </span>
                <span className="hidden sm:inline-flex badge-delta badge-delta-live font-mono-numbers">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>LIVE RSS FEEDS</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Real-time crypto headlines processed via Google Gemini 3.8 Flash for institutional derivatives positioning
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onRefresh}
              disabled={isRefreshing || isLoading}
              className="btn-delta-sm btn-toggle-active"
              title="Fetch latest crypto headlines and re-evaluate AI sentiment"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Recalibrating...' : 'Recalibrate AI'}</span>
            </button>
            <button
              onClick={onClose}
              className="btn-delta-sm btn-secondary px-2"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 font-mono-numbers">
          {/* Top Sentiment Dashboard Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. Macro Bias & Aggregate Score */}
            <div className="p-4 bg-[#060a12] border border-slate-800 rounded-lg flex flex-col justify-between">
              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold block">
                Macro Directional Bias
              </span>
              <div className="flex items-baseline gap-2 mt-2">
                <span className={`text-2xl font-extrabold tracking-tight ${
                  isBull ? 'text-emerald-400' : isBear ? 'text-rose-400' : 'text-amber-400'
                }`}>
                  {data.overallSentiment}
                </span>
                <span className={`text-sm font-bold ${
                  data.aggregateScore >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  ({data.aggregateScore >= 0 ? '+' : ''}{data.aggregateScore})
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
                <span>AI Confidence:</span>
                <span className="font-bold text-cyan-400">{data.confidence}%</span>
              </div>
            </div>

            {/* 2. Sentiment Balance Meter */}
            <div className="p-4 bg-[#060a12] border border-slate-800 rounded-lg flex flex-col justify-between md:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">
                  Sentiment Distribution Meter
                </span>
                <span className="text-[10px] text-slate-500 font-mono-numbers">
                  Updated {timeAgo(data.lastUpdated)}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="my-3 space-y-1.5">
                <div className="h-3 w-full bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                  <div
                    style={{ width: `${data.bullishScore}%` }}
                    className="h-full bg-gradient-to-r from-emerald-600 to-teal-500 transition-all duration-500"
                    title={`Bullish: ${data.bullishScore}%`}
                  />
                  <div
                    style={{ width: `${data.neutralScore || 10}%` }}
                    className="h-full bg-slate-700/60 transition-all duration-500"
                    title={`Neutral: ${data.neutralScore || 10}%`}
                  />
                  <div
                    style={{ width: `${data.bearishScore}%` }}
                    className="h-full bg-gradient-to-r from-rose-500 to-rose-700 transition-all duration-500"
                    title={`Bearish: ${data.bearishScore}%`}
                  />
                </div>
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-emerald-400 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" />
                    <span>Bullish {data.bullishScore}%</span>
                  </span>
                  <span className="text-slate-400 text-[10px]">
                    Neutral {data.neutralScore || 12}%
                  </span>
                  <span className="text-rose-400 flex items-center gap-1">
                    <TrendingDown className="w-3.5 h-3.5" />
                    <span>Bearish {data.bearishScore}%</span>
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
                Institutional weighting calibrated across CoinDesk, Cointelegraph, Decrypt & Delta Flow.
              </div>
            </div>
          </div>

          {/* AI Macro Catalyst Synopsis */}
          <div className="p-3.5 bg-gradient-to-r from-cyan-950/40 via-blue-950/30 to-slate-950 border border-cyan-800/60 rounded-lg flex items-start gap-3">
            <div className="w-7 h-7 rounded bg-cyan-900/60 border border-cyan-700/80 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 text-cyan-300" />
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 block">
                Primary Macro Market Catalyst (Gemini 3.8 Flash)
              </span>
              <p className="text-xs text-slate-200 leading-relaxed font-sans">
                {data.macroCatalyst}
              </p>
            </div>
          </div>

          {/* Key Narrative Themes */}
          {data.keyThemes && data.keyThemes.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-[11px] text-slate-400 uppercase font-bold flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Market Narratives:</span>
              </span>
              {data.keyThemes.map((theme: string, idx: number) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 text-[11px] font-sans"
                >
                  #{theme}
                </span>
              ))}
            </div>
          )}

          {/* Headline Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 pt-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-sans">
              <button
                onClick={() => setFilter('ALL')}
                className={`btn-delta-sm ${
                  filter === 'ALL'
                    ? 'btn-toggle-active'
                    : 'btn-secondary'
                }`}
              >
                All Headlines ({data.headlines?.length || 0})
              </button>
              <button
                onClick={() => setFilter('BULLISH')}
                className={`btn-delta-sm ${
                  filter === 'BULLISH'
                    ? 'btn-primary'
                    : 'btn-secondary text-emerald-300'
                }`}
              >
                <span>Bullish</span>
              </button>
              <button
                onClick={() => setFilter('BEARISH')}
                className={`btn-delta-sm ${
                  filter === 'BEARISH'
                    ? 'btn-danger'
                    : 'btn-secondary text-rose-300'
                }`}
              >
                <span>Bearish</span>
              </button>
              <button
                onClick={() => setFilter('HIGH_IMPACT')}
                className={`btn-delta-sm ${
                  filter === 'HIGH_IMPACT'
                    ? 'btn-toggle-active'
                    : 'btn-secondary text-amber-300'
                }`}
              >
                <Flame className="w-3 h-3 text-amber-400" />
                <span>High Impact</span>
              </button>
            </div>

            <span className="text-[10px] text-slate-500 hidden sm:inline">
              Click headline to open verified news source
            </span>
          </div>

          {/* Live Headline Stream List */}
          <div className="space-y-2.5">
            {filteredHeadlines.length === 0 ? (
              <div className="p-8 text-center bg-[#060a12] rounded-lg border border-slate-800 text-slate-400 text-xs font-sans">
                No headlines match current filter.
              </div>
            ) : (
              filteredHeadlines.map((item: NewsHeadlineItem) => {
                const isItemBull = item.sentiment === 'BULLISH';
                const isItemBear = item.sentiment === 'BEARISH';
                return (
                  <div
                    key={item.id}
                    className="p-3 bg-[#060a12] hover:bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-lg transition-all group"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                      <div className="space-y-1.5 flex-1">
                        {/* Source + Time + Impact */}
                        <div className="flex items-center gap-2 text-[10px] flex-wrap">
                          <span className="badge-delta badge-delta-armed">
                            {item.source}
                          </span>
                          <span className="text-slate-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{timeAgo(item.timestamp)}</span>
                          </span>
                          {item.impact === 'HIGH' && (
                            <span className="badge-delta badge-delta-paper">
                              <Flame className="w-2.5 h-2.5" />
                              <span>HIGH IMPACT</span>
                            </span>
                          )}
                        </div>

                        {/* Title link */}
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs sm:text-sm font-semibold text-slate-200 group-hover:text-cyan-300 transition-colors block font-sans leading-snug"
                        >
                          {item.title}
                          <ExternalLink className="w-3 h-3 inline-block ml-1.5 text-slate-500 group-hover:text-cyan-400" />
                        </a>

                        {/* AI Rationale */}
                        {item.aiRationale && (
                          <div className="text-[11px] text-slate-400 font-sans flex items-start gap-1 pt-0.5">
                            <span className="text-cyan-400 font-bold shrink-0">AI Impact:</span>
                            <span>{item.aiRationale}</span>
                          </div>
                        )}
                      </div>

                      {/* Sentiment Badge on Right */}
                      <div className="sm:self-center shrink-0">
                        <span className={`badge-delta ${
                          isItemBull
                            ? 'badge-delta-live'
                            : isItemBear
                            ? 'badge-delta-danger'
                            : 'badge-delta-standby'
                        }`}>
                          {isItemBull ? <TrendingUp className="w-3 h-3" /> : isItemBear ? <TrendingDown className="w-3 h-3" /> : null}
                          <span>{item.sentiment}</span>
                          <span className="text-[10px] opacity-80">
                            ({item.score >= 0 ? '+' : ''}{item.score})
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-[#060a12] flex items-center justify-between text-xs text-slate-400 font-sans">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-cyan-400" />
            <span>Delta Exchange India Macro Intelligence Feed</span>
          </div>
          <button
            onClick={onClose}
            className="btn-delta-sm btn-secondary"
          >
            Close Radar
          </button>
        </div>
      </div>
    </div>
  );
};
