import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MarketTicker, TradingMode, AiTradeCardData, PortfolioData } from '../types';
import { ShieldCheck, Zap, ArrowUpRight, ArrowDownRight, AlertTriangle, ShieldAlert, RefreshCw } from 'lucide-react';
import { useRiskAdjustment } from '../context/RiskAdjustmentContext';
import { useAiMatrixCorrelation } from '../context/AiMatrixCorrelationContext';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { usePortfolio } from '../context/PortfolioContext';
import { SmartSizingCalculator } from './SmartSizingCalculator';
import { triggerHaptic } from '../utils/haptics';
import { formatDiagnosticBadgeAndMessage } from '../services/deltaExchangeService';
import { formatEnumLabel } from '../utils/enumFormatters';

interface OrderFormProps {
  selectedSymbol: string;
  setSelectedSymbol: (sym: string) => void;
  markets: Record<string, MarketTicker>;
  availableBalance: number;
  availableMargin?: number;
  portfolio?: PortfolioData;
  tradingMode: TradingMode;
  onExecuteOrder: (order: {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    orderType: 'MARKET' | 'LIMIT';
    limitPrice?: number;
    leverage: number;
    marginMode?: 'ISOLATED' | 'CROSS';
    takeProfit?: number;
    stopLoss?: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    tp4?: number;
    strategy: string;
    mode: TradingMode;
  }) => Promise<void>;
  prefillAiSetup?: AiTradeCardData | null;
  onClearPrefill?: () => void;
  currencyPrefix: string;
  exchangeRate: number;
  isLiveApiAuthenticated?: boolean;
  isCheckingAuth?: boolean;
  hasServerCredentials?: boolean;
  onOpenSettings?: () => void;
}

export const OrderForm: React.FC<OrderFormProps> = React.memo(({
  selectedSymbol,
  setSelectedSymbol,
  markets,
  availableBalance,
  availableMargin,
  portfolio,
  tradingMode,
  onExecuteOrder,
  prefillAiSetup,
  onClearPrefill,
  currencyPrefix,
  exchangeRate,
  isLiveApiAuthenticated = false,
  isCheckingAuth = false,
  hasServerCredentials = false,
}) => {
  const portfolioCtx = usePortfolio();
  const {
    correlatedSignal,
    lockedActiveSignal,
    signalValidity,
    signalCooldown,
    refreshLockedSignal,
    hasLiveMarkets,
    evaluateSignalRisk,
    riskEvaluation,
    cuedPadSetup,
    clearCuedPadSetup,
    isCircuitBreakerTripped,
    circuitBreakerReason,
    maxDollarRiskPerTrade,
  } = useAiMatrixCorrelation();

  const currentMarket = markets[selectedSymbol] || markets['BTCUSD'] || markets['BTCUSDT'];
  const currentPrice = currentMarket?.markPrice || lockedActiveSignal?.entryPrice || correlatedSignal.entryPrice || 68800;

  const {
    config,
    sizingMethod,
    lotSizingMode,
    fixedLot,
    defaultLotSize,
    fixedRiskUsd,
    equityPercent,
    maxRiskPerTradePct,
    globalLeverage,
    maxLeverageCap,
    marginMode,
    leverageSyncLocked,
    clampLeverage,
    setFixedLot,
    setLotSizingMode,
    setEquityPercent,
    getContractsCount,
    resolveSafeExecutionLot,
    calculateLotSize,
  } = useCapitalAllocation();

  const buildCalibratedBracket = (entry: number, dir: 'LONG' | 'SHORT') => {
    const safeEntry = entry > 0 ? entry : 81702.5;
    const decimals = safeEntry >= 100 ? 2 : safeEntry >= 10 ? 3 : 4;
    const isLongDir = dir === 'LONG';
    // Clean risk-calibrated bracket: SL = 0.50%, TP1 = 0.80% (1.60R >= 1.50R mandatory gate)
    const sl = +(safeEntry * (isLongDir ? 0.995 : 1.005)).toFixed(decimals);
    const tp = +(safeEntry * (isLongDir ? 1.008 : 0.992)).toFixed(decimals);
    return { sl, tp };
  };

  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(true);
  const [side, setSide] = useState<'LONG' | 'SHORT'>(() => lockedActiveSignal?.direction || correlatedSignal.side || 'LONG');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [limitPrice, setLimitPrice] = useState<string>(() => (lockedActiveSignal?.entryPrice || currentPrice).toString());
  const [size, setSize] = useState<string>(() => (defaultLotSize ? defaultLotSize.toString() : '0.1'));
  const [leverage, setLeverage] = useState<number>(() => clampLeverage(globalLeverage));

  useEffect(() => {
    if (leverageSyncLocked) {
      setLeverage(clampLeverage(globalLeverage));
    } else {
      setLeverage((prev) => (prev > maxLeverageCap ? maxLeverageCap : prev));
    }
  }, [globalLeverage, maxLeverageCap, leverageSyncLocked, clampLeverage]);
  const [takeProfit, setTakeProfit] = useState<string>(() => {
    if (lockedActiveSignal && lockedActiveSignal.tp1 > 0) {
      return lockedActiveSignal.tp1.toString();
    }
    const initialBracket = buildCalibratedBracket(currentPrice, lockedActiveSignal?.direction || correlatedSignal.side || 'LONG');
    return initialBracket.tp.toString();
  });
  const [stopLoss, setStopLoss] = useState<string>(() => {
    if (lockedActiveSignal && lockedActiveSignal.stopLoss > 0) {
      return lockedActiveSignal.stopLoss.toString();
    }
    const initialBracket = buildCalibratedBracket(currentPrice, lockedActiveSignal?.direction || correlatedSignal.side || 'LONG');
    return initialBracket.sl.toString();
  });
  const [overrideRrValidation, setOverrideRrValidation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  const hasEffectiveLiveCreds = Boolean(isLiveApiAuthenticated || hasServerCredentials);
  const isLiveAuthChecking = tradingMode === 'LIVE' && Boolean(isCheckingAuth) && !hasEffectiveLiveCreds;
  const isLiveUnverified = tradingMode === 'LIVE' && !isCheckingAuth && !hasEffectiveLiveCreds;
  const resolvedAvailableMargin =
    (typeof portfolio?.availableMargin === 'number' && portfolio.availableMargin > 0
      ? portfolio.availableMargin
      : undefined) ??
    (typeof availableMargin === 'number' && availableMargin > 0 ? availableMargin : undefined) ??
    (typeof portfolio?.availableBalance === 'number' && portfolio.availableBalance > 0
      ? portfolio.availableBalance
      : undefined) ??
    (typeof availableBalance === 'number' && availableBalance > 0 ? availableBalance : undefined) ??
    (tradingMode === 'LIVE' && portfolioCtx.availableMargin > 0 ? portfolioCtx.availableMargin : undefined) ??
    portfolio?.availableMargin ??
    availableMargin ??
    portfolio?.availableBalance ??
    availableBalance ??
    0;

  const effectiveAvailableMargin = isLiveUnverified ? 0.0 : resolvedAvailableMargin;
  const effectiveAvailableBalance = effectiveAvailableMargin;
  const rawActiveWalletDiagnosticError =
    tradingMode === 'LIVE' && !isCheckingAuth
      ? portfolio?.walletDiagnosticError || portfolioCtx.walletDiagnosticError || null
      : null;
  const activeWalletDiagnosticError =
    rawActiveWalletDiagnosticError &&
    rawActiveWalletDiagnosticError.code === 'MISSING_API_CREDENTIALS'
      ? null
      : rawActiveWalletDiagnosticError;
  const formattedFooterDiag = activeWalletDiagnosticError
    ? formatDiagnosticBadgeAndMessage(
        activeWalletDiagnosticError.code,
        activeWalletDiagnosticError.message
      )
    : null;

  const slNumForClamp = parseFloat(stopLoss);
  const activeSlDistance =
    Number.isFinite(slNumForClamp) && slNumForClamp > 0 && currentPrice > 0
      ? Math.abs(currentPrice - slNumForClamp)
      : undefined;

  const safeOrderLot = useMemo(
    () =>
      resolveSafeExecutionLot({
        symbol: selectedSymbol,
        markPrice: currentPrice,
        availableBalance: effectiveAvailableMargin,
        totalEquity: portfolio?.totalEquity || effectiveAvailableMargin,
        stopLossDistance: activeSlDistance,
        leverage,
      }),
    [
      resolveSafeExecutionLot,
      selectedSymbol,
      currentPrice,
      effectiveAvailableMargin,
      portfolio?.totalEquity,
      activeSlDistance,
      leverage,
    ]
  );

  useEffect(() => {
    if (!prefillAiSetup && safeOrderLot.lotSize > 0) {
      setSize(safeOrderLot.lotSize.toString());
    }
  }, [
    config,
    defaultLotSize,
    lotSizingMode,
    maxRiskPerTradePct,
    selectedSymbol,
    leverage,
    prefillAiSetup,
    safeOrderLot.lotSize,
  ]);

  // Sync limit price with mark price on symbol change if not custom edited
  useEffect(() => {
    if (orderType === 'MARKET') {
      setLimitPrice(currentPrice.toString());
    }
  }, [currentPrice, orderType]);

  // Handle prefill from AI Command Centre
  useEffect(() => {
    if (prefillAiSetup && prefillAiSetup.symbol === selectedSymbol) {
      const nextSide: 'LONG' | 'SHORT' = prefillAiSetup.action === 'BUY_LONG' ? 'LONG' : 'SHORT';
      setSide(nextSide);
      const entryRef = (prefillAiSetup as any).entryPrice || currentPrice;
      const slDist = Math.abs(entryRef - (prefillAiSetup.stopLoss || 0));
      const tpDist = Math.abs((prefillAiSetup.tp1 || 0) - entryRef);
      const hasValidBracket =
        prefillAiSetup.stopLoss > 0 &&
        prefillAiSetup.tp1 > 0 &&
        slDist > 0 &&
        slDist / entryRef <= 0.03 &&
        tpDist / slDist >= 1.5;

      if (hasValidBracket) {
        setStopLoss(prefillAiSetup.stopLoss.toString());
        setTakeProfit(prefillAiSetup.tp1.toString());
      } else {
        const calibrated = buildCalibratedBracket(entryRef, nextSide);
        setStopLoss(calibrated.sl.toString());
        setTakeProfit(calibrated.tp.toString());
      }
      setLeverage(
        leverageSyncLocked
          ? clampLeverage(globalLeverage)
          : clampLeverage(prefillAiSetup.recommendedLeverage || globalLeverage)
      );
      if ((prefillAiSetup as any).lotSize) {
        setSize(String((prefillAiSetup as any).lotSize));
      }
    }
  }, [prefillAiSetup, selectedSymbol, currentPrice, leverageSyncLocked, globalLeverage, clampLeverage]);

  // Automatic Synchronization from AI Matrix Correlation Engine & Flash Live Stream
  useEffect(() => {
    if (cuedPadSetup) {
      if (cuedPadSetup.symbol && cuedPadSetup.symbol !== selectedSymbol) {
        setSelectedSymbol(cuedPadSetup.symbol);
      }
      const nextSide = cuedPadSetup.side || side;
      if (cuedPadSetup.side) {
        setSide(cuedPadSetup.side);
      }
      const entryRef = cuedPadSetup.price && cuedPadSetup.price > 0 ? cuedPadSetup.price : currentPrice;
      if (cuedPadSetup.price && cuedPadSetup.price > 0) {
        setLimitPrice(cuedPadSetup.price.toString());
      }
      const calibrated = buildCalibratedBracket(entryRef, nextSide);
      const incomingSl = cuedPadSetup.stopLoss && cuedPadSetup.stopLoss > 0 ? cuedPadSetup.stopLoss : calibrated.sl;
      const incomingTp = cuedPadSetup.takeProfit && cuedPadSetup.takeProfit > 0 ? cuedPadSetup.takeProfit : calibrated.tp;
      const slDist = Math.abs(entryRef - incomingSl);
      const tpDist = Math.abs(incomingTp - entryRef);
      const isValidIncoming = slDist > 0 && slDist / entryRef <= 0.03 && tpDist / slDist >= 1.5;

      setStopLoss((isValidIncoming ? incomingSl : calibrated.sl).toString());
      setTakeProfit((isValidIncoming ? incomingTp : calibrated.tp).toString());

      if (cuedPadSetup.size && cuedPadSetup.size > 0) {
        setSize(cuedPadSetup.size.toString());
      }
      setStatusMessage(`⚡ Auto-Synced: ${cuedPadSetup.reason || cuedPadSetup.levelType || 'AI Matrix Setup'}`);
      const t = setTimeout(() => setStatusMessage(null), 3500);
      return () => clearTimeout(t);
    }
  }, [cuedPadSetup, selectedSymbol, setSelectedSymbol, currentPrice, side]);

  // Continuously mirror lockedActiveSignal into the Order Pad whenever Auto-Sync AI Matrix is active
  useEffect(() => {
    if (!autoSyncEnabled || prefillAiSetup || cuedPadSetup) return;
    const activeSig =
      lockedActiveSignal && lockedActiveSignal.symbol === selectedSymbol
        ? lockedActiveSignal
        : hasLiveMarkets && correlatedSignal.symbol === selectedSymbol
        ? {
            id: correlatedSignal.id,
            symbol: correlatedSignal.symbol,
            direction: correlatedSignal.side,
            entryPrice: correlatedSignal.entryPrice,
            stopLoss: correlatedSignal.stopLoss,
            tp1: correlatedSignal.tp1,
          }
        : null;

    if (!activeSig || !(activeSig.entryPrice > 0)) return;

    const calibrated = buildCalibratedBracket(activeSig.entryPrice, activeSig.direction);
    const slDist = Math.abs(activeSig.entryPrice - activeSig.stopLoss);
    const tpDist = Math.abs(activeSig.tp1 - activeSig.entryPrice);
    const isSignalClean = slDist > 0 && slDist / activeSig.entryPrice <= 0.03 && tpDist / slDist >= 1.5;

    setSide(activeSig.direction);
    if (orderType === 'LIMIT') {
      setLimitPrice(activeSig.entryPrice.toString());
    }
    setStopLoss((isSignalClean ? activeSig.stopLoss : calibrated.sl).toString());
    setTakeProfit((isSignalClean ? activeSig.tp1 : calibrated.tp).toString());
    if (correlatedSignal.allowedLotSize > 0) {
      setSize(correlatedSignal.allowedLotSize.toString());
    }
  }, [
    autoSyncEnabled,
    prefillAiSetup,
    cuedPadSetup,
    lockedActiveSignal,
    hasLiveMarkets,
    correlatedSignal,
    selectedSymbol,
    orderType,
  ]);

  const handleAutoSyncMatrix = () => {
    setAutoSyncEnabled(true);
    const syncSide = lockedActiveSignal?.direction || correlatedSignal.side;
    const syncEntry = (lockedActiveSignal?.entryPrice && lockedActiveSignal.entryPrice > 0)
      ? lockedActiveSignal.entryPrice
      : (correlatedSignal.entryPrice > 0 ? correlatedSignal.entryPrice : currentPrice);
    const syncStop = (lockedActiveSignal?.stopLoss && lockedActiveSignal.stopLoss > 0)
      ? lockedActiveSignal.stopLoss
      : correlatedSignal.stopLoss;
    const syncTp1 = (lockedActiveSignal?.tp1 && lockedActiveSignal.tp1 > 0)
      ? lockedActiveSignal.tp1
      : correlatedSignal.tp1;

    const calibrated = buildCalibratedBracket(syncEntry, syncSide);
    const slDist = Math.abs(syncEntry - syncStop);
    const tpDist = Math.abs(syncTp1 - syncEntry);
    const isSignalClean = slDist > 0 && slDist / syncEntry <= 0.03 && tpDist / slDist >= 1.5;

    setSide(syncSide);
    setLimitPrice(syncEntry.toString());
    setStopLoss((isSignalClean ? syncStop : calibrated.sl).toString());
    setTakeProfit((isSignalClean ? syncTp1 : calibrated.tp).toString());
    setSize(correlatedSignal.allowedLotSize.toString());
    setStatusMessage(
      `⚡ Auto-Synced AI Matrix Setup: ${syncSide} ${correlatedSignal.symbol} (${correlatedSignal.matrixScore.total}/180 · Grade ${correlatedSignal.matrixScore.grade} ${syncSide === 'LONG' ? 'BULLISH' : 'BEARISH'})`
    );
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), 3500);
  };

  // Calculations
  const execPrice = orderType === 'LIMIT' && Number(limitPrice) > 0 ? Number(limitPrice) : currentPrice;
  const numSize = Number(size) || 0;
  const notionalValue = execPrice * numSize;
  const marginRequired = leverage > 0 ? notionalValue / leverage : 0;

  const estLiqBuffer = execPrice * (1 / (leverage * 1.15));
  const estLiqPrice = side === 'LONG'
    ? Math.max(0, execPrice - estLiqBuffer)
    : execPrice + estLiqBuffer;

  const hasEnoughBalance = !isLiveUnverified && effectiveAvailableMargin >= marginRequired;

  // Keep TP/SL bracket auto-calibrated cleanly when manually switching asset or direction (when Auto-Sync is off)
  useEffect(() => {
    if (autoSyncEnabled || prefillAiSetup || cuedPadSetup) return;
    const calibrated = buildCalibratedBracket(currentPrice, side);
    setStopLoss(calibrated.sl.toString());
    setTakeProfit(calibrated.tp.toString());
  }, [autoSyncEnabled, selectedSymbol, side, currentPrice, prefillAiSetup, cuedPadSetup]);

  // Evaluate active Order Pad risk gate dynamically when SL & TP are populated
  const effectiveRiskEvaluation = useMemo(() => {
    const tp = Number(takeProfit);
    const sl = Number(stopLoss);
    if (tp > 0 && sl > 0 && execPrice > 0) {
      const isDirectionallyValid = side === 'LONG' ? sl < execPrice && tp > execPrice : sl > execPrice && tp < execPrice;
      if (isDirectionallyValid) {
        return evaluateSignalRisk({
          symbol: selectedSymbol,
          side,
          entryPrice: execPrice,
          stopLoss: sl,
          tp1: tp,
          strategy: 'ORDER_PAD_SETUP',
          isBreakout: true,
          cprWidthPct: 0.05,
        });
      }
    }
    return riskEvaluation;
  }, [takeProfit, stopLoss, execPrice, side, selectedSymbol, evaluateSignalRisk, riskEvaluation]);

  // Memoized R/R Calculation
  const rrRatio = useMemo(() => {
    const tp = Number(takeProfit);
    const sl = Number(stopLoss);
    if (tp <= 0 || sl <= 0) return null;
    const rr = side === 'LONG' ? (tp - execPrice) / (execPrice - sl) : (execPrice - tp) / (sl - execPrice);
    return isFinite(rr) && rr > 0 ? rr : null;
  }, [takeProfit, stopLoss, execPrice, side]);

  const isSameSymbolSignal = !lockedActiveSignal || lockedActiveSignal.symbol === selectedSymbol;
  const isSlInvalidated = Boolean(isSameSymbolSignal && signalValidity.breachType === 'SL_INVALIDATED');
  const isTpCompleted = Boolean(
    isSameSymbolSignal &&
      (signalValidity.breachType === 'TP1_COMPLETED' || signalValidity.breachType === 'TP4_COMPLETED')
  );
  const isPostSlCooldown = Boolean(
    signalCooldown && signalCooldown.symbol === selectedSymbol && signalCooldown.reason === 'SL' && (signalValidity.cooldownRemainingSec || 0) > 0
  );
  const isSignalExecutionBlocked = isSlInvalidated || isTpCompleted || isPostSlCooldown;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignalExecutionBlocked) {
      setStatusMessage(
        isSlInvalidated || isPostSlCooldown
          ? `Order Blocked: Setup invalidated (SL breached). Next scan in ${signalValidity.cooldownRemainingSec || 30}s.`
          : `Order Blocked: Setup completed (TP1 reached before entry). Next scan in ${signalValidity.cooldownRemainingSec || 15}s.`
      );
      return;
    }
    if (isCircuitBreakerTripped) {
      setStatusMessage(`Order Blocked: Circuit Breaker active (${circuitBreakerReason})`);
      return;
    }
    if (!effectiveRiskEvaluation.approved) {
      setStatusMessage(`Order Blocked: ${effectiveRiskEvaluation.rejectionReason}`);
      return;
    }
    // R/R Ratio Validation
    if (rrRatio !== null && rrRatio < 1.5 && !overrideRrValidation) {
      setStatusMessage(`Order Blocked: Risk/Reward ratio is unfavorable (1:${rrRatio.toFixed(2)} < 1:1.5)`);
      return;
    }
    if (isLiveUnverified) {
      setStatusMessage('Connect Delta Exchange API Keys in Settings to trade live');
      return;
    }
    if (!leverageSyncLocked && leverage > maxLeverageCap) {
      setStatusMessage(`Order Blocked: Leverage (${leverage}x) exceeds Hard Max Cap (${maxLeverageCap}x).`);
      return;
    }
    if (numSize <= 0) {
      setStatusMessage('Please enter a valid contract size');
      return;
    }
    if (!hasEnoughBalance) {
      setStatusMessage(`Insufficient margin. Required: $${marginRequired.toFixed(2)}`);
      return;
    }

    const enforcedOrderLeverage = clampLeverage(leverage);

    setIsSubmitting(true);
    setStatusMessage(null);
    triggerHaptic('medium');
    try {
      const decimals = execPrice >= 100 ? 2 : execPrice >= 10 ? 3 : 4;
      const isMatchingLocked = Boolean(
        lockedActiveSignal && lockedActiveSignal.symbol === selectedSymbol && lockedActiveSignal.direction === side
      );
      const parsedTp1 = takeProfit ? Number(takeProfit) : isMatchingLocked ? lockedActiveSignal!.tp1 : undefined;
      const parsedSl = stopLoss ? Number(stopLoss) : isMatchingLocked ? lockedActiveSignal!.stopLoss : undefined;
      const isLongDir = side === 'LONG';
      const ladderTp1 = parsedTp1;
      const ladderTp2 = isMatchingLocked
        ? lockedActiveSignal!.tp2
        : +(execPrice * (isLongDir ? 1.0125 : 0.9875)).toFixed(decimals);
      const ladderTp3 = isMatchingLocked
        ? lockedActiveSignal!.tp3
        : +(execPrice * (isLongDir ? 1.0175 : 0.9825)).toFixed(decimals);
      const ladderTp4 = isMatchingLocked
        ? lockedActiveSignal!.tp4
        : +(execPrice * (isLongDir ? 1.025 : 0.975)).toFixed(decimals);

      await onExecuteOrder({
        symbol: selectedSymbol,
        side,
        size: numSize,
        orderType,
        limitPrice: orderType === 'LIMIT' ? Number(limitPrice) : undefined,
        leverage: enforcedOrderLeverage,
        marginMode,
        takeProfit: ladderTp1,
        stopLoss: parsedSl,
        tp1: ladderTp1,
        tp2: ladderTp2,
        tp3: ladderTp3,
        tp4: ladderTp4,
        strategy: prefillAiSetup ? `AI Signal: ${prefillAiSetup.strategy}` : 'Manual Terminal Order',
        mode: tradingMode,
      });
      triggerHaptic('success');
      setStatusMessage(`Success: ${side} ${numSize} ${selectedSymbol} executed!`);
      if (onClearPrefill) onClearPrefill();
      setTimeout(() => setStatusMessage(null), 3500);
    } catch (err: any) {
      triggerHaptic('error');
      setStatusMessage(`Failed: ${err.message || 'Execution error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickPercent = (pct: number) => {
    if (isLiveUnverified) return;
    // calculate size that consumes pct% of available balance
    const targetMargin = effectiveAvailableBalance * pct;
    const targetNotional = targetMargin * leverage;
    const calculatedSize = +(targetNotional / execPrice).toFixed(selectedSymbol === 'BTCUSDT' ? 3 : 2);
    setSize(Math.max(0.001, calculatedSize).toString());
  };

  const handleApplySmartSize = (suggestedSize: number, appliedRiskPct: number) => {
    setSize(suggestedSize.toString());
    setFixedLot(suggestedSize);
    if (setEquityPercent) {
      setEquityPercent(appliedRiskPct);
    }
  };

  return (
    <div className="panel-delta flex flex-col h-full relative overflow-hidden">
      <div className="panel-delta-header">
        <div className="panel-delta-title">
          <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>Buy / Sell Order Pad</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleAutoSyncMatrix}
            className={`btn-delta-sm ${autoSyncEnabled ? 'btn-toggle-active' : 'btn-secondary'}`}
            title="Auto-synchronize direction, Entry, SL, and TP1 directly from lockedActiveSignal"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoSyncEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span>Auto-Sync AI</span>
          </button>

          {isLiveUnverified ? (
            <span
              className="badge-delta badge-delta-warning"
              title="Connect your Delta Exchange API Key & Secret in Settings."
            >
              API KEY REQUIRED
            </span>
          ) : (
            <span className={`badge-delta ${tradingMode === 'LIVE' ? 'badge-delta-live' : 'badge-delta-paper'}`}>
              {tradingMode}
            </span>
          )}
        </div>
      </div>
      <div className="panel-delta-body flex flex-col flex-1">

      {/* Cued Pad Setup Banner (Auto-Sync from Flash Live Stream & AI Matrix Levels) */}
      {cuedPadSetup && (
        <div className="mt-3 panel-delta p-3 border-cyan-500/60 bg-cyan-950/35 text-xs font-mono space-y-1.5">
          <div className="flex items-center justify-between font-bold text-cyan-300">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>⚡ AI MATRIX LEVEL SYNCHRONIZED</span>
            </span>
            <span className="badge-delta badge-delta-armed">
              {cuedPadSetup.levelType || 'AI Matrix'}
            </span>
          </div>
          <div className="text-[11px] text-cyan-100/90 leading-tight">
            <strong>{cuedPadSetup.symbol} {cuedPadSetup.side}:</strong> {cuedPadSetup.reason || 'Auto-synced from live AI Matrix Conduit'}
            {cuedPadSetup.stopLoss && (
              <span> · Suggested SL: <strong className="text-white">${cuedPadSetup.stopLoss.toLocaleString()}</strong></span>
            )}
            {cuedPadSetup.takeProfit && (
              <span> · TP: <strong className="text-emerald-400">${cuedPadSetup.takeProfit.toLocaleString()}</strong></span>
            )}
            {cuedPadSetup.size && (
              <span> · Size: <strong className="text-cyan-300">{cuedPadSetup.size} Lots</strong></span>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={clearCuedPadSetup}
              className="btn-delta-sm btn-secondary"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Clear Gating Diagnostics (Universal Risk Management Gatekeeper) */}
      {!effectiveRiskEvaluation.approved && (
        <div className="mt-3 panel-delta p-3 border-rose-500/60 bg-rose-950/35 text-xs font-mono text-rose-200 space-y-1.5">
          <div className="flex items-center justify-between font-bold text-rose-300">
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>🛑 RISK ENGINE GATING DIAGNOSTICS</span>
            </span>
            <span className="badge-delta badge-delta-danger whitespace-nowrap shrink-0">
              {formatEnumLabel(effectiveRiskEvaluation.gateFailed, 'Gated')}
            </span>
          </div>
          <div className="text-[11px] leading-tight text-rose-200">
            <strong>Rejection Reason:</strong> {effectiveRiskEvaluation.rejectionReason}
          </div>
          <div className="text-[10px] bg-black/40 p-2 rounded-lg border border-rose-900/60 text-slate-300 space-y-0.5">
            <div>• Strict Account Risk Budget: <strong className="text-white">0.50% (${maxDollarRiskPerTrade.toFixed(2)})</strong></div>
            <div>• Invalidation Distance: <strong className="text-white">${effectiveRiskEvaluation.invalidationDistance.toFixed(2)}</strong></div>
            <div>• Sizing Formula: <code className="text-cyan-300">Size = Max Risk / (Stop Distance + Friction)</code></div>
          </div>
        </div>
      )}

      {/* Circuit Breaker Hard-Lock Alert */}
      {isCircuitBreakerTripped && (
        <div className="mt-3 panel-delta p-3 border-rose-500/60 bg-rose-950/35 text-xs font-mono text-rose-200 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-rose-300">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="uppercase tracking-wider">🛑 Circuit Breaker Hard-Lock</span>
          </div>
          <div className="text-[11px] leading-tight">
            {circuitBreakerReason || 'Daily drawdown limit (1.50%) or 2 consecutive stop-outs breached.'}
          </div>
        </div>
      )}

      {/* Quick Asset Selector */}
      <div className="space-y-1.5 my-2">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="font-semibold text-slate-300">Quick Asset Selection</span>
          <span className="badge-delta badge-delta-live">Delta India Live</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {[
            { sym: 'BTCUSDT', short: 'BTC', icon: '₿', color: 'text-amber-400' },
            { sym: 'ETHUSDT', short: 'ETH', icon: 'Ξ', color: 'text-cyan-400' },
            { sym: 'SOLUSDT', short: 'SOL', icon: '◎', color: 'text-rose-400' },
            { sym: 'XRPUSDT', short: 'XRP', icon: '✕', color: 'text-purple-400' },
          ].map((coin) => {
            const isCoinSelected = selectedSymbol === coin.sym || selectedSymbol.replace(/USDT$/, 'USD') === coin.sym.replace(/USDT$/, 'USD');
            const m = markets[coin.sym] || markets[coin.sym.replace(/USDT$/, 'USD')];
            const p = m?.markPrice || (coin.sym === 'BTCUSDT' ? 81702.5 : coin.sym === 'ETHUSDT' ? 2184.2 : coin.sym === 'SOLUSDT' ? 142.8 : 2.15);
            const inrPrice = p * 85.0;
            const inrSubLabel =
              inrPrice >= 1000
                ? `≈ ₹${Math.round(inrPrice / 1000).toLocaleString()}k`
                : `≈ ₹${inrPrice.toFixed(0)}`;
            return (
              <button
                key={coin.sym}
                type="button"
                onClick={() => setSelectedSymbol(coin.sym)}
                className={`min-w-0 p-1.5 rounded-lg border text-left transition-all cursor-pointer flex flex-col gap-0.5 overflow-hidden active:scale-[0.98] ${
                  isCoinSelected
                    ? 'bg-cyan-500/15 border-cyan-400/60 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
                    : 'bg-slate-800/50 hover:bg-slate-800/90 border-slate-700/70'
                }`}
              >
                <div className="flex items-center gap-1 min-w-0 w-full">
                  <span className={`w-4 h-4 rounded bg-[#0B111E] border border-slate-700/80 flex items-center justify-center font-bold text-[10px] shrink-0 ${coin.color}`}>
                    {coin.icon}
                  </span>
                  <span className="text-[11px] font-bold text-white leading-tight truncate">
                    {coin.short}
                  </span>
                </div>
                <div className="font-mono-numbers min-w-0 w-full">
                  <span className="text-[10px] font-bold text-slate-200 block leading-tight truncate">
                    ${p > 10 ? p.toLocaleString(undefined, { maximumFractionDigits: 0 }) : p.toFixed(2)}
                  </span>
                  <span className="text-[8.5px] text-slate-500 block leading-tight truncate">
                    {inrSubLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-1 text-xs">
        {/* Order Direction (Long vs Short) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setAutoSyncEnabled(false);
              setSide('LONG');
            }}
            className={`btn-delta ${side === 'LONG' ? 'btn-primary' : 'btn-secondary'}`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>BUY / LONG</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAutoSyncEnabled(false);
              setSide('SHORT');
            }}
            className={`btn-delta ${
              side === 'SHORT'
                ? 'btn-danger border-rose-400/70 bg-rose-500/25 text-rose-100'
                : 'btn-secondary'
            }`}
          >
            <ArrowDownRight className="w-4 h-4" />
            <span>SELL / SHORT</span>
          </button>
        </div>

        {/* Order Type: Market vs Limit */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex gap-1 p-1 bg-slate-900/70 border border-slate-800/80 rounded-lg">
            <button
              type="button"
              onClick={() => setOrderType('MARKET')}
              className={`flex-1 btn-delta-sm ${
                orderType === 'MARKET'
                  ? 'btn-toggle-active'
                  : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
            >
              Market
            </button>
            <button
              type="button"
              onClick={() => setOrderType('LIMIT')}
              className={`flex-1 btn-delta-sm ${
                orderType === 'LIMIT'
                  ? 'btn-toggle-active'
                  : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
            >
              Limit
            </button>
          </div>
          {orderType === 'LIMIT' && (
            <div className="flex-1">
              <input
                type="number"
                step="any"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="Price"
                className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-mono-numbers text-xs"
              />
            </div>
          )}
        </div>

        {/* Leverage Slider (Synced with Risk Settings Global Leverage Architecture) */}
        <div>
          <div className="flex justify-between items-center text-[11px] mb-1 gap-1.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Leverage</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase font-mono-numbers ${
                leverageSyncLocked
                  ? 'bg-emerald-950/70 border-emerald-700/70 text-emerald-300'
                  : 'bg-amber-950/70 border-amber-700/70 text-amber-300'
              }`}>
                {leverageSyncLocked ? 'GLOBAL SYNC LOCKED' : `CAP ${maxLeverageCap}x`}
              </span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300 uppercase font-mono-numbers">
                {marginMode}
              </span>
            </div>
            <span className="text-emerald-400 font-mono-numbers font-semibold">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max={maxLeverageCap}
            value={Math.min(leverage, maxLeverageCap)}
            disabled={leverageSyncLocked}
            onChange={(e) => {
              if (leverageSyncLocked) return;
              setLeverage(Math.min(maxLeverageCap, Math.max(1, Number(e.target.value))));
            }}
            className={`w-full accent-emerald-500 bg-slate-800 h-1.5 rounded ${
              leverageSyncLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            }`}
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono-numbers mt-1">
            {[1, 5, 10, 20, 30, 50].map((preset) => {
              const blocked = leverageSyncLocked || preset > maxLeverageCap;
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={blocked}
                  onClick={() => !blocked && setLeverage(preset)}
                  className={`transition ${
                    leverage === preset
                      ? 'text-emerald-400 font-bold'
                      : blocked
                      ? 'text-slate-700 cursor-not-allowed'
                      : 'hover:text-slate-300 cursor-pointer'
                  }`}
                >
                  {preset}x
                </button>
              );
            })}
          </div>
        </div>

        {/* Smart Sizing Calculator (Account Balance & Risk-Per-Trade Engine) */}
        <SmartSizingCalculator
          accountBalance={effectiveAvailableMargin}
          symbol={selectedSymbol}
          markPrice={execPrice}
          stopLoss={stopLoss}
          takeProfit={takeProfit}
          side={side}
          leverage={leverage}
          onApplySize={handleApplySmartSize}
          currencyPrefix={currencyPrefix}
          exchangeRate={exchangeRate}
          isLiveUnverified={isLiveUnverified}
        />

        {/* Contract Size Input (Synced with Global Risk Settings) */}
        <div>
          <div className="flex justify-between items-center text-[11px] mb-1 gap-1.5 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-400">Position Size</span>
              <span className="text-[10px] font-mono-numbers font-bold text-cyan-300 bg-cyan-950/50 border border-cyan-500/30 px-1.5 py-0.5 rounded">
                {getContractsCount(selectedSymbol, parseFloat(size) || defaultLotSize)} cts
              </span>
            </div>
            <span className="text-slate-400 font-mono-numbers">
              ≈ {currencyPrefix}{(notionalValue * exchangeRate).toFixed(2)}
            </span>
          </div>
          <input
            type="number"
            step="any"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder={defaultLotSize.toString()}
            className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono-numbers text-xs focus:border-emerald-500 focus:outline-none"
          />
          {/* Quick Lot Presets */}
          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1.5 mb-1">
            <span className="flex items-center gap-1.5">
              <span>Global Lot Presets:</span>
              <span className="text-[9px] font-bold text-cyan-300 bg-cyan-950/80 px-1 py-0.2 rounded border border-cyan-800/60 uppercase">
                {sizingMethod === 'EQUITY_PERCENT' ? `${equityPercent}% Eq` : `Risk ${maxRiskPerTradePct}%`}
              </span>
            </span>
            <span className="text-cyan-400 font-mono text-[9.5px]">Syncs Globally</span>
          </div>
          <div className="grid grid-cols-6 gap-1 mb-1.5">
            {[0.01, 0.05, 0.10, 0.25, 0.50, 1.0].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => {
                  setSize(l.toString());
                  setFixedLot(l);
                }}
                className={`btn-delta-sm !px-1 font-mono-numbers ${
                  Number(size) === l ? 'btn-toggle-active' : 'btn-secondary'
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Quick Percent Buttons */}
          <div className="grid grid-cols-4 gap-1">
            {[0.1, 0.25, 0.5, 0.75].map((p) => (
              <button
                key={p}
                type="button"
                disabled={isLiveUnverified}
                onClick={() => handleQuickPercent(p)}
                className="btn-delta-sm btn-secondary font-mono-numbers"
              >
                {p * 100}%
              </button>
            ))}
          </div>
        </div>

        {/* Take Profit & Stop Loss Bracket */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Take Profit ($)</label>
            <input
              type="number"
              step="any"
              value={takeProfit}
              onChange={(e) => {
                setAutoSyncEnabled(false);
                setTakeProfit(e.target.value);
              }}
              placeholder="Target Price"
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-mono-numbers text-xs"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Stop Loss ($)</label>
            <input
              type="number"
              step="any"
              value={stopLoss}
              onChange={(e) => {
                setAutoSyncEnabled(false);
                setStopLoss(e.target.value);
              }}
              placeholder="Stop Price"
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-mono-numbers text-xs"
            />
          </div>
        </div>

        {/* Risk/Reward Ratio Display */}
        {rrRatio !== null && (
          <div className={`flex items-center justify-between p-2 rounded border ${rrRatio < 1.5 ? 'bg-rose-950/40 border-rose-500/50' : 'bg-slate-950 border-slate-800'} text-xs`}>
            <span className={rrRatio < 1.5 ? 'text-rose-200 font-bold' : 'text-slate-400'}>
              {rrRatio < 1.5 ? '⚠️ Unfavorable R/R:' : 'Risk/Reward Ratio:'}
            </span>
            <span className={`font-bold font-mono-numbers ${rrRatio >= 2 ? 'text-emerald-400' : rrRatio >= 1.5 ? 'text-amber-400' : 'text-rose-400'}`}>
              1 : {rrRatio.toFixed(2)}
            </span>
          </div>
        )}

        {/* Margin & Liquidation Summary */}
        <div className="bg-slate-950 border border-slate-800/80 rounded p-2.5 text-[11px] font-mono-numbers space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-400">Available Margin:</span>
            <span className="text-white">
              {currencyPrefix}{(effectiveAvailableMargin * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Margin Req:</span>
            <span className={hasEnoughBalance ? 'text-slate-200' : 'text-rose-400 font-bold'}>
              {currencyPrefix}{(marginRequired * exchangeRate).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Est. Liquidation:</span>
            <span className="text-amber-400">{currencyPrefix}{(estLiqPrice * exchangeRate).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">Margin Mode / Cap:</span>
            <span className="text-cyan-300">{marginMode} · {leverage}x / {maxLeverageCap}x max</span>
          </div>
          {formattedFooterDiag && (
            <div className="pt-1.5 mt-1 border-t border-rose-800/60 flex items-center justify-between gap-1.5 text-[10px] text-rose-300">
              <span className="px-1.5 py-0.5 rounded bg-rose-950/90 border border-rose-500/60 font-bold text-rose-200 shrink-0">
                {formattedFooterDiag.label}
              </span>
              <span className="truncate text-rose-300/90" title={formattedFooterDiag.message}>
                {formattedFooterDiag.message}
              </span>
            </div>
          )}
        </div>

        {/* Status / Feedback message */}
        {statusMessage && (
          <div className="p-2 text-xs rounded bg-slate-900 border border-slate-700 text-slate-200">
            {statusMessage}
          </div>
        )}

        {/* Submit Execution Button */}
        <div className="flex flex-col gap-1.5">
          {((lockedActiveSignal &&
            lockedActiveSignal.symbol === selectedSymbol &&
            (signalValidity.status === 'OVERDUE' || signalValidity.status === 'AGING')) ||
            isPostSlCooldown) && (
              <div
                className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-mono-numbers flex items-center justify-between gap-2 ${
                  isSlInvalidated || isPostSlCooldown
                    ? 'bg-rose-950/75 border-rose-500/80 text-rose-200 animate-pulse'
                    : isTpCompleted
                    ? 'bg-emerald-950/60 border-emerald-500/70 text-emerald-200'
                    : signalValidity.status === 'OVERDUE'
                    ? 'bg-rose-950/60 border-rose-500/70 text-rose-200 animate-pulse'
                    : 'bg-amber-950/50 border-amber-500/60 text-amber-200'
                }`}
                title={signalValidity.reason || 'Signal lifecycle warning'}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isTpCompleted
                        ? 'text-emerald-400'
                        : isSlInvalidated || isPostSlCooldown || signalValidity.status === 'OVERDUE'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}
                  />
                  <span className="font-bold truncate">
                    {isSlInvalidated || isPostSlCooldown
                      ? `✕ SL Hit · Setup Invalidated${(signalValidity.cooldownRemainingSec || 0) > 0 ? ` (${signalValidity.cooldownRemainingSec}s)` : ''}`
                      : isTpCompleted
                      ? `✓ TP1 Reached · Setup Completed${(signalValidity.cooldownRemainingSec || 0) > 0 ? ` (${signalValidity.cooldownRemainingSec}s)` : ''}`
                      : signalValidity.status === 'OVERDUE'
                      ? '⚠ Signal Overdue / Stale'
                      : `⚠ Signal Aging (${Math.floor(signalValidity.ageMs / 60000)}m)`}
                  </span>
                </div>
                {(signalValidity.status === 'OVERDUE' || isPostSlCooldown) && (
                  <button
                    type="button"
                    onClick={() => {
                      refreshLockedSignal();
                      setAutoSyncEnabled(true);
                    }}
                    className={`px-2 py-0.5 rounded font-bold text-[9.5px] flex items-center gap-1 shrink-0 cursor-pointer border ${
                      isTpCompleted
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/35 border-emerald-400/60 text-emerald-100'
                        : 'bg-rose-500/25 hover:bg-rose-500/40 border-rose-400/60 text-rose-100'
                    }`}
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    <span>{isSignalExecutionBlocked ? 'Scan Now' : 'Refresh Signal'}</span>
                  </button>
                )}
              </div>
            )}
          {rrRatio !== null && rrRatio < 1.5 && (
            <div className="text-[10px] text-center font-bold text-rose-400 animate-pulse space-y-1">
              <div>Warning: R/R below target threshold (1:1.5)</div>
              <label className="flex items-center justify-center gap-1.5 cursor-pointer hover:text-rose-200">
                <input
                  type="checkbox"
                  checked={overrideRrValidation}
                  onChange={(e) => setOverrideRrValidation(e.target.checked)}
                  className="accent-rose-500"
                />
                <span>Confirm Anyway</span>
              </label>
            </div>
          )}
          <button
            type="submit"
            disabled={
              isSubmitting ||
              !hasEnoughBalance ||
              isLiveAuthChecking ||
              isLiveUnverified ||
              isCircuitBreakerTripped ||
              isSignalExecutionBlocked ||
              !effectiveRiskEvaluation.approved ||
              (rrRatio !== null && rrRatio < 1.5 && !overrideRrValidation)
            }
            title={
              isSlInvalidated || isPostSlCooldown
                ? 'Execution Disabled: Stop loss breached — waiting for post-SL cooldown scan'
                : isTpCompleted
                ? 'Execution Disabled: TP1 already reached before entry — avoiding chasing'
                : isCircuitBreakerTripped
                ? `Trading Hard-Locked: ${circuitBreakerReason || 'Circuit breaker active'}`
                : !effectiveRiskEvaluation.approved
                ? `Risk Gating: ${effectiveRiskEvaluation.rejectionReason}`
                : rrRatio !== null && rrRatio < 1.5 && !overrideRrValidation
                ? 'Unfavorable Risk/Reward (Ratio < 1.5) — Check "Confirm Anyway" to proceed'
                : isLiveAuthChecking
                ? 'Verifying Delta Exchange API credentials...'
                : isLiveUnverified
                ? 'Connect your Delta Exchange API Key & Secret in Settings.'
                : `Execute Trade (${side} ${selectedSymbol})`
            }
            className={`w-full btn-delta-lg uppercase ${
              isSignalExecutionBlocked || isCircuitBreakerTripped || !effectiveRiskEvaluation.approved || (rrRatio !== null && rrRatio < 1.5 && !overrideRrValidation)
                ? isTpCompleted
                  ? 'btn-secondary border-emerald-500/40 text-emerald-300'
                  : 'btn-danger'
                : side === 'LONG'
                ? 'btn-primary'
                : 'btn-danger border-rose-400/70 bg-rose-500/25 text-rose-100'
            }`}
          >
            {isSlInvalidated || isPostSlCooldown
              ? `✕ SL Hit · Setup Invalidated${(signalValidity.cooldownRemainingSec || 0) > 0 ? ` (${signalValidity.cooldownRemainingSec}s)` : ''}`
              : isTpCompleted
              ? `✓ TP1 Reached · Setup Completed${(signalValidity.cooldownRemainingSec || 0) > 0 ? ` (${signalValidity.cooldownRemainingSec}s)` : ''}`
              : isCircuitBreakerTripped
              ? '🛑 Circuit Breaker Hard-Lock Active — Execution Disabled'
              : !effectiveRiskEvaluation.approved
              ? `🛑 Gated by Risk Engine (${formatEnumLabel(effectiveRiskEvaluation.gateFailed, 'Rejected')})`
              : rrRatio !== null && rrRatio < 1.5 && !overrideRrValidation
              ? '🛑 Unfavorable R/R (< 1.5) — Check "Confirm Anyway" to proceed'
              : isLiveAuthChecking
              ? 'Verifying API Keys...'
              : isLiveUnverified
              ? 'Connect API Keys in Settings'
              : isSubmitting
              ? 'Routing to Delta Exchange...'
              : `Execute Trade · ${side === 'LONG' ? 'Buy / Long' : 'Sell / Short'} ${selectedSymbol}`}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
});

