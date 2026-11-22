import React, { useState, useMemo, useEffect } from 'react';
import {
  Calculator,
  Percent,
  DollarSign,
  Sparkles,
  Check,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  AlertTriangle,
  Scale,
  Sliders,
  ArrowRight,
} from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

export interface SmartSizingCalculatorProps {
  accountBalance: number;
  symbol: string;
  markPrice: number;
  stopLoss?: number | string;
  takeProfit?: number | string;
  side: 'LONG' | 'SHORT';
  leverage: number;
  onApplySize: (suggestedSize: number, appliedRiskPct: number) => void;
  currencyPrefix: string;
  exchangeRate: number;
  isLiveUnverified?: boolean;
  className?: string;
}

export type SizingMode = 'RISK_TO_STOP' | 'MARGIN_PERCENT';

export const SmartSizingCalculator: React.FC<SmartSizingCalculatorProps> = ({
  accountBalance,
  symbol,
  markPrice,
  stopLoss,
  takeProfit,
  side,
  leverage,
  onApplySize,
  currencyPrefix,
  exchangeRate,
  isLiveUnverified = false,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [riskPct, setRiskPct] = useState<number>(1.0);
  const [customRiskInput, setCustomRiskInput] = useState<string>('1.0');
  const [sizingMode, setSizingMode] = useState<SizingMode>('RISK_TO_STOP');
  const [justApplied, setJustApplied] = useState<boolean>(false);

  // Fallback balance for paper/demo mode if uninitialized
  const effectiveBalance = isLiveUnverified ? 0.0 : accountBalance > 0 ? accountBalance : 1000.0;
  const currentPrice = markPrice > 0 ? markPrice : 81702.50;

  // Sync custom input with riskPct preset changes
  useEffect(() => {
    setCustomRiskInput(riskPct.toString());
  }, [riskPct]);

  // Handle custom risk percentage text input
  const handleCustomRiskChange = (val: string) => {
    setCustomRiskInput(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
      setRiskPct(parsed);
    }
  };

  // Preset risk percentages
  const riskPresets = [0.5, 1.0, 1.5, 2.0, 3.0, 5.0];

  // 1. Dollar Risk Budget Calculation
  const dollarRiskBudget = useMemo(() => {
    return +(effectiveBalance * (riskPct / 100)).toFixed(2);
  }, [effectiveBalance, riskPct]);

  // 2. Stop Loss Distance Calculation
  const slNumber = useMemo(() => {
    if (!stopLoss) return null;
    const parsed = typeof stopLoss === 'string' ? parseFloat(stopLoss) : stopLoss;
    return !isNaN(parsed) && parsed > 0 ? parsed : null;
  }, [stopLoss]);

  const { stopDistance, stopDistancePct, isUsingEstimatedStop } = useMemo(() => {
    if (slNumber && slNumber !== currentPrice) {
      const dist = Math.abs(currentPrice - slNumber);
      const pct = (dist / currentPrice) * 100;
      return {
        stopDistance: dist,
        stopDistancePct: pct,
        isUsingEstimatedStop: false,
      };
    }
    // Estimated 0.60% stop distance fallback if user hasn't specified SL yet
    const estDist = currentPrice * 0.006;
    return {
      stopDistance: estDist,
      stopDistancePct: 0.60,
      isUsingEstimatedStop: true,
    };
  }, [slNumber, currentPrice]);

  // 3. Suggested Position Size Calculation
  const { suggestedSize, notionalValue, marginRequired, maxLossAtStop, isMarginConstrained } = useMemo(() => {
    let rawSize = 0.01;

    if (sizingMode === 'RISK_TO_STOP') {
      // Risk Amount ($) / Distance to Stop Loss ($)
      // Losing this trade hits exactly dollarRiskBudget!
      if (stopDistance > 0) {
        rawSize = dollarRiskBudget / stopDistance;
      }
    } else {
      // Margin-Based Allocation: (Risk % * Balance * Leverage) / Price
      const marginAllocation = dollarRiskBudget;
      const notional = marginAllocation * leverage;
      rawSize = notional / currentPrice;
    }

    // Safety check: cannot require more margin than available balance
    const maxAffordableSize = (effectiveBalance * 0.95 * leverage) / currentPrice;
    let isConstrained = false;
    if (rawSize > maxAffordableSize && maxAffordableSize > 0) {
      rawSize = maxAffordableSize;
      isConstrained = true;
    }

    // Symbol-specific precision clamping
    const cleanSym = symbol.toUpperCase();
    let clamped = rawSize;
    if (cleanSym.includes('BTC')) {
      clamped = Math.max(0.001, +rawSize.toFixed(3));
    } else if (cleanSym.includes('ETH')) {
      clamped = Math.max(0.01, +rawSize.toFixed(2));
    } else if (cleanSym.includes('SOL')) {
      clamped = Math.max(0.1, +rawSize.toFixed(1));
    } else {
      clamped = Math.max(1, Math.round(rawSize));
    }

    const notional = clamped * currentPrice;
    const margin = notional / leverage;
    const maxLoss = clamped * stopDistance;

    return {
      suggestedSize: clamped,
      notionalValue: notional,
      marginRequired: margin,
      maxLossAtStop: maxLoss,
      isMarginConstrained: isConstrained,
    };
  }, [sizingMode, dollarRiskBudget, stopDistance, leverage, currentPrice, effectiveBalance, symbol]);

  const cleanSymbolName = useMemo(() => {
    return symbol.replace('USDT', '').replace('USD', '') || 'BTC';
  }, [symbol]);

  // Apply suggested size to OrderForm
  const handleApply = () => {
    triggerHaptic('success');
    onApplySize(suggestedSize, riskPct);
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 2500);
  };

  return (
    <div
      className={`panel-delta overflow-hidden transition-all duration-200 ${className}`}
    >
      {/* Header Strip with Toggle */}
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="panel-delta-header cursor-pointer select-none hover:bg-slate-900/60 transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
            <Calculator className="w-3 h-3 text-cyan-300" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="panel-delta-title text-white">
              Smart Sizing
            </span>
            <span className="badge-delta badge-delta-armed font-mono-numbers">
              {riskPct}% Risk → {suggestedSize} {cleanSymbolName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono-numbers text-slate-400 hidden sm:inline">
            Equity: <strong className="text-white">${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </span>
          <button
            type="button"
            className="text-slate-400 hover:text-white p-0.5 rounded transition"
            aria-label="Toggle Smart Sizing Calculator"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-cyan-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>
        </div>
      </div>

      {/* Expandable Calculator Body */}
      {isExpanded && (
        <div className="p-3 space-y-2.5 text-xs font-sans animate-in fade-in duration-150">
          {/* Risk Percentage Selector Controls */}
          <div>
            <div className="flex items-center justify-between text-[10.5px] text-slate-400 mb-1">
              <span className="flex items-center gap-1 font-medium">
                <Percent className="w-3 h-3 text-cyan-400" />
                <span>Risk per Trade (% of Balance)</span>
              </span>
              <span className="text-cyan-300 font-mono-numbers font-bold">
                ${dollarRiskBudget.toFixed(2)} Risk Budget
              </span>
            </div>

            {/* Quick Risk Presets */}
            <div className="grid grid-cols-7 gap-1">
              {riskPresets.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setRiskPct(pct)}
                  className={`btn-delta-sm w-full px-1 font-mono-numbers ${
                    riskPct === pct ? 'btn-toggle-active' : 'btn-secondary'
                  }`}
                >
                  {pct}%
                </button>
              ))}

              {/* Custom % input */}
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="50"
                  value={customRiskInput}
                  onChange={(e) => handleCustomRiskChange(e.target.value)}
                  placeholder="%"
                  className="w-full h-7 text-center bg-slate-900 border border-slate-700 rounded-lg text-[10px] font-mono-numbers text-white font-bold focus:border-cyan-400 focus:outline-none"
                  title="Custom Risk %"
                />
              </div>
            </div>
          </div>

          {/* Sizing Model Mode Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950/80 rounded-lg border border-slate-800/80">
            <button
              type="button"
              onClick={() => setSizingMode('RISK_TO_STOP')}
              className={`btn-delta-sm w-full ${
                sizingMode === 'RISK_TO_STOP' ? 'btn-toggle-active' : 'btn-secondary'
              }`}
              title="Sizes contract lots so that hitting your Stop Loss incurs exactly your dollar risk budget"
            >
              <ShieldCheck className="w-3 h-3 text-cyan-400 shrink-0" />
              <span className="truncate">Risk-to-Stop</span>
            </button>
            <button
              type="button"
              onClick={() => setSizingMode('MARGIN_PERCENT')}
              className={`btn-delta-sm w-full ${
                sizingMode === 'MARGIN_PERCENT' ? 'btn-toggle-active' : 'btn-secondary'
              }`}
              title="Sizes contracts based on committing Risk % of equity as margin with leverage"
            >
              <Scale className="w-3 h-3 text-cyan-400 shrink-0" />
              <span className="truncate">Margin % Equity</span>
            </button>
          </div>

          {/* Calculation Telemetry Display Card */}
          <div className="rounded-lg bg-black/50 border border-slate-800 p-2.5 font-mono-numbers space-y-1.5 text-[10.5px]">
            {/* Suggested Size Banner */}
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80">
              <span className="text-slate-400 font-sans font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-emerald-400" />
                <span>Suggested Position Size:</span>
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-black text-emerald-400 tracking-tight">
                  {suggestedSize}
                </span>
                <span className="text-[10px] text-slate-400 font-sans font-bold uppercase">
                  {cleanSymbolName}
                </span>
                <span className="text-[9.5px] text-slate-500 ml-1">
                  (≈ ${notionalValue.toLocaleString(undefined, { maximumFractionDigits: 1 })})
                </span>
              </div>
            </div>

            {/* Invalidation Distance & Max Loss Metrics */}
            <div className="grid grid-cols-2 gap-2 text-[10px] pt-0.5">
              <div className="flex justify-between items-center text-slate-400">
                <span>Stop Loss Buffer:</span>
                <span className="text-white font-semibold">
                  ${stopDistance.toFixed(1)} ({stopDistancePct.toFixed(2)}%)
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Max Dollar Loss:</span>
                <span className="text-rose-400 font-bold">
                  -${maxLossAtStop.toFixed(2)} ({((maxLossAtStop / effectiveBalance) * 100).toFixed(2)}%)
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Margin Required ({leverage}x):</span>
                <span className="text-cyan-300 font-semibold">
                  ${marginRequired.toFixed(2)} ({((marginRequired / effectiveBalance) * 100).toFixed(1)}%)
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Account Balance:</span>
                <span className="text-slate-200">
                  ${effectiveBalance.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Context Notice for Estimated vs Actual Stop */}
            {isUsingEstimatedStop && sizingMode === 'RISK_TO_STOP' && (
              <div className="text-[9px] text-amber-300/80 pt-1 border-t border-slate-800/60 font-sans leading-tight flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Estimated 0.60% stop distance applied. Enter an exact Stop Loss price below for surgical sizing.</span>
              </div>
            )}

            {isMarginConstrained && (
              <div className="text-[9px] text-rose-300/90 pt-1 border-t border-rose-900/40 font-sans leading-tight flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0" />
                <span>Size capped at 95% available account margin capacity.</span>
              </div>
            )}
          </div>

          {/* Quick Apply Button */}
          <button
            type="button"
            disabled={isLiveUnverified}
            onClick={handleApply}
            className={`btn-delta w-full uppercase tracking-wider ${
              justApplied ? 'btn-toggle-active' : 'btn-primary'
            }`}
          >
            {justApplied ? (
              <>
                <Check className="w-3.5 h-3.5 animate-scale-up" />
                <span>Applied {suggestedSize} {cleanSymbolName} to Order Pad</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Apply Suggested Size ({suggestedSize} {cleanSymbolName})</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
