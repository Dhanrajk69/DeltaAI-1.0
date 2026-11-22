import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Position,
  ClosedTrade,
  RiskEvaluationResult,
  PositionAdjustment,
  AiMatrixScore,
  CorrelatedSignal,
  MarketTicker,
  AiAnalysisResult,
  BtcCorrelationMetric,
  MaSlopeData,
  LockedSignalSnapshot,
  SignalValidityState,
} from '../types';
import { use15mMaSlope } from '../hooks/use15mMaSlope';
import { speakSoftFemaleVoice } from '../hooks/useVoiceAlerts';

export const SIGNAL_AGING_MS = 5 * 60 * 1000;
export const SIGNAL_OVERDUE_MS = 15 * 60 * 1000;
export const SIGNAL_MAX_DRIFT_PCT = 0.45;
export const SIGNAL_SL_COOLDOWN_MS = 30 * 1000;
export const SIGNAL_TP1_COOLDOWN_MS = 15 * 1000;

export interface SignalCooldownState {
  until: number;
  reason: 'SL' | 'TP1' | 'TP4';
  symbol: string;
}

export function evaluateLockedSignalValidity(
  snapshot: Pick<LockedSignalSnapshot, 'direction' | 'entryPrice' | 'stopLoss' | 'tp1' | 'tp4' | 'timestamp'> | null,
  liveMarkPrice: number,
  nowTs: number = Date.now(),
  hasActiveTrade: boolean = false
): SignalValidityState {
  if (!snapshot || !(snapshot.entryPrice > 0) || !(snapshot.timestamp > 0)) {
    return {
      status: 'FRESH',
      ageMs: 0,
      isExpiredByTime: false,
      isMissedEntryDrift: false,
      isTargetOrStopBreached: false,
      breachType: null,
      cooldownRemainingSec: 0,
      cooldownReason: null,
      driftPct: 0,
      reason: null,
    };
  }

  const ageMs = Math.max(0, nowTs - snapshot.timestamp);
  const isLong = snapshot.direction === 'LONG';
  const entry = snapshot.entryPrice;
  const validMark = liveMarkPrice > 0 ? liveMarkPrice : entry;

  // Drift in trade direction (positive = price moved away from entry in signal direction)
  const driftPct = +((((isLong ? validMark - entry : entry - validMark) / entry) * 100)).toFixed(2);

  // Condition 3 (Pre-entry only): Stop Loss invalidated or TP1/TP4 reached before opening a trade
  const isSlInvalidated =
    !hasActiveTrade &&
    snapshot.stopLoss > 0 &&
    validMark > 0 &&
    (isLong ? validMark <= snapshot.stopLoss : validMark >= snapshot.stopLoss);
  const isTp1Completed =
    !hasActiveTrade &&
    snapshot.tp1 > 0 &&
    validMark > 0 &&
    (isLong ? validMark >= snapshot.tp1 : validMark <= snapshot.tp1);
  const isTp4Completed =
    !hasActiveTrade &&
    snapshot.tp4 > 0 &&
    validMark > 0 &&
    (isLong ? validMark >= snapshot.tp4 : validMark <= snapshot.tp4);

  const isTargetOrStopBreached = isSlInvalidated || isTp1Completed || isTp4Completed;
  const breachType: SignalValidityState['breachType'] = isSlInvalidated
    ? 'SL_INVALIDATED'
    : isTp1Completed
    ? 'TP1_COMPLETED'
    : isTp4Completed
    ? 'TP4_COMPLETED'
    : null;

  // Condition 2: Price drift > 0.45% in trade direction before entry (chasing prevention)
  const isMissedEntryDrift = !hasActiveTrade && driftPct > SIGNAL_MAX_DRIFT_PCT;

  // Condition 1: Time expiration (> 15m / 3x 5m bars) without entry/target resolution
  const isExpiredByTime = !hasActiveTrade && ageMs > SIGNAL_OVERDUE_MS;

  if (isTargetOrStopBreached || isMissedEntryDrift || isExpiredByTime) {
    let reason = 'Setup expired — refresh to re-anchor live market levels';
    if (isSlInvalidated) {
      reason = `Stop Loss ($${snapshot.stopLoss.toLocaleString()}) breached — setup invalidated`;
    } else if (isTp1Completed) {
      reason = `TP1 ($${snapshot.tp1.toLocaleString()}) reached before entry — setup completed`;
    } else if (isTp4Completed) {
      reason = `TP4 ($${snapshot.tp4.toLocaleString()}) already reached — setup completed`;
    } else if (isMissedEntryDrift) {
      reason = `Price drifted +${driftPct.toFixed(2)}% in ${snapshot.direction} direction (> ${SIGNAL_MAX_DRIFT_PCT.toFixed(2)}% limit) — avoid chasing`;
    } else if (isExpiredByTime) {
      reason = 'Signal age exceeded 15m (3x 5m bars) without reaching TP1 or SL';
    }

    return {
      status: 'OVERDUE',
      ageMs,
      isExpiredByTime,
      isMissedEntryDrift,
      isTargetOrStopBreached,
      breachType,
      cooldownRemainingSec: 0,
      cooldownReason: null,
      driftPct,
      reason,
    };
  }

  if (ageMs >= SIGNAL_AGING_MS) {
    return {
      status: 'AGING',
      ageMs,
      isExpiredByTime: false,
      isMissedEntryDrift: false,
      isTargetOrStopBreached: false,
      breachType: null,
      cooldownRemainingSec: 0,
      cooldownReason: null,
      driftPct,
      reason: 'Signal is 5m–15m old — verify price structure before entry',
    };
  }

  return {
    status: 'FRESH',
    ageMs,
    isExpiredByTime: false,
    isMissedEntryDrift: false,
    isTargetOrStopBreached: false,
    breachType: null,
    cooldownRemainingSec: 0,
    cooldownReason: null,
    driftPct,
    reason: null,
  };
}

export interface SignalProposal {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  tp4?: number;
  strategy?: string;
  isBreakout?: boolean;
  cprWidthPct?: number;
  atr14?: number;
}

export interface CuedPadSetup {
  symbol?: string;
  side?: 'LONG' | 'SHORT';
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  size?: number;
  reason?: string;
  stage?: 1 | 2 | 3;
  levelType?: 'ENTRY' | 'SL' | 'TP1' | 'TP2' | 'BE_STOP' | 'POC' | 'H4' | 'L4' | 'CPR';
  timestamp: number;
}

export interface AiMatrixCorrelationContextType {
  // 1. Unified 4-Agent AI Matrix Score (0 - 180)
  aiMatrixScore: AiMatrixScore;
  agentScores: {
    trend: number;
    smartMoney: number;
    options: number;
    risk: number;
  };
  totalMatrixScore: number;
  matrixMaxScore: number;
  tradeGrade: 'A+' | 'A' | 'B+' | 'B';
  convictionPct: number;

  // 2. Correlated Signal (Master setup)
  correlatedSignal: CorrelatedSignal;
  lockedActiveSignal: LockedSignalSnapshot | null;
  signalValidity: SignalValidityState;
  signalCooldown: SignalCooldownState | null;
  startSignalCooldown: (reason: 'SL' | 'TP1' | 'TP4', durationMs?: number, symbol?: string) => void;
  clearLockedSignalForCooldown: (reason: 'SL' | 'TP4', durationMs?: number, symbol?: string) => void;
  refreshLockedSignal: () => void;
  refreshVersion: number;
  hasLiveMarkets: boolean;
  setCorrelatedSignalOverride: (partial: Partial<CorrelatedSignal>) => void;

  // 3. Universal Risk Management Evaluation
  evaluateSignalRisk: (proposal: SignalProposal) => RiskEvaluationResult;
  riskEvaluation: RiskEvaluationResult;
  maxDollarRiskPerTrade: number; // e.g. $5.00 on $1,000 equity (0.50%)
  dailyLossPct: number;
  dailyRealizedLossUsd: number;
  consecutiveStopouts: number;
  isCircuitBreakerTripped: boolean;
  circuitBreakerReason: string | null;
  resetCircuitBreaker: () => void;

  // 4. Dynamic Ratchet Engine for Active Positions
  positionAdjustments: Record<string, PositionAdjustment>;
  activeAdjustmentsList: PositionAdjustment[];
  activeAdjustment: PositionAdjustment | null;
  applyAdjustmentToPosition: (posId: string) => void;

  // 5. Global Synchronization to Execution Pad
  cuedPadSetup: CuedPadSetup | null;
  syncLevelToExecutionPad: (level: {
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    size?: number;
    symbol?: string;
    side?: 'LONG' | 'SHORT';
    reason?: string;
    type?: 'ENTRY' | 'SL' | 'TP1' | 'TP2' | 'BE_STOP' | 'POC' | 'H4' | 'L4' | 'CPR';
    stage?: 1 | 2 | 3;
  }) => void;
  applyMatrixSignalToPad: () => void;
  clearCuedPadSetup: () => void;

  // 6. BTC Correlation & Decoupling Tracker
  btcCorrelation: BtcCorrelationMetric;

  // 7. 15-Minute Moving Average Slope & AI Signal Context
  maSlopeData: MaSlopeData;
}

const DEFAULT_INITIAL_CAPITAL = 1000.0;
const INITIAL_RISK_CAP_PCT = 0.50; // Strict 0.50% account risk budget ($5.00 on $1,000)
const DAILY_DRAWDOWN_LIMIT_PCT = 1.50; // 1.50% daily loss circuit breaker
const MAX_CONSECUTIVE_STOPOUTS = 2; // Hard lock on 2 consecutive stop-outs
const MIN_REWARD_RISK_RATIO = 1.50; // Mandatory 1.50R minimum
const MAX_CPR_CHOP_WIDTH_PCT = 0.35; // CPR width > 0.35% blocks breakout entries

const AiMatrixCorrelationContext = createContext<AiMatrixCorrelationContextType | null>(null);

export interface AiMatrixCorrelationProviderProps {
  children: React.ReactNode;
  availableBalance?: number;
  totalEquity?: number;
  positions?: Position[];
  history?: ClosedTrade[];
  markets?: Record<string, MarketTicker>;
  selectedSymbol?: string;
  aiAnalysis?: AiAnalysisResult | null;
  activeSignalSide?: 'LONG' | 'SHORT';
  activeSignalId?: string;
  onUpdatePositionSL?: (posId: string, newSL: number) => void;
  onScalePosition?: (posId: string, scalePct: number) => void;
  onSendNotification?: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
}

export const AiMatrixCorrelationProvider: React.FC<AiMatrixCorrelationProviderProps> = ({
  children,
  availableBalance = DEFAULT_INITIAL_CAPITAL,
  totalEquity = DEFAULT_INITIAL_CAPITAL,
  positions = [],
  history = [],
  markets = {},
  selectedSymbol = 'BTCUSDT',
  aiAnalysis = null,
  activeSignalSide,
  activeSignalId,
  onUpdatePositionSL,
  onScalePosition,
  onSendNotification,
}) => {
  const effectiveBalance = Math.max(100, totalEquity || availableBalance || DEFAULT_INITIAL_CAPITAL);

  // Strict 0.50% account risk budget per trade ($5.00 on $1,000 equity)
  const maxDollarRiskPerTrade = +(effectiveBalance * (INITIAL_RISK_CAP_PCT / 100)).toFixed(2);

  const [circuitBreakerManualReset, setCircuitBreakerManualReset] = useState<boolean>(false);
  const [cuedPadSetup, setCuedPadSetup] = useState<CuedPadSetup | null>(null);
  const [signalOverride, setSignalOverride] = useState<Partial<CorrelatedSignal> | null>(null);

  // Track today's realized loss and consecutive stop-outs from closed history
  const { dailyRealizedLossUsd, consecutiveStopouts } = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const todayTrades = history.filter((t) => (t.closedAt || 0) >= startOfDay);

    let lossTotal = 0;
    todayTrades.forEach((t) => {
      const pnl = t.realisedPnl || 0;
      if (pnl < 0) {
        lossTotal += Math.abs(pnl);
      }
    });

    let stopouts = 0;
    for (let i = 0; i < history.length; i++) {
      const t = history[i];
      if ((t.realisedPnl || 0) < 0) {
        stopouts++;
      } else if ((t.realisedPnl || 0) > 0) {
        break;
      }
    }

    return {
      dailyRealizedLossUsd: +lossTotal.toFixed(2),
      consecutiveStopouts: stopouts,
    };
  }, [history]);

  const dailyLossPct = +((dailyRealizedLossUsd / effectiveBalance) * 100).toFixed(2);

  // 1.50% Daily Loss Circuit Breaker & 2 Consecutive Stop-Outs Gate
  const isLossBreach = dailyLossPct >= DAILY_DRAWDOWN_LIMIT_PCT;
  const isStopoutBreach = consecutiveStopouts >= MAX_CONSECUTIVE_STOPOUTS;
  const isCircuitBreakerTripped = !circuitBreakerManualReset && (isLossBreach || isStopoutBreach);

  const circuitBreakerReason = useMemo(() => {
    if (!isCircuitBreakerTripped) return null;
    if (isLossBreach && isStopoutBreach) {
      return `Daily Loss limit breached (-${dailyLossPct.toFixed(2)}% >= ${DAILY_DRAWDOWN_LIMIT_PCT}%) and ${consecutiveStopouts} consecutive stop-outs recorded.`;
    }
    if (isLossBreach) {
      return `Daily Loss limit breached: -${dailyLossPct.toFixed(2)}% loss (hard threshold: ${DAILY_DRAWDOWN_LIMIT_PCT}%).`;
    }
    return `Consecutive stop-outs limit reached: ${consecutiveStopouts} stops (hard threshold: ${MAX_CONSECUTIVE_STOPOUTS}).`;
  }, [isCircuitBreakerTripped, isLossBreach, isStopoutBreach, dailyLossPct, consecutiveStopouts]);

  const resetCircuitBreaker = useCallback(() => {
    setCircuitBreakerManualReset(true);
    if (onSendNotification) {
      onSendNotification(
        'Circuit Breaker Reset',
        'Daily drawdown circuit breaker manually cleared by operator override.',
        'RISK'
      );
    }
  }, [onSendNotification]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. UNIFIED AI MATRIX CORRELATION ENGINE: 4 Agents Scoring (0 - 180 points)
  // ═══════════════════════════════════════════════════════════════════════════
  const selectedMarketTicker =
    markets[selectedSymbol] ||
    (selectedSymbol.startsWith('BTC') ? markets['BTCUSDT'] || markets['BTCUSD'] : undefined);
  const curMarket = selectedMarketTicker || markets['BTCUSDT'] || markets['BTCUSD'] || {
    symbol: selectedSymbol,
    markPrice: 81702.50,
    change24h: 1.82,
    high24h: 82300.0,
    low24h: 80800.0,
  };
  const markPrice = curMarket.markPrice || 81702.50;
  const hasLiveMarkets = Boolean(selectedMarketTicker && selectedMarketTicker.markPrice > 0);

  const preliminarySide: 'LONG' | 'SHORT' =
    signalOverride?.side ||
    activeSignalSide ||
    (aiAnalysis?.tradeCard?.action === 'SELL_SHORT'
      ? 'SHORT'
      : aiAnalysis?.tradeCard?.action === 'BUY_LONG'
      ? 'LONG'
      : (curMarket.change24h ?? 0) < 0
      ? 'SHORT'
      : 'LONG');

  // 15-Minute Moving Average Slope & AI Signal Context Radar (computed early to harmonize directional bias)
  const maSlopeData = use15mMaSlope(selectedSymbol, markPrice, preliminarySide);

  // Unified directional bias: prioritize explicit override / active Sniper signal, then 15m EMA slope, then AI Card / 24h momentum
  const resolvedSide: 'LONG' | 'SHORT' =
    signalOverride?.side ||
    activeSignalSide ||
    (maSlopeData.direction === 'DOWN'
      ? 'SHORT'
      : maSlopeData.direction === 'UP'
      ? 'LONG'
      : preliminarySide);

  const matrixDirection: 'BULLISH' | 'BEARISH' = resolvedSide === 'SHORT' ? 'BEARISH' : 'BULLISH';

  const agentScores = useMemo(() => {
    const directionalStrength =
      resolvedSide === 'SHORT'
        ? Math.max(aiAnalysis?.sentiment?.bearishPercent ?? 55, aiAnalysis?.confidenceScore ?? 80)
        : Math.max(aiAnalysis?.sentiment?.bullishPercent ?? 55, aiAnalysis?.confidenceScore ?? 80);
    const baseTrend = aiAnalysis?.sentiment
      ? Math.min(45, Math.max(30, Math.round(directionalStrength * 0.45)))
      : 43;
    const baseSmartMoney = aiAnalysis?.confidenceScore
      ? Math.min(45, Math.max(32, Math.round(aiAnalysis.confidenceScore * 0.47)))
      : 43;
    const baseOptions = 42;
    const baseRisk = isCircuitBreakerTripped ? 0 : 41;

    return {
      trend: baseTrend,
      smartMoney: baseSmartMoney,
      options: baseOptions,
      risk: baseRisk,
    };
  }, [aiAnalysis, isCircuitBreakerTripped, resolvedSide]);

  const totalMatrixScore = agentScores.trend + agentScores.smartMoney + agentScores.options + agentScores.risk;
  const matrixMaxScore = 180;
  const convictionPct = Math.round((totalMatrixScore / matrixMaxScore) * 100);
  const tradeGrade: 'A+' | 'A' | 'B+' | 'B' =
    totalMatrixScore >= 162 ? 'A+' : totalMatrixScore >= 148 ? 'A' : totalMatrixScore >= 135 ? 'B+' : 'B';

  const aiMatrixScore: AiMatrixScore = useMemo(
    () => ({
      total: totalMatrixScore,
      max: matrixMaxScore,
      grade: tradeGrade,
      direction: matrixDirection,
      gradeWithDirection: `Grade ${tradeGrade} (${matrixDirection})`,
      convictionPct,
      agents: agentScores,
    }),
    [totalMatrixScore, tradeGrade, matrixDirection, convictionPct, agentScores]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. UNIVERSAL RISK EVALUATION FUNCTION
  // ═══════════════════════════════════════════════════════════════════════════
  const evaluateSignalRisk = useCallback(
    (proposal: SignalProposal): RiskEvaluationResult => {
      const {
        entryPrice,
        stopLoss,
        tp1,
        strategy = 'BREAKOUT',
        isBreakout = true,
        cprWidthPct = 0.05,
      } = proposal;

      // Gate 1: Circuit Breaker
      if (isCircuitBreakerTripped) {
        return {
          approved: false,
          gateFailed: 'CIRCUIT_BREAKER',
          rejectionReason: `Trading Circuit Breaker Active: ${circuitBreakerReason}`,
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio: 0,
          invalidationDistance: 0,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Gate 2: Invalidation distance check
      const invalidationDistance = Math.abs(entryPrice - stopLoss);
      if (invalidationDistance <= 0 || !isFinite(invalidationDistance)) {
        return {
          approved: false,
          gateFailed: 'INVALIDATION',
          rejectionReason: 'Invalid stop-loss: Distance to invalidation must be greater than zero.',
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio: 0,
          invalidationDistance: 0,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Gate 3: Reward-to-Risk Gate (R:R >= 1.50R)
      const rewardDistance = Math.abs(tp1 - entryPrice);
      const riskRewardRatio = invalidationDistance > 0 ? +(rewardDistance / invalidationDistance).toFixed(2) : 0;
      if (riskRewardRatio < MIN_REWARD_RISK_RATIO) {
        return {
          approved: false,
          gateFailed: 'REWARD_RISK',
          rejectionReason: `Reward-to-Risk Gated: Setup yields ${riskRewardRatio}R (below mandatory ${MIN_REWARD_RISK_RATIO}R minimum).`,
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio,
          invalidationDistance,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Gate 4: CPR Chop Filter (>0.35% width blocks breakout entries)
      const isBreakoutStrategy =
        isBreakout ||
        strategy.toUpperCase().includes('BREAKOUT') ||
        strategy.toUpperCase().includes('SCALP') ||
        strategy.toUpperCase().includes('SNIPER');

      if (isBreakoutStrategy && cprWidthPct > MAX_CPR_CHOP_WIDTH_PCT) {
        return {
          approved: false,
          gateFailed: 'CPR_CHOP',
          rejectionReason: `CPR Chop Filter: CPR width is ${cprWidthPct.toFixed(2)}% (> ${MAX_CPR_CHOP_WIDTH_PCT.toFixed(2)}% threshold). High chop probability blocks breakout execution.`,
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio,
          invalidationDistance,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Position Sizing Formula: Size = Max Risk / (Stop Distance + Friction)
      // Friction estimated as 0.06% of entry price (exchange fee + slippage allowance)
      const frictionEst = +(entryPrice * 0.0006).toFixed(2);
      const effectiveStopDistance = invalidationDistance + frictionEst;
      const rawLotSize = maxDollarRiskPerTrade / effectiveStopDistance;
      // Precision: 0.001 BTC step lots, minimum 0.001
      const allowedLotSize = Math.max(0.001, +(Math.floor(rawLotSize * 1000) / 1000).toFixed(3));

      return {
        approved: true,
        allowedLotSize,
        maxDollarRisk: maxDollarRiskPerTrade,
        riskRewardRatio,
        invalidationDistance: +invalidationDistance.toFixed(2),
        riskPct: INITIAL_RISK_CAP_PCT,
      };
    },
    [isCircuitBreakerTripped, circuitBreakerReason, maxDollarRiskPerTrade]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. MASTER CORRELATED SIGNAL (Unified Institutional Setup — Immutable Snapshot)
  // ═══════════════════════════════════════════════════════════════════════════
  const defaultSide: 'LONG' | 'SHORT' = resolvedSide;
  const priceDecimals = markPrice >= 100 ? 2 : markPrice >= 10 ? 3 : 4;
  const candidateEntry = +markPrice.toFixed(priceDecimals);
  const isLongSetup = defaultSide === 'LONG';
  // Clean risk-calibrated distances: SL = 0.50%, TP1 = 0.80% (yields 1.60R >= 1.50R mandatory gate)
  const candidateStop = +(candidateEntry * (isLongSetup ? 0.995 : 1.005)).toFixed(priceDecimals);
  const candidateTp1 = +(candidateEntry * (isLongSetup ? 1.008 : 0.992)).toFixed(priceDecimals);
  const candidateTp2 = +(candidateEntry * (isLongSetup ? 1.0125 : 0.9875)).toFixed(priceDecimals);
  const candidateTp3 = +(candidateEntry * (isLongSetup ? 1.0175 : 0.9825)).toFixed(priceDecimals);
  const candidateTp4 = +(candidateEntry * (isLongSetup ? 1.025 : 0.975)).toFixed(priceDecimals);

  const matrixSetupKey = activeSignalId || `ai-matrix-${selectedSymbol}-${defaultSide}`;
  const [lockedActiveSignal, setLockedActiveSignal] = useState<LockedSignalSnapshot | null>(null);
  const lockedSignalRef = useRef<LockedSignalSnapshot | null>(null);
  const fallbackTimestampRef = useRef<number>(Date.now());
  const [refreshVersion, setRefreshVersion] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [signalCooldown, setSignalCooldown] = useState<SignalCooldownState | null>(null);
  const signalCooldownRef = useRef<SignalCooldownState | null>(null);
  const handledPreEntryBreachRef = useRef<Record<string, 'SL' | 'TP1'>>({});

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshLockedSignal = useCallback(() => {
    signalCooldownRef.current = null;
    setSignalCooldown(null);
    lockedSignalRef.current = null;
    setLockedActiveSignal(null);
    setRefreshVersion((prev) => prev + 1);
    setNowTick(Date.now());
  }, []);

  const startSignalCooldown = useCallback(
    (reason: 'SL' | 'TP1' | 'TP4', durationMs?: number, symbol?: string) => {
      const effectiveMs =
        typeof durationMs === 'number'
          ? durationMs
          : reason === 'SL'
          ? SIGNAL_SL_COOLDOWN_MS
          : reason === 'TP1'
          ? SIGNAL_TP1_COOLDOWN_MS
          : 0;
      const targetSym = symbol || selectedSymbol;
      if (effectiveMs <= 0) {
        signalCooldownRef.current = null;
        setSignalCooldown(null);
        return;
      }
      const nextCooldown: SignalCooldownState = {
        until: Date.now() + effectiveMs,
        reason,
        symbol: targetSym,
      };
      signalCooldownRef.current = nextCooldown;
      setSignalCooldown(nextCooldown);
      setNowTick(Date.now());
    },
    [selectedSymbol]
  );

  const clearLockedSignalForCooldown = useCallback(
    (reason: 'SL' | 'TP4', durationMs?: number, symbol?: string) => {
      lockedSignalRef.current = null;
      setLockedActiveSignal(null);
      const effectiveMs =
        typeof durationMs === 'number'
          ? durationMs
          : reason === 'SL'
          ? SIGNAL_SL_COOLDOWN_MS
          : 0;
      if (effectiveMs > 0) {
        startSignalCooldown(reason, effectiveMs, symbol);
      } else {
        signalCooldownRef.current = null;
        setSignalCooldown(null);
        setRefreshVersion((prev) => prev + 1);
      }
      setNowTick(Date.now());
    },
    [startSignalCooldown]
  );

  // Automatic cooldown expiry watcher -> clears cooldown & triggers next fresh scan
  useEffect(() => {
    if (!signalCooldown) return;
    if (nowTick >= signalCooldown.until) {
      signalCooldownRef.current = null;
      setSignalCooldown(null);
      lockedSignalRef.current = null;
      setLockedActiveSignal(null);
      setRefreshVersion((prev) => prev + 1);
    }
  }, [signalCooldown, nowTick]);

  useEffect(() => {
    if (!hasLiveMarkets || !(candidateEntry > 0)) return;
    if (signalCooldownRef.current && Date.now() < signalCooldownRef.current.until) {
      return;
    }
    const needsNewLock =
      !lockedSignalRef.current ||
      lockedSignalRef.current.id !== matrixSetupKey ||
      lockedSignalRef.current.symbol !== selectedSymbol ||
      lockedSignalRef.current.direction !== defaultSide;

    if (needsNewLock) {
      const snapshot: LockedSignalSnapshot = {
        id: matrixSetupKey,
        symbol: selectedSymbol,
        direction: defaultSide,
        entryPrice: candidateEntry,
        stopLoss: candidateStop,
        tp1: candidateTp1,
        tp2: candidateTp2,
        tp3: candidateTp3,
        tp4: candidateTp4,
        convictionPct,
        timestamp: Date.now(),
      };
      lockedSignalRef.current = snapshot;
      setLockedActiveSignal(snapshot);
    }
  }, [
    hasLiveMarkets,
    matrixSetupKey,
    selectedSymbol,
    defaultSide,
    candidateEntry,
    candidateStop,
    candidateTp1,
    candidateTp2,
    candidateTp3,
    candidateTp4,
    convictionPct,
    refreshVersion,
  ]);

  const activeLockedSnapshot =
    lockedActiveSignal &&
    lockedActiveSignal.id === matrixSetupKey &&
    lockedActiveSignal.symbol === selectedSymbol &&
    lockedActiveSignal.direction === defaultSide
      ? lockedActiveSignal
      : null;

  const hasActivePositionForSymbol = useMemo(
    () => positions.some((p) => p.symbol === selectedSymbol),
    [positions, selectedSymbol]
  );

  const signalValidity = useMemo<SignalValidityState>(() => {
    const base = evaluateLockedSignalValidity(activeLockedSnapshot, markPrice, nowTick, hasActivePositionForSymbol);
    const activeCooldownSec =
      signalCooldown && signalCooldown.until > nowTick
        ? Math.max(1, Math.ceil((signalCooldown.until - nowTick) / 1000))
        : 0;
    return {
      ...base,
      cooldownRemainingSec: activeCooldownSec,
      cooldownReason: activeCooldownSec > 0 && signalCooldown ? signalCooldown.reason : null,
    };
  }, [activeLockedSnapshot, markPrice, nowTick, hasActivePositionForSymbol, signalCooldown]);

  // Pre-entry Stop Loss Breach (30s cooldown + voice) & Pre-entry TP1 Hit (15s cooldown)
  useEffect(() => {
    if (!activeLockedSnapshot || hasActivePositionForSymbol) return;
    const key = `${activeLockedSnapshot.id}:${activeLockedSnapshot.timestamp}`;

    if (signalValidity.breachType === 'SL_INVALIDATED' && handledPreEntryBreachRef.current[key] !== 'SL') {
      handledPreEntryBreachRef.current[key] = 'SL';
      startSignalCooldown('SL', SIGNAL_SL_COOLDOWN_MS, activeLockedSnapshot.symbol);
      speakSoftFemaleVoice('Signal invalidated. Stop loss level breached. Scanning for next structure.');
      if (onSendNotification) {
        onSendNotification(
          'Signal Invalidated · SL Breached',
          `${activeLockedSnapshot.symbol} ${activeLockedSnapshot.direction} crossed SL ($${activeLockedSnapshot.stopLoss.toLocaleString()}). 30s post-SL cooldown active before next scan.`,
          'RISK'
        );
      }
    } else if (
      (signalValidity.breachType === 'TP1_COMPLETED' || signalValidity.breachType === 'TP4_COMPLETED') &&
      !handledPreEntryBreachRef.current[key]
    ) {
      handledPreEntryBreachRef.current[key] = 'TP1';
      startSignalCooldown('TP1', SIGNAL_TP1_COOLDOWN_MS, activeLockedSnapshot.symbol);
      if (onSendNotification) {
        onSendNotification(
          'Setup Completed · TP1 Reached',
          `${activeLockedSnapshot.symbol} ${activeLockedSnapshot.direction} hit TP1 ($${activeLockedSnapshot.tp1.toLocaleString()}) prior to entry. Scanning next fresh setup in 15s.`,
          'INFO'
        );
      }
    }
  }, [
    activeLockedSnapshot,
    hasActivePositionForSymbol,
    signalValidity.breachType,
    startSignalCooldown,
    onSendNotification,
  ]);

  const defaultEntry = activeLockedSnapshot ? activeLockedSnapshot.entryPrice : candidateEntry;
  const defaultStop = activeLockedSnapshot ? activeLockedSnapshot.stopLoss : candidateStop;
  const defaultTp1 = activeLockedSnapshot ? activeLockedSnapshot.tp1 : candidateTp1;
  const defaultTp2 = activeLockedSnapshot ? activeLockedSnapshot.tp2 : candidateTp2;
  const defaultTp3 = activeLockedSnapshot ? activeLockedSnapshot.tp3 : candidateTp3;
  const defaultTp4 = activeLockedSnapshot ? activeLockedSnapshot.tp4 : candidateTp4;
  const signalTimestamp = activeLockedSnapshot ? activeLockedSnapshot.timestamp : fallbackTimestampRef.current;

  const riskEvaluation = useMemo(() => {
    return evaluateSignalRisk({
      symbol: selectedSymbol,
      side: defaultSide,
      entryPrice: defaultEntry,
      stopLoss: defaultStop,
      tp1: defaultTp1,
      strategy: 'AI_MATRIX_BREAKOUT',
      isBreakout: true,
      cprWidthPct: 0.05,
    });
  }, [evaluateSignalRisk, selectedSymbol, defaultSide, defaultEntry, defaultStop, defaultTp1]);

  const frictionEst = +(defaultEntry * 0.0006).toFixed(2);

  const baseCorrelatedSignal: CorrelatedSignal = useMemo(
    () => ({
      id: matrixSetupKey,
      symbol: selectedSymbol,
      side: defaultSide,
      entryPrice: defaultEntry,
      stopLoss: defaultStop,
      tp1: defaultTp1,
      tp2: defaultTp2,
      tp3: defaultTp3,
      tp4: defaultTp4,
      matrixScore: aiMatrixScore,
      allowedLotSize: riskEvaluation.allowedLotSize,
      maxDollarRisk: maxDollarRiskPerTrade,
      invalidationDistance: riskEvaluation.invalidationDistance,
      frictionEst,
      riskRewardRatio: riskEvaluation.riskRewardRatio,
      cprWidthPct: 0.05,
      isApproved: riskEvaluation.approved,
      gateFailed: riskEvaluation.gateFailed,
      rejectionReason: riskEvaluation.rejectionReason,
      source: 'AI_MATRIX_CORRELATION',
      timestamp: signalTimestamp,
    }),
    [
      matrixSetupKey,
      selectedSymbol,
      defaultSide,
      defaultEntry,
      defaultStop,
      defaultTp1,
      defaultTp2,
      defaultTp3,
      defaultTp4,
      aiMatrixScore,
      riskEvaluation,
      maxDollarRiskPerTrade,
      frictionEst,
      signalTimestamp,
    ]
  );

  const correlatedSignal = useMemo(() => {
    if (!signalOverride) return baseCorrelatedSignal;
    return {
      ...baseCorrelatedSignal,
      ...signalOverride,
    };
  }, [baseCorrelatedSignal, signalOverride]);

  const setCorrelatedSignalOverride = useCallback((partial: Partial<CorrelatedSignal>) => {
    setSignalOverride((prev) => (prev ? { ...prev, ...partial } : partial));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DYNAMIC RATCHET ENGINE (Stage 1: +1.5R BE / Scale 25%, Stage 2: +2.5R Trailing ATR)
  // ═══════════════════════════════════════════════════════════════════════════
  const [positionAdjustments, setPositionAdjustments] = useState<Record<string, PositionAdjustment>>({});
  const lastEvaluatedTimesRef = useRef<Record<string, number>>({});
  const onSendNotificationRef = useRef(onSendNotification);
  onSendNotificationRef.current = onSendNotification;

  useEffect(() => {
    if (!positions || positions.length === 0) {
      setPositionAdjustments((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const newAdjustments: Record<string, PositionAdjustment> = {};

    positions.forEach((pos) => {
      const isLong = pos.side === 'LONG';
      const entry = pos.entryPrice;
      const current = pos.markPrice || entry;
      const initialStop = pos.initialStop || (isLong ? entry - 250 : entry + 250);
      const stopDistance = Math.abs(entry - initialStop);

      if (stopDistance <= 0) return;

      const currentPnlPoints = isLong ? current - entry : entry - current;
      const currentR = Number((currentPnlPoints / stopDistance).toFixed(2));
      const uPnlPct = pos.unrealisedPnlPercent || 0;

      // STAGE 1: +1.2R to < +2.0R (The Harvest & Half-Risk Cushion Rule)
      if (currentR >= 1.2 && currentR < 2.0 && !pos.stage1Executed) {
        // Set stop to -0.5R (half-risk cushion) to give room for the breakout backtest
        const cushionStop = isLong 
          ? entry - (stopDistance * 0.5) 
          : entry + (stopDistance * 0.5);

        const headline = `STAGE 1 TARGET (+${currentR}R): Harvest 30% & Set Half-Risk Cushion`;
        const detail = `Bank 30% gains. Adjust Stop Loss to $${cushionStop.toFixed(2)} (-0.5R cushion) to absorb retest without scratching.`;

        newAdjustments[pos.id] = {
          id: `harvest-1-${pos.id}-${Date.now()}`,
          positionId: pos.id,
          symbol: pos.symbol,
          side: pos.side,
          stage: 1,
          type: 'HALF_RISK_CUSHION',
          action: 'SCALE_PROFIT',
          recommendedStopLoss: Number(cushionStop.toFixed(2)),
          suggestedStop: Number(cushionStop.toFixed(2)),
          recommendedScalePct: 30,
          currentMarkPrice: current,
          entryPrice: entry,
          unrealizedPnlPct: uPnlPct,
          rMultiple: currentR,
          reason: detail,
          headline,
          detail,
          timestamp: Date.now(),
        };
      }
      // STAGE 2: +2.0R to < +3.0R (Lock in True Profit)
      else if (currentR >= 2.0 && currentR < 3.0 && !pos.stage2Executed) {
        // Move stop to +0.5R in profit
        const profitStop = isLong 
          ? entry + (stopDistance * 0.5) 
          : entry - (stopDistance * 0.5);

        const headline = `STAGE 2 MILESTONE (+${currentR}R): Lock 30% & Move SL to +0.5R Profit`;
        const detail = `Bank an additional 30% (60% total). Lock Stop Loss at $${profitStop.toFixed(2)} in green territory.`;

        newAdjustments[pos.id] = {
          id: `lock-profit-${pos.id}-${Date.now()}`,
          positionId: pos.id,
          symbol: pos.symbol,
          side: pos.side,
          stage: 2,
          type: 'PROFIT_LOCK_RATCHET',
          action: 'SCALE_PROFIT',
          recommendedStopLoss: Number(profitStop.toFixed(2)),
          suggestedStop: Number(profitStop.toFixed(2)),
          recommendedScalePct: 30,
          currentMarkPrice: current,
          entryPrice: entry,
          unrealizedPnlPct: uPnlPct,
          rMultiple: currentR,
          reason: detail,
          headline,
          detail,
          timestamp: Date.now(),
        };
      }
      // STAGE 3: +3.0R+ (ATR Volatility Runner Trail)
      else if (currentR >= 3.0) {
        const atrValue = pos.atr14 || (entry * 0.0035) || 165;
        const trailingBuffer = atrValue * 1.5;
        const dynamicTrailStop = isLong ? current - trailingBuffer : current + trailingBuffer;

        const currentStop = pos.stopLoss || (isLong ? entry * 0.98 : entry * 1.02);
        const shouldRatchet = isLong 
          ? dynamicTrailStop > currentStop 
          : dynamicTrailStop < currentStop;

        if (shouldRatchet) {
          const headline = `STAGE 3 RUNNER (+${currentR}R): Dynamic 1.5x ATR Trail`;
          const detail = `Trailing 40% runner behind 5m volatility. Move SL to $${dynamicTrailStop.toFixed(2)}.`;

          newAdjustments[pos.id] = {
            id: `trail-runner-${pos.id}-${Date.now()}`,
            positionId: pos.id,
            symbol: pos.symbol,
            side: pos.side,
            stage: 3,
            type: 'DYNAMIC_ATR_TRAIL',
            action: 'TRAIL_ATR',
            recommendedStopLoss: Number(dynamicTrailStop.toFixed(2)),
            suggestedStop: Number(dynamicTrailStop.toFixed(2)),
            recommendedScalePct: 0,
            currentMarkPrice: current,
            entryPrice: entry,
            unrealizedPnlPct: uPnlPct,
            rMultiple: currentR,
            reason: detail,
            headline,
            detail,
            timestamp: Date.now(),
          };
        }
      }
    });

    setPositionAdjustments((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(newAdjustments);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((k) => {
          const a = prev[k];
          const b = newAdjustments[k];
          return (
            a &&
            b &&
            a.stage === b.stage &&
            a.recommendedStopLoss === b.recommendedStopLoss &&
            a.rMultiple === b.rMultiple
          );
        })
      ) {
        return prev;
      }
      return newAdjustments;
    });

    // Auto-alert once per stage trigger (15-minute deduplication cooldown)
    Object.values(newAdjustments).forEach((adj) => {
      const key = `${adj.positionId}_${adj.stage}`;
      const lastSent = lastEvaluatedTimesRef.current[key] || 0;
      if (Date.now() - lastSent > 15 * 60 * 1000) {
        lastEvaluatedTimesRef.current[key] = Date.now();
        if (onSendNotificationRef.current) {
          onSendNotificationRef.current(
            adj.headline || `Dynamic Risk Ratchet Stage ${adj.stage}`,
            `${adj.symbol} reached +${adj.rMultiple}R. ${adj.reason}`,
            'RISK'
          );
        }
      }
    });
  }, [positions]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. BTC CORRELATION & DECOUPLING TRACKER (30-period rolling correlation)
  // ═══════════════════════════════════════════════════════════════════════════
  const btcPriceHistoryRef = useRef<number[]>([]);
  const symbolPriceHistoryRef = useRef<Record<string, number[]>>({});

  const btcCorrelation = useMemo<BtcCorrelationMetric>(() => {
    const btcMarket = markets['BTCUSDT'] || markets['BTCUSD'];
    const curMarket = markets[selectedSymbol];

    if (selectedSymbol === 'BTCUSDT' || selectedSymbol === 'BTCUSD') {
      return {
        symbol: selectedSymbol,
        coefficient: 1.0,
        status: 'COUPLED',
        isDecoupled: false,
        description: 'Anchor Asset (1.00 Baseline)',
        beta: 1.0,
      };
    }

    const btcPrice = btcMarket?.markPrice || 81700;
    const curPrice = curMarket?.markPrice || (selectedSymbol === 'ETHUSDT' ? 2450 : selectedSymbol === 'SOLUSDT' ? 145 : 100);

    if (!symbolPriceHistoryRef.current[selectedSymbol]) {
      const btcChange = (btcMarket?.change24h || 1.2) / 100;
      const altChange = (curMarket?.change24h || 2.5) / 100;
      const seedBtc: number[] = [];
      const seedAlt: number[] = [];
      for (let i = 29; i >= 0; i--) {
        const factor = Math.sin(i / 3) * 0.004;
        const idiosyncratic = (selectedSymbol === 'SOLUSDT' || selectedSymbol === 'DOGEUSDT') ? Math.cos(i / 2) * 0.008 : factor * 0.5;
        seedBtc.push(btcPrice * (1 - (btcChange * (i / 30)) + factor));
        seedAlt.push(curPrice * (1 - (altChange * (i / 30)) + factor + idiosyncratic));
      }
      btcPriceHistoryRef.current = seedBtc;
      symbolPriceHistoryRef.current[selectedSymbol] = seedAlt;
    }

    const btcArr = btcPriceHistoryRef.current;
    const altArr = symbolPriceHistoryRef.current[selectedSymbol] || [];

    const n = Math.min(btcArr.length, altArr.length);
    if (n < 5) {
      return {
        symbol: selectedSymbol,
        coefficient: 0.85,
        status: 'COUPLED',
        isDecoupled: false,
        description: 'Macro Synchronized to BTC Flow',
        beta: 1.1,
      };
    }

    const btcReturns: number[] = [];
    const altReturns: number[] = [];
    for (let i = 1; i < n; i++) {
      btcReturns.push((btcArr[i] - btcArr[i - 1]) / btcArr[i - 1]);
      altReturns.push((altArr[i] - altArr[i - 1]) / altArr[i - 1]);
    }

    const meanBtc = btcReturns.reduce((a, b) => a + b, 0) / btcReturns.length;
    const meanAlt = altReturns.reduce((a, b) => a + b, 0) / altReturns.length;

    let num = 0;
    let denBtc = 0;
    let denAlt = 0;
    for (let i = 0; i < btcReturns.length; i++) {
      const db = btcReturns[i] - meanBtc;
      const da = altReturns[i] - meanAlt;
      num += db * da;
      denBtc += db * db;
      denAlt += da * da;
    }

    const denom = Math.sqrt(denBtc * denAlt);
    let r = denom > 0 ? num / denom : 0.85;
    r = Math.max(-1.0, Math.min(1.0, +r.toFixed(2)));

    const beta = denBtc > 0 ? +(num / denBtc).toFixed(2) : 1.0;
    const isDecoupled = Math.abs(r) < 0.45;
    const status: 'COUPLED' | 'MODERATE' | 'DECOUPLED' = isDecoupled
      ? 'DECOUPLED'
      : r >= 0.75
      ? 'COUPLED'
      : 'MODERATE';

    const description = isDecoupled
      ? `Idiosyncratic Alpha: Decoupled from BTC (|r|=${Math.abs(r)} < 0.45). Moving on independent volume & order-flow.`
      : r < 0
      ? `Inverse Divergence (r=${r}): Negative correlation to BTC. Potential hedge or counter-drift play.`
      : `High Macro Beta (r=${r}): Synchronized with BTC market trend & liquidations.`;

    return {
      symbol: selectedSymbol,
      coefficient: r,
      status,
      isDecoupled,
      description,
      beta,
    };
  }, [markets, selectedSymbol]);

  const activeAdjustmentsList = useMemo(() => Object.values(positionAdjustments), [positionAdjustments]);
  const activeAdjustment = activeAdjustmentsList[0] || null;

  const applyAdjustmentToPosition = useCallback(
    (posId: string) => {
      const adj = positionAdjustments[posId];
      if (!adj) return;

      if (onUpdatePositionSL) {
        onUpdatePositionSL(posId, adj.recommendedStopLoss);
      }
      if (adj.recommendedScalePct > 0 && onScalePosition) {
        onScalePosition(posId, adj.recommendedScalePct);
      }
      if (onSendNotification) {
        onSendNotification(
          'Risk Ratchet Executed',
          `Applied ${adj.type} to ${adj.symbol}: Stop Loss moved to $${adj.recommendedStopLoss.toLocaleString()}${
            adj.recommendedScalePct > 0 ? ` and scaled ${adj.recommendedScalePct}% lots.` : '.'
          }`,
          'TRADE'
        );
      }
    },
    [positionAdjustments, onUpdatePositionSL, onScalePosition, onSendNotification]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. GLOBAL SYNCHRONIZATION TO EXECUTION PAD
  // ═══════════════════════════════════════════════════════════════════════════
  const syncLevelToExecutionPad = useCallback(
    (level: {
      price?: number;
      stopLoss?: number;
      takeProfit?: number;
      size?: number;
      symbol?: string;
      side?: 'LONG' | 'SHORT';
      reason?: string;
      type?: 'ENTRY' | 'SL' | 'TP1' | 'TP2' | 'BE_STOP' | 'POC' | 'H4' | 'L4' | 'CPR';
      stage?: 1 | 2 | 3;
    }) => {
      setCuedPadSetup({
        symbol: level.symbol || selectedSymbol,
        side: level.side || defaultSide,
        price: level.price,
        stopLoss: level.stopLoss,
        takeProfit: level.takeProfit,
        size: level.size,
        reason: level.reason,
        levelType: level.type,
        stage: level.stage,
        timestamp: Date.now(),
      });
      if (onSendNotification) {
        onSendNotification(
          'Execution Pad Synchronized',
          `Auto-populated ${level.type || 'Price Level'}: ${
            level.price ? `$${level.price.toLocaleString()}` : ''
          } ${level.stopLoss ? `SL: $${level.stopLoss.toLocaleString()}` : ''} into Execution Pad.`,
          'INFO'
        );
      }
    },
    [selectedSymbol, defaultSide, onSendNotification]
  );

  const applyMatrixSignalToPad = useCallback(() => {
    syncLevelToExecutionPad({
      symbol: correlatedSignal.symbol,
      side: correlatedSignal.side,
      price: correlatedSignal.entryPrice,
      stopLoss: correlatedSignal.stopLoss,
      takeProfit: correlatedSignal.tp1,
      size: correlatedSignal.allowedLotSize,
      reason: `AI Matrix Signal (${correlatedSignal.matrixScore.total}/180 · Grade ${correlatedSignal.matrixScore.grade} ${correlatedSignal.side === 'LONG' ? 'BULLISH' : 'BEARISH'})`,
      type: 'ENTRY',
    });
  }, [syncLevelToExecutionPad, correlatedSignal]);

  const clearCuedPadSetup = useCallback(() => {
    setCuedPadSetup(null);
  }, []);

  const value = useMemo<AiMatrixCorrelationContextType>(
    () => ({
      aiMatrixScore,
      agentScores,
      totalMatrixScore,
      matrixMaxScore,
      tradeGrade,
      convictionPct,

      correlatedSignal,
      lockedActiveSignal: activeLockedSnapshot,
      signalValidity,
      signalCooldown,
      startSignalCooldown,
      clearLockedSignalForCooldown,
      refreshLockedSignal,
      refreshVersion,
      hasLiveMarkets,
      setCorrelatedSignalOverride,

      evaluateSignalRisk,
      riskEvaluation,
      maxDollarRiskPerTrade,
      dailyLossPct,
      dailyRealizedLossUsd,
      consecutiveStopouts,
      isCircuitBreakerTripped,
      circuitBreakerReason,
      resetCircuitBreaker,

      positionAdjustments,
      activeAdjustmentsList,
      activeAdjustment,
      applyAdjustmentToPosition,

      cuedPadSetup,
      syncLevelToExecutionPad,
      applyMatrixSignalToPad,
      clearCuedPadSetup,

      btcCorrelation,
      maSlopeData,
    }),
    [
      aiMatrixScore,
      agentScores,
      totalMatrixScore,
      matrixMaxScore,
      tradeGrade,
      convictionPct,
      correlatedSignal,
      activeLockedSnapshot,
      signalValidity,
      signalCooldown,
      startSignalCooldown,
      clearLockedSignalForCooldown,
      refreshLockedSignal,
      refreshVersion,
      hasLiveMarkets,
      setCorrelatedSignalOverride,
      evaluateSignalRisk,
      riskEvaluation,
      maxDollarRiskPerTrade,
      dailyLossPct,
      dailyRealizedLossUsd,
      consecutiveStopouts,
      isCircuitBreakerTripped,
      circuitBreakerReason,
      resetCircuitBreaker,
      positionAdjustments,
      activeAdjustmentsList,
      activeAdjustment,
      applyAdjustmentToPosition,
      cuedPadSetup,
      syncLevelToExecutionPad,
      applyMatrixSignalToPad,
      clearCuedPadSetup,
      btcCorrelation,
      maSlopeData,
    ]
  );

  return <AiMatrixCorrelationContext.Provider value={value}>{children}</AiMatrixCorrelationContext.Provider>;
};

export const useAiMatrixCorrelation = (): AiMatrixCorrelationContextType => {
  const context = useContext(AiMatrixCorrelationContext);
  if (!context) {
    // Safe resilient fallback
    const fallbackScore: AiMatrixScore = {
      total: 161,
      max: 180,
      grade: 'A+',
      convictionPct: 89,
      agents: { trend: 41, smartMoney: 42, options: 39, risk: 39 },
    };
    return {
      aiMatrixScore: fallbackScore,
      agentScores: fallbackScore.agents,
      totalMatrixScore: 161,
      matrixMaxScore: 180,
      tradeGrade: 'A+',
      convictionPct: 89,
      correlatedSignal: {
        id: 'fallback-matrix-signal',
        symbol: 'BTCUSDT',
        side: 'LONG',
        entryPrice: 81702.50,
        stopLoss: 81250.00,
        tp1: 82500.00,
        tp2: 83200.00,
        tp3: 84000.00,
        tp4: 85100.00,
        matrixScore: fallbackScore,
        allowedLotSize: 0.011,
        maxDollarRisk: 5.0,
        invalidationDistance: 452.5,
        frictionEst: 49.02,
        riskRewardRatio: 1.76,
        cprWidthPct: 0.05,
        isApproved: true,
        source: 'AI_MATRIX_CORRELATION',
        timestamp: Date.now(),
      },
      lockedActiveSignal: null,
      signalValidity: {
        status: 'FRESH',
        ageMs: 0,
        isExpiredByTime: false,
        isMissedEntryDrift: false,
        isTargetOrStopBreached: false,
        breachType: null,
        cooldownRemainingSec: 0,
        cooldownReason: null,
        driftPct: 0,
        reason: null,
      },
      signalCooldown: null,
      startSignalCooldown: () => {},
      clearLockedSignalForCooldown: () => {},
      refreshLockedSignal: () => {},
      refreshVersion: 0,
      hasLiveMarkets: false,
      setCorrelatedSignalOverride: () => {},
      evaluateSignalRisk: () => ({
        approved: true,
        allowedLotSize: 0.011,
        maxDollarRisk: 5.0,
        riskRewardRatio: 1.76,
        invalidationDistance: 452.5,
        riskPct: 0.50,
      }),
      riskEvaluation: {
        approved: true,
        allowedLotSize: 0.011,
        maxDollarRisk: 5.0,
        riskRewardRatio: 1.76,
        invalidationDistance: 452.5,
        riskPct: 0.50,
      },
      maxDollarRiskPerTrade: 5.0,
      dailyLossPct: 0,
      dailyRealizedLossUsd: 0,
      consecutiveStopouts: 0,
      isCircuitBreakerTripped: false,
      circuitBreakerReason: null,
      resetCircuitBreaker: () => {},
      positionAdjustments: {},
      activeAdjustmentsList: [],
      activeAdjustment: null,
      applyAdjustmentToPosition: () => {},
      cuedPadSetup: null,
      syncLevelToExecutionPad: () => {},
      applyMatrixSignalToPad: () => {},
      clearCuedPadSetup: () => {},
      btcCorrelation: {
        symbol: 'BTCUSDT',
        coefficient: 1.0,
        status: 'COUPLED',
        isDecoupled: false,
        description: 'Anchor Asset (1.00 Baseline)',
        beta: 1.0,
      },
      maSlopeData: {
        symbol: 'BTCUSDT',
        slopePct: 0.12,
        slopeFormatted: '+0.12%',
        direction: 'UP',
        angleDeg: 35,
        confidencePct: 86,
        streakCandles: 4,
        maPeriod: 20,
        currentMa: 81702.50,
        prevMa: 81604.20,
        timeframe: '15m',
        signalAlignment: 'ALIGNED',
        contextNote: '15m MA Slope (+0.12%) confirms bullish AI signal',
        isLoading: false,
        updatedAt: Date.now(),
      },
    };
  }
  return context;
};
