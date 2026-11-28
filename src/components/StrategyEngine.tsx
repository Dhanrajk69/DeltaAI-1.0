import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { MarketTicker, TradingMode, AiAnalysisResult, SniperSignal, SniperExposureMode, Position } from '../types';
import { Cpu, Crosshair, Sliders, Layers, ArrowUpRight, ShieldCheck, Terminal, X, Zap, ShieldAlert, ChevronDown, Activity, Sparkles, Share2, Check } from 'lucide-react';
import { CamarillaSniperHub } from './CamarillaSniperHub';
import { useSniperScalpingEngine } from '../hooks/useSniperScalpingEngine';
import { OptionsStrategyEngine } from './OptionsStrategyEngine';
import { getMarketTicker, resolveLiveUsdInrRate, formatInrFirstPnl } from '../utils/marketUtils';
import { computeCamarillaLevels, formatCamarillaPrice, calculateAiConsensusScore } from '../utils/camarillaUtils';
import { usePortfolio } from '../context/PortfolioContext';
import { useTradingIntelligence } from '../context/TradingIntelligenceContext';
import { useAiMatrixCorrelation } from '../context/AiMatrixCorrelationContext';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { MaSlopeTrendIndicator } from './MaSlopeTrendIndicator';
import { CollapsibleTierPanel } from './CollapsibleTierPanel';

interface StrategyEngineProps {
  markets: Record<string, MarketTicker>;
  tradingMode: TradingMode;
  selectedSymbol?: string;
  onSelectSymbol?: (sym: string) => void;
  onExecuteTrade: (order: any) => Promise<void>;
  onTriggerAiValidation: (order: any, marketState: any) => Promise<any>;
  onSendNotification: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
  onPlaySound?: () => void;
  currencyPrefix: string;
  exchangeRate: number;
  sniperEngine?: any;
  packetGap?: number;
  aiAnalysis?: AiAnalysisResult | null;
  isAiLoading?: boolean;
  onRefreshAiAnalysis?: (symbol: string, timeframe: string) => Promise<void>;
  onNavigateToAi?: () => void;
  isLiveApiAuthenticated?: boolean;
  onOpenSettings?: () => void;
  positions?: Position[];
  isExchangeHydrated?: boolean;
  appBootTimestamp?: number;
  engineTabRequest?: { tab: 'SNIPER' | 'OPTIONS' | 'COMBINED'; nonce: number } | null;
  onActiveTabChange?: (tab: 'SNIPER' | 'OPTIONS' | 'COMBINED') => void;
}

const StrategyEngineInner: React.FC<StrategyEngineProps & { baseSniper: any }> = React.memo(({
  markets,
  tradingMode,
  selectedSymbol: propSelectedSymbol,
  onSelectSymbol,
  onExecuteTrade,
  onTriggerAiValidation,
  onSendNotification,
  onPlaySound,
  currencyPrefix,
  exchangeRate,
  baseSniper,
  packetGap = 350,
  aiAnalysis,
  isAiLoading = false,
  onRefreshAiAnalysis,
  onNavigateToAi,
  isLiveApiAuthenticated = false,
  onOpenSettings,
  positions = [],
  isExchangeHydrated = true,
  appBootTimestamp,
  engineTabRequest,
  onActiveTabChange,
}) => {
  const {
    defaultLotSize,
    lotSizingMode,
    maxRiskPerTradePct,
    setLotSizingMode,
    getContractsCount,
  } = useCapitalAllocation();
  const [selectedAsset, setSelectedAssetState] = useState<string>(propSelectedSymbol || 'BTCUSDT');

  useEffect(() => {
    if (propSelectedSymbol && propSelectedSymbol !== selectedAsset) {
      setSelectedAssetState(propSelectedSymbol);
    }
  }, [propSelectedSymbol]);

  const setSelectedAsset = useCallback(
    (sym: string) => {
      setSelectedAssetState(sym);
      if (onSelectSymbol) {
        onSelectSymbol(sym);
      }
    },
    [onSelectSymbol]
  );

  const [activeEngineTab, setActiveEngineTabState] = useState<'SNIPER' | 'OPTIONS' | 'COMBINED'>('SNIPER');
  const setActiveEngineTab = useCallback(
    (tab: 'SNIPER' | 'OPTIONS' | 'COMBINED') => {
      setActiveEngineTabState(tab);
      onActiveTabChange?.(tab);
    },
    [onActiveTabChange]
  );
  useEffect(() => {
    if (engineTabRequest?.tab) {
      setActiveEngineTabState(engineTabRequest.tab);
      onActiveTabChange?.(engineTabRequest.tab);
    }
  }, [engineTabRequest, onActiveTabChange]);
  const [localSignalStandby, setLocalSignalStandby] = useState<boolean>(false);
  const [isToolsDropdownOpen, setIsToolsDropdownOpen] = useState<boolean>(false);
  const toolsDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isToolsDropdownOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (toolsDropdownRef.current && !toolsDropdownRef.current.contains(event.target as Node)) {
        setIsToolsDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsToolsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isToolsDropdownOpen]);

  const [validatorStatus, setValidatorStatus] = useState<{
    validated: boolean;
    message: string;
    timestamp: number;
  } | null>(null);
  const [isSignalCopied, setIsSignalCopied] = useState<boolean>(false);

  const { latestDispatchedSignal, clearLatestDispatchedSignal, getCooldownRemaining } = useTradingIntelligence();
  const {
    aiMatrixScore,
    correlatedSignal,
    lockedActiveSignal,
    signalValidity,
    refreshLockedSignal,
    riskEvaluation,
    applyMatrixSignalToPad,
    maSlopeData,
  } = useAiMatrixCorrelation();

  const isLiveUnverified = tradingMode === 'LIVE' && !isLiveApiAuthenticated;

  const activePosition = !isLiveUnverified &&
    baseSniper.activeTrade &&
    !['STOPPED_OUT', 'COMPLETED', 'REVERSED', 'TIME_EXIT'].includes(baseSniper.activeTrade.tradeStatus)
      ? baseSniper.activeTrade
      : null;

  const {
    setIsSignalStandby: setSniperSignalStandby,
    confirmSignalHydration: confirmSniperSignalHydration,
    addLog: addSniperLog,
    executeSniperTrade,
    isSignalStandby: sniperSignalStandby,
    isAutoSniperEnabled: sniperAutoEnabled,
    isExecuting: sniperIsExecuting,
    bypassHtfFilter: sniperBypassHtfFilter,
    pairCooldowns: sniperPairCooldowns,
    lastAutoExecutedSignalId: sniperLastAutoSignalId,
  } = baseSniper;

  // Detect any transition of activePosition from open -> null (TP hit, SL triggered, or manual close)
  // and immediately wipe trade levels back to placeholder dashes ("---")
  const prevActivePositionIdRef = useRef<string | null>(activePosition?.id || null);
  useEffect(() => {
    const currentId = activePosition?.id || null;
    if (prevActivePositionIdRef.current && !currentId) {
      setLocalSignalStandby(true);
      setSniperSignalStandby?.(true);
    }
    prevActivePositionIdRef.current = currentId;
  }, [activePosition?.id, setSniperSignalStandby]);

  // Clear local standby when user changes asset, direction, exposure mode, or signal source
  useEffect(() => {
    setLocalSignalStandby(false);
    confirmSniperSignalHydration?.();
  }, [selectedAsset, baseSniper.directionMode, baseSniper.exposureMode, baseSniper.signalSource, confirmSniperSignalHydration]);

  const handleConfirmSignal = useCallback(() => {
    setLocalSignalStandby(false);
    confirmSniperSignalHydration?.();
  }, [confirmSniperSignalHydration]);

  // Compute Camarilla Pivot levels (H1–H5, L1–L5, plus H6/L6 terminal) from the active asset's daily/session data
  const activeMarket = getMarketTicker(markets, selectedAsset);
  const effectiveDirection: 'LONG' | 'SHORT' = useMemo(() => {
    if (baseSniper.directionMode && baseSniper.directionMode !== 'AUTO') {
      return baseSniper.directionMode;
    }
    if (lockedActiveSignal && lockedActiveSignal.symbol === selectedAsset) {
      return lockedActiveSignal.direction;
    }
    const curP = activeMarket.markPrice || 81702.50;
    const hi24 = activeMarket.high24h || curP * 1.01;
    const lo24 = activeMarket.low24h || curP * 0.99;
    const vwap = (hi24 + lo24 + curP * 2) / 4;
    const ema50 = curP / (1 + ((activeMarket.change24h || 0) / 100) * 0.40);
    // When price is above 1H EMA50 / VWAP, align AUTO with the bullish HTF trend
    if (curP >= ema50 || curP >= vwap) {
      return 'LONG';
    }
    if (latestDispatchedSignal && latestDispatchedSignal.symbol === selectedAsset && baseSniper.signalSource === 'COMMAND_CENTER') {
      return latestDispatchedSignal.direction;
    }
    if (baseSniper.signalSource === 'COMMAND_CENTER' && aiAnalysis?.tradeCard?.action) {
      return aiAnalysis.tradeCard.action === 'BUY_LONG' ? 'LONG' : 'SHORT';
    }
    return activeMarket.change24h >= 0 ? 'LONG' : 'SHORT';
  }, [baseSniper.directionMode, baseSniper.signalSource, lockedActiveSignal, latestDispatchedSignal, selectedAsset, aiAnalysis, activeMarket.change24h, activeMarket.markPrice, activeMarket.high24h, activeMarket.low24h]);

  const { camarilla, targets: camarillaTargets } = useMemo(
    () => computeCamarillaLevels(activeMarket, effectiveDirection),
    [activeMarket, effectiveDirection]
  );

  const exposureMode: SniperExposureMode = baseSniper.exposureMode || 'MACRO';
  // When Auto-Pilot is armed, signal standby is automatically bypassed
  const isSignalStandbyActive = Boolean(!baseSniper.isAutoSniperEnabled && (localSignalStandby || baseSniper.isSignalStandby || isLiveUnverified));

  useEffect(() => {
    if (!sniperAutoEnabled) return;
    if (localSignalStandby) {
      setLocalSignalStandby(false);
    }
    if (sniperSignalStandby) {
      confirmSniperSignalHydration?.();
    }
  }, [sniperAutoEnabled, localSignalStandby, sniperSignalStandby, confirmSniperSignalHydration]);

  // Unified Live USD/INR conversion rate synchronized globally via shared PortfolioContext
  const portfolioTelemetry = usePortfolio();
  const liveUsdInrRate = portfolioTelemetry.usdInrRate || resolveLiveUsdInrRate(markets, 85.0).rate;
  const sniperUnrealizedPnlUsd = !isLiveUnverified ? portfolioTelemetry.sniperUnrealizedPnlUsd : 0;
  const sniperSessionRealizedUsd = !isLiveUnverified ? portfolioTelemetry.sniperRealizedPnlUsd : 0;
  const sniperNetSessionPnlUsd = sniperUnrealizedPnlUsd + sniperSessionRealizedUsd;
  const sniperNetSessionPnlFmt = formatInrFirstPnl(sniperNetSessionPnlUsd, liveUsdInrRate, { showPlusSign: true });

  // Synchronize currentSignal with the active asset's Camarilla Pivot targets & Exposure Mode:
  // - Only hydrate Entry, SL, and TP1–TP4 when the signal meets >= 75% conviction, passes all pre-entry risk gates,
  //   and is not in 'STANDBY / SCANNING' or post-exit state.
  // - Keep Camarilla reference levels (H4, H3, L3, L4, H5, L5) visible on the HUD at all times.
  const camarillaSniperSignal: SniperSignal = useMemo(() => {
    const base: SniperSignal = baseSniper.currentSignal;
    if (base.sniperStrategyMode === 'EMA_9_21_MOMENTUM_5M') {
      const manualOverride =
        typeof baseSniper.manualLotSize === 'number' && baseSniper.manualLotSize > 0
          ? baseSniper.manualLotSize
          : null;
      const lotSize = manualOverride ?? (base.lotSize > 0 ? base.lotSize : defaultLotSize);
      const syncedContractsCount =
        manualOverride !== null
          ? getContractsCount(selectedAsset, lotSize)
          : (base.contractsCount ?? getContractsCount(selectedAsset, lotSize));
      const isPairInCooldown = Date.now() < (baseSniper.pairCooldowns?.[selectedAsset] || 0);
      const isOverdueSignal = !activePosition && signalValidity?.status === 'OVERDUE';
      const isBypassActive = tradingMode === 'PAPER' && (baseSniper.bypassHtfFilter ?? false);
      const filtersPassed = base.ema921Cross?.filtersPassed ?? false;
      const isHardBlocked = Boolean(
        isLiveUnverified ||
        isOverdueSignal ||
        isPairInCooldown ||
        base.riskChecks?.marginUtilizationSafe === false ||
        (!filtersPassed && !isBypassActive)
      );
      const tradeApproved = !isHardBlocked && (Boolean(base.riskChecks?.tradeApproved) || isBypassActive);
      const executionStatus: 'TRADE APPROVED' | 'ARMED_CONDITIONAL' | 'STANDBY' | 'TRADE BLOCKED' =
        isHardBlocked
          ? 'TRADE BLOCKED'
          : tradeApproved
          ? 'TRADE APPROVED'
          : 'STANDBY';
      return {
        ...base,
        symbol: selectedAsset,
        lotSize,
        contractsCount: syncedContractsCount,
        requestedLotSize: base.requestedLotSize ?? defaultLotSize,
        lotSizingMode: base.lotSizingMode ?? lotSizingMode,
        manualLotSizeOverride: manualOverride ?? base.manualLotSizeOverride ?? null,
        camarilla: {
          ...camarilla,
          cpr5mWidthPct: base.cpr5mWidthPct ?? base.camarilla?.cpr5mWidthPct ?? camarilla.cpr5mWidthPct,
          cpr4hWidthPct: base.cpr4hWidthPct ?? base.camarilla?.cpr4hWidthPct ?? camarilla.cpr4hWidthPct,
          cpr5m: base.camarilla?.cpr5m ?? camarilla.cpr5m,
          cpr4h: base.camarilla?.cpr4h ?? camarilla.cpr4h,
        },
        isHydrated: !isHardBlocked && (!isSignalStandbyActive || baseSniper.isAutoSniperEnabled || isBypassActive),
        isStandby: isSignalStandbyActive,
        riskChecks: {
          ...base.riskChecks,
          cooldownPassed: !isPairInCooldown,
          bypassActive: isBypassActive,
          executionStatus,
          tradeApproved,
        },
      };
    }
    const isLong = effectiveDirection === 'LONG';
    const { entryPrice: rawEntryPrice, stopLoss: rawInitialStopLoss } = camarillaTargets;

    // Dynamically bind confidence and R:R directly to the active 23-Module AI Command Consensus score
    const consensusResult = calculateAiConsensusScore(
      activeMarket,
      isLong,
      baseSniper.signalSource === 'COMMAND_CENTER' ? aiAnalysis : null,
      selectedAsset
    );
    const dynamicConfidence = consensusResult.confidence;
    const dynamicConfidenceStatus = consensusResult.confidenceStatus;
    const dynamicRrRatio = consensusResult.riskRewardRatio;
    const dynamicRrNumeric = consensusResult.riskRewardNumeric;

    const effectiveExpMode: SniperExposureMode =
      base.isNarrow5mCprAutoRouted || base.isNarrow5mCpr ? 'MICRO_15' : exposureMode;
    const isNarrowCprAutoMicro = Boolean(
      base.isNarrow5mCprAutoRouted ||
        base.isNarrow5mCpr ||
        base.riskChecks?.narrowCprOverrideActive ||
        effectiveExpMode === 'MICRO_15'
    );

    // Single Source of Truth: Strictly honor manual lot override or Risk Settings lot size from Sniper Engine
    const manualOverride =
      typeof baseSniper.manualLotSize === 'number' && baseSniper.manualLotSize > 0
        ? baseSniper.manualLotSize
        : null;
    const lotSize = manualOverride ?? (base.lotSize > 0 ? base.lotSize : defaultLotSize);
    const syncedContractsCount =
      manualOverride !== null
        ? getContractsCount(selectedAsset, lotSize)
        : (base.contractsCount ?? getContractsCount(selectedAsset, lotSize));

    const hasUnifiedRouterBrackets =
      Boolean(base.regimeRouter) &&
      base.entryPrice > 0 &&
      base.initialStopLoss > 0 &&
      base.tp1 > 0 &&
      base.tp2 > 0;

    const hasBaseMicroBrackets =
      (hasUnifiedRouterBrackets || isNarrowCprAutoMicro) &&
      base.entryPrice > 0 &&
      base.initialStopLoss > 0 &&
      base.tp1 > 0 &&
      base.tp2 > 0;

    let rawTp1 = hasBaseMicroBrackets ? base.tp1 : camarillaTargets.tp1;
    let rawTp2 = hasBaseMicroBrackets ? base.tp2 : camarillaTargets.tp2;
    let rawTp3 = hasBaseMicroBrackets ? base.tp3 : camarillaTargets.tp3;
    let rawTp4 = hasBaseMicroBrackets ? base.tp4 : camarillaTargets.tp4;

    if (!hasUnifiedRouterBrackets && effectiveExpMode === 'MICRO_15' && !hasBaseMicroBrackets) {
      rawTp1 = formatCamarillaPrice(isLong ? rawEntryPrice * 1.0035 : rawEntryPrice * 0.9965, activeMarket.markPrice);
      rawTp2 = formatCamarillaPrice(isLong ? rawEntryPrice * 1.0065 : rawEntryPrice * 0.9935, activeMarket.markPrice);
      rawTp3 = formatCamarillaPrice(isLong ? rawEntryPrice * 1.0095 : rawEntryPrice * 0.9905, activeMarket.markPrice);
      rawTp4 = formatCamarillaPrice(isLong ? rawEntryPrice * 1.0125 : rawEntryPrice * 0.9875, activeMarket.markPrice);
    } else if (!hasUnifiedRouterBrackets && effectiveExpMode === 'MICRO_50') {
      const d1 = 25.00 / lotSize;
      const d2 = 50.00 / lotSize;
      const d3 = 100.00 / lotSize;
      const d4 = 150.00 / lotSize;
      if (isLong) {
        rawTp1 = formatCamarillaPrice(rawEntryPrice + d1, activeMarket.markPrice);
        rawTp2 = formatCamarillaPrice(rawEntryPrice + d2, activeMarket.markPrice);
        rawTp3 = formatCamarillaPrice(rawEntryPrice + d3, activeMarket.markPrice);
        rawTp4 = formatCamarillaPrice(rawEntryPrice + d4, activeMarket.markPrice);
      } else {
        rawTp1 = formatCamarillaPrice(rawEntryPrice - d1, activeMarket.markPrice);
        rawTp2 = formatCamarillaPrice(rawEntryPrice - d2, activeMarket.markPrice);
        rawTp3 = formatCamarillaPrice(rawEntryPrice - d3, activeMarket.markPrice);
        rawTp4 = formatCamarillaPrice(rawEntryPrice - d4, activeMarket.markPrice);
      }
    }

    const supportResistanceValid = isLong
      ? camarilla.h4 > 0 && camarilla.h3 > 0
      : camarilla.l4 > 0 && camarilla.l3 > 0;

    // Requirement 1 & 2: Bypass HTF Filter & Softened Invalidation Threshold
    const isBypassActive = tradingMode === 'PAPER' && (baseSniper.bypassHtfFilter ?? false);

    const isWideCpr = camarilla.isWideCpr ?? (camarilla.cprWidthRatio ? camarilla.cprWidthRatio > 0.0035 : false);
    const narrowCprOverrideActive = Boolean(
      base.riskChecks?.narrowCprOverrideActive ||
        base.isNarrow5mCpr ||
        base.isNarrow5mCprAutoRouted
    );
    const cprFilterPassed = isBypassActive || narrowCprOverrideActive || !isWideCpr;
    const candleConfirmed = base.validation?.candleConfirmed ?? true;

    const currentPairCooldown = baseSniper.pairCooldowns?.[selectedAsset] || 0;
    const isPairInCooldown = Date.now() < currentPairCooldown;
    const cooldownRemainingSec = Math.max(0, Math.ceil((currentPairCooldown - Date.now()) / 1000));
    const cooldownPassed = !isPairInCooldown;

    const markPrice = activeMarket.markPrice || 81702.50;
    const high24h = activeMarket.high24h || markPrice * 1.01;
    const low24h = activeMarket.low24h || markPrice * 0.99;
    const vwap5m = (high24h + low24h + markPrice * 2) / 4;
    const ema50_1h = markPrice / (1 + ((activeMarket.change24h || 0) / 100) * 0.40);
    const camarillaL3 = camarilla.l3 || markPrice * 0.995;

    const confidenceAboveMin = dynamicConfidence >= 75 && dynamicConfidenceStatus !== 'No Trade';

    const htfTrendPass = isLong ? (markPrice >= ema50_1h && markPrice >= camarillaL3) : (markPrice <= ema50_1h);
    const vwapPass = isLong ? (markPrice >= vwap5m) : (markPrice <= vwap5m);

    let htfTrendLock = false;
    let htfDivergenceWarning = false;
    let htfVetoStatus = '';

    if (!htfTrendPass || !vwapPass) {
      if (isBypassActive) {
        htfTrendLock = false;
        htfVetoStatus = 'BYPASS (OVERRIDE): HTF / VWAP Guard bypassed for Paper Demo testing.';
      } else if (confidenceAboveMin) {
        // Soften Gate #1: Treat HTF Trend and VWAP divergence as advisory WARNING rather than hard FAIL
        htfDivergenceWarning = true;
        htfTrendLock = false;
        htfVetoStatus = isLong
          ? 'ADVISORY WARNING: Sub-VWAP / HTF Pullback with AI Conviction >= 75%. Execution conditional.'
          : 'ADVISORY WARNING: Price above 1H EMA50 / VWAP with AI Conviction >= 75%. Execution conditional.';
      } else {
        htfTrendLock = true;
        htfVetoStatus = isLong
          ? (markPrice < ema50_1h ? 'HTF TREND VETO: Downtrend active, long entries suppressed' : 'VWAP VETO: Price trading below Session VWAP. Sellers in control of volume.')
          : 'HTF TREND VETO: Price above 1H EMA50 and VWAP. Short entries prohibited.';
      }
    }

    const signalValidationPassed =
      isBypassActive ||
      (confidenceAboveMin &&
        supportResistanceValid &&
        candleConfirmed &&
        cprFilterPassed &&
        !htfTrendLock &&
        (base.validation?.higherTimeframeTrend ?? true) &&
        (base.validation?.vwapAlignment ?? true) &&
        (base.validation?.emaStructure ?? true) &&
        (base.validation?.volumeConfirmation ?? true) &&
        (base.validation?.rsiMomentum ?? true) &&
        (base.validation?.marketSentiment ?? true) &&
        (base.validation?.riskRewardThreshold ?? true));

    const marginUtilizationSafe = base.riskChecks?.marginUtilizationSafe ?? true;
    const microAntiChopPassed =
      effectiveExpMode === 'MICRO_15' ? (base.riskChecks?.microAntiChopPassed ?? true) : true;

    const sufficientMargin =
      !isLiveUnverified &&
      marginUtilizationSafe &&
      ((base.riskChecks?.sufficientMargin ?? true) || effectiveExpMode === 'MICRO_50' || effectiveExpMode === 'MICRO_15');
    const riskLimitsNotBreached =
      !isLiveUnverified &&
      microAntiChopPassed &&
      (base.riskChecks?.riskLimitsNotBreached ?? true);
    const otherGatesPassed =
      !isLiveUnverified &&
      confidenceAboveMin &&
      sufficientMargin &&
      riskLimitsNotBreached &&
      (base.riskChecks?.positionSizeReceived ?? true) &&
      (base.riskChecks?.deltaLeverageAvailable ?? true);

    const allRiskGatesPassed =
      otherGatesPassed &&
      signalValidationPassed &&
      candleConfirmed &&
      cprFilterPassed &&
      cooldownPassed &&
      marginUtilizationSafe &&
      microAntiChopPassed &&
      !htfTrendLock;

    const isOverdueSignal = !activePosition && signalValidity?.status === 'OVERDUE';
    const isGate1Fail = !isBypassActive && !signalValidationPassed && !htfDivergenceWarning;
    const isWideCprBlocked = isWideCpr && !narrowCprOverrideActive && !isBypassActive;
    const isUnifiedRouterNoTrade = Boolean(base.regimeRouter?.isNoTrade);
    const isHardBlocked =
      isLiveUnverified ||
      isOverdueSignal ||
      isGate1Fail ||
      isWideCprBlocked ||
      !marginUtilizationSafe ||
      !microAntiChopPassed ||
      (isUnifiedRouterNoTrade && !isBypassActive);

    // Gate #7: Strictly block execution when Overdue, Gate 1 fails, or Wide CPR suppresses breakouts (unless Narrow 5m/15m CPR override or Bypass is active)
    const tradeApproved = !isHardBlocked && (allRiskGatesPassed || (isBypassActive && otherGatesPassed));
    const isArmedConditional = !isHardBlocked && !allRiskGatesPassed && otherGatesPassed && htfDivergenceWarning;
    const executionStatus: 'TRADE APPROVED' | 'ARMED_CONDITIONAL' | 'STANDBY' | 'TRADE BLOCKED' =
      isHardBlocked
        ? 'TRADE BLOCKED'
        : tradeApproved
        ? 'TRADE APPROVED'
        : isArmedConditional
        ? 'ARMED_CONDITIONAL'
        : 'STANDBY';

    // When Auto-Pilot is armed or bypass active, targets hydrate and trade is approved unless hard-blocked
    const isHydrated =
      !isHardBlocked &&
      (!isSignalStandbyActive || baseSniper.isAutoSniperEnabled || isBypassActive) &&
      (allRiskGatesPassed || isBypassActive || isArmedConditional);

    // Share exact lockedActiveSignal snapshot levels when active for this symbol & direction (no tick drift)
    const matchingLocked =
      !hasUnifiedRouterBrackets &&
      lockedActiveSignal &&
      lockedActiveSignal.symbol === selectedAsset &&
      lockedActiveSignal.direction === effectiveDirection
        ? lockedActiveSignal
        : null;

    const matchingBaseFrozen =
      !isSignalStandbyActive &&
      base.symbol === selectedAsset &&
      base.signal === effectiveDirection &&
      base.entryPrice > 0
        ? base
        : null;

    const entryPrice = hasUnifiedRouterBrackets
      ? base.entryPrice
      : matchingLocked
      ? matchingLocked.entryPrice
      : matchingBaseFrozen
      ? matchingBaseFrozen.entryPrice
      : rawEntryPrice > 0
      ? rawEntryPrice
      : activeMarket.markPrice;
    const initialStopLoss = hasUnifiedRouterBrackets
      ? base.initialStopLoss
      : matchingLocked
      ? matchingLocked.stopLoss
      : hasBaseMicroBrackets
      ? base.initialStopLoss
      : matchingBaseFrozen && matchingBaseFrozen.initialStopLoss > 0
      ? matchingBaseFrozen.initialStopLoss
      : rawInitialStopLoss;
    const tp1 = hasUnifiedRouterBrackets
      ? base.tp1
      : matchingLocked
      ? matchingLocked.tp1
      : matchingBaseFrozen && matchingBaseFrozen.tp1 > 0
      ? matchingBaseFrozen.tp1
      : rawTp1;
    const tp2 = hasUnifiedRouterBrackets
      ? base.tp2
      : matchingLocked
      ? matchingLocked.tp2
      : matchingBaseFrozen && matchingBaseFrozen.tp2 > 0
      ? matchingBaseFrozen.tp2
      : rawTp2;
    const tp3 = hasUnifiedRouterBrackets
      ? base.tp3
      : matchingLocked
      ? matchingLocked.tp3
      : matchingBaseFrozen && matchingBaseFrozen.tp3 > 0
      ? matchingBaseFrozen.tp3
      : rawTp3;
    const tp4 = hasUnifiedRouterBrackets
      ? base.tp4
      : matchingLocked
      ? matchingLocked.tp4
      : matchingBaseFrozen && matchingBaseFrozen.tp4 > 0
      ? matchingBaseFrozen.tp4
      : rawTp4;

    const tp1DollarFmt = formatInrFirstPnl(12.5, liveUsdInrRate, { showPlusSign: true });
    const tp2DollarFmt = formatInrFirstPnl(25.0, liveUsdInrRate, { showPlusSign: true });
    const tp3DollarFmt = formatInrFirstPnl(37.5, liveUsdInrRate, { showPlusSign: true });
    const tp4DollarFmt = formatInrFirstPnl(50.0, liveUsdInrRate, { showPlusSign: true });

    const hasLiveTrade = Boolean(activePosition);

    let camarillaVerdict: string;
    if (isLiveUnverified) {
      camarillaVerdict = 'API Keys Required · Balances Inactive — Connect Delta Exchange API Keys in Settings to trade live.';
    } else if (!marginUtilizationSafe) {
      camarillaVerdict = `MARGIN CAP >= 65% (${(base.riskChecks?.accountMarginUtilizationPct ?? 65).toFixed(1)}% utilized) — Execution paused to preserve parallel Options Spread & Perp liquidity.`;
    } else if (!microAntiChopPassed) {
      const cdSec = base.riskChecks?.microSlCooldownRemainingSec ?? 0;
      const hrCnt = base.riskChecks?.microTradesLastHour ?? 0;
      camarillaVerdict =
        cdSec > 0
          ? `MICRO ANTI-CHOP: 10m Post-SL Cooldown active (${Math.floor(cdSec / 60)}m ${cdSec % 60}s left)`
          : `MICRO ANTI-CHOP: Hourly cap reached (${hrCnt}/3 Micro trades in rolling 1h window)`;
    } else if (htfTrendLock) {
      camarillaVerdict = isLong
        ? `${htfVetoStatus} — AUTO-PILOT SAFEGUARD: Suppressed Long setup due to 1H Bearish Trend & Sub-VWAP drift`
        : htfVetoStatus;
    } else if (isWideCprBlocked) {
      camarillaVerdict = 'WIDE CPR - CHOP RISK - BREAKOUT SUPPRESSED';
    } else if (isPairInCooldown) {
      camarillaVerdict = `POST-STOP COOLDOWN ACTIVE (${Math.floor(cooldownRemainingSec / 60)}m ${cooldownRemainingSec % 60}s remaining) — Session protected against chop.`;
    } else if (!candleConfirmed) {
      camarillaVerdict = isLong
        ? `AWAITING 5M CANDLE CLOSE CONFIRMATION: Intra-candle touch protected. Auto-entry locked until 5m bar closes above H4 ($${camarilla.h4.toLocaleString()}).`
        : `AWAITING 5M CANDLE CLOSE CONFIRMATION: Intra-candle touch protected. Auto-entry locked until 5m bar closes below L4 ($${camarilla.l4.toLocaleString()}).`;
    } else if (isSignalStandbyActive) {
      camarillaVerdict = 'STANDBY / SCANNING — Previous trade levels wiped to "---". Click "Validate Camarilla Signal" or "Confirm Signal" to hydrate targets.';
    } else if (!allRiskGatesPassed) {
      camarillaVerdict = 'SIGNAL REJECTED / STANDBY — Conviction (< 75%) or pre-entry risk protection gates not met. Execution targets cleared to "---".';
    } else if (effectiveExpMode === 'MICRO_15') {
      const cpr5mTxt = (base.cpr5mWidthPct ?? 0).toFixed(2);
      const contractsTxt = syncedContractsCount;
      const marginTxt = typeof base.estimatedMargin === 'number' && base.estimatedMargin > 0 ? `$${base.estimatedMargin.toFixed(2)}` : '$15';
      camarillaVerdict = `DUAL-TF CAMARILLA SNIPER (${effectiveDirection}${narrowCprOverrideActive ? ` · 5m Narrow CPR ${cpr5mTxt}% <= 0.15%` : ''}): ${contractsTxt} cts (${lotSize.toFixed(3)} ${selectedAsset.replace('USDT', '')} · ${marginTxt} Margin @ ${base.leverage || 10}x) | Entry $${entryPrice.toLocaleString()} · SL $${initialStopLoss.toLocaleString()} · TP1 $${tp1.toLocaleString()} · TP2 $${tp2.toLocaleString()}`;
    } else if (effectiveExpMode === 'MICRO_50') {
      const tp1Fmt = formatInrFirstPnl(25.0, liveUsdInrRate, { showPlusSign: true });
      const tp2Fmt = formatInrFirstPnl(50.0, liveUsdInrRate, { showPlusSign: true });
      const tp3Fmt = formatInrFirstPnl(100.0, liveUsdInrRate, { showPlusSign: true });
      const tp4Fmt = formatInrFirstPnl(150.0, liveUsdInrRate, { showPlusSign: true });
      camarillaVerdict = isLong
        ? `AI Command Signal Validator ($50 Standard Sniper LONG): Entry >= H4 ($${camarilla.h4.toLocaleString()}) · SL < H3 ($${camarilla.h3.toLocaleString()}) · TP1 $${tp1.toLocaleString()} (${hasLiveTrade ? tp1Fmt.combined : 'Break-Even Lock'}) · TP2 $${tp2.toLocaleString()} (${hasLiveTrade ? tp2Fmt.combined : 'Profit Lock'}) · TP3 $${tp3.toLocaleString()} (${hasLiveTrade ? tp3Fmt.combined : 'ATR Trail'}) · TP4 $${tp4.toLocaleString()} (${hasLiveTrade ? tp4Fmt.combined : 'Awaiting Execution'}). Trap Exit on 5m close < H3.`
        : `AI Command Signal Validator ($50 Standard Sniper SHORT): Entry <= L4 ($${camarilla.l4.toLocaleString()}) · SL > L3 ($${camarilla.l3.toLocaleString()}) · TP1 $${tp1.toLocaleString()} (${hasLiveTrade ? tp1Fmt.combined : 'Break-Even Lock'}) · TP2 $${tp2.toLocaleString()} (${hasLiveTrade ? tp2Fmt.combined : 'Profit Lock'}) · TP3 $${tp3.toLocaleString()} (${hasLiveTrade ? tp3Fmt.combined : 'ATR Trail'}) · TP4 $${tp4.toLocaleString()} (${hasLiveTrade ? tp4Fmt.combined : 'Awaiting Execution'}). Trap Exit on 5m close > L3.`;
    } else {
      camarillaVerdict = isLong
        ? `AI Command Signal Validator (Institutional Macro LONG): Entry >= H4 ($${camarilla.h4.toLocaleString()}) · SL < H3 ($${camarilla.h3.toLocaleString()}) · TP1 Mid-H5 ($${tp1.toLocaleString()} · Break-Even Lock) · TP2 H5 ($${tp2.toLocaleString()}) · TP3 H5-Ext ($${tp3.toLocaleString()}) · TP4 H6 ($${tp4.toLocaleString()}) · Target Projection: ${hasLiveTrade ? 'Active' : 'Awaiting Execution'}. Trap Exit on 5m close < H3.`
        : `AI Command Signal Validator (Institutional Macro SHORT): Entry <= L4 ($${camarilla.l4.toLocaleString()}) · SL > L3 ($${camarilla.l3.toLocaleString()}) · TP1 Mid-L5 ($${tp1.toLocaleString()} · Break-Even Lock) · TP2 L5 ($${tp2.toLocaleString()}) · TP3 L5-Ext ($${tp3.toLocaleString()}) · TP4 L6 ($${tp4.toLocaleString()}) · Target Projection: ${hasLiveTrade ? 'Active' : 'Awaiting Execution'}. Trap Exit on 5m close > L3.`;
    }

    const camarillaSignalId =
      matchingLocked?.id ||
      matchingBaseFrozen?.id ||
      `${selectedAsset}-${effectiveDirection}-${effectiveExpMode}-${dynamicConfidence}-${Math.round(entryPrice || rawEntryPrice || activeMarket.markPrice)}`;

    const mergedCamarilla = {
      ...camarilla,
      cpr5mWidthPct: base.cpr5mWidthPct ?? base.camarilla?.cpr5mWidthPct ?? camarilla.cpr5mWidthPct,
      cpr4hWidthPct: base.cpr4hWidthPct ?? base.camarilla?.cpr4hWidthPct ?? camarilla.cpr4hWidthPct,
      cpr5m: base.camarilla?.cpr5m ?? camarilla.cpr5m,
      cpr4h: base.camarilla?.cpr4h ?? camarilla.cpr4h,
    };

    return {
      ...base,
      id: camarillaSignalId,
      symbol: selectedAsset,
      signal: effectiveDirection,
      exposureMode: effectiveExpMode,
      scalpTier: effectiveExpMode === 'MICRO_15' ? 'TIER_15' : 'TIER_50',
      confidence: matchingLocked?.convictionPct || dynamicConfidence,
      confidenceStatus: dynamicConfidenceStatus,
      riskRewardRatio: dynamicRrRatio,
      riskRewardNumeric: dynamicRrNumeric,
      lotSize,
      contractsCount: syncedContractsCount,
      requestedLotSize: base.requestedLotSize ?? defaultLotSize,
      lotSizingMode: base.lotSizingMode ?? lotSizingMode,
      manualLotSizeOverride: manualOverride ?? base.manualLotSizeOverride ?? null,
      entryPrice,
      initialStopLoss,
      tp1,
      tp2,
      tp3,
      tp4,
      timestamp: matchingLocked?.timestamp || base.timestamp,
      camarilla: mergedCamarilla,
      isHydrated,
      isStandby: isSignalStandbyActive,
      regimeRouter: base.regimeRouter,
      regimeStatusLabel: base.regimeStatusLabel,
      entryOrderType: base.entryOrderType,
      feeAdjustedBePrice: base.feeAdjustedBePrice,
      utcDayTradesCount: base.utcDayTradesCount,
      postSlCooldownBarsRemaining: base.postSlCooldownBarsRemaining,
      validation: {
        ...base.validation,
        supportResistance: supportResistanceValid,
        confidenceAboveMin,
        cprFilterPassed,
        candleConfirmed,
        htfDivergenceWarning,
        bypassActive: isBypassActive,
      },
      riskChecks: {
        ...base.riskChecks,
        signalValidationPassed,
        confidenceThresholdMet: confidenceAboveMin,
        sufficientMargin,
        riskLimitsNotBreached,
        cprFilterPassed,
        narrowCprOverrideActive,
        marginUtilizationSafe,
        microAntiChopPassed,
        candleConfirmed,
        cooldownPassed,
        bypassActive: isBypassActive,
        htfDivergenceWarning,
        executionStatus,
        tradeApproved,
      },
      aiVerdict: camarillaVerdict,
    };
  }, [baseSniper.currentSignal, baseSniper.manualLotSize, baseSniper.signalSource, baseSniper.bypassHtfFilter, baseSniper.isAutoSniperEnabled, baseSniper.pairCooldowns, lockedActiveSignal, signalValidity?.status, selectedAsset, effectiveDirection, exposureMode, activeMarket, camarilla, camarillaTargets, isLiveUnverified, isSignalStandbyActive, liveUsdInrRate, activePosition, aiAnalysis, tradingMode, defaultLotSize, getContractsCount, lotSizingMode]);

  // AI Command Signal Validator handler (computes, confirms, and hydrates H1-H5, L1-L5 structure)
  const handleValidateCamarillaSignal = useCallback(async () => {
    handleConfirmSignal();
    const isLong = effectiveDirection === 'LONG';
    const orderPayload = {
      symbol: selectedAsset,
      side: effectiveDirection,
      size: camarillaSniperSignal.lotSize,
      entryPrice: camarillaTargets.entryPrice,
      stopLoss: camarillaTargets.stopLoss,
      tp1: camarillaTargets.tp1,
      tp2: camarillaTargets.tp2,
      tp3: camarillaTargets.tp3,
      tp4: camarillaTargets.tp4,
      camarilla,
    };

    const res = await onTriggerAiValidation(orderPayload, {
      markPrice: activeMarket.markPrice,
      high24h: activeMarket.high24h,
      low24h: activeMarket.low24h,
      camarilla,
    });

    const msg = isLong
      ? `Camarilla LONG Confirmed (PASS): Entry $${camarillaTargets.entryPrice.toLocaleString()} (>= H4 $${camarilla.h4.toLocaleString()}), SL $${camarillaTargets.stopLoss.toLocaleString()} (< H3 $${camarilla.h3.toLocaleString()}), H5 $${camarilla.h5.toLocaleString()}, H6 $${camarilla.h6.toLocaleString()}.`
      : `Camarilla SHORT Confirmed (PASS): Entry $${camarillaTargets.entryPrice.toLocaleString()} (<= L4 $${camarilla.l4.toLocaleString()}), SL $${camarillaTargets.stopLoss.toLocaleString()} (> L3 $${camarilla.l3.toLocaleString()}), L5 $${camarilla.l5.toLocaleString()}, L6 $${camarilla.l6.toLocaleString()}.`;

    setValidatorStatus({
      validated: res?.approved !== false,
      message: msg,
      timestamp: Date.now(),
    });

    onSendNotification('AI Command Signal Validator', msg, 'AI');
  }, [
    handleConfirmSignal,
    effectiveDirection,
    selectedAsset,
    camarillaSniperSignal.lotSize,
    camarillaTargets,
    camarilla,
    activeMarket,
    onTriggerAiValidation,
    onSendNotification,
  ]);

  const handleShareSignal = useCallback(async () => {
    const sig = camarillaSniperSignal;
    const symbol = sig.symbol || selectedAsset;
    const dir = sig.signal;
    const scoreVal = sig.setupScore16 ?? (sig.confidence >= 90 ? 15 : sig.confidence >= 80 ? 13 : 11);
    const gradeVal = sig.setupGrade ?? (scoreVal >= 13 ? 'A+' : scoreVal >= 10 ? 'A' : 'B');
    const conviction = `${sig.confidence}% (${sig.confidenceStatus}) · Score ${scoreVal}/16 (Grade ${gradeVal})`;
    const setupName = sig.activeSetupName || (sig.exposureMode === 'MICRO_15' ? '15M Micro Pullback' : 'Institutional Macro Camarilla');
    const entry = sig.entryPrice > 0 ? `$${sig.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${activeMarket.markPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const sl = sig.initialStopLoss > 0 ? `$${sig.initialStopLoss.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Structural';
    const tp1 = sig.tp1 > 0 ? `$${sig.tp1.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (35% · BE Ratchet)` : 'TBD';
    const tp2 = sig.tp2 > 0 ? `$${sig.tp2.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (35% · Bank Profit)` : 'TBD';
    const tp3 = sig.tp3 > 0 ? `$${sig.tp3.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (ATR Trail)` : 'TBD';
    const tp4 = sig.tp4 > 0 ? `$${sig.tp4.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Macro Runner)` : 'TBD';
    const rr = sig.riskRewardRatio ? `1:${sig.riskRewardRatio}` : '1:2.4';
    const utcTime = new Date().toUTCString();

    const template = [
      `🎯 DELTAAI INSTITUTIONAL INTRADAY SIGNAL`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Asset: ${symbol} · Direction: ${dir} (${tradingMode} Mode)`,
      `Conviction: ${conviction}`,
      `Setup: ${setupName}`,
      `Entry: ${entry}`,
      `Stop Loss: ${sl}`,
      `Target 1: ${tp1}`,
      `Target 2: ${tp2}`,
      `Target 3: ${tp3}`,
      `Target 4: ${tp4}`,
      `Risk/Reward: ${rr} · Max Risk Cap: 0.25%`,
      `Exchange: Delta Exchange India`,
      `Generated: ${utcTime}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Institutional Execution Engine · DeltaAI`,
    ].join('\n');

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(template);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = template;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setIsSignalCopied(true);
      onSendNotification?.('Signal Copied', `${symbol} ${dir} signal details copied to clipboard`, 'INFO');
      setTimeout(() => setIsSignalCopied(false), 2500);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  }, [camarillaSniperSignal, selectedAsset, tradingMode, activeMarket.markPrice, onSendNotification]);

  const handleExecuteCamarillaSniper = useCallback(() => {
    if (isLiveUnverified) {
      onSendNotification(
        'API Keys Required · Balances Inactive',
        'Connect Delta Exchange API Keys in Settings to trade live',
        'RISK'
      );
      return;
    }
    if (!activePosition && signalValidity?.status === 'OVERDUE') {
      onSendNotification(
        'Execution Paused · Stale Signal',
        'Active setup is overdue/stale. Click Refresh Signal to re-anchor live market levels.',
        'RISK'
      );
      return;
    }
    baseSniper.executeSniperTrade(camarillaSniperSignal);
  }, [baseSniper, camarillaSniperSignal, isLiveUnverified, activePosition, signalValidity?.status, onSendNotification]);

  const handleCloseSniperPosition = useCallback(
    (reason?: string) => {
      setLocalSignalStandby(true);
      if (baseSniper.setIsSignalStandby) {
        baseSniper.setIsSignalStandby(true);
      }
      if (baseSniper.activeTrade?.tradeStatus === 'STOPPED_OUT') {
        baseSniper.setActiveTrade(null);
        return;
      }
      baseSniper.closeActiveSniperTrade(reason);
      baseSniper.setActiveTrade(null);
    },
    [baseSniper]
  );

  // ═══════════════════════════════════════════════════════════
  // AUTO-PILOT EXECUTION DISPATCHER (ARMED)
  // When Auto-Pilot is enabled (ARMED), automatically identifies and executes trades:
  // When isAutoSniperEnabled === true AND activeTrade === null AND currentSignal.riskChecks.tradeApproved === true AND currentSignal.confidence >= 75%:
  // - Automatically calls executeSniperTrade() after a 1.5-second signal confirmation window
  // - Enforces 60-second cooldown so it does not trigger duplicate executions for the same signal candle
  // - Logs automated trigger: "AUTO-PILOT: Order executed based on AI Command consensus (Confidence: X%)"
  // - Works seamlessly in both 'Paper Demo' (virtual fill) and 'Live India' (Delta Exchange API when keys verified)
  // ═══════════════════════════════════════════════════════════
  const prevAutoEnabledRef = useRef<boolean>(false);
  const lastAutoDispatchTsRef = useRef<number>(0);

  useEffect(() => {
    const wasJustEnabled = sniperAutoEnabled && !prevAutoEnabledRef.current;
    prevAutoEnabledRef.current = sniperAutoEnabled;

    if (!sniperAutoEnabled || sniperIsExecuting || activePosition) return;

    const isBypassActive = tradingMode === 'PAPER' && (sniperBypassHtfFilter ?? false);

    // Guard against stale/overdue setups
    if (signalValidity?.status === 'OVERDUE') return;

    // Guard against 15m post-stop cooldown on this symbol
    const currentPairCooldown = sniperPairCooldowns?.[selectedAsset] || 0;
    if (Date.now() < currentPairCooldown) return;

    // Guard against wide CPR (> 0.35%) unless 5m/15m Narrow CPR override, EMA 9/21 5m Sniper mode, or Bypass HTF / VWAP Guard is active
    const isEma921AutoMode = camarillaSniperSignal?.sniperStrategyMode === 'EMA_9_21_MOMENTUM_5M';
    const isWideCpr = isEma921AutoMode ? false : (camarillaSniperSignal?.camarilla?.isWideCpr ?? false);
    const hasNarrowCprOverride = Boolean(
      camarillaSniperSignal?.riskChecks?.narrowCprOverrideActive ||
        camarillaSniperSignal?.isNarrow5mCprAutoRouted ||
        camarillaSniperSignal?.isNarrow5mCpr
    );
    if (isWideCpr && !hasNarrowCprOverride && !isBypassActive) return;

    // Guard total account margin utilization < 65% and Micro anti-chop (3/hr max + 10m post-SL cooldown)
    if (camarillaSniperSignal?.riskChecks?.marginUtilizationSafe === false) return;
    if (
      camarillaSniperSignal?.exposureMode === 'MICRO_15' &&
      camarillaSniperSignal?.riskChecks?.microAntiChopPassed === false
    ) {
      return;
    }

    // Guard against intra-candle touch without 5m candle close confirmation
    if (camarillaSniperSignal?.validation?.candleConfirmed === false && !isBypassActive) return;

    // Guard against Gate 1 FAIL unless Bypass is active
    const gate1Passed = camarillaSniperSignal?.riskChecks?.signalValidationPassed === true || isBypassActive;
    if (!gate1Passed) return;

    const isSignalApproved = camarillaSniperSignal?.riskChecks?.tradeApproved === true;
    const meetsConfidence = (camarillaSniperSignal?.confidence ?? 0) >= 75;
    const hasValidEntry = (camarillaSniperSignal?.entryPrice ?? 0) > 0 || (camarillaTargets?.entryPrice ?? 0) > 0 || activeMarket.markPrice > 0;

    const currentSignalId = camarillaSniperSignal.id || `${selectedAsset}-${camarillaSniperSignal.signal}-${camarillaSniperSignal.confidence}`;
    if (sniperLastAutoSignalId?.current === currentSignalId) {
      return;
    }

    if (isSignalApproved && meetsConfidence && hasValidEntry) {
      const now = Date.now();
      // Enforce 60-second cooldown between auto executions unless just enabled
      if (!wasJustEnabled && now - lastAutoDispatchTsRef.current < 60000) return;
      lastAutoDispatchTsRef.current = now;

      const timer = setTimeout(() => {
        if (addSniperLog) {
          addSniperLog(
            'EXECUTION',
            'Auto-Pilot Triggered',
            `AUTO-PILOT: Order executed based on AI Command consensus (Confidence: ${camarillaSniperSignal.confidence}%)`
          );
        }
        executeSniperTrade(camarillaSniperSignal);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [
    sniperAutoEnabled,
    sniperIsExecuting,
    sniperBypassHtfFilter,
    sniperPairCooldowns,
    sniperLastAutoSignalId,
    addSniperLog,
    executeSniperTrade,
    activePosition,
    camarillaSniperSignal,
    camarillaTargets,
    activeMarket.markPrice,
    signalValidity?.status,
    tradingMode,
    selectedAsset,
    defaultLotSize,
    lotSizingMode,
    getContractsCount,
  ]);

  return (
    <div className="space-y-3 w-full min-w-0 max-w-full">
      {/* Consolidated Trading Intelligence Control Dock */}
      <div className="panel-delta panel-delta-body relative z-30 overflow-visible flex flex-wrap items-center justify-between gap-2.5 min-w-0 max-w-full">
        <div className="flex items-center gap-2.5 min-w-0 max-w-full">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h1 className="text-xs font-bold text-slate-200 tracking-wider uppercase truncate" title="DeltaAI Trading Cockpit">
                DeltaAI Trading Cockpit
              </h1>
              {(() => {
                const matrixDir = activePosition ? activePosition.signal : effectiveDirection;
                const isBearMatrix = matrixDir === 'SHORT';
                return (
                  <span className="hidden md:inline text-[11px] font-mono-numbers text-slate-400">
                    · MTF Regime Router ·{' '}
                    <span className={isBearMatrix ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                      Matrix {aiMatrixScore.total}/180 ({aiMatrixScore.convictionPct}% {isBearMatrix ? 'BEAR' : 'BULL'})
                    </span>
                  </span>
                );
              })()}
              {maSlopeData && (
                <MaSlopeTrendIndicator
                  slopeData={maSlopeData}
                  symbol={activeMarket?.symbol || maSlopeData.symbol}
                  signalSide={correlatedSignal?.side}
                  compact
                  className="hidden md:inline-flex"
                />
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 break-words tabular-nums">
              <span>15m Maker Pullback · 1.5x ATR Stop · 1 USD = ₹{liveUsdInrRate.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Center/Right: Mode Tabs + INR-First Telemetry + Secondary Tools Dropdown */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs relative z-50 min-w-0 max-w-full">
          {/* INR-First Live PnL Pill */}
          <div className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg bg-slate-900/70 border border-slate-800/80 text-[11px] font-mono-numbers">
            <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">
              PNL:
            </span>
            {activePosition || sniperSessionRealizedUsd !== 0 ? (
              <>
                <span
                  className={`font-extrabold ${
                    isLiveUnverified
                      ? 'text-slate-500'
                      : sniperNetSessionPnlUsd > 0
                      ? 'text-emerald-400'
                      : sniperNetSessionPnlUsd < 0
                      ? 'text-rose-400'
                      : 'text-slate-200'
                  }`}
                >
                  {sniperNetSessionPnlFmt.inrText}
                </span>
                <span className="text-[10px] text-slate-400 font-semibold">
                  (≈ {sniperNetSessionPnlFmt.usdText})
                </span>
              </>
            ) : (
              <span className="font-bold text-slate-400 text-[10px]">Awaiting Execution</span>
            )}
          </div>

          {/* Engine Mode Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-900/70 border border-slate-800/80 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveEngineTab('SNIPER')}
              className={`btn-delta-sm ${
                activeEngineTab === 'SNIPER' ? 'btn-toggle-active' : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Sniper Engine</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveEngineTab('OPTIONS')}
              className={`btn-delta-sm ${
                activeEngineTab === 'OPTIONS' ? 'btn-toggle-active' : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Options Lab</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveEngineTab('COMBINED')}
              className={`btn-delta-sm ${
                activeEngineTab === 'COMBINED' ? 'btn-toggle-active' : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
            >
              Combined
            </button>
          </div>

          {/* Share Signal Button */}
          <button
            type="button"
            onClick={handleShareSignal}
            className={`btn-delta ${
              isSignalCopied ? 'btn-toggle-active !text-emerald-300 !border-emerald-500/50' : 'btn-secondary text-slate-300 hover:text-white'
            }`}
            title="Share current signal details to clipboard"
          >
            {isSignalCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Share2 className="w-3.5 h-3.5 text-cyan-400" />
            )}
            <span>{isSignalCopied ? 'Copied!' : 'Share'}</span>
          </button>

          {/* Secondary Tools Grouping Dropdown */}
          <div className="relative z-50" ref={toolsDropdownRef}>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={isToolsDropdownOpen}
              onClick={() => setIsToolsDropdownOpen(!isToolsDropdownOpen)}
              className={`btn-delta ${
                isToolsDropdownOpen ? 'btn-toggle-active' : 'btn-secondary'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>Tools & AI</span>
              <ChevronDown className={`w-3.5 h-3.5 text-cyan-400 transition-transform duration-300 ease-in-out ${isToolsDropdownOpen ? '-rotate-180 text-cyan-200' : 'rotate-0'}`} />
            </button>

            {isToolsDropdownOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 z-50 w-72 bg-[#0d1424] border border-cyan-500/30 rounded-xl shadow-2xl shadow-black/90 p-2 space-y-1 font-sans"
              >
                <button
                  type="button"
                  onClick={() => {
                    handleValidateCamarillaSignal();
                    setIsToolsDropdownOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-cyan-500/15 hover:text-cyan-300 transition cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-bold text-white">Validate Camarilla Signal</div>
                    <div className="text-[10px] text-slate-400">Run AI risk checks on L4/H4</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    applyMatrixSignalToPad();
                    setIsToolsDropdownOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-cyan-500/15 hover:text-cyan-300 transition cursor-pointer"
                >
                  <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-bold text-white">Sync AI Matrix to Pad</div>
                    <div className="text-[10px] text-slate-400">Populate lot size & targets</div>
                  </div>
                </button>

                {onNavigateToAi && (
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateToAi();
                      setIsToolsDropdownOpen(false);
                    }}
                    className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-cyan-500/15 hover:text-cyan-300 transition cursor-pointer"
                  >
                    <Cpu className="w-4 h-4 text-blue-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold text-white">23-Module AI Command</div>
                      <div className="text-[10px] text-slate-400">Multi-agent consensus grid</div>
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setActiveEngineTab('OPTIONS');
                    setIsToolsDropdownOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-cyan-500/15 hover:text-cyan-300 transition cursor-pointer"
                >
                  <Sliders className="w-4 h-4 text-teal-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-bold text-white">Options Strategy Lab</div>
                    <div className="text-[10px] text-slate-400">Iron condors & straddles</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* REAL-TIME AI CONDUIT DISPATCHED SIGNAL BANNER (Tier 3 Collapsible when Live Position Active) */}
      {latestDispatchedSignal && (
        <CollapsibleTierPanel
          id="strategy-ai-conduit-dispatch"
          title="AI Conduit: Dispatched Signal"
          tierLabel="TIER 3 · SIGNAL"
          icon={<Cpu className="w-4 h-4 text-cyan-300" />}
          accentClass="border-cyan-500/45"
          bodyClassName="p-3.5"
          defaultExpandedWhenIdle={!activePosition}
          summary={
            <>
              <span
                className={`badge-delta ${
                  latestDispatchedSignal.direction === 'LONG'
                    ? 'badge-delta-live'
                    : 'badge-delta-danger'
                }`}
              >
                {latestDispatchedSignal.direction} {latestDispatchedSignal.symbol}
              </span>
              <span className="text-cyan-300 font-bold">
                {latestDispatchedSignal.convictionScore}/180 ({latestDispatchedSignal.confidencePct}% · Gr {latestDispatchedSignal.grade})
              </span>
              <span className="text-slate-600">·</span>
              <span>Entry ${latestDispatchedSignal.entryPrice.toLocaleString()}</span>
            </>
          }
          headerActions={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSelectedAsset(latestDispatchedSignal.symbol);
                  if (baseSniper.setDirectionMode) {
                    baseSniper.setDirectionMode(latestDispatchedSignal.direction);
                  }
                  if (baseSniper.confirmSignalHydration) {
                    baseSniper.confirmSignalHydration();
                  }
                }}
                className="btn-delta-sm btn-primary"
              >
                <Crosshair className="w-3 h-3" />
                <span>Load</span>
              </button>
              <button
                type="button"
                onClick={clearLatestDispatchedSignal}
                className="btn-delta-sm btn-secondary !px-1.5"
                title="Dismiss signal banner"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs font-mono-numbers min-w-0 max-w-full">
            <div className="flex items-center gap-3 min-w-[260px] max-w-full flex-1">
              <div className="min-w-0 max-w-full flex-1">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span className="badge-delta badge-delta-armed whitespace-normal break-words">
                    SCORE {latestDispatchedSignal.convictionScore}/180 ({latestDispatchedSignal.confidencePct}% · GRADE {latestDispatchedSignal.grade} {latestDispatchedSignal.direction === 'LONG' ? 'BULLISH' : 'BEARISH'})
                  </span>
                  <span className="badge-delta badge-delta-standby whitespace-normal break-words">
                    VEHICLE: {latestDispatchedSignal.targetVehicle}
                  </span>
                </div>
                <div className="text-slate-300 text-[11px] mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>Entry: <strong className="text-white">${latestDispatchedSignal.entryPrice.toLocaleString()}</strong></span>
                  <span className="text-slate-600">·</span>
                  <span>SL: <strong className="text-rose-400">${latestDispatchedSignal.stopLoss.toLocaleString()}</strong></span>
                  <span className="text-slate-600">·</span>
                  <span>TP1: <strong className="text-emerald-400">${latestDispatchedSignal.tp1.toLocaleString()}</strong></span>
                  <span className="text-slate-600">·</span>
                  <span>TP2: <strong className="text-emerald-400">${latestDispatchedSignal.tp2.toLocaleString()}</strong></span>
                  <span className="text-slate-600">·</span>
                  <span>TP4: <strong className="text-cyan-300">${latestDispatchedSignal.tp4.toLocaleString()}</strong></span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400 text-[10px] inline-flex items-center gap-1.5">
                    {latestDispatchedSignal.source === 'AUTO_SCAN' ? (
                      <span className="inline-flex items-center gap-1 text-cyan-300">
                        <Cpu className="w-3 h-3" /> Autonomous Loop
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-cyan-300">
                        <Terminal className="w-3 h-3" /> Manual Dispatch
                      </span>
                    )}
                    <span>({new Date(latestDispatchedSignal.timestamp).toLocaleTimeString()})</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0 max-w-full">
              <button
                type="button"
                onClick={() => {
                  setSelectedAsset(latestDispatchedSignal.symbol);
                  if (baseSniper.setDirectionMode) {
                    baseSniper.setDirectionMode(latestDispatchedSignal.direction);
                  }
                  if (baseSniper.confirmSignalHydration) {
                    baseSniper.confirmSignalHydration();
                  }
                }}
                className="btn-delta btn-primary"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Load into Cockpit</span>
              </button>
              {latestDispatchedSignal.targetVehicle.includes('Spread') && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAsset(latestDispatchedSignal.symbol);
                    setActiveEngineTab('OPTIONS');
                  }}
                  className="btn-delta btn-toggle-active"
                >
                  <span>Options Lab ↗</span>
                </button>
              )}
            </div>
          </div>
        </CollapsibleTierPanel>
      )}

      {validatorStatus && (
        <div className="bg-slate-950/90 border border-emerald-700/70 rounded-lg px-3.5 py-2 text-xs font-mono-numbers flex flex-wrap items-center justify-between gap-2 text-emerald-300 min-w-0 max-w-full">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="break-words min-w-0">{validatorStatus.message}</span>
          </div>
          <span className="text-[10px] text-slate-400 shrink-0">
            VERIFIED {new Date(validatorStatus.timestamp).toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* Requirement 4: Yellow Auto-Pilot Safeguard Diagnostic Badge */}
      {camarillaSniperSignal?.aiVerdict?.includes('AUTO-PILOT SAFEGUARD') && (
        <div className="panel-delta panel-delta-body border-orange-500/60 flex flex-wrap items-center justify-between gap-2 text-xs font-mono min-w-0 max-w-full">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-7 h-7 rounded-lg bg-orange-500/15 border border-orange-500/40 text-orange-300 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <span className="badge-delta badge-delta-warning">
                  AUTO-PILOT SAFEGUARD
                </span>
                <span className="text-orange-200 font-bold break-words min-w-0">
                  AUTO-PILOT SAFEGUARD: Suppressed Long setup due to 1H Bearish Trend &amp; Sub-VWAP drift
                </span>
              </div>
              <div className="text-slate-400 text-[11px] mt-0.5 break-words">
                HTF Veto Active: Mark ${(activeMarket.markPrice || 0).toLocaleString()} &lt; 1H EMA50 or Session VWAP. Auto-pilot entries locked to prevent falling-knife execution.
              </div>
            </div>
          </div>
          <span className="badge-delta badge-delta-danger shrink-0">
            LOCKED
          </span>
        </div>
      )}

      {/* INTRADAY SNIPER SCALPING ENGINE */}
      {(activeEngineTab === 'SNIPER' || activeEngineTab === 'COMBINED') && (
        <CamarillaSniperHub
          markets={markets}
          selectedSymbol={selectedAsset}
          setSelectedSymbol={setSelectedAsset}
          tradingMode={tradingMode}
          currentSignal={camarillaSniperSignal}
          activeTrade={activePosition}
          isAutoSniperEnabled={baseSniper.isAutoSniperEnabled}
          setIsAutoSniperEnabled={baseSniper.setIsAutoSniperEnabled}
          isExecuting={baseSniper.isExecuting}
          tradeLogs={baseSniper.tradeLogs}
          onExecuteSniperTrade={handleExecuteCamarillaSniper}
          onCloseSniperTrade={handleCloseSniperPosition}
          onClearTradeLogs={baseSniper.clearTradeLogs}
          currencyPrefix={currencyPrefix}
          exchangeRate={exchangeRate}
          packetGap={packetGap}
          directionMode={baseSniper.directionMode}
          setDirectionMode={baseSniper.setDirectionMode}
          exposureMode={exposureMode}
          setExposureMode={baseSniper.setExposureMode}
          scalpTier={baseSniper.scalpTier}
          setScalpTier={baseSniper.setScalpTier}
          aiAnalysis={aiAnalysis}
          isAiLoading={isAiLoading}
          onRefreshAiAnalysis={onRefreshAiAnalysis}
          signalSource={baseSniper.signalSource}
          setSignalSource={baseSniper.setSignalSource}
          isLiveApiAuthenticated={isLiveApiAuthenticated}
          onOpenSettings={onOpenSettings}
          isSignalStandby={isSignalStandbyActive}
          onConfirmSignal={handleConfirmSignal}
          onRefreshSignal={baseSniper.refreshSignalSnapshot}
          pairCooldowns={baseSniper.pairCooldowns}
          consecutiveStopsCount={baseSniper.consecutiveStopsCount}
          circuitBreakerTripped={baseSniper.circuitBreakerTripped}
          circuitBreakerReason={baseSniper.circuitBreakerReason}
          dailyLossPercent={baseSniper.dailyLossPercent}
          postSlCooldownUntilMs={baseSniper.postSlCooldownUntilMs}
          onResetCircuitBreaker={baseSniper.resetCircuitBreaker}
          simulate5mCandleClose={baseSniper.simulate5mCandleClose}
          clearPairCooldown={baseSniper.clearPairCooldown}
          bypassHtfFilter={baseSniper.bypassHtfFilter}
          setBypassHtfFilter={baseSniper.setBypassHtfFilter}
          cycleRealizedPnL={baseSniper.cycleRealizedPnL}
          harvestTargetHit={baseSniper.harvestTargetHit}
          cycleWindowRemaining={baseSniper.cycleWindowRemaining}
          isTransitionWindow={baseSniper.isTransitionWindow}
          manualLotSize={baseSniper.manualLotSize}
          setManualLotSize={baseSniper.setManualLotSize}
          pendingLimitOrder={baseSniper.pendingLimitOrder}
          onCancelPendingLimitOrder={baseSniper.cancelPendingLimitOrder}
          sniperStrategyMode={baseSniper.sniperStrategyMode}
          setSniperStrategyMode={baseSniper.setSniperStrategyMode}
        />
      )}

      {/* OPTIONS STRATEGY ENGINE */}
      <div className={activeEngineTab === 'OPTIONS' || activeEngineTab === 'COMBINED' ? 'block' : 'hidden'}>
        <OptionsStrategyEngine
          markets={markets}
          tradingMode={tradingMode}
          selectedSymbol={selectedAsset}
          onSelectSymbol={setSelectedAsset}
          onSendNotification={onSendNotification}
          onPlaySound={onPlaySound}
          currencyPrefix={currencyPrefix}
          exchangeRate={exchangeRate}
          aiAnalysis={aiAnalysis}
          onRefreshAiAnalysis={onRefreshAiAnalysis}
          isAiLoading={isAiLoading}
          isLiveApiAuthenticated={isLiveApiAuthenticated}
          onOpenSettings={onOpenSettings}
          sniperSignal={camarillaSniperSignal}
          correlatedSignal={correlatedSignal}
          isExchangeHydrated={isExchangeHydrated}
          appBootTimestamp={appBootTimestamp}
        />
      </div>

    </div>
  );
});

const StrategyEngineWithFallback: React.FC<StrategyEngineProps> = (props) => {
  const isLiveUnverified = props.tradingMode === 'LIVE' && !props.isLiveApiAuthenticated;
  const fallbackPortfolio = usePortfolio();
  const handleCloseFallback = useCallback(async () => {}, []);
  const fallbackSniper = useSniperScalpingEngine({
    markets: props.markets,
    selectedSymbol: props.selectedSymbol || 'BTCUSDT',
    tradingMode: props.tradingMode,
    availableBalance: isLiveUnverified ? 0 : fallbackPortfolio.availableBalance || 18240,
    totalEquity: isLiveUnverified ? 0 : fallbackPortfolio.totalEquity,
    marginUsed: isLiveUnverified ? 0 : fallbackPortfolio.marginUsed,
    isLiveApiAuthenticated: Boolean(props.isLiveApiAuthenticated),
    isExchangeHydrated: props.isExchangeHydrated ?? true,
    appBootTimestamp: props.appBootTimestamp ?? Date.now(),
    onExecuteOrder: props.onExecuteTrade,
    onClosePosition: handleCloseFallback,
    onSendNotification: props.onSendNotification,
    onPlaySound: props.onPlaySound,
    aiAnalysis: props.aiAnalysis,
    onRefreshAiAnalysis: props.onRefreshAiAnalysis,
    isAiLoading: props.isAiLoading,
    positions: props.positions,
  });

  return <StrategyEngineInner {...props} baseSniper={fallbackSniper} />;
};

export const StrategyEngine: React.FC<StrategyEngineProps> = React.memo((props) => {
  if (props.sniperEngine) {
    return <StrategyEngineInner {...props} baseSniper={props.sniperEngine} />;
  }
  return <StrategyEngineWithFallback {...props} />;
});

