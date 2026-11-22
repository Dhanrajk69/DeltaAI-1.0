import React, { useState, useMemo } from 'react';
import { ClosedTrade, TradeSentimentTag } from '../types';
import { usePortfolio } from '../context/PortfolioContext';
import {
  BookOpen,
  Tag,
  Smile,
  Frown,
  CheckCircle,
  AlertTriangle,
  Flame,
  Save,
  Search,
  Filter,
  Calendar,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Award,
  Zap,
  Clock,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Edit3,
  X,
  FileText
} from 'lucide-react';

interface TradeJournalProps {
  history?: ClosedTrade[];
  currencyPrefix?: string;
  exchangeRate?: number;
  isOpenModal?: boolean;
  onCloseModal?: () => void;
}

const AVAILABLE_SENTIMENT_TAGS: {
  tag: TradeSentimentTag;
  label: string;
  color: string;
  bg: string;
  border: string;
  description: string;
}[] = [
  {
    tag: 'DISCIPLINED',
    label: 'Disciplined',
    color: 'text-emerald-400',
    bg: 'bg-emerald-950/40',
    border: 'border-emerald-500/50',
    description: 'Executed strictly according to strategy plan & risk parameters',
  },
  {
    tag: 'SYSTEM_PLAY',
    label: 'System Play',
    color: 'text-cyan-400',
    bg: 'bg-cyan-950/40',
    border: 'border-cyan-500/50',
    description: 'Triggered by AI Command / Trading Intelligence signal',
  },
  {
    tag: 'PERFECT_EXECUTION',
    label: 'Perfect Execution',
    color: 'text-amber-300',
    bg: 'bg-amber-950/40',
    border: 'border-amber-500/50',
    description: 'Flawless entry timing, scale-outs, and profit target completion',
  },
  {
    tag: 'EARLY_EXIT',
    label: 'Early Exit',
    color: 'text-amber-400',
    bg: 'bg-amber-950/30',
    border: 'border-amber-600/40',
    description: 'Closed prematurely before structural target due to impatience',
  },
  {
    tag: 'FOMO',
    label: 'FOMO Entry',
    color: 'text-rose-400',
    bg: 'bg-rose-950/40',
    border: 'border-rose-500/50',
    description: 'Chased an extended price move without waiting for pullback',
  },
  {
    tag: 'REVENGE',
    label: 'Revenge Trade',
    color: 'text-red-500',
    bg: 'bg-red-950/50',
    border: 'border-red-600/60',
    description: 'Emotional re-entry attempting to recover from previous loss',
  },
  {
    tag: 'CHOPPY_EXIT',
    label: 'Choppy Invalidation',
    color: 'text-slate-400',
    bg: 'bg-slate-900',
    border: 'border-slate-700',
    description: 'Exited due to regime change into sideways compression',
  },
  {
    tag: 'BULLISH',
    label: 'Bullish Continuation',
    color: 'text-emerald-300',
    bg: 'bg-emerald-950/30',
    border: 'border-emerald-700/40',
    description: 'High-conviction trend follower on upper momentum',
  },
  {
    tag: 'BEARISH',
    label: 'Bearish Breakdown',
    color: 'text-rose-300',
    bg: 'bg-rose-950/30',
    border: 'border-rose-700/40',
    description: 'Short breakdown or rejection at resistance',
  },
];

const COMMON_TAGS = [
  '#camarilla_h4',
  '#cpr_narrow',
  '#vwap_bounce',
  '#ema_crossover',
  '#short_squeeze',
  '#liquidity_sweep',
  '#tp1_scalp',
  '#trailing_stop',
  '#news_volatility',
  '#options_hedge',
];

export const TradeJournal: React.FC<TradeJournalProps> = ({
  history: propHistory,
  currencyPrefix = '$',
  exchangeRate = 1,
  isOpenModal = false,
  onCloseModal,
}) => {
  const { history: contextHistory, updateTradeJournal, tradeJournalMap } = usePortfolio();
  const history = propHistory && propHistory.length > 0 ? propHistory : contextHistory;

  // Selected trade for editing/viewing
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(() => {
    return history.length > 0 ? history[0].id : null;
  });

  // Filter and search state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSentiment, setFilterSentiment] = useState<string>('ALL');
  const [filterPnl, setFilterPnl] = useState<'ALL' | 'WINS' | 'LOSSES'>('ALL');

  // Edit form state
  const [editNotes, setEditNotes] = useState('');
  const [editSentiment, setEditSentiment] = useState<TradeSentimentTag | undefined>(undefined);
  const [editLessons, setEditLessons] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Active selected trade object (merging journal metadata)
  const activeTrade = useMemo(() => {
    if (!selectedTradeId) return history[0] || null;
    const base = history.find((t) => t.id === selectedTradeId);
    if (!base) return history[0] || null;
    const journal = tradeJournalMap[base.id];
    return {
      ...base,
      notes: journal?.notes ?? base.notes,
      sentimentTag: journal?.sentimentTag ?? base.sentimentTag,
      tags: journal?.tags ?? base.tags,
      lessonLearned: journal?.lessonLearned ?? base.lessonLearned,
      journalUpdatedAt: journal?.journalUpdatedAt ?? base.journalUpdatedAt,
    };
  }, [selectedTradeId, history, tradeJournalMap]);

  // Sync form inputs when activeTrade changes
  React.useEffect(() => {
    if (activeTrade) {
      setEditNotes(activeTrade.notes || '');
      setEditSentiment(activeTrade.sentimentTag);
      setEditLessons(activeTrade.lessonLearned || '');
      setEditTags(activeTrade.tags || []);
      setSaveSuccess(false);
    }
  }, [activeTrade?.id]);

  // Filtered trade list
  const filteredTrades = useMemo(() => {
    return history
      .filter((t) => {
        const journal = tradeJournalMap[t.id];
        const notes = journal?.notes ?? t.notes ?? '';
        const sentiment = journal?.sentimentTag ?? t.sentimentTag;
        const tags = (journal?.tags ?? t.tags ?? []).join(' ');

        // Search query
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchSym = t.symbol.toLowerCase().includes(q);
          const matchNotes = notes.toLowerCase().includes(q);
          const matchTags = tags.toLowerCase().includes(q);
          if (!matchSym && !matchNotes && !matchTags) return false;
        }

        // PnL Filter
        if (filterPnl === 'WINS' && t.realisedPnl <= 0) return false;
        if (filterPnl === 'LOSSES' && t.realisedPnl >= 0) return false;

        // Sentiment Filter
        if (filterSentiment !== 'ALL' && sentiment !== filterSentiment) {
          if (filterSentiment === 'UNTAGGED' && sentiment) return false;
          if (filterSentiment !== 'UNTAGGED') return false;
        }

        return true;
      })
      .sort((a, b) => b.closedAt - a.closedAt);
  }, [history, tradeJournalMap, searchQuery, filterPnl, filterSentiment]);

  // Overall Journal Metrics
  const journalStats = useMemo(() => {
    const total = history.length;
    let journaledCount = 0;
    let disciplinedCount = 0;
    let fomoRevengeCount = 0;

    history.forEach((t) => {
      const j = tradeJournalMap[t.id];
      const hasNotes = Boolean(j?.notes || t.notes);
      const sentiment = j?.sentimentTag || t.sentimentTag;
      if (hasNotes || sentiment) {
        journaledCount++;
      }
      if (sentiment === 'DISCIPLINED' || sentiment === 'SYSTEM_PLAY' || sentiment === 'PERFECT_EXECUTION') {
        disciplinedCount++;
      } else if (sentiment === 'FOMO' || sentiment === 'REVENGE') {
        fomoRevengeCount++;
      }
    });

    const journaledPct = total > 0 ? Math.round((journaledCount / total) * 100) : 0;
    const disciplineScore = journaledCount > 0 ? Math.round((disciplinedCount / journaledCount) * 100) : 100;

    return {
      total,
      journaledCount,
      journaledPct,
      disciplinedCount,
      fomoRevengeCount,
      disciplineScore,
    };
  }, [history, tradeJournalMap]);

  const handleSaveJournal = () => {
    if (!activeTrade) return;

    updateTradeJournal(activeTrade.id, {
      notes: editNotes.trim(),
      sentimentTag: editSentiment,
      tags: editTags,
      lessonLearned: editLessons.trim(),
    });

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleAddTag = (tagToAdd: string) => {
    const clean = tagToAdd.trim().startsWith('#') ? tagToAdd.trim() : `#${tagToAdd.trim()}`;
    if (!editTags.includes(clean)) {
      setEditTags([...editTags, clean]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setEditTags(editTags.filter((t) => t !== tagToRemove));
  };

  const content = (
    <div className="space-y-4 font-sans text-slate-100">
      {/* 1. Header & KPI strip */}
      <div className="panel-delta p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="panel-delta-title text-white">
                  TRADE JOURNAL &amp; POST-TRADE PSYCHOLOGY
                </h1>
                <span className="badge-delta badge-delta-armed font-mono">
                  {journalStats.journaledCount} / {journalStats.total} LOGGED
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Attach retrospective notes, execution tags, and behavioral psychology insights to closed trades.
              </p>
            </div>
          </div>

          {onCloseModal && (
            <button
              type="button"
              onClick={onCloseModal}
              className="btn-delta-sm btn-secondary w-8 px-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 4 Mini Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3 font-mono">
          <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Journaled Depth</span>
            <div className="text-base font-bold text-white mt-0.5">
              {journalStats.journaledPct}%
            </div>
            <div className="text-[10px] text-slate-400">
              {journalStats.journaledCount} of {journalStats.total} closed
            </div>
          </div>

          <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Discipline Index</span>
            <div className="text-base font-bold text-emerald-400 mt-0.5">
              {journalStats.disciplineScore}%
            </div>
            <div className="text-[10px] text-slate-400">
              {journalStats.disciplinedCount} disciplined executions
            </div>
          </div>

          <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Emotional Deviations</span>
            <div className={`text-base font-bold mt-0.5 ${
              journalStats.fomoRevengeCount === 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {journalStats.fomoRevengeCount}
            </div>
            <div className="text-[10px] text-slate-400">FOMO / Revenge flags</div>
          </div>

          <div className="p-2.5 rounded bg-slate-950/80 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase font-semibold">Storage Engine</span>
            <div className="text-base font-bold text-cyan-300 mt-0.5">Unified Context</div>
            <div className="text-[10px] text-slate-400">Persistent Delta Cache</div>
          </div>
        </div>
      </div>

      {/* 2. Main Two-Column Master / Detail Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Trade Selector & Filters (5 cols) */}
        <div className="lg:col-span-5 panel-delta p-3 space-y-3 flex flex-col max-h-[640px]">
          {/* Search & Filter Controls */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search symbol, notes, or #tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-8 pr-3 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              {/* PnL Filter */}
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setFilterPnl('ALL')}
                  className={`btn-delta-sm ${
                    filterPnl === 'ALL' ? 'btn-toggle-active' : 'btn-secondary'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setFilterPnl('WINS')}
                  className={`btn-delta-sm ${
                    filterPnl === 'WINS' ? 'btn-toggle-active' : 'btn-secondary'
                  }`}
                >
                  Wins
                </button>
                <button
                  type="button"
                  onClick={() => setFilterPnl('LOSSES')}
                  className={`btn-delta-sm ${
                    filterPnl === 'LOSSES' ? 'btn-danger' : 'btn-secondary'
                  }`}
                >
                  Losses
                </button>
              </div>

              {/* Sentiment dropdown */}
              <select
                value={filterSentiment}
                onChange={(e) => setFilterSentiment(e.target.value)}
                className="h-7 bg-slate-950 border border-slate-800 rounded-lg px-2 text-[11px] text-slate-300 focus:outline-none focus:border-cyan-500"
              >
                <option value="ALL">All Sentiments</option>
                <option value="UNTAGGED">Untagged</option>
                {AVAILABLE_SENTIMENT_TAGS.map((s) => (
                  <option key={s.tag} value={s.tag}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Trade List Scroll Container */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
            {filteredTrades.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded">
                No closed trades match filter. Execute trades or adjust filter criteria.
              </div>
            ) : (
              filteredTrades.map((trade) => {
                const isSelected = activeTrade?.id === trade.id;
                const journal = tradeJournalMap[trade.id];
                const sentiment = journal?.sentimentTag ?? trade.sentimentTag;
                const tagObj = AVAILABLE_SENTIMENT_TAGS.find((s) => s.tag === sentiment);
                const isWin = trade.realisedPnl >= 0;
                const dateStr = new Date(trade.closedAt).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                });
                const timeStr = new Date(trade.closedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={trade.id}
                    onClick={() => setSelectedTradeId(trade.id)}
                    className={`p-2.5 rounded-lg border transition cursor-pointer flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-slate-900 border-cyan-500/80 shadow-sm'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          trade.side === 'LONG'
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/60'
                            : 'bg-rose-950/80 text-rose-300 border border-rose-600/60'
                        }`}>
                          {trade.side}
                        </span>
                        <span className="font-bold text-white text-xs">{trade.symbol}</span>
                        <span className="text-[10px] text-slate-500">
                          {dateStr} {timeStr}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        <span>{trade.size} Lots</span>
                        <span>•</span>
                        <span>Entry: ${trade.entryPrice.toLocaleString()}</span>
                        <span>•</span>
                        <span>Exit: ${trade.exitPrice.toLocaleString()}</span>
                      </div>

                      {/* Display tag or journal pill if available */}
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        {tagObj ? (
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${tagObj.bg} ${tagObj.border} ${tagObj.color}`}>
                            {tagObj.label}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded text-[9px] text-slate-500 bg-slate-900 border border-slate-800">
                            No Tag
                          </span>
                        )}
                        {(journal?.notes || trade.notes) && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] text-cyan-300 bg-cyan-950/40 border border-cyan-700/50 flex items-center gap-0.5">
                            <FileText className="w-2.5 h-2.5" />
                            <span>Notes Logged</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={`font-bold text-xs ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isWin ? '+' : ''}
                        {currencyPrefix}
                        {(trade.realisedPnl * exchangeRate).toFixed(2)}
                      </div>
                      <div className={`text-[10px] ${isWin ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500 ml-auto mt-1" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Trade Editor (7 cols) */}
        <div className="lg:col-span-7 panel-delta p-4 space-y-4">
          {activeTrade ? (
            <>
              {/* Trade Summary Banner */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`badge-delta ${
                    activeTrade.side === 'LONG' ? 'badge-delta-live' : 'badge-delta-danger'
                  }`}>
                    {activeTrade.side}
                  </span>
                  <span className="text-base font-extrabold text-white">{activeTrade.symbol}</span>
                  <span className="text-[11px] text-slate-400">
                    ID: {activeTrade.id.slice(0, 10)}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase">Realized P&L</span>
                    <div className={`text-sm font-extrabold ${
                      activeTrade.realisedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {activeTrade.realisedPnl >= 0 ? '+' : ''}
                      {currencyPrefix}
                      {(activeTrade.realisedPnl * exchangeRate).toFixed(2)} ({activeTrade.pnlPercent >= 0 ? '+' : ''}{activeTrade.pnlPercent.toFixed(2)}%)
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 uppercase">Exit Reason</span>
                    <div className="text-xs font-semibold text-slate-300 truncate max-w-[140px]" title={activeTrade.reason}>
                      {activeTrade.reason || 'Manual / Target'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 1. Sentiment Tag Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Smile className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Execution Psychology & Sentiment Tag</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {AVAILABLE_SENTIMENT_TAGS.map((s) => {
                    const isSelected = editSentiment === s.tag;
                    return (
                      <button
                        key={s.tag}
                        type="button"
                        onClick={() => setEditSentiment(isSelected ? undefined : s.tag)}
                        className={`p-2 rounded border text-left transition cursor-pointer ${
                          isSelected
                            ? `${s.bg} ${s.border} ${s.color} ring-1 ring-cyan-400 shadow-sm font-bold`
                            : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                        }`}
                        title={s.description}
                      >
                        <div className="text-xs flex items-center justify-between">
                          <span>{s.label}</span>
                          {isSelected && <CheckCircle className="w-3 h-3 text-cyan-300 shrink-0" />}
                        </div>
                        <div className="text-[9px] text-slate-500 truncate mt-0.5">
                          {s.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Trade Reflection & Post-Mortem Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Post-Trade Reflection & Tactical Notes</span>
                </label>
                <textarea
                  rows={4}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Record your execution thought process: Why was this entry taken? Was risk kept strictly under 0.50%? Did you hold for full TP1/TP2 or exit early?"
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                />
              </div>

              {/* 3. Lessons Learned / Rule Reaffirmation */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-amber-400" />
                  <span>Key Rule or Discipline Lesson Learned</span>
                </label>
                <input
                  type="text"
                  value={editLessons}
                  onChange={(e) => setEditLessons(e.target.value)}
                  placeholder="e.g. Always verify 5m CPR width before market breakout orders."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-400 font-sans"
                />
              </div>

              {/* 4. Categorical Tags */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Setup & Strategy Tags</span>
                </label>

                {/* Selected Tag Pills */}
                <div className="flex flex-wrap gap-1.5 min-h-[26px]">
                  {editTags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-700/60 text-cyan-300 text-xs font-mono"
                    >
                      <span>{t}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t)}
                        className="hover:text-rose-400 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>

                {/* Quick Add Common Tags */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {COMMON_TAGS.map((t) => {
                    const exists = editTags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => (exists ? handleRemoveTag(t) : handleAddTag(t))}
                        className={`btn-delta-sm font-mono ${
                          exists ? 'btn-toggle-active' : 'btn-secondary'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>

                {/* Custom tag input */}
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (tagInput.trim()) handleAddTag(tagInput);
                      }
                    }}
                    placeholder="Type custom #tag and press Enter..."
                    className="flex-1 h-9 px-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (tagInput.trim()) handleAddTag(tagInput);
                    }}
                    className="btn-delta btn-secondary"
                  >
                    Add Tag
                  </button>
                </div>
              </div>

              {/* Save Button & Status Banner */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3">
                {saveSuccess ? (
                  <div className="text-xs text-emerald-400 font-bold flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>Journal Metadata Saved to Portfolio Context &amp; Local Storage</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    Changes persist across platform sessions.
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSaveJournal}
                  className="btn-delta btn-primary uppercase tracking-wider"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Journal Entry</span>
                </button>
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-slate-500">
              Select a closed trade from the left column to view or attach journal metadata.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (isOpenModal) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
        <div className="panel-delta max-w-5xl w-full max-h-[92vh] overflow-y-auto p-4 sm:p-5 shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  return content;
};
