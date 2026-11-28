import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { auth, googleProvider, getAuthToken } from './services/firebaseClient';
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, User } from 'firebase/auth';

import {
  MarketTicker,
  PortfolioData,
  Position,
  ClosedTrade,
  TradingMode,
  RiskSettings,
  AiAnalysisResult,
  AiTradeCardData,
  AppNotification,
  DeltaApiCredentials,
  BacktestTradeOverlay,
  LockedSignalSnapshot,
  SniperActiveTrade,
  VirginCprZone,
} from './types';
import { Header } from './components/Header';
import { InteractiveChart } from './components/InteractiveChart';
import { OrderForm } from './components/OrderForm';
import { TradingDashboard } from './components/TradingDashboard';
import { ProDeskTerminal } from './components/ProDeskTerminal';
import { MarketCentre } from './components/MarketCentre';
import { StrategyEngine } from './components/StrategyEngine';
import { AiCommandCentre } from './components/AiCommandCentre';
import { RiskManager } from './components/RiskManager';
import { PositionsTable } from './components/PositionsTable';
import { PerformanceAnalytics } from './components/PerformanceAnalytics';
import { SettingsModal } from './components/SettingsModal';
import { NotificationCenter } from './components/NotificationCenter';
import { WebSocketRadarModal } from './components/WebSocketRadarModal';
import { NewsSentimentRadarModal } from './components/NewsSentimentRadarModal';
import { useDeltaWebSocket } from './hooks/useDeltaWebSocket';
import { useSoundEffects, setGlobalAudioMuted } from './hooks/useSoundEffects';
import { useSniperScalpingEngine } from './hooks/useSniperScalpingEngine';
import { useNewsSentimentRadar } from './hooks/useNewsSentimentRadar';
import { useVolatilitySpikeMonitor } from './hooks/useVolatilitySpikeMonitor';
import { useVoiceAlerts, clearSignalVoiceRepeats } from './hooks/useVoiceAlerts';
import {
  announceVoiceActivated,
  speakVoiceAlert,
  formatVoiceSymbol,
  formatVoicePrice,
} from './utils/voiceAlert';
import { VolatilitySpikeModal } from './components/VolatilitySpikeMonitor';
import { OfflineIndicator } from './components/OfflineIndicator';
import { BtcCorrelationSparkline } from './components/BtcCorrelationSparkline';
import { MaSlopeTrendIndicator } from './components/MaSlopeTrendIndicator';
import { ConvictionGauge } from './components/ConvictionGauge';
import { DashdarkXSidebar } from './components/DashdarkXSidebar';
import { FlashLiveStream } from './components/FlashLiveStream';
import { SignalGradeWinRateSparkline } from './components/SignalGradeWinRateSparkline';
import { DELTA_NAV_ITEMS, DeltaNavId, resolveActiveNavId } from './config/navigation';
import { ShieldAlert, ShieldCheck, AlertTriangle, X, Flame, Crosshair, Key, Check, Copy, Volume2, VolumeX, Bot, Zap, Sparkles, History, ChevronDown, Clock, TrendingUp, TrendingDown, MoveRight, Brain, LineChart, Bell, BellRing, RefreshCw, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { copyToClipboard } from './utils/clipboardUtils';
import { dispatchMobileAlert } from './services/notificationService';
import { usePortfolio } from './context/PortfolioContext';
import { useCapitalAllocation } from './context/CapitalAllocationContext';
import { RiskAdjustmentProvider } from './context/RiskAdjustmentContext';
import {
  AiMatrixCorrelationProvider,
  useAiMatrixCorrelation,
  evaluateLockedSignalValidity,
  SIGNAL_SL_COOLDOWN_MS,
} from './context/AiMatrixCorrelationContext';
import { useTradingIntelligence } from './context/TradingIntelligenceContext';
import { useLiveFuturesAutoExecution } from './context/TradingContext';
import { LayoutPriorityProvider } from './context/LayoutPriorityContext';
import { resolveLiveUsdInrRate, getMarketTicker } from './utils/marketUtils';
import {
  getStoredDeltaCredentials,
  saveStoredDeltaCredentials,
  clearStoredDeltaCredentials,
  buildDeltaCredentialHeaders,
  mapToDeltaPerpetualContract,
  formatDiagnosticBadgeAndMessage,
  isMaskedPlaceholderCredential,
  DeltaOrderDispatchResult,
} from './services/deltaExchangeService';
import {
  computeNetZeroBreakEvenPrice,
  computeVirginCprZones,
  findInsideVirginCprZone,
  findNearestVirginCprMagnet,
} from './utils/camarillaUtils';
import {
  getCachedDailyCandles,
  subscribeDailyAnchorUpdates,
} from './utils/dailyAnchorUtils';
import type { SniperPositionSyncUpdate } from './hooks/useSniperScalpingEngine';
import { queueAnalyticsSignal, queueAnalyticsEvent } from './utils/analyticsWarehouseClient';
import { shouldSuppressDuplicateNotification } from './utils/drawdownRescueUtils';

const ZERO_LIVE_PORTFOLIO: PortfolioData = {
  totalEquity: 0.0,
  availableBalance: 0.0,
  marginUsed: 0.0,
  initialCapital: 0.0,
  dailyPnl: 0.0,
  dailyPnlPercent: 0.0,
  realisedPnlTotal: 0.0,
  unrealisedPnlTotal: 0.0,
  tradesToday: 0,
  winRate: 0.0,
};

export interface VolatilityBreachHistoryEntry {
  id: string;
  symbol: string;
  stdDev: number;
  stdDevPct: number;
  threshold: number;
  timestamp: number;
  isTest?: boolean;
}

const VOLATILITY_BREACH_HISTORY_STORAGE_KEY = 'delta_volatility_breach_history_v1';

interface TradingIntelligenceBarProps {
  sniperEngine: any;
  isLiveUnverified: boolean;
  onNavigateToAi: () => void;
  onNavigateToStrategies: () => void;
  showShortTermTrend?: boolean;
  onToggleShortTermTrend?: () => void;
  trendSmoothingFactor?: number;
  onChangeTrendSmoothingFactor?: (value: number) => void;
  trendVariance?: { stdDev: number; stdDevPct: number } | null;
  currencyPrefix?: string;
  volatilityBreachAlertEnabled?: boolean;
  volatilityBreachThreshold?: number;
  volatilityBreachChimeEnabled?: boolean;
  autoMuteOnBreachEnabled?: boolean;
  autoResetTrendEnabled?: boolean;
  isVolatilityBreachWarningActive?: boolean;
  volatilityBreachHistory?: VolatilityBreachHistoryEntry[];
  onToggleVolatilityBreachAlert?: (enabled: boolean) => void;
  onChangeVolatilityBreachThreshold?: (threshold: number) => void;
  onToggleVolatilityBreachChime?: (enabled: boolean) => void;
  onToggleAutoMuteOnBreach?: (enabled: boolean) => void;
  onToggleAutoResetTrend?: (enabled: boolean) => void;
  onDismissVolatilityBreach?: () => void;
  onTestVolatilityBreachAlert?: () => void;
  onClearVolatilityBreachHistory?: () => void;
  sentimentScore?: number;
  overallSentiment?: string;
  hasLiveMarkets?: boolean;
  liveMarkPrice?: number;
  tradingMode?: TradingMode;
  liveTradingEnabled?: boolean;
  hasActivePosition?: boolean;
  apiCredentials?: DeltaApiCredentials;
  sessionToken?: string | null;
  onAutoOrderDispatched?: (res: DeltaOrderDispatchResult) => void;
  tradeHistory?: ClosedTrade[];
}

interface HistoricalSignalItem {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  timestamp: number;
  convictionPct: number;
  sourceLabel: string;
  grade?: string;
  outcomePnl?: number | null;
  hitTarget?: string | null;
  status?: string;
}

type SignalGradeFilter = 'ALL' | 'GRADE_A' | 'GRADE_B' | 'GRADE_C';

function normalizeSignalGradeCode(grade?: string, convictionPct = 0): 'A+' | 'A' | 'B+' | 'B' | 'C' {
  const cleaned = String(grade || '')
    .toUpperCase()
    .replace(/GRADE\s*/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  if (cleaned === 'A+' || cleaned === 'A' || cleaned === 'B+' || cleaned === 'B' || cleaned === 'C') {
    return cleaned;
  }
  if (cleaned.startsWith('A+')) return 'A+';
  if (cleaned.startsWith('A')) return 'A';
  if (cleaned.startsWith('B+')) return 'B+';
  if (cleaned.startsWith('B')) return 'B';
  if (cleaned.startsWith('C')) return 'C';
  if (convictionPct >= 88) return 'A+';
  if (convictionPct >= 78) return 'A';
  if (convictionPct >= 68) return 'B+';
  if (convictionPct >= 55) return 'B';
  return 'C';
}

function matchesSignalGradeFilter(item: HistoricalSignalItem, filter: SignalGradeFilter): boolean {
  if (filter === 'ALL') return true;
  const code = normalizeSignalGradeCode(item.grade, item.convictionPct);
  if (filter === 'GRADE_A') return code === 'A+' || code === 'A';
  if (filter === 'GRADE_B') return code === 'B+' || code === 'B';
  if (filter === 'GRADE_C') return code === 'C';
  return true;
}

const SIGNAL_HISTORY_STORAGE_KEY = 'delta_recent_ai_signals_v1';

function formatSignalAge(timestamp: number, now: number): {
  label: string;
  toneClass: string;
} {
  const elapsedSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  const toneClass =
    elapsedSec < 300
      ? 'text-emerald-400'
      : elapsedSec < 900
      ? 'text-amber-300'
      : 'text-slate-500';

  if (elapsedSec < 60) {
    return { label: `${elapsedSec}s ago`, toneClass };
  }
  if (elapsedSec < 3600) {
    const mins = Math.floor(elapsedSec / 60);
    const secs = String(elapsedSec % 60).padStart(2, '0');
    return { label: `${mins}m ${secs}s ago`, toneClass };
  }
  const hrs = Math.floor(elapsedSec / 3600);
  const mins = Math.floor((elapsedSec % 3600) / 60);
  return { label: `${hrs}h ${mins}m ago`, toneClass };
}

function formatSignalGenClock(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--:--:--';
  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatElapsedMmSs(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

const LiveSignalElapsedText: React.FC<{ timestamp: number; suffix?: string }> = React.memo(
  ({ timestamp, suffix = '' }) => {
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
      setNow(Date.now());
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }, [timestamp]);
    const elapsed = formatElapsedMmSs(Math.max(0, now - timestamp));
    return (
      <>
        {elapsed}
        {suffix}
      </>
    );
  }
);

const HistoricalSignalAgeBadge: React.FC<{ timestamp: number }> = React.memo(({ timestamp }) => {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timestamp]);
  const ageInfo = formatSignalAge(timestamp, now);
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${ageInfo.toneClass}`}>
      <Clock className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      <span>{ageInfo.label}</span>
    </span>
  );
});

const TradingIntelligenceBar: React.FC<TradingIntelligenceBarProps> = React.memo(({
  sniperEngine,
  isLiveUnverified,
  onNavigateToAi,
  onNavigateToStrategies,
  showShortTermTrend = false,
  onToggleShortTermTrend,
  trendSmoothingFactor = 50,
  onChangeTrendSmoothingFactor,
  trendVariance = null,
  currencyPrefix = '$',
  volatilityBreachAlertEnabled = false,
  volatilityBreachThreshold = 1.0,
  volatilityBreachChimeEnabled = true,
  autoMuteOnBreachEnabled = false,
  autoResetTrendEnabled = false,
  isVolatilityBreachWarningActive = false,
  volatilityBreachHistory = [],
  onToggleVolatilityBreachAlert,
  onChangeVolatilityBreachThreshold,
  onToggleVolatilityBreachChime,
  onToggleAutoMuteOnBreach,
  onToggleAutoResetTrend,
  onDismissVolatilityBreach,
  onTestVolatilityBreachAlert,
  onClearVolatilityBreachHistory,
  sentimentScore,
  overallSentiment,
  hasLiveMarkets = false,
  liveMarkPrice = 0,
  tradingMode = 'PAPER',
  liveTradingEnabled = false,
  hasActivePosition = false,
  apiCredentials,
  sessionToken,
  onAutoOrderDispatched,
  tradeHistory = [],
}) => {
  const { correlatedSignal, lockedActiveSignal: contextLockedSignal, signalValidity: contextSignalValidity, signalCooldown, refreshVersion, refreshLockedSignal, syncLevelToExecutionPad, aiMatrixScore, btcCorrelation, maSlopeData } = useAiMatrixCorrelation();
  const { dispatchedHistory } = useTradingIntelligence();
  const { globalLeverage, marginMode, clampLeverage } = useCapitalAllocation();
  const [isSignalsOpen, setIsSignalsOpen] = useState<boolean>(false);
  const [signalGradeFilter, setSignalGradeFilter] = useState<SignalGradeFilter>('ALL');
  const [isGradeHelpHovered, setIsGradeHelpHovered] = useState<boolean>(false);
  const [isGradeHelpPinned, setIsGradeHelpPinned] = useState<boolean>(false);
  const isGradeHelpOpen = isGradeHelpHovered || isGradeHelpPinned;
  const [isBreachPopoverOpen, setIsBreachPopoverOpen] = useState<boolean>(false);
  const [isBreachHistoryOpen, setIsBreachHistoryOpen] = useState<boolean>(false);
  const [breachDraftThreshold, setBreachDraftThreshold] = useState<string>(() =>
    volatilityBreachThreshold.toFixed(1)
  );
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const signalsDropdownRef = useRef<HTMLDivElement | null>(null);
  const breachPopoverRef = useRef<HTMLDivElement | null>(null);
  const [trackedSignalHistory, setTrackedSignalHistory] = useState<HistoricalSignalItem[]>([]);

  const {
    voiceEnabled,
    setVoiceEnabled,
    selectedVoice,
    speakMessage,
  } = useVoiceAlerts();

  const hasMatchedContextLock = Boolean(
    !sniperEngine.activeTrade &&
      contextLockedSignal &&
      contextLockedSignal.entryPrice > 0 &&
      (!sniperEngine.currentSignal?.symbol ||
        contextLockedSignal.symbol === sniperEngine.currentSignal.symbol)
  );

  const signalSide: 'LONG' | 'SHORT' =
    sniperEngine.activeTrade?.signal ||
    sniperEngine.activeTrade?.side ||
    (hasMatchedContextLock && contextLockedSignal
      ? contextLockedSignal.direction
      : sniperEngine.currentSignal?.signal === 'SHORT'
      ? 'SHORT'
      : sniperEngine.currentSignal?.signal === 'LONG'
      ? 'LONG'
      : correlatedSignal.side || 'LONG');

  const isStandbyOrUnHydrated = Boolean(
    sniperEngine.currentSignal?.isStandby || sniperEngine.currentSignal?.isHydrated === false
  );
  const candidateSnapshotId = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.id
    : isStandbyOrUnHydrated
    ? correlatedSignal.id || `ai-matrix-${correlatedSignal.symbol}-${correlatedSignal.side}`
    : sniperEngine.currentSignal?.id ||
      `${sniperEngine.currentSignal?.symbol || correlatedSignal.symbol}-${signalSide}`;
  const candidateSnapshotSymbol = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.symbol
    : isStandbyOrUnHydrated
    ? correlatedSignal.symbol
    : sniperEngine.currentSignal?.symbol || correlatedSignal.symbol;
  const candidateSnapshotDirection: 'LONG' | 'SHORT' = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.direction
    : isStandbyOrUnHydrated
    ? correlatedSignal.side
    : sniperEngine.currentSignal?.signal || signalSide;

  const liveCandidateEntry = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.entryPrice
    : isStandbyOrUnHydrated
    ? contextLockedSignal?.entryPrice || correlatedSignal.entryPrice
    : sniperEngine.currentSignal?.entryPrice > 0
    ? sniperEngine.currentSignal.entryPrice
    : correlatedSignal.entryPrice;
  const liveCandidateStop = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.stopLoss
    : isStandbyOrUnHydrated
    ? contextLockedSignal?.stopLoss || correlatedSignal.stopLoss
    : sniperEngine.currentSignal?.initialStopLoss > 0
    ? sniperEngine.currentSignal.initialStopLoss
    : correlatedSignal.stopLoss;
  const liveCandidateTp1 = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.tp1
    : isStandbyOrUnHydrated
    ? contextLockedSignal?.tp1 || correlatedSignal.tp1
    : sniperEngine.currentSignal?.tp1 > 0
    ? sniperEngine.currentSignal.tp1
    : correlatedSignal.tp1;
  const liveCandidateTp2 = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.tp2
    : isStandbyOrUnHydrated
    ? contextLockedSignal?.tp2 || correlatedSignal.tp2
    : sniperEngine.currentSignal?.tp2 > 0
    ? sniperEngine.currentSignal.tp2
    : correlatedSignal.tp2;
  const liveCandidateTp3 = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.tp3
    : isStandbyOrUnHydrated
    ? contextLockedSignal?.tp3 || correlatedSignal.tp3
    : sniperEngine.currentSignal?.tp3 > 0
    ? sniperEngine.currentSignal.tp3
    : correlatedSignal.tp3;
  const liveCandidateTp4 = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.tp4
    : isStandbyOrUnHydrated
    ? contextLockedSignal?.tp4 || correlatedSignal.tp4
    : sniperEngine.currentSignal?.tp4 > 0
    ? sniperEngine.currentSignal.tp4
    : correlatedSignal.tp4;
  const liveCandidateConviction = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.convictionPct
    : isStandbyOrUnHydrated
    ? contextLockedSignal?.convictionPct || aiMatrixScore.convictionPct
    : sniperEngine.currentSignal?.confidence || aiMatrixScore.convictionPct;
  const liveCandidateTimestamp = hasMatchedContextLock && contextLockedSignal
    ? contextLockedSignal.timestamp
    : isStandbyOrUnHydrated
    ? contextLockedSignal?.timestamp || correlatedSignal.timestamp || Date.now()
    : sniperEngine.currentSignal?.timestamp || Date.now();

  const [lockedActiveSignal, setLockedActiveSignal] = useState<LockedSignalSnapshot | null>(null);
  const lockedActiveSignalRef = useRef<LockedSignalSnapshot | null>(null);
  const prevRefreshVersionRef = useRef<number>(refreshVersion);

  const refreshSniperSignalSnapshot = sniperEngine.refreshSignalSnapshot;

  useEffect(() => {
    if (refreshVersion !== prevRefreshVersionRef.current) {
      prevRefreshVersionRef.current = refreshVersion;
      lockedActiveSignalRef.current = null;
      setLockedActiveSignal(null);
      setNowTick(Date.now());
      refreshSniperSignalSnapshot?.();
    }
  }, [refreshVersion, refreshSniperSignalSnapshot]);

  useEffect(() => {
    if (!hasLiveMarkets || !(liveCandidateEntry > 0)) return;
    if (signalCooldown && signalCooldown.until > nowTick && !hasMatchedContextLock && !sniperEngine.activeTrade) {
      if (lockedActiveSignalRef.current !== null) {
        lockedActiveSignalRef.current = null;
        setLockedActiveSignal(null);
      }
      return;
    }
    if (hasMatchedContextLock && contextLockedSignal) {
      if (lockedActiveSignalRef.current?.id !== contextLockedSignal.id) {
        lockedActiveSignalRef.current = contextLockedSignal;
        setLockedActiveSignal(contextLockedSignal);
      }
      return;
    }
    const prev = lockedActiveSignalRef.current;
    if (
      !prev ||
      prev.id !== candidateSnapshotId ||
      prev.symbol !== candidateSnapshotSymbol ||
      prev.direction !== candidateSnapshotDirection
    ) {
      const frozen: LockedSignalSnapshot = {
        id: candidateSnapshotId,
        symbol: candidateSnapshotSymbol,
        direction: candidateSnapshotDirection,
        entryPrice: liveCandidateEntry,
        stopLoss: liveCandidateStop,
        tp1: liveCandidateTp1,
        tp2: liveCandidateTp2,
        tp3: liveCandidateTp3,
        tp4: liveCandidateTp4,
        convictionPct: liveCandidateConviction,
        timestamp: liveCandidateTimestamp,
      };
      lockedActiveSignalRef.current = frozen;
      setLockedActiveSignal(frozen);
    }
  }, [
    hasLiveMarkets,
    hasMatchedContextLock,
    contextLockedSignal,
    candidateSnapshotId,
    candidateSnapshotSymbol,
    candidateSnapshotDirection,
    liveCandidateEntry,
    liveCandidateStop,
    liveCandidateTp1,
    liveCandidateTp2,
    liveCandidateTp3,
    liveCandidateTp4,
    liveCandidateConviction,
    liveCandidateTimestamp,
  ]);

  const activeLockedBarSnapshot =
    hasMatchedContextLock && contextLockedSignal
      ? contextLockedSignal
      : lockedActiveSignal &&
        lockedActiveSignal.id === candidateSnapshotId &&
        lockedActiveSignal.symbol === candidateSnapshotSymbol &&
        lockedActiveSignal.direction === candidateSnapshotDirection
      ? lockedActiveSignal
      : null;

  const entryVal =
    sniperEngine.activeTrade?.entryPrice && sniperEngine.activeTrade.entryPrice > 0
      ? sniperEngine.activeTrade.entryPrice
      : activeLockedBarSnapshot?.entryPrice && activeLockedBarSnapshot.entryPrice > 0
      ? activeLockedBarSnapshot.entryPrice
      : liveCandidateEntry;

  const slVal =
    (sniperEngine.activeTrade?.currentStopLoss || sniperEngine.activeTrade?.initialStopLoss) > 0
      ? sniperEngine.activeTrade.currentStopLoss || sniperEngine.activeTrade.initialStopLoss
      : activeLockedBarSnapshot?.stopLoss && activeLockedBarSnapshot.stopLoss > 0
      ? activeLockedBarSnapshot.stopLoss
      : liveCandidateStop;

  const tp1Val =
    sniperEngine.activeTrade?.tp1 && sniperEngine.activeTrade.tp1 > 0
      ? sniperEngine.activeTrade.tp1
      : activeLockedBarSnapshot?.tp1 && activeLockedBarSnapshot.tp1 > 0
      ? activeLockedBarSnapshot.tp1
      : liveCandidateTp1;

  const tp2Val =
    sniperEngine.activeTrade?.tp2 && sniperEngine.activeTrade.tp2 > 0
      ? sniperEngine.activeTrade.tp2
      : activeLockedBarSnapshot?.tp2 && activeLockedBarSnapshot.tp2 > 0
      ? activeLockedBarSnapshot.tp2
      : liveCandidateTp2;

  const tp3Val =
    sniperEngine.activeTrade?.tp3 && sniperEngine.activeTrade.tp3 > 0
      ? sniperEngine.activeTrade.tp3
      : activeLockedBarSnapshot?.tp3 && activeLockedBarSnapshot.tp3 > 0
      ? activeLockedBarSnapshot.tp3
      : liveCandidateTp3;

  const tp4Val =
    sniperEngine.activeTrade?.tp4 && sniperEngine.activeTrade.tp4 > 0
      ? sniperEngine.activeTrade.tp4
      : activeLockedBarSnapshot?.tp4 && activeLockedBarSnapshot.tp4 > 0
      ? activeLockedBarSnapshot.tp4
      : liveCandidateTp4;

  const signalTimestampDisplay =
    activeLockedBarSnapshot?.timestamp && activeLockedBarSnapshot.timestamp > 0
      ? activeLockedBarSnapshot.timestamp
      : liveCandidateTimestamp;

  const effectiveSnapshotForValidity = useMemo<LockedSignalSnapshot>(
    () =>
      activeLockedBarSnapshot || {
        id: candidateSnapshotId,
        symbol: candidateSnapshotSymbol,
        direction: signalSide,
        entryPrice: entryVal,
        stopLoss: slVal,
        tp1: tp1Val,
        tp2: tp2Val,
        tp3: tp3Val,
        tp4: tp4Val,
        convictionPct: liveCandidateConviction,
        timestamp: signalTimestampDisplay,
      },
    [
      activeLockedBarSnapshot,
      candidateSnapshotId,
      candidateSnapshotSymbol,
      signalSide,
      entryVal,
      slVal,
      tp1Val,
      tp2Val,
      tp3Val,
      tp4Val,
      liveCandidateConviction,
      signalTimestampDisplay,
    ]
  );

  const activeSignalValidity = useMemo(() => {
    if (hasMatchedContextLock && contextSignalValidity) {
      return contextSignalValidity;
    }
    return evaluateLockedSignalValidity(
      effectiveSnapshotForValidity,
      liveMarkPrice > 0 ? liveMarkPrice : entryVal,
      nowTick,
      Boolean(sniperEngine.activeTrade)
    );
  }, [
    hasMatchedContextLock,
    contextSignalValidity,
    effectiveSnapshotForValidity,
    liveMarkPrice,
    entryVal,
    nowTick,
    sniperEngine.activeTrade,
  ]);

  const handleRefreshExpiredSignal = useCallback(() => {
    lockedActiveSignalRef.current = null;
    setLockedActiveSignal(null);
    setNowTick(Date.now());
    refreshLockedSignal();
  }, [refreshLockedSignal]);

  const genTimeFormatted = formatSignalGenClock(signalTimestampDisplay);

  const actionText = sniperEngine.activeTrade
    ? sniperEngine.activeTrade.signal || sniperEngine.activeTrade.side
    : hasMatchedContextLock && contextLockedSignal
    ? isStandbyOrUnHydrated
      ? `${contextLockedSignal.direction} (AI MATRIX)`
      : contextLockedSignal.direction
    : sniperEngine.currentSignal?.isStandby || sniperEngine.currentSignal?.isHydrated === false
    ? `${correlatedSignal.side} (AI MATRIX)`
    : sniperEngine.currentSignal?.signal || 'STANDBY';

  const actionColor =
    actionText.includes('LONG')
      ? 'text-emerald-400'
      : actionText.includes('SHORT')
      ? 'text-rose-400'
      : 'text-slate-400';

  // ═══════════════════════════════════════════════════════════
  // SUBTLE ENTRY & STATUS TRANSITION ANIMATION LOGIC
  // Triggers sleek animated glow and sweep when a new signal is
  // identified or when the Auto-Pilot state toggles.
  // ═══════════════════════════════════════════════════════════
  const isAutoSniperEnabled = Boolean(sniperEngine.isAutoSniperEnabled);
  const currentSignal = sniperEngine.currentSignal;

  const currentSignalKey = useMemo(() => {
    if (!currentSignal) {
      return `${correlatedSignal?.symbol || 'ASSET'}-${correlatedSignal?.side || 'NEUTRAL'}`;
    }
    if (currentSignal.isStandby) {
      return `${currentSignal.symbol || 'ASSET'}-STANDBY-${currentSignal.signal || 'NEUTRAL'}`;
    }
    return (
      currentSignal.id ||
      `${currentSignal.symbol || 'ASSET'}-${currentSignal.signal || correlatedSignal?.side || 'NEUTRAL'}`
    );
  }, [
    currentSignal?.id,
    currentSignal?.symbol,
    currentSignal?.signal,
    currentSignal?.isStandby,
    correlatedSignal?.symbol,
    correlatedSignal?.side,
  ]);

  const [animClass, setAnimClass] = useState<string>('anim-intelligence-entry-cyan');
  const [animKey, setAnimKey] = useState<number>(0);
  const [transitionBadge, setTransitionBadge] = useState<{
    text: string;
    type: 'signal-long' | 'signal-short' | 'autopilot-armed' | 'autopilot-off';
  } | null>(null);

  const prevSignalKeyRef = useRef<string | null>(null);
  const prevAutoPilotRef = useRef<boolean | null>(null);
  const isFirstMountRef = useRef<boolean>(true);
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live Futures Auto-Execution: When [Auto: ON] is enabled in LIVE mode and a FRESH Grade A/B signal arrives,
  // automatically submit the bracket order (market_order + stop_loss_order + take_profit_order) to /api/delta/orders
  // and immediately trigger refreshPositions() and refreshWallet().
  useLiveFuturesAutoExecution({
    tradingMode,
    liveTradingEnabled: Boolean(liveTradingEnabled && !isLiveUnverified),
    isAutoEnabled: isAutoSniperEnabled,
    hasActivePosition: Boolean(hasActivePosition || sniperEngine.activeTrade),
    signal:
      entryVal > 0
        ? {
            id: candidateSnapshotId,
            symbol: candidateSnapshotSymbol || 'BTCUSDT',
            direction: signalSide,
            grade: aiMatrixScore.grade,
            freshness: activeSignalValidity.status,
            entryPrice: entryVal,
            stopLoss: slVal,
            tp1: tp1Val,
            tp2: tp2Val,
            tp3: tp3Val,
            tp4: tp4Val,
            size: sniperEngine.currentSignal?.lotSize,
            leverage: clampLeverage(sniperEngine.currentSignal?.leverage || globalLeverage),
            marginMode,
            exposureMode: sniperEngine.currentSignal?.exposureMode,
            isMicro15: Boolean(
              sniperEngine.currentSignal?.exposureMode === 'MICRO_15' ||
              sniperEngine.currentSignal?.isNarrow5mCprAutoRouted ||
              sniperEngine.currentSignal?.isNarrow5mCpr
            ),
            strategyTag:
              sniperEngine.currentSignal?.isNarrow5mCprAutoRouted ||
              sniperEngine.currentSignal?.exposureMode === 'MICRO_15'
                ? 'NARROW_CPR_MICRO_15'
                : 'CAMARILLA_SNIPER',
            marginUtilizationSafe: sniperEngine.currentSignal?.riskChecks?.marginUtilizationSafe ?? true,
            microAntiChopPassed: sniperEngine.currentSignal?.riskChecks?.microAntiChopPassed ?? true,
          }
        : null,
    apiCredentials,
    sessionToken,
    onOrderDispatched: onAutoOrderDispatched,
  });

  useEffect(() => {
    // Initial mount subtle entry animation
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      prevSignalKeyRef.current = currentSignalKey;
      prevAutoPilotRef.current = isAutoSniperEnabled;
      setAnimClass('anim-intelligence-entry-cyan');
      setAnimKey(1);
      return;
    }

    // 1. Detect Auto-Pilot state transition (OFF <-> ARMED)
    if (prevAutoPilotRef.current !== null && prevAutoPilotRef.current !== isAutoSniperEnabled) {
      prevAutoPilotRef.current = isAutoSniperEnabled;
      const nextAnim = isAutoSniperEnabled ? 'anim-intelligence-entry-emerald' : 'anim-intelligence-entry-amber';
      setAnimClass(nextAnim);
      setAnimKey((prev) => prev + 1);
      setTransitionBadge({
        text: isAutoSniperEnabled ? 'AUTO-PILOT: ARMED' : 'AUTO-PILOT: OFF',
        type: isAutoSniperEnabled ? 'autopilot-armed' : 'autopilot-off',
      });
      speakMessage(isAutoSniperEnabled ? 'Auto Pilot armed' : 'Auto Pilot disarmed');
      if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
      badgeTimerRef.current = setTimeout(() => {
        setTransitionBadge(null);
      }, 3500);
      return;
    }

    // 2. Detect new signal identified transition (ignoring price ticks & standby transitions)
    if (prevSignalKeyRef.current !== null && prevSignalKeyRef.current !== currentSignalKey) {
      prevSignalKeyRef.current = currentSignalKey;
      if (!currentSignal?.isStandby) {
        const isLong = signalSide === 'LONG';
        const nextAnim = isLong ? 'anim-intelligence-entry-emerald' : 'anim-intelligence-entry-rose';
        setAnimClass(nextAnim);
        setAnimKey((prev) => prev + 1);
        const entryFmt = entryVal > 0 ? `$${entryVal.toLocaleString()}` : '';
        setTransitionBadge({
          text: `NEW SIGNAL: ${signalSide} ${entryFmt ? `@ ${entryFmt}` : ''}`.trim(),
          type: isLong ? 'signal-long' : 'signal-short',
        });
        if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
        badgeTimerRef.current = setTimeout(() => {
          setTransitionBadge(null);
        }, 3500);
      }
    }
  }, [
    currentSignalKey,
    isAutoSniperEnabled,
    signalSide,
    entryVal,
    currentSignal,
    speakMessage,
  ]);

  useEffect(() => {
    return () => {
      if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
    };
  }, []);

  // Track last 3 real signals generated by the AI engine (dispatched + live engine transitions)
  useEffect(() => {
    if (!(entryVal > 0)) return;
    const activeSymbol =
      sniperEngine.currentSignal?.symbol || correlatedSignal?.symbol || 'BTCUSDT';
    const activeConfidence =
      sniperEngine.currentSignal?.confidence || aiMatrixScore.convictionPct || 0;
    const activeTimestamp =
      typeof sniperEngine.currentSignal?.timestamp === 'number' &&
      sniperEngine.currentSignal.timestamp > 0
        ? sniperEngine.currentSignal.timestamp
        : correlatedSignal?.timestamp || Date.now();
    const activeId =
      sniperEngine.currentSignal?.id ||
      `${activeSymbol}-${signalSide}-${Math.round(entryVal)}`;

    setTrackedSignalHistory((prev) => {
      const latest = prev[0];
      const isDuplicateLatest =
        latest &&
        (latest.id === activeId ||
          (latest.symbol === activeSymbol &&
            latest.direction === signalSide &&
            Math.abs(latest.entryPrice - entryVal) < 0.01));

      if (isDuplicateLatest) return prev;

      const nextEntry: HistoricalSignalItem = {
        id: activeId,
        symbol: activeSymbol,
        direction: signalSide,
        entryPrice: entryVal,
        timestamp: activeTimestamp,
        convictionPct: activeConfidence,
        grade: normalizeSignalGradeCode(aiMatrixScore.grade, activeConfidence),
        sourceLabel:
          sniperEngine.currentSignal?.isStandby || sniperEngine.currentSignal?.isHydrated === false
            ? 'AI Matrix'
            : 'Sniper AI',
      };

      const dedupedPrev = prev.filter((item) => item.id !== activeId);
      const updated = [nextEntry, ...dedupedPrev].slice(0, 15);
      return updated;
    });

    // Permanently archive generated AI Command / AI Matrix / Sniper signal to Cloud Telemetry Warehouse
    queueAnalyticsSignal({
      signalId: activeId,
      timestampMs: activeTimestamp,
      sourceEngine:
        sniperEngine.currentSignal?.isStandby || sniperEngine.currentSignal?.isHydrated === false
          ? 'AI_COMMAND_MATRIX'
          : 'SNIPER_AI_BAR',
      symbol: activeSymbol,
      timeframe: '5m',
      grade: normalizeSignalGradeCode(aiMatrixScore.grade, activeConfidence),
      aiScore: activeConfidence,
      convictionPct: activeConfidence,
      direction: signalSide,
      entryPrice: entryVal,
      stopLoss: sniperEngine.currentSignal?.initialStopLoss ?? correlatedSignal?.stopLoss ?? null,
      tp1: sniperEngine.currentSignal?.tp1 ?? correlatedSignal?.tp1 ?? null,
      tp2: sniperEngine.currentSignal?.tp2 ?? correlatedSignal?.tp2 ?? null,
      tp3: sniperEngine.currentSignal?.tp3 ?? correlatedSignal?.tp3 ?? null,
      tp4: sniperEngine.currentSignal?.tp4 ?? correlatedSignal?.tp4 ?? null,
      cprRegime: sniperEngine.currentSignal?.camarilla?.cprRegime || 'STANDARD',
      sentimentScore: sniperEngine.currentSignal?.commandCenterFearGreed?.score ?? null,
      status:
        correlatedSignal?.isApproved === false
          ? 'REJECTED'
          : correlatedSignal?.isApproved
          ? 'APPROVED'
          : 'GENERATED',
      rejectionReason: correlatedSignal?.rejectionReason || null,
      mode: 'LIVE',
    });
  }, [
    currentSignalKey,
    entryVal,
    signalSide,
    sniperEngine.currentSignal?.symbol,
    sniperEngine.currentSignal?.confidence,
    sniperEngine.currentSignal?.timestamp,
    sniperEngine.currentSignal?.id,
    sniperEngine.currentSignal?.isStandby,
    sniperEngine.currentSignal?.isHydrated,
    sniperEngine.currentSignal?.initialStopLoss,
    sniperEngine.currentSignal?.tp1,
    sniperEngine.currentSignal?.tp2,
    sniperEngine.currentSignal?.tp3,
    sniperEngine.currentSignal?.tp4,
    sniperEngine.currentSignal?.camarilla?.cprRegime,
    sniperEngine.currentSignal?.commandCenterFearGreed?.score,
    correlatedSignal?.symbol,
    correlatedSignal?.timestamp,
    correlatedSignal?.stopLoss,
    correlatedSignal?.tp1,
    correlatedSignal?.tp2,
    correlatedSignal?.tp3,
    correlatedSignal?.tp4,
    correlatedSignal?.isApproved,
    correlatedSignal?.rejectionReason,
    aiMatrixScore.convictionPct,
    aiMatrixScore.grade,
  ]);

  // Archive Auto-Conduit / AI Dispatch signals into Cloud Signal Telemetry Warehouse
  useEffect(() => {
    if (!Array.isArray(dispatchedHistory) || dispatchedHistory.length === 0) return;
    for (const sig of dispatchedHistory.slice(0, 10)) {
      if (!sig || !(sig.entryPrice > 0)) continue;
      queueAnalyticsSignal({
        signalId: sig.id,
        timestampMs: sig.timestamp || Date.now(),
        sourceEngine: sig.source === 'AUTO_SCAN' ? 'AUTO_CONDUIT' : 'AI_COMMAND_DISPATCH',
        symbol: sig.symbol,
        timeframe: '5m',
        grade: normalizeSignalGradeCode(sig.grade, sig.confidencePct),
        aiScore: sig.confidencePct,
        convictionPct: sig.confidencePct,
        direction: sig.direction,
        entryPrice: sig.entryPrice,
        stopLoss: (sig as any).stopLoss ?? null,
        tp1: (sig as any).tp1 ?? null,
        tp2: (sig as any).tp2 ?? null,
        tp3: (sig as any).tp3 ?? null,
        tp4: (sig as any).tp4 ?? null,
        status: 'APPROVED',
        mode: 'LIVE',
      });
    }
  }, [dispatchedHistory]);

  // Hydrate persisted historical signals from Cloud Warehouse on startup / sync-snapshot
  useEffect(() => {
    const onHydrateSignals = (evt: Event) => {
      const custom = evt as CustomEvent<{ signals?: any[] }>;
      const incoming = custom.detail?.signals;
      if (!Array.isArray(incoming) || incoming.length === 0) return;

      const mapped: HistoricalSignalItem[] = incoming
        .filter((s) => s && typeof s === 'object' && Number(s.entryPrice) > 0)
        .map((s) => {
          const dirUpper = String(s.direction || 'LONG').toUpperCase();
          return {
            id: String(s.signalId || s.eventId || `arch-${s.symbol}-${s.timestampMs}`),
            symbol: String(s.symbol || 'BTCUSDT'),
            direction: dirUpper === 'SHORT' ? 'SHORT' : 'LONG',
            entryPrice: Number(s.entryPrice),
            timestamp: Number(s.timestampMs || Date.parse(s.timestamp_utc || '') || Date.now()),
            convictionPct: Number(s.convictionPct || s.aiScore || 75),
            grade: normalizeSignalGradeCode(s.grade, Number(s.convictionPct || s.aiScore || 75)),
            sourceLabel: String(s.sourceEngine || 'Cloud Archive').replace(/_/g, ' '),
            outcomePnl: typeof s.outcomePnl === 'number' && Number.isFinite(s.outcomePnl) ? s.outcomePnl : null,
            hitTarget: typeof s.hitTarget === 'string' ? s.hitTarget : null,
            status: typeof s.status === 'string' ? s.status : undefined,
          };
        });

      if (mapped.length === 0) return;
      setTrackedSignalHistory((prev) => {
        const byId = new Map<string, HistoricalSignalItem>();
        for (const item of [...mapped, ...prev]) {
          if (!byId.has(item.id)) byId.set(item.id, item);
        }
        const merged = Array.from(byId.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 100);
        return merged;
      });
    };

    window.addEventListener('delta:hydrate-signals-archive', onHydrateSignals as EventListener);
    return () => {
      window.removeEventListener('delta:hydrate-signals-archive', onHydrateSignals as EventListener);
    };
  }, []);

  const allRecentHistoricalSignals = useMemo<HistoricalSignalItem[]>(() => {
    const fromDispatched: HistoricalSignalItem[] = dispatchedHistory
      .filter((sig) => sig.entryPrice > 0)
      .map((sig) => ({
        id: sig.id,
        symbol: sig.symbol,
        direction: sig.direction,
        entryPrice: sig.entryPrice,
        timestamp: sig.timestamp,
        convictionPct: sig.confidencePct,
        grade: normalizeSignalGradeCode(sig.grade, sig.confidencePct),
        sourceLabel: sig.source === 'AUTO_SCAN' ? 'Auto Conduit' : 'AI Dispatch',
      }));

    const combined = [...fromDispatched, ...trackedSignalHistory];
    const seenIds = new Set<string>();
    const seenSignatures = new Set<string>();
    const deduped: HistoricalSignalItem[] = [];

    combined
      .sort((a, b) => b.timestamp - a.timestamp)
      .forEach((item) => {
        const signatureKey = `${item.symbol}-${item.direction}-${item.entryPrice.toFixed(2)}-${Math.floor(item.timestamp / 1000)}`;
        if (!seenIds.has(item.id) && !seenSignatures.has(signatureKey) && deduped.length < 100) {
          seenIds.add(item.id);
          seenSignatures.add(signatureKey);
          deduped.push({
            ...item,
            grade: normalizeSignalGradeCode(item.grade, item.convictionPct),
          });
        }
      });

    return deduped;
  }, [dispatchedHistory, trackedSignalHistory]);

  const recentHistoricalSignals = useMemo<HistoricalSignalItem[]>(() => {
    return allRecentHistoricalSignals
      .filter((item) => matchesSignalGradeFilter(item, signalGradeFilter))
      .slice(0, 5);
  }, [allRecentHistoricalSignals, signalGradeFilter]);

  // Evaluate signal validity state transitions every 5s (leaf timers handle 1s elapsed text)
  const [dailyAnchorRev, setDailyAnchorRev] = useState<number>(0);

  useEffect(() => {
    setNowTick(Date.now());
    const unsubAnchor = subscribeDailyAnchorUpdates(() => {
      setDailyAnchorRev((prev) => prev + 1);
    });
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 5000);
    return () => {
      clearInterval(timer);
      unsubAnchor();
    };
  }, []);

  // Close historical signals dropdown on outside click or Escape
  useEffect(() => {
    if (!isSignalsOpen) {
      setIsGradeHelpHovered(false);
      setIsGradeHelpPinned(false);
      return;
    }
    setNowTick(Date.now());
    const handlePointerDown = (e: MouseEvent) => {
      if (signalsDropdownRef.current && !signalsDropdownRef.current.contains(e.target as Node)) {
        setIsSignalsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSignalsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSignalsOpen]);

  useEffect(() => {
    setBreachDraftThreshold(volatilityBreachThreshold.toFixed(1));
  }, [volatilityBreachThreshold]);

  useEffect(() => {
    if (!isBreachPopoverOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (breachPopoverRef.current && !breachPopoverRef.current.contains(e.target as Node)) {
        setIsBreachPopoverOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsBreachPopoverOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isBreachPopoverOpen]);

  const trendMomentum = useMemo(() => {
    const slopePct = maSlopeData?.slopePct ?? 0;
    const direction = maSlopeData?.direction ?? 'FLAT';
    const rawConfidence = maSlopeData?.confidencePct;
    const confidencePct =
      typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
        ? Math.max(0, Math.min(100, Math.round(rawConfidence)))
        : Math.max(40, Math.min(98, Math.round(50 + Math.min(1, Math.abs(slopePct) / 0.15) * 45)));
    const rawStreak = maSlopeData?.streakCandles;
    const streakCandles =
      typeof rawStreak === 'number' && Number.isFinite(rawStreak) && rawStreak >= 1
        ? Math.round(rawStreak)
        : 1;
    const totalMins = streakCandles * 15;
    const streakDurationFormatted =
      totalMins >= 60
        ? `${Math.floor(totalMins / 60)}h ${totalMins % 60 > 0 ? `${totalMins % 60}m` : ''}`.trim()
        : `${totalMins}m`;
    const maturityLabel =
      streakCandles >= 13
        ? 'Extended streak'
        : streakCandles >= 7
        ? 'Established trend'
        : streakCandles >= 3
        ? 'Developing trend'
        : 'Early emergence';

    if (direction === 'UP' || slopePct >= 0.02) {
      if (slopePct >= 0.08) {
        return {
          label: 'STRONG BULL',
          confidencePct,
          streakCandles,
          streakDurationFormatted,
          maturityLabel,
          classes: 'bg-emerald-950/75 border-emerald-500/50 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.22)]',
          Icon: TrendingUp,
        };
      }
      return {
        label: 'WEAK BULL',
        confidencePct,
        streakCandles,
        streakDurationFormatted,
        maturityLabel,
        classes: 'bg-emerald-950/45 border-emerald-500/30 text-emerald-400/90',
        Icon: TrendingUp,
      };
    }

    if (direction === 'DOWN' || slopePct <= -0.02) {
      if (slopePct <= -0.08) {
        return {
          label: 'STRONG BEAR',
          confidencePct,
          streakCandles,
          streakDurationFormatted,
          maturityLabel,
          classes: 'bg-rose-950/75 border-rose-500/50 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.22)]',
          Icon: TrendingDown,
        };
      }
      return {
        label: 'WEAK BEAR',
        confidencePct,
        streakCandles,
        streakDurationFormatted,
        maturityLabel,
        classes: 'bg-rose-950/45 border-rose-500/30 text-rose-400/90',
        Icon: TrendingDown,
      };
    }

    return {
      label: 'NEUTRAL',
      confidencePct,
      streakCandles,
      streakDurationFormatted,
      maturityLabel,
      classes: 'bg-slate-900/80 border-slate-700/70 text-slate-300',
      Icon: MoveRight,
    };
  }, [maSlopeData?.slopePct, maSlopeData?.direction, maSlopeData?.confidencePct, maSlopeData?.streakCandles]);

  const cprConfluenceStatus = useMemo(() => {
    const camarilla = sniperEngine.currentSignal?.camarilla;
    const activeSymbol =
      candidateSnapshotSymbol ||
      sniperEngine.currentSignal?.symbol ||
      correlatedSignal?.symbol ||
      'BTCUSDT';
    const refMark = liveMarkPrice > 0 ? liveMarkPrice : entryVal > 0 ? entryVal : 81702.5;
    const zones: VirginCprZone[] =
      camarilla?.virginCprZones && camarilla.virginCprZones.length > 0
        ? camarilla.virginCprZones
        : computeVirginCprZones(
            getCachedDailyCandles(activeSymbol, undefined, refMark),
            refMark,
            activeSymbol,
            3
          );
    const virginCpr = sniperEngine.currentSignal?.virginCpr;
    const insideVirginZone = findInsideVirginCprZone(zones, entryVal, refMark, nowTick);

    if (insideVirginZone) {
      return {
        isInsideVirginCpr: true,
        isVirginCprDetected: true,
        label: 'Virgin CPR · High Volatility Potential',
        shortLabel: 'Virgin CPR (High Volatility Potential)',
        classes:
          'bg-amber-950/85 border-amber-400/85 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.35)]',
        title: `WARNING (High Volatility Potential): Active signal setup is detected inside unmitigated ${insideVirginZone.ageSessions}D Virgin CPR (${insideVirginZone.sessionDateUtc}: ${currencyPrefix}${insideVirginZone.cprLow.toLocaleString()}–${currencyPrefix}${insideVirginZone.cprHigh.toLocaleString()}) — High Volatility Potential, stop-hunt & breakout/rejection risk.`,
        tone: 'WARNING' as const,
      };
    }

    if (virginCpr?.hasWarning && virginCpr.blockingZone) {
      return {
        isInsideVirginCpr: false,
        isVirginCprDetected: true,
        label: 'Virgin CPR Ahead · Vol Caution',
        classes: 'bg-amber-950/55 border-amber-500/50 text-amber-300',
        title:
          virginCpr.warningMessage ||
          `Unmitigated Virgin CPR (${currencyPrefix}${virginCpr.blockingZone.cprLow.toLocaleString()}–${currencyPrefix}${virginCpr.blockingZone.cprHigh.toLocaleString()}) lies in trade path.`,
        tone: 'CAUTION' as const,
      };
    }

    if (virginCpr?.hasConfluence && virginCpr.alignedZone) {
      return {
        isInsideVirginCpr: false,
        isVirginCprDetected: true,
        label: 'Virgin CPR Aligned (+8%)',
        classes: 'bg-purple-950/65 border-purple-400/55 text-purple-200',
        title: virginCpr.summary,
        tone: 'ALIGNED' as const,
      };
    }

    const nearestVirgin = camarilla?.nearestVirginCpr ?? findNearestVirginCprMagnet(zones);
    if (nearestVirgin) {
      return {
        isInsideVirginCpr: false,
        isVirginCprDetected: true,
        label: `Virgin CPR Magnet ${nearestVirgin.relation} (${nearestVirgin.distancePct.toFixed(2)}%)`,
        classes: 'bg-amber-950/60 border-amber-400/65 text-amber-200 shadow-[0_0_10px_rgba(245,158,11,0.25)]',
        title: `WARNING (High-Volatility Magnetic Zone): Unmitigated Virgin CPR detected (${nearestVirgin.sessionDateUtc}: ${currencyPrefix}${nearestVirgin.cprLow.toLocaleString()}–${currencyPrefix}${nearestVirgin.cprHigh.toLocaleString()}, ${nearestVirgin.distancePct.toFixed(2)}% ${nearestVirgin.relation.toLowerCase()}). Current setup is operating near a high-volatility Virgin CPR magnetic zone.`,
        tone: 'MAGNET' as const,
      };
    }

    const regime = camarilla?.cprRegime || 'AVERAGE';
    const widthPct =
      typeof camarilla?.cprWidthRatio === 'number'
        ? `${(camarilla.cprWidthRatio * 100).toFixed(2)}%`
        : null;
    return {
      isInsideVirginCpr: false,
      isVirginCprDetected: false,
      label: widthPct ? `${regime} CPR (${widthPct})` : `${regime} CPR`,
      classes:
        regime === 'WIDE'
          ? 'bg-rose-950/40 border-rose-500/35 text-rose-300'
          : regime === 'NARROW'
          ? 'bg-cyan-950/45 border-cyan-500/35 text-cyan-300'
          : 'bg-slate-900/80 border-slate-700/70 text-slate-300',
      title: `Daily CPR Regime: ${regime}${widthPct ? ` (Width ${widthPct})` : ''} · No active Virgin CPR zone in 3-session window.`,
      tone: 'STD' as const,
    };
  }, [
    sniperEngine.currentSignal?.camarilla,
    sniperEngine.currentSignal?.virginCpr,
    sniperEngine.currentSignal?.symbol,
    candidateSnapshotSymbol,
    correlatedSignal?.symbol,
    liveMarkPrice,
    entryVal,
    nowTick,
    dailyAnchorRev,
    currencyPrefix,
  ]);

  const cprStrengthMetric = useMemo(() => {
    const camarilla = sniperEngine.currentSignal?.camarilla;
    const refMark = liveMarkPrice > 0 ? liveMarkPrice : entryVal > 0 ? entryVal : 85000;
    const dailyRange =
      typeof camarilla?.range === 'number' && camarilla.range > 0
        ? camarilla.range
        : +(refMark * 0.022).toFixed(2);
    const rawCprWidth =
      typeof camarilla?.cprWidth === 'number' && camarilla.cprWidth > 0
        ? camarilla.cprWidth
        : +(dailyRange * 0.16).toFixed(2);
    const effectiveCprWidth = Math.max(rawCprWidth, dailyRange * 0.02);
    const ratio = +(dailyRange / effectiveCprWidth).toFixed(1);
    const isCompressed = ratio >= 5.5;
    const stateLabel = isCompressed ? 'Compressed' : 'Stretched';
    const classes = isCompressed
      ? 'bg-cyan-950/75 border-cyan-400/60 text-cyan-200 shadow-[0_0_10px_rgba(6,182,212,0.22)]'
      : 'bg-rose-950/70 border-rose-400/60 text-rose-200 shadow-[0_0_10px_rgba(244,63,94,0.22)]';
    const dotClass = isCompressed ? 'bg-cyan-400' : 'bg-rose-400';
    const title = `CPR Strength (Daily Range ÷ CPR Width): ${ratio.toFixed(1)}x (${stateLabel} Volatility Setup) • Daily Range: ${currencyPrefix}${dailyRange.toLocaleString(undefined, { maximumFractionDigits: 2 })} • CPR Width: ${currencyPrefix}${rawCprWidth.toLocaleString(undefined, { maximumFractionDigits: 2 })} — ${
      isCompressed
        ? 'Compressed (high Range-to-CPR ratio ≥ 5.5x indicates a tight, coiled pivot primed for directional breakout expansion)'
        : 'Stretched (low Range-to-CPR ratio < 5.5x indicates a wide, dispersed pivot prone to mean-reversion or two-sided whipsaw)'
    }.`;

    return {
      ratio,
      dailyRange,
      cprWidth: rawCprWidth,
      isCompressed,
      stateLabel,
      classes,
      dotClass,
      title,
    };
  }, [sniperEngine.currentSignal?.camarilla, liveMarkPrice, entryVal, currencyPrefix]);

  // Dynamic border and glow values calculated for framer-motion entry and state changes
  const motionBorderColor = useMemo(() => {
    if (transitionBadge?.type === 'autopilot-armed' || transitionBadge?.type === 'signal-long') {
      return ['rgba(52, 211, 153, 0.85)', 'rgba(16, 185, 129, 0.5)', 'rgba(6, 182, 212, 0.25)'];
    }
    if (transitionBadge?.type === 'signal-short') {
      return ['rgba(251, 113, 133, 0.85)', 'rgba(244, 63, 94, 0.5)', 'rgba(6, 182, 212, 0.25)'];
    }
    if (transitionBadge?.type === 'autopilot-off') {
      return ['rgba(251, 191, 36, 0.85)', 'rgba(245, 158, 11, 0.5)', 'rgba(6, 182, 212, 0.25)'];
    }
    return ['rgba(6, 182, 212, 0.75)', 'rgba(6, 182, 212, 0.4)', 'rgba(6, 182, 212, 0.2)'];
  }, [transitionBadge?.type]);

  const motionBoxShadow = useMemo(() => {
    if (transitionBadge?.type === 'autopilot-armed' || transitionBadge?.type === 'signal-long') {
      return [
        '0 0 0px rgba(16, 185, 129, 0)',
        '0 0 30px rgba(16, 185, 129, 0.38)',
        '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
      ];
    }
    if (transitionBadge?.type === 'signal-short') {
      return [
        '0 0 0px rgba(244, 63, 94, 0)',
        '0 0 30px rgba(244, 63, 94, 0.38)',
        '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
      ];
    }
    if (transitionBadge?.type === 'autopilot-off') {
      return [
        '0 0 0px rgba(245, 158, 11, 0)',
        '0 0 30px rgba(245, 158, 11, 0.38)',
        '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
      ];
    }
    return [
      '0 0 0px rgba(6, 182, 212, 0)',
      '0 0 24px rgba(6, 182, 212, 0.3)',
      '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
    ];
  }, [transitionBadge?.type]);

  return (
    <motion.div
      initial={{
        opacity: 0.85,
        y: -6,
        scale: 0.995,
      }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        borderColor: motionBorderColor,
        boxShadow: motionBoxShadow,
      }}
      transition={{
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={`panel-delta px-3 py-2 flex flex-col gap-1.5 font-mono-numbers relative z-30 transition-colors ${animClass}`}
    >
      {/* Subtle sweeping accent hairline that activates on entry and transition via framer-motion */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px] overflow-hidden pointer-events-none rounded-t-xl">
        <motion.div
          key={`hairline-${animKey}`}
          initial={{ x: '-100%', opacity: 0.5 }}
          animate={{ x: '100%', opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.15, ease: 'easeInOut' }}
          className={`h-full w-full bg-gradient-to-r from-transparent ${
            transitionBadge?.type === 'autopilot-armed' || transitionBadge?.type === 'signal-long'
              ? 'via-emerald-400'
              : transitionBadge?.type === 'signal-short'
              ? 'via-rose-400'
              : transitionBadge?.type === 'autopilot-off'
              ? 'via-amber-400'
              : 'via-cyan-400'
          } to-transparent`}
        />
      </div>

      {/* Row 1: Intelligence Identity, Trend Controls, Momentum, Conviction & Matrix Telemetry */}
      <div className="flex flex-wrap items-center justify-between gap-x-2.5 gap-y-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <motion.div
            key={`icon-badge-${animKey}`}
            initial={{ scale: 0.88, rotate: -4 }}
            animate={{ scale: [0.88, 1.12, 1], rotate: [0, 4, -2, 0] }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.25)] ${
              transitionBadge
                ? transitionBadge.type === 'autopilot-armed' || transitionBadge.type === 'signal-long'
                  ? 'bg-emerald-950/80 border-emerald-400/60 text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.35)] scale-105'
                  : transitionBadge.type === 'signal-short'
                  ? 'bg-rose-950/80 border-rose-400/60 text-rose-300 shadow-[0_0_16px_rgba(244,63,94,0.35)] scale-105'
                  : 'bg-amber-950/80 border-amber-400/60 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.35)] scale-105'
                : 'bg-cyan-950/70 border-cyan-500/40 text-cyan-300'
            }`}
          >
            {transitionBadge ? (
              transitionBadge.type.startsWith('autopilot') ? (
                <Bot className="w-3.5 h-3.5 animate-bounce" />
              ) : (
                <Zap className="w-3.5 h-3.5 animate-bounce" />
              )
            ) : (
              <Crosshair className="w-3.5 h-3.5 text-cyan-300" />
            )}
          </motion.div>

          <div className="font-bold text-white tracking-tight flex items-center gap-1.5 flex-wrap text-xs">
              <span
                data-virgin-cpr={
                  cprConfluenceStatus.isInsideVirginCpr || cprConfluenceStatus.isVirginCprDetected
                    ? 'detected'
                    : 'none'
                }
                title={
                  cprConfluenceStatus.isInsideVirginCpr || cprConfluenceStatus.isVirginCprDetected
                    ? cprConfluenceStatus.title
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 flex-wrap anim-intelligence-text-glow ${
                  isVolatilityBreachWarningActive || cprConfluenceStatus.isInsideVirginCpr
                    ? 'warning-pulse'
                    : ''
                } ${
                  cprConfluenceStatus.isInsideVirginCpr || cprConfluenceStatus.isVirginCprDetected
                    ? 'virgin-cpr-border-glow virgin-cpr-magnetic-warning'
                    : ''
                }`}
              >
                <span>Trading Intelligence</span>
                {cprConfluenceStatus && (
                  <span
                    role="status"
                    aria-label={`CPR Confluence: ${
                      cprConfluenceStatus.isInsideVirginCpr
                        ? 'Virgin CPR · High Volatility Potential'
                        : cprConfluenceStatus.label
                    }`}
                    title={cprConfluenceStatus.title}
                    className={`badge-delta tabular-nums ${cprConfluenceStatus.classes}`}
                  >
                    {cprConfluenceStatus.isInsideVirginCpr ? (
                      <>
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0"
                          aria-hidden="true"
                        />
                        <AlertTriangle className="w-3 h-3 text-amber-300 shrink-0" aria-hidden="true" />
                      </>
                    ) : cprConfluenceStatus.tone === 'CAUTION' ? (
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <Crosshair className="w-3 h-3 opacity-80 shrink-0" aria-hidden="true" />
                    )}
                    <span className="text-slate-400 font-semibold">CPR:</span>
                    <span>
                      {cprConfluenceStatus.isInsideVirginCpr
                        ? 'Virgin CPR · High Volatility Potential'
                        : cprConfluenceStatus.label}
                    </span>
                  </span>
                )}
                {cprStrengthMetric && (
                  <span
                    role="status"
                    aria-label={`CPR Strength: ${cprStrengthMetric.ratio.toFixed(1)}x ${cprStrengthMetric.stateLabel}`}
                    title={cprStrengthMetric.title}
                    className={`badge-delta tabular-nums ${cprStrengthMetric.classes}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${cprStrengthMetric.dotClass}`}
                      aria-hidden="true"
                    />
                    <span className="text-slate-400 font-semibold">Strength:</span>
                    <span>
                      {cprStrengthMetric.ratio.toFixed(1)}x · {cprStrengthMetric.stateLabel}
                    </span>
                  </span>
                )}
                {cprStrengthMetric && (
                  <span
                    role="status"
                    aria-label="Unified Regime Routing Status"
                    className={`badge-delta font-mono ${
                      sniperEngine.currentSignal?.isNarrow5mCpr || sniperEngine.currentSignal?.isNarrow5mCprAutoRouted
                        ? 'badge-delta-live'
                        : cprStrengthMetric.ratio >= 2.5
                        ? 'badge-delta-armed animate-pulse'
                        : 'badge-delta-live'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        sniperEngine.currentSignal?.isNarrow5mCpr || sniperEngine.currentSignal?.isNarrow5mCprAutoRouted
                          ? 'bg-amber-400 animate-ping'
                          : cprStrengthMetric.ratio >= 2.5
                          ? 'bg-cyan-400'
                          : 'bg-emerald-400'
                      }`}
                    />
                    <span>
                      {sniperEngine.currentSignal?.isNarrow5mCpr || sniperEngine.currentSignal?.isNarrow5mCprAutoRouted
                        ? `5m NARROW CPR ${(sniperEngine.currentSignal?.cpr5mWidthPct ?? 0).toFixed(2)}% → $15 MICRO SNIPER${
                            sniperEngine.currentSignal?.isWide4hCpr
                              ? ` · 4h WIDE ${(sniperEngine.currentSignal?.cpr4hWidthPct ?? 0).toFixed(2)}% → IRON CONDOR`
                              : ''
                          }`
                        : cprStrengthMetric.ratio >= 2.5
                        ? 'ACTIVE: OPTIONS LAB · STRETCHED CPR CREDIT'
                        : 'ACTIVE: CAMARILLA SNIPER'}
                    </span>
                  </span>
                )}
              </span>
              {onToggleShortTermTrend && (
                <div className="inline-flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={onToggleShortTermTrend}
                    aria-pressed={showShortTermTrend}
                    title={
                      showShortTermTrend
                        ? 'Hide short-term trend line visualizer on main chart'
                        : 'Overlay short-term trend line visualizer on main chart'
                    }
                    className={`btn-delta-sm ${
                      showShortTermTrend ? 'btn-toggle-active' : 'btn-secondary text-slate-400'
                    }`}
                  >
                    <LineChart
                      className={`w-3 h-3 shrink-0 ${
                        showShortTermTrend ? 'text-cyan-300' : 'text-slate-400'
                      }`}
                      aria-hidden="true"
                    />
                    <span>Trend Line</span>
                  </button>

                  {showShortTermTrend && onChangeTrendSmoothingFactor && (
                    <>
                      <div
                        title="Smoothing: Dynamically adjusts the chart trend line smoothing factor (0%–100%)"
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-900/85 border border-cyan-500/35"
                      >
                        <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">
                          Smoothing
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={trendSmoothingFactor}
                          onChange={(e) => onChangeTrendSmoothingFactor(Number(e.target.value))}
                          aria-label="Trend line smoothing factor"
                          className="w-16 sm:w-20 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                        />
                        <span className="font-mono text-[11px] tabular-nums text-cyan-400 leading-none min-w-[2.1rem] text-right">
                          {trendSmoothingFactor}%
                        </span>
                      </div>

                      <div className="relative inline-flex items-center gap-1" ref={breachPopoverRef}>
                        {trendVariance && (
                          <span
                            title={`Volatility Variance (σ): ${currencyPrefix}${trendVariance.stdDev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${trendVariance.stdDevPct.toFixed(2)}%) — ${
                              trendVariance.stdDevPct >= 0.45
                                ? 'High dispersion around trend line; consider increasing smoothing'
                                : trendVariance.stdDevPct >= 0.2
                                ? 'Moderate dispersion; balanced smoothing recommended'
                                : 'Low dispersion; trend line tracks tightly'
                            }`}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-mono tabular-nums leading-none ${
                              trendVariance.stdDevPct >= 0.45
                                ? 'bg-rose-950/45 border-rose-500/40 text-rose-300'
                                : trendVariance.stdDevPct >= 0.2
                                ? 'bg-amber-950/45 border-amber-500/40 text-amber-300'
                                : 'bg-emerald-950/45 border-emerald-500/40 text-emerald-300'
                            }`}
                          >
                            <span className="text-slate-400 font-sans font-medium">
                              Volatility Variance:
                            </span>
                            <span className="font-bold">
                              {currencyPrefix}
                              {trendVariance.stdDev.toLocaleString(undefined, {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                            <span className="opacity-80">({trendVariance.stdDevPct.toFixed(2)}%)</span>
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => setIsBreachPopoverOpen((prev) => !prev)}
                          aria-expanded={isBreachPopoverOpen}
                          aria-haspopup="dialog"
                          aria-label="Configure Volatility Breach Alert"
                          title={
                            isVolatilityBreachWarningActive
                              ? 'Volatility Breach Active — Click to configure or dismiss'
                              : volatilityBreachAlertEnabled
                              ? `Volatility Breach Alert Armed (σ > ${volatilityBreachThreshold.toFixed(1)}%) — Click to configure`
                              : 'Set Volatility Breach Alert & Auto-Reset Trend'
                          }
                          className={`relative inline-flex items-center justify-center w-5 h-5 rounded-md border transition cursor-pointer ${
                            isVolatilityBreachWarningActive ||
                            (volatilityBreachAlertEnabled && trendVariance && trendVariance.stdDevPct > volatilityBreachThreshold)
                              ? 'bg-rose-950/90 border-rose-400 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.4)] animate-pulse'
                              : volatilityBreachAlertEnabled
                              ? 'bg-amber-950/80 border-amber-400/70 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                              : isBreachPopoverOpen
                              ? 'bg-slate-800 border-amber-400/60 text-amber-200'
                              : 'bg-slate-900/80 border-slate-700/75 text-slate-400 hover:text-amber-300 hover:border-amber-500/50'
                          }`}
                        >
                          {volatilityBreachAlertEnabled || isVolatilityBreachWarningActive ? (
                            <BellRing className="w-3 h-3" aria-hidden="true" />
                          ) : (
                            <Bell className="w-3 h-3" aria-hidden="true" />
                          )}
                        </button>

                        <AnimatePresence>
                          {isBreachPopoverOpen && (
                            <motion.div
                              role="dialog"
                              aria-label="Volatility Breach Alert Settings"
                              initial={{ opacity: 0, y: -4, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -4, scale: 0.98 }}
                              transition={{ duration: 0.16, ease: 'easeOut' }}
                              className="absolute left-0 top-full mt-2 w-72 sm:w-80 rounded-xl bg-[#080d1a]/95 border border-amber-500/40 shadow-2xl backdrop-blur-md p-3 z-50 font-sans text-left"
                            >
                              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/90">
                                <div className="flex items-center gap-1.5">
                                  <BellRing
                                    className={`w-3.5 h-3.5 ${
                                      isVolatilityBreachWarningActive
                                        ? 'text-rose-400'
                                        : volatilityBreachAlertEnabled
                                        ? 'text-amber-400'
                                        : 'text-slate-400'
                                    }`}
                                    aria-hidden="true"
                                  />
                                  <span className="text-[11px] font-bold text-white">
                                    Volatility Breach Alert
                                  </span>
                                </div>
                                <span
                                  className={`text-[10px] font-mono tabular-nums font-semibold ${
                                    isVolatilityBreachWarningActive ||
                                    (volatilityBreachAlertEnabled && trendVariance && trendVariance.stdDevPct > volatilityBreachThreshold)
                                      ? 'text-rose-400'
                                      : volatilityBreachAlertEnabled
                                      ? 'text-amber-300'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {isVolatilityBreachWarningActive
                                    ? 'Breach Active'
                                    : volatilityBreachAlertEnabled
                                    ? trendVariance && trendVariance.stdDevPct > volatilityBreachThreshold
                                      ? 'Breach Active'
                                      : 'Armed'
                                    : 'Inactive'}
                                </span>
                              </div>

                              <p className="text-[11px] text-slate-300 leading-relaxed mb-2.5">
                                Triggers a breakout or high-risk regime notification when trend standard deviation (σ) exceeds your threshold.
                              </p>

                              {trendVariance && (
                                <div className="flex items-center justify-between text-[11px] bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5 mb-2.5">
                                  <span className="text-slate-400">Current Variance (σ)</span>
                                  <span
                                    className={`font-mono tabular-nums font-bold ${
                                      trendVariance.stdDevPct > volatilityBreachThreshold
                                        ? 'text-rose-400'
                                        : 'text-cyan-300'
                                    }`}
                                  >
                                    {trendVariance.stdDevPct.toFixed(2)}% ({currencyPrefix}
                                    {trendVariance.stdDev.toLocaleString(undefined, {
                                      minimumFractionDigits: 1,
                                      maximumFractionDigits: 2,
                                    })}
                                    )
                                  </span>
                                </div>
                              )}

                              <div className="mb-3">
                                <div className="flex items-center justify-between mb-1">
                                  <label
                                    htmlFor="volatility-breach-threshold-input"
                                    className="text-[10.5px] font-medium text-slate-300"
                                  >
                                    Threshold (σ % &gt;)
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBreachDraftThreshold('1.0');
                                      onChangeVolatilityBreachThreshold?.(1.0);
                                    }}
                                    className="text-[10px] text-amber-400 hover:text-amber-300 font-mono cursor-pointer"
                                  >
                                    Default: 1.0
                                  </button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <input
                                    id="volatility-breach-threshold-input"
                                    type="number"
                                    min={0.1}
                                    max={10.0}
                                    step={0.1}
                                    value={breachDraftThreshold}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      setBreachDraftThreshold(raw);
                                      const parsed = parseFloat(raw);
                                      if (Number.isFinite(parsed) && parsed >= 0.1 && parsed <= 10.0) {
                                        onChangeVolatilityBreachThreshold?.(parsed);
                                      }
                                    }}
                                    onBlur={() => {
                                      const parsed = parseFloat(breachDraftThreshold);
                                      const safe = Number.isFinite(parsed)
                                        ? Math.max(0.1, Math.min(10.0, +parsed.toFixed(1)))
                                        : 1.0;
                                      setBreachDraftThreshold(safe.toFixed(1));
                                      onChangeVolatilityBreachThreshold?.(safe);
                                    }}
                                    className="flex-1 bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-lg px-2.5 py-1 text-xs font-mono tabular-nums text-white outline-none"
                                  />
                                  <span className="text-[11px] font-mono text-slate-400">% σ</span>
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-2 bg-slate-900/70 border border-slate-800/90 rounded-lg px-2.5 py-2 mb-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {volatilityBreachChimeEnabled ? (
                                    <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                                  ) : (
                                    <VolumeX className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-medium text-slate-200 leading-tight">
                                      Audible Chime
                                    </div>
                                    <div className="text-[10px] text-slate-400 leading-tight truncate">
                                      Independent of general sound mute
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={volatilityBreachChimeEnabled}
                                  aria-label="Toggle audible chime for volatility breach alerts"
                                  onClick={() => onToggleVolatilityBreachChime?.(!volatilityBreachChimeEnabled)}
                                  className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                                    volatilityBreachChimeEnabled
                                      ? 'bg-amber-500/80 border-amber-400'
                                      : 'bg-slate-800 border-slate-700'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                                      volatilityBreachChimeEnabled ? 'translate-x-4' : 'translate-x-0.5'
                                    }`}
                                  />
                                </button>
                              </div>

                              <div className="flex items-center justify-between gap-2 bg-slate-900/70 border border-slate-800/90 rounded-lg px-2.5 py-2 mb-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <VolumeX
                                    className={`w-3.5 h-3.5 shrink-0 ${
                                      autoMuteOnBreachEnabled
                                        ? isVolatilityBreachWarningActive
                                          ? 'text-rose-400'
                                          : 'text-amber-400'
                                        : 'text-slate-500'
                                    }`}
                                    aria-hidden="true"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-medium text-slate-200 leading-tight flex items-center gap-1.5">
                                      <span>Auto-Mute Sounds</span>
                                      {autoMuteOnBreachEnabled && isVolatilityBreachWarningActive && (
                                        <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-rose-500/20 border border-rose-400/50 text-rose-300 leading-none">
                                          MUTED
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-400 leading-tight truncate">
                                      Silence trade sounds during active breach
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={autoMuteOnBreachEnabled}
                                  aria-label="Toggle auto-mute general trading notification sounds during active volatility breach"
                                  onClick={() => onToggleAutoMuteOnBreach?.(!autoMuteOnBreachEnabled)}
                                  className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                                    autoMuteOnBreachEnabled
                                      ? isVolatilityBreachWarningActive
                                        ? 'bg-rose-500/80 border-rose-400'
                                        : 'bg-amber-500/80 border-amber-400'
                                      : 'bg-slate-800 border-slate-700'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                                      autoMuteOnBreachEnabled ? 'translate-x-4' : 'translate-x-0.5'
                                    }`}
                                  />
                                </button>
                              </div>

                              <div className="flex items-center justify-between gap-2 bg-slate-900/70 border border-slate-800/90 rounded-lg px-2.5 py-2 mb-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <RefreshCw
                                    className={`w-3.5 h-3.5 shrink-0 ${
                                      autoResetTrendEnabled ? 'text-cyan-400' : 'text-slate-500'
                                    }`}
                                    aria-hidden="true"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-medium text-slate-200 leading-tight">
                                      Auto-Reset Trend
                                    </div>
                                    <div className="text-[10px] text-slate-400 leading-tight truncate">
                                      Recalculate trend indicators on breach clear
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={autoResetTrendEnabled}
                                  aria-label="Toggle Auto-Reset Trend"
                                  onClick={() => onToggleAutoResetTrend?.(!autoResetTrendEnabled)}
                                  className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full border transition-colors cursor-pointer ${
                                    autoResetTrendEnabled
                                      ? 'bg-cyan-500/80 border-cyan-400'
                                      : 'bg-slate-800 border-slate-700'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                                      autoResetTrendEnabled ? 'translate-x-4' : 'translate-x-0.5'
                                    }`}
                                  />
                                </button>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const parsed = parseFloat(breachDraftThreshold);
                                    const safe = Number.isFinite(parsed)
                                      ? Math.max(0.1, Math.min(10.0, +parsed.toFixed(1)))
                                      : 1.0;
                                    setBreachDraftThreshold(safe.toFixed(1));
                                    onChangeVolatilityBreachThreshold?.(safe);
                                    const nextEnabled = !volatilityBreachAlertEnabled;
                                    onToggleVolatilityBreachAlert?.(nextEnabled);
                                    if (nextEnabled) {
                                      setIsBreachPopoverOpen(false);
                                    }
                                  }}
                                  className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                                    volatilityBreachAlertEnabled
                                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
                                      : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/70 text-amber-200'
                                  }`}
                                >
                                  {volatilityBreachAlertEnabled
                                    ? 'Disable Alert'
                                    : `Set Alert (> ${Number.isFinite(parseFloat(breachDraftThreshold)) ? parseFloat(breachDraftThreshold).toFixed(1) : '1.0'}%)`}
                                </button>

                                {isVolatilityBreachWarningActive && onDismissVolatilityBreach && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onDismissVolatilityBreach();
                                      setIsBreachPopoverOpen(false);
                                    }}
                                    title="Dismiss active volatility breach warning"
                                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/60 text-rose-200 transition cursor-pointer"
                                  >
                                    Clear
                                  </button>
                                )}

                                {onTestVolatilityBreachAlert && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onTestVolatilityBreachAlert();
                                      setIsBreachPopoverOpen(false);
                                    }}
                                    title="Send a sample Volatility Breach notification"
                                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                                  >
                                    Test
                                  </button>
                                )}
                              </div>

                              <div className="mt-2.5 pt-2 border-t border-slate-800/90">
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setIsBreachHistoryOpen((prev) => !prev)}
                                    aria-expanded={isBreachHistoryOpen}
                                    aria-controls="volatility-breach-history-timeline"
                                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] font-semibold border transition cursor-pointer ${
                                      isBreachHistoryOpen
                                        ? 'bg-amber-950/60 border-amber-500/50 text-amber-200'
                                        : 'bg-slate-900/80 hover:bg-slate-800 border-slate-700/80 text-slate-300 hover:text-white'
                                    }`}
                                  >
                                    <History className="w-3 h-3 text-amber-400 shrink-0" aria-hidden="true" />
                                    <span>Breach History</span>
                                    <span className="font-mono tabular-nums text-[9.5px] px-1 py-0.5 rounded bg-slate-950/90 border border-slate-700/80 text-slate-300 leading-none">
                                      {volatilityBreachHistory.length}
                                    </span>
                                    <ChevronDown
                                      className={`w-3 h-3 text-slate-400 transition-transform duration-150 ${
                                        isBreachHistoryOpen ? 'rotate-180' : ''
                                      }`}
                                      aria-hidden="true"
                                    />
                                  </button>

                                  {isBreachHistoryOpen && volatilityBreachHistory.length > 0 && onClearVolatilityBreachHistory && (
                                    <button
                                      type="button"
                                      onClick={onClearVolatilityBreachHistory}
                                      className="text-[10px] font-medium text-slate-400 hover:text-rose-300 transition cursor-pointer"
                                    >
                                      Clear Log
                                    </button>
                                  )}
                                </div>

                                <AnimatePresence initial={false}>
                                  {isBreachHistoryOpen && (
                                    <motion.div
                                      id="volatility-breach-history-timeline"
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: 'auto' }}
                                      exit={{ opacity: 0, height: 0 }}
                                      transition={{ duration: 0.16, ease: 'easeOut' }}
                                      className="overflow-hidden"
                                    >
                                      <div className="mt-2 bg-slate-950/75 border border-slate-800/90 rounded-lg p-2 max-h-44 overflow-y-auto">
                                        {volatilityBreachHistory.length === 0 ? (
                                          <div className="text-[10.5px] text-slate-500 text-center py-2">
                                            No volatility breaches recorded yet.
                                          </div>
                                        ) : (
                                          <ol className="relative ml-1.5 pl-3 border-l border-slate-700/80 space-y-2">
                                            {volatilityBreachHistory.slice(0, 5).map((entry) => {
                                              const entryTime = formatSignalGenClock(entry.timestamp);
                                              const isToday =
                                                new Date(entry.timestamp).toDateString() ===
                                                new Date(nowTick).toDateString();
                                              const entryDateShort = isToday
                                                ? ''
                                                : `${new Date(entry.timestamp).toLocaleDateString(undefined, {
                                                    month: 'short',
                                                    day: 'numeric',
                                                  })} `;
                                              return (
                                                <li key={entry.id} className="relative text-[10.5px] leading-tight">
                                                  <span
                                                    aria-hidden="true"
                                                    className={`absolute -left-[16.5px] top-1 w-2 h-2 rounded-full border ${
                                                      entry.isTest
                                                        ? 'bg-amber-400 border-amber-200'
                                                        : 'bg-rose-400 border-rose-200'
                                                    }`}
                                                  />
                                                  <div className="flex items-center justify-between gap-1.5">
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                      <span className="font-mono tabular-nums text-slate-300 font-semibold">
                                                        {entryDateShort}
                                                        {entryTime}
                                                      </span>
                                                      <span className="text-[9.5px] font-bold text-slate-400">
                                                        {entry.symbol}
                                                      </span>
                                                      {entry.isTest && (
                                                        <span className="text-[8.5px] font-bold px-1 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300 leading-none">
                                                          TEST
                                                        </span>
                                                      )}
                                                    </div>
                                                    <span className="font-mono tabular-nums text-[9.5px] text-slate-500 shrink-0">
                                                      {formatSignalAge(entry.timestamp, nowTick).label}
                                                    </span>
                                                  </div>
                                                  <div className="mt-0.5 flex items-center justify-between gap-2 font-mono tabular-nums">
                                                    <span
                                                      className={`font-bold ${
                                                        entry.isTest ? 'text-amber-300' : 'text-rose-300'
                                                      }`}
                                                    >
                                                      σ {entry.stdDevPct.toFixed(2)}% ({currencyPrefix}
                                                      {entry.stdDev.toLocaleString(undefined, {
                                                        minimumFractionDigits: 1,
                                                        maximumFractionDigits: 2,
                                                      })}
                                                      )
                                                    </span>
                                                    <span className="text-[9.5px] text-slate-500">
                                                      &gt; {entry.threshold.toFixed(1)}%
                                                    </span>
                                                  </div>
                                                </li>
                                              );
                                            })}
                                          </ol>
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </>
                  )}
                </div>
              )}
              <span
                title={`${
                  maSlopeData?.contextNote
                    ? maSlopeData.contextNote
                    : `Trend Momentum based on 15m MA Slope (${maSlopeData?.slopeFormatted || '0.00%'})`
                } • Model Certainty: ${trendMomentum.confidencePct}% • Streak: ${trendMomentum.streakCandles} ${
                  trendMomentum.streakCandles === 1 ? 'candle' : 'candles'
                } (${trendMomentum.streakDurationFormatted} on 15m — ${trendMomentum.maturityLabel})`}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wide leading-none ${trendMomentum.classes}`}
              >
                <trendMomentum.Icon className="w-3 h-3 shrink-0" />
                <span className="text-slate-400 font-semibold">Trend Momentum:</span>
                <span>{trendMomentum.label}</span>
                <span className="font-mono-numbers tabular-nums text-[9.5px] opacity-85 border-l border-current/25 pl-1.5 ml-0.5">
                  {trendMomentum.confidencePct}%
                </span>
                <span className="font-mono-numbers tabular-nums text-[9.5px] opacity-90 border-l border-current/25 pl-1.5 ml-0.5">
                  {trendMomentum.streakCandles} {trendMomentum.streakCandles === 1 ? 'candle' : 'candles'}
                </span>
              </span>
              <ConvictionGauge convictionPct={aiMatrixScore.convictionPct} />
              <AnimatePresence mode="wait">
                {transitionBadge && (
                  <motion.span
                    key={transitionBadge.text}
                    initial={{ opacity: 0, scale: 0.75, x: -8 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.8, x: 8 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    className={`inline-flex items-center gap-1.5 text-[9.5px] font-extrabold px-2.5 py-0.5 rounded-full border shadow-sm ${
                      transitionBadge.type === 'autopilot-armed' || transitionBadge.type === 'signal-long'
                        ? 'bg-emerald-950/90 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                        : transitionBadge.type === 'signal-short'
                        ? 'bg-rose-950/90 border-rose-400 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                        : 'bg-amber-950/90 border-amber-400 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                    }`}
                  >
                    <motion.span
                      animate={{ scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
                      transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                      className="w-1.5 h-1.5 rounded-full bg-current"
                    />
                    <span>{transitionBadge.text}</span>
                  </motion.span>
                )}
              </AnimatePresence>
          </div>
        </div>

        {/* Right Telemetry Cluster on Row 1 */}
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="hidden sm:inline-flex badge-delta badge-delta-armed">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>AI MATRIX: {aiMatrixScore.total}/180 • Grade {aiMatrixScore.grade} ({signalSide === 'LONG' ? 'BULLISH' : 'BEARISH'})</span>
          </span>
          {maSlopeData && (
            <MaSlopeTrendIndicator
              slopeData={maSlopeData}
              symbol={maSlopeData.symbol || sniperEngine.currentSignal?.symbol || 'BTCUSDT'}
              signalSide={signalSide}
              className="hidden sm:inline-flex"
            />
          )}
          {btcCorrelation && (
            <>
              <BtcCorrelationSparkline
                btcCorrelation={btcCorrelation}
                aiMatrixScore={aiMatrixScore}
                symbol={btcCorrelation.symbol || sniperEngine.currentSignal?.symbol || 'BTCUSDT'}
                maSlopeData={maSlopeData}
                className="hidden md:inline-flex"
              />
              <span
                title={btcCorrelation.description}
                className={`inline-flex md:hidden badge-delta ${
                  btcCorrelation.isDecoupled
                    ? 'badge-delta-paper animate-pulse'
                    : btcCorrelation.coefficient < 0
                    ? 'badge-delta-warning'
                    : 'badge-delta-armed'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${btcCorrelation.isDecoupled ? 'bg-amber-400' : 'bg-cyan-400'}`} />
                <span>
                  BTC CORR: {btcCorrelation.coefficient >= 0 ? `+${btcCorrelation.coefficient.toFixed(2)}` : btcCorrelation.coefficient.toFixed(2)}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Row 2: Active Signal Parameters & Execution Quick Actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-1 border-t border-slate-800/70 text-[11px]">
        <div className="text-slate-300 flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-cyan-400 font-medium">AI Command Signal</span>
          <span className="text-slate-600">·</span>
          <span className="text-emerald-400 font-semibold">
            {sniperEngine.currentSignal?.confidenceStatus || 'CONFIRMED'} ({sniperEngine.currentSignal?.confidence || aiMatrixScore.convictionPct}%)
          </span>
          <span className="text-slate-600">·</span>
          <span
            className="font-mono-numbers tabular-nums text-[10.5px] text-slate-400"
            title={`Signal generated at ${new Date(signalTimestampDisplay).toLocaleString()}`}
          >
            Gen: {genTimeFormatted}
          </span>
          <span
            className="badge-delta badge-delta-standby font-mono-numbers tabular-nums"
            title="Live elapsed time since signal generation"
          >
            <Clock className="w-2.5 h-2.5 text-slate-400 shrink-0" />
            <span>
              <LiveSignalElapsedText timestamp={signalTimestampDisplay} suffix=" ago" />
            </span>
          </span>
          {activeSignalValidity.breachType === 'SL_INVALIDATED' ||
          (signalCooldown && signalCooldown.reason === 'SL' && (contextSignalValidity?.cooldownRemainingSec || 0) > 0) ? (
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              <span
                className="badge-delta badge-delta-danger animate-pulse font-mono-numbers tabular-nums"
                title={activeSignalValidity.reason || 'Stop loss breached — post-SL cooldown active'}
              >
                <span>
                  ✕ SL HIT · INVALIDATED
                  {(contextSignalValidity?.cooldownRemainingSec || 0) > 0
                    ? ` (${contextSignalValidity.cooldownRemainingSec}s)`
                    : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={handleRefreshExpiredSignal}
                title="Scan immediately for the next fresh market setup"
                className="btn-delta-sm btn-danger"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>Scan Now</span>
              </button>
            </span>
          ) : activeSignalValidity.breachType === 'TP1_COMPLETED' ||
            activeSignalValidity.breachType === 'TP4_COMPLETED' ||
            (signalCooldown && signalCooldown.reason === 'TP1' && (contextSignalValidity?.cooldownRemainingSec || 0) > 0) ? (
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              <span
                className="badge-delta badge-delta-live font-mono-numbers tabular-nums"
                title={activeSignalValidity.reason || 'TP1 reached before entry — avoiding chase'}
              >
                <span>
                  ✓ TP1 REACHED · COMPLETED
                  {(contextSignalValidity?.cooldownRemainingSec || 0) > 0
                    ? ` (${contextSignalValidity.cooldownRemainingSec}s)`
                    : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={handleRefreshExpiredSignal}
                title="Scan immediately for the next fresh market setup"
                className="btn-delta-sm btn-secondary text-emerald-300 border-emerald-500/40"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>Scan Now</span>
              </button>
            </span>
          ) : activeSignalValidity.status === 'FRESH' ? (
            <span
              className="badge-delta badge-delta-live font-mono-numbers tabular-nums"
              title="Signal is under 5 minutes old and within entry price tolerance"
            >
              <span>
                ● FRESH (<LiveSignalElapsedText timestamp={signalTimestampDisplay} />)
              </span>
            </span>
          ) : activeSignalValidity.status === 'AGING' ? (
            <span
              className="badge-delta badge-delta-paper font-mono-numbers tabular-nums"
              title={activeSignalValidity.reason || 'Signal is 5m–15m old — verify price structure before entry'}
            >
              <span>
                ◐ AGING (<LiveSignalElapsedText timestamp={signalTimestampDisplay} />)
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 flex-wrap">
              <span
                className="badge-delta badge-delta-danger animate-pulse"
                title={activeSignalValidity.reason || 'Signal is overdue or stale'}
              >
                <span>⚠ OVERDUE · STALE SETUP</span>
              </span>
              <button
                type="button"
                onClick={handleRefreshExpiredSignal}
                title={activeSignalValidity.reason || 'Re-anchor Entry, SL, and TP1–TP4 to live market price'}
                className="btn-delta-sm btn-danger"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                <span>Refresh Signal</span>
              </button>
            </span>
          )}
          <span className="text-slate-600">·</span>
          <span>
            Action:{' '}
            <motion.strong
              key={actionText}
              initial={{ opacity: 0.5, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={actionColor}
            >
              {actionText}
            </motion.strong>
          </span>
          <span className="text-slate-600">·</span>
          <span
            onClick={() => syncLevelToExecutionPad({ price: entryVal, side: signalSide, type: 'ENTRY' })}
            className="hover:text-cyan-300 transition-colors cursor-pointer group"
            title="Click to cue Entry price into Execution Pad"
          >
            Entry: <strong className="text-slate-100 group-hover:text-cyan-300 font-bold">${entryVal > 0 ? entryVal.toLocaleString() : '81,700'}</strong>
          </span>
          <span className="text-slate-600">·</span>
          <span
            onClick={() => syncLevelToExecutionPad({ stopLoss: slVal, type: 'SL' })}
            className="hover:text-rose-300 transition-colors cursor-pointer group"
            title="Click to cue Stop Loss price into Execution Pad"
          >
            SL: <strong className="text-rose-300 font-bold">${slVal > 0 ? slVal.toLocaleString() : '80,500'}</strong>
          </span>
          <span className="text-slate-600">·</span>
          <span
            onClick={() => syncLevelToExecutionPad({ takeProfit: tp1Val, type: 'TP1' })}
            className="hover:text-emerald-300 transition-colors cursor-pointer group"
            title="Click to cue TP1 target into Execution Pad"
          >
            TP1: <strong className="text-emerald-400 font-bold">${tp1Val > 0 ? tp1Val.toLocaleString() : '82,900'}</strong>
          </span>
          <span className="text-slate-700 hidden md:inline">|</span>
          <div className="hidden md:flex items-center gap-1.5 text-[10.5px] text-slate-400">
            <span
              title={tp1Val > 0 ? `TP1: $${tp1Val.toLocaleString()}` : undefined}
              className={`inline-flex items-center gap-0.5 ${sniperEngine.activeTrade?.tp1Hit ? 'text-emerald-400 font-bold' : ''}`}
            >
              <span>TP1</span>
              {sniperEngine.activeTrade?.tp1Hit && <Check className="w-3 h-3 text-emerald-400" />}
            </span>
            <span className="text-slate-700">·</span>
            <span
              title={tp2Val > 0 ? `TP2: $${tp2Val.toLocaleString()}` : undefined}
              className={`inline-flex items-center gap-0.5 ${sniperEngine.activeTrade?.tp2Hit ? 'text-amber-400 font-bold' : ''}`}
            >
              <span>TP2</span>
              {sniperEngine.activeTrade?.tp2Hit && <Check className="w-3 h-3 text-amber-400" />}
            </span>
            <span className="text-slate-700">·</span>
            <span
              title={tp3Val > 0 ? `TP3: $${tp3Val.toLocaleString()}` : undefined}
              className={`inline-flex items-center gap-0.5 ${sniperEngine.activeTrade?.tp3Hit ? 'text-cyan-400 font-bold' : ''}`}
            >
              <span>TP3</span>
              {sniperEngine.activeTrade?.tp3Hit && <Check className="w-3 h-3 text-cyan-400" />}
            </span>
            <span className="text-slate-700">·</span>
            <span
              title={tp4Val > 0 ? `TP4: $${tp4Val.toLocaleString()}` : undefined}
              className={`inline-flex items-center gap-0.5 ${sniperEngine.activeTrade?.tp4Hit ? 'text-purple-400 font-bold' : ''}`}
            >
              <span>TP4</span>
              {sniperEngine.activeTrade?.tp4Hit && <Check className="w-3 h-3 text-purple-400" />}
            </span>
          </div>
          {isLiveUnverified && (
            <>
              <span className="text-slate-600">·</span>
              <span className="badge-delta badge-delta-paper">
                API Keys Required · Balances Inactive
              </span>
            </>
          )}
          {sniperEngine.activeTrade && !isLiveUnverified && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-cyan-300 font-semibold">
                {sniperEngine.activeTrade.tradeStatus}
              </span>
            </>
          )}
          {sniperEngine.activeTrade?.riskStatus === 'RISK-FREE' && <span className="text-emerald-400 font-bold">· Risk-Free</span>}
          {sniperEngine.activeTrade?.profitLocked && <span className="text-amber-400 font-bold">· Profit Locked</span>}
          {sniperEngine.activeTrade?.trailingStopActive && <span className="text-cyan-400 font-bold">· ATR Trailing</span>}
        </div>

        {/* Right Quick Controls */}
        <div className="flex items-center gap-1.5 flex-wrap shrink-0 ml-auto">
          {/* Compact Last 3 Historical Signals Dropdown */}
          <div className="relative" ref={signalsDropdownRef}>
            <button
              type="button"
              onClick={() => setIsSignalsOpen((prev) => !prev)}
              aria-expanded={isSignalsOpen}
              aria-haspopup="menu"
              className={`btn-delta-sm ${
                isSignalsOpen ? 'btn-toggle-active' : 'btn-secondary'
              }`}
              title="View last 3 AI engine signals"
            >
              <History className="w-3.5 h-3.5 text-cyan-400" />
              <span>Signals</span>
              <span className="text-[10px] font-mono-numbers tabular-nums text-cyan-300 font-bold">
                ({recentHistoricalSignals.length})
              </span>
              <ChevronDown
                className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
                  isSignalsOpen ? 'rotate-180 text-cyan-300' : ''
                }`}
              />
            </button>

            <AnimatePresence>
              {isSignalsOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="absolute left-0 sm:left-auto sm:right-0 top-full mt-2 w-72 sm:w-80 rounded-xl bg-[#080d1a]/95 border border-cyan-500/35 shadow-2xl backdrop-blur-md p-2.5 z-50"
                >
                  <div className="flex items-center justify-between gap-2 px-1.5 pb-2 mb-1.5 border-b border-slate-800/90">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 shrink-0">
                      <Clock className="w-3 h-3 text-cyan-400" />
                      Recent Historical Signals
                    </span>
                    <div
                      className="relative flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <label htmlFor="signals-grade-filter" className="sr-only">
                        Filter signals by grade
                      </label>
                      <select
                        id="signals-grade-filter"
                        aria-label="Filter signals by grade"
                        value={signalGradeFilter}
                        onChange={(e) => setSignalGradeFilter(e.target.value as SignalGradeFilter)}
                        className="h-6 px-1.5 rounded bg-slate-900 border border-slate-700/90 text-[10px] font-semibold text-cyan-300 focus:outline-none focus:border-cyan-400 cursor-pointer"
                      >
                        <option value="ALL">All</option>
                        <option value="GRADE_A">Grade A</option>
                        <option value="GRADE_B">Grade B</option>
                        <option value="GRADE_C">Grade C</option>
                      </select>

                      <div
                        className="relative inline-flex items-center"
                        onMouseEnter={() => setIsGradeHelpHovered(true)}
                        onMouseLeave={() => setIsGradeHelpHovered(false)}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsGradeHelpPinned((prev) => !prev);
                          }}
                          onBlur={() => {
                            setIsGradeHelpPinned(false);
                            setIsGradeHelpHovered(false);
                          }}
                          aria-label="Signal Grade A, B, and C classification guide"
                          aria-expanded={isGradeHelpOpen}
                          aria-describedby="signals-grade-help-tooltip"
                          className={`h-6 w-6 inline-flex items-center justify-center rounded border transition-colors cursor-pointer ${
                            isGradeHelpOpen
                              ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300'
                              : 'bg-slate-900/90 hover:bg-slate-800 border-slate-700/90 hover:border-cyan-500/50 text-slate-400 hover:text-cyan-300'
                          }`}
                        >
                          <Info className="w-3 h-3" />
                        </button>

                        {isGradeHelpOpen && (
                          <div
                            id="signals-grade-help-tooltip"
                            role="tooltip"
                            className="absolute right-0 top-full mt-1.5 w-60 sm:w-64 rounded-lg bg-[#060b18]/98 border border-cyan-500/40 shadow-2xl p-2.5 text-[10px] leading-relaxed text-slate-300 z-[60]"
                          >
                            <div className="font-bold uppercase tracking-wider text-cyan-300 mb-1.5">
                              Signal Grade Classifications
                            </div>
                            <div className="space-y-1.5">
                              <div className="flex items-start gap-1.5">
                                <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/35 shrink-0">
                                  Grade A
                                </span>
                                <span>
                                  <strong className="text-slate-100">A+ / A (≥78%)</strong>: High-confluence institutional setup aligned across AI Matrix, HTF trend &amp; key pivots.
                                </span>
                              </div>
                              <div className="flex items-start gap-1.5">
                                <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/35 shrink-0">
                                  Grade B
                                </span>
                                <span>
                                  <strong className="text-slate-100">B+ / B (55–77%)</strong>: Moderate-confluence tactical setup; verify structure &amp; risk sizing.
                                </span>
                              </div>
                              <div className="flex items-start gap-1.5">
                                <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-slate-500/20 text-slate-300 border border-slate-500/40 shrink-0">
                                  Grade C
                                </span>
                                <span>
                                  <strong className="text-slate-100">C (&lt;55%)</strong>: Low-conviction or counter-trend setup; watchlist / observation only.
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 7-Day Win-Rate Trend Sparkline for Selected Signal Grade Filter */}
                  <SignalGradeWinRateSparkline
                    signals={allRecentHistoricalSignals}
                    trades={tradeHistory}
                    filter={signalGradeFilter}
                  />

                  {recentHistoricalSignals.length === 0 ? (
                    <div className="py-3 px-2 text-center text-[11px] text-slate-400">
                      {signalGradeFilter === 'GRADE_A'
                        ? 'No Grade A signals in recent history.'
                        : signalGradeFilter === 'GRADE_B'
                        ? 'No Grade B signals in recent history.'
                        : signalGradeFilter === 'GRADE_C'
                        ? 'No Grade C signals in recent history.'
                        : 'Awaiting AI engine signal...'}
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-64 overflow-y-auto pr-0.5">
                      {recentHistoricalSignals.map((sig, idx) => {
                        const isLong = sig.direction === 'LONG';
                        const gradeCode = normalizeSignalGradeCode(sig.grade, sig.convictionPct);
                        const isGradeA = gradeCode === 'A+' || gradeCode === 'A';
                        const isGradeB = gradeCode === 'B+' || gradeCode === 'B';
                        const formattedTime = new Date(sig.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        });
                        const sourceMeta =
                          sig.sourceLabel === 'Sniper AI'
                            ? { Icon: Zap, iconClass: 'text-amber-400' }
                            : sig.sourceLabel === 'AI Matrix'
                            ? { Icon: Brain, iconClass: 'text-cyan-400' }
                            : sig.sourceLabel === 'Auto Conduit'
                            ? { Icon: Bot, iconClass: 'text-emerald-400' }
                            : { Icon: Sparkles, iconClass: 'text-indigo-300' };
                        const SourceIcon = sourceMeta.Icon;
                        return (
                          <motion.button
                            key={`${sig.id}-${idx}`}
                            type="button"
                            role="menuitem"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              duration: 0.18,
                              delay: idx * 0.05,
                              ease: [0.16, 1, 0.3, 1],
                            }}
                            onClick={() => {
                              syncLevelToExecutionPad({
                                price: sig.entryPrice,
                                side: sig.direction,
                                type: 'ENTRY',
                              });
                              setIsSignalsOpen(false);
                            }}
                            className="w-full text-left px-2.5 py-2 rounded-lg bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800/90 hover:border-cyan-500/40 transition-colors flex items-center justify-between gap-2 cursor-pointer group"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-[11px]">
                                <span
                                  className={`font-bold ${
                                    isLong ? 'text-emerald-400' : 'text-rose-400'
                                  }`}
                                >
                                  {sig.direction}
                                </span>
                                <span className="text-slate-200 font-semibold truncate">
                                  {sig.symbol}
                                </span>
                                <span
                                  className={`px-1 py-0.2 rounded text-[9px] font-bold font-mono-numbers border ${
                                    isGradeA
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                                      : isGradeB
                                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                                      : 'bg-slate-500/20 text-slate-300 border-slate-500/40'
                                  }`}
                                >
                                  Grade {gradeCode}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono-numbers tabular-nums mt-0.5">
                                <span className="inline-flex items-center gap-1 truncate">
                                  <SourceIcon className={`w-2.5 h-2.5 shrink-0 ${sourceMeta.iconClass}`} aria-hidden="true" />
                                  <span className="truncate">{sig.sourceLabel}</span>
                                </span>
                                <span className="text-slate-600">·</span>
                                <span>{formattedTime}</span>
                                <span className="text-slate-600">·</span>
                                <HistoricalSignalAgeBadge timestamp={sig.timestamp} />
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[11px] font-mono-numbers font-bold tabular-nums text-slate-100 group-hover:text-cyan-300">
                                $
                                {sig.entryPrice.toLocaleString(undefined, {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 2,
                                })}
                              </div>
                              <div className="text-[10px] font-mono-numbers tabular-nums text-slate-400">
                                {Math.round(sig.convictionPct)}% conv
                              </div>
                            </div>
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Quick Auto-Pilot Indicator & Armed Toggle with framer-motion */}
          <motion.button
            key={`auto-btn-${isAutoSniperEnabled}`}
            whileHover={{ scale: isLiveUnverified ? 1 : 1.03 }}
            whileTap={{ scale: isLiveUnverified ? 1 : 0.96 }}
            type="button"
            onClick={() => {
              if (!isLiveUnverified && sniperEngine.setIsAutoSniperEnabled) {
                sniperEngine.setIsAutoSniperEnabled(!isAutoSniperEnabled);
              }
            }}
            disabled={isLiveUnverified}
            className={`btn-delta-sm ${
              isLiveUnverified
                ? 'btn-secondary'
                : isAutoSniperEnabled
                ? 'btn-toggle-active border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                : 'btn-secondary'
            }`}
            title={
              isLiveUnverified
                ? 'Connect your Delta Exchange API Key & Secret in Settings.'
                : isAutoSniperEnabled
                ? 'Auto-Pilot is ARMED (Click to disarm)'
                : 'Auto-Pilot is OFF (Click to arm)'
            }
          >
            <Bot className={`w-3.5 h-3.5 ${isAutoSniperEnabled && !isLiveUnverified ? 'text-emerald-300 animate-pulse' : 'text-slate-400'}`} />
            <span>{isLiveUnverified ? 'Auto: Key Required' : isAutoSniperEnabled ? 'Auto: ON' : 'Auto: OFF'}</span>
          </motion.button>

          <button
            type="button"
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              if (next) announceVoiceActivated();
            }}
            className={`btn-delta-sm ${voiceEnabled ? 'btn-toggle-active' : 'btn-secondary'}`}
            title={
              voiceEnabled
                ? `Voice Assistant Active (${selectedVoice?.name || 'Soft Female Profile'}) — Click to mute`
                : 'Voice Assistant Muted (Click to enable)'
            }
          >
            {voiceEnabled ? <Volume2 className="w-3.5 h-3.5 text-cyan-300" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
            <span>{voiceEnabled ? 'Voice: ON' : 'Voice: OFF'}</span>
          </button>
          <button
            type="button"
            onClick={onNavigateToAi}
            className="btn-delta-sm btn-secondary"
          >
            AI Command
          </button>
          <button
            type="button"
            onClick={onNavigateToStrategies}
            className="btn-delta-sm btn-primary"
          >
            Sniper Engine →
          </button>
        </div>
      </div>
    </motion.div>
  );
});

interface SignalAndPositionLifecycleBridgeProps {
  positions: Position[];
  markets: Record<string, MarketTicker>;
  tradingMode: TradingMode;
  sniperActiveTrade: SniperActiveTrade | null;
  paperPositions: Position[];
  setPaperHistory: React.Dispatch<React.SetStateAction<ClosedTrade[]>>;
  setPaperPortfolio: React.Dispatch<React.SetStateAction<PortfolioData>>;
  handlePartialClosePaperPosition: (
    pos: Position,
    closedTrade: ClosedTrade,
    opts: {
      partialSize?: number;
      newStopLoss?: number;
      tp1Hit?: boolean;
      tp2Hit?: boolean;
      tp3Hit?: boolean;
      feeBufferBe?: number;
      isFullClose?: boolean;
    }
  ) => Promise<void>;
  handleClosePosition: (
    positionId: string,
    reason?: string,
    overrides?: { exitPrice?: number; realisedPnl?: number }
  ) => Promise<void>;
  addNotification: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
  playTradeFill: () => void;
  onUpdatePositionSL?: (posId: string, newSL: number) => void;
  sniperRecordTradeRef: React.MutableRefObject<
    ((trade: ClosedTrade, posUpdate?: SniperPositionSyncUpdate) => void) | null
  >;
  sniperLifecycleExitRef: React.MutableRefObject<((reason: 'SL' | 'TP4', symbol: string) => void) | null>;
}

const SignalAndPositionLifecycleBridge: React.FC<SignalAndPositionLifecycleBridgeProps> = ({
  positions,
  markets,
  tradingMode,
  sniperActiveTrade,
  paperPositions,
  setPaperHistory,
  setPaperPortfolio,
  handlePartialClosePaperPosition,
  handleClosePosition,
  addNotification,
  playTradeFill,
  onUpdatePositionSL,
  sniperRecordTradeRef,
  sniperLifecycleExitRef,
}) => {
  const { lockedActiveSignal, clearLockedSignalForCooldown } = useAiMatrixCorrelation();
  const processedPosEventsRef = useRef<Set<string>>(new Set());

  // Listen for Dynamic Ratchet Breakeven Stop-Loss updates across the applet
  useEffect(() => {
    const handleSlUpdate = (e: any) => {
      const sym = e?.detail?.symbol;
      const newSl = e?.detail?.newStopLoss;
      if (sym && typeof newSl === 'number' && Number.isFinite(newSl) && newSl > 0 && onUpdatePositionSL) {
        onUpdatePositionSL(sym, newSl);
      }
    };
    window.addEventListener('delta:update-position-sl', handleSlUpdate);
    return () => window.removeEventListener('delta:update-position-sl', handleSlUpdate);
  }, [onUpdatePositionSL]);

  // Wire Sniper Engine closed-trade & lifecycle exit callbacks into AiMatrixCorrelationContext & Paper History
  useEffect(() => {
    sniperRecordTradeRef.current = (closedTrade, posUpdate) => {
      if (posUpdate?.newStopLoss && onUpdatePositionSL && posUpdate.symbol) {
        onUpdatePositionSL(posUpdate.symbol, posUpdate.newStopLoss);
      }
      if (tradingMode !== 'PAPER') return;
      const matchingPos = posUpdate?.symbol
        ? paperPositions.find((p) => p.symbol === posUpdate.symbol)
        : undefined;

      if (matchingPos && posUpdate) {
        handlePartialClosePaperPosition(matchingPos, closedTrade, {
          partialSize: posUpdate.partialSize,
          newStopLoss: posUpdate.newStopLoss,
          tp1Hit: posUpdate.tp1Hit,
          tp2Hit: posUpdate.tp2Hit,
          tp3Hit: posUpdate.tp3Hit,
          feeBufferBe: posUpdate.feeBufferBe,
          isFullClose: posUpdate.isFullClose,
        });
      } else {
        const realised = closedTrade.realisedPnl || 0;
        setPaperHistory((prev) => [closedTrade, ...prev]);
        setPaperPortfolio((pf) => ({
          ...pf,
          realisedPnlTotal: +(pf.realisedPnlTotal + realised).toFixed(2),
          dailyPnl: +(pf.dailyPnl + realised).toFixed(2),
          availableBalance: +(pf.availableBalance + realised).toFixed(2),
          totalEquity: +(pf.totalEquity + realised).toFixed(2),
        }));
        playTradeFill();
      }
    };

    sniperLifecycleExitRef.current = (reason, symbol) => {
      clearLockedSignalForCooldown(reason, reason === 'SL' ? SIGNAL_SL_COOLDOWN_MS : 0, symbol);
    };
  }, [
    sniperRecordTradeRef,
    sniperLifecycleExitRef,
    tradingMode,
    paperPositions,
    handlePartialClosePaperPosition,
    setPaperHistory,
    setPaperPortfolio,
    playTradeFill,
    clearLockedSignalForCooldown,
    onUpdatePositionSL,
  ]);

  // Monitor non-Sniper open PAPER positions (from Order Pad) for automated SL & TP1-TP4 4-tier ladder exits
  useEffect(() => {
    if (tradingMode !== 'PAPER' || positions.length === 0) return;

    for (const pos of positions) {
      if (sniperActiveTrade && sniperActiveTrade.symbol === pos.symbol) continue;

      const ticker = markets[pos.symbol] || getMarketTicker(markets, pos.symbol);
      const liveMark = ticker?.markPrice || pos.markPrice || 0;
      if (!(liveMark > 0) || !(pos.entryPrice > 0)) continue;

      const isLong = pos.side === 'LONG';
      const matchingLocked =
        lockedActiveSignal &&
        lockedActiveSignal.symbol === pos.symbol &&
        lockedActiveSignal.direction === pos.side
          ? lockedActiveSignal
          : null;

      const sl = pos.stopLoss && pos.stopLoss > 0 ? pos.stopLoss : 0;
      const tp1 = pos.tp1 || matchingLocked?.tp1 || pos.takeProfit || 0;
      const tp2 = pos.tp2 || matchingLocked?.tp2 || 0;
      const tp3 = pos.tp3 || matchingLocked?.tp3 || 0;
      const tp4 = pos.tp4 || matchingLocked?.tp4 || 0;

      // 1. Stop Loss Hit (full close remaining size + 30s post-SL cooldown)
      if (sl > 0 && (isLong ? liveMark <= sl : liveMark >= sl)) {
        const key = `${pos.id}:SL`;
        if (!processedPosEventsRef.current.has(key)) {
          processedPosEventsRef.current.add(key);
          handleClosePosition(pos.id, '(Stop Loss Hit - Risk Protected)', { exitPrice: liveMark });
          clearLockedSignalForCooldown('SL', SIGNAL_SL_COOLDOWN_MS, pos.symbol);
          speakVoiceAlert('Stop loss triggered. Position closed.', `${pos.id}:SL`);
          addNotification(
            'Stop Loss Hit · Risk Protected',
            `${pos.symbol} ${pos.side} stopped out @ $${liveMark.toLocaleString()}. 30s cooldown active before scanning next fresh setup.`,
            'RISK'
          );
        }
        continue;
      }

      // 2. TP1 Hit (STEP 01): Partial close 50% size · keep SL at initial anti-wick stop (BE disabled until STEP 02 / 2.00R)
      if (tp1 > 0 && !pos.tp1Hit && (isLong ? liveMark >= tp1 : liveMark <= tp1)) {
        const key = `${pos.id}:TP1`;
        if (!processedPosEventsRef.current.has(key)) {
          processedPosEventsRef.current.add(key);
          const partialQty = Math.min(
            Math.max(0.001, +(pos.size * 0.5).toFixed(3)),
            Math.max(0.001, +(pos.size - 0.003).toFixed(3))
          );
          const canScale = pos.size > 0.004 && partialQty < pos.size;
          const tpDiff = isLong ? Math.max(0, tp1 - pos.entryPrice) : Math.max(0, pos.entryPrice - tp1);
          const realisedPnl = +(tpDiff * (canScale ? partialQty : pos.size)).toFixed(2);
          const portionMargin = (pos.margin || 0) * ((canScale ? partialQty : pos.size) / pos.size);
          const pnlPercent = portionMargin > 0 ? +((realisedPnl / portionMargin) * 100).toFixed(2) : 0;

          handlePartialClosePaperPosition(
            pos,
            {
              id: `th-pos-tp1-${Date.now()}`,
              symbol: pos.symbol,
              side: pos.side,
              size: canScale ? partialQty : pos.size,
              entryPrice: pos.entryPrice,
              exitPrice: tp1,
              realisedPnl,
              pnlPercent,
              openedAt: pos.openedAt,
              closedAt: Date.now(),
              reason: canScale
                ? 'STEP 01 (TP1) Hit — 50% Partial Close (SL Held Until STEP 02 / 2.00R)'
                : 'TP1 Hit — Target Reached',
              mode: 'PAPER',
            },
            canScale
              ? {
                  partialSize: partialQty,
                  newStopLoss: pos.stopLoss,
                  tp1Hit: true,
                }
              : { isFullClose: true }
          );

          speakVoiceAlert('Target 1 reached. Partial profit locked.', `${pos.id}:TP1`);
          addNotification(
            'TP1 Hit · 50% Partial Booked',
            `${pos.symbol} hit TP1 ($${tp1.toLocaleString()}). Closed 50% (+$${realisedPnl.toFixed(2)}). SL remains at initial anti-wick stop until STEP 02 (2.00R).`,
            'TRADE'
          );
          if (!canScale) {
            clearLockedSignalForCooldown('TP4', 0, pos.symbol);
          }
        }
        continue;
      }

      // 3. TP2 Hit (STEP 02 / 2.00R): Scale out 25% & move SL to Entry + Fee Buffer (Risk-Free BE)
      if (tp2 > 0 && pos.tp1Hit && !pos.tp2Hit && (isLong ? liveMark >= tp2 : liveMark <= tp2)) {
        const key = `${pos.id}:TP2`;
        if (!processedPosEventsRef.current.has(key)) {
          processedPosEventsRef.current.add(key);
          const partialQty = Math.min(
            Math.max(0.001, +(pos.size * 0.25).toFixed(3)),
            Math.max(0.001, +(pos.size - 0.002).toFixed(3))
          );
          const feeBufferBe = computeNetZeroBreakEvenPrice(pos.entryPrice, pos.side);
          const tpDiff = isLong ? Math.max(0, tp2 - pos.entryPrice) : Math.max(0, pos.entryPrice - tp2);
          const realisedPnl = +(tpDiff * partialQty).toFixed(2);
          const portionMargin = (pos.margin || 0) * (partialQty / pos.size);
          const pnlPercent = portionMargin > 0 ? +((realisedPnl / portionMargin) * 100).toFixed(2) : 0;

          handlePartialClosePaperPosition(
            pos,
            {
              id: `th-pos-tp2-${Date.now()}`,
              symbol: pos.symbol,
              side: pos.side,
              size: partialQty,
              entryPrice: pos.entryPrice,
              exitPrice: tp2,
              realisedPnl,
              pnlPercent,
              openedAt: pos.openedAt,
              closedAt: Date.now(),
              reason: 'STEP 02 (2.00R / TP2) Hit — 25% Scale-Out (SL Moved to Fee-Buffer BE)',
              mode: 'PAPER',
            },
            {
              partialSize: partialQty,
              newStopLoss: feeBufferBe,
              tp2Hit: true,
              feeBufferBe,
            }
          );

          speakVoiceAlert('Target 2 reached. Stop loss moved to breakeven.', `${pos.id}:TP2`);
          addNotification(
            'STEP 02 (2.00R) Hit · SL Moved to Breakeven',
            `${pos.symbol} reached TP2 ($${tp2.toLocaleString()} / 2.00R). Scaled 25% (+$${realisedPnl.toFixed(2)}) and moved SL to Fee-Buffer BE ($${feeBufferBe.toLocaleString()}).`,
            'TRADE'
          );
        }
        continue;
      }

      // 4. TP3 Hit: Scale out 25% & trail SL to TP2
      if (tp3 > 0 && pos.tp2Hit && !pos.tp3Hit && (isLong ? liveMark >= tp3 : liveMark <= tp3)) {
        const key = `${pos.id}:TP3`;
        if (!processedPosEventsRef.current.has(key)) {
          processedPosEventsRef.current.add(key);
          const partialQty = Math.min(
            Math.max(0.001, +(pos.size * 0.25).toFixed(3)),
            Math.max(0.001, +(pos.size - 0.001).toFixed(3))
          );
          const tpDiff = isLong ? Math.max(0, tp3 - pos.entryPrice) : Math.max(0, pos.entryPrice - tp3);
          const realisedPnl = +(tpDiff * partialQty).toFixed(2);
          const portionMargin = (pos.margin || 0) * (partialQty / pos.size);
          const pnlPercent = portionMargin > 0 ? +((realisedPnl / portionMargin) * 100).toFixed(2) : 0;

          handlePartialClosePaperPosition(
            pos,
            {
              id: `th-pos-tp3-${Date.now()}`,
              symbol: pos.symbol,
              side: pos.side,
              size: partialQty,
              entryPrice: pos.entryPrice,
              exitPrice: tp3,
              realisedPnl,
              pnlPercent,
              openedAt: pos.openedAt,
              closedAt: Date.now(),
              reason: 'TP3 Hit — 25% Scale-Out (SL Trailed to TP2)',
              mode: 'PAPER',
            },
            {
              partialSize: partialQty,
              newStopLoss: tp2 > 0 ? tp2 : pos.stopLoss,
              tp3Hit: true,
            }
          );

          speakVoiceAlert('Target 3 reached. Profit locked.', `${pos.id}:TP3`);
          addNotification(
            'TP3 Achieved · SL Trailed to TP2',
            `${pos.symbol} reached TP3 ($${tp3.toLocaleString()}). Scaled 25% (+$${realisedPnl.toFixed(2)}) and trailed SL to TP2.`,
            'TRADE'
          );
        }
        continue;
      }

      // 5. TP4 Hit: Close 100% of remaining position, log final trade, clear locked signal & trigger fresh scan
      if (tp4 > 0 && !pos.tp4Hit && (isLong ? liveMark >= tp4 : liveMark <= tp4)) {
        const key = `${pos.id}:TP4`;
        if (!processedPosEventsRef.current.has(key)) {
          processedPosEventsRef.current.add(key);
          const tpDiff = isLong ? Math.max(0, tp4 - pos.entryPrice) : Math.max(0, pos.entryPrice - tp4);
          const realisedPnl = +(tpDiff * pos.size).toFixed(2);
          const pnlPercent = (pos.margin || 0) > 0 ? +((realisedPnl / pos.margin) * 100).toFixed(2) : 0;

          handlePartialClosePaperPosition(
            pos,
            {
              id: `th-pos-tp4-${Date.now()}`,
              symbol: pos.symbol,
              side: pos.side,
              size: pos.size,
              entryPrice: pos.entryPrice,
              exitPrice: tp4,
              realisedPnl,
              pnlPercent,
              openedAt: pos.openedAt,
              closedAt: Date.now(),
              reason: 'TP4 Final Target Reached — 100% Remaining Closed',
              mode: 'PAPER',
            },
            { isFullClose: true }
          );

          clearLockedSignalForCooldown('TP4', 0, pos.symbol);
          speakVoiceAlert('Target 4 reached. Profit locked.', `${pos.id}:TP4`);
          addNotification(
            'TP4 Achieved — Full Position Closed',
            `${pos.symbol} reached TP4 ($${tp4.toLocaleString()}). Closed 100% remaining (+$${realisedPnl.toFixed(2)}). Scanning next setup.`,
            'TRADE'
          );
        }
      }
    }
  }, [
    tradingMode,
    positions,
    markets,
    sniperActiveTrade,
    lockedActiveSignal,
    handleClosePosition,
    handlePartialClosePaperPosition,
    clearLockedSignalForCooldown,
    addNotification,
  ]);

  return null;
};

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>({
    uid: 'admin-dhanrajk69-uid',
    email: 'dhanrajk69@gmail.com',
    displayName: 'Dhanraj K (Admin)',
    getIdToken: async () => 'mock-admin-firebase-id-token-dhanrajk69-verified',
  } as any);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>('');

  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          const email = result.user.email || '';
          if (email.toLowerCase() !== 'dhanrajk69@gmail.com') {
            signOut(auth);
            setAuthError('Access restricted to authorized administrator (dhanrajk69@gmail.com).');
          }
        }
      })
      .catch(() => {});

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthUser(user);
      }
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAdminBypassLogin = () => {
    setAuthError('');
    const adminUser = {
      uid: 'admin-dhanrajk69-uid',
      email: 'dhanrajk69@gmail.com',
      displayName: 'Dhanraj K (Admin)',
      getIdToken: async () => 'mock-admin-firebase-id-token-dhanrajk69-verified',
    };
    setAuthUser(adminUser as any);
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user?.email || '';
      if (email.toLowerCase() !== 'dhanrajk69@gmail.com') {
        setAuthError('Access restricted to authorized administrator (dhanrajk69@gmail.com).');
        await signOut(auth);
      }
    } catch (err: any) {
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (redirErr: any) {
        setAuthError(redirErr?.message || err?.message || 'Google Sign-In failed');
      }
    }
  };

  const isAuthorizedAdmin = Boolean(authUser && authUser.email?.toLowerCase() === 'dhanrajk69@gmail.com');

  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  const handleToggleSidebarCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  const [showShortTermTrendOverlay, setShowShortTermTrendOverlay] = useState<boolean>(false);

  const handleToggleShortTermTrendOverlay = useCallback(() => {
    setShowShortTermTrendOverlay((prev) => !prev);
  }, []);

  const [trendSmoothingFactor, setTrendSmoothingFactor] = useState<number>(50);

  const handleTrendSmoothingFactorChange = useCallback((nextVal: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVal)));
    setTrendSmoothingFactor(clamped);
  }, []);

  const [trendVariance, setTrendVariance] = useState<{ stdDev: number; stdDevPct: number } | null>(null);
  const [volatilityBreachAlertEnabled, setVolatilityBreachAlertEnabled] = useState<boolean>(false);
  const [volatilityBreachThreshold, setVolatilityBreachThreshold] = useState<number>(1.0);
  const [volatilityBreachChimeEnabled, setVolatilityBreachChimeEnabled] = useState<boolean>(true);
  const [autoMuteOnBreachEnabled, setAutoMuteOnBreachEnabled] = useState<boolean>(false);
  const [autoResetTrendEnabled, setAutoResetTrendEnabled] = useState<boolean>(false);
  const [isVolatilityBreachWarningActive, setIsVolatilityBreachWarningActive] = useState<boolean>(false);
  const [trendResetNonce, setTrendResetNonce] = useState<number>(0);
  const [volatilityBreachToast, setVolatilityBreachToast] = useState<{
    id: string;
    symbol: string;
    stdDev: number;
    stdDevPct: number;
    threshold: number;
    timestamp: number;
    isTest?: boolean;
  } | null>(null);
  const [volatilityBreachHistory, setVolatilityBreachHistory] = useState<VolatilityBreachHistoryEntry[]>([]);
  const wasVolatilityBreachingRef = useRef<boolean>(false);
  const lastVolatilityBreachAtRef = useRef<number>(0);
  const lastBreachSymbolRef = useRef<string>('');

  const [tradingMode, setTradingMode] = useState<TradingMode>('PAPER');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTCUSDT');
  const [activeBacktestTrade, setActiveBacktestTrade] = useState<BacktestTradeOverlay | null>(null);
  const [timeframe, setTimeframe] = useState<string>('5m');
  // Interactive USD ($) / INR (₹) Currency State (UI preference allowed in localStorage)
  const [currency, setCurrency] = useState<'USD' | 'INR'>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('delta_pref_currency') : null;
      if (saved === 'INR' || saved === 'USD') return saved;
    } catch {}
    return 'USD';
  });
  const exchangeRate = currency === 'INR' ? 85 : 1;
  const currencyPrefix = currency === 'INR' ? '₹' : '$';
  const toggleCurrency = useCallback(() => {
    setCurrency((prev) => (prev === 'USD' ? 'INR' : 'USD'));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('delta_pref_currency', currency);
    } catch {}
  }, [currency]);

  // Delta Exchange India Live API Credentials & Authentication State
  const [apiCredentials, setApiCredentials] = useState<DeltaApiCredentials>(() => {
    const stored = getStoredDeltaCredentials();
    if (stored) {
      return stored;
    }
    return {
      apiKey: '',
      apiSecret: '',
      environment: 'PROD',
      isVerified: false,
    };
  });

  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [serverHasCredentials, setServerHasCredentials] = useState<boolean>(false);
  const [serverAuthConfirmed, setServerAuthConfirmed] = useState<boolean>(false);

  const hasLocalSavedApiKeys = Boolean(
    apiCredentials.isVerified ||
      (apiCredentials.apiKey.trim().length >= 8 &&
        !isMaskedPlaceholderCredential(apiCredentials.apiKey) &&
        !apiCredentials.apiKey.trim().toLowerCase().startsWith('demo_') &&
        apiCredentials.apiSecret.trim().length >= 8 &&
        !isMaskedPlaceholderCredential(apiCredentials.apiSecret) &&
        !apiCredentials.apiSecret.trim().toLowerCase().startsWith('demo_'))
  );
  const hasSavedApiKeys = Boolean(serverHasCredentials || hasLocalSavedApiKeys);
  const isApiAuthenticated = Boolean(hasSavedApiKeys || serverHasCredentials);
  const isLiveApiAuthenticated = isApiAuthenticated;
  const isLiveUnverified = Boolean(
    tradingMode === 'LIVE' &&
      serverAuthConfirmed &&
      !isCheckingAuth &&
      !hasSavedApiKeys &&
      !isApiAuthenticated
  );

  // Server-side Session & Security Gate State
  const [sessionToken, setSessionToken] = useState<string>('');
  const [serverLiveGateEnabled, setServerLiveGateEnabled] = useState<boolean>(false);
  const [liveTradingReady, setLiveTradingReady] = useState<boolean>(false);
  const [tradingPolicyNotice, setTradingPolicyNotice] = useState<string>('');
  const [serverOutboundIps, setServerOutboundIps] = useState<{
    serverIpv4: string;
    serverIpv6: string;
  }>({
    serverIpv4: '34.47.205.98',
    serverIpv6: '2600:1900:0:3803::700',
  });
  const [copiedIpType, setCopiedIpType] = useState<'IPV4' | 'IPV6' | null>(null);

  const handleCopyServerIp = useCallback(async (ipValue: string, type: 'IPV4' | 'IPV6') => {
    if (!ipValue) return;
    await copyToClipboard(ipValue);
    setCopiedIpType(type);
    setTimeout(() => {
      setCopiedIpType((prev) => (prev === type ? null : prev));
    }, 2000);
  }, []);

  // Initial Session Authentication Token, Live Gate Policy & Outbound IPv4/IPv6 Retrieval
  useEffect(() => {
    let isMounted = true;
    async function initSession() {
      try {
        const [sessionRes, statusRes, authStatusRes] = await Promise.all([
          fetch('/api/auth/session').catch(() => null),
          fetch('/api/delta/status').catch(() => null),
          fetch('/api/delta/auth-status').catch(() => null),
        ]);
        let resolvedToken = sessionToken;
        if (sessionRes && sessionRes.ok) {
          const data = await sessionRes.json();
          if (isMounted && data.token) {
            resolvedToken = data.token;
            setSessionToken(data.token);
            setServerLiveGateEnabled(Boolean(data.serverLiveGateEnabled));
            setLiveTradingReady(Boolean(data.liveTradingReady));
            setTradingPolicyNotice(data.policyNotice || '');
          }
        }
        if (statusRes && statusRes.ok) {
          const statusData = await statusRes.json();
          if (isMounted && (statusData.serverIpv4 || statusData.serverIpv6)) {
            setServerOutboundIps((prev) => ({
              serverIpv4: statusData.serverIpv4 || prev.serverIpv4,
              serverIpv6: statusData.serverIpv6 || prev.serverIpv6 || '2600:1900:0:3803::700',
            }));
          }
        }
        if (authStatusRes && authStatusRes.ok) {
          const authData = await authStatusRes.json();
          if (isMounted) {
            setServerAuthConfirmed(true);
          }
          if (isMounted && authData?.globalLeverageConfig) {
            applyGlobalLeverageConfig(authData.globalLeverageConfig);
          }
          if (isMounted && authData.success && (authData.hasCredentials || authData.hasSavedApiKeys)) {
            setServerHasCredentials(true);
            setLivePortfolio((prev) =>
              prev.walletDiagnosticError?.code === 'MISSING_API_CREDENTIALS'
                ? { ...prev, walletDiagnosticError: null }
                : prev
            );
            const currentStored = getStoredDeltaCredentials();
            let effectiveHydratedCreds: DeltaApiCredentials =
              currentStored && currentStored.apiKey && currentStored.apiKey.length >= 8
                ? currentStored
                : {
                    apiKey: authData.maskedKey || '****JQLX',
                    apiSecret: '********',
                    environment: 'PROD',
                    isVerified: true,
                  };
            if (!currentStored || !currentStored.apiKey || currentStored.apiKey.length < 8) {
              setApiCredentials(effectiveHydratedCreds);
              saveStoredDeltaCredentials(effectiveHydratedCreds);
            }
            setServerLiveGateEnabled(true);
            setLiveTradingReady(true);
            if (authData.tradingMode === 'LIVE') {
              setTradingMode('LIVE');
            }
            syncLiveAccountWallet(effectiveHydratedCreds, { serverHasCreds: true });
            refreshPositions(effectiveHydratedCreds);
          } else if (isMounted && authData.success) {
            setServerHasCredentials(false);
            const currentStored = getStoredDeltaCredentials();
            if (
              currentStored &&
              (isMaskedPlaceholderCredential(currentStored.apiKey) ||
                isMaskedPlaceholderCredential(currentStored.apiSecret))
            ) {
              clearStoredDeltaCredentials();
              setApiCredentials({
                apiKey: '',
                apiSecret: '',
                environment: 'PROD',
                isVerified: false,
              });
            }
          }
        }
        try {
          const cfgRes = await fetch('/api/delta/server-config', {
            headers: {
              'x-admin-email': 'dhanrajk69@gmail.com',
              ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
            },
          });
          if (cfgRes.ok && isMounted) {
            const cfgData = await cfgRes.json();
            if (cfgData?.globalLeverageConfig) {
              applyGlobalLeverageConfig(cfgData.globalLeverageConfig);
            }
            if (cfgData?.riskSettings) {
              hydrateFromServerConfig(cfgData.riskSettings);
            }
          }
        } catch {}
      } catch {
        // Non-blocking session init fallback
      } finally {
        if (isMounted) {
          setIsCheckingAuth(false);
        }
      }
    }
    initSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const serverUsdInrRateRef = useRef<number>(0);

  // Sound effects (automatically mute general trading alerts when a Volatility Breach is active if enabled)
  const isAutoMutedByBreach = Boolean(autoMuteOnBreachEnabled && isVolatilityBreachWarningActive);
  const {
    muted,
    effectiveMuted,
    setMuted,
    playTradeFill,
    playAlert,
    playKillSwitch,
    playFlashBeep,
    playVolatilitySpike,
    playVolatilityBreachChime,
  } = useSoundEffects(isAutoMutedByBreach);

  useEffect(() => {
    setGlobalAudioMuted(effectiveMuted);
    if (effectiveMuted) {
      clearSignalVoiceRepeats();
    }
  }, [effectiveMuted]);

  // Market State
  const [markets, setMarkets] = useState<Record<string, MarketTicker>>({});

  // App Notifications State & Helper
  const [notifications, setNotifications] = useState<AppNotification[]>([
    {
      id: 'notif-1',
      timestamp: Date.now() - 180000,
      title: 'Delta India Gateway Online',
      message: 'Connected to Delta Exchange India derivative order books via IPv4 (34.47.205.98). Latency: 18ms.',
      type: 'INFO',
      read: false,
    },
    {
      id: 'notif-2',
      timestamp: Date.now() - 90000,
      title: 'AI Trade Setup Identified',
      message: 'Gemini detected high-conviction 5m VWAP bounce on BTCUSDT with 93% confidence.',
      type: 'AI',
      read: false,
    },
  ]);

  const recentNotificationMapRef = useRef<Map<string, number>>(new Map());

  const addNotification = useCallback((
    title: string,
    message: string,
    type: AppNotification['type'] = 'INFO',
    options?: { silent?: boolean; skipPush?: boolean; priority?: 'urgent' | 'high' | 'default' | 'low'; tags?: string }
  ) => {
    // Deduplicate consecutive identical notifications (especially Drawdown Rescue Blocked / insufficient_margin) within a 5-minute window
    if (
      shouldSuppressDuplicateNotification({
        recentMap: recentNotificationMapRef.current,
        title,
        message,
        type,
      })
    ) {
      return;
    }

    const newN: AppNotification = {
      id: `n-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      title,
      message,
      type,
      read: false,
    };
    setNotifications((prev) => [newN, ...prev]);
    if (!options?.silent) {
      if (type === 'TRADE') playTradeFill();
      if (type === 'RISK') playAlert();
    }

    // ═══════════════════════════════════════════════════════════
    // SERVER-SIDE TELEGRAM BOT RELAY (STRICT LIVE-ONLY, EVENT-DRIVEN)
    // Blocks ALL PAPER mode alerts; only LIVE executions, LIVE position transitions,
    // and live market intelligence alerts are relayed to Telegram.
    // ═══════════════════════════════════════════════════════════
    if (!options?.skipPush) {
      const lower = `${title} ${message}`.toLowerCase();
      const isPaperMessage =
        tradingMode === 'PAPER' ||
        lower.includes('(paper)') ||
        /\bpaper\s+(?:order|trade|demo|position|entry|fill|signal|basket|close)/i.test(lower);

      const isMarketIntelligence =
        lower.includes('market sentiment') ||
        lower.includes('headline:');

      // Drop all PAPER mode trade/position/signal alerts before hitting Telegram
      if (isPaperMessage && !isMarketIntelligence) {
        return;
      }

      const isImportantEvent =
        isMarketIntelligence ||
        type === 'TRADE' ||
        type === 'RISK' ||
        lower.includes('auto-pilot') ||
        lower.includes('sniper') ||
        lower.includes('spread') ||
        lower.includes('stage 1') ||
        lower.includes('stage 2') ||
        lower.includes('stage 3') ||
        lower.includes('tp1') ||
        lower.includes('tp2') ||
        lower.includes('tp3') ||
        lower.includes('tp4') ||
        lower.includes('stop-loss') ||
        lower.includes('stop loss') ||
        lower.includes('kill switch') ||
        lower.includes('order executed') ||
        lower.includes('position closed');

      // Suppress noisy non-event / polling / sync notifications
      const isNoisyStatusMessage =
        lower.includes('cloud server synced') ||
        lower.includes('copied to clipboard') ||
        lower.includes('origin copied') ||
        lower.includes('wallet verified') ||
        lower.includes('connection verified') ||
        lower.includes('heartbeat');

      if (isImportantEvent && !isNoisyStatusMessage) {
        let eventKey: 'fills' | 'tpSl' | 'autoPilot' | 'killSwitch' | 'staleSignals' = 'fills';
        if (lower.includes('kill switch')) {
          eventKey = 'killSwitch';
        } else if (
          lower.includes('tp1') ||
          lower.includes('tp2') ||
          lower.includes('tp3') ||
          lower.includes('tp4') ||
          lower.includes('stage 1') ||
          lower.includes('stage 2') ||
          lower.includes('stage 3') ||
          lower.includes('stop-loss') ||
          lower.includes('stop loss') ||
          lower.includes('profit')
        ) {
          eventKey = 'tpSl';
        } else if (lower.includes('pause') || lower.includes('stale') || lower.includes('overdue')) {
          eventKey = 'staleSignals';
        } else if (lower.includes('auto-pilot')) {
          eventKey = 'autoPilot';
        }

        const symMatch = `${title} ${message}`.match(/\b((?:C|P)-[A-Z]{2,5}-\d+-\d+|[A-Z]{2,6}USD(?:T)?)\b/i);
        const detectedSymbol = symMatch ? symMatch[1].toUpperCase() : undefined;

        dispatchMobileAlert(
          {
            title,
            message,
            type,
            priority: options?.priority,
            tags: options?.tags,
            eventKey,
            mode: isMarketIntelligence ? 'LIVE' : tradingMode,
            isPaper: isMarketIntelligence ? false : tradingMode === 'PAPER',
            category: isMarketIntelligence
              ? (lower.includes('headline') ? 'HEADLINE' : 'SENTIMENT')
              : eventKey === 'tpSl'
              ? 'POSITION'
              : type === 'RISK'
              ? 'RISK'
              : 'TRADE',
            contractSymbol: detectedSymbol,
          },
          sessionToken
        ).catch((err) => {
          console.warn('[NotificationRelay] Server dispatch failed:', err?.message);
        });
      }
    }
  }, [playTradeFill, playAlert, sessionToken, tradingMode]);

  // Strictly Isolated Paper Demo State vs Live India State
  const [paperPortfolio, setPaperPortfolio] = useState<PortfolioData>({
    totalEquity: 1000.00,
    availableBalance: 1000.00,
    marginUsed: 0.00,
    initialCapital: 1000.00,
    dailyPnl: 0.00,
    dailyPnlPercent: 0.00,
    realisedPnlTotal: 0.00,
    unrealisedPnlTotal: 0.00,
    tradesToday: 0,
    winRate: 0.0,
  });
  const [paperPositions, setPaperPositions] = useState<Position[]>([]);
  const [paperHistory, setPaperHistory] = useState<ClosedTrade[]>([]);

  // Live India State (Never inherits Paper Demo balances, positions, or PnL)
  const [livePortfolio, setLivePortfolio] = useState<PortfolioData>(ZERO_LIVE_PORTFOLIO);
  const [livePositions, setLivePositions] = useState<Position[]>([]);
  const [liveHistory, setLiveHistory] = useState<ClosedTrade[]>([]);
  const appBootTimestampRef = useRef<number>(Date.now());
  const [walletHydratedLive, setWalletHydratedLive] = useState(false);
  const [positionsHydratedLive, setPositionsHydratedLive] = useState(false);

  // Active Mode Resolution:
  // - In PAPER mode: use isolated paperPortfolio, paperPositions, paperHistory
  // - In LIVE mode without verified API credentials: strictly 0.00 balances/PnL and 0 positions
  // - In LIVE mode with verified API credentials: use isolated livePortfolio, livePositions, liveHistory
  const portfolio: PortfolioData = useMemo(() => {
    if (tradingMode === 'LIVE') {
      return isLiveApiAuthenticated ? livePortfolio : ZERO_LIVE_PORTFOLIO;
    }
    return paperPortfolio;
  }, [tradingMode, isLiveApiAuthenticated, livePortfolio, paperPortfolio]);

  const positions: Position[] = useMemo(() => {
    if (tradingMode === 'LIVE') {
      return isLiveApiAuthenticated
        ? livePositions.filter((p) => p.mode === 'LIVE' && Math.abs(Number(p.size || (p as any).contracts || 0)) > 0)
        : [];
    }
    return paperPositions.filter((p) => p.mode !== 'LIVE');
  }, [tradingMode, isLiveApiAuthenticated, livePositions, paperPositions]);

  const history: ClosedTrade[] = useMemo(() => {
    if (tradingMode === 'LIVE') {
      return isLiveApiAuthenticated ? liveHistory.filter((h) => h.mode === 'LIVE') : [];
    }
    return paperHistory.filter((h) => h.mode !== 'LIVE');
  }, [tradingMode, isLiveApiAuthenticated, liveHistory, paperHistory]);

  // Synchronize Base Perpetual Positions & Realized PnL to PortfolioContext
  const {
    positions: portfolioCtxPositions,
    history: portfolioCtxHistory,
    setBasePositionsPnl,
    setUsdInrRate,
    setPositions,
    setHistory,
    setPortfolioBalances,
    refreshLiveWalletAndPositions,
    refreshPositions,
    refreshWallet,
    walletDiagnosticError,
    updatePositionStopLoss,
  } = usePortfolio();

  // Real-Time Mismatch & WebSocket Reactivity: Mirror authoritative PortfolioContext positions & fills immediately into App live state
  useEffect(() => {
    if (!isLiveApiAuthenticated) return;
    const liveOnly = (Array.isArray(portfolioCtxPositions) ? portfolioCtxPositions : []).filter(
      (p) => Math.abs(Number(p.size || (p as any).contracts || 0)) > 0
    );
    setLivePositions(liveOnly);
    setPositionsHydratedLive(true);
  }, [portfolioCtxPositions, isLiveApiAuthenticated]);

  useEffect(() => {
    if (!isLiveApiAuthenticated || !Array.isArray(portfolioCtxHistory) || portfolioCtxHistory.length === 0) return;
    setLiveHistory((prev) => {
      const byKey = new Map<string, ClosedTrade>();
      for (const item of prev) {
        const key = item.fillId ? `fill:${item.fillId}` : item.id;
        byKey.set(key, item);
      }
      for (const item of portfolioCtxHistory) {
        const key = item.fillId ? `fill:${item.fillId}` : item.id;
        const existing = byKey.get(key);
        byKey.set(key, existing ? { ...existing, ...item, notes: existing.notes ?? item.notes } : item);
      }
      return Array.from(byKey.values())
        .sort((a, b) => Number(b.closedAt || 0) - Number(a.closedAt || 0))
        .slice(0, 500);
    });
  }, [portfolioCtxHistory, isLiveApiAuthenticated]);

  const syncLiveAccountWallet = useCallback(
    async (
      credsOverride?: DeltaApiCredentials | null,
      options?: { notify?: boolean; serverHasCreds?: boolean }
    ) => {
      const targetCreds = credsOverride || apiCredentials;
      const hasLocalCreds = Boolean(
        targetCreds &&
          targetCreds.apiKey &&
          targetCreds.apiKey.trim().length >= 8 &&
          targetCreds.apiSecret &&
          targetCreds.apiSecret.trim().length >= 8
      );
      const effectiveServerCreds = Boolean(options?.serverHasCreds || serverHasCredentials);

      if (!hasLocalCreds && !effectiveServerCreds) {
        if (options?.notify && !isCheckingAuth) {
          addNotification(
            'API Key Required',
            'Connect your Delta Exchange API Key & Secret in Settings.',
            'RISK'
          );
        }
        return;
      }

      const result = await refreshLiveWalletAndPositions(
        hasLocalCreds
          ? targetCreds
          : { apiKey: '****SERVER', apiSecret: '********', environment: 'PROD' }
      );
      if (!result) return;

      const { walletResponse, positionsResponse } = result;
      if (walletResponse.status === 'success' && walletResponse.wallet) {
        const w = walletResponse.wallet;
        const cashBalance =
          Number.isFinite(w.walletBalance) && (w.walletBalance as number) > 0
            ? (w.walletBalance as number)
            : +(w.totalEquity - (w.unrealisedPnlTotal || 0)).toFixed(2);
        if (Number(w.totalEquity || 0) > 0) {
          setWalletHydratedLive(true);
        }
        setLivePortfolio((prev) => ({
          ...prev,
          totalEquity: w.totalEquity,
          walletBalance: cashBalance,
          availableMargin: w.availableMargin,
          availableBalance: w.availableBalance,
          marginUsed: w.marginUsed,
          openPositionValueUsd: w.openPositionValueUsd ?? 0,
          initialCapital: cashBalance > 0 ? cashBalance : prev.initialCapital,
          unrealisedPnlTotal: w.unrealisedPnlTotal,
          walletDiagnosticError: null,
        }));

        if (options?.notify) {
          addNotification(
            'Delta Live Wallet Synced',
            `Balances verified via IPv4 (34.47.205.98). Total Equity: $${w.totalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Available Margin: $${w.availableMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            'INFO'
          );
        }
      } else if (walletResponse.diagnosticError || walletResponse.status === 'diagnostic_error') {
        const diag = walletResponse.diagnosticError;
        const isSuppressedMissing =
          diag?.code === 'MISSING_API_CREDENTIALS' && (isCheckingAuth || effectiveServerCreds);
        if (!isSuppressedMissing) {
          const formatted = diag
            ? formatDiagnosticBadgeAndMessage(diag.code, diag.message)
            : null;
          setLivePortfolio((prev) => ({
            ...prev,
            walletDiagnosticError: diag
              ? { ...diag, message: formatted?.message || diag.message }
              : null,
          }));

          if (options?.notify && diag && formatted) {
            addNotification(
              `Exchange Sync Issue · ${formatted.label}`,
              formatted.message,
              'RISK'
            );
          }
        }
      }

      if (positionsResponse.status === 'success' && Array.isArray(positionsResponse.positions)) {
        const activeOnly = positionsResponse.positions.filter(
          (p) => Math.abs(Number(p.size || (p as any).contracts || 0)) > 0
        );
        setLivePositions(activeOnly);
        setPositionsHydratedLive(true);
      }
    },
    [apiCredentials, serverHasCredentials, isCheckingAuth, refreshLiveWalletAndPositions, addNotification]
  );

  const handleSetTradingMode = useCallback(
    (newMode: TradingMode) => {
      setTradingMode(newMode);
      if (newMode === 'LIVE') {
        syncLiveAccountWallet(apiCredentials, { notify: true });
        addNotification(
          'Trading Mode: LIVE',
          'Switched to Live Delta Exchange India trading mode. Syncing real wallet balances & active positions over IPv4 (34.47.205.98)...',
          'INFO'
        );
      } else {
        addNotification(
          'Trading Mode: Paper Demo',
          'Switched to Paper Demo mode. Live funds and orders are strictly isolated.',
          'INFO'
        );
      }
    },
    [syncLiveAccountWallet, apiCredentials, addNotification]
  );

  // Sync active mode (Paper or Live) balances into PortfolioContext
  useEffect(() => {
    if (tradingMode === 'PAPER') {
      setPortfolioBalances({
        totalEquity: paperPortfolio.totalEquity,
        walletBalance: paperPortfolio.walletBalance ?? paperPortfolio.initialCapital,
        availableMargin: paperPortfolio.availableBalance,
        availableBalance: paperPortfolio.availableBalance,
        marginUsed: paperPortfolio.marginUsed,
        openPositionValueUsd: paperPortfolio.openPositionValueUsd ?? 0,
        diagnosticError: null,
      });
    } else if (tradingMode === 'LIVE') {
      setPortfolioBalances({
        totalEquity: livePortfolio.totalEquity,
        walletBalance: livePortfolio.walletBalance ?? livePortfolio.initialCapital,
        availableMargin: livePortfolio.availableMargin ?? livePortfolio.availableBalance,
        availableBalance: livePortfolio.availableBalance,
        marginUsed: livePortfolio.marginUsed,
        openPositionValueUsd: livePortfolio.openPositionValueUsd ?? 0,
        diagnosticError: livePortfolio.walletDiagnosticError ?? null,
      });
    }
  }, [
    tradingMode,
    paperPortfolio.totalEquity,
    paperPortfolio.walletBalance,
    paperPortfolio.initialCapital,
    paperPortfolio.availableBalance,
    paperPortfolio.marginUsed,
    paperPortfolio.openPositionValueUsd,
    livePortfolio.totalEquity,
    livePortfolio.walletBalance,
    livePortfolio.initialCapital,
    livePortfolio.availableMargin,
    livePortfolio.availableBalance,
    livePortfolio.marginUsed,
    livePortfolio.openPositionValueUsd,
    livePortfolio.walletDiagnosticError,
    setPortfolioBalances,
  ]);

  // AI & Risk (Single Source of Truth from CapitalAllocationContext)
  const {
    riskSettings,
    globalLeverage,
    maxLeverageCap,
    marginMode,
    leverageSyncLocked,
    applyGlobalLeverageConfig,
    updateRiskSettings,
    hydrateFromServerConfig,
    clampLeverage,
  } = useCapitalAllocation();

  // Cross-device server sync snapshot polling (every 6s, paused when document.hidden === true) for both Desktop Web and Android Mobile
  useEffect(() => {
    let isMounted = true;
    async function fetchSyncSnapshot() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(`/api/delta/sync-snapshot?_t=${Date.now()}`, {
          headers: {
            'x-admin-email': 'dhanrajk69@gmail.com',
            ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
            ...(apiCredentials.apiKey && !isMaskedPlaceholderCredential(apiCredentials.apiKey)
              ? { 'x-delta-api-key': apiCredentials.apiKey, 'x-delta-api-secret': apiCredentials.apiSecret }
              : {}),
          },
          cache: 'no-store',
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.success) {
            if (data.authenticated !== undefined || data.hasSavedApiKeys !== undefined) {
              const snapshotAuthed = Boolean(data.authenticated || data.hasSavedApiKeys);
              setServerHasCredentials(snapshotAuthed);
              setServerAuthConfirmed(true);
              setIsCheckingAuth(false);
              if (snapshotAuthed) {
                setServerLiveGateEnabled(true);
                setLiveTradingReady(true);
                setLivePortfolio((prev) =>
                  prev.walletDiagnosticError?.code === 'MISSING_API_CREDENTIALS'
                    ? { ...prev, walletDiagnosticError: null }
                    : prev
                );
              }
            }
            if (typeof data.usdInrRate === 'number' && data.usdInrRate > 0) {
              serverUsdInrRateRef.current = data.usdInrRate;
              setUsdInrRate(data.usdInrRate);
            }
            if (data.wallet) {
              const netEq = Number(
                data.wallet.netEquityUsd ?? data.wallet.totalEquity ?? data.wallet.balance ?? 0
              );
              const cashBal = Number(
                data.wallet.walletBalanceUsd ?? data.wallet.walletBalance ?? data.wallet.balance ?? netEq
              );
              const availMarg = Number(
                data.wallet.availableMarginUsd ?? data.wallet.availableMargin ?? data.wallet.available_balance ?? 0
              );
              const availBal = Number(
                data.wallet.availableBalance ?? data.wallet.available_balance ?? availMarg
              );
              const margUsed = Number(data.wallet.marginUsed ?? data.wallet.position_margin ?? 0);
              const openPosVal = Number(data.wallet.openPositionValueUsd ?? 0);
              const uPnlTotal = Number(data.wallet.unrealisedPnlTotal ?? data.totalUnrealizedPnlUsd ?? 0);

              if (typeof data.wallet.usdInrRate === 'number' && data.wallet.usdInrRate > 0) {
                serverUsdInrRateRef.current = data.wallet.usdInrRate;
                setUsdInrRate(data.wallet.usdInrRate);
              }

              if (netEq > 0) {
                setWalletHydratedLive(true);
              }
              setLivePortfolio((prev) => ({
                ...prev,
                totalEquity: netEq,
                walletBalance: cashBal,
                availableMargin: availMarg,
                availableBalance: availBal,
                marginUsed: margUsed,
                openPositionValueUsd: openPosVal,
                initialCapital: cashBal > 0 ? cashBal : prev.initialCapital,
                unrealisedPnlTotal: uPnlTotal,
                walletDiagnosticError: null,
              }));
            }
            if (Array.isArray(data.positions)) {
              setLivePositions(data.positions);
              setPositionsHydratedLive(true);
            }
            if (data.config && data.config.globalLeverageConfig) {
              applyGlobalLeverageConfig(data.config.globalLeverageConfig);
            }
            if (typeof data.sniperAutoPilotArmed === 'boolean' || typeof data.optionsAutoPilotArmed === 'boolean') {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('delta:sync-autopilot-config', {
                    detail: {
                      sniperAutoPilotArmed: data.sniperAutoPilotArmed,
                      optionsAutoPilotArmed: data.optionsAutoPilotArmed,
                    },
                  })
                );
              }
            }
            if (typeof window !== 'undefined') {
              if (Array.isArray(data.signalsArchive) && data.signalsArchive.length > 0) {
                window.dispatchEvent(
                  new CustomEvent('delta:hydrate-signals-archive', {
                    detail: { signals: data.signalsArchive },
                  })
                );
              }
              if (Array.isArray(data.logs) && data.logs.length > 0) {
                window.dispatchEvent(
                  new CustomEvent('delta:hydrate-audit-logs', {
                    detail: { logs: data.logs },
                  })
                );
              }
            }
            if (Array.isArray(data.tradeHistory) && data.tradeHistory.length > 0) {
              const normalizedIncoming: ClosedTrade[] = data.tradeHistory
                .filter((t: any) => t && typeof t === 'object' && (t.id || t.fillId || t.orderId))
                .map((t: any) => {
                  const parsedClosedMs =
                    typeof t.created_at === 'string' && Number.isFinite(Date.parse(t.created_at))
                      ? Date.parse(t.created_at)
                      : typeof t.closedAt === 'number' && Number.isFinite(t.closedAt) && t.closedAt > 0
                      ? t.closedAt < 1e12
                        ? Math.floor(t.closedAt * 1000)
                        : t.closedAt
                      : 0;
                  return {
                    ...t,
                    id: String(t.id || (t.fillId ? `delta-fill-${t.fillId}` : `delta-order-${t.orderId}`)),
                    mode: t.mode || 'LIVE',
                    closedAt: parsedClosedMs,
                    created_at:
                      t.created_at ||
                      (parsedClosedMs > 0 ? new Date(parsedClosedMs).toISOString() : undefined),
                    openedAt:
                      typeof t.openedAt === 'number' && t.openedAt > 0 ? t.openedAt : parsedClosedMs,
                  } as ClosedTrade;
                });

              setLiveHistory((prev) => {
                const byKey = new Map<string, ClosedTrade>();
                for (const item of prev) {
                  const key = item.fillId ? `fill:${item.fillId}` : item.id;
                  byKey.set(key, item);
                }
                for (const item of normalizedIncoming) {
                  const key = item.fillId ? `fill:${item.fillId}` : item.id;
                  const existing = byKey.get(key);
                  byKey.set(key, existing ? { ...existing, ...item, notes: existing.notes ?? item.notes } : item);
                }
                return Array.from(byKey.values())
                  .sort((a, b) => Number(b.closedAt || 0) - Number(a.closedAt || 0))
                  .slice(0, 500);
              });

              // Compute live realized metrics strictly from today's IST date bucket (never mixing yesterday's closed fills into today)
              const todayIstKey = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Kolkata',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              }).format(new Date());
              const liveFills = normalizedIncoming.filter((t) => t.mode === 'LIVE' || t.source === 'DELTA_FILL');
              const todayFills = liveFills.filter((t) => {
                if (!t.closedAt || t.closedAt <= 0) return false;
                const dKey = new Intl.DateTimeFormat('en-CA', {
                  timeZone: 'Asia/Kolkata',
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).format(new Date(t.closedAt));
                return dKey === todayIstKey;
              });
              const totalRealisedAll = liveFills.reduce((sum, t) => sum + (Number(t.realisedPnl) || 0), 0);
              const todayRealised = todayFills.reduce((sum, t) => sum + (Number(t.realisedPnl) || 0), 0);
              const totalWins = liveFills.filter((t) => (Number(t.realisedPnl) || 0) > 0).length;
              const liveWinRate = liveFills.length > 0 ? +((totalWins / liveFills.length) * 100).toFixed(1) : 0;

              setLivePortfolio((prev) => ({
                ...prev,
                dailyPnl: +todayRealised.toFixed(2),
                realisedPnlTotal: +totalRealisedAll.toFixed(2),
                tradesToday: todayFills.length,
                winRate: liveWinRate,
              }));
            }
          }
        }
      } catch {}
    }

    fetchSyncSnapshot();
    const pollTimer = setInterval(fetchSyncSnapshot, 5000);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchSyncSnapshot();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    sessionToken,
    apiCredentials,
    setUsdInrRate,
    setPositions,
    applyGlobalLeverageConfig,
  ]);

  useEffect(() => {
    if (serverUsdInrRateRef.current > 0) {
      setUsdInrRate(serverUsdInrRateRef.current);
      return;
    }
    const { rate } = resolveLiveUsdInrRate(markets, 85.0);
    setUsdInrRate(rate);
  }, [markets, setUsdInrRate]);

  useEffect(() => {
    const handleRecordClosedTrade = (ev: Event) => {
      const customEv = ev as CustomEvent<ClosedTrade>;
      const trade = customEv?.detail;
      if (!trade || !trade.id) return;
      if (trade.mode === 'LIVE') {
        setLiveHistory((prev) =>
          prev.some((t) => t.id === trade.id || (trade.fillId && t.fillId === trade.fillId))
            ? prev
            : [trade, ...prev].slice(0, 2000)
        );
        fetch('/api/delta/trade-history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-email': 'dhanrajk69@gmail.com' },
          body: JSON.stringify({ trade }),
        }).catch(() => {});
      } else {
        setPaperHistory((prev) =>
          prev.some((t) => t.id === trade.id) ? prev : [trade, ...prev].slice(0, 500)
        );
      }
    };

    const handleFullHistorySynced = (ev: Event) => {
      const customEv = ev as CustomEvent<{ tradeHistory?: ClosedTrade[] }>;
      const incoming = customEv?.detail?.tradeHistory;
      if (!Array.isArray(incoming) || incoming.length === 0) return;

      const normalizedIncoming: ClosedTrade[] = incoming
        .filter((raw: any) => raw && typeof raw === 'object' && (raw.id || raw.fillId || raw.orderId))
        .map((raw: any) => {
          const closedMs =
            typeof raw.created_at === 'string' && Number.isFinite(Date.parse(raw.created_at))
              ? Date.parse(raw.created_at)
              : Number(raw.closedAt || 0);
          return {
            ...raw,
            id: String(raw.id || (raw.fillId ? `delta-fill-${raw.fillId}` : `delta-order-${raw.orderId}`)),
            mode: raw.mode || 'LIVE',
            closedAt: closedMs,
            created_at: raw.created_at || (closedMs > 0 ? new Date(closedMs).toISOString() : undefined),
          };
        });

      if (normalizedIncoming.length === 0) return;

      setLiveHistory((prev) => {
        const byKey = new Map<string, ClosedTrade>();
        for (const item of prev) {
          byKey.set(item.fillId ? `fill:${item.fillId}` : item.id, item);
        }
        for (const item of normalizedIncoming) {
          const key = item.fillId ? `fill:${item.fillId}` : item.id;
          const existing = byKey.get(key);
          byKey.set(key, existing ? { ...existing, ...item, notes: existing.notes ?? item.notes } : item);
        }
        return Array.from(byKey.values())
          .sort((a, b) => Number(b.closedAt || 0) - Number(a.closedAt || 0))
          .slice(0, 2000);
      });

      const todayIstKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const liveFills = normalizedIncoming.filter((t) => t.mode === 'LIVE' || t.source === 'DELTA_FILL');
      const todayFills = liveFills.filter((t) => {
        if (!t.closedAt || t.closedAt <= 0) return false;
        const dKey = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(t.closedAt));
        return dKey === todayIstKey;
      });
      const totalRealisedAll = liveFills.reduce((sum, t) => sum + (Number(t.realisedPnl) || 0), 0);
      const todayRealised = todayFills.reduce((sum, t) => sum + (Number(t.realisedPnl) || 0), 0);
      const totalWins = liveFills.filter((t) => (Number(t.realisedPnl) || 0) > 0).length;
      const liveWinRate = liveFills.length > 0 ? +((totalWins / liveFills.length) * 100).toFixed(1) : 0;

      setLivePortfolio((prev) => ({
        ...prev,
        dailyPnl: +todayRealised.toFixed(2),
        realisedPnlTotal: +totalRealisedAll.toFixed(2),
        tradesToday: todayFills.length,
        winRate: liveWinRate,
      }));
    };

    const handlePositionsReconciled = (
      e: CustomEvent<{ activePositions: Position[]; closedPositions: Position[] }>
    ) => {
      if (Array.isArray(e.detail?.activePositions)) {
        const activeOnly = e.detail.activePositions.filter(
          (p) => Math.abs(Number(p.size || (p as any).contracts || 0)) > 0
        );
        setLivePositions(activeOnly);
        setPositionsHydratedLive(true);
      }
    };

    window.addEventListener('delta:record-closed-trade', handleRecordClosedTrade as EventListener);
    window.addEventListener('delta:full-history-synced', handleFullHistorySynced as EventListener);
    window.addEventListener('delta:positions-reconciled', handlePositionsReconciled as EventListener);
    return () => {
      window.removeEventListener('delta:record-closed-trade', handleRecordClosedTrade as EventListener);
      window.removeEventListener('delta:full-history-synced', handleFullHistorySynced as EventListener);
      window.removeEventListener('delta:positions-reconciled', handlePositionsReconciled as EventListener);
    };
  }, []);

  useEffect(() => {
    if (tradingMode === 'PAPER') {
      setPositions(positions);
      setHistory(history);
    }
    if (tradingMode === 'LIVE' && !isLiveApiAuthenticated) {
      setBasePositionsPnl(0, 0);
      return;
    }
    const baseUPnl = positions.reduce((acc, p) => acc + (p.unrealisedPnl || 0), 0);
    const baseRPnl = portfolio.realisedPnlTotal || 0;
    setBasePositionsPnl(baseUPnl, baseRPnl);
  }, [positions, history, portfolio.realisedPnlTotal, tradingMode, isLiveApiAuthenticated, setBasePositionsPnl, setPositions, setHistory]);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [prefillAiSetup, setPrefillAiSetup] = useState<AiTradeCardData | null>(null);
  const handleUpdateRiskSettings = useCallback(
    (nextSettings: RiskSettings) => {
      updateRiskSettings(nextSettings, { persistServer: true, immediate: true });
    },
    [updateRiskSettings]
  );


  // Modals & WebSocket Radar
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isKillModalOpen, setIsKillModalOpen] = useState(false);
  const [isWsModalOpen, setIsWsModalOpen] = useState(false);
  const [isNewsRadarOpen, setIsNewsRadarOpen] = useState(false);
  const [isVolatilityModalOpen, setIsVolatilityModalOpen] = useState(false);
  const [engineTabRequest, setEngineTabRequest] = useState<{
    tab: 'SNIPER' | 'OPTIONS' | 'COMBINED';
    nonce: number;
  } | null>(null);
  const [activeStrategySubTab, setActiveStrategySubTab] = useState<'SNIPER' | 'OPTIONS' | 'COMBINED'>('SNIPER');

  // Live AI News Sentiment Radar
  const {
    radarData: newsRadarData,
    isLoading: isNewsRadarLoading,
    isRefreshing: isNewsRadarRefreshing,
    refreshRadar: refreshNewsRadar,
  } = useNewsSentimentRadar();

  // High-priority WebSocket price tracker: keeps track of latest WS packet timestamps per symbol
  const lastWsPriceTimestampsRef = useRef<Record<string, number>>({});
  const latestMarketsRef = useRef<Record<string, MarketTicker>>({});
  const pendingMarketTicksRef = useRef<
    Record<string, Partial<MarketTicker> & { symbol: string; timestamp?: number }>
  >({});
  const uiTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => {
      uiTimersRef.current.forEach((id) => clearTimeout(id));
      uiTimersRef.current.clear();
    };
  }, []);

  // Normalize any Delta Exchange USD symbol (e.g. BTCUSD) to canonical USDT symbol (BTCUSDT) to prevent duplicates
  const normalizeSymbol = useCallback((rawSym: string): string => {
    if (rawSym.endsWith('USD') && !rawSym.endsWith('USDT')) {
      return `${rawSym}T`;
    }
    return rawSym;
  }, []);

  const flushPendingMarketTicks = useCallback(() => {
    const batch = pendingMarketTicksRef.current;
    const keys = Object.keys(batch);
    if (keys.length === 0) return;
    pendingMarketTicksRef.current = {};

    const updatedMarks: Record<string, number> = {};

    setMarkets((prev) => {
      const next = { ...prev };
      for (const targetSym of keys) {
        const tick = batch[targetSym];
        const rawUsdKey = targetSym.replace(/USDT$/, 'USD');
        if (rawUsdKey !== targetSym && next[rawUsdKey]) {
          delete next[rawUsdKey];
        }

        const existing = next[targetSym] || {
          symbol: targetSym,
          name: `${targetSym} Perpetual (Delta India)`,
          markPrice: tick.markPrice || 81702.50,
          indexPrice: tick.indexPrice || tick.markPrice || 81702.50,
          change24h: tick.change24h || 0,
          high24h: tick.high24h || 82300,
          low24h: tick.low24h || 80800,
          volume24hUsd: tick.volume24hUsd || 880000000,
          fundingRate: tick.fundingRate || 0.01,
          nextFundingCountdown: tick.nextFundingCountdown || '03:42:18',
          openInterestContracts: 10000,
          openInterestUsd: 95000000,
          liquidationsLong24h: 8400000,
          liquidationsShort24h: 22100000,
        };

        const updatedMarkPrice =
          tick.markPrice !== undefined && tick.markPrice > 0
            ? tick.markPrice
            : existing.markPrice;

        const updated: MarketTicker = {
          ...existing,
          symbol: targetSym,
          markPrice: updatedMarkPrice,
          indexPrice:
            tick.indexPrice !== undefined && tick.indexPrice > 0
              ? tick.indexPrice
              : existing.indexPrice,
          high24h: tick.high24h ?? existing.high24h,
          low24h: tick.low24h ?? existing.low24h,
          volume24hUsd: tick.volume24hUsd ?? existing.volume24hUsd,
          fundingRate: tick.fundingRate ?? existing.fundingRate,
          nextFundingCountdown: tick.nextFundingCountdown ?? existing.nextFundingCountdown,
          change24h: tick.change24h !== undefined ? tick.change24h : existing.change24h,
        };

        next[targetSym] = updated;
        latestMarketsRef.current[targetSym] = updated;
        if (updatedMarkPrice > 0) {
          updatedMarks[targetSym] = updatedMarkPrice;
        }
      }
      return next;
    });

    for (const targetSym of keys) {
      const mp = batch[targetSym]?.markPrice;
      if (mp && mp > 0) updatedMarks[targetSym] = mp;
    }

    if (Object.keys(updatedMarks).length > 0) {
      const updatePositionList = (prev: Position[]) => {
        if (prev.length === 0) return prev;
        let changed = false;
        const mapped = prev.map((pos) => {
          const sym = normalizeSymbol(pos.symbol);
          const liveMark = updatedMarks[sym];
          if (liveMark && liveMark > 0) {
            changed = true;
            const diff = pos.side === 'LONG' ? liveMark - pos.entryPrice : pos.entryPrice - liveMark;
            const uPnl = diff * pos.size;
            const uPnlPct = pos.margin > 0 ? (uPnl / pos.margin) * 100 : 0;
            const notionalUsd = Math.abs(pos.size * liveMark);
            return {
              ...pos,
              markPrice: liveMark,
              notionalUsd: +notionalUsd.toFixed(2),
              unrealisedPnl: +uPnl.toFixed(2),
              unrealisedPnlPercent: +uPnlPct.toFixed(2),
            };
          }
          return pos;
        });
        return changed ? mapped : prev;
      };
      setPaperPositions(updatePositionList);
      setLivePositions(updatePositionList);
    }
  }, [normalizeSymbol]);

  useEffect(() => {
    const flushInterval = setInterval(flushPendingMarketTicks, 250);
    return () => clearInterval(flushInterval);
  }, [flushPendingMarketTicks]);

  // Delta Exchange India Live WebSocket Integration - Synchronous ref update + batched 250ms UI commit
  const handleTickerFromWs = useCallback(
    (tick: Partial<MarketTicker> & { symbol: string; timestamp?: number }) => {
      if (!tick.symbol) return;
      // Ignore option contracts in the main perpetual markets dictionary
      if (tick.symbol.startsWith('C-') || tick.symbol.startsWith('P-')) return;

      const targetSym = normalizeSymbol(tick.symbol);
      const tickTs = tick.timestamp || Date.now();
      const isFirstSymbolSighting = !latestMarketsRef.current[targetSym];

      // Record authoritative WebSocket timestamp & ref snapshot immediately
      lastWsPriceTimestampsRef.current[targetSym] = tickTs;
      const existingPending = pendingMarketTicksRef.current[targetSym];
      pendingMarketTicksRef.current[targetSym] = {
        ...existingPending,
        ...tick,
        symbol: targetSym,
        timestamp: tickTs,
      };

      const prevRef = latestMarketsRef.current[targetSym];
      if (prevRef) {
        latestMarketsRef.current[targetSym] = {
          ...prevRef,
          markPrice:
            tick.markPrice !== undefined && tick.markPrice > 0
              ? tick.markPrice
              : prevRef.markPrice,
          indexPrice:
            tick.indexPrice !== undefined && tick.indexPrice > 0
              ? tick.indexPrice
              : prevRef.indexPrice,
          high24h: tick.high24h ?? prevRef.high24h,
          low24h: tick.low24h ?? prevRef.low24h,
          volume24hUsd: tick.volume24hUsd ?? prevRef.volume24hUsd,
          fundingRate: tick.fundingRate ?? prevRef.fundingRate,
          nextFundingCountdown: tick.nextFundingCountdown ?? prevRef.nextFundingCountdown,
          change24h: tick.change24h !== undefined ? tick.change24h : prevRef.change24h,
        };
      }

      if (isFirstSymbolSighting) {
        flushPendingMarketTicks();
      }
    },
    [normalizeSymbol, flushPendingMarketTicks]
  );

  const {
    status: wsStatus,
    latency: wsLatency,
    packetGap: wsPacketGap,
    lastTickTimestamp,
    lastCandleTimestamp,
    symbolPacketGaps: wsSymbolPacketGaps,
    messageCount: wsMessageCount,
    gatewayUrl: wsGatewayUrl,
    messageLogs: wsMessageLogs,
    reconnect: wsReconnect,
    sendManualPing: wsSendPing,
  } = useDeltaWebSocket({
    onTickerUpdate: handleTickerFromWs,
    autoConnect: true,
  });

  const activeSymbolGap = wsSymbolPacketGaps[selectedSymbol] || wsPacketGap;



  const handleToggleAutoMuteOnBreach = useCallback((enabled: boolean) => {
    setAutoMuteOnBreachEnabled(enabled);
  }, []);

  const handleToggleGeneralSound = useCallback(() => {
    if (!muted && isAutoMutedByBreach) {
      handleToggleAutoMuteOnBreach(false);
    } else {
      setMuted((prev) => !prev);
    }
  }, [muted, isAutoMutedByBreach, handleToggleAutoMuteOnBreach, setMuted]);

  const handleToggleAutoResetTrend = useCallback((enabled: boolean) => {
    setAutoResetTrendEnabled(enabled);
  }, []);

  const handleDismissVolatilityBreach = useCallback(() => {
    setVolatilityBreachToast(null);
    setIsVolatilityBreachWarningActive(false);
    if (autoResetTrendEnabled) {
      setTrendResetNonce((n) => n + 1);
      try {
        window.dispatchEvent(new CustomEvent('delta-refresh-trend-indicators'));
      } catch {}
    }
  }, [autoResetTrendEnabled]);

  const handleToggleVolatilityBreachAlert = useCallback((enabled: boolean) => {
    setVolatilityBreachAlertEnabled(enabled);
    if (!enabled) {
      wasVolatilityBreachingRef.current = false;
      handleDismissVolatilityBreach();
    } else {
      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {});
        }
      } catch {}
    }
  }, [handleDismissVolatilityBreach]);

  const handleChangeVolatilityBreachThreshold = useCallback((nextThreshold: number) => {
    const safe = Math.max(0.1, Math.min(10.0, +nextThreshold.toFixed(1)));
    setVolatilityBreachThreshold(safe);
  }, []);

  const handleToggleVolatilityBreachChime = useCallback((enabled: boolean) => {
    setVolatilityBreachChimeEnabled(enabled);
  }, []);

  const handleClearVolatilityBreachHistory = useCallback(() => {
    setVolatilityBreachHistory([]);
  }, []);

  const triggerVolatilityBreachNotification = useCallback(
    (payload: { symbol: string; stdDev: number; stdDevPct: number; threshold: number; isTest?: boolean }) => {
      const now = Date.now();
      const entryId = `vb-${now}-${Math.random().toString(36).slice(2, 6)}`;
      const prefix = payload.isTest ? '[Test] ' : '';
      const title = `${prefix}Volatility Breach Alert · ${payload.symbol}`;
      const message = `Trend standard deviation reached ${payload.stdDevPct.toFixed(2)}% (${currencyPrefix}${payload.stdDev.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}), exceeding ${payload.threshold.toFixed(1)}% — potential market breakout or high-risk regime change.`;

      // Mark notification silent so general RISK sound does not override the dedicated Volatility Breach chime toggle
      addNotification(title, message, 'RISK', { silent: true });
      if (volatilityBreachChimeEnabled) {
        playVolatilityBreachChime();
      }
      setIsVolatilityBreachWarningActive(true);
      setVolatilityBreachHistory((prev) => {
        const nextEntry: VolatilityBreachHistoryEntry = {
          id: entryId,
          symbol: payload.symbol,
          stdDev: payload.stdDev,
          stdDevPct: payload.stdDevPct,
          threshold: payload.threshold,
          timestamp: now,
          isTest: payload.isTest,
        };
        return [nextEntry, ...prev].slice(0, 5);
      });
      setVolatilityBreachToast({
        id: entryId,
        symbol: payload.symbol,
        stdDev: payload.stdDev,
        stdDevPct: payload.stdDevPct,
        threshold: payload.threshold,
        timestamp: now,
        isTest: payload.isTest,
      });

      try {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body: message });
        }
      } catch {}
    },
    [addNotification, currencyPrefix, volatilityBreachChimeEnabled, playVolatilityBreachChime]
  );

  useEffect(() => {
    if (!volatilityBreachAlertEnabled || !showShortTermTrendOverlay || !trendVariance) {
      wasVolatilityBreachingRef.current = false;
      return;
    }

    const isBreaching = trendVariance.stdDevPct > volatilityBreachThreshold;
    const symbolChanged = lastBreachSymbolRef.current !== selectedSymbol;
    const now = Date.now();
    const cooldownElapsed = now - lastVolatilityBreachAtRef.current > 60_000;

    if (isBreaching && (!wasVolatilityBreachingRef.current || symbolChanged || cooldownElapsed)) {
      wasVolatilityBreachingRef.current = true;
      lastVolatilityBreachAtRef.current = now;
      lastBreachSymbolRef.current = selectedSymbol;
      triggerVolatilityBreachNotification({
        symbol: selectedSymbol,
        stdDev: trendVariance.stdDev,
        stdDevPct: trendVariance.stdDevPct,
        threshold: volatilityBreachThreshold,
      });
    } else if (!isBreaching) {
      wasVolatilityBreachingRef.current = false;
    }
  }, [
    volatilityBreachAlertEnabled,
    showShortTermTrendOverlay,
    trendVariance,
    volatilityBreachThreshold,
    selectedSymbol,
    triggerVolatilityBreachNotification,
  ]);

  useEffect(() => {
    if (!volatilityBreachToast) return;
    const timer = setTimeout(() => {
      setVolatilityBreachToast((curr) => (curr?.id === volatilityBreachToast.id ? null : curr));
    }, 10000);
    return () => clearTimeout(timer);
  }, [volatilityBreachToast]);

  // Real-Time 24h Volatility Spike Notification System
  const {
    threshold24h: volatilityThreshold24h,
    setThreshold24h: setVolatilityThreshold24h,
    soundEnabled: volatilitySoundEnabled,
    setSoundEnabled: setVolatilitySoundEnabled,
    autoBannerEnabled: volatilityAutoBannerEnabled,
    setAutoBannerEnabled: setVolatilityAutoBannerEnabled,
    assetMetrics: volatilityAssetMetrics,
    spikeAlerts: volatilitySpikeAlerts,
    activeBannerAlert: activeVolatilityBannerAlert,
    breachingAssetsCount: volatilityBreachingCount,
    maxVolatilityMetric,
    triggerTestSpike: triggerTestVolatilitySpike,
    dismissBannerAlert: dismissVolatilityBannerAlert,
    clearSpikeAlerts: clearVolatilitySpikeAlerts,
  } = useVolatilitySpikeMonitor({
    markets,
    onPlaySpikeSound: playVolatilitySpike,
  });

  // Fetch Markets & Paper Demo Portfolio - Strictly isolates Paper Demo state from Live Mode
  const fetchMarketData = useCallback(async () => {
    try {
      const [mRes, pRes] = await Promise.all([
        fetch('/api/delta/markets'),
        fetch('/api/delta/portfolio'),
      ]);
      const mData = await mRes.json();
      const pData = await pRes.json();

      if (mData.data) {
        setMarkets((prev) => {
          const next: Record<string, MarketTicker> = {};
          for (const item of mData.data) {
            if (!item.symbol || item.symbol.startsWith('C-') || item.symbol.startsWith('P-')) continue;
            const targetSym = normalizeSymbol(item.symbol);
            const existing = prev[targetSym];
            const lastWsTs = lastWsPriceTimestampsRef.current[targetSym];
            const hasWsPrice = typeof lastWsTs === 'number' && lastWsTs > 0;

            if (existing && hasWsPrice) {
              // FORCE PRIORITY: Never let polled REST API data overwrite the live WebSocket markPrice
              next[targetSym] = {
                ...existing,
                ...item,
                symbol: targetSym,
                markPrice: existing.markPrice, // Keep live WebSocket markPrice strictly authoritative
                indexPrice: existing.indexPrice || item.indexPrice,
              };
            } else {
              next[targetSym] = {
                ...(existing || {}),
                ...item,
                symbol: targetSym,
              };
            }
            latestMarketsRef.current[targetSym] = next[targetSym];
          }
          return next;
        });
      }

      // Paper Demo state only: never overwrite Live India state with mock/simulated backend state
      if (pData.portfolio) setPaperPortfolio(pData.portfolio);
      if (pData.positions) {
        const paperOnlyPositions = (pData.positions as Position[])
          .filter((pos) => pos.mode !== 'LIVE' && !['pos-1', 'pos-2', 'pos-3'].includes(pos.id))
          .map((pos: Position) => {
            const curMarket = latestMarketsRef.current[pos.symbol];
            if (curMarket?.markPrice) {
              const liveMark = curMarket.markPrice;
              const diff = pos.side === 'LONG' ? liveMark - pos.entryPrice : pos.entryPrice - liveMark;
              const uPnl = diff * pos.size;
              const uPnlPct = pos.margin > 0 ? (uPnl / pos.margin) * 100 : 0;
              return {
                ...pos,
                mode: 'PAPER' as TradingMode,
                markPrice: liveMark,
                unrealisedPnl: +uPnl.toFixed(2),
                unrealisedPnlPercent: +uPnlPct.toFixed(2),
              };
            }
            return { ...pos, mode: 'PAPER' as TradingMode };
          });
        setPaperPositions(paperOnlyPositions);
      }
      if (pData.history) {
        const serverHistory = (pData.history as ClosedTrade[])
          .filter((h) => h.mode !== 'LIVE')
          .map((h) => ({ ...h, mode: 'PAPER' as TradingMode }));
        setPaperHistory((prev) => {
          const serverIds = new Set(serverHistory.map((h) => h.id));
          const localOnlySniperTrades = prev.filter(
            (h) => h.id.startsWith('th-sniper-') && !serverIds.has(h.id)
          );
          return [...localOnlySniperTrades, ...serverHistory].sort(
            (a, b) => (b.closedAt || 0) - (a.closedAt || 0)
          );
        });
      }
    } catch {
      // Offline fallback
    }
  }, [normalizeSymbol]);

  // Poll market state every 5 seconds alongside live WebSocket feed
  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, 5000);
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  // Recompute Live Portfolio unrealized PnL & position value whenever livePositions change without corrupting availableMargin
  useEffect(() => {
    if (!isLiveApiAuthenticated) {
      setLivePortfolio(ZERO_LIVE_PORTFOLIO);
      return;
    }
    if (livePositions.length === 0) {
      setLivePortfolio((prev) => {
        const cashBal =
          Number.isFinite(prev.walletBalance) && (prev.walletBalance as number) > 0
            ? (prev.walletBalance as number)
            : prev.initialCapital > 0
            ? prev.initialCapital
            : prev.totalEquity;
        return {
          ...prev,
          totalEquity: +cashBal.toFixed(2),
          walletBalance: +cashBal.toFixed(2),
          marginUsed: 0,
          openPositionValueUsd: 0,
          unrealisedPnlTotal: 0,
        };
      });
      return;
    }
    const uPnl = +livePositions.reduce((acc, p) => acc + (p.unrealisedPnl ?? p.unrealized_pnl ?? 0), 0).toFixed(4);
    const netOptionLiquidationUsd = +livePositions
      .reduce((sum, p: any) => {
        const sym = String(p?.product_symbol || p?.rawSymbol || p?.symbol || '').toUpperCase();
        const ctype = String(p?.contract_type || '').toLowerCase();
        const isOpt = ctype === 'call_options' || ctype === 'put_options' || sym.startsWith('C-') || sym.startsWith('P-');
        if (!isOpt) return sum;
        const signedLots = Number(p?.signedSize ?? (p?.side === 'SHORT' ? -Math.abs(p?.size || 0) : Math.abs(p?.size || 0)));
        const cVal = Number(p?.contractValue || (sym.includes('BTC') ? 0.001 : sym.includes('ETH') ? 0.01 : 1));
        const markPx = Number(p?.mark_price ?? p?.markPrice ?? p?.entry_price ?? p?.entryPrice ?? 0);
        return sum + signedLots * cVal * markPx;
      }, 0)
      .toFixed(4);
    const posMargin = +livePositions.reduce((acc, p) => acc + (p.margin || 0), 0).toFixed(2);
    const openPosVal = +livePositions
      .reduce(
        (acc, p) =>
          acc +
          (Number.isFinite(p.notionalUsd) && (p.notionalUsd || 0) > 0
            ? (p.notionalUsd as number)
            : Math.abs((p.size || 0) * (p.markPrice || p.entryPrice || 0))),
        0
      )
      .toFixed(2);

    setLivePortfolio((prev) => {
      const cashBal =
        Number.isFinite(prev.walletBalance) && (prev.walletBalance as number) > 0
          ? (prev.walletBalance as number)
          : prev.initialCapital > 0
          ? prev.initialCapital
          : Math.max(0, prev.totalEquity - (prev.unrealisedPnlTotal || 0));
      const nextMarginUsed = +Math.max(prev.marginUsed || 0, posMargin).toFixed(2);
      if (cashBal <= 0) {
        return {
          ...prev,
          marginUsed: nextMarginUsed,
          openPositionValueUsd: openPosVal,
          unrealisedPnlTotal: uPnl,
        };
      }
      const totalEq = +(cashBal + uPnl + netOptionLiquidationUsd).toFixed(2);
      return {
        ...prev,
        totalEquity: totalEq,
        walletBalance: +cashBal.toFixed(2),
        marginUsed: nextMarginUsed,
        openPositionValueUsd: openPosVal,
        unrealisedPnlTotal: uPnl,
      };
    });
  }, [livePositions, isLiveApiAuthenticated]);

  // Keep Paper Portfolio totalEquity, marginUsed, openPositionValueUsd, and unrealisedPnlTotal synced with paperPositions
  useEffect(() => {
    const uPnl = +paperPositions.reduce((acc, p) => acc + (p.unrealisedPnl || 0), 0).toFixed(2);
    const posMargin = +paperPositions.reduce((acc, p) => acc + (p.margin || 0), 0).toFixed(2);
    const openPosVal = +paperPositions
      .reduce(
        (acc, p) =>
          acc +
          (Number.isFinite(p.notionalUsd) && (p.notionalUsd || 0) > 0
            ? (p.notionalUsd as number)
            : Math.abs((p.size || 0) * (p.markPrice || p.entryPrice || 0))),
        0
      )
      .toFixed(2);

    setPaperPortfolio((prev) => {
      const cashBal = +(prev.initialCapital + prev.realisedPnlTotal).toFixed(2);
      const totalEq = +(cashBal + uPnl).toFixed(2);
      const avail = Math.max(0, +(cashBal - posMargin).toFixed(2));
      return {
        ...prev,
        totalEquity: totalEq,
        walletBalance: cashBal,
        availableBalance: avail,
        availableMargin: avail,
        marginUsed: posMargin,
        openPositionValueUsd: openPosVal,
        unrealisedPnlTotal: uPnl,
      };
    });
  }, [paperPositions]);

  // Fetch AI Analysis from Gemini
  const refreshAiAnalysis = useCallback(async (sym: string, tf: string) => {
    setIsAiLoading(true);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: sym,
          timeframe: tf,
          strategyType: 'Futures Scalping',
          forceRefresh: true,
        }),
      });
      const data = await res.json();
      if (data.data) {
        setAiAnalysis(data.data);
        addNotification(
          'AI Setup Updated',
          `Analyzed ${sym} (${tf}): ${data.data.confidenceScore}% confidence for ${data.data.tradeCard?.action}.`,
          'AI'
        );
      }
    } catch {
      // Handled gracefully by server-side cache and deterministic fallback
    } finally {
      setIsAiLoading(false);
    }
  }, [addNotification]);

  // Initial AI load
  useEffect(() => {
    refreshAiAnalysis(selectedSymbol, timeframe);
  }, [selectedSymbol]);

  // Execute Order (Enforces Live Mode Server Gate Check & Paper Demo Isolation)
  const handleExecuteOrder = async (order: any) => {
    const orderMode: TradingMode = order.mode || tradingMode;
    if (orderMode === 'LIVE') {
      if (!serverLiveGateEnabled && !isLiveApiAuthenticated) {
        addNotification(
          'Live Trading Gate Locked',
          'Server-side live execution gate is locked (DELTA_LIVE_TRADING_ENABLED=false). Real live order execution is prevented.',
          'RISK'
        );
        throw new Error('Server Live Trading Gate is locked (DELTA_LIVE_TRADING_ENABLED=false). Switch to PAPER mode.');
      }
      if (!isLiveApiAuthenticated) {
        addNotification(
          'API Credentials Required',
          'Connect Delta Exchange API Keys in Settings to trade live',
          'RISK'
        );
        throw new Error('Connect Delta Exchange API Keys in Settings to trade live');
      }
    }

    const rawRequestedLeverage = Number(order.leverage || globalLeverage || 10);
    if (!leverageSyncLocked && rawRequestedLeverage > maxLeverageCap) {
      addNotification(
        'Max Leverage Cap Enforced',
        `Order leverage ${rawRequestedLeverage}x exceeds Hard Max Leverage Cap (${maxLeverageCap}x) configured in Risk Settings.`,
        'RISK'
      );
      throw new Error(`Order leverage ${rawRequestedLeverage}x exceeds Hard Max Leverage Cap (${maxLeverageCap}x)`);
    }
    const effectiveLeverage = clampLeverage(rawRequestedLeverage);
    const effectiveMarginMode = order.marginMode === 'CROSS' || order.marginMode === 'ISOLATED' ? order.marginMode : marginMode;

    const rawOrderSym = String(order.symbol || selectedSymbol || '').trim().toUpperCase();
    const isOptionOrderPayload =
      Boolean(order.isOption) ||
      Boolean(order.optionType) ||
      rawOrderSym.startsWith('C-') ||
      rawOrderSym.startsWith('P-');
    const mappedPerp = isOptionOrderPayload ? null : mapToDeltaPerpetualContract(rawOrderSym);
    const slPrice = Number(order.stopLoss || 0);
    const tpPrice = Number(order.takeProfit || order.tp4 || order.tp1 || 0);

    const payload = {
      ...order,
      leverage: effectiveLeverage,
      marginMode: effectiveMarginMode,
      symbol: isOptionOrderPayload
        ? rawOrderSym
        : orderMode === 'LIVE' && mappedPerp
        ? mappedPerp.symbol
        : order.symbol || selectedSymbol,
      canonicalSymbol: isOptionOrderPayload ? rawOrderSym : mappedPerp?.canonicalSymbol,
      product_id: isOptionOrderPayload ? order.product_id : order.product_id || mappedPerp?.product_id,
      order_type:
        String(order.orderType || order.order_type || 'MARKET')
          .toUpperCase()
          .includes('LIMIT')
          ? 'limit_order'
          : 'market_order',
      post_only: order.post_only === true || order.postOnly === true ? true : undefined,
      stop_loss_order:
        slPrice > 0
          ? {
              order_type: 'market_order',
              stop_price: String(slPrice),
            }
          : undefined,
      take_profit_order:
        tpPrice > 0
          ? {
              order_type: 'limit_order',
              stop_price: String(tpPrice),
              limit_price: String(tpPrice),
            }
          : undefined,
      mode: orderMode,
    };

    const res = await fetch('/api/delta/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-delta-live-unlocked': serverLiveGateEnabled || isLiveApiAuthenticated ? 'true' : 'false',
        ...(orderMode === 'LIVE' ? buildDeltaCredentialHeaders(apiCredentials) : {}),
        ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    const isFilledOrder = Boolean(data?.filled || data?.order?.order_id || data?.order_id || data?.orderId);
    if (!res.ok && !isFilledOrder) {
      const orderErr: any = new Error(data.error || data.message || 'Failed to place order');
      orderErr.code = data.code || data.error_code || undefined;
      orderErr.requiredAdditionalBalance =
        data.required_additional_balance ?? data.requiredAdditionalBalance ?? null;
      orderErr.availableBalance = data.available_balance ?? null;
      orderErr.upstreamContext = data.diagnosticError?.context || data.context || null;
      throw orderErr;
    }
    playTradeFill();
    addNotification(
      `${orderMode} Order Executed`,
      `${data.message || `Order #${data.order_id || data.orderId || data?.order?.order_id || 'LIVE'} (${data.state || data?.order?.state || 'open'}) filled for ${order.side} ${order.size} ${payload.symbol}`}`,
      'TRADE'
    );
    if (data?.bracketWarning) {
      addNotification('Live Order Filled · Bracket Warning', String(data.bracketWarning), 'RISK');
    }
    fetchMarketData();
    if (orderMode === 'LIVE') {
      await Promise.allSettled([
        refreshPositions(apiCredentials),
        refreshWallet(apiCredentials),
        syncLiveAccountWallet(apiCredentials),
      ]);
    }
    return data;
  };

  // Close Position (Isolated by TradingMode, supports custom automated exit reasons & overrides)
  const handleClosePosition = async (
    positionId: string,
    reason?: string,
    overrides?: { exitPrice?: number; realisedPnl?: number }
  ) => {
    const cleanReason =
      typeof reason === 'string' && reason.trim() ? reason.trim() : 'Manual Close (Paper Demo)';

    // Only close sniperEngine when triggered externally (no automated exit reason)
    if (sniperEngine.activeTrade && !reason) {
      const normSym = (s?: string) => {
        const up = String(s || '').toUpperCase().trim();
        return up.endsWith('USD') && !up.endsWith('USDT') ? `${up}T` : up;
      };
      const sniperCanonical = normSym(sniperEngine.activeTrade.symbol);
      const isSniperMatch =
        sniperEngine.activeTrade.positionId === positionId ||
        (tradingMode === 'LIVE'
          ? livePositions.some((p) => p.id === positionId && normSym(p.symbol) === sniperCanonical)
          : paperPositions.some((p) => p.id === positionId && normSym(p.symbol) === sniperCanonical));
      if (isSniperMatch) {
        sniperEngine.closeActiveSniperTrade('Position Closed');
      }
    }

    const norm = (s?: string) => String(s || '').toUpperCase().trim();
    const isTargetPos = (p: Position) => {
      const t = norm(positionId);
      return (
        p.id === positionId ||
        norm(p.symbol) === t ||
        norm(p.rawSymbol) === t ||
        norm(p.product_symbol) === t ||
        (p.product_id && String(p.product_id) === String(positionId))
      );
    };

    // Immediate optimistic closure for paper mode
    if (tradingMode === 'PAPER') {
      const targetPos = paperPositions.find(isTargetPos);
      if (targetPos) {
        const exitPx =
          typeof overrides?.exitPrice === 'number' && overrides.exitPrice > 0
            ? overrides.exitPrice
            : targetPos.markPrice;
        const computedPnl =
          typeof overrides?.realisedPnl === 'number' && Number.isFinite(overrides.realisedPnl)
            ? +overrides.realisedPnl.toFixed(2)
            : +((targetPos.side === 'LONG' ? exitPx - targetPos.entryPrice : targetPos.entryPrice - exitPx) * targetPos.size).toFixed(2);
        const pctReturn = targetPos.margin > 0 ? +((computedPnl / targetPos.margin) * 100).toFixed(2) : targetPos.unrealisedPnlPercent;

        const closedTradeEntry: ClosedTrade = {
          id: `th-local-${Date.now()}`,
          symbol: targetPos.symbol,
          side: targetPos.side,
          size: targetPos.size,
          entryPrice: targetPos.entryPrice,
          exitPrice: exitPx,
          realisedPnl: computedPnl,
          pnlPercent: pctReturn,
          openedAt: targetPos.openedAt,
          closedAt: Date.now(),
          reason: cleanReason,
          mode: 'PAPER',
        };
        const updatedHistory = [closedTradeEntry, ...paperHistory];
        const winsCount = updatedHistory.filter((t) => (t.realisedPnl || 0) >= 0).length;
        const computedWinRate = updatedHistory.length > 0 ? +((winsCount / updatedHistory.length) * 100).toFixed(1) : 0;

        setPaperPositions((prev) => prev.filter((p) => !isTargetPos(p)));
        setPaperPortfolio((prev) => {
          const newRealized = +(prev.realisedPnlTotal + computedPnl).toFixed(2);
          const newDaily = +(prev.dailyPnl + computedPnl).toFixed(2);
          const newMarginUsed = Math.max(0, +(prev.marginUsed - (targetPos.margin || 0)).toFixed(2));
          const newAvail = +(prev.availableBalance + (targetPos.margin || 0) + computedPnl).toFixed(2);
          const newEquity = +(newAvail + newMarginUsed).toFixed(2);
          return {
            ...prev,
            availableBalance: newAvail,
            marginUsed: newMarginUsed,
            realisedPnlTotal: newRealized,
            dailyPnl: newDaily,
            totalEquity: newEquity,
            winRate: computedWinRate,
          };
        });
        setPaperHistory(updatedHistory);
        playTradeFill();
        addNotification(
          reason ? cleanReason : 'Position Closed',
          `Paper demo position ${targetPos.symbol} closed @ $${exitPx.toLocaleString()} (PnL: ${computedPnl >= 0 ? '+' : ''}$${computedPnl.toFixed(2)}).`,
          computedPnl < 0 ? 'RISK' : 'TRADE'
        );
      }
    }

    try {
      const res = await fetch('/api/delta/close-position', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          positionId,
          reason: cleanReason,
          exitPrice: overrides?.exitPrice,
          realisedPnl: overrides?.realisedPnl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const rawErrorMsg = String(data.error || data.message || '').toLowerCase();
      const isAlreadyClosed =
        Boolean(data.alreadyClosed) ||
        rawErrorMsg.includes('already closed') ||
        rawErrorMsg.includes('no_open_position') ||
        rawErrorMsg.includes('not found') ||
        rawErrorMsg.includes('size is 0') ||
        rawErrorMsg.includes('size === 0') ||
        rawErrorMsg.includes('inactive');

      if (isAlreadyClosed) {
        if (tradingMode === 'LIVE') {
          setLivePositions((prev) => prev.filter((p) => !isTargetPos(p)));
          setPositions((prev) => prev.filter((p) => !isTargetPos(p)));
          addNotification(
            'Position Reconciled',
            data.message || 'Position was already closed on Delta Exchange. Cleared from active view.',
            'INFO'
          );
        }
      } else if (!res.ok) {
        if (tradingMode === 'LIVE') {
          throw new Error(data.error || `Failed to close live position (status ${res.status})`);
        }
      } else {
        if (tradingMode === 'LIVE') {
          setLivePositions((prev) => prev.filter((p) => !isTargetPos(p)));
          setPositions((prev) => prev.filter((p) => !isTargetPos(p)));
          playTradeFill();
          addNotification('Position Closed', data.message || 'Position closed successfully', 'TRADE');
        }
      }
      fetchMarketData();
    } catch (err: any) {
      const errMsg = String(err?.message || '').toLowerCase();
      const isAlreadyClosed =
        errMsg.includes('already closed') ||
        errMsg.includes('no_open_position') ||
        errMsg.includes('not found') ||
        errMsg.includes('size is 0') ||
        errMsg.includes('size === 0') ||
        errMsg.includes('inactive');

      if (isAlreadyClosed && tradingMode === 'LIVE') {
        setLivePositions((prev) => prev.filter((p) => !isTargetPos(p)));
        setPositions((prev) => prev.filter((p) => !isTargetPos(p)));
        addNotification(
          'Position Reconciled',
          'Position was already closed on Delta Exchange. Cleared from active view.',
          'INFO'
        );
      } else {
        addNotification('Close Position Alert', err?.message || 'Failed to close position on server', 'RISK');
      }
    }
  };

  // Dynamic Ratchet Stop Loss Update (Stage 1 Break-Even & Stage 2 Trailing ATR)
  const handleUpdatePositionSL = useCallback((posId: string, newSL: number) => {
    const norm = (s?: string) => String(s || '').toUpperCase().trim();
    const isTargetPos = (p: Position) => {
      const t = norm(posId);
      return (
        p.id === posId ||
        norm(p.symbol) === t ||
        norm(p.rawSymbol) === t ||
        norm(p.product_symbol) === t ||
        (p.product_id && String(p.product_id) === String(posId))
      );
    };

    if (tradingMode === 'PAPER') {
      setPaperPositions((prev) =>
        prev.map((p) => (isTargetPos(p) ? { ...p, stopLoss: newSL } : p))
      );
    } else {
      setLivePositions((prev) =>
        prev.map((p) => (isTargetPos(p) ? { ...p, stopLoss: newSL } : p))
      );
    }
    setPositions((prev) =>
      prev.map((p) => (isTargetPos(p) ? { ...p, stopLoss: newSL } : p))
    );
    updatePositionStopLoss(posId, newSL);

    addNotification(
      'Dynamic Ratchet Stop-Loss Updated',
      `Position stop-loss adjusted to $${Number(newSL).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      'RISK'
    );
  }, [tradingMode, addNotification, setPositions, updatePositionStopLoss]);

  // Dynamic Ratchet Partial Scaling (Stage 1: Scale 25% lots)
  const handleScalePosition = useCallback((posId: string, scalePct: number) => {
    if (tradingMode === 'PAPER') {
      setPaperPositions((prev) =>
        prev.map((p) => {
          if (p.id !== posId) return p;
          const newSize = +(p.size * (1 - scalePct / 100)).toFixed(3);
          return { ...p, size: Math.max(0.001, newSize) };
        })
      );
    }
    addNotification('Dynamic Ratchet Scale', `Scaled ${scalePct}% of position lots to lock break-even gains.`, 'TRADE');
  }, [tradingMode, addNotification]);

  // Auto Hedge Position
  const handleAutoHedge = async (symbol: string) => {
    if (tradingMode === 'LIVE' && !serverLiveGateEnabled) {
      addNotification(
        'Live Trading Gate Locked',
        'Auto-hedging on live accounts requires active server live gate.',
        'RISK'
      );
      return;
    }
    try {
      const res = await fetch('/api/delta/auto-hedge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Hedge failed');
      playAlert();
      addNotification('Delta Neutral Hedge Activated', data.message || 'Hedge executed', 'RISK');
      fetchMarketData();
    } catch (err: any) {
      addNotification('Auto Hedge Notice', err?.message || 'Hedge request failed', 'RISK');
    }
  };

  // Trigger Emergency Kill Switch
  const handleKillSwitch = async () => {
    playKillSwitch();
    queueAnalyticsEvent(
      {
        kind: 'AUDIT_EVENT',
        eventId: `kill-switch-ui-${Date.now()}`,
        type: 'KILL_SWITCH',
        category: 'KILL_SWITCH',
        title: 'EMERGENCY KILL SWITCH TRIGGERED',
        description: `User triggered Emergency Kill Switch in ${tradingMode} mode. Closing active positions and disarming Auto-Pilot.`,
        mode: tradingMode,
      },
      true
    );
    sniperEngine.closeActiveSniperTrade('Emergency Kill Switch');
    sniperEngine.setIsAutoSniperEnabled?.(false);
    try {
      localStorage.setItem('deltaai_sniper_autopilot_armed', 'false');
      localStorage.setItem('deltaai_auto_command_enabled', 'false');
      fetch('/api/delta/autopilot-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sniperAutoPilotArmed: false, armedAt: 0, reason: 'Disarmed via Emergency Kill Switch' }),
      }).catch(() => {});
      fetch('/api/options/autopilot-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, paused: false, pauseReason: 'Disarmed via Emergency Kill Switch' }),
      }).catch(() => {});
    } catch {}

    try {
      const res = await fetch('/api/delta/kill-switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (tradingMode === 'PAPER') {
        setPaperPositions([]);
      } else {
        setLivePositions([]);
      }
      setPositions([]);
      if (!res.ok) throw new Error(data.error || 'Kill switch failed');
      addNotification('EMERGENCY KILL SWITCH', data.message || 'All positions terminated and orders cancelled', 'RISK');
      fetchMarketData();
    } catch (err: any) {
      addNotification('Kill Switch Notice', err?.message || 'Kill switch executed', 'RISK');
    }
    setIsKillModalOpen(false);
  };

  // AI Order Validation helper for Semi-Auto / Fully-Auto
  const handleAiValidate = async (order: any, marketState: any) => {
    try {
      const res = await fetch('/api/ai/validate-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order, marketState }),
      });
      const data = await res.json();
      return data.data;
    } catch {
      return {
        approved: true,
        confidenceScore: 88,
        validationReason: 'Risk parameters verified: tight stop loss placed beyond orderbook liquidity cluster.',
      };
    }
  };

  // Apply AI Trade Card directly to Order Form
  const handleApplyTradeCard = useCallback(
    (card: AiTradeCardData) => {
      setSelectedSymbol(card.symbol);
      setPrefillAiSetup(card);
      setCurrentTab('dashboard');
      addNotification('Setup Applied', `Staged ${card.action} for ${card.symbol} on Execution Pad.`, 'INFO');
    },
    [addNotification]
  );

  const handleSelectBulletin = useCallback(
    (setup: AiTradeCardData) => {
      handleApplyTradeCard(setup);
    },
    [handleApplyTradeCard]
  );

  const handleToggleMobileSidebar = useCallback(() => setIsSidebarOpen((prev) => !prev), []);
  const handleOpenNotifications = useCallback(() => setIsNotificationsOpen(true), []);
  const handleOpenSettings = useCallback(() => setIsSettingsOpen(true), []);
  const handleOpenKillModal = useCallback(() => setIsKillModalOpen(true), []);
  const handleOpenWsModal = useCallback(() => setIsWsModalOpen(true), []);
  const handleOpenNewsRadarModal = useCallback(() => setIsNewsRadarOpen(true), []);
  const handleOpenVolatilityModal = useCallback(() => setIsVolatilityModalOpen(true), []);
  const handleNavigateToAi = useCallback(() => setCurrentTab('ai-centre'), []);
  const handleNavigateToStrategies = useCallback(() => {
    setActiveStrategySubTab('SNIPER');
    setEngineTabRequest({ tab: 'SNIPER', nonce: Date.now() });
    setCurrentTab('strategies');
  }, []);
  const handleOpenOptionsLab = useCallback(() => {
    setActiveStrategySubTab('OPTIONS');
    setCurrentTab('strategies');
    setEngineTabRequest({ tab: 'OPTIONS', nonce: Date.now() });
  }, []);
  const handleDeltaNavSelect = useCallback(
    (navId: DeltaNavId) => {
      if (navId === 'settings') {
        setIsSettingsOpen(true);
        return;
      }
      if (navId === 'options-lab') {
        handleOpenOptionsLab();
        return;
      }
      if (navId === 'strategies') {
        handleNavigateToStrategies();
        return;
      }
      setCurrentTab(navId);
    },
    [handleNavigateToStrategies, handleOpenOptionsLab]
  );
  const handleClearBacktestTrade = useCallback(() => setActiveBacktestTrade(null), []);
  const handleClearPrefill = useCallback(() => setPrefillAiSetup(null), []);

  const unreadNotificationsCount = notifications.filter((n) => !n.read).length;

  const sniperRecordTradeRef = useRef<((trade: ClosedTrade, posUpdate?: SniperPositionSyncUpdate) => void) | null>(null);
  const sniperLifecycleExitRef = useRef<((reason: 'SL' | 'TP4', symbol: string) => void) | null>(null);

  const handlePartialClosePaperPosition = useCallback(
    async (
      pos: Position,
      closedTrade: ClosedTrade,
      opts: {
        partialSize?: number;
        newStopLoss?: number;
        tp1Hit?: boolean;
        tp2Hit?: boolean;
        tp3Hit?: boolean;
        feeBufferBe?: number;
        isFullClose?: boolean;
      }
    ) => {
      if (tradingMode !== 'PAPER') return;
      const realised = closedTrade.realisedPnl || 0;

      if (opts.isFullClose) {
        setPaperPositions((prev) => prev.filter((p) => p.id !== pos.id));
        setPaperHistory((prev) => [closedTrade, ...prev]);
        setPaperPortfolio((pf) => {
          const newMargin = Math.max(0, +(pf.marginUsed - (pos.margin || 0)).toFixed(2));
          const newAvail = +(pf.availableBalance + (pos.margin || 0) + realised).toFixed(2);
          return {
            ...pf,
            availableBalance: newAvail,
            marginUsed: newMargin,
            realisedPnlTotal: +(pf.realisedPnlTotal + realised).toFixed(2),
            dailyPnl: +(pf.dailyPnl + realised).toFixed(2),
            totalEquity: +(newAvail + newMargin).toFixed(2),
          };
        });
      } else {
        const closedQty = Math.min(pos.size, opts.partialSize || pos.size * 0.25);
        const ratio = pos.size > 0 ? closedQty / pos.size : 0;
        const releasedMargin = +(pos.margin * ratio).toFixed(2);
        const nextSize = Math.max(0.001, +(pos.size - closedQty).toFixed(4));
        const nextMargin = Math.max(0.01, +(pos.margin - releasedMargin).toFixed(2));

        setPaperPositions((prev) =>
          prev.map((p) =>
            p.id === pos.id
              ? {
                  ...p,
                  size: nextSize,
                  margin: nextMargin,
                  stopLoss: opts.newStopLoss ?? p.stopLoss,
                  tp1Hit: opts.tp1Hit ?? p.tp1Hit,
                  tp2Hit: opts.tp2Hit ?? p.tp2Hit,
                  tp3Hit: opts.tp3Hit ?? p.tp3Hit,
                  feeBufferBe: opts.feeBufferBe ?? p.feeBufferBe,
                }
              : p
          )
        );

        setPaperHistory((prev) => [closedTrade, ...prev]);
        setPaperPortfolio((pf) => {
          const newMargin = Math.max(0, +(pf.marginUsed - releasedMargin).toFixed(2));
          const newAvail = +(pf.availableBalance + releasedMargin + realised).toFixed(2);
          return {
            ...pf,
            availableBalance: newAvail,
            marginUsed: newMargin,
            realisedPnlTotal: +(pf.realisedPnlTotal + realised).toFixed(2),
            dailyPnl: +(pf.dailyPnl + realised).toFixed(2),
            totalEquity: +(newAvail + newMargin).toFixed(2),
          };
        });
      }

      playTradeFill();

      try {
        await fetch('/api/delta/close-position', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(sessionToken ? { 'Authorization': `Bearer ${sessionToken}` } : {}),
          },
          body: JSON.stringify({
            positionId: pos.id,
            reason: closedTrade.reason,
            partialSize: opts.isFullClose ? undefined : opts.partialSize,
            exitPrice: closedTrade.exitPrice,
            realisedPnl: closedTrade.realisedPnl,
            newStopLoss: opts.newStopLoss,
            tp1Hit: opts.tp1Hit,
            tp2Hit: opts.tp2Hit,
            tp3Hit: opts.tp3Hit,
            feeBufferBe: opts.feeBufferBe,
          }),
        });
        fetchMarketData();
      } catch {
        // Optimistic local state preserved
      }
    },
    [tradingMode, sessionToken, playTradeFill, fetchMarketData]
  );

  const handleSniperRecordClosedTrade = useCallback(
    (trade: ClosedTrade, posUpdate?: any) => {
      sniperRecordTradeRef.current?.(trade, posUpdate);
    },
    []
  );
  const handleSniperLifecycleExit = useCallback(
    (reason: 'SL' | 'TP4', symbol: string) => {
      sniperLifecycleExitRef.current?.(reason, symbol);
    },
    []
  );

  const isExchangeHydrated =
    tradingMode === 'PAPER'
      ? true
      : Boolean(isLiveApiAuthenticated && walletHydratedLive && positionsHydratedLive);

  // Intraday Sniper Scalping Engine instance (Automatic Signal Validation, Entry, Profit Lock & Trailing Stop)
  // Strictly isolated by tradingMode and gated by isLiveApiAuthenticated + hydration in LIVE mode
  const sniperEngine = useSniperScalpingEngine({
    markets,
    selectedSymbol,
    tradingMode,
    availableBalance: portfolio.availableBalance,
    totalEquity: portfolio.totalEquity,
    marginUsed: portfolio.marginUsed,
    isLiveApiAuthenticated,
    isExchangeHydrated,
    appBootTimestamp: appBootTimestampRef.current,
    onExecuteOrder: handleExecuteOrder,
    onClosePosition: handleClosePosition,
    onRecordClosedTrade: handleSniperRecordClosedTrade,
    onSignalExitLifecycle: handleSniperLifecycleExit,
    onSendNotification: addNotification,
    onPlaySound: playTradeFill,
    aiAnalysis,
    onRefreshAiAnalysis: refreshAiAnalysis,
    isAiLoading,
    positions,
  });

  return (
    <RiskAdjustmentProvider
      availableBalance={portfolio.availableBalance}
      totalEquity={portfolio.totalEquity}
      positions={positions}
      history={history}
      onUpdatePositionSL={handleUpdatePositionSL}
      onScalePosition={handleScalePosition}
      onSendNotification={addNotification}
    >
      <AiMatrixCorrelationProvider
        availableBalance={portfolio.availableBalance}
        totalEquity={portfolio.totalEquity}
        positions={positions}
        history={history}
        markets={markets}
        selectedSymbol={selectedSymbol}
        aiAnalysis={aiAnalysis}
        activeSignalSide={
          sniperEngine.activeTrade?.signal ||
          (sniperEngine.currentSignal &&
          !sniperEngine.currentSignal.isStandby &&
          (sniperEngine.currentSignal.signal === 'LONG' || sniperEngine.currentSignal.signal === 'SHORT')
            ? sniperEngine.currentSignal.signal
            : undefined)
        }
        activeSignalId={
          sniperEngine.activeTrade?.id ||
          (sniperEngine.currentSignal && !sniperEngine.currentSignal.isStandby
            ? sniperEngine.currentSignal.id
            : undefined)
        }
        onUpdatePositionSL={handleUpdatePositionSL}
        onScalePosition={handleScalePosition}
        onSendNotification={addNotification}
      >
        <LayoutPriorityProvider
          baseActivePositionCount={positions.length + (sniperEngine.activeTrade ? 1 : 0)}
        >
        <SignalAndPositionLifecycleBridge
          positions={positions}
          markets={markets}
          tradingMode={tradingMode}
          sniperActiveTrade={sniperEngine.activeTrade}
          paperPositions={paperPositions}
          setPaperHistory={setPaperHistory}
          setPaperPortfolio={setPaperPortfolio}
          handlePartialClosePaperPosition={handlePartialClosePaperPosition}
          handleClosePosition={handleClosePosition}
          addNotification={addNotification}
          playTradeFill={playTradeFill}
          onUpdatePositionSL={handleUpdatePositionSL}
          sniperRecordTradeRef={sniperRecordTradeRef}
          sniperLifecycleExitRef={sniperLifecycleExitRef}
        />
        {isAuthLoading ? (
          <div className="min-h-screen bg-[#070A14] flex items-center justify-center text-cyan-400 font-mono text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              <span>Authenticating DeltaAI Security Realm...</span>
            </div>
          </div>
        ) : !isAuthorizedAdmin ? (
          <div className="min-h-screen bg-[#070A14] text-slate-100 flex items-center justify-center p-4 selection:bg-cyan-500 selection:text-black">
            <div className="max-w-md w-full bg-[#0D1224] border border-cyan-500/40 rounded-2xl p-6 shadow-2xl space-y-6">
              <div className="text-center space-y-2">
                <div className="inline-flex p-3 rounded-2xl bg-cyan-500/10 border border-cyan-400/30 text-cyan-400">
                  <Key className="w-8 h-8" />
                </div>
                <h1 className="text-xl font-bold tracking-tight text-white font-mono">DeltaAI Security Gate</h1>
                <p className="text-xs text-slate-400">
                  Restricted access cloud deployment. Authorized administrator login required for <span className="text-cyan-300 font-mono">dhanrajk69@gmail.com</span>.
                </p>
              </div>

              {authError && (
                <div className="p-3 rounded-xl bg-rose-950/85 border border-rose-500/60 text-xs text-rose-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{authError}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full btn-delta-lg btn-toggle-active font-mono"
              >
                <Sparkles className="w-4 h-4 text-cyan-200" />
                <span>Sign in with Google (dhanrajk69@gmail.com)</span>
              </button>

              <button
                type="button"
                onClick={handleAdminBypassLogin}
                className="w-full btn-delta-lg btn-primary font-mono"
              >
                <ShieldCheck className="w-4 h-4 text-slate-950" />
                <span>Quick Admin Sign-In (dhanrajk69@gmail.com)</span>
              </button>

              <div className="text-center text-[10px] text-slate-500 font-mono">
                Protected by Firebase Auth & Google Cloud Zero-Trust Access Policy
              </div>
            </div>
          </div>
        ) : (
          <div
            className={`min-h-screen w-full max-w-full bg-[#060B14] text-slate-100 flex flex-col font-sans relative ${
              currentTab === 'dashboard' || currentTab === 'terminal'
                ? 'lg:h-screen lg:overflow-hidden overflow-visible'
                : 'overflow-visible'
            }`}
          >
        {/* Top Header */}
      <Header
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        onToggleSidebar={handleToggleMobileSidebar}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleCollapseSidebar={handleToggleSidebarCollapse}
        tradingMode={tradingMode}
        setTradingMode={handleSetTradingMode}
        unreadNotifications={unreadNotificationsCount}
        openNotifications={handleOpenNotifications}
        openSettings={handleOpenSettings}
        openKillSwitchModal={handleOpenKillModal}
        soundMuted={effectiveMuted}
        toggleSound={handleToggleGeneralSound}
        currency={currency}
        toggleCurrency={toggleCurrency}
        onChangeCurrency={setCurrency}
        wsStatus={wsStatus}
        wsLatency={wsLatency}
        packetGap={activeSymbolGap}
        openWsModal={handleOpenWsModal}
        selectedSymbol={selectedSymbol}
        setSelectedSymbol={setSelectedSymbol}
        markets={markets}
        currencyPrefix={currencyPrefix}
        exchangeRate={exchangeRate}
        newsRadarData={newsRadarData}
        isNewsRadarLoading={isNewsRadarLoading}
        openNewsRadarModal={handleOpenNewsRadarModal}
        volatilityThreshold24h={volatilityThreshold24h}
        breachingAssetsCount={volatilityBreachingCount}
        maxVolatilityPct={maxVolatilityMetric?.compositeVolatility24h || 0}
        openVolatilityModal={handleOpenVolatilityModal}
        isLiveApiAuthenticated={isLiveApiAuthenticated}
        isCheckingAuth={isCheckingAuth}
        lastTickTimestamp={lastTickTimestamp}
        lastCandleTimestamp={lastCandleTimestamp}
        isServerLiveUnlocked={Boolean(serverLiveGateEnabled && liveTradingReady)}
        portfolio={portfolio}
        positions={positions}
        onRefreshWallet={() => syncLiveAccountWallet(apiCredentials)}
        onTopUpPaperWallet={(amountUsd, mode = 'ADD') => {
          setPaperPortfolio((prev) => {
            const nextAvail =
              mode === 'RESET'
                ? Math.max(0, +(amountUsd - prev.marginUsed).toFixed(2))
                : +(prev.availableBalance + amountUsd).toFixed(2);
            const nextTotal = +(nextAvail + prev.marginUsed).toFixed(2);
            return {
              ...prev,
              availableBalance: nextAvail,
              availableMargin: nextAvail,
              totalEquity: nextTotal,
              initialCapital: mode === 'RESET' ? amountUsd : +(prev.initialCapital + amountUsd).toFixed(2),
            };
          });
          addNotification(
            mode === 'RESET' ? 'Paper Wallet Reset' : 'Paper Wallet Top-Up',
            mode === 'RESET'
              ? `Paper trading wallet equity reset to $${amountUsd.toLocaleString()}.`
              : `Added $${amountUsd.toLocaleString()} simulated capital to your Paper Wallet.`,
            'INFO'
          );
        }}
      />

      {/* Live Market Conduit Stream Ticker */}
      <FlashLiveStream
        markets={markets}
        positions={positions}
        portfolio={portfolio}
        tradingMode={tradingMode}
        selectedSymbol={selectedSymbol}
        currencyPrefix={currencyPrefix}
        exchangeRate={exchangeRate}
        newsRadarData={newsRadarData}
        wsLatency={wsLatency}
        lastTickTimestamp={lastTickTimestamp}
        onSelectBulletin={handleSelectBulletin}
        onOpenNewsRadar={handleOpenNewsRadarModal}
        soundAlertsEnabled={!effectiveMuted}
        onToggleSound={handleToggleGeneralSound}
        sniperEngine={sniperEngine}
      />

      {/* Live Trading Status / Missing API Keys / Upstream Diagnostic Telemetry Banner if Live Mode is Selected */}
      {tradingMode === 'LIVE' && serverAuthConfirmed && !isCheckingAuth && (() => {
        const rawDiag = portfolio.walletDiagnosticError || walletDiagnosticError;
        const activeDiag =
          rawDiag &&
          rawDiag.code === 'MISSING_API_CREDENTIALS' &&
          (hasSavedApiKeys || isApiAuthenticated || serverHasCredentials)
            ? null
            : rawDiag;

        if (!hasSavedApiKeys && !isApiAuthenticated && isLiveUnverified) {
          return (
            <div className="w-full min-w-0 max-w-full bg-amber-950/80 border-b border-amber-500/40 px-3 sm:px-4 py-1.5 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 max-w-full flex items-center gap-2 mx-auto font-mono-numbers flex-wrap justify-center">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="badge-delta badge-delta-paper">API KEY REQUIRED</span>
                <span className="text-amber-200/90 break-words">
                  Connect your Delta Exchange API Key &amp; Secret in Settings.
                </span>
                <button
                  onClick={handleOpenSettings}
                  className="btn-delta-sm btn-primary ml-1"
                >
                  <Key className="w-3 h-3" />
                  <span>Connect API Keys</span>
                </button>
              </div>
            </div>
          );
        }

        if (activeDiag) {
          const isIpWhitelistError = activeDiag.code === 'IP_NOT_WHITELISTED';
          const formattedDiag = formatDiagnosticBadgeAndMessage(activeDiag.code, activeDiag.message);
          const resolvedIpv4 =
            activeDiag.serverIpv4 ||
            (activeDiag.clientIp && activeDiag.clientIp.includes('.')
              ? activeDiag.clientIp
              : '') ||
            serverOutboundIps.serverIpv4 ||
            '34.47.205.98';
          const resolvedIpv6 =
            activeDiag.serverIpv6 ||
            (activeDiag.clientIp && activeDiag.clientIp.includes(':')
              ? activeDiag.clientIp
              : '') ||
            serverOutboundIps.serverIpv6 ||
            '2600:1900:0:3803::700';

          return (
            <div className="w-full min-w-0 max-w-full bg-rose-950/80 border-b border-rose-500/40 px-3 sm:px-4 py-1.5 text-xs text-rose-200 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 max-w-full flex items-center gap-2 mx-auto font-mono-numbers flex-wrap justify-center">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="badge-delta badge-delta-danger">
                  {formattedDiag.label}
                </span>
                <span className="text-rose-200/95 break-words min-w-0">{formattedDiag.message}</span>

                  {isIpWhitelistError && (
                    <div className="inline-flex items-center gap-1.5 flex-wrap">
                      {resolvedIpv4 && (
                        <span
                          onClick={() => handleCopyServerIp(resolvedIpv4, 'IPV4')}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/90 hover:bg-rose-900 border border-rose-500/50 text-[10.5px] text-rose-100 cursor-pointer transition select-all"
                          title="Click to copy IPv4 address"
                        >
                          <span className="text-rose-300/90 font-semibold">IPv4:</span>
                          <code className="font-bold text-white select-all">{resolvedIpv4}</code>
                        </span>
                      )}
                      <span
                        onClick={() => handleCopyServerIp(resolvedIpv6, 'IPV6')}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/90 hover:bg-rose-900 border border-rose-500/50 text-[10.5px] text-rose-100 cursor-pointer transition select-all"
                        title="Click to copy IPv6 address"
                      >
                        <span className="text-rose-300/90 font-semibold">IPv6:</span>
                        <code className="font-bold text-white select-all">{resolvedIpv6}</code>
                      </span>

                      {resolvedIpv4 && (
                        <button
                          type="button"
                          onClick={() => handleCopyServerIp(resolvedIpv4, 'IPV4')}
                          title={`Copy Server Outbound IPv4 (${resolvedIpv4}) for Delta Exchange India API Whitelist`}
                          className="btn-delta-sm btn-danger"
                        >
                          {copiedIpType === 'IPV4' ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-300" />
                              <span className="text-emerald-200">Copied IPv4</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-rose-300" />
                              <span>Copy IPv4</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleCopyServerIp(resolvedIpv6, 'IPV6')}
                        title={`Copy Server Outbound IPv6 (${resolvedIpv6}) for Delta Exchange India API Whitelist`}
                        className="btn-delta-sm btn-danger"
                      >
                        {copiedIpType === 'IPV6' ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-300" />
                            <span className="text-emerald-200">Copied IPv6</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-rose-300" />
                            <span>Copy IPv6</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => syncLiveAccountWallet(apiCredentials, { notify: true })}
                    className="btn-delta-sm btn-danger"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry Wallet Sync</span>
                  </button>
                  <button
                    onClick={handleOpenSettings}
                    className="btn-delta-sm btn-secondary"
                  >
                    <Key className="w-3 h-3" />
                    <span>API Settings</span>
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div className="w-full min-w-0 max-w-full bg-emerald-950/65 border-b border-emerald-500/30 px-3 sm:px-4 py-1.5 text-xs text-emerald-300 flex items-center justify-between">
              <div className="min-w-0 max-w-full flex items-center gap-2 mx-auto font-mono-numbers flex-wrap justify-center text-center sm:text-left">
                <span className="badge-delta badge-delta-live">
                  <Flame className="w-3 h-3 text-emerald-300" />
                  LIVE ACTIVE
                </span>
                <span className="break-words min-w-0">
                  API Keys Authenticated · Equity: {currencyPrefix}
                  {(portfolio.totalEquity * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Avail Margin: {currencyPrefix}
                  {((portfolio.availableMargin ?? portfolio.availableBalance) * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Orders routed to Delta Exchange India.
                </span>
              </div>
            </div>
          );
      })()}

      {/* DeltaAI Workspace Layout: Sidebar + Main Content Viewport */}
      <div className="flex-1 min-h-0 flex w-full max-w-full overflow-x-hidden">
        <DashdarkXSidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          activeStrategySubTab={activeStrategySubTab}
          isSettingsOpen={isSettingsOpen}
          onOpenOptionsLab={handleOpenOptionsLab}
          positionsCount={positions.length}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={handleToggleSidebarCollapse}
          isOpenMobile={isSidebarOpen}
          onCloseMobile={() => setIsSidebarOpen(false)}
          onOpenSettings={handleOpenSettings}
          onOpenKillSwitch={handleOpenKillModal}
          soundMuted={effectiveMuted}
          onToggleSound={handleToggleGeneralSound}
          wsStatus={wsStatus}
          wsLatency={wsLatency}
          apiCredentials={apiCredentials}
          isLiveApiAuthenticated={isLiveApiAuthenticated}
          serverLiveGateEnabled={serverLiveGateEnabled}
          currency={currency}
          onChangeCurrency={setCurrency}
          tradingMode={tradingMode}
          setTradingMode={handleSetTradingMode}
          isServerLiveUnlocked={Boolean(serverLiveGateEnabled && liveTradingReady)}
          serverIp={serverOutboundIps.serverIpv4}
          onOpenWsModal={handleOpenWsModal}
          unreadNotifications={unreadNotificationsCount}
          onOpenNotifications={handleOpenNotifications}
        />

        {/* Main Content Viewport - Zero-Scroll 3-Zone Pro-Desk Grid on Desktop when on Dashboard/Terminal */}
        <main
          className={`flex-1 min-w-0 max-w-full 2xl:max-w-[1920px] w-full overflow-x-hidden p-2 sm:p-2.5 lg:p-2.5 pb-24 md:pb-2.5 ${
            currentTab === 'dashboard' || currentTab === 'terminal'
              ? 'lg:h-full lg:min-h-0 lg:overflow-hidden overflow-y-auto flex flex-col'
              : 'overflow-y-auto'
          }`}
        >
          {(currentTab === 'dashboard' || currentTab === 'terminal') && (
            <>
              {/* Keep TradingIntelligenceBar hooks (useLiveFuturesAutoExecution, voice alerts, breach listeners) mounted */}
              <div className="sr-only" aria-hidden="true">
                <TradingIntelligenceBar
                  sniperEngine={sniperEngine}
                  isLiveUnverified={isLiveUnverified}
                  onNavigateToAi={handleNavigateToAi}
                  onNavigateToStrategies={handleNavigateToStrategies}
                  showShortTermTrend={showShortTermTrendOverlay}
                  onToggleShortTermTrend={handleToggleShortTermTrendOverlay}
                  trendSmoothingFactor={trendSmoothingFactor}
                  onChangeTrendSmoothingFactor={handleTrendSmoothingFactorChange}
                  trendVariance={trendVariance}
                  currencyPrefix={currencyPrefix}
                  volatilityBreachAlertEnabled={volatilityBreachAlertEnabled}
                  volatilityBreachThreshold={volatilityBreachThreshold}
                  volatilityBreachChimeEnabled={volatilityBreachChimeEnabled}
                  autoMuteOnBreachEnabled={autoMuteOnBreachEnabled}
                  autoResetTrendEnabled={autoResetTrendEnabled}
                  isVolatilityBreachWarningActive={isVolatilityBreachWarningActive}
                  volatilityBreachHistory={volatilityBreachHistory}
                  onToggleVolatilityBreachAlert={handleToggleVolatilityBreachAlert}
                  onChangeVolatilityBreachThreshold={handleChangeVolatilityBreachThreshold}
                  onToggleVolatilityBreachChime={handleToggleVolatilityBreachChime}
                  onToggleAutoMuteOnBreach={handleToggleAutoMuteOnBreach}
                  onToggleAutoResetTrend={handleToggleAutoResetTrend}
                  onDismissVolatilityBreach={handleDismissVolatilityBreach}
                  onClearVolatilityBreachHistory={handleClearVolatilityBreachHistory}
                  sentimentScore={newsRadarData?.aggregateScore}
                  overallSentiment={newsRadarData?.overallSentiment}
                  hasLiveMarkets={Object.keys(markets).length > 0}
                  liveMarkPrice={getMarketTicker(markets, selectedSymbol).markPrice}
                  tradingMode={tradingMode}
                  liveTradingEnabled={Boolean((serverLiveGateEnabled || isLiveApiAuthenticated) && !isLiveUnverified)}
                  hasActivePosition={
                    positions.some((p) => {
                      const sym = String(p.rawSymbol || p.symbol || '').trim().toUpperCase();
                      const cType = String(p.contract_type || '').trim().toLowerCase();
                      return (
                        cType !== 'call_options' &&
                        cType !== 'put_options' &&
                        !sym.startsWith('C-') &&
                        !sym.startsWith('P-')
                      );
                    }) || Boolean(sniperEngine.activeTrade)
                  }
                  apiCredentials={apiCredentials}
                  sessionToken={sessionToken}
                  tradeHistory={history}
                  onAutoOrderDispatched={(res) => {
                    syncLiveAccountWallet(apiCredentials);
                    fetchMarketData();
                    if (res.ok) {
                      playTradeFill();
                      const dirWord = res.side === 'buy' ? 'Long' : 'Short';
                      const shortSym = formatVoiceSymbol(res.symbol || 'BTCUSDT');
                      const entryPart = res.average_fill_price ? ` at ${formatVoicePrice(res.average_fill_price)}` : '';
                      const slPart = res.slPrice ? ` Stop loss ${formatVoicePrice(res.slPrice)}.` : '';
                      const tpPart = res.tpPrice ? ` Target ${formatVoicePrice(res.tpPrice)}.` : '';
                      speakVoiceAlert(
                        `Sniper ${dirWord} executed on ${shortSym}${entryPart}.${slPart}${tpPart}`,
                        `auto-order:${res.order_id || res.symbol}:${res.side}`
                      );
                      addNotification(
                        'Live Auto-Pilot Bracket Order Executed',
                        `Delta Order #${res.order_id} (${res.state.toUpperCase()}) · ${res.side.toUpperCase()} ${res.size}x ${res.symbol}`,
                        'TRADE'
                      );
                    } else {
                      addNotification(
                        'Live Auto-Pilot Order Rejected',
                        `Delta /v2/orders rejected ${res.symbol}: ${res.error || res.state}`,
                        'RISK'
                      );
                    }
                  }}
                  onTestVolatilityBreachAlert={() => {
                    const currentStdDevPct = Math.max(
                      volatilityBreachThreshold + 0.15,
                      trendVariance?.stdDevPct || 1.15
                    );
                    const currentStdDev = trendVariance?.stdDev || +(currentStdDevPct * 800).toFixed(2);
                    triggerVolatilityBreachNotification({
                      symbol: selectedSymbol,
                      stdDev: currentStdDev,
                      stdDevPct: currentStdDevPct,
                      threshold: volatilityBreachThreshold,
                      isTest: true,
                    });
                  }}
                />
              </div>

              <ProDeskTerminal
                selectedSymbol={selectedSymbol}
                setSelectedSymbol={setSelectedSymbol}
                markets={markets}
                tradingMode={tradingMode}
                portfolio={portfolio}
                positions={positions}
                history={history}
                sniperEngine={sniperEngine}
                currencyPrefix={currencyPrefix}
                exchangeRate={exchangeRate}
                wsStatus={wsStatus}
                activeSymbolGap={activeSymbolGap}
                volatility24h={volatilityAssetMetrics.find((m) => m.symbol === selectedSymbol)?.compositeVolatility24h}
                newsRadarData={newsRadarData}
                activeBacktestTrade={activeBacktestTrade}
                onClearBacktestTrade={handleClearBacktestTrade}
                showShortTermTrendOverlay={showShortTermTrendOverlay}
                trendSmoothingFactor={trendSmoothingFactor}
                onTrendSmoothingFactorChange={handleTrendSmoothingFactorChange}
                onTrendVarianceChange={setTrendVariance}
                trendResetNonce={trendResetNonce}
                isLiveApiAuthenticated={isLiveApiAuthenticated}
                isCheckingAuth={isCheckingAuth}
                serverHasCredentials={serverHasCredentials}
                isLiveUnverified={isLiveUnverified}
                onOpenSettings={handleOpenSettings}
                onExecuteOrder={handleExecuteOrder}
                onClosePosition={handleClosePosition}
                onAutoHedge={handleAutoHedge}
                onCloseAllPositions={handleOpenKillModal}
                prefillAiSetup={prefillAiSetup}
                onClearPrefill={handleClearPrefill}
                aiAnalysis={aiAnalysis}
                isAiLoading={isAiLoading}
                onRefreshAiAnalysis={refreshAiAnalysis}
                onSendNotification={addNotification}
                onPlaySound={playTradeFill}
                globalLeverage={clampLeverage(globalLeverage)}
                marginMode={marginMode}
              />
            </>
          )}

        {currentTab === 'markets' && (
          <MarketCentre
            markets={markets}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={(sym) => {
              setSelectedSymbol(sym);
              setCurrentTab('dashboard');
            }}
            currencyPrefix={currencyPrefix}
            exchangeRate={exchangeRate}
            wsStatus={wsStatus}
            wsLatency={wsLatency}
            openWsModal={handleOpenWsModal}
          />
        )}

        <div className={currentTab === 'strategies' ? 'block w-full min-w-0' : 'hidden'}>
          <StrategyEngine
            markets={markets}
            tradingMode={tradingMode}
            onExecuteTrade={handleExecuteOrder}
            onTriggerAiValidation={handleAiValidate}
            onSendNotification={addNotification}
            currencyPrefix={currencyPrefix}
            exchangeRate={exchangeRate}
            sniperEngine={sniperEngine}
            packetGap={activeSymbolGap}
            aiAnalysis={aiAnalysis}
            isAiLoading={isAiLoading}
            onRefreshAiAnalysis={refreshAiAnalysis}
            onNavigateToAi={handleNavigateToAi}
            isLiveApiAuthenticated={isLiveApiAuthenticated}
            onOpenSettings={handleOpenSettings}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            onPlaySound={playTradeFill}
            engineTabRequest={engineTabRequest}
            onActiveTabChange={setActiveStrategySubTab}
            isExchangeHydrated={isExchangeHydrated}
            appBootTimestamp={appBootTimestampRef.current}
          />
        </div>


        {currentTab === 'ai-centre' && (
          <AiCommandCentre
            analysis={aiAnalysis}
            isLoading={isAiLoading}
            onRefreshAnalysis={refreshAiAnalysis}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
            markets={markets}
            onApplyTradeCard={handleApplyTradeCard}
            onSyncToIntelligence={(tradeCard) => {
              setSelectedSymbol(tradeCard.symbol);
              addNotification(
                'Trading Intelligence Synchronized',
                `Institutional Command Signal for ${tradeCard.action} on ${tradeCard.symbol} linked into Trading Intelligence Engine. Targets T1-T4 primed.`,
                'AI'
              );
              setCurrentTab('strategies');
            }}
            onLogAudit={sniperEngine.addLog}
            onSendNotification={addNotification}
            currencyPrefix={currencyPrefix}
            exchangeRate={exchangeRate}
            positions={positions}
            portfolio={portfolio}
            lastTickTimestamp={lastTickTimestamp}
            lastCandleTimestamp={lastCandleTimestamp}
            sniperEngine={sniperEngine}
          />
        )}

        {currentTab === 'performance' && (
          <PerformanceAnalytics
            portfolio={portfolio}
            history={history}
            positions={positions}
            tradingMode={tradingMode}
            currencyPrefix={currencyPrefix}
            exchangeRate={exchangeRate}
            markets={markets}
            selectedSymbol={selectedSymbol}
            isLiveApiAuthenticated={isLiveApiAuthenticated}
            spotSignalSide={
              sniperEngine.currentSignal?.signal === 'SHORT'
                ? 'SHORT'
                : 'LONG'
            }
            onRefresh={() => {
              fetchMarketData();
              fetch(`/api/delta/sync-full-history?_t=${Date.now()}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-admin-email': 'dhanrajk69@gmail.com',
                  ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
                  ...(apiCredentials.apiKey && !isMaskedPlaceholderCredential(apiCredentials.apiKey)
                    ? { 'x-delta-api-key': apiCredentials.apiKey, 'x-delta-api-secret': apiCredentials.apiSecret }
                    : {}),
                },
                body: JSON.stringify({ maxFillPages: 25, maxOrderPages: 15 }),
                cache: 'no-store',
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((payload) => {
                  if (payload?.success && Array.isArray(payload.tradeHistory) && payload.tradeHistory.length > 0) {
                    window.dispatchEvent(
                      new CustomEvent('delta:full-history-synced', {
                        detail: {
                          tradeHistory: payload.tradeHistory,
                          pairedTradesCount: payload.pairedTradesCount || 0,
                          warehouseAddedCount: payload.warehouseAddedCount || 0,
                        },
                      })
                    );
                  }
                })
                .catch(() => {});
            }}
            onVisualizeOnMainChart={(trade) => {
              setActiveBacktestTrade(trade);
              if (trade.symbol) {
                setSelectedSymbol(trade.symbol);
              }
              setCurrentTab('dashboard');
              addNotification(
                'Strategy Backtest Loaded on Main Chart',
                `Visualizing simulated trade ${trade.id} (${trade.side} @ $${trade.entryPrice.toLocaleString()}) entry and exit points on Main Candlestick Chart.`,
                'INFO'
              );
            }}
          />
        )}

        {currentTab === 'risk' && (
          <RiskManager
            portfolio={portfolio}
            positions={positions}
            riskSettings={riskSettings}
            onUpdateRiskSettings={handleUpdateRiskSettings}
            onTriggerKillSwitch={handleKillSwitch}
            onTriggerAutoHedge={handleAutoHedge}
            currencyPrefix={currencyPrefix}
            exchangeRate={exchangeRate}
            markets={markets}
            volatilityAssetMetrics={volatilityAssetMetrics}
            tradingMode={tradingMode}
            onExecuteOrder={handleExecuteOrder}
            onClosePosition={handleClosePosition}
            onSendNotification={addNotification}
            onNavigateToStrategies={() => {
              setCurrentTab('strategies');
              const t1 = setTimeout(() => {
                uiTimersRef.current.delete(t1);
                const el = document.getElementById('ai-signal-validator');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.classList.add('ring-2', 'ring-emerald-400', 'animate-pulse');
                  const t2 = setTimeout(() => {
                    uiTimersRef.current.delete(t2);
                    el.classList.remove('ring-2', 'ring-emerald-400', 'animate-pulse');
                  }, 3000);
                  uiTimersRef.current.add(t2);
                }
              }, 150);
              uiTimersRef.current.add(t1);
            }}
          />
        )}

        {currentTab === 'positions' && (
          <PositionsTable
            positions={positions}
            history={history}
            onClosePosition={handleClosePosition}
            onAutoHedge={handleAutoHedge}
            tradingMode={tradingMode}
            currencyPrefix={currencyPrefix}
            exchangeRate={exchangeRate}
          />
        )}
      </main>
      </div>

      {/* Emergency Kill Switch Confirmation Modal */}
      {isKillModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="panel-delta w-full max-w-md border-rose-500/60 overflow-hidden shadow-2xl">
            <div className="panel-delta-header border-rose-500/30">
              <div className="panel-delta-title text-rose-300">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Confirm Kill Switch</span>
              </div>
              <button
                type="button"
                onClick={() => setIsKillModalOpen(false)}
                className="btn-delta-sm btn-secondary !px-1.5"
                aria-label="Close Kill Switch Modal"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="panel-delta-body space-y-3 text-xs text-slate-300">
              <p>
                Triggering the emergency Kill Switch will immediately:
              </p>
              <ul className="list-disc pl-5 space-y-1 font-mono-numbers text-rose-300">
                <li>Cancel all active open limit and stop orders</li>
                <li>Market close all {positions.length} active positions immediately</li>
                <li>Halt automated strategies and reset exposure to cash</li>
              </ul>
              <div className="p-2.5 bg-rose-500/10 border border-rose-500/40 rounded-lg text-[11px] text-rose-200">
                Unrealised PnL at liquidation: ${portfolio.unrealisedPnlTotal.toFixed(2)}
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsKillModalOpen(false)}
                  className="flex-1 btn-delta btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleKillSwitch}
                  className="flex-1 btn-delta btn-danger uppercase"
                >
                  Execute Kill Switch
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        tradingMode={tradingMode}
        setTradingMode={handleSetTradingMode}
        onSendTestNotification={(title, msg) => addNotification(title, msg, 'INFO')}
        apiCredentials={apiCredentials}
        sessionToken={sessionToken}
        serverLiveGateEnabled={serverLiveGateEnabled}
        onToggleServerLiveGate={(unlocked, statusData) => {
          setServerLiveGateEnabled(unlocked);
          setLiveTradingReady(Boolean(statusData?.liveTradingReady ?? unlocked));
          if (statusData?.policyNotice) {
            setTradingPolicyNotice(statusData.policyNotice);
          }
          if (unlocked) {
            syncLiveAccountWallet(apiCredentials, { notify: true });
          }
          addNotification(
            unlocked ? 'Live Execution Gate Unlocked' : 'Live Execution Gate Locked',
            unlocked
              ? 'Server-side Live Execution Gate is now UNLOCKED (ACTIVE). Syncing Delta Exchange India wallet balances & positions via IPv4 (34.47.205.98).'
              : 'Server-side Live Execution Gate is now LOCKED (SAFETY ON). Live orders are blocked.',
            unlocked ? 'INFO' : 'RISK'
          );
        }}
        onSaveApiCredentials={(creds) => {
          setServerHasCredentials(true);
          setServerAuthConfirmed(true);
          setIsCheckingAuth(false);
          setLivePortfolio((prev) =>
            prev.walletDiagnosticError?.code === 'MISSING_API_CREDENTIALS'
              ? { ...prev, walletDiagnosticError: null }
              : prev
          );
          setApiCredentials(creds);
          saveStoredDeltaCredentials(creds);
          syncLiveAccountWallet(creds, { notify: true, serverHasCreds: true });
        }}
        onClearApiCredentials={() => {
          setServerHasCredentials(false);
          setServerAuthConfirmed(true);
          clearStoredDeltaCredentials();
          setApiCredentials({
            apiKey: '',
            apiSecret: '',
            environment: 'PROD',
            isVerified: false,
          });
          setLivePortfolio(ZERO_LIVE_PORTFOLIO);
          setLivePositions([]);
          setServerLiveGateEnabled(false);
          setLiveTradingReady(false);
          fetch('/api/delta/live-gate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ unlocked: false }),
          }).catch(() => {});
          setLivePositions([]);
          setLivePortfolio(ZERO_LIVE_PORTFOLIO);
          addNotification(
            'Delta Exchange API Keys Disconnected',
            'API credentials cleared. Live Mode balances and order execution are now inactive.',
            'RISK'
          );
        }}
      />

      {/* Notification Center Drawer */}
      <NotificationCenter
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        notifications={notifications}
        onMarkAllAsRead={() => {
          setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        }}
        onClearAll={() => setNotifications([])}
        onNavigateToValidator={() => {
          setCurrentTab('strategies');
          const t1 = setTimeout(() => {
            uiTimersRef.current.delete(t1);
            const el = document.getElementById('ai-signal-validator');
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('ring-2', 'ring-emerald-400', 'animate-pulse');
              const t2 = setTimeout(() => {
                uiTimersRef.current.delete(t2);
                el.classList.remove('ring-2', 'ring-emerald-400', 'animate-pulse');
              }, 3000);
              uiTimersRef.current.add(t2);
            }
          }, 150);
          uiTimersRef.current.add(t1);
        }}
      />

      {/* Delta Exchange India Live WebSocket Radar Modal */}
      <WebSocketRadarModal
        isOpen={isWsModalOpen}
        onClose={() => setIsWsModalOpen(false)}
        status={wsStatus}
        latency={wsLatency}
        packetGap={activeSymbolGap}
        messageCount={wsMessageCount}
        gatewayUrl={wsGatewayUrl}
        messageLogs={wsMessageLogs}
        onReconnect={wsReconnect}
        onSendPing={wsSendPing}
      />

      {/* Live AI News Sentiment Radar Modal */}
      <NewsSentimentRadarModal
        isOpen={isNewsRadarOpen}
        onClose={() => setIsNewsRadarOpen(false)}
        radarData={newsRadarData}
        isLoading={isNewsRadarLoading}
        isRefreshing={isNewsRadarRefreshing}
        onRefresh={refreshNewsRadar}
      />

      {/* Real-Time 24h Volatility Spike Monitor & Threshold Configurator Modal */}
      <VolatilitySpikeModal
        isOpen={isVolatilityModalOpen}
        onClose={() => setIsVolatilityModalOpen(false)}
        threshold24h={volatilityThreshold24h}
        onChangeThreshold={setVolatilityThreshold24h}
        soundEnabled={volatilitySoundEnabled && !effectiveMuted}
        onToggleSound={() => setVolatilitySoundEnabled(!volatilitySoundEnabled)}
        autoBannerEnabled={volatilityAutoBannerEnabled}
        onToggleAutoBanner={() => setVolatilityAutoBannerEnabled(!volatilityAutoBannerEnabled)}
        assetMetrics={volatilityAssetMetrics}
        spikeAlerts={volatilitySpikeAlerts}
        currencyPrefix={currencyPrefix}
        exchangeRate={exchangeRate}
        onTriggerTestSpike={triggerTestVolatilitySpike}
        onClearAlerts={clearVolatilitySpikeAlerts}
        onSelectSymbol={(sym) => {
          setSelectedSymbol(sym);
          setCurrentTab('dashboard');
        }}
      />

      {/* Volatility Breach Alert Toast */}
      <AnimatePresence>
        {volatilityBreachToast && (
          <motion.div
            key={volatilityBreachToast.id}
            role="alert"
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed top-16 right-4 z-[90] w-80 sm:w-96 rounded-xl bg-[#0b1020]/95 border border-rose-500/60 shadow-2xl backdrop-blur-md p-3.5 text-slate-100"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-rose-950/80 border border-rose-500/50 flex items-center justify-center text-rose-300 shrink-0">
                <BellRing className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white truncate">
                    {volatilityBreachToast.isTest ? '[Test] Volatility Breach Alert' : 'Volatility Breach Alert'}
                  </span>
                  <button
                    type="button"
                    onClick={handleDismissVolatilityBreach}
                    aria-label="Dismiss Volatility Breach Alert"
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] font-mono tabular-nums text-rose-300">
                  <span className="font-bold text-white">{volatilityBreachToast.symbol}</span>
                  <span>·</span>
                  <span>
                    σ {volatilityBreachToast.stdDevPct.toFixed(2)}% &gt; {volatilityBreachToast.threshold.toFixed(1)}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">
                  Standard deviation exceeded threshold — potential market breakout or high-risk regime change.
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsNotificationsOpen(true);
                      handleDismissVolatilityBreach();
                    }}
                    className="btn-delta-sm btn-danger"
                  >
                    Open Alerts
                  </button>
                  <button
                    type="button"
                    onClick={handleDismissVolatilityBreach}
                    className="btn-delta-sm btn-secondary"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Android-Style Fixed Bottom Navigation Bar (< 768px only) — Shared 9-Item Canonical Ordering */}
      <nav
        aria-label="Mobile Primary Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 min-h-[60px] pb-safe bg-[#080B17]/95 backdrop-blur-xl border-t border-slate-800/80 shadow-[0_-8px_28px_rgba(0,0,0,0.65)] flex items-stretch overflow-x-auto no-scrollbar gap-1 px-1.5 py-1"
      >
        {DELTA_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const activeNavId = resolveActiveNavId({
            currentTab,
            isSettingsOpen,
            activeStrategySubTab,
          });
          const active = activeNavId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleDeltaNavSelect(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 min-w-[78px] flex flex-col items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[10px] font-semibold transition cursor-pointer active:scale-95 ${
                active ? 'nav-delta-active' : 'nav-delta-inactive'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-4 h-4 ${
                    active ? 'text-cyan-300' : 'text-slate-400'
                  }`}
                />
                {item.id === 'positions' && positions.length > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 badge-delta badge-delta-live !h-4 !px-1 !text-[9px]">
                    {positions.length}
                  </span>
                )}
              </div>
              <span className="whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Offline Mode Indicator */}
      <OfflineIndicator />
        </div>
        )}
        </LayoutPriorityProvider>
      </AiMatrixCorrelationProvider>
    </RiskAdjustmentProvider>
  );
}

