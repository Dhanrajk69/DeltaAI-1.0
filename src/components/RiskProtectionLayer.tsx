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
  HelpCircle
} from 'lucide-react';
import { SniperSignal, SniperExposureMode } from '../types';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { CapitalAllocationCard } from './CapitalAllocationCard';

export interface RiskProtectionLayerProps {
  currentSignal: SniperSignal;
  tradingMode: 'PAPER' | 'LIVE';
  bypassHtfFilter?: boolean;
  setBypassHtfFilter?: (val: boolean) => void;
  onSetExposureMode?: (mode: SniperExposureMode) => void;
  fiveMinBarCountdown?: string;
  isLiveUnverified?: boolean;
  effectiveStandby?: boolean;
  className?: string;
}

export const RiskProtectionLayer: React.FC<RiskProtectionLayerProps> = ({
  currentSignal,
  tradingMode,
  bypassHtfFilter,
  setBypassHtfFilter,
  onSetExposureMode,
  fiveMinBarCountdown = '02:45',
  isLiveUnverified = false,
  effectiveStandby = false,
  className = '',
}) => {
  const { autoFitLotToMaxMargin, leverage } = useCapitalAllocation();
  const [internalBypass, setInternalBypass] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem('delta_bypass_htf_paper') === 'true';
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    const handleStorageChange = () => {
      try {
        setInternalBypass(localStorage.getItem('delta_bypass_htf_paper') === 'true');
      } catch {}
    };
    window.addEventListener('delta_bypass_toggle', handleStorageChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('delta_bypass_toggle', handleStorageChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const effectiveBypass = bypassHtfFilter !== undefined ? bypassHtfFilter : internalBypass;
  const isPaper = tradingMode === 'PAPER';
  const isShort = currentSignal.signal === 'SHORT';
  const isBypassActive = isPaper && effectiveBypass;

  const handleToggleBypass = (nextVal: boolean) => {
    if (setBypassHtfFilter) {
      setBypassHtfFilter(nextVal);
    }
    setInternalBypass(nextVal);
    try {
      localStorage.setItem('delta_bypass_htf_paper', nextVal ? 'true' : 'false');
      window.dispatchEvent(new Event('delta_bypass_toggle'));
    } catch {}
  };

  // Validation criteria statuses
  const val = currentSignal.validation || ({} as any);
  const rc = currentSignal.riskChecks || ({} as any);
  const confidence = currentSignal.confidence ?? 75;
  const isHighConfidence = confidence >= 75;

  const htfTrendStatus = val.higherTimeframeTrendStatus || (val.higherTimeframeTrend ? 'PASS' : isBypassActive ? 'PASS' : isHighConfidence ? 'WARNING' : 'FAIL');
  const vwapStatus = val.vwapAlignmentStatus || (val.vwapAlignment ? 'PASS' : isBypassActive ? 'PASS' : isHighConfidence ? 'WARNING' : 'FAIL');

  // Gate 1 resolution
  const isGate1PassOverride = isBypassActive;
  const isGate1Warning = !isBypassActive && (val.htfDivergenceWarning || (!val.higherTimeframeTrend && isHighConfidence) || (!val.vwapAlignment && isHighConfidence));
  const isGate1AwaitingCandle = !isBypassActive && val.candleConfirmed === false;
  const isGate1Pass = isBypassActive || rc.signalValidationPassed || isGate1Warning;

  // Check Gate 2-6 status
  const isMicro15 = currentSignal.exposureMode === 'MICRO_15' || currentSignal.scalpTier === 'TIER_15';
  const isMicro50 = currentSignal.exposureMode === 'MICRO_50' || currentSignal.scalpTier === 'TIER_50';
  const gate2Pass = rc.confidenceThresholdMet ?? (confidence >= 75);
  const gate3Pass = rc.positionSizeReceived ?? (currentSignal.lotSize > 0);
  const gate4Pass = rc.deltaLeverageAvailable ?? (currentSignal.leverage > 0);
  const gate5Pass = isMicro15 ? true : (rc.sufficientMargin ?? true);
  const gate6Pass = rc.riskLimitsNotBreached ?? !isLiveUnverified;

  const allOtherGatesPass = gate2Pass && gate3Pass && gate4Pass && gate5Pass && gate6Pass && !isLiveUnverified;

  // Gate 7 resolution: Update from TRADE BLOCKED to ARMED / CONDITIONAL when all other gates are PASS
  const isTradeApproved = (rc.tradeApproved || isBypassActive) && allOtherGatesPass;
  const isArmedConditional = !isTradeApproved && allOtherGatesPass && (isGate1Warning || isHighConfidence);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Bypass HTF Filter Quick Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 bg-slate-950/90 border border-slate-800/80 rounded-lg font-mono-numbers">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Risk &amp; Signal Gate Controls:
          </span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Override pre-entry locks for manual paper test fills
          </span>
        </div>

        <label
          className={`inline-flex items-center gap-2 px-3 py-1 rounded-md border text-xs font-bold transition-all select-none cursor-pointer ${
            isBypassActive
              ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-300 hover:border-slate-600'
          } ${!isPaper ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="When active in Paper mode, treats Gate #1 as PASS (OVERRIDE) and unlocks demo execution"
        >
          <input
            type="checkbox"
            checked={isBypassActive}
            disabled={!isPaper}
            onChange={(e) => handleToggleBypass(e.target.checked)}
            className="sr-only"
          />
          <div
            className={`w-7 h-4 rounded-full relative transition-colors ${
              isBypassActive ? 'bg-amber-500' : 'bg-slate-700'
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${
                isBypassActive ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </div>
          <span className="text-[11px] tracking-tight">
            [Bypass HTF / VWAP Guard (Paper)]
          </span>
          {isBypassActive && (
            <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-400 text-slate-950 uppercase">
              OVERRIDE ON
            </span>
          )}
        </label>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          GLOBAL CAPITAL SIZING & LOT CONFIGURATION MODULE CARD
          ═══════════════════════════════════════════════════════════ */}
      <CapitalAllocationCard
        availableBalance={rc.availableBalance && rc.availableBalance > 0 ? rc.availableBalance : 1000}
        markPrice={currentSignal.entryPrice || 81702.50}
        selectedSymbol={currentSignal.symbol || 'BTCUSDT'}
        leverage={currentSignal.leverage || leverage || 10}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ═══════════════════════════════════════════════════════════
            SECTION 1: 9 SIGNAL VALIDATION CRITERIA (AI COMMAND SIGNAL VALIDATOR)
            ═══════════════════════════════════════════════════════════ */}
        <div className="lg:col-span-6 bg-[#0b0f19] border border-slate-800/90 rounded-lg p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                1. AI Command Signal Validator (Camarilla H1–H5 / L1–L5)
              </h3>
            </div>
            <span className="text-[10px] text-emerald-400 font-mono-numbers">
              ALL REQUIRED FOR ENTRY
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono-numbers">
            {/* 1. HTF Trend Confirmation */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">HTF Trend Confirmation</span>
              <span
                className={`font-bold flex items-center gap-1 ${
                  htfTrendStatus === 'PASS'
                    ? 'text-emerald-400'
                    : htfTrendStatus === 'WARNING'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {htfTrendStatus === 'PASS' ? (
                  <>
                    <Check className="w-3 h-3" /> PASS
                  </>
                ) : htfTrendStatus === 'WARNING' ? (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 border border-amber-500/40 text-amber-300 inline-flex items-center gap-1"
                    title="Advisory Warning: AI Conviction >= 75% allows conditional execution"
                  >
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                    <span>WARNING (ADVISORY)</span>
                  </span>
                ) : (
                  <>
                    <X className="w-3 h-3" /> FAIL
                  </>
                )}
              </span>
            </div>

            {/* 2. VWAP Alignment */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">VWAP Alignment</span>
              <span
                className={`font-bold flex items-center gap-1 ${
                  vwapStatus === 'PASS'
                    ? 'text-emerald-400'
                    : vwapStatus === 'WARNING'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {vwapStatus === 'PASS' ? (
                  <>
                    <Check className="w-3 h-3" /> PASS
                  </>
                ) : vwapStatus === 'WARNING' ? (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 border border-amber-500/40 text-amber-300 inline-flex items-center gap-1"
                    title="Advisory Warning: Price diverged from session VWAP under high conviction"
                  >
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                    <span>WARNING (SUB-OPTIMAL)</span>
                  </span>
                ) : (
                  <>
                    <X className="w-3 h-3" /> FAIL
                  </>
                )}
              </span>
            </div>

            {/* 3. EMA Structure */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">EMA Structure Confirmation</span>
              <span className={`${val.emaStructure !== false ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {val.emaStructure !== false ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            {/* 4. Volume Confirmation */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">Volume Confirmation</span>
              <span className={`${val.volumeConfirmation !== false ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {val.volumeConfirmation !== false ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            {/* 5. RSI Momentum */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">RSI Momentum Validation</span>
              <span className={`${val.rsiMomentum !== false ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {val.rsiMomentum !== false ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            {/* 6. Market Sentiment */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">Market Sentiment Alignment</span>
              <span className={`${val.marketSentiment !== false ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {val.marketSentiment !== false ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            {/* 7. Camarilla Breakout (H4/H3 or L4/L3) */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">Camarilla Breakout ({isShort ? 'L4/L3' : 'H4/H3'})</span>
              <span className="font-bold flex items-center gap-1">
                {!isShort && (currentSignal.entryPrice || 0) >= (currentSignal.camarilla?.h4 || 78800) ? (
                  <span className="text-emerald-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> PASS (H4 Breakout Confirmed)</span>
                ) : isShort && (currentSignal.entryPrice || 0) <= (currentSignal.camarilla?.l4 || 77800) ? (
                  <span className="text-rose-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> PASS (L4 Breakdown Confirmed)</span>
                ) : val.supportResistance !== false ? (
                  <span className="text-emerald-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> PASS</span>
                ) : (
                  <span className="text-amber-400 inline-flex items-center gap-1"><Clock className="w-3 h-3" /> WAIT / ROTATION</span>
                )}
              </span>
            </div>

            {/* 8. Fibonacci Swing Confluence (±0.15%) */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">Fibonacci Confluence (&plusmn;0.15%)</span>
              <span className="font-bold flex items-center gap-1">
                {val.fibonacciConfluence || (currentSignal.fibConfluence && currentSignal.fibConfluence.hasConfluence) ? (
                  <span className="text-cyan-300 inline-flex items-center gap-1 drop-shadow-[0_0_8px_rgba(6,182,212,0.4)]">
                    <Zap className="w-3 h-3 text-cyan-400" /> PASS (Confluence Active)
                  </span>
                ) : (
                  <span className="text-slate-400 inline-flex items-center gap-1 text-[10px]">
                    SEARCHING / ROTATION
                  </span>
                )}
              </span>
            </div>

            {/* 9. AI Confidence >= 75% (Elevated to >= 88% on Confluence) */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 sm:col-span-2 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">AI Conviction &ge; 75% (Boosted on Confluence)</span>
              <span className={`${confidence >= 75 ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {confidence >= 75 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} {confidence}% ({currentSignal.confidenceStatus || 'High Conviction'})
              </span>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════
            SECTION 2: 7-GATE RISK PROTECTION LAYER (PRE-ENTRY GATES)
            ═══════════════════════════════════════════════════════════ */}
        <div className="lg:col-span-6 bg-[#0b0f19] border border-slate-800/90 rounded-lg p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                7. Risk Protection Layer (Pre-Entry Gates)
              </h3>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono-numbers border ${
                isTradeApproved
                  ? isBypassActive
                    ? 'bg-amber-950/70 border-amber-500/60 text-amber-300'
                    : 'bg-emerald-950 border-emerald-600 text-emerald-400'
                  : isArmedConditional
                  ? 'bg-cyan-950/70 border-cyan-500/60 text-cyan-300'
                  : effectiveStandby && !isLiveUnverified
                  ? 'bg-slate-900 border-slate-700 text-slate-300'
                  : 'bg-rose-950 border-rose-600 text-rose-400'
              }`}
            >
              {isTradeApproved
                ? isBypassActive
                  ? 'TRADE APPROVED (PASS - OVERRIDE)'
                  : 'TRADE APPROVED (PASS)'
                : isArmedConditional
                ? 'ARMED / CONDITIONAL'
                : effectiveStandby && !isLiveUnverified
                ? 'STANDBY / SCANNING'
                : 'TRADE BLOCKED'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono-numbers">
            {/* Gate 1: Signal Validation Passed */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">1. Signal Validation Passed</span>
              <span>
                {isGate1PassOverride ? (
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50 inline-flex items-center gap-1 shadow-[0_0_8px_rgba(245,158,11,0.2)]"
                    title="Gate #1 overridden for manual Paper Demo testing"
                  >
                    <CheckCircle className="w-3 h-3 text-amber-400 inline" />
                    <span>PASS (OVERRIDE)</span>
                  </span>
                ) : isGate1Warning ? (
                  <span
                    className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1"
                    title="Advisory Warning: Divergence under review; confidence >= 75% permits conditional arming"
                  >
                    <AlertTriangle className="w-3 h-3 text-amber-400 inline" />
                    <span>PASS (WARNING)</span>
                  </span>
                ) : isGate1AwaitingCandle ? (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1 animate-pulse"
                    title="Intra-candle touch protected. Auto-entry locked until 5m bar closes"
                  >
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span>AWAITING 5M CLOSE ({fiveMinBarCountdown})</span>
                  </span>
                ) : rc.signalValidationPassed ? (
                  <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>PASS</span>
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold inline-flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>FAIL</span>
                  </span>
                )}
              </span>
            </div>

            {/* Gate 2: Confidence Threshold Met */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">2. Confidence Threshold Met (&ge;75%)</span>
              <span className={gate2Pass ? 'text-emerald-400 font-bold inline-flex items-center gap-1' : 'text-rose-400 font-bold inline-flex items-center gap-1'}>
                {gate2Pass ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>PASS ({confidence}%)</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>FAIL ({confidence}%)</span>
                  </>
                )}
              </span>
            </div>

            {/* Gate 3: Position Size Received */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">3. Position Size Received</span>
              <span className={gate3Pass ? 'text-emerald-400 font-bold inline-flex items-center gap-1' : 'text-rose-400 font-bold inline-flex items-center gap-1'}>
                {gate3Pass ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>0.10 BTC (PASS)</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>0</span>
                  </>
                )}
              </span>
            </div>

            {/* Gate 4: Delta Leverage Available */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">4. Delta Leverage Available</span>
              <span className={gate4Pass ? 'text-emerald-400 font-bold inline-flex items-center gap-1' : 'text-rose-400 font-bold inline-flex items-center gap-1'}>
                {gate4Pass ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>{currentSignal.leverage || 10}x</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>N/A</span>
                  </>
                )}
              </span>
            </div>

            {/* Gate 5: Sufficient Margin Available */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-300 text-[11px]">5. Sufficient Margin Available</span>
                  {isMicro15 && (
                    <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/50 uppercase">
                      [TIER: $15 MICRO · LOW MARGIN]
                    </span>
                  )}
                  {isMicro50 && (
                    <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-cyan-950/80 text-cyan-300 border border-cyan-500/50 uppercase">
                      [TIER: $50 STANDARD]
                    </span>
                  )}
                </div>
                {rc.requiredMargin !== undefined && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    Req: ${rc.requiredMargin.toFixed(2)} / Avail: ${(rc.availableBalance ?? 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              {gate5Pass ? (
                <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                  <span>PASS</span>
                </span>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <span className="text-rose-400 font-bold inline-flex items-center gap-1 text-[11px]">
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline" />
                    <span>DEFICIT</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const avail = rc.availableBalance && rc.availableBalance > 0 ? rc.availableBalance : 1000;
                      const mark = currentSignal.entryPrice || 81702.50;
                      const lev = currentSignal.leverage || leverage || 10;
                      autoFitLotToMaxMargin(avail, mark, lev);
                    }}
                    className="px-2 py-1 text-[10px] font-bold rounded bg-gradient-to-r from-cyan-500/25 via-blue-600/30 to-cyan-400/20 border border-cyan-400/50 text-cyan-200 hover:text-white hover:border-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.4)] transition cursor-pointer flex items-center gap-1 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3)] active:scale-[0.98]"
                    title="Auto-fit lot size to safely utilize at most 90% of available margin balance"
                  >
                    <Zap className="w-2.5 h-2.5 text-cyan-300 inline" />
                    <span>Auto-fit Lot to Max Margin</span>
                  </button>
                  {onSetExposureMode && (
                    <button
                      type="button"
                      onClick={() => onSetExposureMode('MICRO_15')}
                      className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-900 border border-emerald-500/40 text-emerald-300 hover:text-white hover:border-emerald-400 transition cursor-pointer"
                      title="Switch to $15 Micro Scalp to clear margin deficit"
                    >
                      <Zap className="w-2.5 h-2.5 text-emerald-400 inline mr-0.5" />
                      <span>$15 Micro (Clear Deficit)</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Gate 6: Risk Limits Not Breached */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">6. Risk Limits Not Breached</span>
              <span className={gate6Pass ? 'text-emerald-400 font-bold inline-flex items-center gap-1' : 'text-rose-400 font-bold inline-flex items-center gap-1'}>
                {gate6Pass ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>PASS</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>BLOCKED</span>
                  </>
                )}
              </span>
            </div>

            {/* Gate 7: Trade Execution Status */}
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 sm:col-span-2 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">7. Trade Execution Status</span>
              <span
                className={
                  isTradeApproved
                    ? isBypassActive
                      ? 'text-amber-300 font-bold inline-flex items-center gap-1'
                      : 'text-emerald-400 font-bold inline-flex items-center gap-1'
                    : isArmedConditional
                    ? 'text-cyan-300 font-bold inline-flex items-center gap-1'
                    : effectiveStandby && !isLiveUnverified
                    ? 'text-slate-400 font-bold inline-flex items-center gap-1'
                    : 'text-rose-400 font-bold inline-flex items-center gap-1'
                }
              >
                {isTradeApproved ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>
                      {isBypassActive ? 'TRADE APPROVED (OVERRIDE)' : 'TRADE APPROVED (PASS)'}
                    </span>
                  </>
                ) : isArmedConditional ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950/60 border border-cyan-500/50 text-cyan-300 inline-flex items-center gap-1 shadow-[0_0_8px_rgba(6,182,212,0.2)]">
                    <ShieldCheck className="w-3 h-3 text-cyan-400" />
                    <span>ARMED / CONDITIONAL</span>
                  </span>
                ) : effectiveStandby && !isLiveUnverified ? (
                  <>
                    <Clock className="w-3.5 h-3.5 text-slate-400 inline mr-1" />
                    <span>STANDBY / SCANNING (TARGETS CLEARED)</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>TRADE BLOCKED</span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
