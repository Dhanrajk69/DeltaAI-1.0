import React, { useState } from 'react';
import { ArrowUpRight, ArrowDownRight, MoveRight, TrendingUp, TrendingDown, Activity, Info } from 'lucide-react';
import { MaSlopeData } from '../types';

interface MaSlopeTrendIndicatorProps {
  slopeData: MaSlopeData;
  symbol?: string;
  signalSide?: 'LONG' | 'SHORT';
  compact?: boolean;
  className?: string;
}

export const MaSlopeTrendIndicator: React.FC<MaSlopeTrendIndicatorProps> = ({
  slopeData,
  symbol,
  signalSide,
  compact = false,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState<boolean>(false);

  const activeSymbol = symbol || slopeData.symbol || 'BTCUSDT';
  const { direction, slopeFormatted, slopePct, angleDeg, currentMa, prevMa, signalAlignment, contextNote, isLoading } = slopeData;

  // Visual style definitions
  const theme = direction === 'UP'
    ? {
        border: 'border-emerald-500/40',
        bg: 'bg-emerald-950/60',
        text: 'text-emerald-400',
        glow: 'shadow-[0_0_10px_rgba(16,185,129,0.25)]',
        label: 'BULLISH',
        arrowIcon: ArrowUpRight,
        trendIcon: TrendingUp,
      }
    : direction === 'DOWN'
    ? {
        border: 'border-rose-500/40',
        bg: 'bg-rose-950/60',
        text: 'text-rose-400',
        glow: 'shadow-[0_0_10px_rgba(244,63,94,0.25)]',
        label: 'BEARISH',
        arrowIcon: ArrowDownRight,
        trendIcon: TrendingDown,
      }
    : {
        border: 'border-slate-700/60',
        bg: 'bg-slate-900/70',
        text: 'text-slate-300',
        glow: 'shadow-[0_0_6px_rgba(148,163,184,0.15)]',
        label: 'FLAT',
        arrowIcon: MoveRight,
        trendIcon: Activity,
      };

  const ArrowIcon = theme.arrowIcon;

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Visual Badge next to AI Matrix */}
      <div
        className={`badge-delta cursor-pointer transition-all duration-150 select-none ${
          direction === 'UP' ? 'badge-delta-live' : direction === 'DOWN' ? 'badge-delta-danger' : 'badge-delta-standby'
        }`}
        title={`15m MA Slope for ${activeSymbol}: ${slopeFormatted} (${theme.label}) • ${contextNote}`}
      >
        {/* Animated Directional Arrow */}
        <span className="flex items-center justify-center">
          <ArrowIcon
            className={`w-3 h-3 transition-transform duration-200 ${
              direction === 'UP' ? 'text-emerald-400 group-hover:-translate-y-0.5' : direction === 'DOWN' ? 'text-rose-400 group-hover:translate-y-0.5' : 'text-slate-400'
            }`}
          />
        </span>

        {/* Slope Telemetry Text */}
        <span className="tracking-tight font-mono-numbers">
          {!compact && (
            <span className="text-slate-400 font-sans font-semibold text-[9px] mr-1 hidden xs:inline">15m MA</span>
          )}
          {compact && (
            <span className="text-slate-400 font-sans font-semibold text-[9px] mr-1">15m</span>
          )}
          <span className="font-extrabold">{slopeFormatted}</span>
        </span>

        {/* Dynamic AI Alignment Indicator Dot */}
        {signalAlignment === 'ALIGNED' ? (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Slope aligns with AI Signal" />
        ) : signalAlignment === 'DIVERGENT' ? (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title="Slope diverges from AI Signal (Counter-Trend)" />
        ) : null}
      </div>

      {/* Floating Institutional Context Tooltip */}
      {showTooltip && (
        <div className="panel-delta absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 w-64 p-3 border-cyan-500/40 shadow-2xl backdrop-blur-md text-[11px] font-sans pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span className="panel-delta-title text-white">
                15m MA Slope Radar
              </span>
            </div>
            <span className={`badge-delta ${direction === 'UP' ? 'badge-delta-live' : direction === 'DOWN' ? 'badge-delta-danger' : 'badge-delta-standby'}`}>
              {theme.label}
            </span>
          </div>

          <div className="space-y-1.5 py-2 font-mono-numbers text-[10px]">
            <div className="flex items-center justify-between text-slate-400">
              <span>Selected Asset:</span>
              <span className="font-bold text-white font-sans">{activeSymbol}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>15m MA (EMA 20):</span>
              <span className="font-bold text-cyan-300">
                ${currentMa > 0 ? currentMa.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Slope Velocity:</span>
              <span className={`font-bold ${theme.text}`}>
                {slopeFormatted} ({angleDeg >= 0 ? `+${angleDeg}` : angleDeg}°)
              </span>
            </div>
            {prevMa > 0 && (
              <div className="flex items-center justify-between text-slate-400">
                <span>Prior 15m Baseline:</span>
                <span className="text-slate-300">${prevMa.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
          </div>

          {/* AI Signal Correlation Context Box */}
          <div className={`mt-1 p-2 rounded-lg border text-[10px] font-sans leading-tight ${
            signalAlignment === 'ALIGNED'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
              : signalAlignment === 'DIVERGENT'
              ? 'bg-amber-950/40 border-amber-500/30 text-amber-200'
              : 'bg-slate-900/80 border-slate-700/50 text-slate-300'
          }`}>
            <div className="font-bold flex items-center gap-1 mb-0.5">
              <span className="text-[9px] uppercase tracking-wider">
                AI Signal Synergy: {signalAlignment}
              </span>
            </div>
            <div className="text-[9.5px] opacity-90">
              {contextNote}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
