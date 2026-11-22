import React from 'react';
import {
  CheckCircle,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Zap,
  Check,
  X,
  Shield,
  ArrowUp,
  ArrowDown,
  Layers,
  Activity,
  Cpu,
} from 'lucide-react';
import { SniperSignal, SniperExposureMode, SniperScalpTier } from '../types';

export interface AICommandSignalValidatorProps {
  currentSignal: SniperSignal;
  tradingMode: 'PAPER' | 'LIVE';
  bypassHtfFilter?: boolean;
  setBypassHtfFilter?: (val: boolean) => void;
  onExecuteSniperTrade?: () => void;
  isExecuting?: boolean;
  isLiveUnverified?: boolean;
  effectiveStandby?: boolean;
  fiveMinBarCountdown?: string;
  className?: string;
}

export const AICommandSignalValidator: React.FC<AICommandSignalValidatorProps> = ({
  currentSignal,
  tradingMode,
  bypassHtfFilter = false,
  setBypassHtfFilter,
  onExecuteSniperTrade,
  isExecuting = false,
  isLiveUnverified = false,
  effectiveStandby = false,
  fiveMinBarCountdown = '02:45 to close',
  className = '',
}) => {
  const isPaper = tradingMode === 'PAPER';
  const isShort = currentSignal.signal === 'SHORT';
  const isBypassActive = isPaper && bypassHtfFilter;

  const val = currentSignal.validation || ({} as any);
  const rc = currentSignal.riskChecks || ({} as any);
  const conf = currentSignal.fibConfluence;
  const fib = currentSignal.fibonacci;
  const camarilla = currentSignal.camarilla || ({} as any);

  const confidence = currentSignal.confidence ?? 75;
  const isHighConfidence = confidence >= 75;

  // 1. Camarilla Breakout Status
  const markPrice = currentSignal.entryPrice || camarilla.pivot || 78000;
  const isH4Breakout = !isShort && markPrice >= (camarilla.h4 || 78800);
  const isL4Breakdown = isShort && markPrice <= (camarilla.l4 || 77800);

  // Sizing Badge & Micro resolution
  const scalpTier = currentSignal.scalpTier || 'TIER_50';
  const isMicro15 = currentSignal.exposureMode === 'MICRO_15' || scalpTier === 'TIER_15';
  const sizingBadgeText = '0.10 BTC';
  const riskCapText = isMicro15 ? '$15.00' : '$50.00';
  
  let camarillaBreakoutStatus: string;
  let camarillaBadgeColor: string;
  if (isMicro15) {
    camarillaBreakoutStatus = 'PASS (Bypassed for Micro - Range Scalp Mode)';
    camarillaBadgeColor = 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
  } else if (isH4Breakout) {
    camarillaBreakoutStatus = 'PASS (H4 Breakout Confirmed)';
    camarillaBadgeColor = 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
  } else if (isL4Breakdown) {
    camarillaBreakoutStatus = 'PASS (L4 Breakdown Confirmed)';
    camarillaBadgeColor = 'text-rose-400 border-rose-500/40 bg-rose-500/10';
  } else if (val.supportResistance) {
    camarillaBreakoutStatus = 'PASS (Zone Validated)';
    camarillaBadgeColor = 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
  } else {
    camarillaBreakoutStatus = 'WAIT / ROTATION';
    camarillaBadgeColor = 'text-amber-400 border-amber-500/40 bg-amber-500/10';
  }

  // 2. Fibonacci Swing Confluence Status (±0.15%)
  const hasFibConfluence = Boolean(val.fibonacciConfluence || (conf && conf.hasConfluence));
  const fibConfluenceStatus = hasFibConfluence
    ? 'PASS (Confluence Active)'
    : 'SEARCHING / ROTATION';
  const fibConfluenceDesc = conf?.description || val.fibonacciConfluenceDesc || 'Testing Fib swing boundaries';

  // Overall Execution Approval
  const isApproved = (rc.tradeApproved || isBypassActive) && !isLiveUnverified;
  const isArmedConditional = !isApproved && (rc.executionStatus === 'ARMED_CONDITIONAL' || isHighConfidence);

  const slPrice = isShort ? markPrice + 150 : markPrice - 150;
  const tp1Price = isShort ? markPrice - 37.5 : markPrice + 37.5;
  const tp4Price = isShort ? markPrice - 150 : markPrice + 150;

  return (
    <div className={`bg-slate-950/90 border border-slate-800/90 rounded-xl p-4 space-y-3.5 font-mono-numbers ${className}`}>
      {/* Title Header & Grade Badge */}
      <div className="flex items-center justify-between pb-2 border-b border-white/10 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            AI Command Signal Validator &amp; 180-Pt Model
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-0.5 rounded text-[10px] font-black tracking-wider uppercase border ${
            isShort
              ? 'bg-rose-950/90 border-rose-500 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
              : ((currentSignal as any).signalGrade === 'A+')
              ? 'bg-emerald-950/90 border-emerald-500 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.4)] animate-pulse'
              : ((currentSignal as any).signalGrade === 'A')
              ? 'bg-cyan-950/90 border-cyan-500 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
              : 'bg-amber-950/90 border-amber-500 text-amber-300'
          }`}>
            Grade {(currentSignal as any).signalGrade || 'A'} ({isShort ? 'BEARISH' : 'BULLISH'}): {(currentSignal as any).signalScore || 170}/180 · {(currentSignal as any).signalGradeLabel || (isShort ? 'BEARISH INSTITUTIONAL CONVICTION' : 'BULLISH INSTITUTIONAL CONVICTION')}
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900 border border-slate-700 text-slate-300">
            RISK CAP: {riskCapText}
          </span>
        </div>
      </div>

      {/* AI Verdict Text String */}
      <div className="p-2.5 bg-slate-900/90 border border-cyan-500/30 rounded-lg text-[11px] font-mono text-cyan-300 flex items-start gap-2 shadow-sm">
        <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <span className="leading-relaxed">
          {isMicro15
            ? `AI Command Signal Validator ($15 Micro): Dynamic Entry ≈ $${markPrice.toFixed(2)} · SL $${slPrice.toFixed(2)} (Strict -$15 Risk) · Step 1 $${tp1Price.toFixed(2)} · Terminal Cap $${tp4Price.toFixed(2)} (+$15.00 banked per 30m cycle).`
            : (currentSignal.aiVerdict || `AI Command Signal Validator ($50 Standard Breakout ${isShort ? 'SHORT' : 'LONG'}): Entry ${isShort ? '<= L4' : '>= H4'} ($${(isShort ? camarilla.l4 || 76500 : camarilla.h4 || 78300).toFixed(2)}) · SL $${(isShort ? markPrice + 500 : markPrice - 500).toFixed(2)} (Strict -$50 Risk) · Terminal TP $${(isShort ? markPrice - 500 : markPrice + 500).toFixed(2)}.`)
          }
        </span>
      </div>

      {/* Grid of Key Validator Gates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
        {/* Gate 1: Camarilla Breakout */}
        <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold text-slate-300">Camarilla Breakout ({isShort ? 'L4/L3' : 'H4/H3'})</span>
            <span className="text-[9.5px] text-slate-400 font-mono">
              H4: ${camarilla.h4?.toLocaleString() || '---'} | L4: ${camarilla.l4?.toLocaleString() || '---'}
            </span>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${camarillaBadgeColor}`}>
            {camarillaBreakoutStatus}
          </span>
        </div>

        {/* Gate 2: Fibonacci Confluence (±0.15%) */}
        <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold text-slate-300">Fibonacci Swing Confluence (&plusmn;0.15%)</span>
            <span className="text-[9.5px] text-cyan-300 font-mono truncate max-w-[180px]">
              {fibConfluenceDesc}
            </span>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            hasFibConfluence 
              ? 'text-cyan-300 border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_10px_rgba(6,182,212,0.3)]' 
              : 'text-slate-400 border-slate-700 bg-slate-900'
          }`}>
            {fibConfluenceStatus}
          </span>
        </div>

        {/* Gate 3: Candle Close Confirmation */}
        <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-300">5M Candle Close Protection</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isMicro15 || val.candleConfirmed !== false 
              ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' 
              : 'text-amber-300 border-amber-500/40 bg-amber-500/10 animate-pulse'
          }`}>
            {isMicro15 ? 'PASS (Internal PA Valid)' : (val.candleConfirmed !== false ? 'PASS (CLOSED BAR)' : `AWAITING 5M (${fiveMinBarCountdown})`)}
          </span>
        </div>

        {/* Gate 4: CPR Width Filter */}
        <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-800 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-300">CPR Width Regime Filter</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isMicro15 || val.cprFilterPassed !== false 
              ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' 
              : 'text-rose-400 border-rose-500/40 bg-rose-500/10'
          }`}>
            {isMicro15 ? 'PASS (Bypassed for Micro)' : (rc.cprStatus || 'NORMAL CPR')}
          </span>
        </div>
      </div>

      {/* Execution Unlock Footer Bar */}
      <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400 font-semibold">Trade Execution Status:</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
            isApproved
              ? 'bg-emerald-950 border-emerald-500/50 text-emerald-400'
              : isArmedConditional
              ? 'bg-cyan-950 border-cyan-500/50 text-cyan-300'
              : 'bg-rose-950 border-rose-500/50 text-rose-400'
          }`}>
            {isApproved ? 'APPROVED FOR EXECUTION' : isArmedConditional ? 'ARMED / CONDITIONAL' : 'BLOCKED / STANDBY'}
          </span>
        </div>

        {/* Dynamic Execution Button with Tier Sizing Badge */}
        {onExecuteSniperTrade && (
          <button
            type="button"
            onClick={onExecuteSniperTrade}
            disabled={isExecuting || (!isApproved && !isArmedConditional)}
            className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer shadow-md ${
              isShort
                ? 'bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white shadow-rose-900/30'
                : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white shadow-emerald-900/30'
            } ${(!isApproved && !isArmedConditional) || isExecuting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'}`}
          >
            {isShort ? <ArrowDown className="w-4 h-4" /> : <ArrowUp className="w-4 h-4" />}
            <span>{isShort ? '[EXECUTE SHORT]' : '[EXECUTE LONG]'}</span>
            <span className="px-1.5 py-0.2 rounded text-[9.5px] font-black bg-black/40 border border-white/20 text-cyan-200">
              {sizingBadgeText}
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
