import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Position, ClosedTrade, RiskEvaluationResult, PositionAdjustment } from '../types';

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

export interface CuedAdjustment {
  symbol: string;
  side: 'LONG' | 'SHORT';
  stopLoss: number;
  takeProfit?: number;
  scalePct: number;
  reason: string;
  stage: 1 | 2 | 3;
  timestamp: number;
}

export interface RiskAdjustmentContextType {
  // Rules & Configuration
  initialRiskCapPct: number; // 0.50%
  dailyDrawdownLimitPct: number; // 1.50%
  maxConsecutiveStopouts: number; // 2
  minRewardRiskRatio: number; // 1.50R
  maxCprChopWidthPct: number; // 0.35%

  // Live Drawdown & Circuit Breaker State
  accountBalance: number;
  maxDollarRiskPerTrade: number; // e.g. $5.00 on $1,000 balance
  dailyRealizedLossUsd: number;
  dailyLossPct: number;
  consecutiveStopouts: number;
  isCircuitBreakerTripped: boolean;
  circuitBreakerReason: string | null;
  resetCircuitBreaker: () => void;

  // Signal Risk Evaluator (Master Override Engine)
  evaluateSignalRisk: (proposal: SignalProposal) => RiskEvaluationResult;

  // Dynamic 3-Stage Profit Cushion & Ratchet Ladder
  positionAdjustments: Record<string, PositionAdjustment>;
  activeAdjustmentsList: PositionAdjustment[];
  applyAdjustmentToPosition: (posId: string) => void;

  // Global Cued Adjustment for ExecutionPad Auto-Sync
  cuedAdjustment: CuedAdjustment | null;
  cueAdjustmentForExecutionPad: (adj: CuedAdjustment) => void;
  clearCuedAdjustment: () => void;
}

const DEFAULT_INITIAL_CAPITAL = 1000.0;
const INITIAL_RISK_CAP_PCT = 0.50; // 0.50%
const DAILY_DRAWDOWN_LIMIT_PCT = 1.50; // 1.50%
const MAX_CONSECUTIVE_STOPOUTS = 2;
const MIN_REWARD_RISK_RATIO = 1.50; // 1.50R
const MAX_CPR_CHOP_WIDTH_PCT = 0.35; // 0.35%

export const RiskAdjustmentContext = createContext<RiskAdjustmentContextType | null>(null);

interface RiskAdjustmentProviderProps {
  children: React.ReactNode;
  availableBalance?: number;
  totalEquity?: number;
  positions?: Position[];
  history?: ClosedTrade[];
  markPrice?: number;
  onUpdatePositionSL?: (posId: string, newSL: number) => void;
  onScalePosition?: (posId: string, scalePct: number) => void;
  onSendNotification?: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
}

export const RiskAdjustmentProvider: React.FC<RiskAdjustmentProviderProps> = ({
  children,
  availableBalance = DEFAULT_INITIAL_CAPITAL,
  totalEquity = DEFAULT_INITIAL_CAPITAL,
  positions = [],
  history = [],
  markPrice,
  onUpdatePositionSL,
  onScalePosition,
  onSendNotification,
}) => {
  const effectiveBalance = Math.max(100, totalEquity || availableBalance || DEFAULT_INITIAL_CAPITAL);

  // Maximum allowed dollar loss per individual trade based on strict 0.50% cap
  const maxDollarRiskPerTrade = +(effectiveBalance * (INITIAL_RISK_CAP_PCT / 100)).toFixed(2);

  // Track Circuit Breaker state
  const [consecutiveStopoutsOverride, setConsecutiveStopoutsOverride] = useState<number | null>(null);
  const [circuitBreakerManualReset, setCircuitBreakerManualReset] = useState<boolean>(false);

  // Evaluate Daily Realized Loss & Consecutive Stop-Outs from History
  const { dailyRealizedLossUsd, consecutiveStopouts, isCircuitBreakerTripped, circuitBreakerReason } = useMemo(() => {
    if (circuitBreakerManualReset) {
      return {
        dailyRealizedLossUsd: 0,
        consecutiveStopouts: 0,
        isCircuitBreakerTripped: false,
        circuitBreakerReason: null,
      };
    }

    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const todayTrades = history.filter((t) => (t.closedAt || 0) >= startOfToday);

    let realizedLossSum = 0;
    todayTrades.forEach((t) => {
      if (t.realisedPnl < 0) {
        realizedLossSum += Math.abs(t.realisedPnl);
      }
    });

    // Count consecutive stopouts in recent trades (ordered by closedAt descending)
    const sortedTrades = [...todayTrades].sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
    let stopoutStreak = 0;
    for (const trade of sortedTrades) {
      if (trade.realisedPnl < 0 && (trade.reason?.toLowerCase().includes('stop') || trade.pnlPercent <= -0.5)) {
        stopoutStreak++;
      } else {
        break;
      }
    }

    const currentStopouts = consecutiveStopoutsOverride !== null ? consecutiveStopoutsOverride : stopoutStreak;
    const maxDailyLossAllowed = effectiveBalance * (DAILY_DRAWDOWN_LIMIT_PCT / 100);

    let tripped = false;
    let reason: string | null = null;

    if (realizedLossSum >= maxDailyLossAllowed) {
      tripped = true;
      reason = `Daily drawdown limit reached ($${realizedLossSum.toFixed(2)} loss >= ${DAILY_DRAWDOWN_LIMIT_PCT.toFixed(2)}% account equity limit of $${maxDailyLossAllowed.toFixed(2)}). Trading locked.`;
    } else if (currentStopouts >= MAX_CONSECUTIVE_STOPOUTS) {
      tripped = true;
      reason = `Daily circuit breaker: ${currentStopouts} consecutive stop-outs encountered. High chop/loss regime lock activated.`;
    }

    return {
      dailyRealizedLossUsd: +realizedLossSum.toFixed(2),
      consecutiveStopouts: currentStopouts,
      isCircuitBreakerTripped: tripped,
      circuitBreakerReason: reason,
    };
  }, [history, effectiveBalance, consecutiveStopoutsOverride, circuitBreakerManualReset]);

  const dailyLossPct = effectiveBalance > 0 ? +((dailyRealizedLossUsd / effectiveBalance) * 100).toFixed(2) : 0;

  const resetCircuitBreaker = useCallback(() => {
    setCircuitBreakerManualReset(true);
    setConsecutiveStopoutsOverride(0);
    if (onSendNotification) {
      onSendNotification(
        'Circuit Breaker Reset',
        'Daily loss lock manually cleared by operator. Trading operations re-enabled under 0.50% risk cap.',
        'INFO'
      );
    }
  }, [onSendNotification]);

  // ═════════════════════════════════════════════════════════════════════════════
  // 1. RISK ENGINE OVERRIDE & SIGNAL EVALUATION GATE
  // ═════════════════════════════════════════════════════════════════════════════
  const evaluateSignalRisk = useCallback(
    (proposal: SignalProposal): RiskEvaluationResult => {
      const {
        side,
        entryPrice,
        stopLoss,
        tp1,
        strategy = 'SCALPING',
        isBreakout = true,
        cprWidthPct = 0.05,
      } = proposal;

      // Gate 1: Daily Drawdown Circuit Breaker check
      if (isCircuitBreakerTripped) {
        return {
          approved: false,
          gateFailed: 'CIRCUIT_BREAKER',
          rejectionReason: circuitBreakerReason || 'Daily drawdown circuit breaker active. New trade entries blocked.',
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio: 0,
          invalidationDistance: 0,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Gate 2: Invalidation distance check
      const invalidationDistance = Math.abs(entryPrice - stopLoss);
      if (invalidationDistance <= 0 || isNaN(invalidationDistance)) {
        return {
          approved: false,
          gateFailed: 'INVALIDATION',
          rejectionReason: 'Invalid setup geometry: Stop Loss cannot equal Entry Price (zero risk distance).',
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio: 0,
          invalidationDistance: 0,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Gate 3: Directional consistency
      if (side === 'LONG' && stopLoss >= entryPrice) {
        return {
          approved: false,
          gateFailed: 'INVALIDATION',
          rejectionReason: `Long entry violation: Stop loss ($${stopLoss}) must be below entry price ($${entryPrice}).`,
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio: 0,
          invalidationDistance,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }
      if (side === 'SHORT' && stopLoss <= entryPrice) {
        return {
          approved: false,
          gateFailed: 'INVALIDATION',
          rejectionReason: `Short entry violation: Stop loss ($${stopLoss}) must be above entry price ($${entryPrice}).`,
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio: 0,
          invalidationDistance,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Gate 4: Reward-to-Risk Gate (Reject any setup with R:R < 1.50R)
      const rewardDistance = Math.abs(tp1 - entryPrice);
      const riskRewardRatio = invalidationDistance > 0 ? +(rewardDistance / invalidationDistance).toFixed(2) : 0;
      if (riskRewardRatio < MIN_REWARD_RISK_RATIO) {
        return {
          approved: false,
          gateFailed: 'REWARD_RISK',
          rejectionReason: `Reward-to-Risk Gated: Setup yields ${riskRewardRatio}R (below mandatory ${MIN_REWARD_RISK_RATIO}R minimum threshold).`,
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio,
          invalidationDistance,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Gate 5: CPR Chop Filter (Block breakout signals when CPR width > 0.35%)
      const isBreakoutStrategy =
        isBreakout ||
        strategy.toUpperCase().includes('BREAKOUT') ||
        strategy.toUpperCase().includes('SCALP') ||
        strategy.toUpperCase().includes('SNIPER');

      if (isBreakoutStrategy && cprWidthPct > MAX_CPR_CHOP_WIDTH_PCT) {
        return {
          approved: false,
          gateFailed: 'CPR_CHOP',
          rejectionReason: `CPR Chop Filter: High chop regime detected (CPR Width ${cprWidthPct.toFixed(2)}% > ${MAX_CPR_CHOP_WIDTH_PCT.toFixed(2)}% threshold). Breakout signals blocked.`,
          allowedLotSize: 0,
          maxDollarRisk: maxDollarRiskPerTrade,
          riskRewardRatio,
          invalidationDistance,
          riskPct: INITIAL_RISK_CAP_PCT,
        };
      }

      // Strict Position Sizing derived from 0.50% account risk cap
      const frictionEst = +(entryPrice * 0.0006).toFixed(2);
      const effectiveStopDistance = invalidationDistance + frictionEst;
      const rawLotSize = maxDollarRiskPerTrade / effectiveStopDistance;
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

  // ═════════════════════════════════════════════════════════════════════════════
  // 2. HYBRID DYNAMIC PROFIT LADDER (Harvest & Half-Risk Cushion)
  // Stage 1 (+1.2R to +1.5R): Harvest 30% & Set Half-Risk Cushion (-0.5R) -> Guaranteed +0.10R net win
  // Stage 2 (+2.0R to +2.5R): Harvest 30% (60% total) & Move SL to +0.5R Profit
  // Stage 3 (+3.0R+): Dynamic 1.5x ATR(14) Volatility Runner Trail on 40% runner
  // ═════════════════════════════════════════════════════════════════════════════
  const [positionAdjustments, setPositionAdjustments] = useState<Record<string, PositionAdjustment>>({});
  const lastAnnouncedAdjustmentsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!positions || positions.length === 0) {
      setPositionAdjustments((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const newAdjustments: Record<string, PositionAdjustment> = {};

    positions.forEach((pos) => {
      const isLong = pos.side === 'LONG';
      const entry = pos.entryPrice;
      const current = pos.markPrice || markPrice || entry;
      const initialStop = pos.initialStop || (isLong ? entry - 250 : entry + 250);
      const stopDistance = Math.abs(entry - initialStop);

      if (stopDistance <= 0) return;

      const currentPnlPoints = isLong ? current - entry : entry - current;
      const currentR = Number((currentPnlPoints / stopDistance).toFixed(2));
      const uPnlPct = pos.unrealisedPnlPercent || 0;

      // STAGE 1: +1.2R to < +2.0R (The Harvest & Half-Risk Cushion Rule)
      if (currentR >= 1.2 && currentR < 2.0 && !pos.stage1Executed) {
        // Set stop to -0.5R (half-risk cushion) to give room for breakout backtest
        const cushionStop = isLong 
          ? entry - (stopDistance * 0.5) 
          : entry + (stopDistance * 0.5);

        const adjKey = `stage1-${pos.id}`;
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

        if (onSendNotification && (!lastAnnouncedAdjustmentsRef.current[adjKey] || Date.now() - lastAnnouncedAdjustmentsRef.current[adjKey] > 30000)) {
          lastAnnouncedAdjustmentsRef.current[adjKey] = Date.now();
          onSendNotification(headline, detail, 'TRADE');
        }
      }
      // STAGE 2: +2.0R to < +3.0R (Lock in True Profit)
      else if (currentR >= 2.0 && currentR < 3.0 && !pos.stage2Executed) {
        // Move stop to +0.5R in profit
        const profitStop = isLong 
          ? entry + (stopDistance * 0.5) 
          : entry - (stopDistance * 0.5);

        const adjKey = `stage2-${pos.id}`;
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

        if (onSendNotification && (!lastAnnouncedAdjustmentsRef.current[adjKey] || Date.now() - lastAnnouncedAdjustmentsRef.current[adjKey] > 30000)) {
          lastAnnouncedAdjustmentsRef.current[adjKey] = Date.now();
          onSendNotification(headline, detail, 'TRADE');
        }
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
          const adjKey = `stage3-${pos.id}`;
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
            recommendedScalePct: 0, // trail remaining 40% runner
            currentMarkPrice: current,
            entryPrice: entry,
            unrealizedPnlPct: uPnlPct,
            rMultiple: currentR,
            reason: detail,
            headline,
            detail,
            timestamp: Date.now(),
          };

          if (onSendNotification && (!lastAnnouncedAdjustmentsRef.current[adjKey] || Date.now() - lastAnnouncedAdjustmentsRef.current[adjKey] > 30000)) {
            lastAnnouncedAdjustmentsRef.current[adjKey] = Date.now();
            onSendNotification(headline, detail, 'TRADE');
          }
        }
      }
    });

    setPositionAdjustments(newAdjustments);
  }, [positions, markPrice, onSendNotification]);

  const activeAdjustmentsList = useMemo(() => Object.values(positionAdjustments), [positionAdjustments]);

  // Apply adjustment to position
  const applyAdjustmentToPosition = useCallback(
    (posId: string) => {
      const adj = positionAdjustments[posId];
      if (!adj) return;

      if (onUpdatePositionSL && adj.recommendedStopLoss) {
        onUpdatePositionSL(posId, adj.recommendedStopLoss);
      }
      if (onScalePosition && adj.recommendedScalePct > 0) {
        onScalePosition(posId, adj.recommendedScalePct);
      }
      if (onSendNotification) {
        onSendNotification(
          adj.headline || 'Risk Engine Adjustment',
          `Executed: ${adj.reason}`,
          'TRADE'
        );
      }
    },
    [positionAdjustments, onUpdatePositionSL, onScalePosition, onSendNotification]
  );

  // ═════════════════════════════════════════════════════════════════════════════
  // 3. EXECUTION PAD AUTO-SYNC STATE
  // ═════════════════════════════════════════════════════════════════════════════
  const [cuedAdjustment, setCuedAdjustment] = useState<CuedAdjustment | null>(null);

  const cueAdjustmentForExecutionPad = useCallback((adj: CuedAdjustment) => {
    setCuedAdjustment(adj);
  }, []);

  const clearCuedAdjustment = useCallback(() => {
    setCuedAdjustment(null);
  }, []);

  const value = useMemo<RiskAdjustmentContextType>(
    () => ({
      initialRiskCapPct: INITIAL_RISK_CAP_PCT,
      dailyDrawdownLimitPct: DAILY_DRAWDOWN_LIMIT_PCT,
      maxConsecutiveStopouts: MAX_CONSECUTIVE_STOPOUTS,
      minRewardRiskRatio: MIN_REWARD_RISK_RATIO,
      maxCprChopWidthPct: MAX_CPR_CHOP_WIDTH_PCT,

      accountBalance: effectiveBalance,
      maxDollarRiskPerTrade,
      dailyRealizedLossUsd,
      dailyLossPct,
      consecutiveStopouts,
      isCircuitBreakerTripped,
      circuitBreakerReason,
      resetCircuitBreaker,

      evaluateSignalRisk,

      positionAdjustments,
      activeAdjustmentsList,
      applyAdjustmentToPosition,

      cuedAdjustment,
      cueAdjustmentForExecutionPad,
      clearCuedAdjustment,
    }),
    [
      effectiveBalance,
      maxDollarRiskPerTrade,
      dailyRealizedLossUsd,
      dailyLossPct,
      consecutiveStopouts,
      isCircuitBreakerTripped,
      circuitBreakerReason,
      resetCircuitBreaker,
      evaluateSignalRisk,
      positionAdjustments,
      activeAdjustmentsList,
      applyAdjustmentToPosition,
      cuedAdjustment,
      cueAdjustmentForExecutionPad,
      clearCuedAdjustment,
    ]
  );

  return <RiskAdjustmentContext.Provider value={value}>{children}</RiskAdjustmentContext.Provider>;
};

export const useRiskAdjustment = (): RiskAdjustmentContextType => {
  const context = useContext(RiskAdjustmentContext);
  if (!context) {
    return {
      initialRiskCapPct: 0.50,
      dailyDrawdownLimitPct: 1.50,
      maxConsecutiveStopouts: 2,
      minRewardRiskRatio: 1.50,
      maxCprChopWidthPct: 0.35,
      accountBalance: 1000,
      maxDollarRiskPerTrade: 5.0,
      dailyRealizedLossUsd: 0,
      dailyLossPct: 0,
      consecutiveStopouts: 0,
      isCircuitBreakerTripped: false,
      circuitBreakerReason: null,
      resetCircuitBreaker: () => {},
      evaluateSignalRisk: () => ({
        approved: true,
        allowedLotSize: 0.05,
        maxDollarRisk: 5.0,
        riskRewardRatio: 2.5,
        invalidationDistance: 100,
        riskPct: 0.50,
      }),
      positionAdjustments: {},
      activeAdjustmentsList: [],
      applyAdjustmentToPosition: () => {},
      cuedAdjustment: null,
      cueAdjustmentForExecutionPad: () => {},
      clearCuedAdjustment: () => {},
    };
  }
  return context;
};