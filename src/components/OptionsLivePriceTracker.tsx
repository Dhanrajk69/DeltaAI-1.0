import React, { useMemo } from 'react';
import { OptionStrategyPosition } from '../types';
import { formatInrFirstPnl } from '../utils/marketUtils';
import {
  buildOptionsProfitLadder,
  formatLadderPrice,
  formatProfitCounterUsd,
  formatProfitCounterInr,
} from '../utils/optionsProfitLadder';
import {
  Compass,
  MapPin,
  Target,
} from 'lucide-react';

interface OptionsLivePriceTrackerProps {
  position: OptionStrategyPosition;
  currentSpot: number;
  currencyPrefix?: string;
  usdInrRate?: number;
  isPositionActive?: boolean;
}

export const OptionsLivePriceTracker: React.FC<OptionsLivePriceTrackerProps> = ({
  position,
  currentSpot,
  currencyPrefix = '$',
  usdInrRate = 85.0,
  isPositionActive = false,
}) => {
  const {
    strategyName,
    legs,
    marketOutlook,
  } = position;

  const ladder = useMemo(
    () => buildOptionsProfitLadder(position, currentSpot, usdInrRate, isPositionActive),
    [position, currentSpot, usdInrRate, isPositionActive]
  );

  const {
    steps,
    activeStepIndex,
    liveProfitUsd,
    overallSentiment,
    isDirectionalBullish,
    isRangeBound,
    safeEntrySpot,
    safeCurrentSpot,
    lowerBreakeven,
    upperBreakeven,
    minStrike,
    maxStrike,
  } = ladder;

  const executedStrikesBadge =
    legs.length > 0
      ? `(${legs.map((l) => `${currencyPrefix}${Number(l.strike || 0).toLocaleString()}${l.type === 'PUT' ? 'P' : 'C'}`).join(' / ')})`
      : '';

  const activeStep = steps[activeStepIndex - 1] || steps[0];

  // Distances to active target
  const profitDistanceUsd = +(Math.max(0, activeStep.targetUsd - liveProfitUsd)).toFixed(2);
  const profitDistancePct = Math.max(0, 100 - activeStep.progressPct);

  // Distance to breakevens
  const distToLowerBe = +(safeCurrentSpot - lowerBreakeven).toFixed(2);
  const distToLowerBePct = safeCurrentSpot > 0 ? +((distToLowerBe / safeCurrentSpot) * 100).toFixed(2) : 0;
  const distToUpperBe = +(upperBreakeven - safeCurrentSpot).toFixed(2);
  const distToUpperBePct = safeCurrentSpot > 0 ? +((distToUpperBe / safeCurrentSpot) * 100).toFixed(2) : 0;

  // Current Location Zone
  let locationDescription = 'Underlying trading within ideal profit parameters';
  if (isRangeBound) {
    if (safeCurrentSpot < lowerBreakeven) {
      locationDescription = 'Spot breached lower defense level - rolling or delta hedge required';
    } else if (safeCurrentSpot > upperBreakeven) {
      locationDescription = 'Spot breached upper defense level - rolling or delta hedge required';
    } else if (safeCurrentSpot >= minStrike && safeCurrentSpot <= maxStrike) {
      locationDescription = 'Spot directly centered in maximum theta decay harvest corridor';
    } else {
      locationDescription = 'Spot in outer wing buffer zone between inner strike and breakeven';
    }
  } else if (isDirectionalBullish) {
    if (safeCurrentSpot > maxStrike) {
      locationDescription = 'Underlying broke above upper target strike into deep profit';
    } else if (safeCurrentSpot < lowerBreakeven) {
      locationDescription = 'Underlying retreated below lower breakeven support';
    } else {
      locationDescription = 'Underlying advancing upwards towards target strike';
    }
  } else {
    if (safeCurrentSpot < minStrike) {
      locationDescription = 'Underlying dropped below lower target strike into deep profit';
    } else if (safeCurrentSpot > upperBreakeven) {
      locationDescription = 'Underlying expanded above upper breakeven defense';
    } else {
      locationDescription = 'Underlying declining downwards towards target strike';
    }
  }

  // Trajectory Progress Percentage for Visual Continuum Bar (0 to 100)
  let continuumPct = 50;
  if (isRangeBound) {
    const totalCorridor = upperBreakeven - lowerBreakeven;
    if (totalCorridor > 0) {
      continuumPct = Math.min(100, Math.max(0, Math.round(((safeCurrentSpot - lowerBreakeven) / totalCorridor) * 100)));
    }
  } else if (isDirectionalBullish) {
    const totalCorridor = maxStrike - lowerBreakeven;
    if (totalCorridor > 0) {
      continuumPct = Math.min(100, Math.max(0, Math.round(((safeCurrentSpot - lowerBreakeven) / totalCorridor) * 100)));
    }
  } else {
    const totalCorridor = upperBreakeven - minStrike;
    if (totalCorridor > 0) {
      continuumPct = Math.min(100, Math.max(0, Math.round(((upperBreakeven - safeCurrentSpot) / totalCorridor) * 100)));
    }
  }

  const allTargetsAchieved = steps.every((s) => s.isAchieved);

  return (
    <div className="panel-delta panel-delta-body border-cyan-500/40 space-y-4 font-sans min-w-0 max-w-full">
      {/* ═══════════════════════════════════════════════════════════
          HEADER: LIVE PRICE & TAKE PROFIT POSITION TRACKER
          ═══════════════════════════════════════════════════════════ */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 border-b border-slate-800/80 pb-3 min-w-0">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 shrink-0">
            <Compass className="h-5 w-5 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200 leading-snug" title="LIVE PRICE & TAKE PROFIT POSITION TRACKER">
                LIVE PRICE &amp; TAKE PROFIT POSITION TRACKER
              </span>
              <span
                className={`badge-delta whitespace-normal break-words ${
                  isRangeBound
                    ? 'badge-delta-armed'
                    : isDirectionalBullish
                    ? 'badge-delta-paper'
                    : 'badge-delta-danger'
                }`}
              >
                {isRangeBound
                  ? 'RANGE-BOUND DELTA NEUTRAL (PROFIT CORRIDOR)'
                  : isDirectionalBullish
                  ? 'BULLISH TRAJECTORY (ASCENDING TARGETS)'
                  : 'BEARISH TRAJECTORY (DESCENDING TARGETS)'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <span>
                Live Spot:{' '}
                <strong className="text-white text-xs">
                  {currencyPrefix}
                  {formatLadderPrice(safeCurrentSpot)}
                </strong>
              </span>
              <span>·</span>
              <span className="break-words">
                Strategy:{' '}
                <strong className="text-cyan-400 font-semibold">
                  {strategyName} {executedStrikesBadge}
                </strong>
              </span>
              <span>·</span>
              <span>
                Outlook: <strong className="text-slate-200">{marketOutlook}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Active Target In-Play & Live Exchange UPNL Strip */}
        <div className="flex flex-col items-start sm:items-end gap-1 bg-[#070b14] border border-white/10 px-3 py-1.5 rounded-lg font-mono-numbers min-w-0 max-w-full">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
            <span className="text-[11px] text-[#94A3B8]">Live Profit:</span>
            <span
              className="font-extrabold text-xs transition-colors duration-300"
              style={{ color: activeStep.palette.profitText }}
            >
              {formatProfitCounterUsd(liveProfitUsd, currencyPrefix)} ({formatProfitCounterInr(ladder.liveProfitInr)})
            </span>
            <span className="text-white/15">|</span>
            <span className="text-[11px] text-[#94A3B8]">Active Rung:</span>
            <span className="font-extrabold text-xs text-[#F8FAFC]">
              {isPositionActive ? `${activeStep.stepLabel} (${activeStep.targetPct}%)` : 'Standby'}
            </span>
            <span className="text-white/15">|</span>
            <span className="text-[#94A3B8] text-[11px]">To Target:</span>
            <span
              className={`font-bold text-xs ${
                allTargetsAchieved
                  ? 'text-emerald-400'
                  : isPositionActive
                  ? 'text-[#F8FAFC]'
                  : 'text-[#94A3B8]'
              }`}
            >
              {allTargetsAchieved
                ? '✓ All Targets Hit'
                : isPositionActive
                ? `${formatProfitCounterUsd(profitDistanceUsd, currencyPrefix)} (${profitDistancePct}% left)`
                : 'Awaiting Fill'}
            </span>
          </div>
          {isPositionActive && position.totalFeesAndCashflowsUsd !== undefined && (() => {
            const cfFmt = formatInrFirstPnl(position.totalFeesAndCashflowsUsd, usdInrRate, {
              showPlusSign: true,
              showApproxSymbol: false,
            });
            return (
              <div className="text-[10px] text-[#94A3B8]">
                Cashflows &amp; Fees (incl. GST):{' '}
                <span className={cfFmt.isPositive ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                  {cfFmt.usdText} / {cfFmt.inrText}
                </span>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          VISUAL CONTINUUM LADDER (CORRIDOR & LIVE SPOT POINTER)
          ═══════════════════════════════════════════════════════════ */}
      <div className="space-y-2 min-w-0">
        {/* Milestone Labels Above Track */}
        <div className="flex flex-wrap justify-between items-center gap-1.5 text-[11px] text-slate-400 font-semibold px-1 font-mono-numbers">
          <span className="flex items-center gap-1 text-rose-400">
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            <span>Lower BE: {currencyPrefix}{formatLadderPrice(lowerBreakeven)}</span>
          </span>

          <span className="text-slate-300 hidden sm:inline-block">
            {isRangeBound
              ? `Inner Strike: ${currencyPrefix}${formatLadderPrice(minStrike)}`
              : `Entry: ${currencyPrefix}${formatLadderPrice(safeEntrySpot)}`}
          </span>

          <span
            className="flex items-center gap-1 font-bold transition-colors duration-300"
            style={{ color: ladder.overallPalette.text }}
          >
            <MapPin className="w-3 h-3 shrink-0" style={{ color: ladder.overallPalette.solid }} />
            <span>Sweet Spot: {currencyPrefix}{formatLadderPrice((minStrike + maxStrike) / 2)}</span>
          </span>

          <span className="text-slate-300 hidden sm:inline-block">
            {isRangeBound
              ? `Upper Strike: ${currencyPrefix}${formatLadderPrice(maxStrike)}`
              : `Target: ${currencyPrefix}${formatLadderPrice(maxStrike)}`}
          </span>

          <span className="flex items-center gap-1 text-cyan-400">
            <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
            <span>Upper BE: {currencyPrefix}{formatLadderPrice(upperBreakeven)}</span>
          </span>
        </div>

        {/* Illuminated Continuum Track (Electric Cyan -> Vibrant Teal -> Neon Mint OR Cool Indigo -> Warm Rose -> Deep Crimson) */}
        <div className="relative w-full bg-[#070b14] h-3 rounded-full border border-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: isPositionActive
                ? overallSentiment === 'LOSS'
                  ? `${Math.min(100, Math.max(8, ladder.overallDrawdownPct))}%`
                  : `${Math.min(Math.max(continuumPct, 5), 100)}%`
                : '0%',
              background:
                overallSentiment === 'LOSS'
                  ? ladder.overallPalette.barGradient
                  : activeStep.palette.barGradient,
              boxShadow: isPositionActive
                ? `0 0 10px ${
                    overallSentiment === 'LOSS'
                      ? ladder.overallPalette.solid
                      : activeStep.palette.solid
                  }`
                : 'none',
            }}
          />
        </div>

        {/* Position Context Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-0.5 font-mono-numbers min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="font-bold shrink-0 transition-colors duration-300"
              style={{ color: activeStep.palette.solid }}
            >
              ● Trajectory Status:
            </span>
            <span className="text-slate-200 break-words min-w-0">
              {isPositionActive
                ? locationDescription
                : 'Staged Structure (Unfilled) — Live Profit starts at $0.00 upon execution'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-slate-400">
              Lower Margin:{' '}
              <strong className="text-slate-200">
                {distToLowerBe >= 0 ? '+' : '-'}
                {currencyPrefix}
                {Math.abs(distToLowerBe).toFixed(2)} ({distToLowerBePct}%)
              </strong>
            </span>
            <span>·</span>
            <span className="text-slate-400">
              Upper Margin:{' '}
              <strong className="text-slate-200">
                {distToUpperBe >= 0 ? '+' : '-'}
                {currencyPrefix}
                {Math.abs(distToUpperBe).toFixed(2)} ({distToUpperBePct}%)
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          OPTIONS LAB PROFIT LADDER (STEP 01 → STEP 04)
          Obsidian & Electric Cyan -> Teal -> Neon Mint Institutional Palette
          ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1 min-w-0 max-w-full">
        {steps.map((step) => {
          const isHit = step.isAchieved;
          const isLoss = step.sentiment === 'LOSS';
          const p = step.palette;
          const fillWidthPct = isLoss
            ? Math.min(100, Math.max(8, step.drawdownPct))
            : step.progressPct;

          const cardSurfaceClass = isHit
            ? 'bg-[#081c18] border-emerald-500/40 shadow-[0_0_18px_rgba(16,185,129,0.12)]'
            : step.isCurrentActive
            ? 'bg-[#0c1220] border-cyan-400/50 shadow-[0_0_20px_rgba(56,189,248,0.12)]'
            : 'bg-[#0c1220] border-white/10';

          return (
            <div
              key={step.stepNumber}
              className={`rounded-xl border p-3 transition-all duration-300 font-mono-numbers flex flex-col justify-between gap-2.5 min-w-0 max-w-full ${cardSurfaceClass}`}
            >
              {/* Top Row: Step 01..04 + Status Pill (Gradient Telemetry Strictly on Pill) */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 transition-colors duration-300 ${
                      step.isCurrentActive && !isHit ? 'animate-pulse' : ''
                    }`}
                    style={{ backgroundColor: p.solid }}
                  />
                  <span
                    className="text-xs font-extrabold uppercase tracking-wide truncate text-[#F8FAFC]"
                    title={`${step.stepLabel} · ${step.shortTitle}`}
                  >
                    {step.stepLabel}
                  </span>
                  <span className="text-[10px] text-[#94A3B8] font-semibold shrink-0">
                    ({step.targetPct}%)
                  </span>
                </div>

                {isHit ? (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9.5px] font-extrabold uppercase tracking-wider shrink-0 transition-colors duration-300"
                    style={{
                      backgroundColor: p.badgeBg,
                      borderColor: p.badgeBorder,
                      color: p.text,
                    }}
                  >
                    ✓ ACHIEVED
                  </span>
                ) : isLoss ? (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9.5px] font-extrabold uppercase tracking-wider shrink-0 transition-colors duration-300"
                    style={{
                      backgroundColor: p.badgeBg,
                      borderColor: p.badgeBorder,
                      color: p.text,
                    }}
                  >
                    DD · -{step.drawdownPct}%
                  </span>
                ) : step.isCurrentActive ? (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9.5px] font-extrabold uppercase tracking-wider shrink-0 transition-colors duration-300"
                    style={{
                      backgroundColor: p.badgeBg,
                      borderColor: p.badgeBorder,
                      color: p.text,
                    }}
                  >
                    <Target className="w-3 h-3 shrink-0" />
                    <span>ACTIVE · {step.progressPct}%</span>
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9.5px] font-bold uppercase tracking-wider shrink-0 transition-colors duration-300"
                    style={{
                      backgroundColor: p.badgeBg,
                      borderColor: p.badgeBorder,
                      color: p.text,
                    }}
                  >
                    PENDING · {step.progressPct}%
                  </span>
                )}
              </div>

              {/* Recessed Dark Inner Telemetry Well: Target Price (#F8FAFC) & Option Premium */}
              <div className="rounded-lg bg-[#070b14] border border-white/10 px-2.5 py-2 space-y-1 min-w-0 max-w-full">
                <div className="flex flex-wrap items-baseline justify-between gap-1 min-w-0">
                  <span className="text-[10px] uppercase tracking-wider text-[#94A3B8] font-semibold">
                    TARGET
                  </span>
                  <span
                    className="text-xs sm:text-[13px] font-extrabold tabular-nums text-[#F8FAFC]"
                    title={`${step.targetSpotLabel}: ${currencyPrefix}${formatLadderPrice(step.targetSpotPrice)}`}
                  >
                    {currencyPrefix}
                    {formatLadderPrice(step.targetSpotPrice)}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-1 text-[10px] min-w-0">
                  <span className="text-[#94A3B8]">
                    Opt Prem ({step.premiumDirection === 'DECAY' ? '↓' : '↑'})
                  </span>
                  <span className="font-bold tabular-nums text-[#F8FAFC]">
                    {currencyPrefix}
                    {formatLadderPrice(step.targetOptionPremium)}
                  </span>
                </div>
              </div>

              {/* Recessed Live Profit Telemetry: Gradient Accent Strictly on Live PnL & Progress % */}
              <div className="rounded-lg bg-[#070b14] border border-white/10 px-2.5 py-2 space-y-1 min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-1 text-[10px] min-w-0">
                  <span className="text-[#94A3B8] uppercase font-semibold tracking-wider">Live Profit</span>
                  <span
                    className="font-extrabold text-[11px] tabular-nums transition-colors duration-300"
                    style={{ color: p.text }}
                  >
                    {isLoss ? `-${step.drawdownPct}%` : `${step.progressPct}%`}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-1 min-w-0 text-xs leading-tight">
                  <span
                    className="font-extrabold tabular-nums transition-colors duration-300"
                    style={{ color: p.profitText }}
                  >
                    {formatProfitCounterUsd(step.currentProfitUsd, currencyPrefix)}
                  </span>
                  <span className="text-[#94A3B8]/60 text-[10px]">→</span>
                  <span className="font-extrabold tabular-nums text-[#F8FAFC]">
                    +{currencyPrefix}
                    {step.targetUsd.toFixed(2)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] min-w-0">
                  <span
                    className="tabular-nums font-semibold transition-colors duration-300"
                    style={{ color: p.profitText }}
                  >
                    {formatProfitCounterInr(step.currentProfitInr)}
                  </span>
                  <span className="tabular-nums text-[#94A3B8]">
                    Goal: ₹{step.targetInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>

              {/* Progress Fill Bar (Electric Cyan -> Vibrant Teal -> Neon Mint OR Cool Indigo -> Warm Rose -> Deep Crimson) */}
              <div className="space-y-1.5 pt-1 border-t border-white/10 min-w-0">
                <div className="w-full bg-[#070b14] h-2 rounded-full border border-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${fillWidthPct}%`,
                      background: p.barGradient,
                      boxShadow: fillWidthPct > 0 ? `0 0 8px ${p.solid}` : 'none',
                    }}
                  />
                </div>
                <div
                  className="text-[9.5px] text-[#94A3B8] truncate"
                  title={step.actionDescription}
                >
                  {step.actionDescription}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

