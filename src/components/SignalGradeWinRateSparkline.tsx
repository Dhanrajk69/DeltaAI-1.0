import React, { useMemo, useState } from 'react';
import { ClosedTrade } from '../types';

export type SignalGradeFilter = 'ALL' | 'GRADE_A' | 'GRADE_B' | 'GRADE_C';

export interface SparklineSignalSample {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  timestamp: number;
  convictionPct: number;
  grade?: string;
  outcomePnl?: number | null;
  hitTarget?: string | null;
  status?: string;
}

export interface SevenDayWinRateBucket {
  dateKey: string;
  shortLabel: string;
  wins: number;
  losses: number;
  resolvedCount: number;
  signalCount: number;
  winRatePct: number | null;
  source: 'REALIZED' | 'CONVICTION' | 'NONE';
}

export interface SevenDayWinRateTrend {
  buckets: SevenDayWinRateBucket[];
  overallWinRatePct: number | null;
  deltaPct: number | null;
  totalWins: number;
  totalLosses: number;
  totalResolved: number;
  totalSignals: number;
  hasRealizedOutcomes: boolean;
}

export function normalizeSparklineGradeCode(
  grade?: string,
  convictionPct = 0
): 'A+' | 'A' | 'B+' | 'B' | 'C' {
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

export function matchesSparklineGradeFilter(
  grade: string | undefined,
  convictionPct: number,
  filter: SignalGradeFilter
): boolean {
  if (filter === 'ALL') return true;
  const code = normalizeSparklineGradeCode(grade, convictionPct);
  if (filter === 'GRADE_A') return code === 'A+' || code === 'A';
  if (filter === 'GRADE_B') return code === 'B+' || code === 'B';
  if (filter === 'GRADE_C') return code === 'C';
  return true;
}

function toLocalDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayShortLabel(ms: number, isToday: boolean): string {
  if (isToday) return 'Today';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function inferTradeGradeFromMeta(
  trade: ClosedTrade,
  signals: SparklineSignalSample[]
): 'A+' | 'A' | 'B+' | 'B' | 'C' | null {
  const combinedText = `${trade.reason || ''} ${(trade.tags || []).join(' ')}`.toUpperCase();
  const explicitMatch = combinedText.match(/GRADE\s*(A\+|A|B\+|B|C)/i);
  if (explicitMatch && explicitMatch[1]) {
    return normalizeSparklineGradeCode(explicitMatch[1], 0);
  }

  // Correlate closed trade to nearest signal for same base symbol within ±45 minutes
  const tradeTs =
    (typeof trade.openedAt === 'number' && trade.openedAt > 0
      ? trade.openedAt
      : typeof trade.closedAt === 'number' && trade.closedAt > 0
      ? trade.closedAt
      : Date.parse(trade.created_at || '')) || 0;
  if (tradeTs <= 0) return null;

  const tradeBase = String(trade.symbol || '')
    .toUpperCase()
    .replace(/USDT$|USD$/i, '');

  let bestSig: SparklineSignalSample | null = null;
  let bestDiff = 45 * 60 * 1000;
  for (const sig of signals) {
    const sigBase = String(sig.symbol || '')
      .toUpperCase()
      .replace(/USDT$|USD$/i, '');
    if (sigBase !== tradeBase) continue;
    const diff = Math.abs(tradeTs - sig.timestamp);
    if (diff <= bestDiff) {
      bestDiff = diff;
      bestSig = sig;
    }
  }
  if (bestSig) {
    return normalizeSparklineGradeCode(bestSig.grade, bestSig.convictionPct);
  }
  return null;
}

export function computeSevenDayGradeWinRateTrend(
  signals: SparklineSignalSample[],
  trades: ClosedTrade[],
  filter: SignalGradeFilter,
  nowMs: number = Date.now()
): SevenDayWinRateTrend {
  const dayMs = 24 * 60 * 60 * 1000;
  const bucketsMap = new Map<
    string,
    {
      dateKey: string;
      shortLabel: string;
      wins: number;
      losses: number;
      signalCount: number;
      convictionSum: number;
    }
  >();
  const orderedKeys: string[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const ts = nowMs - offset * dayMs;
    const key = toLocalDateKey(ts);
    orderedKeys.push(key);
    bucketsMap.set(key, {
      dateKey: key,
      shortLabel: formatDayShortLabel(ts, offset === 0),
      wins: 0,
      losses: 0,
      signalCount: 0,
      convictionSum: 0,
    });
  }

  const countedOutcomeKeys = new Set<string>();

  // 1. Fold in historical signals matching the active grade filter
  for (const sig of signals) {
    if (!sig || !Number.isFinite(sig.timestamp) || sig.timestamp <= 0) continue;
    if (!matchesSparklineGradeFilter(sig.grade, sig.convictionPct, filter)) continue;
    const key = toLocalDateKey(sig.timestamp);
    const bucket = bucketsMap.get(key);
    if (!bucket) continue;

    bucket.signalCount += 1;
    bucket.convictionSum += Math.max(0, Math.min(100, Number(sig.convictionPct) || 0));

    const hitTargetUpper = String(sig.hitTarget || '').toUpperCase();
    const hasNumericOutcome = typeof sig.outcomePnl === 'number' && Number.isFinite(sig.outcomePnl);
    const isHitWin = hitTargetUpper.startsWith('TP') || hitTargetUpper.includes('WIN');
    const isHitLoss = hitTargetUpper.startsWith('SL') || hitTargetUpper.includes('LOSS');

    if (hasNumericOutcome || isHitWin || isHitLoss) {
      const outcomeDedup = `sig:${sig.id}`;
      if (!countedOutcomeKeys.has(outcomeDedup)) {
        countedOutcomeKeys.add(outcomeDedup);
        const isWin = hasNumericOutcome ? (sig.outcomePnl as number) > 0 : isHitWin;
        if (isWin) bucket.wins += 1;
        else bucket.losses += 1;
      }
    }
  }

  // 2. Fold in real closed trades from trade history over the last 7 days
  for (const trade of trades) {
    if (!trade) continue;
    const tradeTs =
      typeof trade.closedAt === 'number' && Number.isFinite(trade.closedAt) && trade.closedAt > 0
        ? trade.closedAt
        : typeof trade.created_at === 'string' && Number.isFinite(Date.parse(trade.created_at))
        ? Date.parse(trade.created_at)
        : typeof trade.openedAt === 'number' && trade.openedAt > 0
        ? trade.openedAt
        : 0;
    if (tradeTs <= 0) continue;

    const key = toLocalDateKey(tradeTs);
    const bucket = bucketsMap.get(key);
    if (!bucket) continue;

    const inferredGrade = inferTradeGradeFromMeta(trade, signals);
    if (filter !== 'ALL') {
      if (!inferredGrade) continue;
      if (!matchesSparklineGradeFilter(inferredGrade, 0, filter)) continue;
    }

    const dedupKey = `trade:${trade.fillId || trade.id}`;
    if (countedOutcomeKeys.has(dedupKey)) continue;
    countedOutcomeKeys.add(dedupKey);

    if ((trade.realisedPnl ?? 0) > 0) bucket.wins += 1;
    else bucket.losses += 1;
  }

  let totalWins = 0;
  let totalLosses = 0;
  let totalSignals = 0;

  const buckets: SevenDayWinRateBucket[] = orderedKeys.map((key) => {
    const raw = bucketsMap.get(key)!;
    const resolvedCount = raw.wins + raw.losses;
    totalWins += raw.wins;
    totalLosses += raw.losses;
    totalSignals += raw.signalCount;

    if (resolvedCount > 0) {
      return {
        dateKey: raw.dateKey,
        shortLabel: raw.shortLabel,
        wins: raw.wins,
        losses: raw.losses,
        resolvedCount,
        signalCount: raw.signalCount,
        winRatePct: Math.round((raw.wins / resolvedCount) * 100),
        source: 'REALIZED',
      };
    }

    if (raw.signalCount > 0) {
      return {
        dateKey: raw.dateKey,
        shortLabel: raw.shortLabel,
        wins: 0,
        losses: 0,
        resolvedCount: 0,
        signalCount: raw.signalCount,
        winRatePct: Math.round(raw.convictionSum / raw.signalCount),
        source: 'CONVICTION',
      };
    }

    return {
      dateKey: raw.dateKey,
      shortLabel: raw.shortLabel,
      wins: 0,
      losses: 0,
      resolvedCount: 0,
      signalCount: 0,
      winRatePct: null,
      source: 'NONE',
    };
  });

  const totalResolved = totalWins + totalLosses;
  const activeBuckets = buckets.filter((b) => b.winRatePct !== null);
  const overallWinRatePct =
    totalResolved > 0
      ? Math.round((totalWins / totalResolved) * 100)
      : activeBuckets.length > 0
      ? Math.round(
          activeBuckets.reduce((sum, b) => sum + (b.winRatePct ?? 0), 0) / activeBuckets.length
        )
      : null;

  const deltaPct =
    activeBuckets.length >= 2
      ? (activeBuckets[activeBuckets.length - 1].winRatePct ?? 0) -
        (activeBuckets[0].winRatePct ?? 0)
      : null;

  return {
    buckets,
    overallWinRatePct,
    deltaPct,
    totalWins,
    totalLosses,
    totalResolved,
    totalSignals,
    hasRealizedOutcomes: totalResolved > 0,
  };
}

interface SignalGradeWinRateSparklineProps {
  signals: SparklineSignalSample[];
  trades: ClosedTrade[];
  filter: SignalGradeFilter;
}

export const SignalGradeWinRateSparkline: React.FC<SignalGradeWinRateSparklineProps> = React.memo(
  ({ signals, trades, filter }) => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    const trend = useMemo(
      () => computeSevenDayGradeWinRateTrend(signals, trades, filter),
      [signals, trades, filter]
    );

    const filterLabel =
      filter === 'GRADE_A'
        ? 'Grade A'
        : filter === 'GRADE_B'
        ? 'Grade B'
        : filter === 'GRADE_C'
        ? 'Grade C'
        : 'All Grades';

    // Color palette responsive to grade / trajectory
    const palette = useMemo(() => {
      if (trend.overallWinRatePct === null) {
        return {
          stroke: '#64748b',
          fillTop: 'rgba(100, 116, 139, 0.22)',
          fillBottom: 'rgba(100, 116, 139, 0.0)',
          textClass: 'text-slate-400',
        };
      }
      if (trend.overallWinRatePct >= 60) {
        return {
          stroke: '#34d399',
          fillTop: 'rgba(52, 211, 153, 0.28)',
          fillBottom: 'rgba(52, 211, 153, 0.0)',
          textClass: 'text-emerald-300',
        };
      }
      if (trend.overallWinRatePct >= 45) {
        return {
          stroke: '#fbbf24',
          fillTop: 'rgba(251, 191, 36, 0.24)',
          fillBottom: 'rgba(251, 191, 36, 0.0)',
          textClass: 'text-amber-300',
        };
      }
      return {
        stroke: '#fb7185',
        fillTop: 'rgba(251, 113, 133, 0.24)',
        fillBottom: 'rgba(251, 113, 133, 0.0)',
        textClass: 'text-rose-300',
      };
    }, [trend.overallWinRatePct]);

    const svgWidth = 220;
    const svgHeight = 34;
    const padX = 8;
    const padY = 5;
    const innerW = svgWidth - padX * 2;
    const innerH = svgHeight - padY * 2;
    const stepX = innerW / 6;

    const plottedPoints = useMemo(() => {
      return trend.buckets.map((bucket, idx) => {
        const x = padX + idx * stepX;
        const y =
          bucket.winRatePct !== null
            ? padY + innerH - (Math.max(0, Math.min(100, bucket.winRatePct)) / 100) * innerH
            : null;
        return { ...bucket, idx, x, y };
      });
    }, [trend.buckets, innerH, stepX]);

    const activePoints = useMemo(
      () => plottedPoints.filter((p): p is typeof p & { y: number } => p.y !== null),
      [plottedPoints]
    );

    const polylinePoints = useMemo(() => {
      if (activePoints.length === 0) return '';
      if (activePoints.length === 1) {
        const pt = activePoints[0];
        return `${padX},${pt.y.toFixed(1)} ${(svgWidth - padX).toFixed(1)},${pt.y.toFixed(1)}`;
      }
      return activePoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    }, [activePoints]);

    const areaPath = useMemo(() => {
      if (activePoints.length === 0) return '';
      const baseY = (svgHeight - padY).toFixed(1);
      if (activePoints.length === 1) {
        const y = activePoints[0].y.toFixed(1);
        return `M ${padX} ${baseY} L ${padX} ${y} L ${svgWidth - padX} ${y} L ${svgWidth - padX} ${baseY} Z`;
      }
      const first = activePoints[0];
      const last = activePoints[activePoints.length - 1];
      const lineSegs = activePoints.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      return `M ${first.x.toFixed(1)} ${baseY} ${lineSegs} L ${last.x.toFixed(1)} ${baseY} Z`;
    }, [activePoints]);

    const gradientId = `sig-wr-grad-${filter}`;
    const hoveredBucket = hoveredIndex !== null ? trend.buckets[hoveredIndex] : null;
    const midY = (padY + innerH * 0.5).toFixed(1);

    return (
      <div
        className="px-2 py-1.5 mb-1.5 rounded-lg bg-slate-900/85 border border-slate-800/90"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Metric Summary */}
        <div className="flex items-center justify-between gap-2 text-[10px] mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-bold text-slate-300 truncate">
              {filterLabel} · {trend.hasRealizedOutcomes ? '7D Win Rate' : '7D Signal Trend'}
            </span>
            <span className="text-[9px] font-mono-numbers text-slate-500 shrink-0">
              {trend.totalResolved > 0
                ? `${trend.totalWins}W/${trend.totalLosses}L`
                : trend.totalSignals > 0
                ? `${trend.totalSignals} sig${trend.totalSignals === 1 ? '' : 's'}`
                : '0 samples'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono-numbers tabular-nums shrink-0">
            <span className={`font-extrabold text-[11px] ${palette.textClass}`}>
              {trend.overallWinRatePct !== null ? `${trend.overallWinRatePct}%` : '—'}
            </span>
            {trend.deltaPct !== null && (
              <span
                className={`text-[9px] font-bold px-1 py-0.2 rounded ${
                  trend.deltaPct > 0
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : trend.deltaPct < 0
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {trend.deltaPct > 0 ? `▲+${trend.deltaPct}%` : trend.deltaPct < 0 ? `▼${trend.deltaPct}%` : '0%'}
              </span>
            )}
          </div>
        </div>

        {/* 7-Day SVG Trajectory Sparkline */}
        <div className="relative w-full">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-8 overflow-visible"
            role="img"
            aria-label={`${filterLabel} 7-day win-rate trend sparkline`}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.fillTop} />
                <stop offset="100%" stopColor={palette.fillBottom} />
              </linearGradient>
            </defs>

            {/* 50% baseline reference */}
            <line
              x1={padX}
              y1={midY}
              x2={svgWidth - padX}
              y2={midY}
              stroke="rgba(148, 163, 184, 0.22)"
              strokeWidth="0.9"
              strokeDasharray="2.5 2.5"
            />

            {activePoints.length > 0 ? (
              <>
                <path d={areaPath} fill={`url(#${gradientId})`} />
                <polyline
                  fill="none"
                  stroke={palette.stroke}
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={activePoints.length === 1 ? '3 2.5' : undefined}
                  points={polylinePoints}
                />
                {plottedPoints.map((pt) => {
                  const isHovered = hoveredIndex === pt.idx;
                  const isLatest =
                    activePoints.length > 0 && activePoints[activePoints.length - 1].idx === pt.idx;
                  return (
                    <g
                      key={pt.dateKey}
                      onMouseEnter={() => setHoveredIndex(pt.idx)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className="cursor-pointer"
                    >
                      {/* Invisible hit zone per day */}
                      <rect
                        x={pt.x - stepX / 2}
                        y={0}
                        width={stepX}
                        height={svgHeight}
                        fill="transparent"
                      />
                      {pt.y !== null ? (
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={isHovered ? 3.2 : isLatest ? 2.5 : 1.75}
                          fill={pt.source === 'REALIZED' ? palette.stroke : '#0b1224'}
                          stroke={palette.stroke}
                          strokeWidth={isHovered ? 1.5 : 1.25}
                        >
                          <title>
                            {pt.shortLabel}: {pt.winRatePct}% (
                            {pt.resolvedCount > 0
                              ? `${pt.wins}W/${pt.losses}L`
                              : `${pt.signalCount} signal${pt.signalCount === 1 ? '' : 's'}`}
                            )
                          </title>
                        </circle>
                      ) : (
                        <circle
                          cx={pt.x}
                          cy={Number(midY)}
                          r={isHovered ? 2.1 : 1.1}
                          fill="rgba(100, 116, 139, 0.4)"
                        >
                          <title>{pt.shortLabel}: No matching signals</title>
                        </circle>
                      )}
                    </g>
                  );
                })}
              </>
            ) : (
              <text
                x={svgWidth / 2}
                y={svgHeight / 2 + 3}
                textAnchor="middle"
                fill="#64748b"
                fontSize="8.5"
                fontFamily="JetBrains Mono, monospace"
              >
                No 7-day {filterLabel.toLowerCase()} outcomes yet
              </text>
            )}
          </svg>
        </div>

        {/* Bottom Axis / Hover Inspection Readout */}
        <div className="flex items-center justify-between text-[8.5px] font-mono-numbers text-slate-500 mt-0.5">
          {hoveredBucket ? (
            <>
              <span className="text-cyan-300 font-semibold">{hoveredBucket.shortLabel}</span>
              <span className="text-slate-300 tabular-nums">
                {hoveredBucket.winRatePct !== null
                  ? hoveredBucket.resolvedCount > 0
                    ? `${hoveredBucket.winRatePct}% (${hoveredBucket.wins}W / ${hoveredBucket.losses}L)`
                    : `${hoveredBucket.winRatePct}% est · ${hoveredBucket.signalCount} sig${hoveredBucket.signalCount === 1 ? '' : 's'}`
                  : 'No activity'}
              </span>
            </>
          ) : (
            <>
              <span>{trend.buckets[0]?.shortLabel || '7d ago'}</span>
              <span className="text-slate-600">50% ref</span>
              <span>Today</span>
            </>
          )}
        </div>
      </div>
    );
  }
);
