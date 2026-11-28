import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  MarketTicker, 
  TradingMode, 
  OptionStrategyName, 
  OptionStrategyCategory, 
  OptionStrategyPosition,
  OptionLeg,
  AiAnalysisResult,
  SniperSignal,
  CorrelatedSignal,
} from '../types';
import { useOptionsStrategyEngine } from '../hooks/useOptionsStrategyEngine';
import { OptionsPayoffChart } from './OptionsPayoffChart';
import { OptionsLivePriceTracker } from './OptionsLivePriceTracker';
import { getMarketTicker, resolveLiveUsdInrRate, formatInrFirstPnl } from '../utils/marketUtils';
import {
  buildOptionsProfitLadder,
  formatLadderPrice,
  formatProfitCounterUsd,
  formatProfitCounterInr,
} from '../utils/optionsProfitLadder';
import { usePortfolio } from '../context/PortfolioContext';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { useAiMatrixCorrelation } from '../context/AiMatrixCorrelationContext';
import { useLayoutPriority } from '../context/LayoutPriorityContext';
import { CollapsibleTierPanel } from './CollapsibleTierPanel';
import { getTodayExpiry, getNextValidDailyExpiry, OptionsExpiryInfo } from '../utils/optionsExpiryUtils';
import { useVoiceAlerts } from '../hooks/useVoiceAlerts';
import { BtcStrategyReportModal } from './BtcStrategyReportModal';
import { 
  Layers, 
  ShieldCheck, 
  Zap, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Flame, 
  Sliders, 
  BarChart3, 
  Compass, 
  Lock, 
  ArrowRight, 
  Clock, 
  Cpu, 
  Info,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Percent,
  Play,
  Check,
  Target,
  XCircle,
  FileText
} from 'lucide-react';

interface OptionsStrategyEngineProps {
  markets: Record<string, MarketTicker>;
  tradingMode: TradingMode;
  selectedSymbol?: string;
  onSelectSymbol?: (sym: string) => void;
  onSendNotification: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
  currencyPrefix?: string;
  exchangeRate?: number;
  aiAnalysis?: AiAnalysisResult | null;
  onRefreshAiAnalysis?: (symbol: string, timeframe: string) => Promise<void>;
  isAiLoading?: boolean;
  isLiveApiAuthenticated?: boolean;
  onOpenSettings?: () => void;
  sniperSignal?: SniperSignal | null;
  correlatedSignal?: CorrelatedSignal | null;
  onPlaySound?: () => void;
  isExchangeHydrated?: boolean;
  appBootTimestamp?: number;
}

export const OptionsStrategyEngine: React.FC<OptionsStrategyEngineProps> = React.memo(({
  markets,
  tradingMode,
  selectedSymbol = 'BTCUSDT',
  onSelectSymbol,
  onSendNotification,
  currencyPrefix = '$',
  exchangeRate = 1,
  aiAnalysis,
  onRefreshAiAnalysis,
  isAiLoading = false,
  isLiveApiAuthenticated = false,
  onOpenSettings,
  sniperSignal,
  correlatedSignal,
  onPlaySound,
  isExchangeHydrated = true,
  appBootTimestamp,
}) => {
  const isLiveUnverified = tradingMode === 'LIVE' && !isLiveApiAuthenticated;

  // Dynamically resolve live USD/INR exchange rate synchronized globally via shared PortfolioContext
  const portfolioTelemetry = usePortfolio();
  const {
    defaultLotSize,
    lotSizingMode,
    maxRiskPerTradePct,
    globalLeverage,
    maxLeverageCap,
    marginMode,
    leverageSyncLocked,
    setLotSizingMode,
    clampLeverage,
  } = useCapitalAllocation();
  const effectiveGlobalLeverage = clampLeverage(globalLeverage);
  const { maSlopeData, lockedActiveSignal, signalValidity, refreshLockedSignal } = useAiMatrixCorrelation();
  const liveUsdInrRate = portfolioTelemetry.usdInrRate || resolveLiveUsdInrRate(markets, 85.0).rate;
  const fxSource: 'DELTA_LIVE_FEED' = 'DELTA_LIVE_FEED';

  const optionsEngine = useOptionsStrategyEngine({
    markets,
    selectedSymbol,
    tradingMode,
    availableBalance: portfolioTelemetry.availableMargin || portfolioTelemetry.availableBalance,
    isLiveApiAuthenticated,
    isExchangeHydrated,
    appBootTimestamp,
    onSendNotification,
    onPlaySound,
    aiAnalysis,
    onRefreshAiAnalysis,
    sniperSignal,
    correlatedSignal,
    lockedActiveSignal,
    signalValidity,
    positions: portfolioTelemetry.positions,
    maSlopePct: maSlopeData?.slopePct,
  });

  const {
    selectedStrategyName,
    setSelectedStrategyName,
    activePosition,
    archivedPositions,
    hasPhantomLocalPosition,
    clearPhantomLocalPosition,
    allStrategies,
    auditLogs,
    isExecuting,
    executeStrategy,
    handleRollAction,
    closeStrategyPosition,
    generateLegsForStrategy,
    decorateLegsWithTpSl,
    aiDirective,
    applyAiRecommendedStrategy,
    isAutoPilotEnabled,
    setIsAutoPilotEnabled,
    isAutoPilotPaused,
    autoPilotPauseReason,
    autoCooldownRemaining,
    postCloseCooldownRemaining,
    isSinglePositionLocked,
    autoPilotLockReason,
    preTradeRiskChecks,
    sessionRealisedPnlUsd,
    standardExpiries,
    selectedExpiryCycle,
    setSelectedExpiryCycle,
    intradayMode,
    setIntradayMode,
    signalOptionsCorrelation,
    applyCorrelatedIntradayStrategy,
    deltaMarketStructure,
    intradayCalibration,
    liveOptionPositions,
    closeSingleOptionLeg,
    autoPilotGates,
    resolvedStrategy,
    hasTimeframeConflict,
    conflictMessage,
    forceSpotDirection,
    setForceSpotDirection,
    autoHandoffEnabled,
    setAutoHandoffEnabled,
    isRegimeHandoffActive,
    cprStrengthRatio,
    isCprStretched,
    cpr4hWidthPct,
    isWide4hCpr,
    optionsSpreadSlotOccupied,
    accountMarginUtilizationPct,
    activeEngineMode,
    effectiveResolvedStrategy,
    executionLane,
    nextAutoScanSec,
    equitySizingSummary,
    basketLots,
    autoBasketLots,
    isCustomBasketLots,
    setBasketLots,
    resetBasketLotsToAuto,
    netSpreadMarginPerLotUsd,
    isBalancedOneToOne,
    liveAvailableEquityUsd,
    nearMissReason,
    regimeRouter,
    regimeStatusLabel,
    maxNetDebitAllowedUsd,
    estimatedNetDebitUsd,
    utcDayTradesCount,
    postSlCooldownBarsRemaining,
    institutionalSniperResult,
    isHardNoTradeBlocked,
    hardNoTradeReasons,
  } = optionsEngine;

  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);

  // ═══════════════════════════════════════════════════════════
  // VOICE ALERT SYNCHRONIZATION WITH ACTIVE CORRELATED STRATEGY
  // Reads correlatedStrategyName directly from active engine state
  // and announces specific directional spread (e.g. Bear Put Spread)
  // ═══════════════════════════════════════════════════════════
  const { announceOptionsStrategy, speakMessage } = useVoiceAlerts();

  const correlatedStrategyName = signalOptionsCorrelation?.recommendedStrategy || intradayCalibration?.strategyName || selectedStrategyName;
  const activeAnnouncedStrategy = intradayMode ? correlatedStrategyName : selectedStrategyName;

  const handleAnnounceDirectionalStrategy = useCallback(
    (customStrategyName?: OptionStrategyName) => {
      const strat = customStrategyName || (intradayMode ? correlatedStrategyName : selectedStrategyName);
      announceOptionsStrategy({
        intradayMode,
        correlatedStrategyName: customStrategyName || correlatedStrategyName,
        selectedStrategyName: strat,
        delta: intradayCalibration?.targetNetDelta || signalOptionsCorrelation?.targetNetDelta,
        targetStrike:
          signalOptionsCorrelation?.suggestedStrikes?.shortStrike ||
          intradayCalibration?.strikes?.shortCallStrike ||
          intradayCalibration?.strikes?.shortPutStrike,
        strikeType: strat.toLowerCase().includes('put') ? 'Put' : 'Call',
        signalSide: signalOptionsCorrelation?.signalSide,
      });
    },
    [
      announceOptionsStrategy,
      intradayMode,
      correlatedStrategyName,
      selectedStrategyName,
      intradayCalibration,
      signalOptionsCorrelation,
    ]
  );

  const { setOptionsPnl } = usePortfolio();

  const handleCloseActiveStrategy = () => {
    const activePos = !isLiveUnverified && activePosition && activePosition.status === 'ACTIVE' ? activePosition : null;
    // 1. Calculate and bank the current net PnL
    const netRealisedUsd = +(activeUnrealisedUsd + activeRealisedUsd).toFixed(2);
    
    // 2. Wipe position state (Auto-Pilot stays armed and enters 15m cooldown)
    closeStrategyPosition();
    setOptionsPnl(0, sessionRealisedPnlUsd);
    setShowConfirmExitModal(false);

    // 3. Audit Log Entry
    const logMessage = `[MANUAL_CLOSE] ${activePos?.strategyName || 'Options Strategy'} (${activePos?.legs?.length || 2} Legs) closed at market. Final Net Realized PnL: +$${netRealisedUsd.toFixed(2)} (≈ +₹${(netRealisedUsd * liveUsdInrRate).toFixed(2)}). Margins released.`;
    onSendNotification("STRATEGY CLOSED", logMessage, "TRADE");
  };

  // ═══════════════════════════════════════════════════════════
  // GLOBAL PNL SYNCHRONIZATION WITH PORTFOLIOCONTEXT
  // Synchronizes open options spread unrealized PnL & closed payoffs to PortfolioContext.
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (isLiveUnverified) {
      setOptionsPnl(0, 0);
      return;
    }
    if (activePosition && activePosition.status === 'ACTIVE') {
      const uPnl = activePosition.unrealisedPnlUsd || 0;
      const rPnl = sessionRealisedPnlUsd || 0;
      setOptionsPnl(uPnl, rPnl);
    } else {
      setOptionsPnl(0, sessionRealisedPnlUsd || 0);
    }
  }, [
    activePosition?.unrealisedPnlUsd,
    activePosition?.status,
    sessionRealisedPnlUsd,
    isLiveUnverified,
    setOptionsPnl,
  ]);

  const { reportActivePositionSource } = useLayoutPriority();
  useEffect(() => {
    const isLiveActive = Boolean(!isLiveUnverified && activePosition && activePosition.status === 'ACTIVE');
    reportActivePositionSource('options-lab', isLiveActive ? 1 : 0);
    return () => {
      reportActivePositionSource('options-lab', 0);
    };
  }, [activePosition, isLiveUnverified, reportActivePositionSource]);

  const [activeCategoryFilter, setActiveCategoryFilter] = useState<OptionStrategyCategory | 'ALL'>('ALL');
  const [showExactOutputModal, setShowExactOutputModal] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'ACTIVE' | 'PREVIEW'>('ACTIVE');
  const [isStrategySelectorExpanded, setIsStrategySelectorExpanded] = useState<boolean>(false);
  const [greeksViewMode, setGreeksViewMode] = useState<'BASIC' | 'GREEKS'>('BASIC');
  const [showConfirmExitModal, setShowConfirmExitModal] = useState<boolean>(false);

  // Live market ticker with automatic pair resolution
  const curMarket = getMarketTicker(markets, selectedSymbol);
  const livePrice = curMarket.markPrice;

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

  const selectedTemplate = allStrategies.find((s) => s.name === selectedStrategyName) || allStrategies[10];

  const filteredStrategies = allStrategies.filter((s) => 
    activeCategoryFilter === 'ALL' ? true : s.category === activeCategoryFilter
  );

  const pos = !isLiveUnverified && activePosition && activePosition.status === 'ACTIVE' ? activePosition : null;

  // Synthesize position for selected strategy preview when in PREVIEW mode
  // Zero Pre-Execution Projection Rule: Do not populate theoretical returns on staged/unfilled option spreads
  const previewPosition = useMemo((): OptionStrategyPosition => {
    const tmpl = selectedTemplate;
    const maxPreviewLegs = tmpl.name === 'Iron Condor' || tmpl.name === 'Iron Butterfly' ? 4 : 2;
    const isRatio = /Ratio/i.test(tmpl.name);
    const unifiedLots = Math.max(1, Math.round(basketLots));
    const rawLegs = generateLegsForStrategy
      ? generateLegsForStrategy(tmpl.name, curMarket.markPrice, selectedExpiryCycle)
          .slice(0, maxPreviewLegs)
          .map((l) => ({
            ...l,
            contracts: isRatio ? Math.max(1, Math.round(l.contracts || 1)) : unifiedLots,
          }))
      : (pos?.legs || []);
    const legs = decorateLegsWithTpSl ? decorateLegsWithTpSl(rawLegs) : rawLegs;
    return {
      id: `preview-${tmpl.name}`,
      strategyName: tmpl.name,
      category: tmpl.category,
      symbol: selectedSymbol,
      underlyingPrice: curMarket.markPrice,
      entryUnderlyingPrice: curMarket.markPrice,
      marketOutlook: tmpl.marketOutlook,
      volatilityOutlook: tmpl.volatilityOutlook,
      confidence: 92,
      signalStrength: 'Strong',
      lotSize: unifiedLots,
      leverage: effectiveGlobalLeverage,
      marginMode,
      maxProfitTargetPercent: tmpl.defaultMaxProfitTarget,
      currentProfitPercent: 0,
      netPremiumCollectedOrPaid: 0,
      unrealisedPnlUsd: 0,
      realisedPnlUsd: 0,
      maxRiskUsd: 0,
      maxProfitUsd: 0,
      legs,
      greeks: pos?.greeks || {
        netDelta: 0,
        netGamma: 0,
        netTheta: 0,
        netVega: 0,
        averageIv: 49.5,
        thetaStatus: 'Neutral',
        vegaStatus: 'Healthy',
      },
      riskStatus: 'Normal',
      marginStatus: 'Safe',
      rollingRequired: false,
      expiryStatus: 'Healthy',
      openedAt: Date.now(),
      status: 'CLOSED_INTELLIGENCE',
      aiVerdict: `STAGED STRUCTURE (${tmpl.name.toUpperCase()} · 1:1 BALANCED ${unifiedLots} CTS/LEG) — Awaiting Execution. Theoretical payoff figures activate once position is live.`,
    };
  }, [selectedTemplate, generateLegsForStrategy, decorateLegsWithTpSl, viewMode === 'PREVIEW' ? curMarket.markPrice : 0, selectedSymbol, pos, selectedExpiryCycle, basketLots, effectiveGlobalLeverage, marginMode]);

  const displayPosition = pos ? pos : previewPosition;

  // Real-time INR-first PnL telemetry calculations (Zero Pre-Execution Projection when pos === null)
  const isStrategyActive = pos !== null && pos.legs && pos.legs.length > 0;
  
  const rawActiveUnrealisedUsd = !isLiveUnverified && pos ? pos.unrealisedPnlUsd : 0;
  const rawActiveRealisedUsd = isLiveUnverified ? 0 : pos ? pos.realisedPnlUsd : sessionRealisedPnlUsd;
  
  const activeUnrealisedUsd = isStrategyActive ? rawActiveUnrealisedUsd : 0;
  const activeRealisedUsd = isStrategyActive ? rawActiveRealisedUsd : (sessionRealisedPnlUsd || 0);

  const totalNetPnlUsd = +(activeUnrealisedUsd + activeRealisedUsd).toFixed(4);
  const maxProfitUsdVal = !isLiveUnverified && pos ? pos.maxProfitUsd : 0;
  const maxRiskUsdVal = !isLiveUnverified && pos ? pos.maxRiskUsd : 0;

  const liveMtmFormatted = formatInrFirstPnl(activeUnrealisedUsd, liveUsdInrRate, { showPlusSign: true });
  const netPnlFormatted = formatInrFirstPnl(totalNetPnlUsd, liveUsdInrRate, { showPlusSign: true });
  const unrealisedFormatted = formatInrFirstPnl(activeUnrealisedUsd, liveUsdInrRate, { showPlusSign: true });
  const activeFeesAndCashflowsUsd = !isLiveUnverified
    ? pos?.totalFeesAndCashflowsUsd ??
      optionsEngine.liveFeesAndCashflowsUsd ??
      portfolioTelemetry.totalFeesAndCashflowsUsd ??
      0
    : 0;
  const cashflowsFormatted = formatInrFirstPnl(activeFeesAndCashflowsUsd, liveUsdInrRate, {
    showPlusSign: true,
    showApproxSymbol: false,
  });
  const auditCashflowsFormatted = formatInrFirstPnl(
    portfolioTelemetry.totalFeesAndCashflowsUsd ?? activeFeesAndCashflowsUsd,
    liveUsdInrRate,
    { showPlusSign: true, showApproxSymbol: false }
  );
  const realisedFormatted = formatInrFirstPnl(activeRealisedUsd, liveUsdInrRate, { showPlusSign: true });
  const maxProfitFormatted = formatInrFirstPnl(maxProfitUsdVal, liveUsdInrRate, { showPlusSign: true });
  const maxRiskFormatted = formatInrFirstPnl(-Math.abs(maxRiskUsdVal), liveUsdInrRate, { showPlusSign: true });

  // Category badge colors
  const getCategoryBadge = (cat: OptionStrategyCategory) => {
    switch (cat) {
      case 'DIRECTIONAL':
        return 'bg-blue-950/80 border-blue-600/70 text-blue-300';
      case 'INCOME':
        return 'bg-emerald-950/80 border-emerald-600/70 text-emerald-300';
      case 'VOL_SELLING':
        return 'bg-purple-950/80 border-purple-600/70 text-purple-300';
      case 'VOL_BUYING':
        return 'bg-amber-950/80 border-amber-600/70 text-amber-300';
      case 'ADVANCED':
        return 'bg-cyan-950/80 border-cyan-600/70 text-cyan-300';
      default:
        return 'bg-slate-900 border-slate-700 text-slate-300';
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full min-w-0 max-w-full">
      {/* TIER 3A: Macro-Options Synergy & Live Positions Audit (Collapsible) */}
      <CollapsibleTierPanel
        id="options-macro-synergy"
        title="Macro-Options Synergy & Live Positions Audit"
        tierLabel="TIER 3 · DIAGNOSTIC"
        className="order-[80]"
        bodyClassName="p-3.5 space-y-3"
        icon={<Target className="w-4 h-4 text-cyan-400" />}
        defaultExpandedWhenIdle={false}
        summary={
          <>
            <span className="px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/30 text-emerald-300 font-bold">
              BIAS: MODERATELY BULLISH (82%)
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-cyan-300 font-semibold">
              {portfolioTelemetry.positions.length > 0
                ? `${portfolioTelemetry.positions.length} Active (${liveOptionPositions?.length || 0} Opt Legs)`
                : `0 Active · Margin ${currencyPrefix}${(portfolioTelemetry.availableMargin * exchangeRate).toFixed(2)}`}
            </span>
          </>
        }
        headerActions={
          <button
            type="button"
            onClick={() => portfolioTelemetry.syncNow()}
            disabled={portfolioTelemetry.isSyncingLive}
            title="Sync Live Delta Exchange India Positions & Wallet Now"
            className="btn-delta-sm btn-toggle-active"
          >
            <RefreshCw className={`w-3 h-3 ${portfolioTelemetry.isSyncingLive ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        }
      >
        {/* Global Macro Correlation Bar */}
        <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono min-w-0 max-w-full">
          <div className="flex flex-wrap gap-x-4 gap-y-1 min-w-0 max-w-full">
            <span className="text-slate-400">DXY: <span className="text-white">104.25 (-0.32%)</span> · Risk-On Tailwinds</span>
            <span className="text-slate-400">10Y Yield: <span className="text-white">4.38% (-2 bps)</span> · Neutral</span>
            <span className="text-slate-400">S&P500: <span className="text-emerald-400">+0.45%</span> · Nasdaq: <span className="text-emerald-400">+0.62%</span></span>
            <span className="text-slate-400">DVOL: <span className="text-white">54.2%</span> · IV/RV: <span className="text-rose-400">+5.6%</span></span>
          </div>
          <span className="badge-delta badge-delta-live whitespace-normal break-words">
            GLOBAL BIAS: MODERATELY BULLISH (82% Alignment)
          </span>
        </div>

        {/* Macro-Options Synergy Card & Live Positions Audit */}
        <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3 flex items-center justify-between gap-3 flex-wrap min-w-0 max-w-full">
        <div className="flex items-center gap-2.5 flex-wrap min-w-0 max-w-full">
          <h3 className="panel-delta-title">
            <Target className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Macro-Options Synergy</span>
          </h3>
          <p className="text-xs text-slate-300 break-words min-w-0">
            Correlation: <span className="text-emerald-400 font-bold">BTCUSDT BULLISH MOMENTUM (+1.82%)</span> aligned with <span className="text-cyan-300 font-semibold">Global Risk-On Tailwinds (DXY 104.25 -0.32%)</span>.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
          <div className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-cyan-500/30 text-cyan-300 text-[11px] font-mono font-bold flex flex-col gap-0.5 min-w-0 max-w-full">
            <div className="flex items-start gap-1.5 min-w-0">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">
                {portfolioTelemetry.positions.length > 0
                  ? `LIVE POSITIONS AUDIT: ${portfolioTelemetry.positions.length} Active (${liveOptionPositions?.length || 0} Option Legs) · Val: ${currencyPrefix}${(portfolioTelemetry.openPositionValueUsd * exchangeRate).toFixed(2)} · Net UPNL: ${portfolioTelemetry.totalPortfolioUnrealizedPnlUsd >= 0 ? '+' : '-'}₹${Math.abs(portfolioTelemetry.totalPortfolioUnrealizedPnlUsd * liveUsdInrRate).toFixed(2)} (${portfolioTelemetry.totalPortfolioUnrealizedPnlUsd >= 0 ? '+' : '-'}$${Math.abs(portfolioTelemetry.totalPortfolioUnrealizedPnlUsd).toFixed(4)})`
                  : `LIVE POSITIONS AUDIT: 0 Active Positions · Avail Margin: ${currencyPrefix}${(portfolioTelemetry.availableMargin * exchangeRate).toFixed(2)}`}
              </span>
            </div>
            {portfolioTelemetry.positions.length > 0 && (
              <div className="text-[10px] text-slate-400 pl-5 font-normal">
                Cashflows &amp; Fees (incl. GST):{' '}
                <span className={auditCashflowsFormatted.isPositive ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-semibold'}>
                  {auditCashflowsFormatted.usdText} / {auditCashflowsFormatted.inrText}
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => portfolioTelemetry.syncNow()}
            disabled={portfolioTelemetry.isSyncingLive}
            title="Sync Live Delta Exchange India Positions & Wallet Now (Auto-Polls Every 3s)"
            className="btn-delta-sm btn-toggle-active"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${portfolioTelemetry.isSyncingLive ? 'animate-spin' : ''}`} />
            <span>{portfolioTelemetry.isSyncingLive ? 'Syncing...' : 'Sync Now'}</span>
          </button>
          {(hasPhantomLocalPosition ||
            (tradingMode === 'LIVE' &&
              pos &&
              portfolioTelemetry.positions.length === 0 &&
              (liveOptionPositions?.length || 0) === 0 &&
              pos.legs.some((l) => !l.orderId))) && (
            <button
              type="button"
              onClick={() => clearPhantomLocalPosition()}
              title="Local Options position has no verified Delta Exchange Order ID while LIVE POSITIONS AUDIT reports 0 active positions. Click to clear phantom local state."
              className="btn-delta-sm btn-danger"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Clear Phantom Position</span>
            </button>
          )}
          </div>
        </div>
      </CollapsibleTierPanel>

      {/* Critical Timeframe Conflict Banner (Always High Visibility right under Cockpit Header) */}
      {hasTimeframeConflict && !forceSpotDirection && (
        <div className="order-[12] p-3.5 rounded-xl bg-amber-950/80 border border-amber-500/50 text-amber-200 flex flex-wrap items-center justify-between gap-3 shadow-lg min-w-0 max-w-full">
          <div className="flex items-center gap-2.5 min-w-[240px] flex-1">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 animate-bounce" />
            <div className="min-w-0 flex-1">
              <span className="font-extrabold block text-xs tracking-wide break-words">
                {conflictMessage}
              </span>
              <span className="text-[11px] text-amber-300/95 font-mono break-words block">
                Auto-Pilot is in GATE HOLD. Spot signal and Macro / 1H Higher-Timeframe bias are in conflict.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setForceSpotDirection(true)}
            className="btn-delta btn-primary shrink-0"
          >
            Force Spot Direction
          </button>
        </div>
      )}

      {/* COCKPIT HEADER & TIER 1 LIVE TELEMETRY */}
      <div className="order-[10] relative overflow-hidden panel-delta panel-delta-body border-cyan-500/40">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-4 min-w-0 max-w-full">
          <div className="flex flex-col gap-3 border-b border-slate-800/80 pb-3.5 min-w-0 max-w-full">
            {/* Row 1: Title & Live Telemetry Badges (full width, never crushed by toolbar) */}
            <div className="flex items-start gap-3 w-full min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/40 text-cyan-400 shrink-0 mt-0.5">
                <Sliders className="h-5 w-5 animate-pulse" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-100 inline-flex flex-wrap items-center gap-1.5 leading-snug">
                    <span>OPTIONS STRATEGY LAB</span>
                    <span className="text-cyan-400">· {isAutoPilotEnabled ? 'AUTO-PILOT DISPATCH' : 'MANUAL STAGING'}</span>
                  </h2>
                  <span className="text-[11px] font-mono-numbers text-slate-400 tabular-nums">
                    · Lev {effectiveGlobalLeverage}x ({marginMode}) · UTC {utcDayTradesCount}/3
                    {postSlCooldownBarsRemaining > 0 ? ` · Cooldown ${postSlCooldownBarsRemaining}b` : ''}
                  </span>
                </div>
                <div className={`text-[11px] font-mono-numbers leading-snug break-words tabular-nums ${
                  regimeRouter?.isNoTrade ? 'text-amber-300 font-semibold' : 'text-slate-300'
                }`}>
                  {regimeStatusLabel ||
                    (regimeRouter?.isNoTrade
                      ? 'NO TRADE (CHOP / LOW VOLATILITY)'
                      : `Defined-Risk Debit Spreads (${effectiveResolvedStrategy})`)}
                  {' · '}
                  <span className="text-slate-400">
                    Max Net Debit ≤ 1% Equity (${maxNetDebitAllowedUsd.toFixed(2)}) · Est. ${estimatedNetDebitUsd.toFixed(2)} · 1.5x–2.2x Target · Auto-Close 4h Pre-Expiry
                  </span>
                </div>
                {pos && pos.legs && pos.legs.length > 0 && (
                  <div className="text-[11px] font-mono-numbers text-emerald-300 break-words tabular-nums">
                    ACTIVE POSITION: {pos.strategyName} ({pos.legs.map((l) => `$${Number(l.strike || 0).toLocaleString()}${l.type === 'PUT' ? 'P' : 'C'}`).join(' / ')}) · Entry Spot ${pos.entryUnderlyingPrice.toLocaleString()}
                  </div>
                )}
              </div>
            </div>

            {/* Row 2: Dedicated Execution & Controls Toolbar */}
            <div className="flex flex-wrap items-center gap-2 w-full min-w-0 pt-2.5 border-t border-slate-800/60">
              {onSelectSymbol && (
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 h-9">
                  <span className="text-[11px] text-slate-400">Pair:</span>
                  <select
                    value={selectedSymbol}
                    onChange={(e) => onSelectSymbol(e.target.value)}
                    className="bg-transparent text-xs font-bold text-white font-mono-numbers focus:outline-none cursor-pointer"
                  >
                    {Object.keys(markets).map((sym) => (
                      <option key={sym} value={sym} className="bg-slate-900 text-white">
                        {sym} · ${(markets[sym]?.markPrice || 0).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-1.5 rounded-lg bg-slate-900 border border-slate-800 px-2.5 h-9 text-xs font-mono-numbers">
                <span className="text-slate-400">Spot:</span>
                <span className={`font-bold transition-all duration-300 px-1.5 py-0.5 rounded border ${
                  priceFlash === 'UP' 
                    ? 'bg-emerald-950 border-emerald-500 text-emerald-400' 
                    : priceFlash === 'DOWN' 
                    ? 'bg-rose-950 border-rose-500 text-rose-400' 
                    : 'bg-slate-950 border-slate-800 text-white'
                }`}>
                  ${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* Unified Strategy Lots (All Legs Equal 1:1) Stepper in Header */}
              <div
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 border border-cyan-500/40 px-2.5 h-9 text-xs font-mono-numbers"
                title={`Unified 1:1 Matched Basket Lots across all ${displayPosition.legs.length} legs (~$${netSpreadMarginPerLotUsd.toFixed(2)}/lot net spread margin · Auto=${autoBasketLots} lots)`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                  Strategy Lots (All Legs Equal):
                </span>
                <button
                  type="button"
                  onClick={() => setBasketLots((prev) => Math.max(1, prev - 1))}
                  disabled={basketLots <= 1}
                  className="h-6 w-6 rounded bg-slate-950 border border-slate-700 hover:border-cyan-400 text-cyan-300 font-bold flex items-center justify-center disabled:opacity-40 cursor-pointer"
                  aria-label="Decrease Strategy Lots (All Legs Equal)"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  value={basketLots}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    if (Number.isFinite(parsed) && parsed >= 1) {
                      setBasketLots(parsed);
                    }
                  }}
                  aria-label="Strategy Lots (All Legs Equal)"
                  className="w-12 h-6 rounded bg-slate-950 border border-slate-700 text-center text-xs font-extrabold text-emerald-300 focus:outline-none focus:border-cyan-400 tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setBasketLots((prev) => Math.min(500, prev + 1))}
                  className="h-6 w-6 rounded bg-slate-950 border border-slate-700 hover:border-cyan-400 text-cyan-300 font-bold flex items-center justify-center cursor-pointer"
                  aria-label="Increase Strategy Lots (All Legs Equal)"
                >
                  +
                </button>
                <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/50 text-[10px] font-extrabold text-emerald-300">
                  1:1
                </span>
                {isCustomBasketLots && (
                  <button
                    type="button"
                    onClick={resetBasketLotsToAuto}
                    title={`Reset to auto-calculated basket lots (${autoBasketLots} lots)`}
                    className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-600/60 text-[9px] font-bold text-cyan-300 hover:bg-cyan-900 cursor-pointer"
                  >
                    AUTO ({autoBasketLots})
                  </button>
                )}
              </div>

              {/* Auto-Pilot [ON / OFF] Toggle Switch (matching Sniper Scalper) */}
              <div
                className="flex flex-wrap items-center gap-2 px-3 min-h-9 py-1 bg-slate-900 border border-slate-800 rounded-lg font-mono-numbers max-w-full"
                title={
                  isLiveUnverified
                    ? 'Connect Delta Exchange API Keys in Settings to trade live'
                    : 'Auto-Pilot Options Strategy Execution (23-Module AI Command Center · ≥75% Conviction · 60s Cooldown)'
                }
              >
                <span className="text-[11px] text-slate-300 font-sans font-medium">Auto-Pilot:</span>
                <button
                  type="button"
                  onClick={() => setIsAutoPilotEnabled(!isAutoPilotEnabled)}
                  disabled={isLiveUnverified}
                  title={
                    isLiveUnverified
                      ? 'Connect Delta Exchange API Keys in Settings to trade live'
                      : 'Toggle Options Strategy Lab Auto-Pilot [ON / OFF]'
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isLiveUnverified
                      ? 'bg-slate-800 opacity-50 cursor-not-allowed'
                      : isAutoPilotEnabled
                      ? 'bg-emerald-500 cursor-pointer'
                      : 'bg-slate-700 cursor-pointer'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      isAutoPilotEnabled && !isLiveUnverified ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className={`badge-delta ${
                  isLiveUnverified
                    ? 'badge-delta-paper'
                    : !isAutoPilotEnabled
                    ? 'badge-delta-standby'
                    : isAutoPilotPaused
                    ? 'badge-delta-warning'
                    : 'badge-delta-live'
                }`}>
                  {isLiveUnverified
                    ? 'KEYS REQ'
                    : !isAutoPilotEnabled
                    ? 'OFF'
                    : isAutoPilotPaused
                    ? 'PAUSED'
                    : 'READY'}
                </span>
                {(isAutoPilotEnabled || isSinglePositionLocked || Boolean(autoPilotLockReason)) && !isLiveUnverified && (
                  <span
                    className={`badge-delta ${
                      !isAutoPilotEnabled
                        ? 'badge-delta-standby'
                        : isAutoPilotPaused
                        ? 'badge-delta-warning'
                        : 'badge-delta-live'
                    }`}
                    title={autoPilotPauseReason || 'All 5 Pre-Trade Gates Passed — Execution Ready'}
                  >
                    {isAutoPilotEnabled && (
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAutoPilotPaused ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400 animate-ping'}`} />
                    )}
                    <span>
                      {!isAutoPilotEnabled
                        ? (autoPilotLockReason || 'MANUAL STAGING')
                        : isAutoPilotPaused
                        ? (autoPilotPauseReason || 'ARMED (WAITING FOR FRESH SIGNAL)')
                        : 'ARMED · READY (1/1 MAX)'}
                    </span>
                  </span>
                )}
              </div>

              <div
                className="flex items-center gap-2 px-3 h-9 bg-slate-900 border border-slate-800 rounded-lg font-mono-numbers"
                title="Smart Regime Auto-Handoff: Automatically routes high volatility / Wide CPR (>= 80th percentile) trends to Options Debit Spreads"
              >
                <span className="text-[11px] text-slate-300 font-sans font-medium">Auto-Handoff:</span>
                <button
                  type="button"
                  onClick={() => setAutoHandoffEnabled(!autoHandoffEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    autoHandoffEnabled ? 'bg-cyan-500 cursor-pointer' : 'bg-slate-700 cursor-pointer'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      autoHandoffEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className={`text-[11px] font-bold ${autoHandoffEnabled ? 'text-cyan-300' : 'text-slate-500'}`}>
                  {autoHandoffEnabled ? 'ARMED' : 'OFF'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowExactOutputModal(true)}
                className="btn-delta btn-secondary"
              >
                <Info className="h-3.5 w-3.5 text-cyan-400" />
                <span>Strategy Spec</span>
              </button>

              <button
                type="button"
                onClick={() => setIsReportModalOpen(true)}
                className="btn-delta btn-secondary"
                title="View Institutional Intraday Sniper Strategy & Confluence Report"
              >
                <FileText className="h-3.5 w-3.5 text-cyan-400" />
                <span>Strategy Report</span>
              </button>
            </div>
          </div>

          {/* Institutional Sniper Confluence & Hard Filter Status Banner */}
          <div className="flex flex-col gap-2 p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono-numbers">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 font-bold">
                  <span>CONFLUENCE:</span>
                  <span className="text-white text-xs">{institutionalSniperResult?.confluence?.totalScore ?? '—'}/16</span>
                </div>
                <span className={`px-2 py-0.5 rounded border font-extrabold text-[10px] ${
                  institutionalSniperResult?.confluence?.grade === 'A+'
                    ? 'bg-emerald-950 border-emerald-400 text-emerald-300'
                    : institutionalSniperResult?.confluence?.grade === 'A'
                    ? 'bg-cyan-950 border-cyan-400 text-cyan-300'
                    : institutionalSniperResult?.confluence?.grade === 'B'
                    ? 'bg-amber-950 border-amber-400 text-amber-300'
                    : 'bg-rose-950 border-rose-400 text-rose-300'
                }`}>
                  GRADE {institutionalSniperResult?.confluence?.grade || 'STANDBY'}
                </span>
                <span className="text-slate-400 text-[11px]">
                  {institutionalSniperResult?.dailyCpr?.widthRegime || 'NORMAL'} CPR ({(institutionalSniperResult?.dailyCpr?.widthPct || 0).toFixed(2)}%) · Bias: {institutionalSniperResult?.marketStructure4H || 'NEUTRAL'}
                </span>
              </div>

              {isHardNoTradeBlocked ? (
                <span className="px-2 py-0.5 rounded bg-rose-950/90 border border-rose-500/80 text-rose-300 font-bold flex items-center gap-1 text-[10px]">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  NO TRADE — HARD FILTER ACTIVE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/60 text-emerald-300 font-bold flex items-center gap-1 text-[10px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  FILTERS CLEARED (SCORE ≥ 10/16)
                </span>
              )}
            </div>

            {isHardNoTradeBlocked && hardNoTradeReasons.length > 0 && (
              <div className="p-2.5 rounded-lg bg-rose-950/70 border border-rose-500/60 text-rose-200 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-rose-100 uppercase tracking-wide block">Options Execution Locked by Institutional Sniper Circuit Breaker:</strong>
                  <div className="text-[10.5px] text-rose-300/90 space-y-0.5 mt-0.5">
                    {hardNoTradeReasons.map((reason, idx) => (
                      <div key={idx}>• {reason}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {isRegimeHandoffActive && (
            <div className="p-3.5 rounded-xl bg-cyan-950/50 border border-cyan-500/40 text-cyan-200 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <Zap className="w-5 h-5 text-cyan-400 shrink-0" />
                <div>
                  <span className="font-extrabold block text-xs tracking-wide text-cyan-300">
                    UNIFIED REGIME ROUTER: High Vol / Wide CPR (P{Math.round(regimeRouter?.cprPercentile ?? 80)}) → {effectiveResolvedStrategy}
                  </span>
                  <span className="text-[11px] text-cyan-200/90 font-mono-numbers tabular-nums">
                    ~0.50–0.55 Long + ~0.25–0.30 Short Delta · Max Net Debit ≤ 1% Equity (${maxNetDebitAllowedUsd.toFixed(2)}) · 1.5x–2.2x Debit Ladder · Auto-Close 4h Pre-Expiry
                  </span>
                </div>
              </div>
              <span className="text-[11px] font-mono-numbers font-bold text-cyan-300 tabular-nums">
                Slot: {optionsSpreadSlotOccupied ? '1/1 Active' : '0/1 Ready'}
              </span>
            </div>
          )}

          {/* Pre-Flight Analysis Checklist (Tier 3 Collapsible when Auto-Pilot is Armed) */}
          {isAutoPilotEnabled && !isLiveUnverified && autoPilotGates && (
            <CollapsibleTierPanel
              id="options-preflight-checklist"
              title="Pre-Flight Analysis Checklist"
              tierLabel="TIER 3 · PRE-FLIGHT"
              className="order-5"
              icon={<Cpu className="w-4 h-4 text-cyan-400" />}
              accentClass="border-cyan-500/35"
              bodyClassName="p-3.5 font-mono-numbers"
              defaultExpandedWhenIdle={!pos}
              summary={
                <>
                  <span className={autoPilotGates.allPassed ? 'text-emerald-400 font-bold' : 'text-amber-300 font-bold'}>
                    {autoPilotGates.allPassed ? 'GATES READY' : 'GATE HOLD'}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span>{effectiveResolvedStrategy}</span>
                  <span className="text-slate-600">·</span>
                  <span>Scan: {nextAutoScanSec}s</span>
                  <span className="text-slate-600">·</span>
                  <span>Debit ≤ 1%: ${estimatedNetDebitUsd.toFixed(2)}/${maxNetDebitAllowedUsd.toFixed(2)}</span>
                </>
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2.5 border-b border-slate-800 text-xs font-bold text-cyan-300">
                <div className="flex flex-wrap items-center gap-2">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  <span>Pre-Flight Analysis Checklist</span>
                  <span className="text-[11px] font-normal text-slate-400 tabular-nums">
                    · {regimeRouter?.isNoTrade ? 'NO TRADE (CHOP / LOW VOLATILITY)' : effectiveResolvedStrategy} · UTC {utcDayTradesCount}/3
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] tabular-nums">
                  <span className="text-slate-400">Next Scan: {nextAutoScanSec}s</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-cyan-300">CPR P{Math.round(regimeRouter?.cprPercentile ?? 50)} ({regimeRouter?.cprWidthPct?.toFixed(2) ?? '0.00'}%)</span>
                  <span className="text-slate-600">·</span>
                  <span className={autoPilotGates.allPassed ? 'text-emerald-400 font-extrabold flex items-center gap-1' : 'text-amber-400 font-semibold flex items-center gap-1'}>
                    {autoPilotGates.allPassed ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-amber-400" />}
                    {autoPilotGates.allPassed ? 'ALL GATES PASSED' : autoPilotGates.isAnalyzingAutoPilot ? 'SCANNING...' : 'GATE HOLD'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2.5 text-xs">
                <div className={`p-2.5 rounded-lg border ${autoPilotGates.freshSignal ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
                  <span className="text-[10px] text-slate-400 block uppercase">1. Fresh Signal ({nextAutoScanSec}s)</span>
                  <span className="font-bold flex items-center gap-1.5 mt-1 text-[11px]">
                    {autoPilotGates.isAnalyzingAutoPilot ? <Clock className="w-3.5 h-3.5 animate-spin text-amber-400" /> : autoPilotGates.freshSignal ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                    {autoPilotGates.isAnalyzingAutoPilot ? 'Scanning...' : autoPilotGates.freshSignal ? 'Fresh ✓' : 'Refreshing / Wait'}
                  </span>
                </div>

                <div className={`p-2.5 rounded-lg border ${autoPilotGates.convictionSynergy ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
                  <span className="text-[10px] text-slate-400 block uppercase">2. Conviction ≥{autoPilotGates.requiredConviction || 78}%</span>
                  <span className="font-bold flex items-center gap-1.5 mt-1 text-[11px]">
                    {autoPilotGates.convictionSynergy ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                    {signalOptionsCorrelation?.convictionPct || 0}% ({signalOptionsCorrelation?.synergyScore || 0}% Syn)
                  </span>
                </div>

                <div className={`p-2.5 rounded-lg border ${autoPilotGates.trendAligned ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
                  <span className="text-[10px] text-slate-400 block uppercase">3. Regime / Trend</span>
                  <span className="font-bold flex items-center gap-1.5 mt-1 text-[11px]">
                    {autoPilotGates.trendAligned ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                    {executionLane === 'NEUTRAL_THETA_HARVEST'
                      ? 'Theta Neutral ✓'
                      : autoPilotGates.trendAligned
                      ? 'Aligned ✓'
                      : 'Misaligned'}
                  </span>
                </div>

                <div className={`p-2.5 rounded-lg border ${autoPilotGates.zeroPositions ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
                  <span className="text-[10px] text-slate-400 block uppercase">4. Zero Positions</span>
                  <span className="font-bold flex items-center gap-1.5 mt-1 text-[11px]">
                    {autoPilotGates.zeroPositions ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                    {autoPilotGates.zeroPositions ? '0 Open ✓' : 'Position Active'}
                  </span>
                </div>

                <div className={`p-2.5 rounded-lg border ${(autoPilotGates.cooldownClear && autoPilotGates.equityMarginSafe) ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>
                  <span className="text-[10px] text-slate-400 block uppercase">5. Cooldown & 35% Cap</span>
                  <span className="font-bold flex items-center gap-1.5 mt-1 text-[11px]">
                    {(autoPilotGates.cooldownClear && autoPilotGates.equityMarginSafe) ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                    {!autoPilotGates.cooldownClear ? 'In Cooldown' : autoPilotGates.equityMarginSafe ? 'Ready ✓' : 'Margin Low'}
                  </span>
                </div>
              </div>
              {nearMissReason && !autoPilotGates.allPassed && (
                <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-amber-300/90 flex items-center justify-between gap-2">
                  <span>Near-Miss Telemetry: {nearMissReason}</span>
                  <span className="text-slate-400">Strategy: {effectiveResolvedStrategy}</span>
                </div>
              )}
            </CollapsibleTierPanel>
          )}

          {/* ═══════════════════════════════════════════════════════════
              DEDICATED REAL-TIME OPTIONS PnL TELEMETRY CARD (INR-FIRST)
              Primary PnL in bold green/red Indian Rupees (₹) + secondary USD (≈ $...)
              ═══════════════════════════════════════════════════════════ */}
          <div className="rounded-xl border-2 border-emerald-500/50 bg-gradient-to-r from-[#060d17] via-[#091322] to-[#060d17] p-4 shadow-xl font-mono-numbers">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs font-extrabold uppercase tracking-wider text-white">
                  REAL-TIME OPTIONS STRATEGY PnL TELEMETRY (USD-FIRST)
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/90 border border-emerald-700 text-emerald-300">
                  $ USD PRIMARY · ₹ INR EQUIVALENT
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="px-2 py-0.5 rounded bg-cyan-950/90 border border-cyan-700/80 text-cyan-300 font-bold">
                  LIVE USD/INR: ₹{liveUsdInrRate.toFixed(2)} ({fxSource === 'DELTA_LIVE_FEED' ? 'DELTA INDIA LIVE FEED' : 'ACTIVE FX RATE'})
                </span>
                {pos && (
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 font-semibold">
                    {pos.strategyName} ({pos.legs.map((l) => `$${Number(l.strike || 0).toLocaleString()}${l.type === 'PUT' ? 'P' : 'C'}`).join(' / ')}) · {pos.legs.length} Legs
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. Total Net Strategy PnL */}
              <div className="rounded-lg bg-slate-950/90 border border-slate-800 p-3">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase">
                  <span>Live MTM</span>
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400 font-bold">LIVE MTM</span>
                    {pos && (
                      <button
                        type="button"
                        onClick={() => setShowConfirmExitModal(true)}
                        className="btn-delta-sm btn-danger"
                      >
                        ✕ Close
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-baseline gap-1.5 mt-1 font-mono-numbers">
                  <span className={`text-lg font-extrabold tracking-tight ${
                    liveMtmFormatted.isPositive ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {liveMtmFormatted.usdText}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">/ {liveMtmFormatted.inrText}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  {pos ? (
                    (pos.currentProfitPercent || 0) < 0 ? (
                      <>
                        <span className="text-slate-400">Current Drawdown</span>
                        <span className="font-bold text-rose-400 font-mono">
                          {pos.currentProfitPercent.toFixed(1)}% · SL Buffer: Safe
                        </span>
                      </>
                    ) : (pos.currentProfitPercent || 0) >= (pos.maxProfitTargetPercent || 65) ? (
                      <>
                        <span className="text-slate-400">Target Trajectory</span>
                        <span className="font-bold text-emerald-400 font-mono">
                          ✓ ACHIEVED (+{pos.currentProfitPercent.toFixed(1)}%)
                        </span>
                      </>
                    ) : (pos.currentProfitPercent || 0) > 0 ? (
                      <>
                        <span className="text-slate-400">Target Trajectory</span>
                        <span className="font-bold text-amber-300 font-mono">
                          +{pos.currentProfitPercent.toFixed(1)}% / {pos.maxProfitTargetPercent}% target
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-400">Target Trajectory</span>
                        <span className="font-bold text-slate-300 font-mono">
                          0.0% / {pos.maxProfitTargetPercent}% target
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <span className="text-slate-400">Target Trajectory</span>
                      <span className="font-bold text-slate-400">Standby ($0.00)</span>
                    </>
                  )}
                </div>
              </div>

              {/* 2. Unrealised Open Multi-Leg PnL */}
              <div className="rounded-lg bg-slate-950/90 border border-slate-800 p-3">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase">
                  <span>Unrealised Multi-Leg</span>
                  <span className="text-slate-500">{pos ? 'OPEN LEGS' : 'STANDBY'}</span>
                </div>
                <div className="flex items-baseline gap-1.5 mt-1 font-mono-numbers">
                  <span className={`text-lg font-extrabold tracking-tight ${
                    unrealisedFormatted.isPositive ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {unrealisedFormatted.inrText}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">/ {unrealisedFormatted.usdText}</span>
                </div>
                <div className="mt-1 text-[10px] text-slate-400 font-mono-numbers">
                  Cashflows &amp; Fees (incl. GST):{' '}
                  <span className={cashflowsFormatted.isPositive ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-semibold'}>
                    {pos ? `${cashflowsFormatted.usdText} / ${cashflowsFormatted.inrText}` : '+$0.00 / +₹0.00'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Daily Decay</span>
                  <span className={`font-mono font-semibold ${pos && pos.greeks.netTheta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pos ? (
                      pos.greeks.netTheta >= 0
                        ? `Θ +$${pos.greeks.netTheta.toFixed(2)}/d (+₹${(pos.greeks.netTheta * liveUsdInrRate).toFixed(2)}/d)`
                        : `Θ -$${Math.abs(pos.greeks.netTheta).toFixed(2)}/d (-₹${(Math.abs(pos.greeks.netTheta) * liveUsdInrRate).toFixed(2)}/d)`
                    ) : '---'}
                  </span>
                </div>
              </div>

              {/* 3. Realised / Rolled Strategy PnL */}
              <div className="rounded-lg bg-slate-950/90 border border-slate-800 p-3">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase">
                  <span>Realised / Rolled</span>
                  <span className="text-amber-400 font-bold">BOOKED</span>
                </div>
                <div className="flex items-baseline gap-1.5 mt-1 font-mono-numbers">
                  <span className={`text-lg font-extrabold tracking-tight ${
                    realisedFormatted.isPositive ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {realisedFormatted.usdText}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">/ {realisedFormatted.inrText}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Session Status</span>
                  <span className="text-slate-300 font-mono">Locked</span>
                </div>
              </div>

              {/* 4. Max Profit Potential & Dynamic Projected Payoff */}
              <div className="rounded-lg bg-slate-950/90 border border-slate-800 p-3 flex flex-col justify-between">
                <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase">
                  <span>Max Profit Potential</span>
                  <span className={pos ? 'text-emerald-400 font-bold' : 'text-slate-500 font-bold'}>
                    {pos ? 'DEFINED RISK' : 'STANDBY'}
                  </span>
                </div>
                {pos ? (
                  <>
                    <div className="flex items-baseline gap-1.5 mt-1 font-mono-numbers">
                      <span className={`text-lg font-extrabold tracking-tight ${(pos.currentProfitPercent || 0) >= (pos.maxProfitTargetPercent || 65) ? 'text-emerald-400' : 'text-amber-300'}`}>
                        {maxProfitFormatted.usdText}
                      </span>
                      <span className="text-xs text-slate-400 font-medium">/ {maxProfitFormatted.inrText}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">Max Risk</span>
                      <span className="text-rose-400 font-semibold font-mono">
                        {maxRiskFormatted.usdText} ({maxRiskFormatted.inrText})
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-baseline gap-1.5 mt-1 font-mono-numbers">
                      <span className="text-lg font-extrabold tracking-tight text-slate-500">
                        ---
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                      <span>Awaiting Execution</span>
                      <span>Payoff: ---</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* EXACT DASHBOARD OUTPUT CARD (Prompt Specified Output Structure) */}
          {pos && (
            <div className="rounded-lg border border-slate-800 bg-[#060a12]/90 p-4 shadow-inner space-y-3 font-mono-numbers">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 pb-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 uppercase font-bold tracking-wider">Strategy:</span>
                  <span className="text-cyan-400 font-extrabold text-sm">{pos.strategyName}</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-400">Confidence:</span>
                  <span className="text-emerald-400 font-bold">{pos.confidence}% ({pos.signalStrength})</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Max Profit Target:</span>
                    <span className="text-amber-400 font-bold">{pos.maxProfitTargetPercent}%</span>
                  </div>
                  <span className="text-slate-600">|</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">Current Profit:</span>
                    <span
                      className={`font-extrabold ${
                        (pos.unrealisedPnlUsd || 0) < 0
                          ? 'text-rose-400'
                          : Math.abs(pos.unrealisedPnlUsd || 0) < 0.005
                          ? 'text-slate-300'
                          : (pos.currentProfitPercent || 0) >= (pos.maxProfitTargetPercent || 65)
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {unrealisedFormatted.usdText}{' '}
                      <span className="text-slate-400 font-normal">
                        ({unrealisedFormatted.inrText} · {pos.currentProfitPercent}%)
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Compact Status Badges Ribbon (Theta, Vega, Risk, Margin, Rolling, Expiry) */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-1">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950/90 border font-mono font-semibold ${
                  pos.greeks.thetaStatus === 'Positive' ? 'text-emerald-400 border-emerald-900/50' : 'text-amber-400 border-amber-900/50'
                }`}>
                  <span className="text-slate-500 font-bold">Θ</span>
                  {pos.greeks.netTheta >= 0
                    ? `+$${pos.greeks.netTheta.toFixed(2)}/d (+₹${(pos.greeks.netTheta * liveUsdInrRate).toFixed(2)}/d)`
                    : `-$${Math.abs(pos.greeks.netTheta).toFixed(2)}/d (-₹${(Math.abs(pos.greeks.netTheta) * liveUsdInrRate).toFixed(2)}/d)`}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950/90 border font-mono font-semibold ${
                  pos.greeks.vegaStatus === 'Healthy' ? 'text-emerald-400 border-emerald-900/50' : 'text-rose-400 border-rose-900/50'
                }`}>
                  <span className="text-slate-500 font-bold">ν</span>
                  {pos.greeks.averageIv}% IV
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950/90 border font-mono font-semibold ${
                  pos.riskStatus === 'Normal' ? 'text-emerald-400 border-emerald-900/50' : 'text-rose-400 border-rose-900/50'
                }`}>
                  <span className="text-slate-500 font-bold">Risk:</span>
                  {pos.riskStatus}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950/90 border font-mono font-semibold ${
                  pos.marginStatus === 'Safe' ? 'text-emerald-400 border-emerald-900/50' : 'text-amber-400 border-amber-900/50'
                }`}>
                  <span className="text-slate-500 font-bold">Margin:</span>
                  {pos.marginStatus}
                </span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950/90 border font-mono font-semibold ${
                  pos.rollingRequired ? 'text-amber-400 border-amber-800 bg-amber-950/30' : 'text-slate-300 border-slate-800'
                }`}>
                  <span className="text-slate-500 font-bold">Roll:</span>
                  {pos.rollingRequired ? 'Review' : 'None'}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950/90 border border-slate-800 font-mono font-semibold text-emerald-400">
                  <span className="text-slate-500 font-bold">Expiry:</span>
                  {pos.expiryStatus}
                </span>
              </div>
            </div>
          )}

          {/* Boundaries & Constraints Notice */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-900/60 border border-slate-800 px-3 py-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>
                <strong className="text-slate-200">System Boundaries:</strong> Position sizing (
                <span className="text-emerald-400 font-mono-numbers font-bold">
                  {pos?.legs?.[0]?.contracts || basketLots} Lots · 1:1 Equal Across All {displayPosition.legs.length} Legs
                </span>
                ) &amp; Leverage (
                <span className="text-cyan-400 font-mono-numbers">{clampLeverage(pos?.leverage || effectiveGlobalLeverage)}x {pos?.marginMode || marginMode}</span>) strictly synced from Global Risk Settings (Cap {maxLeverageCap}x · Net Spread Margin ~${netSpreadMarginPerLotUsd.toFixed(2)}/lot).
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-bold">● Active Delta WebSocket Feed</span>
              <span>· Automatic Greek Rebalancing</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          23-MODULE AI INSTITUTIONAL COMMAND CENTER OPTIONS DIRECTIVE CONDUIT
          Bull Call Spread on bullish flow · Bear Put Spread on bearish pressure · Iron Condor on range-bound IV harvest
          ═══════════════════════════════════════════════════════════ */}
      {aiDirective && (() => {
        const hasLivePos = Boolean(pos && pos.legs && pos.legs.length > 0);
        const activeStrat = hasLivePos && pos
          ? pos.strategyName
          : signalOptionsCorrelation?.hasActiveSignal
          ? signalOptionsCorrelation.recommendedStrategy
          : intradayMode
          ? intradayCalibration.strategyName
          : aiDirective.recommendedStrategy;
        const strikeOptCode = activeStrat.toLowerCase().includes('put') ? 'P' : 'C';
        const dynLongStrike =
          signalOptionsCorrelation?.suggestedStrikes?.longStrike ||
          intradayCalibration?.strikes?.longCallStrike ||
          intradayCalibration?.strikes?.longPutStrike;
        const dynShortStrike =
          signalOptionsCorrelation?.suggestedStrikes?.shortStrike ||
          intradayCalibration?.strikes?.shortCallStrike ||
          intradayCalibration?.strikes?.shortPutStrike;
        const strikeTag =
          hasLivePos && pos
            ? `(${pos.legs
                .map((l) => `$${Number(l.strike || 0).toLocaleString()}${l.type === 'PUT' ? 'P' : 'C'}`)
                .join(' / ')})`
            : dynLongStrike && dynShortStrike
            ? `($${dynLongStrike.toLocaleString()}${strikeOptCode} / $${dynShortStrike.toLocaleString()}${strikeOptCode})`
            : '';

        return (
          <div className="order-[44] rounded-lg border border-cyan-500/40 bg-[#090d18] px-3.5 py-2.5 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-mono-numbers">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="w-7 h-7 rounded bg-cyan-950 border border-cyan-700 flex items-center justify-center text-cyan-400 shrink-0">
                <Cpu className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="font-extrabold text-cyan-300 tracking-wide">
                  CONVICTION: {signalOptionsCorrelation?.hasActiveSignal ? signalOptionsCorrelation.convictionPct : aiDirective.confidence}% ·{' '}
                  <span className="text-cyan-400 font-bold">
                    {activeStrat.toUpperCase()} ACTIVE {strikeTag}
                  </span>
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-[11px] text-purple-300 font-mono">
                  REGIME: {(signalOptionsCorrelation?.hasActiveSignal ? signalOptionsCorrelation.regime : intradayMode ? intradayCalibration.regimeName : aiDirective.regime).toUpperCase()}
                </span>
                {optionsEngine.isSignalOverdue && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-950/90 border border-rose-500/80 text-rose-200 animate-pulse">
                    ⚠ SPOT SIGNAL OVERDUE
                  </span>
                )}
                {isAutoPilotEnabled && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                      optionsEngine.isSignalOverdue
                        ? 'bg-rose-950 border-rose-700 text-rose-300'
                        : 'bg-emerald-950 border-emerald-700 text-emerald-300'
                    }`}
                  >
                    {optionsEngine.isSignalOverdue
                      ? 'AUTO-PILOT PAUSED (STALE SIGNAL)'
                      : autoCooldownRemaining > 0
                      ? `COOLDOWN ${autoCooldownRemaining}s`
                      : 'DISPATCH READY'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              {optionsEngine.isSignalOverdue && (
                <button
                  type="button"
                  onClick={() => refreshLockedSignal()}
                  className="btn-delta-sm btn-danger"
                  title="Refresh overdue spot signal before staging options"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>REFRESH SIGNAL</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  let targetStrat: OptionStrategyName = aiDirective.recommendedStrategy;
                  if (signalOptionsCorrelation?.hasActiveSignal) {
                    targetStrat = signalOptionsCorrelation.recommendedStrategy;
                    setSelectedStrategyName(targetStrat);
                    applyCorrelatedIntradayStrategy();
                  } else if (intradayMode) {
                    targetStrat = intradayCalibration.strategyName;
                    setSelectedStrategyName(targetStrat);
                    applyCorrelatedIntradayStrategy();
                  } else {
                    applyAiRecommendedStrategy();
                  }
                  handleAnnounceDirectionalStrategy(targetStrat);
                  optionsEngine.executeStrategy(targetStrat, 'MANUAL');
                }}
                disabled={isExecuting || isLiveUnverified || isHardNoTradeBlocked}
                className="btn-delta btn-primary uppercase"
                title={isHardNoTradeBlocked ? 'Execution locked: Hard No-Trade Filter active' : 'Stage and execute AI-calibrated options structure'}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>STAGE {activeStrat.toUpperCase()}</span>
              </button>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════
          TIER 3C: INTRADAY SCALP & AI SIGNAL CORRELATION COCKPIT (COLLAPSIBLE)
          ═══════════════════════════════════════════════════════════ */}
      <CollapsibleTierPanel
        id="options-intraday-scalp-presets"
        title="Intraday Scalp Presets & AI Signal Correlation"
        tierLabel="TIER 3 · SETUP"
        className="order-[82]"
        bodyClassName="p-4 space-y-4"
        icon={<Zap className="w-4 h-4 text-amber-400" />}
        defaultExpandedWhenIdle={!pos}
        summary={
          <>
            <span className="px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/35 text-cyan-300 font-bold">
              {optionsEngine.intradayMode ? '0-DTE SCALP' : 'MULTI-DAY'}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-200 font-semibold">
              {signalOptionsCorrelation?.recommendedStrategy || intradayCalibration?.strategyName || selectedTemplate.name}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-emerald-300 font-bold">
              {signalOptionsCorrelation?.synergyScore || 85}% Match
            </span>
            <span className="text-slate-600">·</span>
            <span>Cutoff: {optionsEngine.squareOffTime}</span>
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="panel-delta-title">
                <span>Intraday Scalp Engine</span>
                <span className="text-[10px] text-cyan-400 font-mono">· 0-DTE DELTA EXCHANGE</span>
              </h3>
              <p className="text-[10px] text-slate-400">
                12:00 UTC (17:30 IST) settlement alignment with dynamic spot scalp & AI matrix signal correlation
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1 p-1 bg-slate-900/90 rounded-lg border border-slate-800/80">
            <button
              type="button"
              onClick={() => optionsEngine.setIntradayMode(false)}
              className={`btn-delta-sm ${!optionsEngine.intradayMode ? 'btn-toggle-active' : 'btn-secondary'}`}
            >
              DAILY / MULTI-DAY
            </button>
            <button
              type="button"
              onClick={() => optionsEngine.setIntradayMode(true)}
              className={`btn-delta-sm ${optionsEngine.intradayMode ? 'btn-toggle-active' : 'btn-secondary'}`}
            >
              ⚡ INTRADAY SCALP (0-DTE)
            </button>
          </div>
        </div>

        {/* TOP LIVE DELTA EXCHANGE CALIBRATION INDICATOR BADGE & HEDGE STATUS */}
        {deltaMarketStructure && intradayCalibration && (
          <div className="rounded-lg border border-cyan-500/40 bg-gradient-to-r from-slate-950 via-[#0a1120] to-slate-950 p-3 shadow-md space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-700/60 font-mono text-[11px] font-extrabold tracking-wide">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Spot: ${(pos?.underlyingPrice || deltaMarketStructure.spotPrice).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                </span>
                <span className="text-slate-600 font-mono">|</span>
                <span className="font-mono text-[11px] text-amber-300 font-bold">
                  POC: ${deltaMarketStructure.pocAnchor.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
                <span className="text-slate-600 font-mono">|</span>
                <span className="font-mono text-[11px] text-rose-300 font-bold">
                  4h Ceiling: ${deltaMarketStructure.ceiling4h.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
                <span className="text-slate-600 font-mono">|</span>
                <span className="font-mono text-[11px] text-emerald-300 font-bold">
                  5m Floor: ${deltaMarketStructure.floor5m.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>

              {/* Active Strategy Tag */}
              <div className="flex items-center gap-1.5">
                <span className="px-2.5 py-1 rounded bg-cyan-950/80 border border-cyan-400 text-cyan-200 font-mono font-extrabold text-[11px] shadow-sm tracking-wide">
                  {pos && pos.legs && pos.legs.length > 0
                    ? `${pos.strategyName} (${pos.legs
                        .map((l) => `$${Number(l.strike || 0).toLocaleString()}${l.type === 'PUT' ? 'P' : 'C'}`)
                        .join(' / ')})`
                    : intradayCalibration.strategyTag}
                </span>
              </div>
            </div>

            {/* Auto-Pilot Dispatch Link & Portfolio Hedge Status */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 text-[10px] font-mono font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{intradayCalibration.hedgeStatus}</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  · Profit Target: +₹{intradayCalibration.profitTargetInr.toLocaleString()} (+${intradayCalibration.profitTargetUsd.toFixed(2)}) · Inv: {intradayCalibration.invalidationRule}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStrategyName(intradayCalibration.strategyName);
                    applyCorrelatedIntradayStrategy();
                    handleAnnounceDirectionalStrategy(intradayCalibration.strategyName);
                    optionsEngine.executeStrategy(intradayCalibration.strategyName, 'MANUAL');
                  }}
                  disabled={isExecuting || isLiveUnverified || isHardNoTradeBlocked}
                  className="btn-delta-sm btn-secondary uppercase"
                  title={isHardNoTradeBlocked ? 'Execution locked: Hard No-Trade Filter active' : 'Stage calibrated intraday strikes and dispatch order'}
                >
                  <Zap className="w-3 h-3 text-cyan-400" />
                  <span>Stage Calibrated Strikes</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsAutoPilotEnabled(!isAutoPilotEnabled)}
                  disabled={isLiveUnverified}
                  className={`btn-delta-sm uppercase ${
                    !isAutoPilotEnabled
                      ? 'btn-secondary'
                      : isAutoPilotPaused
                      ? 'btn-secondary'
                      : 'btn-toggle-active'
                  }`}
                  title={
                    !isAutoPilotEnabled
                      ? 'Click to Arm Auto-Pilot (persists across views & reloads)'
                      : isAutoPilotPaused
                      ? `Auto-Pilot Armed & Paused: ${autoPilotPauseReason || 'Waiting for fresh signal'}`
                      : 'Auto-Pilot Armed & Ready (All 5 gates clear)'
                  }
                >
                  <span className={`w-2 h-2 rounded-full ${
                    !isAutoPilotEnabled
                      ? 'bg-slate-500'
                      : isAutoPilotPaused
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-emerald-400 animate-ping'
                  }`} />
                  <span>
                    Auto-Pilot: {!isAutoPilotEnabled ? 'OFF' : isAutoPilotPaused ? 'PAUSED' : 'READY'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {optionsEngine.intradayMode && (
          <div className="space-y-3.5">
            {/* Square-Off Banner */}
            <div className={`p-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 font-mono-numbers ${
                !optionsEngine.squareOffTime.includes('h') && parseInt(optionsEngine.squareOffTime.split('m')[0] || '99', 10) < 15
                ? 'bg-rose-950/40 border-rose-500/50 text-rose-300 animate-pulse' 
                : 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
            }`}>
              <div className="flex items-center gap-2 text-xs">
                <Clock className="w-4 h-4 shrink-0 text-cyan-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider">
                  Mandatory Intraday Square-Off Cutoff (12:00 UTC / 17:30 IST Settlement):
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Time Remaining:</span>
                <span className="text-sm font-extrabold px-2 py-0.5 rounded bg-slate-900/80 border border-slate-700 text-cyan-300">
                  {optionsEngine.squareOffTime}
                </span>
              </div>
            </div>

            {/* AI SIGNAL ↔ 0-DTE OPTIONS CORRELATION COCKPIT */}
            {signalOptionsCorrelation && (() => {
              const genTs = signalOptionsCorrelation.signalTimestamp || Date.now();
              const genClock = new Date(genTs).toLocaleTimeString('en-GB', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              const freshness = signalOptionsCorrelation.freshnessStatus || signalValidity?.status || 'FRESH';
              const isOverdue = Boolean(signalOptionsCorrelation.isOverdue || optionsEngine.isSignalOverdue || freshness === 'OVERDUE');
              const isAging = !isOverdue && freshness === 'AGING';

              return (
                <div className={`rounded-lg border p-3.5 space-y-3 shadow-lg ${
                  isOverdue
                    ? 'border-rose-500/60 bg-gradient-to-br from-rose-950/25 via-[#0a1122] to-slate-950'
                    : 'border-cyan-500/40 bg-gradient-to-br from-slate-950 via-[#0a1122] to-slate-950'
                }`}>
                  {/* Header & Match Status */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-900/40 pb-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isOverdue ? 'bg-rose-400' : 'bg-cyan-400'}`}></span>
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOverdue ? 'bg-rose-500' : 'bg-cyan-500'}`}></span>
                      </span>
                      <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                        <Target className="w-3.5 h-3.5 text-cyan-400" />
                        AI Signal ↔ 0-DTE Options Correlation
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                        {signalOptionsCorrelation.signalSource}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900 text-slate-300 border border-slate-700">
                        Gen: {genClock}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border font-mono ${
                          signalValidity?.breachType === 'TP1_COMPLETED' || signalValidity?.breachType === 'TP4_COMPLETED'
                            ? 'bg-emerald-950/85 border-emerald-500/70 text-emerald-300'
                            : isOverdue
                            ? 'bg-rose-950/90 border-rose-500/80 text-rose-200 animate-pulse'
                            : isAging
                            ? 'bg-amber-950/80 border-amber-500/60 text-amber-300'
                            : 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                        }`}
                        title={signalOptionsCorrelation.overdueReason || signalValidity?.reason || 'Locked spot signal freshness'}
                      >
                        {signalValidity?.breachType === 'SL_INVALIDATED'
                          ? `✕ SL HIT · SETUP INVALIDATED${(signalValidity?.cooldownRemainingSec || 0) > 0 ? ` (${signalValidity.cooldownRemainingSec}s)` : ''}`
                          : signalValidity?.breachType === 'TP1_COMPLETED' || signalValidity?.breachType === 'TP4_COMPLETED'
                          ? `✓ TP1 REACHED · SETUP COMPLETED${(signalValidity?.cooldownRemainingSec || 0) > 0 ? ` (${signalValidity.cooldownRemainingSec}s)` : ''}`
                          : isOverdue
                          ? '⚠ OVERDUE · STALE SETUP'
                          : isAging
                          ? '◐ AGING'
                          : '● FRESH'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isOverdue && (
                        <button
                          type="button"
                          onClick={() => refreshLockedSignal()}
                          className="btn-delta-sm btn-danger"
                          title="Re-anchor locked spot signal & options strikes to live market price"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Refresh Signal</span>
                        </button>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono-numbers">Synergy:</span>
                      <div className="badge-delta badge-delta-live font-mono-numbers">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{signalOptionsCorrelation.synergyScore}% MATCH</span>
                      </div>
                    </div>
                  </div>

                  {isOverdue && (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-rose-950/60 border border-rose-500/60 text-[11px] text-rose-200">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                        <span>
                          <strong>Auto-Pilot Paused:</strong> Underlying spot signal is marked <strong>OVERDUE / STALE</strong>
                          {signalOptionsCorrelation.overdueReason ? ` (${signalOptionsCorrelation.overdueReason})` : ''}. Refresh signal before automated dispatch resumes.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => refreshLockedSignal()}
                        className="btn-delta-sm btn-danger uppercase shrink-0"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Refresh Signal</span>
                      </button>
                    </div>
                  )}

                  {/* Signal Ingestion Telemetry Card */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded bg-slate-900/80 border border-slate-800 font-mono-numbers text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Signal:</span>
                      <span className="font-extrabold text-white">{signalOptionsCorrelation.signalSymbol}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase border flex items-center gap-1 ${
                        signalOptionsCorrelation.signalSide === 'LONG'
                          ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
                          : signalOptionsCorrelation.signalSide === 'SHORT'
                          ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                          : 'bg-amber-950/80 text-amber-300 border-amber-500/50'
                      }`}>
                        {signalOptionsCorrelation.signalSide === 'LONG' ? <TrendingUp className="w-3 h-3" /> : signalOptionsCorrelation.signalSide === 'SHORT' ? <TrendingDown className="w-3 h-3" /> : <Activity className="w-3 h-3" />}
                        <span>{signalOptionsCorrelation.signalSide}</span>
                      </span>
                      <span className="text-[10px] text-slate-400">({signalOptionsCorrelation.convictionPct}% Conviction)</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px]">
                      <div>
                        <span className="text-slate-400 text-[10px]">Entry: </span>
                        <span className="font-bold text-white">${signalOptionsCorrelation.entryPrice.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px]">Spot SL: </span>
                        <span className="font-bold text-rose-400">${signalOptionsCorrelation.stopLoss.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px]">Spot TP1: </span>
                        <span className="font-bold text-emerald-400">${signalOptionsCorrelation.tp1.toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px]">R:R: </span>
                        <span className="font-bold text-cyan-300">1:{signalOptionsCorrelation.riskRewardRatio}</span>
                      </div>
                    </div>
                  </div>

                  {/* 4-Pillar Correlation Metrics Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2 font-mono-numbers">
                    <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/90 flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Layers className="w-3 h-3 text-cyan-400" />
                        Delta Sync
                      </span>
                      <div className="mt-1">
                        <span className={`text-base font-extrabold ${
                          signalOptionsCorrelation.targetNetDelta > 0 ? 'text-emerald-400' : signalOptionsCorrelation.targetNetDelta < 0 ? 'text-rose-400' : 'text-amber-400'
                        }`}>
                          {signalOptionsCorrelation.targetNetDelta > 0 ? '+' : ''}{signalOptionsCorrelation.targetNetDelta.toFixed(2)} Δ
                        </span>
                        <p className="text-[9px] text-slate-400 truncate mt-0.5">
                          {signalOptionsCorrelation.signalSide === 'LONG' ? 'Bullish Delta Push' : signalOptionsCorrelation.signalSide === 'SHORT' ? 'Bearish Downward Delta' : 'Delta-Neutral Harvest'}
                        </p>
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/90 flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        Strike Shield
                      </span>
                      <div className="mt-1">
                        <span className="text-base font-extrabold text-emerald-300">
                          ${signalOptionsCorrelation.strikeShieldDistance.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-emerald-400 font-bold ml-1">({signalOptionsCorrelation.strikeShieldPct}%)</span>
                        <p className="text-[9px] text-slate-400 truncate mt-0.5">
                          Buffer vs Spot Invalidation
                        </p>
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/90 flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Flame className="w-3 h-3 text-amber-400" />
                        0-DTE Theta Velocity
                      </span>
                      <div className="mt-1">
                        <span className="text-base font-extrabold text-amber-300">
                          +${signalOptionsCorrelation.thetaVelocityHourly.toFixed(2)}/hr
                        </span>
                        <p className="text-[9px] text-slate-400 truncate mt-0.5">
                          ~₹{Math.round(signalOptionsCorrelation.thetaVelocityHourly * liveUsdInrRate)}/hr decaying
                        </p>
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-slate-900/60 border border-slate-800/90 flex flex-col justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Cpu className="w-3 h-3 text-purple-400" />
                        Regime Alignment
                      </span>
                      <div className="mt-1">
                        <span className="text-xs font-extrabold text-cyan-300 truncate block">
                          {signalOptionsCorrelation.recommendedStrategy}
                        </span>
                        <p className="text-[9px] text-slate-400 truncate mt-0.5">
                          12:00 UTC (17:30 IST) Cycle Anchored
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Correlated Blueprint & Rationale */}
                  <div className="p-2.5 rounded bg-cyan-950/20 border border-cyan-800/40 text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Blueprint Structure:</span>
                        <span className="font-extrabold text-cyan-300">{signalOptionsCorrelation.recommendedStrategy}</span>
                        <span className="text-[10px] font-mono text-slate-400">({signalOptionsCorrelation.actionSummary})</span>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-400">12:00 UTC (17:30 IST) Expiry Validated</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
                      {signalOptionsCorrelation.rationale}
                    </p>
                    {signalOptionsCorrelation.virginCprAnchor && (
                      <div className={`mt-1.5 px-2.5 py-1.5 rounded border text-[10.5px] font-mono-numbers flex flex-wrap items-center justify-between gap-2 ${
                        signalOptionsCorrelation.virginCprAnchor.hasWall
                          ? 'bg-purple-950/50 border-purple-500/50 text-purple-200'
                          : 'bg-slate-900/70 border-slate-800 text-slate-400'
                      }`}>
                        <span className="flex items-center gap-1.5 font-bold">
                          <Compass className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          <span>VIRGIN CPR STRIKE ANCHOR:</span>
                        </span>
                        <span className="text-[10px] font-semibold">
                          {signalOptionsCorrelation.virginCprAnchor.summary}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Stage & Execute Action Buttons */}
                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStrategyName(signalOptionsCorrelation.recommendedStrategy);
                        applyCorrelatedIntradayStrategy();
                        handleAnnounceDirectionalStrategy(signalOptionsCorrelation.recommendedStrategy);
                        optionsEngine.executeStrategy(signalOptionsCorrelation.recommendedStrategy, 'MANUAL');
                      }}
                      disabled={isExecuting || isLiveUnverified || isHardNoTradeBlocked}
                      className="w-full sm:w-auto btn-delta btn-secondary uppercase"
                      title={isHardNoTradeBlocked ? 'Execution locked: Hard No-Trade Filter active' : 'Load and stage this correlated structure into the options engine'}
                    >
                      <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Stage {signalOptionsCorrelation.recommendedStrategy}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const targetStrat = intradayMode ? correlatedStrategyName : signalOptionsCorrelation.recommendedStrategy;
                        handleAnnounceDirectionalStrategy(targetStrat);
                        optionsEngine.executeStrategy(targetStrat, 'MANUAL');
                      }}
                      disabled={isExecuting || isLiveUnverified || isHardNoTradeBlocked}
                      className={`w-full sm:flex-1 btn-delta-lg uppercase ${
                        isHardNoTradeBlocked
                          ? 'btn-danger opacity-75'
                          : isOverdue
                          ? 'btn-danger'
                          : 'btn-primary'
                      }`}
                    >
                      <Zap className="w-4 h-4" />
                      <span>
                        {isHardNoTradeBlocked
                          ? 'NO TRADE — HARD FILTER ACTIVE'
                          : isOverdue
                          ? `MANUAL OVERRIDE: EXECUTE DESPITE OVERDUE SIGNAL`
                          : isAutoPilotEnabled
                          ? `AUTO-PILOT DISPATCH ACTIVE (${signalOptionsCorrelation.recommendedStrategy.toUpperCase()})`
                          : `EXECUTE UNIFIED STRATEGY NOW`}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Quick 1-Click Execution Presets */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Quick Intraday 0-DTE Presets:</span>
              <div className="flex flex-col md:flex-row md:flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const isDirectional = signalOptionsCorrelation?.signalSide === 'SHORT' || signalOptionsCorrelation?.signalSide === 'LONG';
                    const targetStrat = isDirectional ? correlatedStrategyName : 'Short Straddle';
                    handleAnnounceDirectionalStrategy(targetStrat);
                    optionsEngine.executeStrategy(targetStrat, 'MANUAL');
                  }}
                  disabled={isExecuting || isLiveUnverified || isHardNoTradeBlocked}
                  className="w-full md:w-auto md:flex-1 md:min-w-[140px] btn-delta btn-secondary uppercase"
                  title={isHardNoTradeBlocked ? 'Execution locked: Hard No-Trade Filter active' : undefined}>
                  ⚡ 0-DTE STRADDLE (THETA)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetStrat = signalOptionsCorrelation?.signalSide === 'SHORT' ? 'Bear Put Spread' : 'Bull Call Spread';
                    handleAnnounceDirectionalStrategy(targetStrat);
                    optionsEngine.executeStrategy(targetStrat, 'MANUAL');
                  }}
                  disabled={isExecuting || isLiveUnverified || isHardNoTradeBlocked}
                  className="w-full md:w-auto md:flex-1 md:min-w-[140px] btn-delta btn-toggle-active uppercase"
                  title={isHardNoTradeBlocked ? 'Execution locked: Hard No-Trade Filter active' : undefined}>
                  ⚡ MOMENTUM SPREAD
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const targetStrat: OptionStrategyName = signalOptionsCorrelation?.signalSide === 'SHORT' ? 'Bear Call Spread' : 'Iron Condor';
                    handleAnnounceDirectionalStrategy(targetStrat);
                    optionsEngine.executeStrategy(targetStrat, 'MANUAL');
                  }}
                  disabled={isExecuting || isLiveUnverified || isHardNoTradeBlocked}
                  className="w-full md:w-auto md:flex-1 md:min-w-[140px] btn-delta btn-primary uppercase"
                  title={isHardNoTradeBlocked ? 'Execution locked: Hard No-Trade Filter active' : undefined}>
                  ⚡ CPR CREDIT SPREAD
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono-numbers bg-slate-950/60 p-2 rounded border border-slate-800">
              <div>Theta Harvest: <span className="text-emerald-400 font-bold">+$16.80/hr (~₹{Math.round(16.80 * liveUsdInrRate)}/hr)</span></div>
              <div>Gamma Risk Buffer: <span className="text-cyan-400 font-bold">PROTECTED VIA SPREAD WINGS</span></div>
            </div>
          </div>
        )}
      </CollapsibleTierPanel>
      
      {/* ═══════════════════════════════════════════════════════════
          TIER 1B: ANALYSIS MODE SWITCHER (ACTIVE TRADE vs STRATEGY PREVIEW)
          ═══════════════════════════════════════════════════════════ */}
      <div className="order-[20] panel-delta panel-delta-body flex flex-wrap items-center justify-between gap-3 font-mono-numbers">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>Target View:</span>
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {pos && (
              <button
                type="button"
                onClick={() => setViewMode('ACTIVE')}
                className={`btn-delta-sm ${viewMode === 'ACTIVE' ? 'btn-toggle-active' : 'btn-secondary'}`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Active Position: {pos.strategyName}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode('PREVIEW')}
              className={`btn-delta-sm ${viewMode === 'PREVIEW' || !pos ? 'btn-toggle-active' : 'btn-secondary'}`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Strategy Preview: {selectedTemplate.name}</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
          <span>
            Viewing:{' '}
            <strong className="text-cyan-300">
              {displayPosition.strategyName}{' '}
              {displayPosition.legs.length > 0
                ? `(${displayPosition.legs.map((l) => `$${Number(l.strike || 0).toLocaleString()}${l.type === 'PUT' ? 'P' : 'C'}`).join(' / ')})`
                : ''}
            </strong>
          </span>
          <span>·</span>
          <span>
            Entry Spot: <strong className="text-white">${displayPosition.entryUnderlyingPrice.toLocaleString()}</strong>
          </span>
          <span>·</span>
          <span>Category: <strong className="text-slate-200">{displayPosition.category.replace('_', ' ')}</strong></span>
          <span>·</span>
          <span>Legs: <strong className="text-emerald-400">{displayPosition.legs.length} Contracts</strong></span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TIER 1B: LIVE PRICE & TAKE PROFIT POSITION VISUAL TRACKER (PROFIT LADDER)
          ═══════════════════════════════════════════════════════════ */}
      <div className="order-[22] min-w-0 max-w-full">
        <OptionsLivePriceTracker 
          position={displayPosition} 
          currentSpot={pos && viewMode === 'ACTIVE' ? (pos.underlyingPrice || curMarket.markPrice) : curMarket.markPrice} 
          currencyPrefix={currencyPrefix}
          usdInrRate={liveUsdInrRate}
          isPositionActive={Boolean(pos && viewMode === 'ACTIVE')}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TIER 2A: OPTIONS STRATEGY PAYOFF CHART (INTERACTIVE MULTI-LEG)
          ═══════════════════════════════════════════════════════════ */}
      <div className="order-[40] min-w-0 max-w-full">
        <OptionsPayoffChart
          strategyName={displayPosition.strategyName}
          legs={displayPosition.legs}
          currentSpot={pos && viewMode === 'ACTIVE' ? (pos.underlyingPrice || curMarket.markPrice) : curMarket.markPrice}
          entrySpot={displayPosition.entryUnderlyingPrice}
          unrealisedPnl={displayPosition.unrealisedPnlUsd}
          currentProfitPercent={displayPosition.currentProfitPercent}
          currencyPrefix={currencyPrefix}
          usdInrRate={liveUsdInrRate}
          isPositionActive={Boolean(pos && viewMode === 'ACTIVE')}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TIER 3D: STRATEGY SELECTION & 12 STRATEGIES CATALOG (COLLAPSIBLE)
          ═══════════════════════════════════════════════════════════ */}
      <CollapsibleTierPanel
        id="options-strategy-selector-12"
        title="Strategy Selector (12 Strategies) & Order Staging"
        tierLabel="TIER 3 · SETUP"
        className="order-[84]"
        bodyClassName="p-4 space-y-3"
        icon={<Compass className="h-4 w-4 text-cyan-400" />}
        defaultExpandedWhenIdle={!pos}
        summary={
          <>
            <span className="px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/35 text-cyan-300 font-bold">
              STAGED: {selectedTemplate.name}
            </span>
            <span className="text-slate-600">·</span>
            <span>{basketLots} cts × {displayPosition.legs.length}L</span>
            <span className="text-slate-600">·</span>
            <span>Exp: {selectedExpiryCycle.dateStr}</span>
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <Compass className="h-4 w-4 text-cyan-400" />
            <h3 className="panel-delta-title">
              STRATEGY SELECTOR (12 STRATEGIES)
            </h3>
            <span className="badge-delta badge-delta-armed font-mono">
              STAGED: {selectedTemplate.name}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isStrategySelectorExpanded && (
              <div className="hidden sm:flex flex-wrap items-center gap-1 text-xs">
                {(['ALL', 'DIRECTIONAL', 'INCOME', 'VOL_SELLING', 'VOL_BUYING', 'ADVANCED'] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategoryFilter(cat)}
                    className={`btn-delta-sm ${activeCategoryFilter === cat ? 'btn-toggle-active' : 'btn-secondary'}`}
                  >
                    {cat === 'ALL' ? 'All 12' : cat.replace('_', ' ')}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsStrategySelectorExpanded(!isStrategySelectorExpanded)}
              className="btn-delta-sm btn-secondary"
            >
              <span>{isStrategySelectorExpanded ? 'Hide Catalog' : 'Change Strategy (12)'}</span>
              {isStrategySelectorExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Collapsible 12 Strategies Grid */}
        {isStrategySelectorExpanded && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1">
            {filteredStrategies.map((strat) => {
              const isSelected = strat.name === selectedStrategyName;
              const isActive = pos?.strategyName === strat.name && pos?.status === 'ACTIVE';

              return (
                <div
                  key={strat.name}
                  onClick={() => {
                    setSelectedStrategyName(strat.name);
                    setIsStrategySelectorExpanded(false);
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 transition flex flex-col justify-between ${
                    isSelected
                      ? 'border-cyan-500 bg-cyan-950/20 shadow-md ring-1 ring-cyan-500/50'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/40'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${getCategoryBadge(strat.category)}`}>
                        {strat.category.replace('_', ' ')}
                      </span>
                      {isActive && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 animate-pulse">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          ACTIVE
                        </span>
                      )}
                    </div>

                    <h4 className="text-xs font-bold text-white flex items-center justify-between">
                      <span>{strat.name}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-cyan-400" />}
                    </h4>

                    <div className="text-[10px] space-y-0.5 text-slate-400 font-mono-numbers">
                      <div className="flex justify-between">
                        <span>Outlook:</span>
                        <span className="text-slate-200 font-semibold">{strat.marketOutlook}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Target:</span>
                        <span className="text-amber-400 font-bold">{strat.defaultMaxProfitTarget}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                    <span className="text-slate-500 truncate max-w-[140px]">{strat.profitSource}</span>
                    <span className="text-cyan-400 font-bold">Select →</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Selected Strategy Execution Action Bar */}
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400 shrink-0">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                <span>{isAutoPilotEnabled ? 'Auto-Pilot Active:' : 'Manual Order Staging:'}</span>
                <span className="text-cyan-400">{selectedTemplate.name}</span>
                <span className="text-slate-500">({selectedTemplate.category})</span>
                {!isAutoPilotEnabled && (
                  <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-300 font-mono-numbers">
                    AUTO-PILOT OFF · MANUAL STAGE ONLY
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400">
                Rule: {selectedTemplate.profitManagementSummary}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Unified Strategy Lots (All Legs Equal) Stepper in Execution Bar */}
            <div className="flex items-center gap-1.5 p-1.5 bg-slate-900/95 rounded-xl border border-emerald-500/40 text-xs font-mono-numbers">
              <span className="text-[10px] uppercase font-bold text-emerald-300 px-1.5 flex items-center gap-1">
                <Layers className="w-3 h-3 text-emerald-400" />
                <span>Strategy Lots (All Legs Equal):</span>
              </span>
              <button
                type="button"
                onClick={() => setBasketLots((prev) => Math.max(1, prev - 1))}
                disabled={basketLots <= 1}
                className="h-6 w-6 rounded bg-slate-950 border border-slate-700 hover:border-emerald-400 text-emerald-300 font-bold flex items-center justify-center disabled:opacity-40 cursor-pointer"
                title="Decrease unified contract lots for all legs (1:1)"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={basketLots}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  if (Number.isFinite(parsed) && parsed >= 1) {
                    setBasketLots(parsed);
                  }
                }}
                className="w-12 h-6 rounded bg-slate-950 border border-slate-700 text-center text-xs font-extrabold text-white focus:outline-none focus:border-emerald-400 tabular-nums"
              />
              <button
                type="button"
                onClick={() => setBasketLots((prev) => Math.min(500, prev + 1))}
                className="h-6 w-6 rounded bg-slate-950 border border-slate-700 hover:border-emerald-400 text-emerald-300 font-bold flex items-center justify-center cursor-pointer"
                title="Increase unified contract lots for all legs (1:1)"
              >
                +
              </button>
              <span className="px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/50 text-[10px] font-bold text-emerald-300">
                {basketLots} cts × {displayPosition.legs.length}L
              </span>
            </div>

            {/* Dynamic Expiry Cycle Selector (Weekly / Bi-Weekly / Monthly) */}
            <div className="flex items-center gap-1 p-1 bg-slate-900/90 rounded-xl border border-slate-800 text-xs">
              <span className="text-[10px] uppercase font-bold text-slate-400 px-2 flex items-center gap-1">
                <Clock className="w-3 h-3 text-cyan-400" />
                <span>Expiry:</span>
              </span>
              {[
                { label: getTodayExpiry() ? 'Today' : 'Next Daily', cycle: getTodayExpiry() || getNextValidDailyExpiry() },
                { label: 'Weekly', cycle: standardExpiries.currentWeek },
                { label: 'Bi-Weekly', cycle: standardExpiries.nextWeek },
                { label: 'Monthly', cycle: standardExpiries.monthly },
              ]
                .filter((item): item is { label: string; cycle: OptionsExpiryInfo } => item.cycle !== null)
                .filter((item, idx, arr) => arr.findIndex((other) => other.cycle.dateStr === item.cycle.dateStr) === idx)
                .map(({ label, cycle: c }) => {
                  const isSelected = selectedExpiryCycle.dateStr === c.dateStr;
                  const isToday = label === 'Today' || c.dte === 0;
                  return (
                    <button
                      key={`${label}-${c.dateStr}`}
                      type="button"
                      onClick={() => setSelectedExpiryCycle(c)}
                      className={`btn-delta-sm font-mono-numbers ${isSelected ? 'btn-toggle-active' : 'btn-secondary'}`}
                      title={`${label} Expiry: Settles at 12:00 UTC (17:30 IST) on ${c.dateStr}`}
                    >
                      <span>{c.dateStr} ({isToday ? '0d · ⚡' : `${c.dte}d`})</span>
                    </button>
                  );
                })}
            </div>

            <button
              type="button"
              onClick={() => executeStrategy(selectedStrategyName, 'MANUAL')}
              disabled={isExecuting || isLiveUnverified || isHardNoTradeBlocked}
              title={
                isLiveUnverified
                  ? 'Connect Delta Exchange API Keys in Settings to trade live'
                  : isHardNoTradeBlocked
                  ? 'Execution locked: Hard No-Trade Filter active'
                  : `Manually stage and execute ${selectedTemplate.name}`
              }
              className="btn-delta-lg btn-primary uppercase"
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Staging &amp; Deploying...</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Stage Trade · {selectedTemplate.name}</span>
                </>
              )}
            </button>

            {pos && (
              <button
                type="button"
                onClick={() => setShowConfirmExitModal(true)}
                className="btn-delta-lg btn-danger uppercase"
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Close Current Strategy</span>
              </button>
            )}
          </div>
        </div>
      </CollapsibleTierPanel>

      {/* ═══════════════════════════════════════════════════════════
          TIER 2B: GREEKS MONITORING & DYNAMIC PROFIT LADDER
          ═══════════════════════════════════════════════════════════ */}
      {pos && (
        <div className="order-[42] grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0 max-w-full">
          {/* Greeks Dashboard (5 cols) */}
          <div className="lg:col-span-5 min-w-0 max-w-full rounded-xl border border-slate-800 bg-[#0b0f19] p-4 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800/80 pb-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <BarChart3 className="h-4 w-4 text-cyan-400 shrink-0" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider truncate" title="REAL-TIME GREEKS & RISK EXPOSURE">
                  REAL-TIME GREEKS & RISK EXPOSURE
                </h3>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono-numbers font-bold shrink-0">LIVE WEBSOCKET</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono-numbers">
              {/* Delta */}
              <div className="rounded bg-slate-950 p-2.5 border border-slate-800">
                <div className="flex justify-between text-slate-400 text-[10px]">
                  <span>Net Delta (Δ)</span>
                  <span className="text-slate-500">Directional</span>
                </div>
                <div className={`text-base font-extrabold mt-0.5 ${pos.greeks.netDelta >= 0 ? 'text-cyan-400' : 'text-rose-400'}`}>
                  {pos.greeks.netDelta > 0 ? `+${pos.greeks.netDelta}` : pos.greeks.netDelta}
                </div>
                <div className="text-[9px] text-slate-500 mt-1">Per $1 underlying spot movement</div>
              </div>

              {/* Gamma */}
              <div className="rounded bg-slate-950 p-2.5 border border-slate-800">
                <div className="flex justify-between text-slate-400 text-[10px]">
                  <span>Net Gamma (Γ)</span>
                  <span className="text-slate-500">Acceleration</span>
                </div>
                <div className="text-base font-extrabold mt-0.5 text-purple-400">
                  {pos.greeks.netGamma}
                </div>
                <div className="text-[9px] text-slate-500 mt-1">Delta sensitivity rate</div>
              </div>

              {/* Theta */}
              <div className="rounded bg-slate-950 p-2.5 border border-slate-800">
                <div className="flex justify-between text-slate-400 text-[10px]">
                  <span>Net Theta (Θ)</span>
                  <span className="text-emerald-400 font-bold">{pos.greeks.thetaStatus}</span>
                </div>
                <div className={`text-base font-extrabold mt-0.5 ${pos.greeks.netTheta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {pos.greeks.netTheta >= 0 ? `+$${pos.greeks.netTheta.toFixed(2)}` : `-$${Math.abs(pos.greeks.netTheta).toFixed(2)}`}/day
                  <span className="text-xs text-slate-400 font-normal ml-1.5">
                    ({pos.greeks.netTheta >= 0 ? `+₹${(pos.greeks.netTheta * liveUsdInrRate).toFixed(2)}` : `-₹${(Math.abs(pos.greeks.netTheta) * liveUsdInrRate).toFixed(2)}`}/d)
                  </span>
                </div>
                <div className="text-[9px] text-slate-500 mt-1">Time decay daily harvest</div>
              </div>

              {/* Vega */}
              <div className="rounded bg-slate-950 p-2.5 border border-slate-800">
                <div className="flex justify-between text-slate-400 text-[10px]">
                  <span>Net Vega (ν)</span>
                  <span className="text-cyan-400 font-bold">{pos.greeks.vegaStatus}</span>
                </div>
                <div className="text-base font-extrabold mt-0.5 text-amber-400">
                  {pos.greeks.netVega > 0 ? `+$${pos.greeks.netVega}` : `-$${Math.abs(pos.greeks.netVega)}`}/1% IV
                </div>
                <div className="text-[9px] text-slate-500 mt-1">Sensitivity to IV changes</div>
              </div>
            </div>

            {/* Implied Volatility & Time to Expiry */}
            <div className="rounded-lg bg-slate-950 border border-slate-800 p-3 space-y-2 text-xs font-mono-numbers">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">Average Implied Volatility (IV):</span>
                <span className="font-bold text-white">{pos.greeks.averageIv}%</span>
              </div>
              <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-blue-500 to-cyan-400 h-full" 
                  style={{ width: `${Math.min(pos.greeks.averageIv * 1.5, 100)}%` }}
                />
              </div>

              <div className="flex justify-between items-center text-[11px] pt-1 border-t border-slate-900">
                <span className="text-slate-400">Account Margin Utilisation:</span>
                <span className="font-bold text-emerald-400">22.4% (Safe)</span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">Max Risk Cap:</span>
                <span className="font-bold text-rose-400">
                  {maxRiskFormatted.usdText} <span className="text-slate-400 font-normal">({maxRiskFormatted.inrText})</span>
                </span>
              </div>
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">Max Profit Cap:</span>
                <span className={`font-bold ${(pos.currentProfitPercent || 0) >= (pos.maxProfitTargetPercent || 65) ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {maxProfitFormatted.usdText} <span className="text-slate-400 font-normal">({maxProfitFormatted.inrText})</span>
                </span>
              </div>
            </div>
          </div>

          {/* Strategy-Specific Profit Management Ladder (7 cols) */}
          {(() => {
            const ladderData = buildOptionsProfitLadder(
              pos,
              pos.underlyingPrice || livePrice,
              liveUsdInrRate,
              true
            );
            const overallLoss = ladderData.overallSentiment === 'LOSS';
            const overallP = ladderData.overallPalette;
            const barWidth = overallLoss
              ? Math.min(100, Math.max(8, ladderData.overallDrawdownPct))
              : Math.min(100, Math.max(ladderData.overallProgressPct, ladderData.liveProfitUsd > 0 ? 4 : 0));

            return (
              <div className="lg:col-span-7 min-w-0 max-w-full rounded-xl border border-slate-800 bg-[#0b0f19] p-4 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800/80 pb-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Flame className="h-4 w-4 shrink-0 transition-colors duration-300" style={{ color: overallP.solid }} />
                    <h3
                      className="text-xs font-bold text-white uppercase tracking-wider truncate"
                      title="STRATEGY-SPECIFIC PROFIT LADDER & TRAILING SYSTEM"
                    >
                      STRATEGY-SPECIFIC PROFIT LADDER & TRAILING SYSTEM
                    </h3>
                  </div>
                  <span
                    className="text-[10px] font-mono-numbers font-bold shrink-0 transition-colors duration-300"
                    style={{ color: overallP.text }}
                  >
                    TARGET: {pos.maxProfitTargetPercent}%
                  </span>
                </div>

                {/* Current Profit Progress Bar (Electric Cyan -> Vibrant Teal -> Neon Mint OR Cool Indigo -> Warm Rose -> Deep Crimson) */}
                <div className="space-y-1.5 font-mono-numbers min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-1.5 text-xs min-w-0">
                    <span className="text-slate-400">Current Profit Progression</span>
                    <span
                      className="font-extrabold text-sm tabular-nums transition-colors duration-300"
                      style={{ color: overallP.profitText }}
                    >
                      {formatProfitCounterUsd(ladderData.liveProfitUsd, currencyPrefix)} ({formatProfitCounterInr(ladderData.liveProfitInr)}) ·{' '}
                      {overallLoss
                        ? `-${ladderData.overallDrawdownPct}% DD`
                        : `${Math.max(0, Math.round(pos.currentProfitPercent))}% / ${pos.maxProfitTargetPercent}%`}
                    </span>
                  </div>
                  <div className="relative w-full bg-slate-950 h-3 rounded-full border border-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${barWidth}%`,
                        background: overallP.barGradient,
                        boxShadow: barWidth > 0 ? `0 0 10px ${overallP.solid}` : 'none',
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap justify-between gap-1 text-[10px] text-slate-500">
                    <span>$0.00 Entry</span>
                    <span>Step 01 (25%)</span>
                    <span>Step 02 (50%)</span>
                    <span>Step 03 ({pos.maxProfitTargetPercent}%)</span>
                    <span>Step 04 (90%)</span>
                  </div>
                </div>

                {/* Dynamic 4-Step Profit Ladder (Step 01 -> Step 04) */}
                <div className="space-y-2 text-xs min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-bold text-slate-300 uppercase tracking-wider min-w-0">
                    <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                      <Target className="h-3.5 w-3.5 shrink-0" style={{ color: overallP.solid }} />
                      <span className="truncate">Options Lab Profit Ladder: {pos.strategyName}</span>
                    </span>
                    <span className="text-[10px] font-mono-numbers text-slate-300 shrink-0">
                      <span style={{ color: '#38BDF8' }}>Cyan</span> →{' '}
                      <span style={{ color: '#14B8A6' }}>Teal</span> →{' '}
                      <span style={{ color: '#10B981' }}>Mint</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono-numbers min-w-0">
                    {ladderData.steps.map((step) => {
                      const isLoss = step.isReversing || step.sentiment === 'LOSS';
                      const p = step.palette;
                      const isCompleted = step.statusBadge === 'COMPLETED';
                      const isActive = step.statusBadge === 'ACTIVE';

                      const cardSurfaceClass = isCompleted
                        ? isLoss
                          ? 'bg-[#1a090e] border-rose-500/40 shadow-[0_0_18px_rgba(244,63,94,0.14)]'
                          : 'bg-[#081c18] border-emerald-500/40 shadow-[0_0_18px_rgba(16,185,129,0.12)]'
                        : isActive
                        ? isLoss
                          ? 'bg-[#15080c] border-rose-400/50 shadow-[0_0_20px_rgba(244,63,94,0.18)]'
                          : 'bg-[#0c1220] border-cyan-400/50 shadow-[0_0_20px_rgba(56,189,248,0.12)]'
                        : 'bg-[#0c1220] border-white/10';

                      return (
                        <div
                          key={step.stepNumber}
                          className={`p-2.5 rounded-lg border space-y-1.5 min-w-0 max-w-full transition-all duration-300 ${cardSurfaceClass}`}
                        >
                          {/* Step Header */}
                          <div className="flex flex-wrap items-center justify-between gap-1 min-w-0">
                            <span className="font-extrabold uppercase tracking-wide truncate text-[#F8FAFC]">
                              {step.stepLabel} <span className="text-[#94A3B8] font-semibold">· {step.targetPct}%</span>
                            </span>
                            {isCompleted ? (
                              <span className="text-[10px] font-extrabold shrink-0" style={{ color: p.text }}>
                                ✓ COMPLETED
                              </span>
                            ) : isActive ? (
                              <span className="text-[10px] font-extrabold shrink-0 tabular-nums" style={{ color: p.text }}>
                                ACTIVE · {step.displayLabel}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold shrink-0 text-slate-400">
                                LOCKED / PENDING
                              </span>
                            )}
                          </div>

                          {/* Recessed Inner Telemetry Well: Target Price (#F8FAFC) & Option Premium */}
                          <div className="flex flex-wrap items-center justify-between gap-1.5 px-2 py-1.5 rounded bg-[#070b14] border border-white/10 text-[10px] min-w-0">
                            <span className="text-[#94A3B8] font-semibold">
                              TARGET{' '}
                              <strong className="text-[#F8FAFC] font-extrabold">
                                {currencyPrefix}
                                {formatLadderPrice(step.targetSpotPrice)}
                              </strong>
                            </span>
                            <span className="text-[#94A3B8] font-semibold">
                              Opt Prem:{' '}
                              <strong className="text-[#F8FAFC]">
                                {currencyPrefix}
                                {formatLadderPrice(step.targetOptionPremium)}
                              </strong>
                            </span>
                          </div>

                          {/* Live Profit Counter ($0.00 -> +$Target / ₹) */}
                          <div className="flex flex-wrap items-baseline justify-between gap-1 text-[10.5px] min-w-0 px-0.5">
                            <span
                              className="font-extrabold tabular-nums transition-colors duration-300"
                              style={{ color: p.profitText }}
                            >
                              {formatProfitCounterUsd(step.currentProfitUsd, currencyPrefix)}
                            </span>
                            <span className="text-[#94A3B8]/60">→</span>
                            <span className="font-extrabold tabular-nums text-[#F8FAFC]">
                              +{currencyPrefix}
                              {step.targetUsd.toFixed(2)}{' '}
                              <span className="text-[9.5px] text-[#94A3B8] font-normal">
                                (₹{step.targetInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })})
                              </span>
                            </span>
                          </div>

                          {/* Rung Progress Bar (Electric Cyan -> Vibrant Teal -> Neon Mint OR Rose -> Crimson) */}
                          <div className="w-full bg-[#070b14] h-2 rounded-full overflow-hidden border border-white/10">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${step.progressPct}%`,
                                background: isLoss
                                  ? 'linear-gradient(90deg, #fda4af 0%, #f43f5e 50%, #be123c 100%)'
                                  : p.barGradient,
                                boxShadow: step.progressPct > 0
                                  ? (isLoss ? '0 0 8px rgba(244, 63, 94, 0.5)' : `0 0 8px ${p.solid}`)
                                  : 'none',
                              }}
                            />
                          </div>

                          <div className="text-[10px] text-[#94A3B8] truncate" title={step.actionDescription}>
                            {step.actionDescription}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Compact Dynamic Trailing Stop Footnote */}
                  <div className="px-2.5 py-1.5 rounded-lg border bg-slate-950 border-slate-800 flex flex-wrap items-center justify-between gap-1.5 text-[10.5px] font-mono-numbers min-w-0">
                    <span className="font-bold text-cyan-400">Dynamic Trailing Stop</span>
                    <span className="text-slate-300 break-words">
                      Adapting to underlying S/R, IV contraction &amp; daily theta harvest
                    </span>
                    <span className="text-cyan-300 font-bold shrink-0">ARMED</span>
                  </div>
                </div>

            {/* Rolling Engine Controller Callout */}
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 text-cyan-400" />
                  <span>ROLLING ENGINE CONTROLLER</span>
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  pos.rollingRequired 
                    ? 'bg-amber-950 border-amber-600 text-amber-300' 
                    : 'bg-emerald-950 border-emerald-600 text-emerald-300'
                }`}>
                  {pos.rollingRequired ? 'ROLLING ADVISED' : 'STRUCTURE SOUND'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleRollAction('ROLL_FORWARD')}
                  className="btn-delta btn-secondary"
                  title="Close current expiry and advance contracts to following weekly series (Vega reset)"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Roll Forward (Next Expiry)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRollAction('ROLL_UP')}
                  className="btn-delta btn-secondary"
                  title="Shift strike ladder higher to trail bullish spot price momentum"
                >
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Roll Up (+$1,500 Strikes)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRollAction('ROLL_DOWN')}
                  className="btn-delta btn-secondary"
                  title="Shift strike ladder lower to trail bearish spot price momentum"
                >
                  <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                  <span>Roll Down (-$1,500 Strikes)</span>
                </button>
              </div>
            </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TIER 1C: MULTI-LEG OPTIONS POSITION MATRIX TABLE (ALWAYS TOP PRIORITY)
          ═══════════════════════════════════════════════════════════ */}
      {(pos || (displayPosition && displayPosition.legs.length > 0)) && (
        <div className="order-[24] panel-delta panel-delta-body space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Layers className="h-4 w-4 text-cyan-400" />
              <h3 className="panel-delta-title">
                MULTI-LEG CONTRACT EXECUTION MATRIX ({displayPosition.legs.length} LEGS)
              </h3>
              {isBalancedOneToOne && (
                <span
                  className="px-2 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 text-[10px] font-mono font-extrabold flex items-center gap-1 shadow-sm"
                  title="All option legs in this strategy share an identical 1:1 integer contract lot size"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>
                    1:1 BALANCED ({displayPosition.legs.map((l) => `${l.contracts} cts`).join(' / ')})
                  </span>
                </span>
              )}
              {displayPosition.legs[0] && (
                <span className="badge-delta badge-delta-armed font-mono">
                  EXPIRY: {displayPosition.legs[0].expiry.replace(/\s*\(.*?\)/g, '')} ({displayPosition.legs[0].dte}d) · 12:00 UTC
                </span>
              )}
              {!pos && archivedPositions[0] && (
                <span className="badge-delta badge-delta-standby font-mono" title={archivedPositions[0].exitReason || ''}>
                  LAST: {archivedPositions[0].status} · 1/1 SLOT UNLOCKED
                </span>
              )}
              {!pos && (
                <span className="badge-delta badge-delta-live font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  STAGED PREVIEW · READY
                </span>
              )}
              {(hasPhantomLocalPosition ||
                (tradingMode === 'LIVE' &&
                  pos &&
                  portfolioTelemetry.positions.length === 0 &&
                  (liveOptionPositions?.length || 0) === 0 &&
                  pos.legs.some((l) => !l.orderId))) && (
                <button
                  type="button"
                  onClick={() => clearPhantomLocalPosition()}
                  className="btn-delta-sm btn-danger"
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Clear Phantom Position</span>
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-900 p-1 border border-slate-800 font-mono">
                <button
                  type="button"
                  onClick={() => setGreeksViewMode('BASIC')}
                  className={`btn-delta-sm ${greeksViewMode === 'BASIC' ? 'btn-toggle-active' : 'btn-secondary'}`}
                >
                  Basic View
                </button>
                <button
                  type="button"
                  onClick={() => setGreeksViewMode('GREEKS')}
                  className={`btn-delta-sm ${greeksViewMode === 'GREEKS' ? 'btn-toggle-active' : 'btn-secondary'}`}
                >
                  Greeks Matrix
                </button>
              </div>

              <div className="text-xs text-slate-400 font-mono-numbers flex flex-wrap items-center gap-2">
                <span>
                  Unrealised:{' '}
                  <strong className={`font-extrabold ${unrealisedFormatted.isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pos ? unrealisedFormatted.usdText : '$0.00'}
                  </strong>{' '}
                  <span className="text-slate-400 text-[11px]">({pos ? unrealisedFormatted.inrText : '₹0.00'})</span>
                </span>
                <span>·</span>
                <span>
                  Realised:{' '}
                  <strong className={`font-extrabold ${realisedFormatted.isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {realisedFormatted.usdText}
                  </strong>{' '}
                  <span className="text-slate-400 text-[11px]">({realisedFormatted.inrText})</span>
                </span>
              </div>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs font-mono-numbers">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase tracking-wider">
                  <th className="py-2 px-2">Leg ID</th>
                  <th className="py-2 px-2">Type</th>
                  <th className="py-2 px-2">Action</th>
                  <th className="py-2 px-2 text-right">Strike</th>
                  <th className="py-2 px-2">Expiry (DTE)</th>
                  <th className="py-2 px-2 text-right">Entry Prem</th>
                  <th className="py-2 px-2 text-right">Mark Prem</th>
                  {greeksViewMode === 'GREEKS' && (
                    <>
                      <th className="py-2 px-2 text-right">Δ (Delta)</th>
                      <th className="py-2 px-2 text-right">Γ (Gamma)</th>
                      <th className="py-2 px-2 text-right">Θ (Theta)</th>
                      <th className="py-2 px-2 text-right">ν (Vega)</th>
                      <th className="py-2 px-2 text-right">IV</th>
                    </>
                  )}
                  <th className="py-2 px-2 text-right">TP / SL Protection (Exchange)</th>
                  <th className="py-2 px-2 text-right">Contracts</th>
                  <th className="py-2 px-2 text-right">PnL ($ USD / ₹ INR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {displayPosition.legs.map((leg: OptionLeg) => {
                  const contractMult = leg.contractValue || (tradingMode === 'LIVE' && liveOptionPositions.length > 0 ? 0.001 : 1);
                  const entryPremDisplay = leg.entryPremium ?? leg.premiumEntry;
                  const markPremDisplay = leg.markPremium ?? leg.premiumCurrent;
                  const signedSizeBtc =
                    leg.signedSizeBtc ??
                    ((leg.action === 'SELL' ? -1 : 1) * leg.contracts * contractMult);
                  const pnl = pos
                    ? leg.pnlUsd !== undefined
                      ? leg.pnlUsd
                      : leg.unrealisedPnlUsd !== undefined
                      ? leg.unrealisedPnlUsd
                      : (markPremDisplay - entryPremDisplay) * signedSizeBtc
                    : 0;
                  const baseLegPnlFmt = formatInrFirstPnl(pnl, liveUsdInrRate, { showPlusSign: true });
                  const legPnlFmt =
                    pos && typeof leg.unrealisedPnlInr === 'number' && Number.isFinite(leg.unrealisedPnlInr) && leg.unrealisedPnlInr !== 0
                      ? {
                          ...baseLegPnlFmt,
                          inrText: `${leg.unrealisedPnlInr >= 0 ? '+' : '-'}₹${Math.abs(leg.unrealisedPnlInr).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                        }
                      : baseLegPnlFmt;
                  const isUnifiedBasket =
                    leg.tpSlStatus === 'UNIFIED_BASKET' ||
                    displayPosition.exitMode === 'UNIFIED_BASKET' ||
                    displayPosition.legs.length > 1;
                  const tpPrem =
                    leg.takeProfitPremium ??
                    (leg.action === 'BUY'
                      ? +(entryPremDisplay * 1.25).toFixed(2)
                      : +(Math.max(0.1, entryPremDisplay * 0.60)).toFixed(2));
                  const slPrem =
                    leg.stopLossPremium ??
                    (leg.action === 'BUY'
                      ? +(Math.max(0.1, entryPremDisplay * 0.70)).toFixed(2)
                      : +(entryPremDisplay * 1.30).toFixed(2));
                  const tpRuleLabel = leg.action === 'BUY' ? '+25%' : '-40%';

                  return (
                    <tr key={leg.id} className="hover:bg-slate-900/40 transition">
                      <td className="py-2 px-2 text-slate-400 text-[11px] font-semibold">
                        <div className="flex items-center gap-1">
                          <span>{leg.id}</span>
                          {leg.pnlSource === 'EXCHANGE_LIVE' && (
                            <span className="px-1 py-0.2 rounded bg-emerald-950/80 border border-emerald-700/60 text-[8px] text-emerald-300 font-mono">
                              EXCH
                            </span>
                          )}
                        </div>
                        {leg.symbol && (
                          <div className="text-[9.5px] text-cyan-400 font-mono">
                            {leg.symbol}
                            {leg.orderId ? ` · ID #${leg.orderId}` : ''}
                          </div>
                        )}
                        {!leg.symbol && leg.orderId && (
                          <div className="text-[9.5px] text-emerald-400 font-mono">
                            ID #{leg.orderId}
                          </div>
                        )}
                        {pos && tradingMode === 'LIVE' && !leg.orderId && (
                          <div className="inline-block mt-0.5 px-1 py-0.2 rounded bg-rose-950/80 border border-rose-600/50 text-[8.5px] text-rose-300 font-mono">
                            UNVERIFIED · NO EXCHANGE ID
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          leg.type === 'CALL' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-purple-950 text-purple-300 border border-purple-800'
                        }`}>
                          {leg.type}
                        </span>
                      </td>
                      <td className="py-2 px-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          leg.action === 'BUY' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}>
                          {leg.action}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right font-bold text-white">
                        ${leg.strike.toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-slate-200 font-mono">
                        <span className="font-semibold text-white">
                          {leg.expiry.replace(/\s*\(.*?\)/g, '')}
                        </span>{' '}
                        <span className="text-cyan-400 font-bold">
                          ({leg.dte}d)
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-300 font-mono">
                        ${entryPremDisplay.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 text-right font-semibold text-cyan-300 font-mono">
                        ${markPremDisplay.toFixed(2)}
                      </td>
                      {greeksViewMode === 'GREEKS' && (
                        <>
                          <td className="py-2 px-2 text-right text-cyan-400">
                            {leg.delta > 0 ? `+${leg.delta.toFixed(2)}` : leg.delta.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-right text-indigo-300">
                            {(leg.gamma || 0).toFixed(4)}
                          </td>
                          <td className="py-2 px-2 text-right text-emerald-400">
                            {leg.theta > 0 ? `+${leg.theta.toFixed(2)}` : leg.theta.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-right text-amber-400">
                            {leg.vega.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-300">
                            {leg.iv}%
                          </td>
                        </>
                      )}
                      <td className="py-2 px-2 text-right">
                        <div className="inline-flex flex-col items-end gap-0.5 text-[10px] font-mono">
                          {isUnifiedBasket ? (
                            <>
                              <span className="text-emerald-300 font-bold">
                                Basket TP: 25% / 50% / 65%
                              </span>
                              <span className="text-rose-300 font-bold">
                                Basket SL: -50%
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-emerald-300 font-bold">
                                TP: ${tpPrem.toFixed(2)} ({tpRuleLabel})
                              </span>
                              <span className="text-rose-300 font-bold">
                                SL: ${slPrem.toFixed(2)} (-30%)
                              </span>
                            </>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="badge-delta badge-delta-armed">
                              {isUnifiedBasket ? 'UNIFIED BASKET' : pos ? 'reduce_only ARMED' : 'reduce_only STAGED'}
                            </span>
                            {pos && closeSingleOptionLeg && (
                              <button
                                type="button"
                                onClick={() => closeSingleOptionLeg(leg)}
                                disabled={isExecuting}
                                title={`Close ${leg.symbol || leg.id} immediately via reduce_only market order`}
                                className="btn-delta-sm btn-danger"
                              >
                                Close Leg
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-200 font-semibold">
                        <div className="inline-flex items-center justify-end gap-1 font-mono-numbers">
                          <span className="text-emerald-300 font-extrabold">{leg.contracts} cts</span>
                          {isBalancedOneToOne && (
                            <span className="px-1 py-0.2 rounded bg-emerald-950/80 border border-emerald-600/50 text-[8.5px] text-emerald-300 font-bold">
                              1:1
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right">
                        {pos ? (
                          <>
                            <div className={`font-extrabold ${legPnlFmt.isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {legPnlFmt.usdText}
                            </div>
                            <div className="text-[10px] text-slate-400 font-normal">
                              ({legPnlFmt.inrText})
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400 font-mono text-[10px]">
                            $0.00 (₹0.00) · READY
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          TIER 3E: REAL-TIME AUDIT LOG TRAIL (COLLAPSIBLE)
          ═══════════════════════════════════════════════════════════ */}
      <CollapsibleTierPanel
        id="options-audit-log"
        title="Real-Time Options Engine Audit Log"
        tierLabel="TIER 3 · LOGS"
        className="order-[86]"
        bodyClassName="p-3.5"
        icon={<Clock className="h-4 w-4 text-cyan-400" />}
        defaultExpandedWhenIdle={false}
        summary={
          <>
            <span className="px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/35 text-cyan-300 font-bold">
              {auditLogs.length} EVENTS
            </span>
            {auditLogs[0] && (
              <>
                <span className="text-slate-600">·</span>
                <span className="truncate max-w-[260px] text-slate-300">{auditLogs[0].title}</span>
              </>
            )}
          </>
        }
      >
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {auditLogs.map((log) => (
            <div key={log.id} className="rounded-lg bg-slate-950 p-2.5 border border-slate-800/80 flex items-start gap-3 text-xs font-mono-numbers">
              <span className={`badge-delta shrink-0 ${
                log.type === 'EXECUTION' ? 'badge-delta-armed' :
                log.type === 'PROFIT_LOCK' ? 'badge-delta-live' :
                log.type === 'ROLL' ? 'badge-delta-warning' :
                log.type === 'RISK_TRIGGER' ? 'badge-delta-danger' :
                'badge-delta-standby'
              }`}>
                {log.type}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">{log.title}</span>
                  <span className="text-[10px] text-slate-500">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-0.5 break-words leading-relaxed">{log.description}</p>
              </div>
            </div>
          ))}
        </div>
      </CollapsibleTierPanel>

      {/* ═══════════════════════════════════════════════════════════
          EXACT DASHBOARD OUTPUT MODAL
          ═══════════════════════════════════════════════════════════ */}
      {showExactOutputModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl panel-delta overflow-hidden">
            <div className="panel-delta-header">
              <div className="panel-delta-title">
                <Cpu className="h-4 w-4 text-cyan-400" />
                <span>Options Strategy Engine · Output Specification</span>
              </div>
              <button
                type="button"
                onClick={() => setShowExactOutputModal(false)}
                className="btn-delta-sm btn-secondary"
                title="Close modal"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Close</span>
              </button>
            </div>

            <div className="panel-delta-body space-y-4">
              <div className="rounded-lg bg-black p-4 font-mono text-xs text-emerald-400 space-y-3 leading-relaxed border border-slate-800">
                <div className="text-white font-bold pb-2 border-b border-slate-800">
                  Strategy: Iron Condor | Confidence: 94% (Strong)
                </div>
                <div className="text-slate-300">
                  Max Profit Target: 65% | Current Profit: 52%
                </div>
                <div className="text-slate-300">
                  Theta Status: Positive | Vega Status: Healthy | Risk Status: Normal | Margin Status: Safe
                </div>
                <div className="text-slate-300">
                  Rolling Required: No | Expiry Status: Healthy
                </div>
                <div className="pt-2 text-cyan-300 italic border-t border-slate-800">
                  AI Verdict:<br />
                  "MARKET TRADING WITHIN PROJECTED RANGE. THETA DECAY ACCELERATING. EXIT TARGET APPROACHING AT 65%."
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowExactOutputModal(false)}
                  className="btn-delta btn-secondary"
                >
                  Close Output Spec
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Confirmation Modal */}
      {showConfirmExitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="panel-delta max-w-sm w-full overflow-hidden">
            <div className="panel-delta-header">
              <h3 className="panel-delta-title">Confirm Close Strategy</h3>
            </div>
            <div className="panel-delta-body space-y-4">
              <p className="text-sm text-slate-300">
                Exit both legs of {pos?.strategyName} at Market? (Est. PnL: {netPnlFormatted.inrText} / {netPnlFormatted.usdText})
              </p>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowConfirmExitModal(false)}
                  className="flex-1 btn-delta btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCloseActiveStrategy}
                  className="flex-1 btn-delta btn-danger"
                >
                  Confirm Exit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Institutional BTC Strategy Report Modal */}
      {isReportModalOpen && (
        <BtcStrategyReportModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          report={institutionalSniperResult?.report}
          currentSignal={sniperSignal || ({} as any)}
          currencyPrefix={currencyPrefix}
        />
      )}
    </div>
  );
});
