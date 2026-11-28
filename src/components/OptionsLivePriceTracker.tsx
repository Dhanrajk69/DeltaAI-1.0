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
import { CircularProgress } from './ProfitLadderDashdark';

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
    <div className="panel-delta panel-delta-body border-cyan-500/40 space-y-3 font-sans min-w-0 max-w-full">
      {/* ═══════════════════════════════════════════════════════════
          HEADER: LIVE PRICE & TAKE PROFIT POSITION TRACKER
          ═══════════════════════════════════════════════════════════ */}
      <div className="flex flex-col gap-2.5 border-b border-slate-800/80 pb-3 min-w-0">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 shrink-0">
            <Compass className="h-4 w-4 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-200 leading-snug break-words" title="LIVE PRICE & TAKE PROFIT POSITION TRACKER">
                LIVE PRICE &amp; TAKE PROFIT TRACKER
              </span>
              <span
                className={`badge-delta text-[9.5px] whitespace-normal break-words ${
                  isRangeBound
                    ? 'badge-delta-armed'
                    : isDirectionalBullish
                    ? 'badge-delta-paper'
                    : 'badge-delta-danger'
                }`}
              >
                {isRangeBound
                  ? 'RANGE-BOUND NEUTRAL'
                  : isDirectionalBullish
                  ? 'BULLISH TRAJECTORY'
                  : 'BEARISH TRAJECTORY'}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <span>
                Spot: <strong className="text-white">{currencyPrefix}{formatLadderPrice(safeCurrentSpot)}</strong>
              </span>
              <span>·</span>
              <span className="break-words">
                Strategy: <strong className="text-cyan-400 font-semibold">{strategyName} {executedStrikesBadge}</strong>
              </span>
              <span>·</span>
              <span>
                Outlook: <strong className="text-slate-200">{marketOutlook}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* 2-Column Metric Grid for Live Profit, Active Rung, To Target */}
        <div className="grid grid-cols-2 gap-2 bg-[#070b14] border border-white/10 p-2.5 rounded-xl font-mono-numbers min-w-0">
          <div className="space-y-0.5 min-w-0">
            <div className="text-[10px] text-[#94A3B8] uppercase">Live Profit</div>
            <div
              className="font-extrabold text-xs sm:text-sm truncate transition-colors duration-300"
              style={{ color: activeStep.palette.profitText }}
              title={`${formatProfitCounterUsd(liveProfitUsd, currencyPrefix)} (${formatProfitCounterInr(ladder.liveProfitInr)})`}
            >
              {formatProfitCounterUsd(liveProfitUsd, currencyPrefix)}
            </div>
            <div className="text-[9.5px] text-[#94A3B8] truncate">
              {formatProfitCounterInr(ladder.liveProfitInr)}
            </div>
          </div>

          <div className="space-y-0.5 min-w-0 text-right sm:text-left">
            <div className="text-[10px] text-[#94A3B8] uppercase">Active Rung</div>
            <div className="font-extrabold text-xs sm:text-sm text-[#F8FAFC] truncate">
              {isPositionActive ? `${activeStep.stepLabel} (${activeStep.targetPct}%)` : 'Standby'}
            </div>
            <div className={`text-[9.5px] font-bold truncate ${
              allTargetsAchieved ? 'text-emerald-400' : isPositionActive ? 'text-cyan-300' : 'text-[#94A3B8]'
            }`}>
              {allTargetsAchieved ? '✓ All Targets Hit' : isPositionActive ? `${profitDistancePct}% to Target` : 'Awaiting Fill'}
            </div>
          </div>
        </div>

        {isPositionActive && position.totalFeesAndCashflowsUsd !== undefined && (() => {
          const cfFmt = formatInrFirstPnl(position.totalFeesAndCashflowsUsd, usdInrRate, {
            showPlusSign: true,
            showApproxSymbol: false,
          });
          return (
            <div className="text-[10px] text-[#94A3B8] px-1">
              Cashflows &amp; Fees (incl. GST):{' '}
              <span className={cfFmt.isPositive ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                {cfFmt.usdText} / {cfFmt.inrText}
              </span>
            </div>
          );
        })()}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          VISUAL CONTINUUM LADDER (CORRIDOR & LIVE SPOT POINTER)
          ═══════════════════════════════════════════════════════════ */}
      <div className="space-y-2 min-w-0">
        {/* Compact Grid for Milestone Labels Underneath / Above Track */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 text-[10px] text-slate-400 font-semibold font-mono-numbers px-0.5 text-center">
          <div className="p-1 rounded bg-slate-900/80 border border-slate-800 truncate" title={`Lower BE: ${currencyPrefix}${formatLadderPrice(lowerBreakeven)}`}>
            <div className="text-rose-400 uppercase text-[9px]">Lower BE</div>
            <div className="text-white font-bold">{currencyPrefix}{formatLadderPrice(lowerBreakeven)}</div>
          </div>
          <div className="p-1 rounded bg-slate-900/80 border border-slate-800 truncate hidden sm:block" title={`Entry: ${currencyPrefix}${formatLadderPrice(safeEntrySpot)}`}>
            <div className="text-slate-400 uppercase text-[9px]">Entry</div>
            <div className="text-white font-bold">{currencyPrefix}{formatLadderPrice(safeEntrySpot)}</div>
          </div>
          <div className="p-1 rounded bg-slate-900/80 border border-slate-800 truncate" title={`Sweet Spot: ${currencyPrefix}${formatLadderPrice((minStrike + maxStrike) / 2)}`}>
            <div className="text-cyan-400 uppercase text-[9px]">Sweet Spot</div>
            <div className="text-white font-bold">{currencyPrefix}{formatLadderPrice((minStrike + maxStrike) / 2)}</div>
          </div>
          <div className="p-1 rounded bg-slate-900/80 border border-slate-800 truncate hidden sm:block" title={`Target: ${currencyPrefix}${formatLadderPrice(maxStrike)}`}>
            <div className="text-amber-400 uppercase text-[9px]">Target</div>
            <div className="text-white font-bold">{currencyPrefix}{formatLadderPrice(maxStrike)}</div>
          </div>
          <div className="p-1 rounded bg-slate-900/80 border border-slate-800 truncate" title={`Upper BE: ${currencyPrefix}${formatLadderPrice(upperBreakeven)}`}>
            <div className="text-cyan-400 uppercase text-[9px]">Upper BE</div>
            <div className="text-white font-bold">{currencyPrefix}{formatLadderPrice(upperBreakeven)}</div>
          </div>
        </div>

        {/* Illuminated Continuum Track */}
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[10px] text-slate-400 pt-0.5 font-mono-numbers min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="font-bold shrink-0 transition-colors duration-300"
              style={{ color: activeStep.palette.solid }}
            >
              ● Trajectory:
            </span>
            <span className="text-slate-200 truncate min-w-0" title={locationDescription}>
              {isPositionActive
                ? locationDescription
                : 'Staged Structure (Unfilled)'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 text-[9.5px]">
            <span className="text-slate-400">
              Margins: <strong className="text-slate-200">±{currencyPrefix}{Math.abs(distToLowerBe).toFixed(0)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          OPTIONS LAB PROFIT LADDER (STEP 01 → STEP 04)
          ═══════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1 min-w-0 max-w-full">
        {steps.map((step) => {
          const isHit = step.isAchieved;
          const isLoss = step.isReversing || step.sentiment === 'LOSS';
          const p = step.palette;
          const isCompleted = step.statusBadge === 'COMPLETED';
          const isActive = step.statusBadge === 'ACTIVE';
          const isLocked = step.statusBadge === 'LOCKED / PENDING';

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
              className={`rounded-xl border p-3 transition-all duration-300 font-mono-numbers flex flex-col justify-between gap-2.5 min-w-0 max-w-full ${cardSurfaceClass}`}
            >
              {/* Top Row: Circular Progress Ring + Step 01..04 + Status Badge */}
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 shrink-0 flex items-center justify-center">
                    <div className="scale-75 origin-center">
                      <CircularProgress
                        progress={step.progressPct}
                        displayLabel={step.displayLabel}
                        palette={p}
                        isHit={isCompleted}
                        isActive={isActive}
                        isDormant={isLocked}
                        isReversing={isLoss}
                      />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold uppercase tracking-wide truncate text-[#F8FAFC]">
                      {step.stepLabel}
                    </div>
                    <div className="text-[9.5px] text-[#94A3B8]">
                      {step.targetPct}% Target
                    </div>
                  </div>
                </div>

                {isCompleted ? (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-extrabold uppercase tracking-wider shrink-0 ${
                      isLoss
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                        : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                    }`}
                  >
                    ✓ COMPLETED
                  </span>
                ) : isActive ? (
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-extrabold uppercase tracking-wider shrink-0 ${
                      isLoss
                        ? 'bg-rose-500/20 border-rose-400/60 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.25)] animate-pulse'
                        : 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200 shadow-[0_0_10px_rgba(56,189,248,0.25)] animate-pulse'
                    }`}
                  >
                    <Target className="w-2.5 h-2.5 shrink-0" />
                    <span>ACTIVE</span>
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider shrink-0 bg-white/[0.04] border-white/10 text-slate-400"
                  >
                    LOCKED / PENDING
                  </span>
                )}
              </div>

              {/* Recessed Dark Inner Telemetry Well */}
              <div className="rounded-lg bg-[#070b14] border border-white/10 px-2.5 py-2 space-y-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1 text-[10px]">
                  <span className="text-[#94A3B8] uppercase">Target</span>
                  <span className="font-extrabold tabular-nums text-[#F8FAFC]">
                    {currencyPrefix}{formatLadderPrice(step.targetSpotPrice)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-1 text-[10px]">
                  <span className="text-[#94A3B8]">Opt Prem</span>
                  <span className="font-bold tabular-nums text-[#F8FAFC]">
                    {currencyPrefix}{formatLadderPrice(step.targetOptionPremium)}
                  </span>
                </div>
              </div>

              {/* Recessed Live Profit Telemetry */}
              <div className="rounded-lg bg-[#070b14] border border-white/10 px-2.5 py-2 space-y-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1 text-[10px]">
                  <span className="text-[#94A3B8] uppercase">Step Progress</span>
                  <span className="font-extrabold text-[11px] tabular-nums" style={{ color: isLoss ? '#fb7185' : p.text }}>
                    {step.displayLabel}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-1 text-xs leading-tight">
                  <span className="font-extrabold tabular-nums" style={{ color: p.profitText }}>
                    {formatProfitCounterUsd(step.currentProfitUsd, currencyPrefix)}
                  </span>
                  <span className="font-extrabold tabular-nums text-[#F8FAFC]">
                    +{currencyPrefix}{step.targetUsd.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 text-[9.5px] min-w-0">
                  <span className="tabular-nums font-semibold" style={{ color: p.profitText }}>
                    {formatProfitCounterInr(step.currentProfitInr)}
                  </span>
                  <span className="tabular-nums text-[#94A3B8]">
                    ₹{step.targetInr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>

              {/* Progress Fill Bar */}
              <div className="space-y-1 pt-0.5 border-t border-white/10 min-w-0">
                <div className="w-full bg-[#070b14] h-2 rounded-full border border-white/10 overflow-hidden">
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
                <div className="text-[9px] text-[#94A3B8] truncate" title={step.actionDescription}>
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

