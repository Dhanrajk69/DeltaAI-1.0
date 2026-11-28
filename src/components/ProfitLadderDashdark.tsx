import React, { useMemo, useId, useState, useEffect, useRef } from 'react';
import { Compass, ArrowDown, ArrowUp, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  computeContinuousProfitPalette,
  computeSequentialLadderSteps,
  ContinuousProfitPalette,
  SequentialRungState,
} from '../utils/optionsProfitLadder';

type LadderPnlState = 'POSITIVE' | 'NEGATIVE' | 'FLAT';

export type SentimentStage = 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';

export interface SentimentConfig {
  stage: SentimentStage;
  label: string;
  color: string;
  accent: string;
  gradient: [string, string, string];
  glow: string;
}

export const SENTIMENT_STAGES: Record<SentimentStage, SentimentConfig> = {
  STRONG_BULLISH: {
    stage: 'STRONG_BULLISH',
    label: 'STR BULL',
    color: '#065f46', // Dark Green
    accent: '#34d399',
    gradient: ['#34d399', '#10b981', '#065f46'],
    glow: 'rgba(6, 95, 70, 0.45)',
  },
  BULLISH: {
    stage: 'BULLISH',
    label: 'BULLISH',
    color: '#10b981', // Green
    accent: '#10b981',
    gradient: ['#6ee7b7', '#10b981', '#059669'],
    glow: 'rgba(16, 185, 129, 0.35)',
  },
  NEUTRAL: {
    stage: 'NEUTRAL',
    label: 'NEUTRAL',
    color: '#eab308', // Yellow
    accent: '#facc15',
    gradient: ['#fef08a', '#eab308', '#ca8a04'],
    glow: 'rgba(234, 179, 8, 0.3)',
  },
  BEARISH: {
    stage: 'BEARISH',
    label: 'BEARISH',
    color: '#f97316', // Orange
    accent: '#fb923c',
    gradient: ['#fdba74', '#f97316', '#ea580c'],
    glow: 'rgba(249, 115, 22, 0.35)',
  },
  STRONG_BEARISH: {
    stage: 'STRONG_BEARISH',
    label: 'STR BEAR',
    color: '#ef4444', // Red
    accent: '#f87171',
    gradient: ['#fca5a5', '#ef4444', '#b91c1c'],
    glow: 'rgba(239, 68, 68, 0.45)',
  },
};

export interface CircularProgressProps {
  progress: number;
  displayLabel?: string;
  sentimentLabel?: string;
  sentimentColor?: string;
  sentimentAccent?: string;
  sentimentGradient?: [string, string, string];
  isReversing?: boolean;
  palette: ContinuousProfitPalette;
  isHit: boolean;
  isActive: boolean;
  isDormant?: boolean;
  isHeader?: boolean;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  progress,
  displayLabel,
  sentimentLabel,
  sentimentColor,
  sentimentAccent,
  sentimentGradient,
  isReversing = false,
  palette,
  isHit,
  isActive,
  isDormant = false,
  isHeader = false,
}) => {
  const uid = useId().replace(/:/g, '');
  const dynGradId = `ladder-dyn-${uid}`;

  const radius = isHeader ? 20 : 17;
  const size = isHeader ? 50 : 44;
  const center = size / 2;
  const strokeWidth = isHeader ? 4.5 : 4;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, progress));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  const showStroke = clamped >= 0;
  const label = displayLabel ?? `${Math.round(clamped)}%`;

  const gradStops = sentimentGradient || (isReversing
    ? ['#fda4af', '#f43f5e', '#be123c']
    : [
        palette?.ringStart || '#38bdf8',
        palette?.ringMid || '#14b8a6',
        palette?.ringEnd || '#10b981',
      ]);

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 ${
        isHeader ? 'w-13 h-13' : 'w-10 h-10'
      }`}
      title={
        isHeader
          ? `Profit Ladder Meter: ${label} · Sentiment: ${sentimentLabel || 'NEUTRAL'} (${
              isReversing ? 'Anti-clockwise Reversal' : 'Clockwise toward TP'
            })`
          : undefined
      }
    >
      <svg
        className={`${
          isHeader ? 'w-13 h-13' : 'w-10 h-10'
        } origin-center transform overflow-visible transition-transform duration-500 ${
          isReversing ? 'scale-x-[-1] -rotate-90' : '-rotate-90'
        }`}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          transformOrigin: 'center',
          filter: isReversing
            ? 'drop-shadow(0 0 7px rgba(244, 63, 94, 0.55))'
            : sentimentColor
            ? `drop-shadow(0 0 7px ${sentimentColor}66)`
            : 'drop-shadow(0 0 8px rgba(56, 189, 248, 0.35))',
        }}
      >
        <defs>
          <linearGradient id={dynGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradStops[0]} />
            <stop offset="50%" stopColor={gradStops[1]} />
            <stop offset="100%" stopColor={gradStops[2]} />
          </linearGradient>
        </defs>
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {showStroke && (
          <motion.circle
            cx={center}
            cy={center}
            r={radius}
            stroke={`url(#${dynGradId})`}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
      {isHeader && sentimentLabel ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none leading-none">
          <span
            className="text-[9.5px] font-extrabold font-mono tabular-nums tracking-tight transition-colors duration-300"
            style={{ color: sentimentAccent || (isReversing ? '#fb7185' : '#e0f2fe') }}
          >
            {label}
          </span>
          <span
            className="text-[6.5px] font-black uppercase tracking-wider mt-0.5 leading-none"
            style={{ color: sentimentColor || (isReversing ? '#f43f5e' : '#38bdf8') }}
          >
            {sentimentLabel}
          </span>
        </div>
      ) : (
        <span
          className={`absolute text-[9.5px] font-extrabold font-mono tabular-nums tracking-tight transition-colors duration-300 ${
            isReversing ? 'text-rose-400' : isHit ? 'text-emerald-300' : 'text-cyan-200'
          }`}
          style={sentimentAccent ? { color: sentimentAccent } : undefined}
        >
          {label}
        </span>
      )}
    </div>
  );
};

export interface ProfitLadderDashdarkProps {
  isShort: boolean;
  entryPrice?: number;
  markPrice?: number;
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tp4?: number;
  unrealizedPnl?: number;
  activeTrade?: any;
  activeTargetIndex?: 1 | 2 | 3 | 4;
  isMicro15?: boolean;
  lotSize?: number;
  symbol?: string;
  liveUsdInrRate?: number;
  currencyPrefix?: string;
  netBreakevenPrice?: number;
  totalFrictionUsd?: number;
  sniperStrategyMode?: 'UNIFIED_MTF_PULLBACK' | 'EMA_9_21_MOMENTUM_5M';
  className?: string;
}

export const ProfitLadderDashdark: React.FC<ProfitLadderDashdarkProps> = React.memo(({
  isShort,
  entryPrice = 76670,
  markPrice = 76568.64,
  stopLoss,
  tp1,
  tp2,
  tp3,
  tp4,
  unrealizedPnl,
  activeTrade,
  activeTargetIndex,
  isMicro15 = true,
  lotSize = 0.15,
  symbol = 'BTCUSDT',
  liveUsdInrRate = 85.04,
  currencyPrefix = '$',
  sniperStrategyMode,
  className = '',
}) => {
  const isEma921Ladder = (activeTrade?.sniperStrategyMode || sniperStrategyMode) === 'EMA_9_21_MOMENTUM_5M';
  const effectiveEntry =
    activeTrade?.entryPrice > 0
      ? Number(activeTrade.entryPrice)
      : entryPrice > 0
      ? entryPrice
      : markPrice;

  const isTradeActive = Boolean(
    activeTrade &&
      activeTrade.tradeStatus !== 'CLOSED' &&
      activeTrade.tradeStatus !== 'STOPPED_OUT' &&
      activeTrade.tradeStatus !== 'COMPLETED'
  );

  const effectiveLotSize =
    activeTrade?.lotSize > 0 ? Number(activeTrade.lotSize) : lotSize > 0 ? lotSize : 0.15;
  const baseSymbol = (activeTrade?.symbol || symbol || 'BTCUSDT')
    .replace('USDT', '')
    .replace('USD', '');

  const rate = liveUsdInrRate > 0 ? liveUsdInrRate : 85.04;

  const resolvedStopLoss = useMemo(() => {
    const candidate = Number(
      stopLoss || activeTrade?.currentStopLoss || activeTrade?.initialStopLoss || 0
    );
    if (candidate > 0) return candidate;
    const minDist = effectiveEntry * 0.0028;
    return isShort ? effectiveEntry + minDist : effectiveEntry - minDist;
  }, [stopLoss, activeTrade?.currentStopLoss, activeTrade?.initialStopLoss, effectiveEntry, isShort]);

  const offsets = useMemo(() => {
    const slDist = Math.max(Math.abs(effectiveEntry - resolvedStopLoss), effectiveEntry * 0.0028);
    return {
      step1: slDist * 1.25,
      step2: slDist * 2.0,
      step3: slDist * 2.75,
      step4: slDist * 3.5,
    };
  }, [effectiveEntry, resolvedStopLoss]);

  const resolvedTp1 =
    tp1 && tp1 > 0 ? tp1 : isShort ? effectiveEntry - offsets.step1 : effectiveEntry + offsets.step1;
  const resolvedTp2 =
    tp2 && tp2 > 0 ? tp2 : isShort ? effectiveEntry - offsets.step2 : effectiveEntry + offsets.step2;
  const resolvedTp3 =
    tp3 && tp3 > 0 ? tp3 : isShort ? effectiveEntry - offsets.step3 : effectiveEntry + offsets.step3;
  const resolvedTp4 =
    tp4 && tp4 > 0 ? tp4 : isShort ? effectiveEntry - offsets.step4 : effectiveEntry + offsets.step4;

  const resolvedActiveTargetIndex: 1 | 2 | 3 | 4 = useMemo(() => {
    if (activeTrade?.tp3Hit) return 4;
    if (activeTrade?.tp2Hit) return 3;
    if (activeTrade?.tp1Hit) return 2;
    return activeTargetIndex || 1;
  }, [activeTrade?.tp1Hit, activeTrade?.tp2Hit, activeTrade?.tp3Hit, activeTargetIndex]);

  // Live Unrealized PnL (USD + INR)
  const liveUnrealizedUsd = useMemo(() => {
    if (!isTradeActive) return 0;
    if (typeof unrealizedPnl === 'number' && Number.isFinite(unrealizedPnl)) {
      return unrealizedPnl;
    }
    const tradeUpnl =
      typeof activeTrade?.unrealizedPnlUsd === 'number' && Number.isFinite(activeTrade.unrealizedPnlUsd)
        ? activeTrade.unrealizedPnlUsd
        : typeof activeTrade?.unrealisedProfitUsd === 'number' && Number.isFinite(activeTrade.unrealisedProfitUsd)
        ? activeTrade.unrealisedProfitUsd
        : null;
    if (tradeUpnl !== null) return tradeUpnl;
    if (effectiveEntry > 0 && markPrice > 0 && effectiveLotSize > 0) {
      const diff = isShort ? effectiveEntry - markPrice : markPrice - effectiveEntry;
      return +(diff * effectiveLotSize).toFixed(2);
    }
    return 0;
  }, [
    isTradeActive,
    unrealizedPnl,
    activeTrade?.unrealizedPnlUsd,
    activeTrade?.unrealisedProfitUsd,
    effectiveEntry,
    markPrice,
    effectiveLotSize,
    isShort,
  ]);

  const liveUnrealizedInr = +(liveUnrealizedUsd * rate).toFixed(2);

  const formatSignedUsd = (val: number) => {
    if (!Number.isFinite(val) || Math.abs(val) < 0.005) return `${currencyPrefix}0.00`;
    return `${val > 0 ? '+' : '-'}${currencyPrefix}${Math.abs(val).toFixed(2)}`;
  };
  const formatSignedInr = (val: number) => {
    if (!Number.isFinite(val) || Math.abs(val) < 0.005) return '₹0.00';
    return `${val > 0 ? '+' : '-'}₹${Math.abs(val).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  // Determine overall TP progress & SL drawdown progress
  const slDistance = Math.max(Math.abs(effectiveEntry - resolvedStopLoss), effectiveEntry * 0.0028);
  const favorableMove = isShort ? effectiveEntry - markPrice : markPrice - effectiveEntry;
  const adverseMove = isShort ? markPrice - effectiveEntry : effectiveEntry - markPrice;

  const progressPct = useMemo(() => {
    if (!isTradeActive || !effectiveEntry || !resolvedTp4) return 0;
    const totalDistance = Math.abs(resolvedTp4 - effectiveEntry);
    if (totalDistance <= 0) return 0;
    const rawPct = (favorableMove / totalDistance) * 100;
    return Math.min(100, Math.max(0, Math.round(rawPct)));
  }, [isTradeActive, effectiveEntry, resolvedTp4, favorableMove]);

  const drawdownPct = useMemo(() => {
    if (!isTradeActive || slDistance <= 0) return 0;
    if (adverseMove <= 0) {
      return liveUnrealizedUsd < 0 ? 1 : 0;
    }
    return Math.min(100, Math.max(1, Math.round((adverseMove / slDistance) * 100)));
  }, [isTradeActive, slDistance, adverseMove, liveUnrealizedUsd]);

  const pnlState: LadderPnlState = useMemo(() => {
    if (!isTradeActive) return 'FLAT';
    if (liveUnrealizedUsd < 0) return 'NEGATIVE';
    if (
      liveUnrealizedUsd > 0 ||
      progressPct > 0 ||
      activeTrade?.tp1Hit ||
      activeTrade?.tp2Hit ||
      activeTrade?.tp3Hit
    ) {
      return 'POSITIVE';
    }
    return 'FLAT';
  }, [
    isTradeActive,
    liveUnrealizedUsd,
    progressPct,
    activeTrade?.tp1Hit,
    activeTrade?.tp2Hit,
    activeTrade?.tp3Hit,
  ]);

  const rewards = useMemo(() => {
    const formatReward = (usdAmt: number) => {
      const cleanAmt = Math.max(0, +usdAmt.toFixed(2));
      const inrAmt = cleanAmt * rate;
      const inrStr = inrAmt.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return {
        usd: `+${currencyPrefix}${cleanAmt.toFixed(2)}`,
        inr: `₹${inrStr}`,
        combined: `+${currencyPrefix}${cleanAmt.toFixed(2)} · ₹${inrStr}`,
        amount: cleanAmt,
      };
    };

    const calcStepUsd = (targetPrice: number, fallbackUsd: number) => {
      if (effectiveEntry > 0 && targetPrice > 0 && effectiveLotSize > 0) {
        return Math.abs(targetPrice - effectiveEntry) * effectiveLotSize;
      }
      return fallbackUsd;
    };

    const s1 = calcStepUsd(resolvedTp1, isMicro15 ? 3.75 : 12.5);
    const s2 = calcStepUsd(resolvedTp2, isMicro15 ? 7.5 : 25.0);
    const s3 = calcStepUsd(resolvedTp3, isMicro15 ? 11.25 : 37.5);
    const s4 = calcStepUsd(resolvedTp4, isMicro15 ? 15.0 : 50.0);

    return {
      step1: formatReward(s1),
      step2: formatReward(s2),
      step3: formatReward(s3),
      step4: formatReward(s4),
      rrRatios: isEma921Ladder ? ['1.10R', '1.60R', '2.00R', '2.50R'] : ['1.25R', '2.00R', '2.75R', '3.50R'],
    };
  }, [
    effectiveEntry,
    effectiveLotSize,
    resolvedTp1,
    resolvedTp2,
    resolvedTp3,
    resolvedTp4,
    isMicro15,
    isEma921Ladder,
    rate,
    currencyPrefix,
  ]);

  const fmt = (p: number | undefined) => {
    if (!p || p <= 0) return '0.00';
    return p >= 1000
      ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p >= 10
      ? p.toFixed(2)
      : p.toFixed(4);
  };

  const fmtDistance = (dist: number) => {
    if (dist <= 0.01) return `${currencyPrefix}0`;
    if (dist >= 10) return `${currencyPrefix}${Math.round(dist).toLocaleString('en-US')}`;
    if (dist >= 1) return `${currencyPrefix}${dist.toFixed(2)}`;
    return `${currencyPrefix}${dist.toFixed(4)}`;
  };

  const activeStepIndex = useMemo(() => {
    if (activeTrade?.tp4Hit) return 4;
    return Math.max(0, Math.min(3, resolvedActiveTargetIndex - 1));
  }, [activeTrade?.tp4Hit, resolvedActiveTargetIndex]);

  // Track exact timestamp when the trade entered the current active stage
  const stageTrackerRef = useRef<{
    tradeKey: string;
    stepIndex: number;
    startedAt: number;
  }>({
    tradeKey: '',
    stepIndex: -1,
    startedAt: Date.now(),
  });

  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  const activeTradeKey = isTradeActive
    ? String(activeTrade?.id || activeTrade?.openedAt || `${baseSymbol}-${effectiveEntry}`)
    : '';

  // Synchronously update stage start time when trade or activeStepIndex transitions
  if (!isTradeActive) {
    stageTrackerRef.current = { tradeKey: '', stepIndex: -1, startedAt: Date.now() };
  } else if (
    stageTrackerRef.current.tradeKey !== activeTradeKey ||
    stageTrackerRef.current.stepIndex !== activeStepIndex
  ) {
    const initialStartedAt =
      activeStepIndex === 0 &&
      typeof activeTrade?.openedAt === 'number' &&
      activeTrade.openedAt > 0 &&
      activeTrade.openedAt <= Date.now()
        ? activeTrade.openedAt
        : Date.now();
    stageTrackerRef.current = {
      tradeKey: activeTradeKey,
      stepIndex: activeStepIndex,
      startedAt: initialStartedAt,
    };
  }

  useEffect(() => {
    if (!isTradeActive) return;
    setNowTs(Date.now());
    const intervalId = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);
    return () => clearInterval(intervalId);
  }, [isTradeActive, activeTradeKey, activeStepIndex]);

  const stageElapsedMs = isTradeActive
    ? Math.max(0, nowTs - stageTrackerRef.current.startedAt)
    : 0;
  const isStageOver15Min = stageElapsedMs >= 15 * 60 * 1000;

  const formattedStageTimer = useMemo(() => {
    const totalSec = Math.floor(stageElapsedMs / 1000);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
  }, [stageElapsedMs]);

  // Strict Sequential Progression Engine:
  // Step 01 fills 0% -> 100% first.
  // Step 02 stays locked at 0% (LOCKED / PENDING) until Step 01 reaches 100% (COMPLETED).
  // Step 03 stays locked until Step 02 reaches 100%.
  // Step 04 stays locked until Step 03 reaches 100%.
  // In drawdown (negative PnL): rungs sweep anticlockwise in rose/crimson across 4 quartiles of SL.
  const tpOffsets: [number, number, number, number] = useMemo(() => {
    return [
      Math.max(0.1, Math.abs(resolvedTp1 - effectiveEntry)),
      Math.max(0.1, Math.abs(resolvedTp2 - effectiveEntry)),
      Math.max(0.1, Math.abs(resolvedTp3 - effectiveEntry)),
      Math.max(0.1, Math.abs(resolvedTp4 - effectiveEntry)),
    ];
  }, [resolvedTp1, resolvedTp2, resolvedTp3, resolvedTp4, effectiveEntry]);

  const rawHitFlags: [boolean, boolean, boolean, boolean] = useMemo(() => {
    return [
      Boolean(activeTrade?.tp1Hit),
      Boolean(activeTrade?.tp2Hit),
      Boolean(activeTrade?.tp3Hit),
      Boolean(activeTrade?.tp4Hit),
    ];
  }, [activeTrade?.tp1Hit, activeTrade?.tp2Hit, activeTrade?.tp3Hit, activeTrade?.tp4Hit]);

  const isTradeNegative = isTradeActive && (pnlState === 'NEGATIVE' || liveUnrealizedUsd < -0.01);

  // Absolute adverse move or friction-driven drawdown distance
  const adverseDistance = useMemo(() => {
    if (!isTradeActive) return 0;
    if (adverseMove > 0) return adverseMove;
    if (liveUnrealizedUsd < 0 && slDistance > 0) {
      return (drawdownPct / 100) * slDistance;
    }
    return 0;
  }, [isTradeActive, adverseMove, liveUnrealizedUsd, slDistance, drawdownPct]);

  const sequentialRungStates: SequentialRungState[] = useMemo(() => {
    return computeSequentialLadderSteps({
      isTradeActive,
      isNegative: isTradeNegative,
      currentPositiveValue: Math.max(0, favorableMove),
      positiveMilestones: tpOffsets,
      currentNegativeValue: adverseDistance,
      negativeMaxThreshold: slDistance,
      hitFlags: rawHitFlags,
    });
  }, [
    isTradeActive,
    isTradeNegative,
    favorableMove,
    tpOffsets,
    adverseDistance,
    slDistance,
    rawHitFlags,
  ]);

  // Piecewise continuum fill across Entry (22%) -> TP1 (41.5%) -> TP2 (61%) -> TP3 (80.5%) -> TP4 (100%)
  const continuumBarFill = useMemo(() => {
    const entryAnchor = 22;
    if (!isTradeActive) {
      return { mode: 'FLAT' as const, leftPct: entryAnchor, widthPct: 0 };
    }
    if (pnlState === 'NEGATIVE') {
      const ratio = Math.min(1, Math.max(0.03, drawdownPct / 100));
      const width = ratio * entryAnchor;
      return {
        mode: 'NEGATIVE' as const,
        leftPct: Math.max(0, entryAnchor - width),
        widthPct: width,
      };
    }
    if (pnlState === 'POSITIVE') {
      const milestones = [effectiveEntry, resolvedTp1, resolvedTp2, resolvedTp3, resolvedTp4];
      const anchors = [22, 41.5, 61, 80.5, 100];
      let targetAnchor = entryAnchor;
      for (let i = 0; i < 4; i++) {
        const segStart = milestones[i];
        const segEnd = milestones[i + 1];
        const segLen = Math.abs(segEnd - segStart);
        const movedFromSegStart = isShort ? segStart - markPrice : markPrice - segStart;
        if (movedFromSegStart <= 0) break;
        if (movedFromSegStart >= segLen || (i === 0 && activeTrade?.tp1Hit) || (i === 1 && activeTrade?.tp2Hit) || (i === 2 && activeTrade?.tp3Hit) || (i === 3 && activeTrade?.tp4Hit)) {
          targetAnchor = anchors[i + 1];
        } else {
          const frac = segLen > 0 ? Math.min(1, Math.max(0, movedFromSegStart / segLen)) : 0;
          targetAnchor = anchors[i] + frac * (anchors[i + 1] - anchors[i]);
          break;
        }
      }
      return {
        mode: 'POSITIVE' as const,
        leftPct: entryAnchor,
        widthPct: Math.max(2, targetAnchor - entryAnchor),
      };
    }
    return { mode: 'FLAT' as const, leftPct: entryAnchor, widthPct: 0 };
  }, [
    isTradeActive,
    pnlState,
    drawdownPct,
    effectiveEntry,
    resolvedTp1,
    resolvedTp2,
    resolvedTp3,
    resolvedTp4,
    markPrice,
    isShort,
    activeTrade?.tp1Hit,
    activeTrade?.tp2Hit,
    activeTrade?.tp3Hit,
    activeTrade?.tp4Hit,
  ]);

  const hitFlags = [
    sequentialRungStates[0].isCompleted,
    sequentialRungStates[1].isCompleted,
    sequentialRungStates[2].isCompleted,
    sequentialRungStates[3].isCompleted,
  ];

  const stepStates = useMemo(() => [
    {
      num: 'STEP 01',
      label: isEma921Ladder ? '70% (+ $15 Net) · SL → ±$35 BE' : '50% Close · SL Held',
      price: resolvedTp1,
      reward: rewards.step1,
      rr: rewards.rrRatios[0],
      isHit: hitFlags[0],
      isActive: sequentialRungStates[0].isActive,
      seq: sequentialRungStates[0],
    },
    {
      num: 'STEP 02',
      label: isEma921Ladder ? '5m EMA 21 Trail (30%)' : '25% Close · SL → BE',
      price: resolvedTp2,
      reward: rewards.step2,
      rr: rewards.rrRatios[1],
      isHit: hitFlags[1],
      isActive: sequentialRungStates[1].isActive,
      seq: sequentialRungStates[1],
    },
    {
      num: 'STEP 03',
      label: isEma921Ladder ? 'Runner Trail Extend' : 'Trail SL → TP2',
      price: resolvedTp3,
      reward: rewards.step3,
      rr: rewards.rrRatios[2],
      isHit: hitFlags[2],
      isActive: sequentialRungStates[2].isActive,
      seq: sequentialRungStates[2],
    },
    {
      num: 'STEP 04',
      label: isEma921Ladder ? '30% EMA 21 → +220pt' : 'Terminal Runner Exit',
      price: resolvedTp4,
      reward: rewards.step4,
      rr: rewards.rrRatios[3],
      isHit: hitFlags[3],
      isActive: sequentialRungStates[3].isActive,
      isTerminal: true,
      seq: sequentialRungStates[3],
    },
  ], [
    isEma921Ladder,
    resolvedTp1,
    resolvedTp2,
    resolvedTp3,
    resolvedTp4,
    rewards,
    hitFlags,
    sequentialRungStates,
  ]);

  const headerRingProgress = isTradeNegative ? drawdownPct : progressPct;
  const headerRingLabel = isTradeNegative ? `-${drawdownPct}%` : `+${progressPct}%`;

  const isReversing = isTradeNegative;

  // Dynamic 5-stage sentiment transitions:
  // Strong Bullish (#065f46), Bullish (#10b981), Neutral (#eab308), Bearish (#f97316), Strong Bearish (#ef4444)
  const activeSentiment = useMemo<SentimentConfig>(() => {
    if (!isTradeActive || Math.abs(liveUnrealizedUsd) < 0.005) {
      return SENTIMENT_STAGES.NEUTRAL;
    }
    if (isTradeNegative) {
      return drawdownPct >= 50 ? SENTIMENT_STAGES.STRONG_BEARISH : SENTIMENT_STAGES.BEARISH;
    }
    const signedProgress = progressPct;
    if (signedProgress >= 50 || liveUnrealizedUsd >= 25 || activeTrade?.tp3Hit || activeTrade?.tp4Hit) {
      return SENTIMENT_STAGES.STRONG_BULLISH;
    }
    return SENTIMENT_STAGES.BULLISH;
  }, [isTradeActive, liveUnrealizedUsd, isTradeNegative, drawdownPct, progressPct, activeTrade?.tp3Hit, activeTrade?.tp4Hit]);

  const allStepsHit = rawHitFlags[3] || (isTradeActive && pnlState === 'POSITIVE' && progressPct >= 100);
  const overallSignedRatio = !isTradeActive
    ? 0
    : isTradeNegative
    ? -(drawdownPct / 100)
    : allStepsHit
    ? 1
    : progressPct / 100;

  const overallPalette = useMemo(
    () =>
      computeContinuousProfitPalette(overallSignedRatio, {
        isNeutralFlat: !isTradeActive || Math.abs(liveUnrealizedUsd) < 0.005,
        isActive: isTradeActive,
        isAchieved: allStepsHit,
      }),
    [overallSignedRatio, isTradeActive, liveUnrealizedUsd, allStepsHit]
  );

  return (
    <div
      className={`panel-delta relative p-3 sm:p-3.5 backdrop-blur-md flex flex-col justify-between space-y-2.5 font-sans overflow-hidden min-w-0 max-w-full ${className}`}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[1px] pointer-events-none transition-all duration-500"
        style={{
          background: `linear-gradient(90deg, transparent, ${overallPalette.solid}, transparent)`,
          opacity: 0.55,
        }}
      />

      {/* ═══════════════════════════════════════════════════════════
          DUAL-METRIC HEADER (Ring + Live PnL + Terminal Goal)
          ═══════════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <CircularProgress
            progress={headerRingProgress}
            displayLabel={headerRingLabel}
            sentimentLabel={activeSentiment.label}
            sentimentColor={activeSentiment.color}
            sentimentAccent={activeSentiment.accent}
            sentimentGradient={activeSentiment.gradient}
            isReversing={isReversing}
            palette={overallPalette}
            isHit={allStepsHit}
            isActive={isTradeActive}
            isHeader={true}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div
                className="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors duration-300"
                style={{
                  backgroundColor: overallPalette.badgeBg,
                  borderColor: overallPalette.badgeBorder,
                  color: overallPalette.text,
                }}
              >
                <Compass className="w-3 h-3" />
              </div>
              <h3 className="panel-delta-title text-white truncate" title="4-Stage Profit Ladder">
                4-Stage Profit Ladder
              </h3>
            </div>
            <p className="text-[10px] text-slate-300 font-mono mt-0.5 truncate">
              {isTradeActive ? (
                <span className="text-cyan-300 font-semibold">
                  ACTIVE TRACKING · {effectiveLotSize} {baseSymbol}
                </span>
              ) : (
                <span className="text-slate-400">
                  Standby Continuum · {effectiveLotSize} {baseSymbol}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start sm:items-end gap-1 shrink-0 ml-auto">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isTradeActive && (
              <span
                className="px-2 py-0.5 rounded-md text-[10px] font-extrabold font-mono tabular-nums border whitespace-nowrap transition-all duration-300"
                style={{
                  backgroundColor: overallPalette.badgeBg,
                  borderColor: overallPalette.badgeBorder,
                  color: overallPalette.profitText,
                  boxShadow: overallPalette.glow,
                }}
              >
                {formatSignedUsd(liveUnrealizedUsd)} · {formatSignedInr(liveUnrealizedInr)}
              </span>
            )}
            <span
              className={`badge-delta whitespace-nowrap ${
                isShort ? 'badge-delta-danger' : 'badge-delta-live'
              }`}
            >
              {isShort ? (
                <>
                  <ArrowDown className="w-3 h-3 text-rose-400 shrink-0" /> SHORT
                </>
              ) : (
                <>
                  <ArrowUp className="w-3 h-3 text-emerald-400 shrink-0" /> LONG
                </>
              )}
            </span>
          </div>

          <div className="px-2 py-0.5 rounded-md bg-[#070b14] border border-white/10 flex items-baseline justify-between gap-2 whitespace-nowrap shrink-0">
            <span className="text-[9px] text-[#94A3B8] uppercase font-bold tracking-wider">
              TP4 GOAL:
            </span>
            <span className="text-xs sm:text-sm font-extrabold text-[#F8FAFC] font-mono tabular-nums tracking-tight">
              {currencyPrefix}
              {fmt(resolvedTp4)}
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          4px HORIZONTAL SL → ENTRY → TP1 → TP2 → TP3 → TP4 CONTINUUM BAR
          ═══════════════════════════════════════════════════════════ */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[9px] font-mono tabular-nums text-[#94A3B8] px-0.5">
          <span className="text-rose-400 font-bold">
            SL {currencyPrefix}
            {fmt(resolvedStopLoss)}
          </span>
          <span className="text-cyan-300 font-bold">
            ENTRY {currencyPrefix}
            {fmt(effectiveEntry)}
          </span>
          <span className="hidden sm:inline text-[#94A3B8]">TP1</span>
          <span className="hidden sm:inline text-[#94A3B8]">TP2</span>
          <span className="hidden sm:inline text-[#94A3B8]">TP3</span>
          <span className="font-bold text-[#F8FAFC]">
            TP4
          </span>
        </div>

        <div className="relative w-full h-1.5 bg-[#070b14] border border-white/10 rounded-full overflow-hidden">
          {/* Dynamic real-time Electric Cyan -> Vibrant Teal -> Neon Mint OR Cool Indigo -> Warm Rose -> Deep Crimson fill */}
          {continuumBarFill.widthPct > 0 && (
            <motion.div
              className="absolute top-0 bottom-0 rounded-full"
              style={
                continuumBarFill.mode === 'POSITIVE'
                  ? {
                      background: overallPalette.barGradient,
                      boxShadow: `0 0 8px ${overallPalette.solid}`,
                    }
                  : {
                      background: overallPalette.barGradientRtl,
                      boxShadow: `0 0 8px ${overallPalette.solid}`,
                    }
              }
              initial={false}
              animate={{
                left: `${continuumBarFill.leftPct}%`,
                width: `${continuumBarFill.widthPct}%`,
              }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          )}

          {/* Entry Anchor Marker (22%) & Milestone Tick Marks */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-cyan-300 z-10"
            style={{ left: '22%' }}
            title={`Entry: ${currencyPrefix}${fmt(effectiveEntry)}`}
          />
          {[41.5, 61, 80.5].map((tick) => (
            <div
              key={tick}
              className="absolute top-0 bottom-0 w-[1px] bg-white/20 z-10"
              style={{ left: `${tick}%` }}
            />
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          4-COLUMN STEP CARDS (Obsidian & Electric Cyan -> Teal -> Neon Mint)
          ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 min-w-0 max-w-full">
        {stepStates.map((step) => {
          const seq = step.seq;
          const isNegative = seq.isReversing;
          const stepAchieved = seq.isCompleted && !isNegative;
          const isDormant = seq.isLocked;

          const p = computeContinuousProfitPalette(seq.signedRatio, {
            isNeutralFlat: !isTradeActive || Math.abs(liveUnrealizedUsd) < 0.005,
            isActive: seq.isActive,
            isAchieved: seq.isCompleted,
          });

          const ringProgress = seq.progressPct;
          const ringLabel = seq.displayLabel;

          const remainingDist = Math.abs(step.price - markPrice);

          // Clean Dark Obsidian card surfaces (emerald glass tint reserved exclusively for 100% ACHIEVED)
          const cardSurfaceClass = seq.isCompleted
            ? isNegative
              ? 'bg-[#1a090e] border-rose-500/40 shadow-[0_0_18px_rgba(244,63,94,0.14)]'
              : 'bg-[#081c18] border-emerald-500/40 shadow-[0_0_18px_rgba(16,185,129,0.12)]'
            : seq.isActive
            ? isNegative
              ? 'bg-[#15080c] border-rose-400/50 shadow-[0_0_20px_rgba(244,63,94,0.18)]'
              : 'bg-[#0c1220] border-cyan-400/50 shadow-[0_0_20px_rgba(56,189,248,0.12)]'
            : 'bg-[#0c1220] border-white/10';

          return (
            <div
              key={step.num}
              className={`p-2.5 rounded-xl border flex flex-col justify-between gap-2 min-w-0 max-w-full transition-all duration-300 ${cardSurfaceClass}`}
            >
              {/* Card Top Row: Crisp Step Label + Continuous-Gradient Status Pill */}
              <div className="flex flex-wrap items-center justify-between gap-1 min-w-0">
                <span className="text-[10px] font-extrabold tracking-wide truncate text-[#F8FAFC]">
                  {step.num}
                </span>

                {seq.status === 'COMPLETED' ? (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[8.5px] font-extrabold whitespace-nowrap shrink-0 transition-colors duration-300 ${
                      isNegative
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                        : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                    }`}
                  >
                    ✓ COMPLETED
                  </span>
                ) : seq.status === 'ACTIVE' ? (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-extrabold uppercase tracking-tight whitespace-nowrap shrink-0 border transition-colors duration-300 ${
                      isNegative
                        ? 'bg-rose-500/20 border-rose-400/60 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)] animate-pulse'
                        : 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-[0_0_12px_rgba(56,189,248,0.25)] animate-pulse'
                    }`}
                  >
                    ACTIVE · {seq.displayLabel}
                  </span>
                ) : (
                  <span
                    className="px-1.5 py-0.5 rounded border text-[8.5px] font-mono font-bold shrink-0 transition-colors duration-300 bg-white/[0.04] border-white/10 text-slate-400"
                  >
                    LOCKED / PENDING
                  </span>
                )}
              </div>

              {/* Card Middle Row: Circular Gradient % Ring + Pure White Target Price */}
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <CircularProgress
                  progress={ringProgress}
                  displayLabel={ringLabel}
                  palette={p}
                  isHit={seq.isCompleted}
                  isActive={seq.isActive}
                  isDormant={isDormant}
                  isReversing={isNegative}
                />
                <div className="text-right min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-end gap-1 min-w-0">
                    <span className="text-[9px] uppercase tracking-wider text-[#94A3B8] font-semibold">
                      TARGET
                    </span>
                    <span
                      className="text-xs sm:text-[13px] font-extrabold font-mono tabular-nums tracking-tight text-[#F8FAFC]"
                      title={`Target: ${currencyPrefix}${fmt(step.price)}`}
                    >
                      {currencyPrefix}
                      {fmt(step.price)}
                    </span>
                  </div>
                  <div className="text-[9px] text-[#94A3B8] font-medium truncate mt-0.5" title={step.label}>
                    {step.label}
                  </div>
                </div>
              </div>

              {/* Recessed Dark Inner Telemetry Well (#070b14): Gradient Accent Strictly on Live PnL */}
              <div className="space-y-1.5 min-w-0">
                <div className="px-2 py-1.5 rounded-lg bg-[#070b14] border border-white/10 font-mono tabular-nums space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-1 text-[10px] min-w-0">
                    <span
                      className="font-extrabold transition-colors duration-300"
                      style={{ color: p.profitText }}
                    >
                      {formatSignedUsd(isTradeActive ? liveUnrealizedUsd : 0)}
                    </span>
                    <span className="text-[#94A3B8]/60 text-[9px]">→</span>
                    <span className="font-extrabold text-[#F8FAFC]">
                      {step.reward.usd}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1 text-[9px] min-w-0">
                    <span
                      className="font-semibold transition-colors duration-300"
                      style={{ color: p.profitText }}
                    >
                      {formatSignedInr(isTradeActive ? liveUnrealizedInr : 0)}
                    </span>
                    <span className="text-[#94A3B8] truncate">{step.reward.inr}</span>
                  </div>
                </div>

                {/* Progress Bar (Electric Cyan -> Vibrant Teal -> Neon Mint OR Rose -> Crimson) */}
                <div className="w-full bg-[#070b14] h-2 rounded-full border border-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${seq.progressPct}%`,
                      background: isNegative
                        ? 'linear-gradient(90deg, #fda4af 0%, #f43f5e 50%, #be123c 100%)'
                        : p.barGradient,
                      boxShadow: seq.progressPct > 0
                        ? (isNegative ? '0 0 8px rgba(244, 63, 94, 0.5)' : `0 0 8px ${p.solid}`)
                        : 'none',
                    }}
                  />
                </div>

                {/* Stage Duration Timer on Active Target Card (Pure White Value, Muted Slate Label) */}
                {seq.isActive && isTradeActive && (
                  <div
                    className={`px-2 py-1 rounded-md text-[9.5px] font-mono tabular-nums flex items-center justify-between gap-1 border transition-colors ${
                      isStageOver15Min
                        ? 'bg-[#070b14] border-cyan-400/60 shadow-[0_0_12px_rgba(56,189,248,0.16)]'
                        : 'bg-[#070b14] border-white/10'
                    }`}
                    title={
                      isStageOver15Min
                        ? 'Stage duration exceeded 15 minutes'
                        : 'Time spent in current stage'
                    }
                  >
                    <span className="inline-flex items-center gap-1 truncate text-[#94A3B8] font-semibold">
                      <Clock
                        className={`w-2.5 h-2.5 shrink-0 ${
                          isStageOver15Min ? 'text-cyan-400 animate-pulse' : 'text-[#94A3B8]'
                        }`}
                      />
                      <span>STAGE TIME</span>
                    </span>
                    <span
                      className={`shrink-0 font-extrabold ${
                        isStageOver15Min ? 'text-cyan-300' : 'text-[#F8FAFC]'
                      }`}
                    >
                      {formattedStageTimer}
                    </span>
                  </div>
                )}
              </div>

              {/* Live Remaining Distance Telemetry */}
              <div
                className="text-[9.5px] font-mono tabular-nums pt-1.5 border-t border-white/10 truncate font-semibold"
                title={
                  stepAchieved
                    ? '✓ ACHIEVED · MILESTONE LOCKED'
                    : `${fmtDistance(remainingDist)} to target ${currencyPrefix}${fmt(step.price)}`
                }
              >
                {stepAchieved ? (
                  <span className="text-emerald-400 font-bold">✓ ACHIEVED · LOCKED</span>
                ) : (
                  <span className="text-[#94A3B8]">
                    <span className="text-[#F8FAFC] font-bold">{fmtDistance(remainingDist)}</span> to target
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
