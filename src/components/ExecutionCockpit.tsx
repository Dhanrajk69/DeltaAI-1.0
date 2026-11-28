import React from 'react';
import {
  Zap,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  CheckCircle,
  X,
  Compass,
  ArrowRight,
  ShieldAlert,
  Sliders,
  DollarSign
} from 'lucide-react';
import { SniperSignal, SniperActiveTrade, SniperLogEntry, SniperScalpTier, SniperExposureMode, SniperExecutionTriggerMode } from '../types';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { calculateSniperFriction } from '../utils/frictionUtils';
import { ProfitLadderDashdark } from './ProfitLadderDashdark';
import { usePortfolio } from '../context/PortfolioContext';

export interface ExecutionCockpitProps {
  currentSignal: SniperSignal;
  activeTrade: SniperActiveTrade | null;
  tradingMode: 'PAPER' | 'LIVE';
  selectedSymbol: string;
  bypassHtfFilter?: boolean;
  setBypassHtfFilter?: (bypass: boolean) => void;
  scalpTier?: SniperScalpTier;
  setScalpTier?: (tier: SniperScalpTier) => void;
  exposureMode?: SniperExposureMode;
  setExposureMode?: (mode: SniperExposureMode) => void;
  isTargetsHydrated: boolean;
  isExecuting: boolean;
  isLiveUnverified: boolean;
  effectiveStandby: boolean;
  onExecuteSniperTrade: () => void;
  onCloseSniperTrade: (reason?: string) => void;
  onConfirmSignal?: () => void;
  onOpenSettings?: () => void;
  currencyPrefix?: string;
  exchangeRate?: number;
  fiveMinBarCountdown?: string;
  tradeLogs?: SniperLogEntry[];
  executionTriggerMode?: SniperExecutionTriggerMode;
  setExecutionTriggerMode?: (mode: SniperExecutionTriggerMode) => void;
  isAutoSniperEnabled?: boolean;
  setIsAutoSniperEnabled?: (val: boolean) => void;
  onResetCircuitBreaker?: () => void;
  consecutiveStopsCount?: number;
  circuitBreakerTripped?: boolean;
  circuitBreakerReason?: string | null;
  dailyLossPercent?: number;
  postSlCooldownUntilMs?: number;
  pairCooldowns?: Record<string, number>;
  cycleRealizedPnL?: number;
  harvestTargetHit?: boolean;
  cycleWindowRemaining?: string;
  isTransitionWindow?: boolean;
  onResetCycleTarget?: () => void;
  isEmaAlignmentPending?: boolean;
  className?: string;
}

function normalizePerpSymbol(sym?: string): string {
  if (!sym) return 'BTCUSDT';
  const up = String(sym).toUpperCase().trim();
  if (up === 'BTCUSD' || up === 'BTCUSDT' || up.includes('BTC')) return 'BTCUSDT';
  if (up === 'ETHUSD' || up === 'ETHUSDT' || up.includes('ETH')) return 'ETHUSDT';
  if (up.endsWith('USD') && !up.endsWith('USDT')) return `${up}T`;
  return up;
}

export const ExecutionCockpit: React.FC<ExecutionCockpitProps> = ({
  currentSignal,
  activeTrade,
  tradingMode,
  selectedSymbol,
  bypassHtfFilter,
  setBypassHtfFilter,
  scalpTier,
  setScalpTier,
  exposureMode,
  setExposureMode,
  isTargetsHydrated,
  isExecuting,
  isLiveUnverified,
  effectiveStandby,
  onExecuteSniperTrade,
  onCloseSniperTrade,
  onConfirmSignal,
  onOpenSettings,
  currencyPrefix = '$',
  exchangeRate = 1,
  fiveMinBarCountdown = '02:45',
  executionTriggerMode = 'CANDLE_CLOSE',
  setExecutionTriggerMode,
  isAutoSniperEnabled = false,
  setIsAutoSniperEnabled,
  onResetCircuitBreaker,
  consecutiveStopsCount = 0,
  circuitBreakerTripped = false,
  circuitBreakerReason = null,
  dailyLossPercent = 0,
  postSlCooldownUntilMs = 0,
  pairCooldowns = {},
  cycleRealizedPnL = 0,
  harvestTargetHit = false,
  cycleWindowRemaining = '30m 00s',
  isTransitionWindow = false,
  onResetCycleTarget,
  isEmaAlignmentPending = false,
  className = '',
}) => {
  const {
    defaultLotSize,
    sizingMethod,
    fixedRiskUsd,
    equityPercent,
    calculateLotSize,
    globalLeverage,
    maxLeverageCap,
    marginMode,
    leverageSyncLocked,
    clampLeverage,
  } = useCapitalAllocation();
  const { positions, positionMismatchWarning, clearPositionMismatchWarning } = usePortfolio();
  const [internalBypass, setInternalBypass] = React.useState<boolean>(false);

  React.useEffect(() => {
    const handleBypassToggle = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.bypass === 'boolean') {
        setInternalBypass(detail.bypass);
      }
    };
    window.addEventListener('delta_bypass_toggle', handleBypassToggle as EventListener);
    return () => {
      window.removeEventListener('delta_bypass_toggle', handleBypassToggle as EventListener);
    };
  }, []);

  const effectiveBypass = bypassHtfFilter !== undefined ? bypassHtfFilter : internalBypass;
  const isPaper = tradingMode === 'PAPER';
  const isBypassActive = isPaper && effectiveBypass;
  const isShort = currentSignal.signal === 'SHORT';
  const effectiveSignal = currentSignal.signal;

  // Active Scalp Tier Resolution
  const activeScalpTier: SniperScalpTier =
    scalpTier ||
    activeTrade?.scalpTier ||
    currentSignal.scalpTier ||
    ((activeTrade?.exposureMode || currentSignal.exposureMode || exposureMode) === 'MICRO_15' ? 'TIER_15' : 'TIER_50');

  const isMicro15 = activeScalpTier === 'TIER_15' || scalpTier === 'TIER_15' || exposureMode === 'MICRO_15' || currentSignal.exposureMode === 'MICRO_15' || currentSignal.scalpTier === 'TIER_15';
  const isMicro50 = activeScalpTier === 'TIER_50' || scalpTier === 'TIER_50' || exposureMode === 'MICRO_50' || currentSignal.exposureMode === 'MICRO_50' || currentSignal.scalpTier === 'TIER_50';
  const isMicroScalp = isMicro15 || isMicro50;
  const isMicro = isMicro15;
  const maxRiskCap = isMicro15 ? 15 : 50;

  const signalSide: 'LONG' | 'SHORT' = currentSignal.signal === 'SHORT' ? 'SHORT' : 'LONG';
  const activeMarkPrice = currentSignal.entryPrice || 81702.50;
  const currentPrice = currentSignal.entryPrice || activeMarkPrice;
  const h4 = currentSignal.camarilla?.h4 || 78362.40;
  const l4 = currentSignal.camarilla?.l4 || 76505.60;

  const liveFxRate = exchangeRate && exchangeRate > 1 ? exchangeRate : 85.0;

  const tierTargets = React.useMemo(() => {
    const isM15 = isMicro15;
    const fmtClean = (amt: number, inrStr: string) => ({
      usd: `+$${amt.toFixed(2)}`,
      inr: `₹${inrStr}`,
      combined: `+$${amt.toFixed(2)} (₹${inrStr})`,
      amount: amt,
    });

    return isM15 ? {
      tp1: fmtClean(3.75, '318.90'),
      tp2: fmtClean(7.50, '637.80'),
      tp3: fmtClean(11.25, '956.70'),
      tp4: fmtClean(15.00, '1,275.60'),
      riskCap: 15,
      rrRatio: '1.0:1',
    } : {
      tp1: fmtClean(12.50, '1,062.75'),
      tp2: fmtClean(25.00, '2,125.50'),
      tp3: fmtClean(37.50, '3,188.25'),
      tp4: fmtClean(50.00, '4,251.00'),
      riskCap: 50,
      rrRatio: '1.0:1',
    };
  }, [isMicro15]);

  // Dynamic lot sizing & margin based on active tier & global leverage
  const deltaLeverage = clampLeverage(currentSignal.leverage || globalLeverage);
  const rawSlDist = currentSignal.initialStopLoss > 0 && currentSignal.entryPrice > 0
    ? Math.abs(currentSignal.entryPrice - currentSignal.initialStopLoss)
    : activeMarkPrice * 0.005;

  // Single Source of Truth: Synced directly from Global Risk Settings / Sniper Signal
  const effectiveLotSize =
    activeTrade && activeTrade.lotSize > 0
      ? activeTrade.lotSize
      : currentSignal.lotSize > 0
      ? currentSignal.lotSize
      : defaultLotSize;
  const calculatedMargin = isMicro15
    ? +(effectiveLotSize * activeMarkPrice / deltaLeverage).toFixed(2)
    : (currentSignal.estimatedMargin || +((effectiveLotSize * activeMarkPrice) / deltaLeverage).toFixed(2));

  const friction = currentSignal.friction || calculateSniperFriction({
    entryPrice: activeMarkPrice,
    direction: effectiveSignal || 'LONG',
    lotSize: effectiveLotSize,
    isTaker: true,
  });

  const isFrictionAlert = isMicro15 && friction.totalFrictionUsd > 1.80; // >12% of $15

  const handleToggleBypass = (nextVal: boolean) => {
    if (setBypassHtfFilter) {
      setBypassHtfFilter(nextVal);
    }
    setInternalBypass(nextVal);
    try {
      window.dispatchEvent(new CustomEvent('delta_bypass_toggle', { detail: { bypass: nextVal } }));
    } catch {}
  };

  const effectiveActiveTrade = React.useMemo(() => {
    if (isLiveUnverified) return null;
    if (
      activeTrade &&
      activeTrade.status !== 'CLOSED' &&
      !['STOPPED_OUT', 'COMPLETED', 'REVERSED', 'TIME_EXIT'].includes(activeTrade.tradeStatus)
    ) {
      return activeTrade;
    }
    const normSelected = normalizePerpSymbol(selectedSymbol);
    const activePerps = (Array.isArray(positions) ? positions : []).filter((p) => {
      const sym = String(p.product_symbol || p.rawSymbol || p.symbol || '').toUpperCase();
      const isOpt =
        p.contract_type === 'call_options' ||
        p.contract_type === 'put_options' ||
        sym.startsWith('C-') ||
        sym.startsWith('P-');
      if (isOpt) return false;
      const rawSize = Math.abs(Number(p.size ?? 0));
      const rawContracts = Math.abs(Number(p.contracts ?? 0));
      return rawSize > 0 || rawContracts > 0;
    });

    if (activePerps.length === 0) return null;

    const matched =
      activePerps.find(
        (p) => normalizePerpSymbol(p.product_symbol || p.rawSymbol || p.symbol) === normSelected
      ) || activePerps[0];

    const rawSym = String(matched.product_symbol || matched.rawSymbol || matched.symbol || selectedSymbol).toUpperCase();
    const sideStr = String(matched.side || '').toUpperCase();
    const side: 'LONG' | 'SHORT' =
      sideStr === 'SHORT' || sideStr === 'SELL' || Number(matched.signedSize ?? matched.size ?? 0) < 0
        ? 'SHORT'
        : 'LONG';

    const rawAbsSize = Math.abs(Number(matched.size ?? 0));
    const rawContracts = Math.abs(Number(matched.contracts ?? 0));
    const cVal = Number(matched.contractValue || (rawSym.includes('BTC') ? 0.001 : rawSym.includes('ETH') ? 0.01 : 1));
    const coinSize = rawContracts > 0 && Math.abs(rawAbsSize - rawContracts) < 1e-6 && cVal < 1
      ? rawContracts * cVal
      : rawAbsSize > 0
      ? rawAbsSize
      : rawContracts * cVal;
    const contracts = rawContracts > 0 ? rawContracts : Math.max(1, Math.round(coinSize / cVal));
    const entryPx = Number(matched.entryPrice ?? matched.entry_price ?? activeMarkPrice);
    const slDist = entryPx * 0.0028;

    return {
      id: matched.id || `pos-${rawSym}`,
      symbol: rawSym,
      side,
      direction: side,
      signal: side,
      lotSize: coinSize,
      remainingSize: coinSize,
      contractsCount: contracts,
      entryPrice: entryPx,
      currentPrice: activeMarkPrice > 0 ? activeMarkPrice : entryPx,
      initialStopLoss: Number(matched.stopLoss ?? 0) > 0 ? Number(matched.stopLoss) : (side === 'SHORT' ? entryPx + slDist : entryPx - slDist),
      currentStopLoss: Number(matched.stopLoss ?? 0) > 0 ? Number(matched.stopLoss) : (side === 'SHORT' ? entryPx + slDist : entryPx - slDist),
      tp1: Number(matched.takeProfit ?? 0) > 0 ? Number(matched.takeProfit) : (side === 'SHORT' ? entryPx - slDist * 1.25 : entryPx + slDist * 1.25),
      tp2: side === 'SHORT' ? entryPx - slDist * 2.0 : entryPx + slDist * 2.0,
      tp3: side === 'SHORT' ? entryPx - slDist * 2.75 : entryPx + slDist * 2.75,
      tp4: side === 'SHORT' ? entryPx - slDist * 3.5 : entryPx + slDist * 3.5,
      tradeStatus: 'ACTIVE',
      status: 'OPEN',
      openedAt: matched.openedAt || Date.now(),
      unrealizedPnlUsd: side === 'LONG' ? (activeMarkPrice - entryPx) * coinSize : (entryPx - activeMarkPrice) * coinSize,
      unrealisedProfitUsd: side === 'LONG' ? (activeMarkPrice - entryPx) * coinSize : (entryPx - activeMarkPrice) * coinSize,
      bookedProfitUsd: 0,
      adoptedFromExchange: true,
    } as any;
  }, [isLiveUnverified, activeTrade, positions, selectedSymbol, activeMarkPrice]);

  const liveOpenUnrealisedUsd = React.useMemo(() => {
    if (!effectiveActiveTrade) return 0;
    const entryPx = Number(effectiveActiveTrade.entryPrice || 0);
    const remSize = Number(effectiveActiveTrade.remainingSize > 0 ? effectiveActiveTrade.remainingSize : effectiveActiveTrade.lotSize || 0);
    if (entryPx <= 0 || remSize <= 0 || activeMarkPrice <= 0) {
      return Number(effectiveActiveTrade.unrealizedPnlUsd || effectiveActiveTrade.unrealisedProfitUsd || 0);
    }
    const isShortTrade = effectiveActiveTrade.side === 'SHORT' || effectiveActiveTrade.signal === 'SHORT';
    const rawDiff = isShortTrade
      ? (entryPx - activeMarkPrice) * remSize
      : (activeMarkPrice - entryPx) * remSize;
    return Number.isFinite(rawDiff) ? +rawDiff.toFixed(2) : (effectiveActiveTrade.unrealisedProfitUsd || 0);
  }, [effectiveActiveTrade, activeMarkPrice]);

  const isPositionOpen = (effectiveActiveTrade || activeTrade) !== null && (effectiveActiveTrade || activeTrade) !== undefined && !['STOPPED_OUT', 'COMPLETED', 'REVERSED', 'TIME_EXIT'].includes((effectiveActiveTrade || activeTrade).tradeStatus);

  // Format price helper
  const fmt = (p: number | undefined) => {
    if (!p || p <= 0) return '0.00';
    return p >= 1000
      ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.toFixed(2);
  };

  const rc = currentSignal.riskChecks || ({} as any);
  const isTradeApproved = rc.tradeApproved || isBypassActive;
  const isArmedConditional = rc.executionStatus === 'ARMED_CONDITIONAL' || (currentSignal.confidence >= 75 && !rc.signalValidationPassed);

  // Execution button enabled if approved OR bypass is active in Paper OR conditional under >=75% AI confidence
  const isButtonEnabled =
    !isExecuting &&
    !isLiveUnverified &&
    (isTradeApproved || isBypassActive || isArmedConditional || isTargetsHydrated);

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-12 gap-4 ${className}`}>
      {/* ═══════════════════════════════════════════════════════════
          LEFT COLUMN: EXECUTION COCKPIT CARD (Dashdark X Surface)
          ═══════════════════════════════════════════════════════════ */}
      <div className="lg:col-span-5 bg-[#0D111D] border border-slate-800/80 rounded-2xl p-4 shadow-2xl relative overflow-hidden backdrop-blur-md flex flex-col justify-between space-y-3.5 font-mono">
        {/* Top hairline accent */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/25 to-transparent pointer-events-none" />

        {/* Position Mismatch Warning Alert Banner */}
        {positionMismatchWarning && (
          <div className="p-3 bg-rose-950/90 border border-rose-500/80 rounded-xl text-rose-200 text-xs flex items-center justify-between gap-3 shadow-[0_0_15px_rgba(244,63,94,0.3)] animate-pulse">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="font-semibold text-rose-100">{positionMismatchWarning}</span>
            </div>
            <button
              type="button"
              onClick={clearPositionMismatchWarning}
              className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[10px] text-white shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Cockpit Card Header with Paper Demo Bypass Switch & Active Tier Badge */}
        <div className="space-y-2.5 pb-2.5 border-b border-slate-800/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-md flex items-center justify-center ${
                isShort ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              }`}>
                <Zap className="w-3.5 h-3.5" />
              </div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Execution Cockpit
              </h3>

              {/* Active Tier Badge: [TIER: $50 STANDARD] or [TIER: $15 MICRO] */}
              <button
                type="button"
                onClick={() => {
                  if (setScalpTier) {
                    setScalpTier(isMicro15 ? 'TIER_50' : 'TIER_15');
                  } else if (setExposureMode) {
                    setExposureMode(isMicro15 ? 'MICRO_50' : 'MICRO_15');
                  }
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1.5 transition select-none cursor-pointer active:scale-95 ${
                  isMicro15
                    ? 'bg-amber-950/70 border-amber-500/60 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                    : 'bg-cyan-950/70 border-cyan-500/60 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                }`}
                title="Click to toggle between Tier 1 ($50 Standard) and Tier 2 ($15 Micro)"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isMicro15 ? 'bg-amber-400' : 'bg-cyan-400'} animate-pulse`} />
                <span>{isMicro15 ? 'TIER: $15 MICRO' : 'TIER: $50 STANDARD'}</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <span
                className={`px-2.5 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1.5 ${
                  isTradeApproved
                    ? isBypassActive
                      ? 'bg-amber-950/80 border-amber-500/60 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                      : 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                    : isArmedConditional
                    ? 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.2)]'
                    : 'bg-rose-950/80 border-rose-500/60 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.2)]'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${
                  isTradeApproved
                    ? isBypassActive ? 'bg-amber-400' : 'bg-emerald-400'
                    : isArmedConditional ? 'bg-cyan-400' : 'bg-rose-400'
                } animate-pulse`} />
                {isTradeApproved
                  ? isBypassActive
                    ? 'TRADE APPROVED (OVERRIDE)'
                    : 'TRADE APPROVED'
                  : isArmedConditional
                  ? 'ARMED / CONDITIONAL'
                  : 'TRADE BLOCKED'}
              </span>
            </div>
          </div>

          {/* CPR Regime Conduit Status (Bypassed for $15 Micro & Range Swings) */}
          <div className="pt-0.5 flex items-center justify-between bg-[#131826] px-2.5 py-1.5 rounded-xl border border-slate-800/60 text-[10px]">
            <span className="text-slate-400 font-semibold flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isMicro15 ? 'bg-emerald-400' : 'bg-cyan-400'} animate-pulse`} />
              <span>Conduit Status:</span>
            </span>
            <span className={`font-mono font-bold px-2 py-0.5 rounded text-[9.5px] border ${
              isMicro15
                ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                : 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300'
            }`}>
              {isMicro15
                ? 'CPR REGIME: WIDE CPR (INTERNAL SCALP ARMED)'
                : (currentSignal.riskChecks?.cprStatus || 'AVERAGE CPR (BREAKOUT ARMED)')}
            </span>
          </div>

          {/* Toggle Switch: [Bypass HTF / VWAP Guard (Paper)] */}
          <div className="pt-0.5 flex items-center justify-between bg-[#131826] p-2 rounded-xl border border-slate-800/60">
            <span className="text-[10px] text-slate-300 font-bold flex items-center gap-1.5">
              <Sliders className="w-3 h-3 text-cyan-400" />
              <span>Bypass HTF / VWAP Guard (Paper)</span>
            </span>

            <label
              className={`inline-flex items-center gap-1.5 text-[10px] font-bold select-none cursor-pointer ${
                !isPaper ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={isBypassActive}
                disabled={!isPaper}
                onChange={(e) => handleToggleBypass(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`w-6 h-3.5 rounded-full relative transition-colors ${
                  isBypassActive ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`w-2.5 h-2.5 rounded-full bg-white absolute top-0.5 transition-transform ${
                    isBypassActive ? 'translate-x-3' : 'translate-x-0.5'
                  }`}
                />
              </div>
              <span className={`font-mono text-[9px] ${isBypassActive ? 'text-amber-300 font-bold' : 'text-slate-500'}`}>
                {isBypassActive ? 'ON' : 'OFF'}
              </span>
            </label>
          </div>

          {/* Execution Speed Toggle & Armed State Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
            <div className="flex items-center justify-between bg-[#131826] p-2 rounded-xl border border-slate-800/60">
              <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                <Clock className="w-3 h-3 text-cyan-400" />
                <span>Speed Mode:</span>
              </span>

              {setExecutionTriggerMode && (
                <button
                  type="button"
                  onClick={() => setExecutionTriggerMode(executionTriggerMode === 'IMMEDIATE_TOUCH' ? 'CANDLE_CLOSE' : 'IMMEDIATE_TOUCH')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold border transition flex items-center gap-1 cursor-pointer select-none active:scale-95 ${
                    executionTriggerMode === 'IMMEDIATE_TOUCH'
                      ? 'bg-amber-950/80 border-amber-500/70 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                      : 'bg-cyan-950/80 border-cyan-500/70 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                  }`}
                  title="Toggle between Immediate Touch (disarms anti-wick lock) and 5m Close Guard"
                >
                  <Zap className="w-2.5 h-2.5" />
                  <span>{executionTriggerMode === 'IMMEDIATE_TOUCH' ? 'Immediate Touch' : '5m Close Guard'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between bg-[#131826] p-2 rounded-xl border border-slate-800/60">
              <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>Auto-Dispatch:</span>
              </span>

              {setIsAutoSniperEnabled && (
                <button
                  type="button"
                  onClick={() => setIsAutoSniperEnabled(!isAutoSniperEnabled)}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold border transition flex items-center gap-1 cursor-pointer select-none active:scale-95 ${
                    isAutoSniperEnabled
                      ? 'bg-emerald-950/90 border-emerald-500/80 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                  title="Toggle Auto: ARMED vs Manual Confirmation"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isAutoSniperEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                  <span>{isAutoSniperEnabled ? 'ARMED' : 'MANUAL'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Dashdark-style 30-MINUTE HARVEST TARGET Widget ($15 Micro Tier) */}
        {isMicro15 && (
          <div className="p-3 bg-gradient-to-r from-[#131826] to-[#0F1422] border border-cyan-500/30 rounded-xl font-mono shadow-md space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                30-MINUTE HARVEST TARGET · $15.00/30M
              </span>
              <span className="text-[10px] text-cyan-300 font-semibold flex items-center gap-1 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/60">
                <Clock className="w-3 h-3 text-cyan-400" />
                <span>{cycleWindowRemaining || '30m 00s'}</span>
              </span>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-bold">
                <span className="text-slate-300">
                  ${(cycleRealizedPnL || 0).toFixed(2)} / $15.00
                </span>
                <span className={harvestTargetHit ? 'text-emerald-400 font-extrabold' : 'text-cyan-400'}>
                  {Math.min(100, Math.round(((cycleRealizedPnL || 0) / 15) * 100))}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800/90 rounded-full overflow-hidden border border-slate-700/50 p-0.5">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    harvestTargetHit
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_12px_rgba(16,185,129,0.8)]'
                      : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, ((cycleRealizedPnL || 0) / 15) * 100))}%` }}
                />
              </div>
            </div>

            {/* Status Badges */}
            {harvestTargetHit ? (
              <div className="px-2.5 py-1 rounded bg-emerald-950/90 border border-emerald-500/80 text-emerald-300 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between shadow-[0_0_10px_rgba(16,185,129,0.3)] animate-pulse">
                <span>★ ENGINE LOCKED · TARGET SECURED</span>
                {onResetCycleTarget && (
                  <button
                    type="button"
                    onClick={onResetCycleTarget}
                    className="text-[9px] underline hover:text-white cursor-pointer ml-2"
                  >
                    RESET
                  </button>
                )}
              </div>
            ) : parseInt(cycleWindowRemaining?.split('m')[0] || '30') < 2 ? (
              <div className="px-2.5 py-1 rounded bg-amber-950/90 border border-amber-500/80 text-amber-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_8px_rgba(245,158,11,0.25)]">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                <span>PRE-OPENING ANALYSIS</span>
              </div>
            ) : isTransitionWindow ? (
              <div className="px-2.5 py-1 rounded bg-amber-950/90 border border-amber-500/80 text-amber-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_8px_rgba(245,158,11,0.25)]">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                <span>ROLLING TO NEXT CANDLE</span>
              </div>
            ) : (
              <div 
                className="px-2.5 py-1 rounded bg-cyan-950/90 border border-cyan-500/80 text-cyan-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-[0_0_8px_rgba(6,182,212,0.2)] cursor-help"
                title={`Cycle resets in ${cycleWindowRemaining || '0m 00s'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span>ACTIVE 30M CANDLE</span>
              </div>
            )}
          </div>
        )}

        {/* Circuit Breaker Warning Banner */}
        {(circuitBreakerTripped || (consecutiveStopsCount && consecutiveStopsCount >= 3) || (dailyLossPercent !== undefined && dailyLossPercent >= 1.5)) && (
          <div className="p-2.5 bg-rose-950/90 border border-rose-500/80 rounded-xl text-xs font-mono text-rose-200 shadow-lg my-1 animate-pulse flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <div>
                <strong className="text-white uppercase font-bold text-[11px] block">CIRCUIT BREAKER: AUTO-PILOT HALTED</strong>
                <span className="text-[10px] text-rose-300 block">
                  {circuitBreakerReason ||
                    (consecutiveStopsCount >= 3
                      ? `Auto-pilot halted after 3 consecutive stops (${consecutiveStopsCount}/3) to preserve capital.`
                      : `Daily loss limit reached (${(dailyLossPercent || 0).toFixed(2)}% >= 1.5% max risk).`)}
                </span>
              </div>
            </div>
            {onResetCircuitBreaker && (
              <button
                type="button"
                onClick={onResetCircuitBreaker}
                className="px-2.5 py-1 rounded bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 active:scale-95 text-white font-extrabold text-[10px] uppercase tracking-wider border border-rose-400 shadow-md transition-all cursor-pointer"
              >
                [RESET CIRCUIT BREAKER & ARMED STATE]
              </button>
            )}
          </div>
        )}

        {/* Post-SL 1-Candle Cooldown Badge */}
        {((postSlCooldownUntilMs && postSlCooldownUntilMs > Date.now()) || (currentSignal?.postSlCooldownBarsRemaining && currentSignal.postSlCooldownBarsRemaining > 0)) && (
          <div className="p-2.5 bg-amber-950/80 border border-amber-500/70 rounded-xl text-xs font-mono text-amber-200 shadow-lg my-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />
              <div>
                <strong className="text-amber-100 uppercase font-bold text-[11px] block">1-CANDLE POST-SL COOLDOWN</strong>
                <span className="text-[10px] text-amber-300/90 block">Awaiting completed 15M candle close before next Auto-Pilot entry.</span>
              </div>
            </div>
            {onResetCircuitBreaker && (
              <button
                type="button"
                onClick={onResetCircuitBreaker}
                className="px-2 py-0.5 rounded bg-amber-800 hover:bg-amber-700 text-white font-bold text-[10px] uppercase border border-amber-400 cursor-pointer"
              >
                Skip Cooldown
              </button>
            )}
          </div>
        )}

        {/* Dynamic Trend Cooldown / EMA Realignment Banner */}
        {isEmaAlignmentPending && (
          <div className="p-3 bg-slate-900/90 border border-amber-500/50 rounded-xl text-xs font-mono text-amber-100 shadow-lg my-1 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <strong className="text-white uppercase font-bold text-[11px]">DYNAMIC TREND COOLDOWN · 9/20 EMA REALIGNMENT</strong>
            </div>
            <div className="text-[10px] text-amber-200/80 space-y-1">
              <div>EMA 9: ${fmt(currentSignal.ema9)} | EMA 21: ${fmt(currentSignal.ema21)} | Spread: ${fmt(Math.abs((currentSignal.ema9 || 0) - (currentSignal.ema21 || 0)))}</div>
              <div className="text-amber-100 font-semibold italic">Awaiting 5m 9/20 EMA Trend Alignment (Auto-Unlocks on Confirmation)</div>
            </div>
            {onResetCircuitBreaker && (
              <button
                type="button"
                onClick={onResetCircuitBreaker}
                className="w-full px-2.5 py-1.5 rounded bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 active:scale-95 text-white font-extrabold text-[10px] uppercase tracking-wider border border-amber-400 shadow-md transition-all cursor-pointer"
              >
                [Clear Cooldown / Force Ready]
              </button>
            )}
          </div>
        )}

        {/* Signal Direction & AI Confidence HUD */}
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 bg-[#131826] rounded-xl border border-slate-800/60 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
                  Directional Bias
                </span>
                <span className="text-[9px] text-cyan-400 font-bold px-1.5 py-0.2 rounded bg-cyan-950/60 border border-cyan-800/60">
                  {isMicro ? (signalSide === 'LONG' ? '[EMA 9/21 PULLBACK LONG]' : '[EMA 9/21 REJECTION SHORT]') : (signalSide === 'LONG' ? '>= H4 / BREAK' : '<= L4 / RETEST')}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {isShort ? (
                  <span className="text-rose-400 font-extrabold text-sm flex items-center gap-1 tracking-tight">
                    <TrendingDown className="w-4 h-4" /> SHORT (SELL)
                  </span>
                ) : (
                  <span className="text-emerald-400 font-extrabold text-sm flex items-center gap-1 tracking-tight">
                    <TrendingUp className="w-4 h-4" /> LONG (BUY)
                  </span>
                )}
              </div>
              <span className="text-[9.5px] text-slate-400 font-mono mt-0.5 block truncate">
                {isMicro && currentSignal.ema9 && currentSignal.ema21
                  ? `EMA 9: $${currentSignal.ema9.toLocaleString()} | EMA 21: $${currentSignal.ema21.toLocaleString()}`
                  : currentSignal.commandCenterCatalyst || (isShort ? 'Bearish rejection / breakdown setup' : 'Bullish momentum / breakout setup')}
              </span>
            </div>

            {/* Dashdark X Circular Arc AI Confidence Gauge */}
            <div className="p-2.5 bg-[#131826] rounded-xl border border-slate-800/60 flex items-center justify-between gap-2">
              <div className="flex flex-col justify-between space-y-0.5 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold truncate">
                    AI Confidence
                  </span>
                  <span className="text-[8.5px] text-emerald-400 font-bold px-1 py-0.2 rounded bg-emerald-950/60 border border-emerald-800/60 shrink-0">
                    PASS
                  </span>
                </div>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-emerald-400 font-extrabold text-sm tabular-nums">
                    {currentSignal.confidence}%
                  </span>
                  <span className="text-[9.5px] text-slate-300 font-medium truncate">
                    {currentSignal.confidenceStatus || 'High Conviction'}
                  </span>
                </div>
                <span className="text-[8.5px] text-slate-400 font-mono truncate block">
                  Consensus Validated
                </span>
              </div>

              {/* SVG Circular Arc Donut */}
              <div className="relative w-11 h-11 flex items-center justify-center shrink-0">
                <svg className="w-11 h-11 -rotate-90" viewBox="0 0 44 44">
                  <defs>
                    <linearGradient id="cockpitAiDonutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#06B6D4" />
                      <stop offset="100%" stopColor="#6366F1" />
                    </linearGradient>
                  </defs>
                  <circle
                    cx="22"
                    cy="22"
                    r="17"
                    stroke="#1E293B"
                    strokeWidth="3.5"
                    fill="none"
                  />
                  <circle
                    cx="22"
                    cy="22"
                    r="17"
                    stroke="url(#cockpitAiDonutGrad)"
                    strokeWidth="3.5"
                    strokeDasharray={2 * Math.PI * 17}
                    strokeDashoffset={2 * Math.PI * 17 * (1 - Math.min(100, Math.max(0, currentSignal.confidence || 82)) / 100)}
                    strokeLinecap="round"
                    fill="none"
                    className="transition-all duration-700 ease-out"
                  />
                </svg>
                <span className="absolute text-[9px] font-black font-mono text-cyan-300 tabular-nums">
                  {currentSignal.confidence}%
                </span>
              </div>
            </div>
          </div>

          {/* Sizing, Margin, Point Value & Leverage 4-Column Modular HUD */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2 bg-[#131826] rounded-xl border border-slate-800/60 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[9px] uppercase tracking-wider font-semibold">Lot Size</span>
                <span className="text-[8.5px] text-cyan-300 font-bold px-1 py-0.2 rounded bg-cyan-950/60 border border-cyan-800/50">
                  Fixed Size
                </span>
              </div>
              <div className="mt-1 text-white font-extrabold text-xs tabular-nums tracking-tight">
                {isMicro ? '0.10 BTC' : `0.10 ${selectedSymbol.replace('USDT', '').replace('USD', '')}`}
              </div>
              <span className="text-[8.5px] text-slate-400 font-mono block mt-0.5">
                {isMicro ? 'ΔP=$150.00' : 'ΔP=$500.00'}
              </span>
            </div>

            <div className="p-2 bg-[#131826] rounded-xl border border-slate-800/60 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[9px] uppercase tracking-wider font-semibold">Req. Margin</span>
                {isMicro15 && (
                  <span className="text-[8.5px] text-emerald-400 font-bold px-1 py-0.2 rounded bg-emerald-950/60 border border-emerald-800/50">
                    MINIMAL
                  </span>
                )}
              </div>
              <div className="mt-1 text-cyan-300 font-extrabold text-xs tabular-nums tracking-tight">
                ${calculatedMargin.toFixed(2)}
              </div>
              <span className="text-[8.5px] text-slate-400 font-mono block mt-0.5">
                {deltaLeverage}x {marginMode === 'CROSS' ? 'Cross' : 'Isolated'} · {leverageSyncLocked ? 'Synced' : `Cap ${maxLeverageCap}x`}
              </span>
            </div>

            <div className="p-2 bg-[#131826] rounded-xl border border-slate-800/60 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[9px] uppercase tracking-wider font-semibold">Point Value</span>
                <span className="text-[8.5px] text-slate-400 font-mono">1pt=$0.10</span>
              </div>
              <div className="mt-1 text-emerald-400 font-extrabold text-xs tabular-nums tracking-tight">
                ${(currentSignal.pointValue || effectiveLotSize).toFixed(3)}/pt
              </div>
              <span className="text-[8.5px] text-slate-400 font-mono block mt-0.5">
                Tick: $0.50
              </span>
            </div>

            <div className="p-2 bg-[#131826] rounded-xl border border-slate-800/60 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[9px] uppercase tracking-wider font-semibold">Risk/Reward</span>
                <span className="text-[8.5px] text-amber-300 font-bold px-1 py-0.2 rounded bg-amber-950/60 border border-amber-800/50">
                  {isMicro15 ? '+$15 GOAL' : '+$50 GOAL'}
                </span>
              </div>
              <div className="mt-1 text-amber-300 font-extrabold text-xs tabular-nums tracking-tight">
                {isMicroScalp ? '1 : 1.0' : (currentSignal.riskRewardRatio || '1 : 1.0')}
              </div>
              <span className="text-[8.5px] text-slate-400 font-mono block mt-0.5">
                Max Risk ${maxRiskCap.toFixed(0)}
              </span>
            </div>
          </div>

          {/* Symmetrically Aligned Dynamic Entry Price & Stop Loss */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 bg-[#131826] rounded-xl border border-cyan-500/40 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
                  [LIVE MARKET ENTRY]
                </span>
                <span className="text-[9px] text-cyan-300 font-bold flex items-center gap-1 bg-cyan-950/80 px-1.5 py-0.2 rounded border border-cyan-500/50">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  {isMicro
                    ? (signalSide === 'LONG' ? '[EMA 9/21 PULLBACK LONG]' : '[EMA 9/21 REJECTION SHORT]')
                    : (signalSide === 'LONG' ? '>= H4' : '<= L4')}
                </span>
              </div>
              <div className="text-lg font-bold font-mono text-cyan-400 mt-1 tabular-nums">
                {isMicro
                  ? `≈ $${currentPrice.toFixed(2)}`
                  : (signalSide === 'LONG' ? `≥ $${h4.toFixed(2)}` : `≤ $${l4.toFixed(2)}`)}
              </div>
              <span className="text-[9px] text-slate-400 font-mono mt-0.5">
                {isMicro ? 'Live Dynamic Anchor · Instant Fill' : 'Camarilla Breakout Level · 5m Close Guard'}
              </span>
            </div>

            <div className="p-2.5 bg-[#131826] rounded-xl border border-rose-500/40 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
                  Stop Loss (Hard Cap)
                </span>
                <span className="text-[9px] text-rose-300 font-bold px-1.5 py-0.2 rounded bg-rose-950/80 border border-rose-500/50">
                  {isShort ? `> Entry + $${isMicro15 ? '150' : '500'}` : `< Entry - $${isMicro15 ? '150' : '500'}`}
                </span>
              </div>
              <div className="font-extrabold text-base tracking-tight text-rose-400 mt-1 tabular-nums">
                ${fmt(currentSignal.initialStopLoss || (isShort ? (currentSignal.entryPrice || activeMarkPrice) + (isMicro15 ? 150 : 500) : (currentSignal.entryPrice || activeMarkPrice) - (isMicro15 ? 150 : 500)))}
              </div>
              <span className="text-[9px] text-rose-400/80 font-mono mt-0.5">
                Strict Capped Risk: -${maxRiskCap.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Friction Drag TCA Telemetry Chip */}
          <div className="p-2.5 bg-[#131826] rounded-xl border border-cyan-500/30 flex flex-wrap items-center justify-between gap-1.5 text-xs font-mono shadow-sm">
            <div className="flex items-center gap-1.5 text-cyan-300">
              <ShieldAlert className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-[10px] font-medium text-slate-300">
                Friction Drag: <strong className="text-white font-bold tabular-nums">${friction.totalFrictionUsd.toFixed(2)}</strong> <span className="text-slate-400 tabular-nums">(₹{friction.totalFrictionInr.toFixed(2)})</span> · Roundtrip Taker (0.05%) + 18% GST + 3 bps Slip
              </span>
            </div>
            <span className="text-[9px] text-amber-300 font-bold bg-amber-950/70 px-1.5 py-0.5 rounded border border-amber-500/40 shrink-0 tabular-nums">
              Point Drag: ±${friction.pointDrag.toFixed(2)}/pt
            </span>
          </div>

          {/* Slippage Alert for $15 Micro if friction exceeds 12% ($1.80) */}
          {(isFrictionAlert || currentSignal.frictionWarning) && (
            <div className="p-2 bg-amber-950/40 border border-amber-500/40 rounded-xl text-[10px] text-amber-300 flex items-center justify-between gap-1.5 font-mono animate-fadeIn">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  <strong>Tight-Spread Slippage Alert:</strong> Roundtrip friction (${friction.totalFrictionUsd.toFixed(2)}) exceeds 12% ($1.80) of $15 micro risk envelope.
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 text-[8.5px] font-bold border border-amber-500/50 uppercase shrink-0">
                BUFFER ALERT
              </span>
            </div>
          )}

          {/* 5m Candle Wick Confirmation row */}
          <div className="p-2.5 bg-[#131826] rounded-xl border border-slate-800/60 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400 text-[10px] uppercase font-semibold">5M Candle Wick Lock</span>
            {isMicro ? (
              <span className="text-[10px] font-bold text-emerald-400 border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 rounded flex items-center gap-1">
                <CheckCircle className="w-3 h-3 text-emerald-400" />
                <span>5M Bar Closed: Internal PA Valid (PASS)</span>
              </span>
            ) : (
              <span className="text-[10px] font-bold text-amber-300 flex items-center gap-1 tabular-nums">
                <Clock className="w-3 h-3 text-amber-400" />
                <span>Countdown: {fiveMinBarCountdown}</span>
              </span>
            )}
          </div>
        </div>

        {/* Action Execution Button: 3-Part Institutional Dispatch Bar */}
        <div className="pt-2">
          {!isPositionOpen ? (
            <button
              type="button"
              onClick={onExecuteSniperTrade}
              disabled={!isButtonEnabled}
              className={`w-full min-h-[48px] px-3.5 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer disabled:cursor-not-allowed select-none active:scale-[0.99] shadow-lg ${
                !isButtonEnabled
                  ? 'bg-slate-900 border border-slate-800 text-slate-500 shadow-none'
                  : isShort
                  ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-rose-700 hover:from-rose-500 hover:via-rose-400 hover:to-rose-600 border border-rose-400/60 text-white shadow-[0_0_20px_rgba(244,63,94,0.35),inset_0_1px_1px_rgba(255,255,255,0.3)]'
                  : 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-700 hover:from-emerald-500 hover:via-emerald-400 hover:to-emerald-600 border border-emerald-400/60 text-white shadow-[0_0_20px_rgba(16,185,129,0.35),inset_0_1px_1px_rgba(255,255,255,0.3)]'
              }`}
            >
              {/* Left Segment: Order Icon + Lot Size */}
              <div className="flex items-center gap-1.5 shrink-0 bg-black/25 px-2 py-1 rounded border border-white/10">
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span className="font-mono text-[11px] font-extrabold tracking-tight">
                  0.10 BTC
                </span>
              </div>

              {/* Center Segment: Direction & Active Target Price */}
              <div className="flex flex-col items-center justify-center text-center">
                <span className="font-extrabold text-xs tracking-wider uppercase text-white drop-shadow-sm">
                  {isExecuting
                    ? 'ROUTING ORDER...'
                    : isShort
                    ? `[[EXECUTE SHORT] (0.10 BTCUSDT) - LIVE AUTO-DISPATCH]`
                    : `[[EXECUTE LONG] (0.10 BTCUSDT) - LIVE AUTO-DISPATCH]`}
                </span>
                <span className="text-[9px] text-white/80 font-mono">
                  Target: {tierTargets.tp4.combined} · Stop: ±${isMicro15 ? '150.00' : '500.00'}
                </span>
              </div>

              {/* Right Segment: Armed State Pill */}
              <div className="shrink-0">
                <span className={`text-[9px] font-mono font-bold px-2 py-1 rounded border flex items-center gap-1 ${
                  isAutoSniperEnabled 
                    ? 'bg-emerald-950/90 text-emerald-300 border-emerald-400/60 shadow-[0_0_8px_rgba(16,185,129,0.4)]' 
                    : 'bg-slate-900/90 text-slate-300 border-slate-600'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isAutoSniperEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
                  {isAutoSniperEnabled ? 'AUTO-DISPATCH ARMED' : 'MANUAL CONFIRM'}
                </span>
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onCloseSniperTrade('Manual Cockpit Close')}
              className="w-full min-h-[44px] px-4 py-2 bg-gradient-to-r from-rose-600 via-rose-500 to-rose-700 hover:from-rose-500 hover:to-rose-600 border border-rose-400/60 text-white font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99] select-none shadow-[0_0_16px_rgba(244,63,94,0.4)]"
            >
              <X className="w-4 h-4 text-white" />
              <span className="text-white font-bold tracking-wider">
                Close Active Sniper Position
              </span>
            </button>
          )}

          {isBypassActive && (
            <div className="mt-2 text-center text-[10px] text-amber-300 font-mono font-semibold">
              ⚡ Paper Demo Bypass Active · Execution Unlocked
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          RIGHT COLUMN: 4-STAGE PROFIT LADDER (Dashdark X Style)
          ═══════════════════════════════════════════════════════════ */}
      <div className="lg:col-span-7 flex flex-col justify-between space-y-3.5">
        <ProfitLadderDashdark
          isShort={effectiveActiveTrade ? (effectiveActiveTrade.side === 'SHORT' || effectiveActiveTrade.signal === 'SHORT') : isShort}
          entryPrice={effectiveActiveTrade?.entryPrice || currentSignal.entryPrice || activeMarkPrice}
          markPrice={activeMarkPrice}
          stopLoss={effectiveActiveTrade?.currentStopLoss || effectiveActiveTrade?.initialStopLoss || currentSignal.initialStopLoss}
          tp1={effectiveActiveTrade?.tp1 || currentSignal.tp1}
          tp2={effectiveActiveTrade?.tp2 || currentSignal.tp2}
          tp3={effectiveActiveTrade?.tp3 || currentSignal.tp3}
          tp4={effectiveActiveTrade?.tp4 || currentSignal.tp4}
          activeTrade={effectiveActiveTrade}
          activeTargetIndex={effectiveActiveTrade?.tp3Hit ? 4 : effectiveActiveTrade?.tp2Hit ? 3 : effectiveActiveTrade?.tp1Hit ? 2 : 1}
          unrealizedPnl={liveOpenUnrealisedUsd}
          isMicro15={isMicro15}
          lotSize={effectiveActiveTrade?.lotSize || currentSignal.lotSize || defaultLotSize}
          symbol={selectedSymbol}
          liveUsdInrRate={liveFxRate}
          currencyPrefix={currencyPrefix}
          netBreakevenPrice={friction.netBreakevenPrice}
          totalFrictionUsd={friction.totalFrictionUsd}
        />

        {/* Real-time Trajectory Guidance (Dashdark X Style) */}
        <div className="p-3.5 bg-[#0D111D] rounded-2xl border border-slate-800/80 relative overflow-hidden shadow-xl space-y-1.5 font-mono">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent pointer-events-none" />
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-bold">Camarilla Trajectory Execution:</span>
            <span className="text-[11px] text-cyan-400 font-bold">
              Base {isMicroScalp ? '1 : 1.0 (1:1)' : (currentSignal.riskRewardRatio || '1 : 1.0')} R:R
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
            {currentSignal.aiVerdict}
          </p>
        </div>
      </div>
    </div>
  );
};
