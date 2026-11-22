import React from 'react';
import { NewsSentimentRadarData } from '../types';
import { Radio, TrendingUp, TrendingDown } from 'lucide-react';

interface NewsSentimentRadarPillProps {
  radarData: NewsSentimentRadarData | null;
  isLoading: boolean;
  onOpenModal: () => void;
}

export const NewsSentimentRadarPill: React.FC<NewsSentimentRadarPillProps> = ({
  radarData,
  onOpenModal,
}) => {
  const data = radarData || {
    bullishScore: 72,
    bearishScore: 28,
    aggregateScore: 44,
    overallSentiment: 'BULLISH' as const,
  };

  const isBull = data.overallSentiment === 'BULLISH';
  const isBear = data.overallSentiment === 'BEARISH';

  return (
    <button
      type="button"
      onClick={onOpenModal}
      className={`btn-delta-sm font-mono-numbers shrink-0 max-w-full ${
        isBull
          ? 'bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-emerald-300'
          : isBear
          ? 'btn-danger'
          : 'btn-secondary'
      }`}
      title="Live News Sentiment Radar · Click to inspect crypto headlines and AI sentiment breakdown"
    >
      <div className="flex items-center gap-1">
        <Radio
          className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${
            isBull ? 'text-emerald-400' : isBear ? 'text-rose-400' : 'text-cyan-400'
          }`}
        />
        <span className="text-[11px] font-medium text-slate-300 hidden lg:inline">
          Sentiment
        </span>
      </div>

      <span className="text-slate-600 hidden lg:inline">·</span>

      <div className="flex items-center gap-1 whitespace-nowrap">
        {isBull ? (
          <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />
        ) : isBear ? (
          <TrendingDown className="w-3 h-3 text-rose-400 shrink-0" />
        ) : null}

        <span className="font-semibold">
          {isBull ? `${data.bullishScore}% Bull` : isBear ? `${data.bearishScore}% Bear` : 'Neutral'}
        </span>

        <span className="text-[10px] text-slate-400 hidden sm:inline">
          ({data.aggregateScore >= 0 ? '+' : ''}{data.aggregateScore})
        </span>
      </div>
    </button>
  );
};

