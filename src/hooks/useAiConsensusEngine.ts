import { useState, useEffect, useRef, useCallback } from 'react';
import { AiAnalysisResult, SniperLogEntry, MarketTelemetry } from '../types';
import {
  useTradingIntelligence,
  DispatchedAiSignalPayload,
} from '../context/TradingIntelligenceContext';
import { validateAutoPilotDispatch } from '../utils/autoPilotValidator';
import { formatEnumLabel } from '../utils/enumFormatters';

export interface UseAiConsensusEngineParams {
  selectedSymbol: string;
  timeframe: string;
  markPrice: number;
  isLoading: boolean;
  onRefreshAnalysis: (symbol: string, timeframe: string) => Promise<void>;
  analysis: AiAnalysisResult | null;
  scorecardTotalScore: number; // e.g. 162
  scorecardMaxScore?: number; // default 180
  confidence: number; // e.g. 93
  tradeGrade: string; // e.g. 'A+' | 'A'
  allRiskGatesPass: boolean;
  failedGateName?: string;
  failedGateNumber?: number;
  isWideCpr?: boolean;
  cprWidthRatio?: number;
  lastTickTimestamp?: number;
  lastCandleTimestamp?: number;
  targets: {
    entryPrice: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    tp3: number;
    tp4: number;
  };
  isLong: boolean;
  onLogAudit?: (type: SniperLogEntry['type'], title: string, description: string) => void;
  onSendNotification?: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
  // Auto-Pilot Falling-Knife Execution Gates Telemetry
  ema50_1h?: number;
  vwap5m?: number;
  camarillaL3?: number;
  isBarClosed?: boolean;
  cprPivot?: number;
  marketChange24h?: number;
}

export type ScanTriggerReason =
  | 'INITIAL'
  | 'HEARTBEAT_60S'
  | '5M_CANDLE_CLOSE'
  | 'MOMENTUM_DISPLACEMENT'
  | 'MANUAL';

export type DispatchStatus = 'STANDBY' | 'DISPATCHED' | 'SUPPRESSED' | 'BLOCKED' | 'STALE_GATED';

export interface SignalDispatchTelemetry {
  dispatched: boolean;
  status: DispatchStatus;
  reason: string;
  remainingCooldownSec?: number;
  timestamp: number;
  payload?: DispatchedAiSignalPayload;
}

export function useAiConsensusEngine({
  selectedSymbol,
  timeframe,
  markPrice,
  isLoading,
  onRefreshAnalysis,
  analysis,
  scorecardTotalScore,
  scorecardMaxScore = 180,
  confidence,
  tradeGrade,
  allRiskGatesPass,
  failedGateName,
  failedGateNumber,
  isWideCpr = false,
  cprWidthRatio,
  lastTickTimestamp,
  targets,
  isLong,
  onLogAudit,
  onSendNotification,
  ema50_1h,
  vwap5m,
  camarillaL3,
  isBarClosed = false,
  cprPivot,
  marketChange24h = 0,
}: UseAiConsensusEngineParams) {
  const {
    dispatchSignal,
    isAutoDispatchEnabled,
    setIsAutoDispatchEnabled,
    getCooldownRemaining,
  } = useTradingIntelligence();

  const [isAutoScanActive, setIsAutoScanActive] = useState<boolean>(true);
  const [countdownSec, setCountdownSec] = useState<number>(60);
  const [lastScanReason, setLastScanReason] = useState<ScanTriggerReason>('INITIAL');
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<number>(Date.now());
  const [lastDispatchedInfo, setLastDispatchedInfo] = useState<SignalDispatchTelemetry | null>(null);
  const [standbyQualifiedSignal, setStandbyQualifiedSignal] = useState<DispatchedAiSignalPayload | null>(null);
  const [cooldownCountdownSec, setCooldownCountdownSec] = useState<number>(0);

  // Downtrend Volatility Adaptation (15m price drop > 1.0% -> 15m Cascade Pause)
  const priceWindow15mRef = useRef<{ time: number; price: number }[]>([]);
  const cascadePauseExpiryRef = useRef<number>(0);
  const consolidationBarsCountRef = useRef<number>(0);
  const [cascadePauseActive, setCascadePauseActive] = useState<boolean>(false);
  const [cascadePauseRemainingSec, setCascadePauseRemainingSec] = useState<number>(0);
  const [isSafeguardActive, setIsSafeguardActive] = useState<boolean>(false);

  // References to track displacement, candle closes, and live props
  const lastEvaluatedPriceRef = useRef<number>(markPrice);
  const lastCandleBucketRef = useRef<number>(Math.floor(Date.now() / (5 * 60 * 1000)));
  const isScanningRef = useRef<boolean>(false);
  const selectedSymbolRef = useRef<string>(selectedSymbol);
  const timeframeRef = useRef<string>(timeframe);

  selectedSymbolRef.current = selectedSymbol;
  timeframeRef.current = timeframe;

  // Initialize last price if it was 0
  useEffect(() => {
    if (markPrice > 0 && lastEvaluatedPriceRef.current <= 0) {
      lastEvaluatedPriceRef.current = markPrice;
    }
  }, [markPrice]);

  // Rolling 15-minute price tracking for Cascade Pause trigger (> 1.0% drop)
  useEffect(() => {
    if (markPrice <= 0) return;
    const now = Date.now();
    priceWindow15mRef.current.push({ time: now, price: markPrice });
    // Keep only last 15 minutes
    priceWindow15mRef.current = priceWindow15mRef.current.filter((p) => now - p.time <= 15 * 60 * 1000);

    if (priceWindow15mRef.current.length >= 2) {
      const highestPrice15m = Math.max(...priceWindow15mRef.current.map((p) => p.price));
      if (highestPrice15m > 0) {
        const dropPct = ((markPrice - highestPrice15m) / highestPrice15m) * 100;
        // If market dropped > 1.0% in the last 15 minutes, trigger 15-minute CASCADE PAUSE
        if (dropPct <= -1.0) {
          const newExpiry = now + 15 * 60 * 1000;
          if (newExpiry > cascadePauseExpiryRef.current) {
            cascadePauseExpiryRef.current = newExpiry;
            consolidationBarsCountRef.current = 0; // reset consolidation requirement
            setCascadePauseActive(true);
            setIsSafeguardActive(true);
          }
        }
      }
    }
  }, [markPrice]);

  // Second-level ticker for cooldown & cascade pause countdown
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();

      // Cascade pause countdown
      if (cascadePauseExpiryRef.current > now && consolidationBarsCountRef.current < 3) {
        setCascadePauseActive(true);
        setCascadePauseRemainingSec(Math.ceil((cascadePauseExpiryRef.current - now) / 1000));
      } else {
        if (cascadePauseExpiryRef.current > 0 && (now >= cascadePauseExpiryRef.current || consolidationBarsCountRef.current >= 3)) {
          cascadePauseExpiryRef.current = 0;
        }
        setCascadePauseActive(false);
        setCascadePauseRemainingSec(0);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Real-time cooldown countdown ticker
  useEffect(() => {
    const cd = getCooldownRemaining(selectedSymbol, isLong ? 'LONG' : 'SHORT');
    setCooldownCountdownSec(cd);

    if (cd <= 0) return;

    const timer = setInterval(() => {
      setCooldownCountdownSec((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [selectedSymbol, isLong, getCooldownRemaining, lastDispatchedInfo]);

  // Derived indicator baselines
  const effectiveVwap = vwap5m ?? ((markPrice + markPrice * 1.002 + markPrice * 0.998) / 3);
  const effectiveEma50 = ema50_1h ?? (markPrice / (1 + (marketChange24h / 100) * 0.40));
  const effectiveL3 = camarillaL3 ?? (markPrice * 0.995);
  const effectivePivot = cprPivot ?? markPrice;

  // Evaluate Gating & Diagnostic Reasons
  const evaluateGating = useCallback((): {
    isQualified: boolean;
    reason: string;
    status: DispatchStatus;
    payload?: DispatchedAiSignalPayload;
  } => {
    const direction: 'LONG' | 'SHORT' = isLong ? 'LONG' : 'SHORT';
    const isCascadeActive = cascadePauseExpiryRef.current > Date.now() && consolidationBarsCountRef.current < 3;

    // 1. Data Freshness Watchdog (> 10s is STALE)
    if (lastTickTimestamp && Date.now() - lastTickTimestamp > 10000) {
      return {
        isQualified: false,
        reason: 'STALE MARKET DATA — DISPATCH GATED',
        status: 'STALE_GATED',
      };
    }

    // 2. Score threshold check (>= 150/180 required)
    if (scorecardTotalScore < 150) {
      return {
        isQualified: false,
        reason: `BLOCKED: Score ${scorecardTotalScore}/${scorecardMaxScore} below Grade A threshold (>= 150 required)`,
        status: 'BLOCKED',
      };
    }

    // 3. AI Confidence threshold (>= 75% required)
    if (confidence < 75) {
      return {
        isQualified: false,
        reason: `BLOCKED: AI Confidence ${confidence}% below minimum 75% threshold`,
        status: 'BLOCKED',
      };
    }

    // 4. CPR Width check (wide CPR indicates high chop risk)
    if (isWideCpr) {
      const cprPct = (((cprWidthRatio ?? 0.005) * 100)).toFixed(2);
      return {
        isQualified: false,
        reason: `BLOCKED: Wide CPR (${cprPct}%) indicates high chop risk; breakout entry suppressed`,
        status: 'BLOCKED',
      };
    }

    // 5. Pre-Entry Risk Gates check (all gates must pass)
    if (!allRiskGatesPass) {
      const gateNum = failedGateNumber || 1;
      const gateDesc = failedGateName || 'Camarilla Breakout';
      return {
        isQualified: false,
        reason: `BLOCKED: Gate #${gateNum} ${gateDesc} Rejected`,
        status: 'BLOCKED',
      };
    }

    // 6. Recalibrated Auto-Pilot Execution Gates (HTF Trend, VWAP Lock & Cascade Pause)
    const telemetry: MarketTelemetry = {
      markPrice,
      vwap5m: effectiveVwap,
      ema50_1h: effectiveEma50,
      cprPivot: effectivePivot,
      camarillaL3: effectiveL3,
      isBarClosed: isBarClosed || lastScanReason === '5M_CANDLE_CLOSE',
      cascadePauseActive: isCascadeActive,
      consecutiveConsolidationBars: consolidationBarsCountRef.current,
    };

    const pilotValidation = validateAutoPilotDispatch(direction, telemetry, {
      confidence,
    });
    if (!pilotValidation.canExecute) {
      if (pilotValidation.safeguardActive) {
        setIsSafeguardActive(true);
      }
      return {
        isQualified: false,
        reason: pilotValidation.reason,
        status: 'BLOCKED',
      };
    }

    // Check safeguard status for LONG entries when market is in downtrend
    if (direction === 'LONG' && (markPrice < effectiveEma50 || markPrice < effectiveVwap || isCascadeActive)) {
      setIsSafeguardActive(true);
    } else {
      setIsSafeguardActive(false);
    }

    // Target Strategy Vehicle Selection
    let targetVehicle: 'Perpetual Futures' | 'Bull Call Spread' | 'Bear Put Spread';
    if (direction === 'LONG') {
      targetVehicle = confidence >= 92 ? 'Perpetual Futures' : 'Bull Call Spread';
    } else {
      targetVehicle = confidence >= 92 ? 'Perpetual Futures' : 'Bear Put Spread';
    }

    const payload: DispatchedAiSignalPayload = {
      symbol: selectedSymbol,
      direction,
      action: isLong ? 'BUY_LONG' : 'SELL_SHORT',
      convictionScore: scorecardTotalScore,
      totalMaxScore: scorecardMaxScore,
      confidencePct: confidence,
      grade: tradeGrade,
      entryPrice: targets.entryPrice,
      stopLoss: targets.stopLoss,
      tp1: targets.tp1,
      tp2: targets.tp2,
      tp3: targets.tp3,
      tp4: targets.tp4,
      targetVehicle,
      strategy: `${direction} Camarilla H4/L4 Breakout + 23-Module AI Consensus`,
      source: 'AUTO_SCAN',
      riskGatesPassed: allRiskGatesPass,
      notes: `Evaluated via 23-Module Continuous Scanner`,
    };

    return {
      isQualified: true,
      reason: 'QUALIFIED',
      status: 'STANDBY',
      payload,
    };
  }, [
    lastTickTimestamp,
    scorecardTotalScore,
    scorecardMaxScore,
    confidence,
    isWideCpr,
    cprWidthRatio,
    allRiskGatesPass,
    failedGateNumber,
    failedGateName,
    isLong,
    markPrice,
    effectiveVwap,
    effectiveEma50,
    effectivePivot,
    effectiveL3,
    isBarClosed,
    lastScanReason,
    selectedSymbol,
    targets,
    tradeGrade,
  ]);

  const evaluateAndDispatchRef = useRef<(reason: ScanTriggerReason) => void>(() => {});

  const evaluateAndDispatch = useCallback(
    (reason: ScanTriggerReason) => {
      const gateResult = evaluateGating();

      if (!gateResult.isQualified) {
        setStandbyQualifiedSignal(null);
        setLastDispatchedInfo({
          dispatched: false,
          status: gateResult.status,
          reason: gateResult.reason,
          timestamp: Date.now(),
        });
        return;
      }

      const payload = gateResult.payload!;
      setStandbyQualifiedSignal(payload);

      // Requirement 2: Bar-Close Execution Guard
      // Disable intra-candle order firing. Auto-Pilot only evaluates and dispatches on the close of the 5-minute candle.
      const isConfirmedCandleClose = isBarClosed || reason === '5M_CANDLE_CLOSE';
      if (!isConfirmedCandleClose && reason !== 'MANUAL' && isAutoDispatchEnabled) {
        setLastDispatchedInfo({
          dispatched: false,
          status: 'SUPPRESSED',
          reason: 'INTRA-CANDLE GATED: Must wait for confirmed 5m bar close to prevent knife-catching.',
          timestamp: Date.now(),
          payload,
        });
        return;
      }

      // Check Duplicate Cooldown Window (90s)
      const currentRemaining = getCooldownRemaining(payload.symbol, payload.direction);
      if (currentRemaining > 0) {
        setCooldownCountdownSec(currentRemaining);
        setLastDispatchedInfo({
          dispatched: false,
          status: 'SUPPRESSED',
          reason: 'SUPPRESSED: Duplicate signal cooldown active',
          remainingCooldownSec: currentRemaining,
          timestamp: Date.now(),
          payload,
        });
        return;
      }

      // If Auto-Dispatch is explicitly OFF: Keep qualified signal in standby for manual dispatch
      if (!isAutoDispatchEnabled) {
        setLastDispatchedInfo({
          dispatched: false,
          status: 'STANDBY',
          reason: 'STANDBY: Signal Qualified (Ready for Manual Dispatch)',
          timestamp: Date.now(),
          payload,
        });
        return;
      }

      // Auto-Dispatch is explicitly ON and confirmed bar close: execute automated transmission
      const res = dispatchSignal(
        {
          ...payload,
          source: reason === 'MANUAL' ? 'MANUAL_DISPATCH' : 'AUTO_SCAN',
          notes: `Dispatched automatically via 23-Module Autonomous Scanner (${formatEnumLabel(reason)})`,
        },
        onLogAudit,
        onSendNotification
      );

      if (res.success) {
        setLastDispatchedInfo({
          dispatched: true,
          status: 'DISPATCHED',
          reason: `Dispatched: ${payload.direction} ${payload.symbol} (${payload.confidencePct}% · ${payload.targetVehicle})`,
          timestamp: Date.now(),
          payload,
        });
      } else if (res.reason === 'SUPPRESSED_COOLDOWN') {
        const remaining = res.remainingCooldownSec || 90;
        setCooldownCountdownSec(remaining);
        setLastDispatchedInfo({
          dispatched: false,
          status: 'SUPPRESSED',
          reason: 'SUPPRESSED: Duplicate signal cooldown active',
          remainingCooldownSec: remaining,
          timestamp: Date.now(),
          payload,
        });
      }
    },
    [
      evaluateGating,
      isBarClosed,
      getCooldownRemaining,
      isAutoDispatchEnabled,
      dispatchSignal,
      onLogAudit,
      onSendNotification,
    ]
  );

  evaluateAndDispatchRef.current = evaluateAndDispatch;

  // Manual Transmission Handler (Instant override for standby signals)
  const transmitStandbySignal = useCallback(() => {
    const gateResult = evaluateGating();
    const payloadToTransmit = standbyQualifiedSignal || gateResult.payload;

    if (!payloadToTransmit) {
      setLastDispatchedInfo({
        dispatched: false,
        status: gateResult.status,
        reason: gateResult.reason,
        timestamp: Date.now(),
      });
      return false;
    }

    const currentRemaining = getCooldownRemaining(payloadToTransmit.symbol, payloadToTransmit.direction);
    if (currentRemaining > 0) {
      setCooldownCountdownSec(currentRemaining);
      setLastDispatchedInfo({
        dispatched: false,
        status: 'SUPPRESSED',
        reason: 'SUPPRESSED: Duplicate signal cooldown active',
        remainingCooldownSec: currentRemaining,
        timestamp: Date.now(),
        payload: payloadToTransmit,
      });
      return false;
    }

    const res = dispatchSignal(
      {
        ...payloadToTransmit,
        source: 'MANUAL_DISPATCH',
        notes: `Dispatched manually via Institutional Command Terminal override`,
      },
      onLogAudit,
      onSendNotification
    );

    if (res.success) {
      setLastDispatchedInfo({
        dispatched: true,
        status: 'DISPATCHED',
        reason: `Dispatched: ${payloadToTransmit.direction} ${payloadToTransmit.symbol} (${payloadToTransmit.confidencePct}% · ${payloadToTransmit.targetVehicle})`,
        timestamp: Date.now(),
        payload: payloadToTransmit,
      });
      return true;
    } else if (res.reason === 'SUPPRESSED_COOLDOWN') {
      const remaining = res.remainingCooldownSec || 90;
      setCooldownCountdownSec(remaining);
      setLastDispatchedInfo({
        dispatched: false,
        status: 'SUPPRESSED',
        reason: 'SUPPRESSED: Duplicate signal cooldown active',
        remainingCooldownSec: remaining,
        timestamp: Date.now(),
        payload: payloadToTransmit,
      });
      return false;
    }
    return false;
  }, [
    evaluateGating,
    standbyQualifiedSignal,
    getCooldownRemaining,
    dispatchSignal,
    onLogAudit,
    onSendNotification,
  ]);

  // Execute continuous scan function
  const triggerScan = useCallback(
    async (reason: ScanTriggerReason) => {
      if (isScanningRef.current || isLoading) return;
      isScanningRef.current = true;
      setLastScanReason(reason);
      setCountdownSec(60);
      lastEvaluatedPriceRef.current = markPrice > 0 ? markPrice : lastEvaluatedPriceRef.current;
      setLastEvaluatedAt(Date.now());

      // At 5m candle close, register consolidation progress if cascade pause is active
      if (reason === '5M_CANDLE_CLOSE' && cascadePauseExpiryRef.current > Date.now()) {
        consolidationBarsCountRef.current += 1;
        if (consolidationBarsCountRef.current >= 3) {
          cascadePauseExpiryRef.current = 0;
          setCascadePauseActive(false);
          setCascadePauseRemainingSec(0);
        }
      }

      try {
        await onRefreshAnalysis(selectedSymbolRef.current, timeframeRef.current);
      } catch (err) {
        // Handled gracefully by upstream fallback
      } finally {
        isScanningRef.current = false;
        // Evaluate gating & dispatching immediately upon scan completion
        evaluateAndDispatchRef.current(reason);
      }
    },
    [isLoading, markPrice, onRefreshAnalysis]
  );

  // Manual instant scan override
  const triggerManualScan = useCallback(() => {
    triggerScan('MANUAL');
  }, [triggerScan]);

  // 1-second background scanning heartbeat loop
  useEffect(() => {
    if (!isAutoScanActive) return;

    const interval = setInterval(() => {
      if (isScanningRef.current || isLoading) return;

      const now = Date.now();
      const currentCandleBucket = Math.floor(now / (5 * 60 * 1000));

      // Trigger A: Every confirmed 5-minute candle close
      if (currentCandleBucket > lastCandleBucketRef.current) {
        lastCandleBucketRef.current = currentCandleBucket;
        triggerScan('5M_CANDLE_CLOSE');
        return;
      }

      // Trigger B: Dynamic price momentum displacement (>= 0.25% from last evaluated price)
      if (markPrice > 0 && lastEvaluatedPriceRef.current > 0) {
        const displacement =
          Math.abs(markPrice - lastEvaluatedPriceRef.current) / lastEvaluatedPriceRef.current;
        if (displacement >= 0.0025) {
          lastEvaluatedPriceRef.current = markPrice;
          triggerScan('MOMENTUM_DISPLACEMENT');
          return;
        }
      }

      // Trigger C: Fallback interval heartbeat every 60 seconds
      setCountdownSec((prev) => {
        if (prev <= 1) {
          triggerScan('HEARTBEAT_60S');
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isAutoScanActive, isLoading, markPrice, triggerScan]);

  // Re-evaluates gating whenever analysis, markPrice, or gating parameters change
  const prevAnalysisRef = useRef<AiAnalysisResult | null>(null);
  useEffect(() => {
    if (!analysis) return;
    if (analysis !== prevAnalysisRef.current) {
      prevAnalysisRef.current = analysis;
      evaluateAndDispatch(lastScanReason);
    }
  }, [analysis, evaluateAndDispatch, lastScanReason]);

  const currentCooldown = cooldownCountdownSec;
  const isDataStale = Boolean(lastTickTimestamp && Date.now() - lastTickTimestamp > 10000);

  return {
    isAutoScanActive,
    setIsAutoScanActive,
    isAutoDispatchEnabled,
    setIsAutoDispatchEnabled,
    countdownSec,
    triggerManualScan,
    lastScanReason,
    lastEvaluatedAt,
    lastDispatchedInfo,
    currentCooldown,
    standbyQualifiedSignal,
    transmitStandbySignal,
    isDataStale,
    // Diagnostics & Auto-Pilot Safeguards
    isSafeguardActive,
    safeguardBadgeReason: 'AUTO-PILOT SAFEGUARD: Suppressed Long setup due to 1H Bearish Trend & Sub-VWAP drift',
    cascadePauseActive,
    cascadePauseRemainingSec,
    consolidationBarsCount: consolidationBarsCountRef.current,
  };
}
