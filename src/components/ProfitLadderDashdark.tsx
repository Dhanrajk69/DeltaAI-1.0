import React, { useMemo, useId, useState, useEffect, useRef } from 'react';
import { Compass, ArrowDown, ArrowUp, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  computeContinuousProfitPalette,
  ContinuousProfitPalette,
} from '../utils/optionsProfitLadder';

type LadderPnlState = 'POSITIVE' | 'NEGATIVE' | 'FLAT';

interface CircularProgressProps {
  progress: number;
  displayLabel?: string;
  palette: ContinuousProfitPalette;
  isHit: boolean;
  isActive: boolean;
  isDormant?: boolean;
  isHeader?: boolean;
}

const CircularProgress: React.FC<CircularProgressProps> = ({
  progress,
  displayLabel,
  palette,
  isHit,
  isActive,
  isDormant = false,
  isHeader = false,
}) => {
  const uid = useId().replace(/:/g, '');
  const dynGradId = `ladder-dyn-${uid}`;

  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const clamped = isDormant && !isHit ? Math.min(100, Math.max(0, progress)) : Math.min(100, Math.max(0, progress));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  const showStroke = clamped > 0;
  const glowFilter = showStroke || isHit || isActive || isHeader ? palette.ringGlow : 'none';
  const label = displayLabel ?? `${Math.round(clamped)}%`;

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 ${
        isHeader ? 'w-11 h-11' : 'w-10 h-10'
      }`}
    >
      <svg
        className={`${isHeader ? 'w-11 h-11' : 'w-10 h-10'} -rotate-90 transform overflow-visible`}
        viewBox="0 0 44 44"
        style={glowFilter !== 'none' ? { filter: glowFilter } : undefined}
      >
        <defs>
          <linearGradient id={dynGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={palette.ringStart} />
            <stop offset="50%" stopColor={palette.ringMid} />
            <stop offset="100%" stopColor={palette.ringEnd} />
          </linearGradient>
        </defs>
        <circle
          cx="22"
          cy="22"
          r={radius}
          stroke="#162033"
          strokeWidth={4.5}
          fill="none"
        />
        {showStroke && (
          <motion.circle
            cx="22"
            cy="22"
            r={radius}
            stroke={`url(#${dynGradId})`}
            strokeWidth={4.5}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            strokeLinecap="round"
            fill="none"
          />
        )}
      </svg>
      <span
        className="absolute text-[9px] font-extrabold font-mono tabular-nums tracking-tight transition-colors duration-300"
        style={{ color: clamped > 0 || isHit || isActive ? palette.text : '#94A3B8' }}
      >
        {label}
      </span>
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
  className = '',
}) => {
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
      rrRatios: ['1.25R', '2.00R', '2.75R', '3.50R'],
    };
  }, [
    effectiveEntry,
    effectiveLotSize,
    resolvedTp1,
    resolvedTp2,
    resolvedTp3,
    resolvedTp4,
    isMicro15,
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

  // Sequential stage-by-stage progress:
  // Completed (< activeStepIndex) = 100%, Active (=== activeStepIndex) = segment 0%..100%, Upcoming (> activeStepIndex) = 0%
  const stepProgressValues = useMemo(() => {
    const segStarts = [effectiveEntry, resolvedTp1, resolvedTp2, resolvedTp3];
    const segEnds = [resolvedTp1, resolvedTp2, resolvedTp3, resolvedTp4];
    const hitFlags = [
      Boolean(activeTrade?.tp1Hit),
      Boolean(activeTrade?.tp2Hit),
      Boolean(activeTrade?.tp3Hit),
      Boolean(activeTrade?.tp4Hit),
    ];

    return [0, 1, 2, 3].map((idx) => {
      if (idx < activeStepIndex || hitFlags[idx]) return 100;
      if (!isTradeActive || idx > activeStepIndex) return 0;
      if (pnlState === 'NEGATIVE') return drawdownPct;
      const segStart = segStarts[idx];
      const segEnd = segEnds[idx];
      const segTotal = Math.abs(segEnd - segStart);
      if (segTotal <= 0) return 0;
      const movedInSeg = isShort ? segStart - markPrice : markPrice - segStart;
      return Math.min(100, Math.max(0, Math.round((movedInSeg / segTotal) * 100)));
    });
  }, [
    activeStepIndex,
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
    0 < activeStepIndex || Boolean(activeTrade?.tp1Hit),
    1 < activeStepIndex || Boolean(activeTrade?.tp2Hit),
    2 < activeStepIndex || Boolean(activeTrade?.tp3Hit),
    3 < activeStepIndex || Boolean(activeTrade?.tp4Hit),
  ];

  const stepStates = [
    {
      num: 'STEP 01',
      label: '50% Close · SL Held',
      price: resolvedTp1,
      reward: rewards.step1,
      rr: rewards.rrRatios[0],
      isHit: hitFlags[0],
      isActive: isTradeActive && !hitFlags[0] && activeStepIndex === 0,
      progress: stepProgressValues[0],
    },
    {
      num: 'STEP 02',
      label: '25% Close · SL → BE',
      price: resolvedTp2,
      reward: rewards.step2,
      rr: rewards.rrRatios[1],
      isHit: hitFlags[1],
      isActive: isTradeActive && !hitFlags[1] && activeStepIndex === 1,
      progress: stepProgressValues[1],
    },
    {
      num: 'STEP 03',
      label: 'Trail SL → TP2',
      price: resolvedTp3,
      reward: rewards.step3,
      rr: rewards.rrRatios[2],
      isHit: hitFlags[2],
      isActive: isTradeActive && !hitFlags[2] && activeStepIndex === 2,
      progress: stepProgressValues[2],
    },
    {
      num: 'STEP 04',
      label: 'Terminal Runner Exit',
      price: resolvedTp4,
      reward: rewards.step4,
      rr: rewards.rrRatios[3],
      isHit: hitFlags[3],
      isActive: isTradeActive && !hitFlags[3] && activeStepIndex === 3,
      isTerminal: true,
      progress: stepProgressValues[3],
    },
  ];

  const headerRingProgress =
    pnlState === 'NEGATIVE' ? drawdownPct : progressPct;
  const headerRingLabel =
    pnlState === 'NEGATIVE' ? `-${drawdownPct}%` : `${progressPct}%`;

  const allStepsHit = hitFlags[3] || (isTradeActive && pnlState === 'POSITIVE' && progressPct >= 100);
  const overallSignedRatio = !isTradeActive
    ? 0
    : pnlState === 'NEGATIVE'
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
                <span>
                  Live Continuum · {effectiveLotSize} {baseSymbol}
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
          const stepAchieved =
            step.isHit ||
            (isTradeActive &&
              pnlState === 'POSITIVE' &&
              (step.progress >= 100 ||
                (step.reward.amount > 0 && liveUnrealizedUsd >= step.reward.amount)));
          const isDormant = !stepAchieved && !step.isActive;
          const isNegative = isTradeActive && pnlState === 'NEGATIVE';

          // Continuous progressRatio (0.0 -> 1.0) counting up from $0.00 -> target
          const rungProgressRatio = stepAchieved
            ? 1
            : !isTradeActive || liveUnrealizedUsd <= 0
            ? 0
            : step.reward.amount > 0
            ? Math.min(0.999, Math.max(0, liveUnrealizedUsd / step.reward.amount))
            : Math.min(0.999, Math.max(0, step.progress / 100));

          const rungProgressPct = stepAchieved
            ? 100
            : Math.min(99, Math.max(0, Math.round(rungProgressRatio * 100)));

          const rungSignedRatio = isNegative
            ? -(drawdownPct / 100)
            : rungProgressRatio;

          const p = computeContinuousProfitPalette(rungSignedRatio, {
            isNeutralFlat: !isTradeActive || Math.abs(liveUnrealizedUsd) < 0.005,
            isActive: step.isActive,
            isAchieved: stepAchieved,
          });

          const ringProgress = stepAchieved
            ? 100
            : isNegative
            ? drawdownPct
            : rungProgressPct;

          const ringLabel = stepAchieved
            ? '100%'
            : isNegative
            ? `-${drawdownPct}%`
            : `${rungProgressPct}%`;

          const remainingDist = Math.abs(step.price - markPrice);

          // Clean Dark Obsidian card surfaces (emerald glass tint reserved exclusively for 100% ACHIEVED)
          const cardSurfaceClass = stepAchieved
            ? 'bg-[#081c18] border-emerald-500/40 shadow-[0_0_18px_rgba(16,185,129,0.12)]'
            : step.isActive
            ? 'bg-[#0c1220] border-cyan-400/50 shadow-[0_0_20px_rgba(56,189,248,0.12)]'
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

                {stepAchieved ? (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded border text-[8.5px] font-extrabold whitespace-nowrap shrink-0 transition-colors duration-300"
                    style={{
                      backgroundColor: p.badgeBg,
                      borderColor: p.badgeBorder,
                      color: p.text,
                    }}
                  >
                    ✓ ACHIEVED
                  </span>
                ) : isNegative ? (
                  <span
                    className="px-1.5 py-0.5 rounded text-[8.5px] font-extrabold uppercase tracking-tight whitespace-nowrap shrink-0 border transition-colors duration-300"
                    style={{
                      backgroundColor: p.badgeBg,
                      borderColor: p.badgeBorder,
                      color: p.text,
                    }}
                  >
                    DD · -{drawdownPct}%
                  </span>
                ) : step.isActive ? (
                  <span
                    className="px-1.5 py-0.5 rounded text-[8.5px] font-extrabold uppercase tracking-tight whitespace-nowrap shrink-0 border transition-colors duration-300"
                    style={{
                      backgroundColor: p.badgeBg,
                      borderColor: p.badgeBorder,
                      color: p.text,
                    }}
                  >
                    ACTIVE · {rungProgressPct}%
                  </span>
                ) : (
                  <span
                    className="px-1.5 py-0.5 rounded border text-[8.5px] font-mono font-bold shrink-0 transition-colors duration-300"
                    style={{
                      backgroundColor: p.badgeBg,
                      borderColor: p.badgeBorder,
                      color: p.text,
                    }}
                  >
                    {rungProgressPct > 0 ? `${rungProgressPct}% · ${step.rr}` : `PENDING · ${step.rr}`}
                  </span>
                )}
              </div>

              {/* Card Middle Row: Circular Gradient % Ring + Pure White Target Price */}
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <CircularProgress
                  progress={ringProgress}
                  displayLabel={ringLabel}
                  palette={p}
                  isHit={stepAchieved}
                  isActive={step.isActive}
                  isDormant={isDormant}
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

                {/* Progress Bar (Electric Cyan -> Vibrant Teal -> Neon Mint OR Cool Indigo -> Warm Rose -> Deep Crimson) */}
                <div className="w-full bg-[#070b14] h-2 rounded-full border border-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${isNegative ? Math.min(100, Math.max(8, drawdownPct)) : rungProgressPct}%`,
                      background: p.barGradient,
                      boxShadow: (isNegative ? drawdownPct : rungProgressPct) > 0 ? `0 0 8px ${p.solid}` : 'none',
                    }}
                  />
                </div>

                {/* Stage Duration Timer on Active Target Card (Pure White Value, Muted Slate Label) */}
                {step.isActive && isTradeActive && (
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
