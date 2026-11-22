import { getMarketTicker, resolveLiveUsdInrRate, formatInrFirstPnl } from '../utils/marketUtils';
import { computeCamarillaLevels, formatCamarillaPrice } from '../utils/camarillaUtils';
import { computeDailyFibonacciLevels } from '../utils/fibonacciUtils';
import { getDailySessionAnchor } from '../utils/dailyAnchorUtils';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MarketTicker, TradingMode, SniperSignal, SniperActiveTrade, SniperLogEntry, SniperExposureMode, SniperScalpTier, AiAnalysisResult, SniperExecutionTriggerMode } from '../types';
import { CamarillaPriceGauge } from './CamarillaPriceGauge';
import { ProfitLadderDashdark } from './ProfitLadderDashdark';
import { useAiMatrixCorrelation, evaluateLockedSignalValidity } from '../context/AiMatrixCorrelationContext';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { useLayoutPriority } from '../context/LayoutPriorityContext';
import { CollapsibleTierPanel } from './CollapsibleTierPanel';
import { 
  Crosshair, 
  Zap, 
  ShieldCheck, 
  CheckCircle2, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  ArrowRight, 
  Check, 
  X, 
  Target,
  Compass,
  ArrowDown,
  ArrowUp,
  MapPin,
  Clock,
  Cpu,
  RefreshCw,
  Radio,
  ChevronDown,
  ChevronUp,
  Trash2,
  Landmark,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  Terminal,
} from 'lucide-react';

function normalizePerpSymbol(sym?: string): string {
  const upper = String(sym || '').toUpperCase().trim();
  if (!upper) return '';
  if (upper.endsWith('USD') && !upper.endsWith('USDT')) {
    return `${upper}T`;
  }
  return upper;
}

interface IntradaySniperEngineProps {
  markets: Record<string, MarketTicker>;
  selectedSymbol: string;
  setSelectedSymbol: (sym: string) => void;
  tradingMode: TradingMode;
  currentSignal: SniperSignal;
  activeTrade: SniperActiveTrade | null;
  isAutoSniperEnabled: boolean;
  setIsAutoSniperEnabled: (val: boolean) => void;
  isExecuting: boolean;
  tradeLogs: SniperLogEntry[];
  onExecuteSniperTrade: () => void;
  onCloseSniperTrade: (reason?: string) => void;
  onClearTradeLogs?: () => void;
  currencyPrefix?: string;
  exchangeRate?: number;
  packetGap?: number;
  directionMode?: 'AUTO' | 'LONG' | 'SHORT';
  setDirectionMode?: (mode: 'AUTO' | 'LONG' | 'SHORT') => void;
  exposureMode?: SniperExposureMode;
  setExposureMode?: (mode: SniperExposureMode) => void;
  scalpTier?: SniperScalpTier;
  setScalpTier?: (tier: SniperScalpTier) => void;
  aiAnalysis?: AiAnalysisResult | null;
  isAiLoading?: boolean;
  onRefreshAiAnalysis?: (symbol: string, timeframe: string) => Promise<void>;
  signalSource?: 'COMMAND_CENTER' | 'QUANT_ALGO';
  setSignalSource?: (source: 'COMMAND_CENTER' | 'QUANT_ALGO') => void;
  isLiveApiAuthenticated?: boolean;
  onOpenSettings?: () => void;
  isSignalStandby?: boolean;
  onConfirmSignal?: () => void;
  onRefreshSignal?: () => void;
  pairCooldowns?: Record<string, number>;
  consecutiveStopsCount?: number;
  simulate5mCandleClose?: (symbol: string, forcedClose?: number) => void;
  clearPairCooldown?: (symbol: string) => void;
  bypassHtfFilter?: boolean;
  setBypassHtfFilter?: (val: boolean) => void;
  executionTriggerMode?: SniperExecutionTriggerMode;
  setExecutionTriggerMode?: (mode: SniperExecutionTriggerMode) => void;
  cycleRealizedPnL?: number;
  harvestTargetHit?: boolean;
  cycleWindowRemaining?: string;
  isTransitionWindow?: boolean;
}

const LiveFiveMinCountdown: React.FC = React.memo(() => {
  const [label, setLabel] = useState<string>(() => {
    const ms = 300000 - (Date.now() % 300000);
    return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')} to close`;
  });

  useEffect(() => {
    const update = () => {
      const ms = 300000 - (Date.now() % 300000);
      setLabel(`${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')} to close`);
    };
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return <>{label}</>;
});

interface SignalFreshnessHeaderBadgeProps {
  effectiveSignalTimestamp: number;
  signalGenTimeFormatted: string;
  activeSignalValidity: ReturnType<typeof evaluateLockedSignalValidity>;
  canRefresh: boolean;
  onRefresh: () => void;
}

const SignalFreshnessHeaderBadge: React.FC<SignalFreshnessHeaderBadgeProps> = React.memo(({
  effectiveSignalTimestamp,
  signalGenTimeFormatted,
  activeSignalValidity,
  canRefresh,
  onRefresh,
}) => {
  const [ageTick, setAgeTick] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setAgeTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const signalAgeFormatted = useMemo(() => {
    const elapsedSec = Math.max(0, Math.floor((ageTick - effectiveSignalTimestamp) / 1000));
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    return mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
  }, [ageTick, effectiveSignalTimestamp]);

  return (
    <>
      <span className="badge-delta badge-delta-standby font-mono-numbers">
        Gen: {signalGenTimeFormatted} ({signalAgeFormatted} ago)
      </span>
      <span
        className={`badge-delta font-mono-numbers ${
          activeSignalValidity.breachType === 'TP1_COMPLETED' || activeSignalValidity.breachType === 'TP4_COMPLETED'
            ? 'badge-delta-live'
            : activeSignalValidity.status === 'OVERDUE'
            ? 'badge-delta-danger animate-pulse'
            : activeSignalValidity.status === 'AGING'
            ? 'badge-delta-paper'
            : 'badge-delta-live'
        }`}
        title={activeSignalValidity.reason || 'Locked signal freshness'}
      >
        {activeSignalValidity.breachType === 'SL_INVALIDATED'
          ? `✕ SL HIT · SETUP INVALIDATED${(activeSignalValidity.cooldownRemainingSec || 0) > 0 ? ` (${activeSignalValidity.cooldownRemainingSec}s)` : ''}`
          : activeSignalValidity.breachType === 'TP1_COMPLETED' || activeSignalValidity.breachType === 'TP4_COMPLETED'
          ? `✓ TP1 REACHED · SETUP COMPLETED${(activeSignalValidity.cooldownRemainingSec || 0) > 0 ? ` (${activeSignalValidity.cooldownRemainingSec}s)` : ''}`
          : activeSignalValidity.status === 'OVERDUE'
          ? '⚠ OVERDUE · STALE SETUP'
          : activeSignalValidity.status === 'AGING'
          ? `◐ AGING (${signalAgeFormatted})`
          : `● FRESH (${signalAgeFormatted})`}
      </span>
      {canRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="btn-delta-sm btn-danger"
          title="Re-anchor locked signal levels to live market price"
        >
          <RefreshCw className="w-3 h-3" />
          <span>Refresh Signal</span>
        </button>
      )}
    </>
  );
});

export const IntradaySniperEngine: React.FC<IntradaySniperEngineProps> = React.memo(({
  markets,
  selectedSymbol,
  setSelectedSymbol,
  tradingMode,
  currentSignal,
  activeTrade,
  isAutoSniperEnabled,
  setIsAutoSniperEnabled,
  isExecuting,
  tradeLogs,
  onExecuteSniperTrade,
  onCloseSniperTrade,
  onClearTradeLogs,
  currencyPrefix = '$',
  exchangeRate = 1,
  packetGap = 350,
  directionMode = 'AUTO',
  setDirectionMode,
  exposureMode: propExposureMode,
  setExposureMode: propSetExposureMode,
  scalpTier: propScalpTier,
  setScalpTier: propSetScalpTier,
  aiAnalysis,
  isAiLoading = false,
  onRefreshAiAnalysis,
  signalSource = 'COMMAND_CENTER',
  setSignalSource,
  isLiveApiAuthenticated = false,
  onOpenSettings,
  isSignalStandby = false,
  onConfirmSignal,
  onRefreshSignal,
  pairCooldowns = {},
  consecutiveStopsCount = 0,
  simulate5mCandleClose,
  clearPairCooldown,
  bypassHtfFilter = false,
  setBypassHtfFilter,
  executionTriggerMode = 'CANDLE_CLOSE',
  setExecutionTriggerMode,
  cycleRealizedPnL = 0,
  harvestTargetHit = false,
  cycleWindowRemaining = '30m 00s',
  isTransitionWindow = false,
}) => {
  const isPaper = tradingMode === 'PAPER';
  const isBypassActive = Boolean(isPaper && (bypassHtfFilter || currentSignal.riskChecks.bypassActive));
  const isLiveUnverified = tradingMode === 'LIVE' && !isLiveApiAuthenticated;
  const {
    lockedActiveSignal,
    signalValidity: contextSignalValidity,
    refreshLockedSignal,
  } = useAiMatrixCorrelation();
  const {
    defaultLotSize,
    lotSizingMode,
    maxRiskPerTradePct,
    maxLeverageCap,
    marginMode,
    leverageSyncLocked,
    setLotSizingMode,
    getContractsCount,
  } = useCapitalAllocation();
  const { effectiveCompact, syncGeneration, globalTargetExpanded } = useLayoutPriority();

  const [localExposureMode, setLocalExposureMode] = useState<SniperExposureMode>('MACRO');
  const [localStandbyAfterExit, setLocalStandbyAfterExit] = useState<boolean>(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('5m');
  const [isAiDiagnosticsOpen, setIsAiDiagnosticsOpen] = useState<boolean>(false);
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState<number>(0);
  const [validityTick, setValidityTick] = useState<number>(() => Date.now());

  useEffect(() => {
    if (effectiveCompact || globalTargetExpanded === false) {
      setIsAiDiagnosticsOpen(false);
    } else if (globalTargetExpanded === true) {
      setIsAiDiagnosticsOpen(true);
    }
  }, [effectiveCompact, syncGeneration, globalTargetExpanded]);

  useEffect(() => {
    const interval = setInterval(() => {
      setValidityTick(Date.now());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const currentPairCooldown = pairCooldowns[selectedSymbol] || 0;
  const isPairInCooldown = Date.now() < currentPairCooldown;

  useEffect(() => {
    if (!isPairInCooldown) {
      setCooldownRemainingSec(0);
      return;
    }
    const update = () => {
      const rem = Math.max(0, Math.ceil((currentPairCooldown - Date.now()) / 1000));
      setCooldownRemainingSec(rem);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [currentPairCooldown, isPairInCooldown]);

  const exposureMode: SniperExposureMode = propExposureMode || currentSignal.exposureMode || localExposureMode;
  const handleSetExposureMode = (mode: SniperExposureMode) => {
    setLocalExposureMode(mode);
    setLocalStandbyAfterExit(false);
    if (onConfirmSignal) onConfirmSignal();
    if (propSetExposureMode) propSetExposureMode(mode);
  };

  const curMarket = getMarketTicker(markets, selectedSymbol);
  const livePrice = curMarket.markPrice;

  // Dynamically resolve live USD/INR exchange rate from Delta Exchange India market feeds (fallback to active currency rate)
  const { rate: liveUsdInrRate, source: fxSource } = useMemo(
    () => resolveLiveUsdInrRate(markets, exchangeRate),
    [markets, exchangeRate]
  );

  // Real-time price movement flash indicator
  const [priceFlash, setPriceFlash] = useState<'UP' | 'DOWN' | null>(null);
  const prevPriceRef = useRef<number>(livePrice);

  useEffect(() => {
    if (prevPriceRef.current !== livePrice) {
      const dir = livePrice > prevPriceRef.current ? 'UP' : 'DOWN';
      setPriceFlash(dir);
      const timer = setTimeout(() => setPriceFlash(null), 600);
      prevPriceRef.current = livePrice;
      return () => clearTimeout(timer);
    }
  }, [livePrice]);

  // Signal & Position Direction Resolution
  const effectiveSignal: 'LONG' | 'SHORT' = activeTrade ? activeTrade.signal : currentSignal.signal;
  const isShort = effectiveSignal === 'SHORT';

  // Single Source of Truth Daily Session Anchor (Delta Exchange India UTC 00:00)
  const dailyAnchor = useMemo(
    () => getDailySessionAnchor(curMarket, livePrice),
    [curMarket, livePrice]
  );

  // Compute live Camarilla Pivot levels (H1–H6, L1–L6) for HUD reference display
  const computedCamarilla = useMemo(() => {
    return computeCamarillaLevels(
      curMarket,
      effectiveSignal,
      selectedTimeframe,
      undefined,
      dailyAnchor
    ).camarilla;
  }, [curMarket, effectiveSignal, selectedTimeframe, dailyAnchor]);
  const camarilla = activeTrade?.camarilla || currentSignal.camarilla || computedCamarilla;

  const fmtPrice = (val: number) => {
    const decimals = livePrice < 1 ? 4 : livePrice < 10 ? 3 : 2;
    return val.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  // ═══════════════════════════════════════════════════════════
  // POSITION & DYNAMIC TARGET HYDRATION GATES:
  // 1. Stale Level Clearance on Inactive / Standby Signals:
  //    - If no active trade is running AND the signal is inactive, rejected by risk checks,
  //      below 75% conviction, or in 'STANDBY / SCANNING':
  //      * Reset Entry, Stop Loss, and TP1–TP4 display prices to "---"
  //      * Clear target distance and percentage indicators to "---"
  //      * Set Target Trajectory continuum bar and progress indicators to 0% standby
  //      * Keep active Camarilla reference levels (H4, H3, L3, L4, H5, L5) visible on HUD
  // 2. Dynamic Target Hydration:
  //    - Only populate Entry, SL, and TP1–TP4 when a new signal meets >= 75% conviction
  //      and passes all pre-entry risk protection gates (or while an active position is open).
  //    - Upon position exit (TP hit, SL triggered, or manual close), immediately wipe levels to "---".
  // ═══════════════════════════════════════════════════════════
  const isPositionOpen = Boolean(
    activeTrade &&
    activeTrade.status !== 'CLOSED' &&
    !['STOPPED_OUT', 'COMPLETED', 'REVERSED', 'TIME_EXIT'].includes(activeTrade.tradeStatus)
  );
  const isTradeForSelected = Boolean(
    isPositionOpen &&
    activeTrade &&
    normalizePerpSymbol(activeTrade.symbol) === normalizePerpSymbol(selectedSymbol)
  );

  // Detect position exit and immediately wipe levels to "---"
  const prevTradeIdRef = useRef<string | null>(isTradeForSelected && activeTrade ? activeTrade.id : null);
  useEffect(() => {
    const curId = isTradeForSelected && activeTrade ? activeTrade.id : null;
    if (prevTradeIdRef.current && !curId) {
      setLocalStandbyAfterExit(true);
    } else if (curId) {
      setLocalStandbyAfterExit(false);
    }
    prevTradeIdRef.current = curId;
  }, [isTradeForSelected, activeTrade]);

  const effectiveStandby = Boolean(
    !isAutoSniperEnabled && !isTradeForSelected && (isSignalStandby || localStandbyAfterExit || currentSignal.isStandby)
  );

  const effectiveExposureMode: SniperExposureMode = isTradeForSelected && activeTrade
    ? (activeTrade.exposureMode || exposureMode)
    : exposureMode;
  const activeScalpTier: SniperScalpTier = isTradeForSelected && activeTrade
    ? (activeTrade.scalpTier || (activeTrade.exposureMode === 'MICRO_15' ? 'TIER_15' : 'TIER_50'))
    : (propScalpTier || currentSignal.scalpTier || (effectiveExposureMode === 'MICRO_15' ? 'TIER_15' : 'TIER_50'));
  const isMicro15 = activeScalpTier === 'TIER_15' || effectiveExposureMode === 'MICRO_15';
  const isMicro50 = activeScalpTier === 'TIER_50' || effectiveExposureMode === 'MICRO_50';
  const isMicroScalp = isMicro15 || isMicro50;

  const effectiveLotSize = isTradeForSelected && activeTrade
    ? activeTrade.lotSize
    : currentSignal.lotSize > 0
    ? currentSignal.lotSize
    : defaultLotSize;
  const effectiveContractsCount =
    currentSignal.contractsCount ?? getContractsCount(selectedSymbol, effectiveLotSize);
  const cleanSymbolBase = selectedSymbol.replace('USDT', '').replace('USD', '') || 'BTC';

  const deltaPrice = (isMicro15 ? 15 : 50) / Math.max(0.001, effectiveLotSize);

  // Dynamic Trade Parameters Calculation:
  // Populate Entry Price using dynamic Camarilla L4 or H4 level
  // Stop Loss using L3 or H3
  // R:R Targets: TP1 at L5/H5, TP2, TP3, TP4 at L6/H6 ladder
  const plannedEntry = currentSignal.entryPrice > 0
    ? currentSignal.entryPrice
    : livePrice;

  const plannedStopLoss = isShort
    ? plannedEntry + 150.00
    : plannedEntry - 150.00;

  const plannedTp1 = isShort
    ? plannedEntry - 37.50
    : plannedEntry + 37.50;

  const plannedTp2 = isShort
    ? plannedEntry - 75.00
    : plannedEntry + 75.00;

  const plannedTp3 = isShort
    ? plannedEntry - 112.50
    : plannedEntry + 112.50;

  const plannedTp4 = isShort
    ? plannedEntry - 150.00
    : plannedEntry + 150.00;

  const matchingLockedSnapshot =
    !isTradeForSelected &&
    lockedActiveSignal &&
    normalizePerpSymbol(lockedActiveSignal.symbol) === normalizePerpSymbol(selectedSymbol) &&
    lockedActiveSignal.direction === effectiveSignal
      ? lockedActiveSignal
      : null;

  const effectiveEntry = isTradeForSelected && activeTrade
    ? activeTrade.entryPrice
    : matchingLockedSnapshot && matchingLockedSnapshot.entryPrice > 0
    ? matchingLockedSnapshot.entryPrice
    : currentSignal.entryPrice > 0
    ? currentSignal.entryPrice
    : plannedEntry;

  const effectiveStopLoss = isTradeForSelected && activeTrade
    ? activeTrade.currentStopLoss
    : matchingLockedSnapshot && matchingLockedSnapshot.stopLoss > 0
    ? matchingLockedSnapshot.stopLoss
    : currentSignal.initialStopLoss > 0
    ? currentSignal.initialStopLoss
    : plannedStopLoss;

  const effectiveTp1 = isTradeForSelected && activeTrade
    ? activeTrade.tp1
    : matchingLockedSnapshot && matchingLockedSnapshot.tp1 > 0
    ? matchingLockedSnapshot.tp1
    : currentSignal.tp1 > 0
    ? currentSignal.tp1
    : plannedTp1;

  const effectiveTp2 = isTradeForSelected && activeTrade
    ? activeTrade.tp2
    : matchingLockedSnapshot && matchingLockedSnapshot.tp2 > 0
    ? matchingLockedSnapshot.tp2
    : currentSignal.tp2 > 0
    ? currentSignal.tp2
    : plannedTp2;

  const effectiveTp3 = isTradeForSelected && activeTrade
    ? activeTrade.tp3
    : matchingLockedSnapshot && matchingLockedSnapshot.tp3 > 0
    ? matchingLockedSnapshot.tp3
    : currentSignal.tp3 > 0
    ? currentSignal.tp3
    : plannedTp3;

  const effectiveTp4 = isTradeForSelected && activeTrade
    ? activeTrade.tp4
    : matchingLockedSnapshot && matchingLockedSnapshot.tp4 > 0
    ? matchingLockedSnapshot.tp4
    : currentSignal.tp4 > 0
    ? currentSignal.tp4
    : plannedTp4;

  const effectiveSignalTimestamp = isTradeForSelected && activeTrade
    ? activeTrade.openedAt
    : matchingLockedSnapshot?.timestamp || currentSignal.timestamp || validityTick;

  const activeSignalValidity = useMemo(() => {
    if (matchingLockedSnapshot) {
      return contextSignalValidity;
    }
    return evaluateLockedSignalValidity(
      {
        direction: effectiveSignal,
        entryPrice: effectiveEntry,
        stopLoss: effectiveStopLoss,
        tp1: effectiveTp1,
        tp4: effectiveTp4,
        timestamp: effectiveSignalTimestamp,
      },
      livePrice,
      validityTick,
      isTradeForSelected
    );
  }, [
    matchingLockedSnapshot,
    contextSignalValidity,
    effectiveSignal,
    effectiveEntry,
    effectiveStopLoss,
    effectiveTp1,
    effectiveTp4,
    effectiveSignalTimestamp,
    livePrice,
    validityTick,
    isTradeForSelected,
  ]);

  const isInvalidated = Boolean(
    !isTradeForSelected &&
      (activeSignalValidity.breachType === 'SL_INVALIDATED' ||
        activeSignalValidity.breachType === 'TP1_COMPLETED' ||
        activeSignalValidity.breachType === 'TP4_COMPLETED')
  );
  const isOverdue = Boolean(!isTradeForSelected && activeSignalValidity.status === 'OVERDUE');
  const isOverdueOnly = Boolean(isOverdue && !isInvalidated);
  const narrowCprOverrideActive = Boolean(
    currentSignal.riskChecks?.narrowCprOverrideActive ||
    currentSignal.isNarrow5mCpr ||
    currentSignal.isNarrow5mCprAutoRouted
  );
  const isWideCprBlocked = Boolean(
    currentSignal.camarilla?.isWideCpr &&
    !narrowCprOverrideActive &&
    !isBypassActive
  );
  const isMarginCapBlocked = currentSignal.riskChecks?.marginUtilizationSafe === false;
  const isAntiChopBlocked = isMicro15 && currentSignal.riskChecks?.microAntiChopPassed === false;
  const isGate1Fail = Boolean(
    !isBypassActive &&
    !currentSignal.riskChecks.signalValidationPassed
  );
  const isHardBlocked = Boolean(
    !isTradeForSelected &&
    (isLiveUnverified || isOverdue || isInvalidated || isWideCprBlocked || isGate1Fail || isMarginCapBlocked || isAntiChopBlocked)
  );
  const isExecutionBlocked = Boolean(
    !isTradeForSelected &&
    (isHardBlocked || (!currentSignal.riskChecks.tradeApproved && !isBypassActive))
  );

  const blockSummaryLabel = isInvalidated
    ? activeSignalValidity.breachType === 'SL_INVALIDATED'
      ? 'INVALIDATED (SL HIT)'
      : 'COMPLETED (TP HIT)'
    : isOverdueOnly
    ? 'BLOCKED (OVERDUE)'
    : isMarginCapBlocked
    ? 'BLOCKED (MARGIN >= 65%)'
    : isAntiChopBlocked
    ? (currentSignal.riskChecks?.microSlCooldownRemainingSec ?? 0) > 0
      ? 'COOLDOWN (10M POST-SL)'
      : 'CAP REACHED (3/HR MICRO)'
    : isWideCprBlocked
    ? 'BLOCKED (WIDE CPR CHOP)'
    : isGate1Fail
    ? 'BLOCKED (GATE FAIL)'
    : 'BLOCKED (RISK GATE)';

  const blockButtonPrimaryLabel = isInvalidated
    ? activeSignalValidity.breachType === 'SL_INVALIDATED'
      ? 'EXECUTION PAUSED · SL INVALIDATED (REFRESH)'
      : 'EXECUTION PAUSED · TARGET COMPLETED (REFRESH)'
    : isOverdueOnly
    ? 'EXECUTION PAUSED · SIGNAL OVERDUE (REFRESH)'
    : isMarginCapBlocked
    ? 'EXECUTION PAUSED · ACCOUNT MARGIN >= 65%'
    : isAntiChopBlocked
    ? (currentSignal.riskChecks?.microSlCooldownRemainingSec ?? 0) > 0
      ? `ANTI-CHOP · 10M SL COOLDOWN (${Math.ceil((currentSignal.riskChecks?.microSlCooldownRemainingSec ?? 0) / 60)}m)`
      : 'ANTI-CHOP · 3/HR MICRO CAP REACHED'
    : isWideCprBlocked
    ? 'EXECUTION PAUSED · WIDE CPR CHOP FILTER'
    : isGate1Fail
    ? 'EXECUTION PAUSED · GATE VALIDATION PENDING'
    : 'EXECUTION PAUSED · RISK GATE HOLD';

  const blockGateStatusLabel = isInvalidated
    ? activeSignalValidity.breachType === 'SL_INVALIDATED'
      ? 'SL HIT · SETUP INVALIDATED'
      : 'TP REACHED · SETUP COMPLETED'
    : isOverdueOnly
    ? 'SIGNAL OVERDUE · REFRESH SETUP'
    : isMarginCapBlocked
    ? 'BLOCKED · MARGIN UTILIZATION >= 65%'
    : isAntiChopBlocked
    ? 'BLOCKED · MICRO ANTI-CHOP GUARD'
    : isWideCprBlocked
    ? 'BLOCKED · WIDE CPR CHOP FILTER'
    : isGate1Fail
    ? 'BLOCKED · GATE VALIDATION FAIL'
    : 'TRADE BLOCKED · RISK GATE';

  const handleRefreshSignalAction = useCallback(() => {
    refreshLockedSignal();
    if (onRefreshSignal) onRefreshSignal();
    if (onConfirmSignal) onConfirmSignal();
  }, [refreshLockedSignal, onRefreshSignal, onConfirmSignal]);

  const isArmedConditional = Boolean(
    !isHardBlocked &&
    (currentSignal.riskChecks.executionStatus === 'ARMED_CONDITIONAL' ||
      (currentSignal.validation?.htfDivergenceWarning &&
        currentSignal.confidence >= 75 &&
        currentSignal.riskChecks.confidenceThresholdMet &&
        currentSignal.riskChecks.sufficientMargin &&
        currentSignal.riskChecks.riskLimitsNotBreached))
  );

  const isSignalConfirmedPass = Boolean(
    !isHardBlocked &&
    (!effectiveStandby || isAutoSniperEnabled || isBypassActive) &&
    (currentSignal.confidence >= 75 || isBypassActive) &&
    currentSignal.confidenceStatus !== 'No Trade' &&
    (currentSignal.riskChecks.signalValidationPassed || isBypassActive) &&
    currentSignal.riskChecks.confidenceThresholdMet &&
    (currentSignal.riskChecks.tradeApproved || isBypassActive || isArmedConditional || isAutoSniperEnabled) &&
    (currentSignal.entryPrice > 0 || livePrice > 0)
  );

  const isTargetsHydrated = Boolean(
    isTradeForSelected ||
    (!isHardBlocked && (
      isSignalConfirmedPass ||
      isBypassActive ||
      isArmedConditional ||
      (isAutoSniperEnabled && currentSignal.confidence >= 75)
    ))
  );

  const signalGenTimeFormatted = useMemo(() => {
    if (!(effectiveSignalTimestamp > 0)) return '--:--:--';
    return new Date(effectiveSignalTimestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }, [effectiveSignalTimestamp]);

  const fmtTargetPrice = (val: number) => (val > 0 ? `$${fmtPrice(val)}` : '---');
  const displayEntry = `${isShort ? '≤ ' : '≥ '}$${fmtPrice(effectiveEntry)}`;
  const displayStopLoss = `$${fmtPrice(effectiveStopLoss)}`;
  const displayTp1 = `$${fmtPrice(effectiveTp1)}`;
  const displayTp2 = `$${fmtPrice(effectiveTp2)}`;
  const displayTp3 = `$${fmtPrice(effectiveTp3)}`;
  const displayTp4 = `$${fmtPrice(effectiveTp4)}`;

  // ═══════════════════════════════════════════════════════════
  // REAL-TIME INR-FIRST PnL TELEMETRY CALCULATIONS
  // Primary: Indian Rupees (₹) in bold green/red · Secondary: (≈ $USD)
  // ═══════════════════════════════════════════════════════════
  const liveOpenUnrealisedUsd = useMemo(() => {
    if (isLiveUnverified || !isTradeForSelected || !activeTrade) return 0;
    if (tradingMode === 'LIVE' && typeof activeTrade.unrealizedPnlUsd === 'number' && Number.isFinite(activeTrade.unrealizedPnlUsd)) {
      return +activeTrade.unrealizedPnlUsd.toFixed(4);
    }
    const remSize = activeTrade.remainingSize > 0 ? activeTrade.remainingSize : activeTrade.lotSize;
    const rawDiff = activeTrade.signal === 'LONG'
      ? (livePrice - activeTrade.entryPrice) * remSize
      : (activeTrade.entryPrice - livePrice) * remSize;
    return Number.isFinite(rawDiff) ? +rawDiff.toFixed(2) : (activeTrade.unrealisedProfitUsd || 0);
  }, [isLiveUnverified, tradingMode, isTradeForSelected, activeTrade, livePrice]);

  const bookedLadderRealisedUsd = useMemo(() => {
    if (isLiveUnverified) return 0;
    if (isTradeForSelected && activeTrade) {
      return +(activeTrade.bookedProfitUsd || 0).toFixed(2);
    }
    return 0;
  }, [isLiveUnverified, isTradeForSelected, activeTrade]);

  const totalSniperNetPnlUsd = +(liveOpenUnrealisedUsd + bookedLadderRealisedUsd).toFixed(2);

  // Zero Pre-Execution Projection Rule:
  // Only compute and display projected target profit once a trade is actively open and running in the market
  const ladderStageTargets = useMemo(() => {
    const lot = effectiveLotSize > 0 ? effectiveLotSize : 0.15;
    const calcAmt = (tpPrice: number, fallbackUsd: number) =>
      effectiveEntry > 0 && tpPrice > 0 ? +(Math.abs(tpPrice - effectiveEntry) * lot).toFixed(2) : fallbackUsd;

    const isM15 = isMicro15;
    const targets = {
      tp1: calcAmt(effectiveTp1, isM15 ? 3.75 : 12.50),
      tp2: calcAmt(effectiveTp2, isM15 ? 7.50 : 25.00),
      tp3: calcAmt(effectiveTp3, isM15 ? 11.25 : 37.50),
      tp4: calcAmt(effectiveTp4, isM15 ? 15.00 : 50.00),
      riskCap: isM15 ? 15 : 50,
    };

    const fmtClean = (amt: number) => {
      const inr = +(amt * liveUsdInrRate).toFixed(2);
      const inrStr = inr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const usdStr = amt.toFixed(2);
      return {
        usd: `+$${usdStr}`,
        inr: `₹${inrStr}`,
        display: `+$${usdStr} (₹${inrStr})`,
        amount: amt,
        inrAmount: inr,
        combined: `+$${usdStr} (₹${inrStr})`,
      };
    };

    return {
      tp1: fmtClean(targets.tp1),
      tp2: fmtClean(targets.tp2),
      tp3: fmtClean(targets.tp3),
      tp4: fmtClean(targets.tp4),
      finalUsd: targets.tp4,
      riskCapUsd: targets.riskCap,
      tierName: isM15 ? '$15 Micro Scalp' : '$50 Standard Scalp',
    };
  }, [isMicro15, liveUsdInrRate, effectiveLotSize, effectiveEntry, effectiveTp1, effectiveTp2, effectiveTp3, effectiveTp4]);

  const projectedTargetPnlUsd = useMemo(() => {
    if (isLiveUnverified || !isTradeForSelected || !activeTrade) return 0;
    if (effectiveTp4 > 0 && effectiveEntry > 0 && effectiveLotSize > 0) {
      return +(Math.abs(effectiveTp4 - effectiveEntry) * effectiveLotSize).toFixed(2);
    }
    if (isMicro15) return 15;
    if (isMicro50) return 50;
    return 0;
  }, [isLiveUnverified, isTradeForSelected, activeTrade, isMicro15, isMicro50, effectiveTp4, effectiveEntry, effectiveLotSize]);

  const targetGoalDisplay = useMemo(() => {
    const goalAmt = ladderStageTargets.finalUsd;
    const goalFmt = formatInrFirstPnl(goalAmt, liveUsdInrRate, { showPlusSign: true });
    return {
      formatted: `${goalFmt.combined} · 1.0:1 (Terminal Cap)`,
      value: goalFmt.combined,
      rr: '1.0:1 (Terminal Cap)',
    };
  }, [ladderStageTargets.finalUsd, liveUsdInrRate]);

  const sniperNetPnlFmt = formatInrFirstPnl(totalSniperNetPnlUsd, liveUsdInrRate, { showPlusSign: true });
  const sniperUnrealisedFmt = useMemo(() => {
    const baseFmt = formatInrFirstPnl(liveOpenUnrealisedUsd, liveUsdInrRate, { showPlusSign: true });
    if (
      tradingMode === 'LIVE' &&
      isTradeForSelected &&
      activeTrade &&
      typeof activeTrade.unrealizedPnlInr === 'number' &&
      Number.isFinite(activeTrade.unrealizedPnlInr)
    ) {
      const exactInr = activeTrade.unrealizedPnlInr;
      const sign = exactInr > 0 ? '+' : exactInr < 0 ? '-' : '';
      const inrText = `${sign}₹${Math.abs(exactInr).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return {
        ...baseFmt,
        inrAmount: exactInr,
        inrText,
        combined: `${inrText} (≈ ${baseFmt.usdText})`,
        isPositive: exactInr >= 0,
      };
    }
    return baseFmt;
  }, [liveOpenUnrealisedUsd, liveUsdInrRate, tradingMode, isTradeForSelected, activeTrade]);
  const sniperBookedFmt = formatInrFirstPnl(bookedLadderRealisedUsd, liveUsdInrRate, { showPlusSign: true });
  const sniperTargetProjectedFmt = formatInrFirstPnl(projectedTargetPnlUsd, liveUsdInrRate, { showPlusSign: true });

  const m12Fmt = ladderStageTargets.tp1;
  const m25Fmt = ladderStageTargets.tp2;
  const m37Fmt = ladderStageTargets.tp3;
  const m50Fmt = ladderStageTargets.tp4;

  // ═══════════════════════════════════════════════════════════
  // LIVE PRICE POSITION & TP TARGET CONTINUUM ANALYSIS
  // When no active trade is open, reset progress tracker & continuum to 0% (STANDBY / SCANNING)
  // When signal is unhydrated/standby, clear target distance and percentage indicators to "---"
  // ═══════════════════════════════════════════════════════════
  let activeTargetIndex: 1 | 2 | 3 | 4 = 1;
  let activeTargetPrice = isTargetsHydrated ? effectiveTp1 : 0;
  let targetProgressPct = 0; // 0 to 100% towards active target
  let distanceToTargetUsd = isTargetsHydrated && effectiveTp1 > 0 && effectiveEntry > 0
    ? +Math.abs(effectiveTp1 - effectiveEntry).toFixed(2)
    : 0;
  let distanceToTargetPct = isTargetsHydrated && effectiveEntry > 0
    ? +((distanceToTargetUsd / effectiveEntry) * 100).toFixed(2)
    : 0;
  let currentPriceZone = 'STANDBY_SCANNING';

  const base1to1Span = Math.abs(effectiveTp2 - effectiveEntry);
  const displacementTowardsBase = isShort
    ? (effectiveEntry - livePrice)
    : (livePrice - effectiveEntry);
  const progressTowardsBasePct = isTradeForSelected && isTargetsHydrated && base1to1Span > 0
    ? Math.min(100, Math.max(0, Math.round((displacementTowardsBase / base1to1Span) * 100)))
    : 0;

  if (isTradeForSelected && isTargetsHydrated) {
    if (isShort) {
      if (livePrice > effectiveStopLoss) {
        currentPriceZone = 'STOP_LOSS_BREACHED';
        activeTargetIndex = 1;
        activeTargetPrice = effectiveTp1;
        targetProgressPct = 0;
      } else if (livePrice > effectiveEntry) {
        currentPriceZone = 'DRAWDOWN_PRE_ENTRY';
        activeTargetIndex = 1;
        activeTargetPrice = effectiveTp1;
        distanceToTargetUsd = +(livePrice - effectiveTp1).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        targetProgressPct = 0;
      } else if (livePrice > effectiveTp1) {
        // Between Entry & TP1
        currentPriceZone = 'ENTRY_TO_TP1';
        activeTargetIndex = 1;
        activeTargetPrice = effectiveTp1;
        distanceToTargetUsd = +(livePrice - effectiveTp1).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        const totalSpan = effectiveEntry - effectiveTp1;
        const traversed = effectiveEntry - livePrice;
        targetProgressPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traversed / totalSpan) * 100))) : 50;
      } else if (livePrice > effectiveTp2) {
        // Between TP1 & TP2
        currentPriceZone = 'TP1_TO_TP2';
        activeTargetIndex = 2;
        activeTargetPrice = effectiveTp2;
        distanceToTargetUsd = +(livePrice - effectiveTp2).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        const totalSpan = effectiveTp1 - effectiveTp2;
        const traversed = effectiveTp1 - livePrice;
        targetProgressPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traversed / totalSpan) * 100))) : 50;
      } else if (livePrice > effectiveTp3) {
        // Between TP2 & TP3
        currentPriceZone = 'TP2_TO_TP3';
        activeTargetIndex = 3;
        activeTargetPrice = effectiveTp3;
        distanceToTargetUsd = +(livePrice - effectiveTp3).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        const totalSpan = effectiveTp2 - effectiveTp3;
        const traversed = effectiveTp2 - livePrice;
        targetProgressPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traversed / totalSpan) * 100))) : 50;
      } else if (livePrice > effectiveTp4) {
        // Between TP3 & TP4
        currentPriceZone = 'TP3_TO_TP4';
        activeTargetIndex = 4;
        activeTargetPrice = effectiveTp4;
        distanceToTargetUsd = +(livePrice - effectiveTp4).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        const totalSpan = effectiveTp3 - effectiveTp4;
        const traversed = effectiveTp3 - livePrice;
        targetProgressPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traversed / totalSpan) * 100))) : 50;
      } else {
        currentPriceZone = 'TP4_COMPLETED';
        activeTargetIndex = 4;
        activeTargetPrice = effectiveTp4;
        targetProgressPct = 100;
      }
    } else {
      // LONG Trajectory
      if (livePrice < effectiveStopLoss) {
        currentPriceZone = 'STOP_LOSS_BREACHED';
        activeTargetIndex = 1;
        activeTargetPrice = effectiveTp1;
        targetProgressPct = 0;
      } else if (livePrice < effectiveEntry) {
        currentPriceZone = 'DRAWDOWN_PRE_ENTRY';
        activeTargetIndex = 1;
        activeTargetPrice = effectiveTp1;
        distanceToTargetUsd = +(effectiveTp1 - livePrice).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        targetProgressPct = 0;
      } else if (livePrice < effectiveTp1) {
        // Between Entry & TP1
        currentPriceZone = 'ENTRY_TO_TP1';
        activeTargetIndex = 1;
        activeTargetPrice = effectiveTp1;
        distanceToTargetUsd = +(effectiveTp1 - livePrice).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        const totalSpan = effectiveTp1 - effectiveEntry;
        const traversed = livePrice - effectiveEntry;
        targetProgressPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traversed / totalSpan) * 100))) : 50;
      } else if (livePrice < effectiveTp2) {
        // Between TP1 & TP2
        currentPriceZone = 'TP1_TO_TP2';
        activeTargetIndex = 2;
        activeTargetPrice = effectiveTp2;
        distanceToTargetUsd = +(effectiveTp2 - livePrice).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        const totalSpan = effectiveTp2 - effectiveTp1;
        const traversed = livePrice - effectiveTp1;
        targetProgressPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traversed / totalSpan) * 100))) : 50;
      } else if (livePrice < effectiveTp3) {
        // Between TP2 & TP3
        currentPriceZone = 'TP2_TO_TP3';
        activeTargetIndex = 3;
        activeTargetPrice = effectiveTp3;
        distanceToTargetUsd = +(effectiveTp3 - livePrice).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        const totalSpan = effectiveTp3 - effectiveTp2;
        const traversed = livePrice - effectiveTp2;
        targetProgressPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traversed / totalSpan) * 100))) : 50;
      } else if (livePrice < effectiveTp4) {
        // Between TP3 & TP4
        currentPriceZone = 'TP3_TO_TP4';
        activeTargetIndex = 4;
        activeTargetPrice = effectiveTp4;
        distanceToTargetUsd = +(effectiveTp4 - livePrice).toFixed(2);
        distanceToTargetPct = +((distanceToTargetUsd / livePrice) * 100).toFixed(2);
        const totalSpan = effectiveTp4 - effectiveTp3;
        const traversed = livePrice - effectiveTp3;
        targetProgressPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((traversed / totalSpan) * 100))) : 50;
      } else {
        currentPriceZone = 'TP4_COMPLETED';
        activeTargetIndex = 4;
        activeTargetPrice = effectiveTp4;
        targetProgressPct = 100;
      }
    }
  }

  const displayTargetInPlay = activeTargetPrice > 0
    ? `TP${activeTargetIndex} (${fmtTargetPrice(activeTargetPrice)})`
    : `TP1 (${fmtTargetPrice(effectiveTp1)})`;
  const displayDistance = activeTargetPrice > 0 && distanceToTargetUsd > 0
    ? `$${distanceToTargetUsd} (${distanceToTargetPct}%)`
    : `$${Math.abs(effectiveEntry - effectiveTp1).toFixed(2)} (${((Math.abs(effectiveEntry - effectiveTp1) / (effectiveEntry || 1)) * 100).toFixed(2)}%)`;

  const confidenceColor = {
    'Ultra Strong': 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.25)]',
    'Confluence Active': 'bg-cyan-950/80 border-cyan-500 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.35)]',
    'Strong': 'bg-teal-950/80 border-teal-500 text-teal-300',
    'Moderate': 'bg-amber-950/80 border-amber-500 text-amber-300',
    'Weak': 'bg-orange-950/80 border-orange-500 text-orange-300',
    'No Trade': 'bg-rose-950/80 border-rose-500 text-rose-300',
  }[currentSignal.confidenceStatus] || 'bg-cyan-950/80 border-cyan-500 text-cyan-300';

  // Helper for Target Status Badge
  const getTargetBadge = (targetNum: 1 | 2 | 3 | 4, _price: number) => {
    if (!isTradeForSelected) {
      return (
        <span className="text-[10px] text-slate-400 font-mono-numbers px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
          {isTargetsHydrated ? 'PRIMED' : 'STANDBY'}
        </span>
      );
    }

    const isHit = targetNum === 1 
      ? activeTrade?.tp1Hit 
      : targetNum === 2 
      ? activeTrade?.tp2Hit 
      : targetNum === 3 
      ? activeTrade?.tp3Hit 
      : activeTrade?.tp4Hit;

    if (isHit) {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-400 font-bold text-[10px] bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-700">
          <Check className="w-3 h-3 text-emerald-400" />
          <span>ACHIEVED</span>
        </span>
      );
    }

    if (activeTargetIndex === targetNum) {
      return (
        <span className="inline-flex items-center gap-1 text-cyan-300 font-bold text-[10px] bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500 animate-pulse shadow-sm shadow-cyan-500/40">
          <Target className="w-3 h-3 text-cyan-400" />
          <span>ACTIVE TARGET IN PLAY</span>
        </span>
      );
    }

    if (activeTargetIndex < targetNum) {
      return (
        <span className="text-[10px] text-slate-500 font-mono-numbers px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
          PENDING NEXT
        </span>
      );
    }

    return (
      <span className="text-[10px] text-emerald-400 font-mono-numbers">
        PASSED
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-3 w-full min-w-0 max-w-full">
      {/* ═══════════════════════════════════════════════════════════
          COMPACT INTRADAY SNIPER CONTROLLER DOCK
          ═══════════════════════════════════════════════════════════ */}
      <div className="order-[10] panel-delta panel-delta-body relative z-10 space-y-2.5 min-w-0 max-w-full">
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 max-w-full">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-emerald-500 p-[1px] flex items-center justify-center shrink-0">
              <div className="w-full h-full bg-[#030718] rounded-[7px] flex items-center justify-center">
                <Crosshair className="w-4 h-4 text-emerald-400" />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className="panel-delta-title" title="Sniper Execution Control">
                  Sniper Execution Control
                </span>
                <span className={`badge-delta font-mono-numbers ${isPaper ? 'badge-delta-paper' : 'badge-delta-live'}`}>
                  {tradingMode}
                </span>
                <SignalFreshnessHeaderBadge
                  effectiveSignalTimestamp={effectiveSignalTimestamp}
                  signalGenTimeFormatted={signalGenTimeFormatted}
                  activeSignalValidity={activeSignalValidity}
                  canRefresh={isOverdue || isInvalidated}
                  onRefresh={handleRefreshSignalAction}
                />
              </div>
              <div className="text-[10px] text-slate-400 font-mono-numbers mt-0.5 break-words">
                INR/USD ₹{liveUsdInrRate.toFixed(2)} · H4/L4 Breakout Auto-Pilot
              </div>
            </div>
          </div>

          {/* Right Controls: Signal Direction + Bypass Toggle + Exposure Mode + Instrument + Timeframe + Auto-Pilot */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs min-w-0 max-w-full">
            {/* Signal Direction Selector */}
            {setDirectionMode && (
              <div className="inline-flex flex-wrap items-center p-1 bg-slate-900/90 border border-slate-800/80 rounded-lg text-xs gap-1 max-w-full">
                <span className="text-slate-400 px-1.5 text-[10px] uppercase font-bold">Signal:</span>
                <button
                  type="button"
                  onClick={() => setDirectionMode('AUTO')}
                  className={`btn-delta-sm ${directionMode === 'AUTO' ? 'btn-toggle-active' : 'btn-secondary'}`}
                  title="Automatic Signal Direction based on trend and VWAP"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>AUTO</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDirectionMode('LONG')}
                  className={`btn-delta-sm ${directionMode === 'LONG' ? 'btn-primary' : 'btn-secondary'}`}
                  title="LONG: Force bullish breakout mode targeting H5/H6 ladder"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>LONG</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDirectionMode('SHORT')}
                  className={`btn-delta-sm ${directionMode === 'SHORT' ? 'btn-danger' : 'btn-secondary'}`}
                  title="SHORT: Force bearish breakdown mode targeting L5/L6 ladder"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span>SHORT</span>
                </button>
              </div>
            )}

            {/* Bypass HTF Filter (Paper Demo Only) Toggle Button */}
            {setBypassHtfFilter && (
              <label
                className={`btn-delta-sm font-mono-numbers ${
                  isBypassActive ? 'btn-toggle-active' : 'btn-secondary'
                } ${!isPaper ? 'opacity-40 cursor-not-allowed' : ''}`}
                title="Bypass HTF / VWAP Guard (Paper): Forces Gate #1 to PASS (OVERRIDE) and unlocks manual execution"
              >
                <input
                  type="checkbox"
                  checked={isBypassActive}
                  disabled={!isPaper}
                  onChange={(e) => setBypassHtfFilter(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-5 h-3 rounded-full relative transition-colors ${
                    isBypassActive ? 'bg-amber-500' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full bg-white absolute top-0.5 transition-transform ${
                      isBypassActive ? 'translate-x-2.5' : 'translate-x-0.5'
                    }`}
                  />
                </div>
                <span>Bypass HTF / VWAP (Paper)</span>
                {isBypassActive && (
                  <span className="badge-delta badge-delta-paper">
                    ON
                  </span>
                )}
              </label>
            )}

            {/* Exposure Mode & Scalp Tier Switch */}
            <div className="inline-flex flex-wrap items-center p-1 bg-slate-900/90 border border-slate-800/80 rounded-lg gap-1 font-mono-numbers max-w-full">
              <button
                type="button"
                onClick={() => {
                  handleSetExposureMode('MICRO_50');
                  if (propSetScalpTier) propSetScalpTier('TIER_50');
                }}
                className={`btn-delta-sm ${isMicro50 && !isMicro15 ? 'btn-toggle-active' : 'btn-secondary'}`}
                title="Tier 1: Standard Sniper ($50 Max Risk) — 0.05-0.10 BTC sizing, TP1–TP4 +$25/+$50/+$100/+$150"
              >
                <Crosshair className="w-3 h-3" />
                <span>$50 STANDARD</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSetExposureMode('MICRO_15');
                  if (propSetScalpTier) propSetScalpTier('TIER_15');
                }}
                className={`btn-delta-sm ${isMicro15 ? 'btn-toggle-active' : 'btn-secondary'}`}
                title="Tier 2: Micro Sniper ($15 Max Risk) — Ultra-tight micro scalp (0.01-0.02 BTC), TP1–TP4 +$7.50/+$15/+$30/+$45"
              >
                <Zap className="w-3 h-3 text-amber-300" />
                <span>$15 MICRO</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetExposureMode('MACRO')}
                className={`btn-delta-sm ${!isMicroScalp ? 'btn-toggle-active' : 'btn-secondary'}`}
                title="Institutional Macro: Full sizing with H5/H6 & L5/L6 targets"
              >
                <Landmark className="w-3 h-3" />
                <span>MACRO</span>
              </button>
            </div>

            {/* Instrument Selector */}
            <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-800/80 rounded-lg px-2.5 h-7">
              <span className="text-[10px] text-slate-400">Pair:</span>
              <select
                value={selectedSymbol}
                onChange={(e) => {
                  const newSym = e.target.value;
                  setSelectedSymbol(newSym);
                  if (onRefreshAiAnalysis) {
                    onRefreshAiAnalysis(newSym, selectedTimeframe);
                  }
                }}
                className="bg-transparent text-xs font-bold text-white font-mono-numbers focus:outline-none cursor-pointer"
              >
                {Object.keys(markets).map((sym) => (
                  <option key={sym} value={sym} className="bg-slate-900 text-white">
                    {sym} · ${(markets[sym]?.markPrice || 0).toLocaleString()}
                  </option>
                ))}
              </select>
            </div>

            {/* Timeframe Selector */}
            <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800/80 rounded-lg px-2.5 h-7 font-mono-numbers">
              <span className="text-[10px] text-slate-400 uppercase font-bold">TF:</span>
              <select
                value={selectedTimeframe}
                onChange={(e) => {
                  const newTf = e.target.value;
                  setSelectedTimeframe(newTf);
                  if (onRefreshAiAnalysis) {
                    onRefreshAiAnalysis(selectedSymbol, newTf);
                  }
                }}
                className="bg-transparent text-xs font-bold text-cyan-300 focus:outline-none cursor-pointer"
              >
                <option value="1m" className="bg-slate-900 text-white">1m</option>
                <option value="5m" className="bg-slate-900 text-white">5m</option>
                <option value="15m" className="bg-slate-900 text-white">15m</option>
                <option value="1h" className="bg-slate-900 text-white">1h</option>
              </select>
            </div>

            {/* Auto-Pilot Switch */}
            <div
              className="flex items-center gap-2 px-2.5 h-7 bg-slate-900/90 border border-slate-800/80 rounded-lg"
              title={
                isLiveUnverified
                  ? 'Connect Delta Exchange API Keys in Settings to trade live'
                  : 'Auto-Pilot Automated Order Dispatch'
              }
            >
              <span className="text-[11px] text-slate-300 font-medium">Auto:</span>
              <button
                type="button"
                onClick={() => {
                  const nextVal = !isAutoSniperEnabled;
                  setIsAutoSniperEnabled(nextVal);
                  if (nextVal) {
                    setLocalStandbyAfterExit(false);
                    if (onConfirmSignal) onConfirmSignal();
                  }
                }}
                disabled={isLiveUnverified}
                className={`relative inline-flex h-4 w-8 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isLiveUnverified
                    ? 'bg-slate-800 opacity-50 cursor-not-allowed'
                    : isAutoSniperEnabled
                    ? 'bg-emerald-500 cursor-pointer'
                    : 'bg-slate-700 cursor-pointer'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    isAutoSniperEnabled && !isLiveUnverified ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className={`badge-delta font-mono-numbers ${isLiveUnverified ? 'badge-delta-paper' : isAutoSniperEnabled ? 'badge-delta-live' : 'badge-delta-standby'}`}>
                {isLiveUnverified ? 'KEYS REQ' : isAutoSniperEnabled ? 'ARMED' : 'OFF'}
              </span>
            </div>
          </div>
        </div>

        {/* Daily Session Anchor Telemetry Toolbar (Delta India UTC 00:00) */}
        <div className="w-full panel-delta px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
            <span className="text-[11px] font-bold text-cyan-300 tracking-wider uppercase">
              DELTA 1D SETTLED
            </span>
            <span className="badge-delta badge-delta-standby">
              UTC 00:00 · {dailyAnchor.source}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-xs font-bold text-slate-200 tabular-nums">
            <span className="flex items-center gap-1.5 bg-[#131922] px-2.5 py-1 rounded-md border border-slate-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 font-semibold">H:</span> {currencyPrefix}{dailyAnchor.prevHigh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: livePrice > 10 ? 2 : 4 })}
            </span>
            <span className="flex items-center gap-1.5 bg-[#131922] px-2.5 py-1 rounded-md border border-slate-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span className="text-rose-400 font-semibold">L:</span> {currencyPrefix}{dailyAnchor.prevLow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: livePrice > 10 ? 2 : 4 })}
            </span>
            <span className="flex items-center gap-1.5 bg-[#131922] px-2.5 py-1 rounded-md border border-slate-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span className="text-sky-300 font-semibold">C:</span> {currencyPrefix}{dailyAnchor.prevClose.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: livePrice > 10 ? 2 : 4 })}
            </span>
            <span className="flex items-center gap-1.5 bg-[#131922] px-2.5 py-1 rounded-md border border-slate-800/60">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-amber-400 font-semibold">Range:</span> {currencyPrefix}{dailyAnchor.range.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: livePrice > 10 ? 2 : 4 })}
            </span>
          </div>
        </div>

        {/* Camarilla Visual Price-Position Gauge */}
        <CamarillaPriceGauge
          camarilla={camarilla}
          currentPrice={livePrice}
          direction={effectiveSignal}
          currencyPrefix={currencyPrefix}
          timeframe={selectedTimeframe}
          virginCprZones={camarilla.virginCprZones}
          nearestVirginCpr={camarilla.nearestVirginCpr}
        />

        {/* Visual Card & Progress Track Layout for FIBONACCI SWING STRUCTURE (Y-HL) */}
        {(() => {
          const fib = currentSignal.fibonacci || computeDailyFibonacciLevels(curMarket, livePrice, undefined, effectiveSignal, dailyAnchor);
          const fmtFibPrice = (val: number) =>
            (val * exchangeRate).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: livePrice > 10 ? 2 : 4,
            });

          const isBull = fib.isBullish;

          const pdl = fib.swingLow;
          const pdh = fib.swingHigh;

          const isUpsideExp = livePrice > pdh;
          const isDownsideExp = livePrice < pdl;

          let leftBoundPrice = pdl;
          let rightBoundPrice = pdh;

          if (isUpsideExp) {
            rightBoundPrice = livePrice >= fib.ext1618Upside
              ? fib.ext2000Upside
              : livePrice >= fib.ext1500Upside
              ? fib.ext1618Upside
              : livePrice >= fib.ext1382Upside
              ? fib.ext1500Upside
              : fib.ext1382Upside;
          } else if (isDownsideExp) {
            leftBoundPrice = livePrice <= fib.ext0618Downside
              ? fib.ext1000Downside
              : livePrice <= fib.ext0500Downside
              ? fib.ext0618Downside
              : livePrice <= fib.ext0382Downside
              ? fib.ext0500Downside
              : fib.ext0382Downside;
          }

          const railRange = Math.max(0.0001, rightBoundPrice - leftBoundPrice);
          const positionRatio = (livePrice - leftBoundPrice) / railRange;

          const fillPct = Math.min(100, Math.max(0, positionRatio * 100));
          const pointerLeftPct = Math.min(96, Math.max(4, positionRatio * 100));

          const checkProximity = (targetPrice: number) => {
            if (!targetPrice || targetPrice <= 0) return { isNear: false, diffUsd: 0, pct: 0 };
            const diffUsd = (livePrice - targetPrice) * exchangeRate;
            const pct = (Math.abs(livePrice - targetPrice) / targetPrice) * 100;
            const isNear = pct <= 0.15;
            return { isNear, diffUsd, pct };
          };

          let level1, level2, level3, level4, level5;

          if (isUpsideExp) {
            level1 = {
              label: '0.0 (PDL)',
              sub: 'Prior Day Low (Floor)',
              price: pdl,
              color: 'text-rose-400 font-bold',
              badgeBg: 'bg-rose-500/10 text-rose-400 border border-rose-500/30',
            };
            level2 = {
              label: '0.500 EQ',
              sub: 'Equilibrium (Fair Value)',
              price: fib.fib500,
              color: 'text-cyan-400 font-bold',
              badgeBg: 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300',
            };
            level3 = {
              label: '1.0 (PDH)',
              sub: 'PDH Breakout Base',
              price: pdh,
              color: 'text-emerald-400 font-black',
              badgeBg: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50',
            };
            level4 = {
              label: '+1.236 Ext',
              sub: 'Upper Extension Tier 1',
              price: fib.ext1236Upside,
              color: 'text-amber-400 font-bold',
              badgeBg: 'bg-amber-500/10 border border-amber-400/30 text-amber-300',
            };
            level5 = {
              label: livePrice >= fib.ext1500Upside ? '+1.500 / +1.618 GP' : '+1.382 / +1.500 Exp',
              sub: 'Discovery Target',
              price: rightBoundPrice,
              color: 'text-cyan-300 font-black',
              badgeBg: 'bg-cyan-950/90 border border-cyan-400/80 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.4)]',
            };
          } else if (isDownsideExp) {
            level1 = {
              label: livePrice <= fib.ext0500Downside ? '-0.500 / -0.618 GP' : '-0.382 / -0.500 Exp',
              sub: 'Cascade Target Floor',
              price: leftBoundPrice,
              color: 'text-rose-300 font-black',
              badgeBg: 'bg-rose-950/90 border border-rose-400/80 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.4)]',
            };
            level2 = {
              label: '-0.236 Ext',
              sub: 'Lower Extension Tier 1',
              price: fib.ext0236Downside,
              color: 'text-amber-400 font-bold',
              badgeBg: 'bg-amber-500/10 border border-amber-400/30 text-amber-300',
            };
            level3 = {
              label: '0.0 (PDL)',
              sub: 'PDL Breakdown Floor',
              price: pdl,
              color: 'text-rose-400 font-black',
              badgeBg: 'bg-rose-500/20 text-rose-300 border border-rose-500/50',
            };
            level4 = {
              label: '0.500 EQ',
              sub: 'Equilibrium (Fair Value)',
              price: fib.fib500,
              color: 'text-cyan-400 font-bold',
              badgeBg: 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300',
            };
            level5 = {
              label: '1.0 (PDH)',
              sub: 'Prior Day High (Ceiling)',
              price: pdh,
              color: 'text-emerald-400 font-bold',
              badgeBg: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
            };
          } else {
            level1 = {
              label: '0.0 (PDL)',
              sub: 'Prior Day Low (Floor)',
              price: pdl,
              color: 'text-rose-400 font-bold',
              badgeBg: 'bg-rose-500/10 text-rose-400 border border-rose-500/30',
            };
            level2 = {
              label: '0.382',
              sub: 'Retracement 38.2%',
              price: fib.fib382,
              color: 'text-sky-300 font-medium',
              badgeBg: 'bg-sky-950/80 border-sky-500/50 text-sky-200',
            };
            level3 = {
              label: '0.500 EQ',
              sub: 'Equilibrium (Fair Value)',
              price: fib.fib500,
              color: 'text-cyan-400 font-bold',
              badgeBg: 'bg-cyan-950/80 border-cyan-500/60 text-cyan-300',
            };
            level4 = {
              label: '0.618 / 0.650 GP',
              sub: 'Golden Pocket (OTE)',
              price: fib.fib618,
              color: 'text-amber-400 font-bold',
              badgeBg: 'bg-amber-500/10 border border-amber-400/30 text-amber-300',
            };
            level5 = {
              label: '1.0 (PDH)',
              sub: 'Prior Day High (Ceiling)',
              price: pdh,
              color: 'text-emerald-400 font-bold',
              badgeBg: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
            };
          }

          const levels = [
            { key: 'l1', ...level1, prox: checkProximity(level1.price) },
            { key: 'l2', ...level2, prox: checkProximity(level2.price) },
            { key: 'l3', ...level3, prox: checkProximity(level3.price) },
            { key: 'l4', ...level4, prox: checkProximity(level4.price) },
            { key: 'l5', ...level5, prox: checkProximity(level5.price) },
          ];

          const isAboveEq = livePrice >= fib.fib500;

          return (
            <div className="w-full panel-delta panel-delta-body space-y-2.5 font-mono mt-1.5 select-none">
              {/* Header Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    {isAboveEq ? (
                      <span className="badge-delta badge-delta-live" title="Bullish Trend: Price is trading above the 0.5 Equilibrium level">
                        <ArrowUp className="w-3 h-3" />
                        <span>BULLISH (&gt; 0.5 EQ)</span>
                      </span>
                    ) : (
                      <span className="badge-delta badge-delta-danger" title="Bearish Trend: Price is trading below the 0.5 Equilibrium level">
                        <ArrowDown className="w-3 h-3" />
                        <span>BEARISH (&lt; 0.5 EQ)</span>
                      </span>
                    )}
                    <h3 className="panel-delta-title ml-1">
                      FIBONACCI SWING STRUCTURE (Y-HL)
                    </h3>
                  </div>
                  <span className="badge-delta badge-delta-armed">
                    UTC 00:00 Auto-Roll
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`badge-delta ${
                    fib.isExpansionMode
                      ? fib.expansionDirection === 'UPSIDE'
                        ? 'badge-delta-live'
                        : 'badge-delta-danger'
                      : isBull
                      ? 'badge-delta-live'
                      : 'badge-delta-danger'
                  }`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <span>{fib.activeZoneLabel}</span>
                  </span>
                </div>
              </div>

              {/* Visual Segmented Gradient Level Rail (0.0 PDL -> 0.500 EQ -> 1.0 PDH) */}
              <div className="space-y-2 px-1 py-1">
                <div className="relative w-full bg-[#131922] h-3.5 rounded-full border border-slate-800/80 overflow-visible flex items-center">
                  {/* Active Segment Fill: Smooth Segmented Gradient Rail */}
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rose-500/70 via-cyan-400/80 to-emerald-500/80 transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                    style={{ width: `${fillPct}%` }}
                  />

                  {/* 5 Anchor Tick Marks */}
                  {[0, 25, 50, 75, 100].map((pct, idx) => (
                    <div
                      key={`tick-${idx}`}
                      className="absolute top-0 bottom-0 w-0.5 bg-slate-700/80 z-0"
                      style={{ left: `${pct}%` }}
                    />
                  ))}

                  {/* Animated Pulsing Price Cursor Indicator */}
                  <div
                    className="absolute -top-3.5 transform -translate-x-1/2 z-20 flex flex-col items-center pointer-events-none transition-all duration-300"
                    style={{ left: `${pointerLeftPct}%` }}
                  >
                    <span className="px-2 py-0.5 rounded bg-cyan-400 text-slate-950 text-[9.5px] font-extrabold shadow-[0_0_14px_rgba(34,211,238,0.9)] whitespace-nowrap animate-pulse flex items-center gap-1 tabular-nums">
                      <Target className="w-2.5 h-2.5" />
                      <span>LIVE: {currencyPrefix}{fmtFibPrice(livePrice)}</span>
                    </span>
                    <div className="w-2 h-2 bg-cyan-400 rotate-45 -mt-1 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                  </div>
                </div>

                {/* Rail Boundary Anchor Labels */}
                <div className="flex items-center justify-between text-[9.5px] text-slate-400 font-mono px-0.5 pt-1 tabular-nums">
                  <span className={isDownsideExp ? 'text-rose-300 font-extrabold' : 'text-rose-400 font-bold'}>
                    {level1.label} ({currencyPrefix}{fmtFibPrice(level1.price)})
                  </span>
                  <span className="text-sky-300">{level2.label}</span>
                  <span className="text-cyan-400 font-semibold">{level3.label}</span>
                  <span className="text-amber-400 font-semibold">{level4.label}</span>
                  <span className={isUpsideExp ? 'text-cyan-300 font-extrabold' : 'text-emerald-400 font-bold'}>
                    {level5.label} ({currencyPrefix}{fmtFibPrice(level5.price)})
                  </span>
                </div>
              </div>

              {/* Segmented 5-Key Level Metric Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-0.5">
                {levels.map((lvl) => {
                  const isNear = lvl.prox.isNear;
                  const diffText = lvl.prox.diffUsd >= 0 ? `+$${lvl.prox.diffUsd.toFixed(1)}` : `-$${Math.abs(lvl.prox.diffUsd).toFixed(1)}`;
                  const pctText = `${lvl.prox.pct.toFixed(2)}%`;

                  return (
                    <div
                      key={lvl.key}
                      className={`p-2.5 rounded-lg border transition-all duration-200 flex flex-col justify-between space-y-1 ${
                        isNear
                          ? 'bg-cyan-950/60 border-cyan-400 ring-1 ring-cyan-400/80 shadow-[0_0_16px_rgba(6,182,212,0.4)] animate-pulse'
                          : 'bg-[#131922] border-slate-800/60 hover:border-slate-700/90'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] gap-1">
                        <span className={`px-2 py-0.5 rounded font-bold border text-[9px] ${lvl.badgeBg}`}>
                          {lvl.label}
                        </span>
                        {isNear && (
                          <span className="px-1.5 py-0.2 rounded bg-cyan-400 text-slate-950 text-[8px] font-extrabold uppercase animate-ping">
                            MAGNET
                          </span>
                        )}
                      </div>

                      <div className="mt-1">
                        <span className="text-[9.5px] text-slate-400 font-semibold block truncate">
                          {lvl.sub}
                        </span>
                        <div className={`text-xs font-extrabold font-mono mt-0.5 tabular-nums ${lvl.color}`}>
                          {currencyPrefix}{fmtFibPrice(lvl.price)}
                        </div>
                      </div>

                      {/* Proximity / Distance Delta Chip */}
                      <div className="text-[8.5px] font-mono pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-slate-400">
                        {isNear ? (
                          <span className="text-cyan-300 font-bold truncate flex items-center gap-1 tabular-nums">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                            Testing ({diffText} · {pctText})
                          </span>
                        ) : (
                          <span className="text-slate-400 truncate tabular-nums">
                            Δ {diffText} ({pctText})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TIER 1A: COMPACT PnL TELEMETRY STRIP (3-METRIC KPI BAR)
          [Open PnL] | [Booked Profit] | [Target Goal (+$50 / +₹4,261)]
          ═══════════════════════════════════════════════════════════ */}
      <div className="order-[20] panel-delta font-mono-numbers overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-800/80">
          {/* KPI 1: Open PnL */}
          <div className="p-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Open PnL (Unrealized)
              </span>
              <div className={`text-base lg:text-lg font-extrabold mt-0.5 ${
                !isTradeForSelected
                  ? 'text-slate-500'
                  : sniperUnrealisedFmt.isPositive
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}>
                {isTradeForSelected ? sniperUnrealisedFmt.inrText : '---'}
              </div>
            </div>
            <div className="text-right">
              <span className="badge-delta badge-delta-standby">
                {isTradeForSelected ? sniperUnrealisedFmt.usdText : 'Standby'}
              </span>
              <span className="text-[9.5px] text-slate-500 block mt-1">
                {isTradeForSelected && activeTrade ? `${activeTrade.remainingSize} Lots` : '0.00 Lots'}
              </span>
            </div>
          </div>

          {/* KPI 2: Booked Profit */}
          <div className="p-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Booked Profit (Realized)
              </span>
              <div className={`text-base lg:text-lg font-extrabold mt-0.5 ${
                sniperBookedFmt.isPositive ? 'text-emerald-400' : 'text-slate-400'
              }`}>
                {sniperBookedFmt.inrText}
              </div>
            </div>
            <div className="text-right">
              <span className="badge-delta badge-delta-standby">
                {sniperBookedFmt.usdText}
              </span>
              <span className="text-[9.5px] text-slate-500 block mt-1">
                {activeTrade?.profitLocked ? 'Locked @ TP1+' : 'Awaiting TP1'}
              </span>
            </div>
          </div>

          {/* KPI 3: Target Goal */}
          <div className="p-3 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Target Goal
              </span>
              <div className={`text-base lg:text-lg font-extrabold mt-0.5 flex items-baseline gap-1.5 flex-wrap ${
                isTradeForSelected ? 'text-emerald-400' : 'text-slate-300'
              }`}>
                <span>{targetGoalDisplay.value}</span>
                <span className="text-xs font-semibold text-cyan-400/90 font-mono-numbers">
                  · {targetGoalDisplay.rr}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className={`badge-delta ${isTradeForSelected ? 'badge-delta-live' : 'badge-delta-standby'}`}>
                {isTradeForSelected
                  ? (isMicro15 ? '$15 Micro Scalp' : isMicro50 ? '$50 Standard Sniper' : 'H6/L6 Macro')
                  : 'Awaiting Execution'}
              </span>
              <span className="text-[9.5px] text-slate-500 block mt-1">
                {isMicroScalp ? (isMicro15 ? '4-Stage Micro ($15 Risk)' : '4-Stage Standard ($50 Risk)') : 'Institutional Goal'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TIER 2: COLLAPSIBLE AI CONDUIT
          Single compact bar with [View Diagnostics ▾ / ▴] toggle
          ═══════════════════════════════════════════════════════════ */}
      <div className="order-[40] panel-delta font-mono-numbers">
        <div className="p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-cyan-950 border border-cyan-600/60 flex items-center justify-center text-cyan-400 shrink-0">
              <Cpu className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="panel-delta-title">
                  AI Institutional Command Conduit
                </span>
                <span className="badge-delta badge-delta-armed">
                  GEMINI 3.8 FLASH
                </span>
                <span className="badge-delta badge-delta-live">
                  Consensus: {currentSignal.confidence}% ({currentSignal.confidenceStatus})
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            {setSignalSource && (
              <div className="inline-flex items-center p-1 bg-slate-900/90 border border-slate-800/80 rounded-lg gap-1">
                <button
                  type="button"
                  onClick={() => setSignalSource('COMMAND_CENTER')}
                  className={`btn-delta-sm ${signalSource === 'COMMAND_CENTER' ? 'btn-toggle-active' : 'btn-secondary'}`}
                  title="Source signals directly from AI Command Center"
                >
                  <Zap className="w-3 h-3" />
                  <span>AI Command</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSignalSource('QUANT_ALGO')}
                  className={`btn-delta-sm ${signalSource === 'QUANT_ALGO' ? 'btn-toggle-active' : 'btn-secondary'}`}
                  title="Source signals from quantitative algorithmic rules"
                >
                  Quant Algo
                </button>
              </div>
            )}

            {onRefreshAiAnalysis && (
              <button
                type="button"
                onClick={() => onRefreshAiAnalysis(selectedSymbol, selectedTimeframe)}
                disabled={isAiLoading}
                className="btn-delta-sm btn-secondary"
                title="Fetch latest real-time reasoning from Gemini 3.8 Flash"
              >
                <RefreshCw className={`w-3 h-3 ${isAiLoading ? 'animate-spin' : ''}`} />
                <span>{isAiLoading ? 'Syncing...' : 'Re-Analyze'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsAiDiagnosticsOpen(!isAiDiagnosticsOpen)}
              className="btn-delta-sm btn-secondary"
            >
              <span>{isAiDiagnosticsOpen ? 'Hide Diagnostics' : 'View Diagnostics'}</span>
              {isAiDiagnosticsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Collapsible Details */}
        {isAiDiagnosticsOpen && (
          <div className="p-3 pt-0 border-t border-slate-800/80 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs pt-3">
              <div className="p-2.5 bg-slate-950/90 rounded border border-slate-800">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-cyan-400 font-bold">Trend Agent</span>
                  <span className="text-[10px] text-emerald-400">ALIGNED</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed line-clamp-2">
                  {currentSignal.commandCenterAgentConsensus?.trendAgent || aiAnalysis?.multiAgentConsensus?.trendAgent || 'EMA 50 stacked above EMA 200 on 1h, supporting continued upside continuation.'}
                </p>
              </div>

              <div className="p-2.5 bg-slate-950/90 rounded border border-slate-800">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-emerald-400 font-bold">Scalper Agent</span>
                  <span className="text-[10px] text-emerald-400">CONFIRMED</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed line-clamp-2">
                  {currentSignal.commandCenterAgentConsensus?.scalperAgent || aiAnalysis?.multiAgentConsensus?.scalperAgent || '5m volume cluster confirmed absorption at local support band.'}
                </p>
              </div>

              <div className="p-2.5 bg-slate-950/90 rounded border border-slate-800">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-amber-400 font-bold">Sentiment Agent</span>
                  <span className="text-[10px] text-amber-400">POSITIVE</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed line-clamp-2">
                  {currentSignal.commandCenterAgentConsensus?.sentimentAgent || aiAnalysis?.multiAgentConsensus?.sentimentAgent || 'Delta Exchange India funding rate positive and stable.'}
                </p>
              </div>

              <div className="p-2.5 bg-slate-950/90 rounded border border-slate-800">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-rose-400 font-bold">Risk Officer</span>
                  <span className="text-[10px] text-emerald-400">SAFE R:R</span>
                </div>
                <p className="text-slate-300 text-[11px] leading-relaxed line-clamp-2">
                  {currentSignal.commandCenterAgentConsensus?.riskAgent || aiAnalysis?.multiAgentConsensus?.riskAgent || 'Invalidation placed strictly beyond the trailing threshold.'}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <div className="flex items-center gap-2 max-w-2xl">
                <span className="text-cyan-400 font-bold">Catalyst Rationale:</span>
                <span className="text-slate-200 italic">
                  "{currentSignal.commandCenterCatalyst || aiAnalysis?.sentiment?.summary || 'Strong institutional order flow absorbing supply above VWAP with positive funding divergence.'}"
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono-numbers">
                <span>Sentiment: <strong className="text-emerald-400">{currentSignal.commandCenterSentiment?.bullishPercent || 82}% Bullish</strong></span>
                <span>•</span>
                <span>Fear & Greed: <strong className="text-amber-400">{currentSignal.commandCenterFearGreed?.score || 71} ({currentSignal.commandCenterFearGreed?.label || 'Greed'})</strong></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TIER 1B: 2-COLUMN EXECUTION COCKPIT + 4-STAGE PROFIT LADDER (PROMOTED ABOVE THE FOLD)
          - Left: Execution Cockpit (40% width -> lg:col-span-5)
          - Right: 4-Stage Profit Ladder (60% width -> lg:col-span-7)
          ═══════════════════════════════════════════════════════════ */}
      <div className="order-[22] grid grid-cols-1 lg:grid-cols-12 gap-3 min-w-0 max-w-full">
        {/* Left Column (40% width): EXECUTION COCKPIT */}
        <div className="lg:col-span-5 min-w-0 max-w-full panel-delta panel-delta-body flex flex-col justify-between space-y-3">
          <div className="space-y-2.5 font-mono-numbers min-w-0">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2 border-b border-slate-800/80 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <Crosshair className="w-4 h-4 text-cyan-400 shrink-0" />
                <h2 className="panel-delta-title">
                  Execution Cockpit
                </h2>
                <span className={`badge-delta ${
                  isMicro15 ? 'badge-delta-paper' : isMicro50 ? 'badge-delta-armed' : 'badge-delta-standby'
                }`}>
                  {isMicro15 ? (
                    <>
                      <Zap className="w-2.5 h-2.5" />
                      <span>TIER: $15 MICRO</span>
                    </>
                  ) : isMicro50 ? (
                    <>
                      <Crosshair className="w-2.5 h-2.5" />
                      <span>TIER: $50 STANDARD</span>
                    </>
                  ) : (
                    <>
                      <Landmark className="w-2.5 h-2.5" />
                      <span>MACRO</span>
                    </>
                  )}
                </span>
                {isTradeForSelected && activeTrade?.adoptedFromExchange && (
                  <span className="badge-delta badge-delta-live" title="Hydrated & synced live with Delta Exchange India perpetual position">
                    EXCHANGE SYNCED
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {setExecutionTriggerMode && (
                  <button
                    type="button"
                    onClick={() => setExecutionTriggerMode(executionTriggerMode === 'IMMEDIATE_TOUCH' ? 'CANDLE_CLOSE' : 'IMMEDIATE_TOUCH')}
                    className={`btn-delta-sm ${executionTriggerMode === 'IMMEDIATE_TOUCH' ? 'btn-secondary' : 'btn-toggle-active'}`}
                    title="Toggle between Immediate Touch (disarms anti-wick lock) and 5m Close Guard"
                  >
                    <Clock className="w-3 h-3" />
                    <span>{executionTriggerMode === 'IMMEDIATE_TOUCH' ? 'Immediate Touch' : '5m Close Guard'}</span>
                  </button>
                )}
                <span className={`badge-delta ${
                  currentSignal.confidenceStatus === 'Ultra Strong' || currentSignal.confidenceStatus === 'Strong'
                    ? 'badge-delta-live'
                    : currentSignal.confidenceStatus === 'Confluence Active'
                    ? 'badge-delta-armed'
                    : currentSignal.confidenceStatus === 'No Trade'
                    ? 'badge-delta-danger'
                    : 'badge-delta-paper'
                }`}>
                  {currentSignal.confidenceStatus.toUpperCase()}
                </span>
                <span
                  className={`badge-delta ${
                    activeSignalValidity.status === 'OVERDUE'
                      ? 'badge-delta-danger animate-pulse'
                      : activeSignalValidity.status === 'AGING'
                      ? 'badge-delta-paper'
                      : 'badge-delta-live'
                  }`}
                >
                  {activeSignalValidity.status} · Gen {signalGenTimeFormatted}
                </span>
              </div>
            </div>

            {/* Signal & Conviction Row */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider block">Signal Side</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {effectiveSignal === 'LONG' ? (
                    <span className="text-emerald-400 font-bold text-sm flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" /> LONG (BUY)
                    </span>
                  ) : (
                    <span className="text-rose-400 font-bold text-sm flex items-center gap-1">
                      <TrendingDown className="w-4 h-4" /> SHORT (SELL)
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-cyan-400/90 font-mono-numbers mt-0.5 block">
                  Breakout Level: {isShort ? '<= L4' : '>= H4'}
                </span>
              </div>

              <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                <span className="text-slate-400 text-[10px] uppercase tracking-wider block">AI Confidence</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-emerald-400 font-bold text-sm">{currentSignal.confidence}%</span>
                  <span className="text-[10px] text-slate-400">({currentSignal.confidenceStatus})</span>
                </div>
                <span className="text-[9px] text-emerald-400/80 font-mono-numbers mt-0.5 block">
                  AI Consensus Pass
                </span>
              </div>
            </div>

            {/* Sizing, Leverage & R:R */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                <span className="text-slate-400 text-[9.5px] uppercase block">Lot Size</span>
                <div className="mt-0.5 text-white font-bold text-xs truncate">
                  {effectiveLotSize.toFixed(3)} {cleanSymbolBase}
                </div>
                <span
                  className="text-[9px] block truncate text-cyan-400"
                  title={`${effectiveContractsCount} Delta Exchange contracts`}
                >
                  {effectiveContractsCount} cts · Risk-Scaled
                </span>
              </div>

              <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                <span className="text-slate-400 text-[9.5px] uppercase block">Leverage</span>
                <div className="mt-0.5 text-white font-bold text-xs truncate">
                  {Math.min(currentSignal.leverage || 10, maxLeverageCap)}x
                </div>
                <span className="text-[9px] text-cyan-400 block truncate">
                  {marginMode === 'CROSS' ? 'Cross' : 'Isolated'} · {leverageSyncLocked ? 'Global Sync' : `Cap ${maxLeverageCap}x`}
                </span>
              </div>

              <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                <span className="text-slate-400 text-[9.5px] uppercase block">R:R Ratio</span>
                <div className="mt-0.5 text-emerald-400 font-bold text-xs truncate">
                  {currentSignal.riskRewardRatio || `1 : ${currentSignal.riskRewardNumeric || 3.8}`}
                </div>
                <span className="text-[9px] text-slate-500 block truncate">
                  Asymmetric
                </span>
              </div>
            </div>

            {/* Entry Price & Stop Loss */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider">
                    Entry Price
                  </span>
                  <span className="text-[9px] text-cyan-400 font-bold">
                    {isShort ? '<= L4' : '>= H4'}
                  </span>
                </div>
                <span className={`font-bold text-sm block mt-0.5 ${isTargetsHydrated ? 'text-white' : 'text-slate-500'}`}>
                  {displayEntry}
                </span>
              </div>

              <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider">
                    Stop Loss
                  </span>
                  {activeTrade?.riskStatus === 'RISK-FREE' ? (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 font-bold border border-emerald-700">
                      BREAK-EVEN LOCK
                    </span>
                  ) : activeTrade?.riskStatus === 'PROFIT_LOCKED' ? (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950 text-amber-400 font-bold border border-amber-700">
                      LOCKED @ TP2
                    </span>
                  ) : activeTrade?.trailingStopActive ? (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-950 text-cyan-400 font-bold border border-cyan-700">
                      ATR TRAILING
                    </span>
                  ) : (
                    <span className="text-[9px] text-rose-400 font-bold">
                      {isShort ? '> L3' : '< H3'}
                    </span>
                  )}
                </div>
                <span className={`font-bold text-sm block mt-0.5 ${
                  !isTargetsHydrated
                    ? 'text-slate-500'
                    : activeTrade?.riskStatus === 'RISK-FREE' || activeTrade?.riskStatus === 'PROFIT_LOCKED'
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}>
                  {displayStopLoss}
                </span>
              </div>
            </div>

            {/* CPR Width Regime & 5m Candle Wick Protection Row */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`p-2 bg-slate-950/80 rounded border ${
                narrowCprOverrideActive
                  ? 'border-emerald-600/80'
                  : currentSignal.camarilla?.isWideCpr
                  ? 'border-rose-700/80'
                  : 'border-slate-800'
              }`}>
                <span className="text-slate-400 text-[9.5px] uppercase block">Dual-TF CPR Regime</span>
                <div className="mt-0.5">
                  {narrowCprOverrideActive ? (
                    <span className="text-[10px] font-bold text-emerald-300 block truncate inline-flex items-center gap-1" title="5m/15m Narrow CPR <= 0.15% overrides Stretched CPR Standby and routes directly to $15 Micro Sniper">
                      <Zap className="w-3.5 h-3.5 text-amber-400 inline mr-0.5 shrink-0" />
                      <span>5m NARROW ({(currentSignal.cpr5mWidthPct ?? 0).toFixed(2)}%) → $15 MICRO</span>
                    </span>
                  ) : currentSignal.camarilla?.isWideCpr ? (
                    <span className="text-[10px] font-bold text-rose-400 block truncate inline-flex items-center gap-1" title="WIDE CPR - CHOP RISK - BREAKOUT SUPPRESSED">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 inline mr-1 shrink-0" />
                      <span>WIDE CPR (CHOP RISK)</span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-emerald-400 block truncate inline-flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1 shrink-0" />
                      <span>{currentSignal.camarilla?.cprRegime || 'AVERAGE'} CPR (PASS)</span>
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-slate-400 block truncate font-mono-numbers">
                  5m: {(currentSignal.cpr5mWidthPct ?? 0).toFixed(2)}% · 4h: {(currentSignal.cpr4hWidthPct ?? 0).toFixed(2)}% ·{' '}
                  {currentSignal.isWide4hCpr ? 'Iron Condor Armed' : narrowCprOverrideActive ? 'Override Active' : 'Breakouts OK'}
                </span>
              </div>

              <div className={`p-2 bg-slate-950/80 rounded border ${
                !currentSignal.validation?.candleConfirmed ? 'border-amber-700/80' : 'border-slate-800'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[9.5px] uppercase">5m Candle Close</span>
                  {simulate5mCandleClose && (
                    <button
                      type="button"
                      onClick={() => simulate5mCandleClose(selectedSymbol, effectiveSignal === 'LONG' ? (camarilla.h4 * 1.0005) : (camarilla.l4 * 0.9995))}
                      className="text-[9px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                      title="Simulate 5m candle close confirmation for paper testing"
                    >
                      Confirm Bar
                    </button>
                  )}
                </div>
                <div className="mt-0.5">
                  {currentSignal.validation?.candleConfirmed ? (
                    <span className="text-[10px] font-bold text-emerald-400 block truncate inline-flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1 shrink-0" />
                      <span>5M BAR CLOSED (PASS)</span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-400 block truncate inline-flex items-center gap-1 animate-pulse" title="Do NOT enter trades on intra-candle touches">
                      <Clock className="w-3.5 h-3.5 text-amber-400 inline mr-1 shrink-0" />
                      <span>AWAITING 5M CLOSE (<LiveFiveMinCountdown />)</span>
                    </span>
                  )}
                </div>
                <span className="text-[9px] text-slate-500 block truncate">
                  {currentSignal.validation?.candleConfirmed ? (effectiveSignal === 'LONG' ? 'Closed >= H4' : 'Closed <= L4') : 'Wick touch protected'}
                </span>
              </div>
            </div>

            {/* Dual-TF $15 Micro Sniper Telemetry: Independent Slots, Margin <65%, Anti-Chop & EMA 9/20 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[9.5px] font-mono-numbers">
              <div className="px-2 py-1 rounded bg-slate-950/90 border border-slate-800/90">
                <span className="text-slate-500 block uppercase">EMA 9 / EMA 20</span>
                <span className={`font-bold ${(currentSignal.ema9 ?? 0) >= (currentSignal.ema20 ?? 0) ? 'text-emerald-300' : 'text-rose-300'}`}>
                  ${(currentSignal.ema9 ?? 0).toFixed(0)} / ${(currentSignal.ema20 ?? 0).toFixed(0)}
                </span>
              </div>
              <div className="px-2 py-1 rounded bg-slate-950/90 border border-slate-800/90">
                <span className="text-slate-500 block uppercase">Parallel Slots</span>
                <span className="font-bold text-cyan-300">
                  Perp {currentSignal.riskChecks?.perpMicroSlotOccupied ? '1/1' : '0/1'} · Opt {currentSignal.riskChecks?.optionsSpreadSlotOccupied ? '1/1' : '0/1'}
                </span>
              </div>
              <div className="px-2 py-1 rounded bg-slate-950/90 border border-slate-800/90">
                <span className="text-slate-500 block uppercase">Margin Util (&lt;65%)</span>
                <span className={`font-bold ${(currentSignal.riskChecks?.marginUtilizationSafe ?? true) ? 'text-emerald-300' : 'text-rose-400'}`}>
                  {(currentSignal.riskChecks?.accountMarginUtilizationPct ?? 0).toFixed(1)}% / 65%
                </span>
              </div>
              <div className="px-2 py-1 rounded bg-slate-950/90 border border-slate-800/90">
                <span className="text-slate-500 block uppercase">Micro Anti-Chop</span>
                <span className={`font-bold ${(currentSignal.riskChecks?.microAntiChopPassed ?? true) ? 'text-amber-300' : 'text-rose-400'}`}>
                  {currentSignal.riskChecks?.microTradesLastHour ?? 0}/3 hr ·{' '}
                  {(currentSignal.riskChecks?.microSlCooldownRemainingSec ?? 0) > 0
                    ? `${Math.floor((currentSignal.riskChecks?.microSlCooldownRemainingSec ?? 0) / 60)}m${(currentSignal.riskChecks?.microSlCooldownRemainingSec ?? 0) % 60}s SL`
                    : 'Ready'}
                </span>
              </div>
            </div>

            {/* 15m Post-Stop Cooldown Active Notification */}
            {isPairInCooldown && (
              <div className="p-2.5 rounded bg-amber-950/90 border border-amber-600/90 text-amber-300 text-[11px] font-mono-numbers flex items-center justify-between gap-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin-slow shrink-0" />
                  <div>
                    <span className="font-bold text-[11px] block">15-Minute Post-Stop Cooldown</span>
                    <span className="text-[10px] text-amber-300/80 block">
                      Auto-Pilot entries locked: <strong>{Math.floor(cooldownRemainingSec / 60)}m {cooldownRemainingSec % 60}s</strong> remaining
                    </span>
                  </div>
                </div>
                {clearPairCooldown && (
                  <button
                    type="button"
                    onClick={() => clearPairCooldown(selectedSymbol)}
                    className="btn-delta-sm btn-secondary"
                  >
                    Clear Cooldown
                  </button>
                )}
              </div>
            )}

            {/* Circuit Breaker Lock Banner */}
            {consecutiveStopsCount >= 2 && !isAutoSniperEnabled && (
              <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-500/60 text-[11px] font-mono-numbers text-rose-300 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-rose-200">
                  <ShieldCheck className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>CIRCUIT BREAKER: AUTO-PILOT HALTED</span>
                </div>
                <p className="text-[10.5px] text-rose-300/90">
                  AUTO-PILOT HALTED: 2 Consecutive Stops Hit. Session Locked to Preserve Capital.
                </p>
              </div>
            )}

            {/* Operational Status Strips */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="text-slate-500 text-[9.5px] uppercase">Trade Status:</span>
                <span className={`font-bold text-[10px] ${
                  isPositionOpen && activeTrade
                    ? 'text-cyan-400'
                    : isHardBlocked
                    ? 'text-rose-400'
                    : isTargetsHydrated
                    ? 'text-emerald-400'
                    : 'text-slate-400'
                }`}>
                  {isPositionOpen && activeTrade
                    ? activeTrade.tradeStatus
                    : isHardBlocked
                    ? blockSummaryLabel
                    : isTargetsHydrated
                    ? 'CONFIRMED (PASS)'
                    : 'STANDBY'}
                </span>
              </div>

              <div className="p-2 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="text-slate-500 text-[9.5px] uppercase">Risk Status:</span>
                <span className={`font-bold text-[10px] ${
                  isPositionOpen && activeTrade?.riskStatus === 'RISK-FREE' 
                    ? 'text-emerald-400' 
                    : isPositionOpen && activeTrade?.riskStatus === 'PROFIT_LOCKED'
                    ? 'text-amber-400'
                    : isHardBlocked
                    ? 'text-rose-400'
                    : isTargetsHydrated
                    ? 'text-emerald-400'
                    : 'text-slate-400'
                }`}>
                  {isPositionOpen && activeTrade
                    ? activeTrade.riskStatus === 'RISK-FREE' ? 'BREAK-EVEN LOCK' : activeTrade.riskStatus
                    : isHardBlocked
                    ? 'EXECUTION PAUSED'
                    : isTargetsHydrated
                    ? 'READY (PASS)'
                    : 'STANDBY'}
                </span>
              </div>
            </div>

            {/* Intelligence Verdict */}
            <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 text-xs">
              <span className="text-cyan-400 font-bold text-[9.5px] uppercase tracking-wider block mb-0.5">
                AI Verdict:
              </span>
              <p className="italic text-slate-300 font-mono text-[10.5px] leading-relaxed line-clamp-2">
                "{isPositionOpen && activeTrade?.aiVerdict ? activeTrade.aiVerdict : currentSignal.aiVerdict}"
              </p>
            </div>
          </div>

          {/* Action Trigger Pad */}
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            {isTradeForSelected && activeTrade?.bracketWarning && (
              <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-500/40 text-[10.5px] text-amber-200 font-mono-numbers flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Position Open · Bracket Note:</strong> {activeTrade.bracketWarning}
                </span>
              </div>
            )}
            {isLiveUnverified && (
              <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-[11px] text-amber-300 font-mono-numbers flex items-center justify-between gap-2">
                <span>API Keys Required — Connect in Settings</span>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="btn-delta-sm btn-primary shrink-0"
                  >
                    Settings
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!isPositionOpen || !activeTrade ? (
                <>
                  {(isOverdue || isInvalidated) && !isLiveUnverified && (
                    <button
                      type="button"
                      onClick={handleRefreshSignalAction}
                      className="btn-delta-lg btn-danger uppercase"
                      title="Re-anchor stale signal levels to live market price"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Refresh Signal</span>
                    </button>
                  )}
                  {effectiveStandby && !isLiveUnverified && !isHardBlocked && (
                    <button
                      type="button"
                      onClick={() => {
                        setLocalStandbyAfterExit(false);
                        if (onConfirmSignal) onConfirmSignal();
                      }}
                      className="flex-1 btn-delta btn-toggle-active uppercase"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>Confirm Signal (PASS)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onExecuteSniperTrade()}
                    disabled={
                      isExecuting ||
                      isExecutionBlocked ||
                      (!isTargetsHydrated && !isBypassActive)
                    }
                    title={
                      isLiveUnverified
                        ? 'Connect Delta Exchange API Keys in Settings to trade live'
                        : isOverdue
                        ? 'Execution paused: Signal is overdue/stale. Refresh signal first.'
                        : isWideCprBlocked
                        ? 'Execution paused: WIDE CPR (CHOP RISK). Check Bypass HTF / VWAP Guard to override in Paper mode.'
                        : isGate1Fail
                        ? 'Execution paused: Gate 1 Signal Validation failed.'
                        : isBypassActive
                        ? `[EXECUTE ${effectiveSignal}] — [Bypass HTF / VWAP Guard (Paper)] Active`
                        : !isTargetsHydrated
                        ? 'Targets in Standby (---). Confirm signal (PASS) to hydrate targets.'
                        : `Execute Sniper ${effectiveSignal} (${effectiveLotSize} ${selectedSymbol})`
                    }
                    className={`flex-1 btn-delta-lg uppercase ${isShort ? 'btn-danger' : 'btn-primary'}`}
                  >
                    <Zap className="w-4 h-4 fill-current shrink-0" />
                    <div className="flex flex-col items-center leading-tight text-center">
                      <span>
                        {isLiveUnverified
                          ? 'Connect API Keys'
                          : isExecuting
                          ? 'Routing...'
                          : isExecutionBlocked
                          ? blockButtonPrimaryLabel
                          : !isTargetsHydrated && !isBypassActive
                          ? 'Standby (---)'
                          : isShort
                          ? `EXECUTE SHORT (${effectiveLotSize.toFixed(3)} ${cleanSymbolBase} · ${effectiveContractsCount} cts)`
                          : `EXECUTE LONG (${effectiveLotSize.toFixed(3)} ${cleanSymbolBase} · ${effectiveContractsCount} cts)`}
                      </span>
                      <span className="text-[9px] font-mono opacity-85">
                        {isExecutionBlocked
                          ? blockGateStatusLabel
                          : isAutoSniperEnabled
                          ? 'AUTO-FIRING ON TOUCH'
                          : 'MANUAL CONFIRM REQUIRED'}
                      </span>
                    </div>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setLocalStandbyAfterExit(true);
                    onCloseSniperTrade('Manual Hard Reset');
                  }}
                  className="w-full btn-delta-lg btn-danger uppercase"
                >
                  <X className="w-4 h-4" />
                  <span>
                    Close Sniper Position ({sniperNetPnlFmt.combined})
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (60% width): 4-STAGE PROFIT LADDER (Dashdark X Style) */}
        <div className="lg:col-span-7 min-w-0 max-w-full flex flex-col justify-between space-y-2">
          {currentSignal.virginCpr?.hasWarning && currentSignal.virginCpr.warningMessage && (
            <div className="px-3 py-1.5 rounded-lg bg-purple-950/70 border border-purple-500/60 text-purple-200 text-[10.5px] font-mono-numbers flex items-center gap-2 shadow-sm min-w-0 max-w-full">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span
                className="truncate min-w-0"
                title={`VIRGIN CPR TP GUARD: ${currentSignal.virginCpr.warningMessage}${
                  currentSignal.virginCpr.suggestedTpCap ? ` (Cap: ${currencyPrefix}${currentSignal.virginCpr.suggestedTpCap.toLocaleString()})` : ''
                }`}
              >
                <strong className="text-purple-100">VIRGIN CPR TP GUARD:</strong> {currentSignal.virginCpr.warningMessage}
                {currentSignal.virginCpr.suggestedTpCap ? ` (Cap: ${currencyPrefix}${currentSignal.virginCpr.suggestedTpCap.toLocaleString()})` : ''}
              </span>
            </div>
          )}
          <ProfitLadderDashdark
            isShort={isShort}
            entryPrice={effectiveEntry}
            markPrice={livePrice}
            tp1={effectiveTp1}
            tp2={effectiveTp2}
            tp3={effectiveTp3}
            tp4={effectiveTp4}
            activeTrade={activeTrade}
            activeTargetIndex={activeTargetIndex}
            isMicro15={isMicro15}
            lotSize={effectiveLotSize}
            symbol={selectedSymbol}
            liveUsdInrRate={liveUsdInrRate}
            currencyPrefix={currencyPrefix}
            netBreakevenPrice={effectiveEntry > 0 ? (isShort ? effectiveEntry - (1.34 / Math.max(0.001, effectiveLotSize)) : effectiveEntry + (1.34 / Math.max(0.001, effectiveLotSize))) : undefined}
            totalFrictionUsd={1.34}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TIER 3A: 9 SIGNAL VALIDATION CRITERIA & 7-GATE RISK PROTECTION (COLLAPSIBLE)
          ═══════════════════════════════════════════════════════════ */}
      <CollapsibleTierPanel
        id="sniper-validation-and-risk-gates"
        title="Signal Validator (Camarilla 9 Criteria) & 7-Gate Risk Protection"
        tierLabel="TIER 3 · PRE-FLIGHT"
        className="order-[80]"
        bodyClassName="p-3"
        icon={<ShieldCheck className="w-4 h-4 text-emerald-400" />}
        defaultExpandedWhenIdle={!activeTrade}
        summary={
          <>
            <span className={currentSignal.confidence >= 75 ? 'text-emerald-400 font-bold' : 'text-amber-300 font-bold'}>
              Conf {currentSignal.confidence}%
            </span>
            <span className="text-slate-600">·</span>
            <span className={
              isHardBlocked
                ? 'text-rose-400 font-bold'
                : isTargetsHydrated && (currentSignal.riskChecks.tradeApproved || isBypassActive)
                ? 'text-emerald-400 font-bold'
                : 'text-amber-300 font-semibold'
            }>
              {isHardBlocked
                ? blockGateStatusLabel
                : isTargetsHydrated && (currentSignal.riskChecks.tradeApproved || isBypassActive)
                ? isBypassActive
                  ? 'APPROVED (OVERRIDE)'
                  : '7/7 GATES PASS'
                : isArmedConditional
                ? 'ARMED / CONDITIONAL'
                : 'STANDBY / SCANNING'}
            </span>
          </>
        }
      >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 min-w-0 max-w-full">
        {/* Signal Validation Layer (6 cols) */}
        <div id="ai-signal-validator" className="lg:col-span-6 min-w-0 max-w-full panel-delta overflow-hidden transition-all duration-300">
          <div className="panel-delta-header">
            <div className="panel-delta-title" title="1. AI Command Signal Validator (Camarilla H1–H5 / L1–L5)">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">1. AI Command Signal Validator (Camarilla H1–H5 / L1–L5)</span>
            </div>
            <span className="badge-delta badge-delta-live font-mono-numbers">
              ALL REQUIRED FOR ENTRY
            </span>
          </div>
          <div className="panel-delta-body space-y-2.5">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono-numbers min-w-0">
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5 min-w-0">
              <span className="text-slate-300 text-[11px] truncate" title="HTF Trend Confirmation">HTF Trend Confirmation</span>
              <span className="font-bold flex items-center gap-1">
                {currentSignal.validation.higherTimeframeTrendStatus === 'PASS' || (currentSignal.validation.higherTimeframeTrend && !currentSignal.validation.htfDivergenceWarning) ? (
                  <span className="text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> PASS</span>
                ) : currentSignal.validation.higherTimeframeTrendStatus === 'WARNING' || currentSignal.validation.htfDivergenceWarning || currentSignal.confidence >= 75 ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 border border-amber-500/40 text-amber-300 flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400" /> WARNING (ADVISORY)
                  </span>
                ) : (
                  <span className="text-rose-400 flex items-center gap-1"><X className="w-3 h-3" /> FAIL</span>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">VWAP Alignment</span>
              <span className="font-bold flex items-center gap-1">
                {currentSignal.validation.vwapAlignmentStatus === 'PASS' || (currentSignal.validation.vwapAlignment && !currentSignal.validation.htfDivergenceWarning) ? (
                  <span className="text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" /> PASS</span>
                ) : currentSignal.validation.vwapAlignmentStatus === 'WARNING' || currentSignal.validation.htfDivergenceWarning || currentSignal.confidence >= 75 ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 border border-amber-500/40 text-amber-300 flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400" /> WARNING (SUB-OPTIMAL)
                  </span>
                ) : (
                  <span className="text-rose-400 flex items-center gap-1"><X className="w-3 h-3" /> FAIL</span>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">EMA Structure Confirmation</span>
              <span className={`${currentSignal.validation.emaStructure ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {currentSignal.validation.emaStructure ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">Volume Confirmation</span>
              <span className={`${currentSignal.validation.volumeConfirmation ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {currentSignal.validation.volumeConfirmation ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">RSI Momentum Validation</span>
              <span className={`${currentSignal.validation.rsiMomentum ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {currentSignal.validation.rsiMomentum ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">Market Sentiment Alignment</span>
              <span className={`${currentSignal.validation.marketSentiment ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {currentSignal.validation.marketSentiment ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">Camarilla Breakout ({isShort ? 'L4/L3' : 'H4/H3'})</span>
              <span className={`${currentSignal.validation.supportResistance ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {currentSignal.validation.supportResistance ? <><Check className="w-3 h-3" /> PASS</> : <><X className="w-3 h-3" /> FAIL</>}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">Camarilla Ladder ({isShort ? 'L5→L6' : 'H5→H6'})</span>
              <span className={`${currentSignal.validation.riskRewardThreshold ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1`}>
                {currentSignal.validation.riskRewardThreshold ? (
                  <>
                    <Check className="w-3 h-3" /> {currentSignal.riskRewardNumeric ? `${currentSignal.riskRewardNumeric}R` : '3.8R'}
                  </>
                ) : (
                  <>
                    <X className="w-3 h-3" /> FAIL
                  </>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 sm:col-span-2 flex flex-wrap items-center justify-between gap-1.5 min-w-0">
              <span className="text-slate-300 text-[11px]">Fibonacci Swing Confluence (&plusmn;0.15%)</span>
              <span className="font-bold text-[10.5px] flex items-center gap-1 min-w-0 break-words">
                {currentSignal.validation.fibonacciConfluenceStatus === 'PASS' || currentSignal.fibConfluence?.status === 'PASS' ? (
                  <span className="text-emerald-400 flex items-center gap-1 break-words">
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" /> <span>{currentSignal.validation.fibonacciConfluenceDesc || currentSignal.fibConfluence?.description || 'PASS'}</span>
                  </span>
                ) : currentSignal.validation.fibonacciConfluenceStatus === 'ALIGNING' || currentSignal.fibConfluence?.status === 'ALIGNING' ? (
                  <span className="text-amber-300 flex items-center gap-1 break-words">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400 shrink-0" /> <span>{currentSignal.validation.fibonacciConfluenceDesc || currentSignal.fibConfluence?.description || 'ALIGNING'}</span>
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    NEUTRAL (No Confluence)
                  </span>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 sm:col-span-2 flex flex-wrap items-center justify-between gap-1.5 min-w-0">
              <span className="text-slate-300 text-[11px]">Virgin CPR Magnet (3D Unmitigated)</span>
              <span className="font-bold text-[10.5px] flex items-center gap-1 text-left sm:text-right min-w-0 break-words">
                {currentSignal.virginCpr?.hasConfluence ? (
                  <span className="text-purple-300 flex items-center gap-1 break-words">
                    <Check className="w-3 h-3 text-purple-400 shrink-0" />
                    <span>+8% CONVICTION BOOST · {currentSignal.virginCpr.alignedZone?.relation === 'BELOW' ? 'SUPPORT FLOOR' : 'RESISTANCE CEILING'}</span>
                  </span>
                ) : currentSignal.virginCpr?.hasWarning ? (
                  <span className="text-amber-300 flex items-center gap-1 break-words">
                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                    <span>TP FRONT-RUN GUARD (${currentSignal.virginCpr.blockingZone?.cprLow.toLocaleString()}–${currentSignal.virginCpr.blockingZone?.cprHigh.toLocaleString()})</span>
                  </span>
                ) : camarilla.nearestVirginCpr ? (
                  <span className="text-purple-300/90 break-words">
                    MAGNET {camarilla.nearestVirginCpr.relation} (${camarilla.nearestVirginCpr.cprLow.toLocaleString()}–${camarilla.nearestVirginCpr.cprHigh.toLocaleString()} · {camarilla.nearestVirginCpr.distancePct.toFixed(2)}%)
                  </span>
                ) : (
                  <span className="text-slate-400">NONE IN 3D WINDOW</span>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 sm:col-span-2 flex flex-wrap items-center justify-between gap-1.5 min-w-0">
              <span className="text-slate-300 text-[11px]">Confidence &ge; 75% Minimum Threshold</span>
              <span className={`${currentSignal.confidence >= 75 ? 'text-emerald-400' : 'text-rose-400'} font-bold flex items-center gap-1 shrink-0`}>
                {currentSignal.confidence >= 75 ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} {currentSignal.confidence}% ({currentSignal.confidenceStatus})
              </span>
            </div>
          </div>
          </div>
        </div>

        {/* 7-Gate Risk Protection Layer (6 cols) */}
        <div className="lg:col-span-6 min-w-0 max-w-full panel-delta overflow-hidden">
          <div className="panel-delta-header">
            <div className="panel-delta-title" title="7. Risk Protection Layer (Pre-Entry Gates)">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">7. Risk Protection Layer (Pre-Entry Gates)</span>
            </div>
            <span className={`badge-delta font-mono-numbers whitespace-normal break-words ${
              isHardBlocked
                ? 'badge-delta-danger'
                : isTargetsHydrated && (currentSignal.riskChecks.tradeApproved || isBypassActive)
                ? isBypassActive
                  ? 'badge-delta-paper'
                  : 'badge-delta-live'
                : isArmedConditional
                ? 'badge-delta-armed'
                : effectiveStandby && !isLiveUnverified
                ? 'badge-delta-standby'
                : 'badge-delta-danger'
            }`}>
              {isHardBlocked
                ? blockGateStatusLabel
                : isTargetsHydrated && (currentSignal.riskChecks.tradeApproved || isBypassActive)
                ? isBypassActive
                  ? 'TRADE APPROVED (OVERRIDE)'
                  : 'TRADE APPROVED (PASS)'
                : isArmedConditional
                ? 'ARMED / CONDITIONAL'
                : effectiveStandby && !isLiveUnverified
                ? 'STANDBY / SCANNING'
                : blockGateStatusLabel}
            </span>
          </div>
          <div className="panel-delta-body space-y-2.5">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono-numbers min-w-0">
            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5 min-w-0">
              <span className="text-slate-300 text-[11px] truncate" title="1. Signal Validation Passed">1. Signal Validation Passed</span>
              <span>
                {isBypassActive ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50 inline-flex items-center gap-1 shadow-[0_0_8px_rgba(245,158,11,0.2)]" title="Gate #1 overridden for manual Paper Demo testing">
                    <CheckCircle className="w-3 h-3 text-amber-400 inline" />
                    <span>PASS (OVERRIDE)</span>
                  </span>
                ) : (currentSignal.riskChecks.signalValidationPassed && currentSignal.validation?.htfDivergenceWarning) ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1" title="Advisory Warning: AI Conviction >= 75% permits conditional execution">
                    <AlertTriangle className="w-3 h-3 text-amber-400 inline" />
                    <span>PASS (WARNING)</span>
                  </span>
                ) : currentSignal.riskChecks.signalValidationPassed ? (
                  <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>PASS</span>
                  </span>
                ) : !currentSignal.validation?.candleConfirmed ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 inline-flex items-center gap-1 animate-pulse" title="Intra-candle touch protected. Auto-entry locked until 5m bar closes">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span>AWAITING 5M CLOSE (<LiveFiveMinCountdown />)</span>
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold inline-flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>FAIL</span>
                  </span>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">2. Confidence Threshold Met (&ge;75%)</span>
              <span className={currentSignal.riskChecks.confidenceThresholdMet ? 'text-emerald-400 font-bold inline-flex items-center gap-1' : 'text-rose-400 font-bold inline-flex items-center gap-1'}>
                {currentSignal.riskChecks.confidenceThresholdMet ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>PASS</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>FAIL</span>
                  </>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">3. Position Size Received</span>
              <span className={currentSignal.riskChecks.positionSizeReceived ? 'text-emerald-400 font-bold inline-flex items-center gap-1' : 'text-rose-400 font-bold inline-flex items-center gap-1'}>
                {currentSignal.riskChecks.positionSizeReceived ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>{currentSignal.lotSize}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>0</span>
                  </>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">4. Delta Leverage Available</span>
              <span className={currentSignal.riskChecks.deltaLeverageAvailable ? 'text-emerald-400 font-bold inline-flex items-center gap-1' : 'text-rose-400 font-bold inline-flex items-center gap-1'}>
                {currentSignal.riskChecks.deltaLeverageAvailable ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>{Math.min(currentSignal.leverage || 10, maxLeverageCap)}x {marginMode}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>N/A</span>
                  </>
                )}
              </span>
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">5. Sufficient Margin Available</span>
              {currentSignal.riskChecks.sufficientMargin ? (
                <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                  <span>PASS</span>
                </span>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <span className="text-rose-400 font-bold inline-flex items-center gap-1 text-[11px]">
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline" />
                    <span>INSUFFICIENT</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSetExposureMode('MICRO_50')}
                    className="btn-delta-sm btn-toggle-active"
                    title="Switch to $50 Micro Scalp to lower margin requirements and unlock execution gate"
                  >
                    <Zap className="w-3 h-3 text-amber-300" />
                    <span>Switch to $50 Micro Scalp</span>
                  </button>
                </div>
              )}
            </div>

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">6. Risk Limits Not Breached</span>
              <span className={currentSignal.riskChecks.riskLimitsNotBreached ? 'text-emerald-400 font-bold inline-flex items-center gap-1' : 'text-rose-400 font-bold inline-flex items-center gap-1'}>
                {currentSignal.riskChecks.riskLimitsNotBreached ? (
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

            <div className="p-2 bg-slate-950 rounded border border-slate-800/80 sm:col-span-2 flex items-center justify-between">
              <span className="text-slate-300 text-[11px]">7. Trade Execution Status</span>
              <span className={
                isHardBlocked
                  ? 'text-rose-400 font-bold inline-flex items-center gap-1'
                  : isTargetsHydrated && (currentSignal.riskChecks.tradeApproved || isBypassActive)
                  ? isBypassActive
                    ? 'text-amber-300 font-bold inline-flex items-center gap-1'
                    : 'text-emerald-400 font-bold inline-flex items-center gap-1'
                  : isArmedConditional
                  ? 'text-cyan-300 font-bold inline-flex items-center gap-1'
                  : effectiveStandby && !isLiveUnverified
                  ? 'text-slate-400 font-bold inline-flex items-center gap-1'
                  : 'text-rose-400 font-bold inline-flex items-center gap-1'
              }>
                {isHardBlocked ? (
                  <>
                    <XCircle className="w-3.5 h-3.5 text-rose-400 inline mr-1" />
                    <span>{blockGateStatusLabel}</span>
                  </>
                ) : isTargetsHydrated && (currentSignal.riskChecks.tradeApproved || isBypassActive) ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
                    <span>{isBypassActive ? 'TRADE APPROVED (OVERRIDE)' : 'TRADE APPROVED (PASS)'}</span>
                  </>
                ) : isArmedConditional ? (
                  <span className="badge-delta badge-delta-armed">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
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
                    <span>{blockGateStatusLabel}</span>
                  </>
                )}
              </span>
            </div>
          </div>
          </div>
        </div>
      </div>
      </CollapsibleTierPanel>

      {/* ═══════════════════════════════════════════════════════════
          TIER 3B: DOCKED REAL-TIME AUDIT LOG TRAY (COLLAPSIBLE)
          ═══════════════════════════════════════════════════════════ */}
      <CollapsibleTierPanel
        id="sniper-audit-log-tray"
        title="Sniper Scalping Real-Time Audit Log"
        tierLabel="TIER 3 · LOGS"
        className="order-[82]"
        bodyClassName="p-3.5"
        icon={<Activity className="w-4 h-4 text-cyan-400" />}
        defaultExpandedWhenIdle={false}
        summary={
          <>
            <span className="px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/35 text-cyan-300 font-bold">
              {tradeLogs.length} events
            </span>
            {tradeLogs.length > 0 && (
              <>
                <span className="text-slate-600">·</span>
                <span className="truncate max-w-[240px] text-slate-300">Latest: {tradeLogs[0]?.title}</span>
              </>
            )}
          </>
        }
        headerActions={
          <button
            type="button"
            onClick={() => onClearTradeLogs && onClearTradeLogs()}
            disabled={tradeLogs.length === 0}
            className="btn-delta-sm btn-secondary"
            title="Clear audit log history"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        }
      >
        {tradeLogs.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 font-mono-numbers">
            Sniper engine active. Waiting for signal execution or target triggers...
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1 text-xs font-mono-numbers divide-y divide-slate-800/50">
            {tradeLogs.map((log) => (
              <div key={log.id} className="pt-2 flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`badge-delta ${
                      log.type === 'ENTRY' || log.type === 'EXECUTION' || log.type === 'AUTOPILOT'
                        ? 'badge-delta-live'
                        : log.type === 'CONDUIT' || log.type === 'SIGNAL' || log.type === 'TP1' || log.type === 'TP2' || log.type === 'TP3' || log.type === 'TP4'
                        ? 'badge-delta-armed'
                        : log.type === 'TRAILING'
                        ? 'badge-delta-paper'
                        : 'badge-delta-danger'
                    }`}>
                      {log.type === 'CONDUIT' ? (
                        <span className="inline-flex items-center gap-1">
                          <Cpu className="w-2.5 h-2.5" />
                          <span>CONDUIT</span>
                        </span>
                      ) : (
                        log.type
                      )}
                    </span>
                    <span className="font-bold text-white text-xs">{log.title}</span>
                  </div>
                  <p className="text-slate-400 text-[11px] font-sans">{log.description}</p>
                </div>
                <span className="text-[10px] text-slate-500 whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleTierPanel>
    </div>
  );
});
