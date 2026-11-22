import React from 'react';
import { CamarillaLevels, VirginCprZone } from '../types';
import { findNearestVirginCprMagnet } from '../utils/camarillaUtils';
import { Target, TrendingDown, TrendingUp, AlertTriangle, Compass } from 'lucide-react';

export interface CamarillaPriceGaugeProps {
  camarilla: CamarillaLevels;
  currentPrice: number;
  direction?: 'LONG' | 'SHORT';
  currencyPrefix?: string;
  timeframe?: string;
  virginCprZones?: VirginCprZone[];
  nearestVirginCpr?: VirginCprZone | null;
}

export const CamarillaPriceGauge: React.FC<CamarillaPriceGaugeProps> = React.memo(({
  camarilla,
  currentPrice,
  direction = 'SHORT',
  currencyPrefix = '$',
  timeframe = '5m',
  virginCprZones,
  nearestVirginCpr,
}) => {
  const { h5, h4, h3, pivot, l3, l4, l5 } = camarilla;
  const h6 = camarilla.h6 || h5 + (h5 - h4);
  const h7 = camarilla.h7 || h6 + (h5 - h4);
  const l6 = camarilla.l6 || l5 - (l4 - l5);
  const l7 = camarilla.l7 || l6 - (l4 - l5);

  const activeVirgin = nearestVirginCpr !== undefined
    ? nearestVirginCpr
    : (camarilla.nearestVirginCpr ?? findNearestVirginCprMagnet(virginCprZones || camarilla.virginCprZones));

  // Auto-Ranging Scale:
  // Dynamically expand right bound to H6/H7 if price exceeds H5
  // Dynamically expand left bound to L6/L7 if price drops below L5
  let maxRange = h5 > 0 ? h5 : currentPrice * 1.015;
  if (currentPrice > h5) {
    maxRange = currentPrice > h6 ? Math.max(h7, currentPrice * 1.002) : Math.max(h6, currentPrice * 1.002);
  }

  let minRange = l5 > 0 ? l5 : currentPrice * 0.985;
  if (currentPrice < l5) {
    minRange = currentPrice < l6 ? Math.min(l7, currentPrice * 0.998) : Math.min(l6, currentPrice * 0.998);
  }

  const totalSpan = Math.max(0.0001, maxRange - minRange);

  const getPositionPercent = (price: number) => {
    return Math.min(100, Math.max(0, ((price - minRange) / totalSpan) * 100));
  };

  // Cursor position calibrated smoothly between minRange and maxRange
  const rawCursorPercent = ((currentPrice - minRange) / totalSpan) * 100;
  const cursorPercent = Math.min(100, Math.max(0, rawCursorPercent));
  const cursorPinPercent = Math.min(97.5, Math.max(2.5, cursorPercent));

  const l5Percent = getPositionPercent(l5);
  const l4Percent = getPositionPercent(l4);
  const l3Percent = getPositionPercent(l3);
  const pivotPercent = getPositionPercent(pivot);
  const h3Percent = getPositionPercent(h3);
  const h4Percent = getPositionPercent(h4);
  const h5Percent = getPositionPercent(h5);

  // Breakout Depth Diagnostics
  const isShortBreakdown = currentPrice < l4;
  const isLongBreakout = currentPrice > h4;
  const isChopZone = currentPrice >= l3 && currentPrice <= h3;

  const shortBreakdownDepth = Math.max(0, l4 - currentPrice);
  const shortBreakdownPct = l4 > 0 ? (shortBreakdownDepth / l4) * 100 : 0;

  const longBreakoutDepth = Math.max(0, currentPrice - h4);
  const longBreakoutPct = h4 > 0 ? (longBreakoutDepth / h4) * 100 : 0;

  const fmt = (p: number) =>
    p.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: p > 10 ? 2 : 4,
    });

  const sessionLabel = (timeframe || '').toLowerCase() === '1h'
    ? 'WEEKLY PIVOTS · 1H'
    : `DAILY SESSION · ${(timeframe || '5M').toUpperCase()}`;

  // Collision detection between adjacent markers
  const isL3L4Close = Math.abs(l3Percent - l4Percent) < 7.5;
  const isH3H4Close = Math.abs(h3Percent - h4Percent) < 7.5;
  const isPivotL3Close = Math.abs(pivotPercent - l3Percent) < 7.5;
  const isPivotH3Close = Math.abs(pivotPercent - h3Percent) < 7.5;

  const virginTrackOverlay = activeVirgin && activeVirgin.cprHigh >= minRange && activeVirgin.cprLow <= maxRange
    ? {
        leftPct: getPositionPercent(activeVirgin.cprLow),
        widthPct: Math.max(1.5, getPositionPercent(activeVirgin.cprHigh) - getPositionPercent(activeVirgin.cprLow)),
      }
    : null;

  return (
    <div className="panel-delta w-full p-3 font-mono-numbers relative overflow-hidden select-none backdrop-blur-md">
      {/* Top hairline accent */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/25 to-transparent pointer-events-none" />

      {/* Top Bar: Title, Session Badge, Central Pivot Header Badge, & Live Breakout Depth Diagnostics */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
          <span className="panel-delta-title text-white">
            Camarilla Breakout &amp; Price-Position Gauge
          </span>
          <span className="badge-delta badge-delta-armed">
            {sessionLabel}
          </span>
          <span className="badge-delta badge-delta-standby">
            Central Pivot: <strong className="text-white font-semibold">{currencyPrefix}{fmt(pivot)}</strong>
          </span>
          {activeVirgin ? (
            <span
              className="badge-delta bg-purple-500/15 border-purple-500/40 text-purple-200 tabular-nums"
              title={`Unmitigated ${activeVirgin.ageSessions}D Virgin CPR (${activeVirgin.sessionDateUtc}) acting as ${
                activeVirgin.relation === 'ABOVE'
                  ? 'Overhead Resistance'
                  : activeVirgin.relation === 'BELOW'
                  ? 'Downside Support'
                  : 'Active Price Zone'
              }`}
            >
              <Compass className="w-3 h-3 text-purple-400 shrink-0" />
              <span>
                VIRGIN CPR: {currencyPrefix}{fmt(activeVirgin.cprLow)} – {currencyPrefix}{fmt(activeVirgin.cprHigh)} ({activeVirgin.distancePct.toFixed(2)}% ·{' '}
                {activeVirgin.relation === 'ABOVE'
                  ? 'RES'
                  : activeVirgin.relation === 'BELOW'
                  ? 'SUP'
                  : 'IN'}
                )
              </span>
            </span>
          ) : (
            <span className="badge-delta badge-delta-standby">
              VIRGIN CPR: NONE ACTIVE (3D)
            </span>
          )}
        </div>

        {/* Dynamic Breakout Depth Indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {isShortBreakdown ? (
            <span className="badge-delta badge-delta-danger">
              <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span>
                L4 BREAKDOWN: -{currencyPrefix}{fmt(shortBreakdownDepth)} (-{shortBreakdownPct.toFixed(2)}%)
              </span>
            </span>
          ) : isLongBreakout ? (
            <span className="badge-delta badge-delta-live">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                H4 BREAKOUT: +{currencyPrefix}{fmt(longBreakoutDepth)} (+{longBreakoutPct.toFixed(2)}%)
              </span>
            </span>
          ) : isChopZone ? (
            <span className="badge-delta badge-delta-paper">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>RANGE ROTATION: Centered (L3–H3)</span>
            </span>
          ) : (
            <span className="badge-delta badge-delta-armed">
              <Target className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>APPROACHING BREAKOUT ZONE</span>
            </span>
          )}
        </div>
      </div>

      {/* Interactive Horizontal Price-Position Gauge Track */}
      <div className="relative pt-7 pb-9 px-1">
        {/* Background Track with Color-Coded Structural Zones (L5 to H5) */}
        <div className="h-2 w-full bg-[#07090E] rounded-full relative border border-slate-800/80 overflow-hidden shadow-inner">
          {/* Bearish Breakdown Zone (L5 to L4) */}
          <div
            className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-rose-700/60 via-rose-600/40 to-rose-500/30"
            style={{ width: `${l4Percent}%` }}
            title="L4 Breakdown & Expansion Zone"
          />
          {/* Consolidation / Structural Chop Corridor (L3 to H3) */}
          <div
            className="absolute top-0 bottom-0 bg-gradient-to-r from-amber-500/15 via-cyan-500/10 to-amber-500/15"
            style={{ left: `${l3Percent}%`, width: `${Math.max(0, h3Percent - l3Percent)}%` }}
            title="L3-H3 Consolidation Corridor"
          />
          {/* Bullish Breakout Zone (H4 to H5) */}
          <div
            className="absolute top-0 bottom-0 right-0 bg-gradient-to-r from-emerald-500/30 via-emerald-600/40 to-emerald-700/60"
            style={{ left: `${h4Percent}%`, width: `${Math.max(0, 100 - h4Percent)}%` }}
            title="H4 Bullish Breakout & Expansion Zone"
          />
          {/* Virgin CPR Magnetic Zone Overlay */}
          {virginTrackOverlay && (
            <div
              className="absolute top-0 bottom-0 bg-purple-500/65 border-x border-purple-300/80 z-[5]"
              style={{ left: `${virginTrackOverlay.leftPct}%`, width: `${virginTrackOverlay.widthPct}%` }}
              title={`Virgin CPR Zone: ${currencyPrefix}${fmt(activeVirgin!.cprLow)} – ${currencyPrefix}${fmt(activeVirgin!.cprHigh)}`}
            />
          )}
          {/* Central Pivot Hash Line */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-cyan-400/90 shadow-[0_0_6px_rgba(6,182,212,0.8)] z-10"
            style={{ left: `${pivotPercent}%` }}
            title={`Central Pivot: ${currencyPrefix}${fmt(pivot)}`}
          />
        </div>

        {/* Central Pivot Top Marker (Staggered ABOVE the Track with dedicated vertical line) */}
        <div
          className="absolute -top-5 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10"
          style={{ left: `${pivotPercent}%` }}
        >
          <span className="text-[8.5px] font-bold text-cyan-300 bg-[#131922] border border-cyan-500/50 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
            P ${fmt(pivot)}
          </span>
          <div className="w-[1px] h-2.5 bg-cyan-400/70" />
        </div>

        {/* Key Level Markers Along the Track (BOTTOM Dedicated to Camarilla Ladder) */}
        {/* L5 (Far Left Anchor 0%) */}
        <div className="absolute top-2 left-0 flex flex-col items-start pointer-events-none z-0">
          <div className="w-[1.5px] h-3 bg-amber-500/70" />
          <span className="text-[9px] font-medium text-amber-400/90 mt-1.5 whitespace-nowrap bg-[#131922] px-1.5 py-0.5 rounded border border-amber-500/30">
            L5 ${fmt(l5)}
          </span>
        </div>

        {/* L4 (Breakdown Level) */}
        <div
          className="absolute top-2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10"
          style={{ left: `${l4Percent}%` }}
        >
          <div className="w-[1.5px] h-3 bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
          <span className="text-[9.5px] font-bold text-rose-300 mt-1.5 whitespace-nowrap bg-[#131922] px-1.5 py-0.5 rounded border border-rose-500/40">
            L4 ${fmt(l4)}
          </span>
        </div>

        {/* L3 (Reversal Floor / SL Level - Staggered if Close to L4) */}
        <div
          className="absolute top-2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-0"
          style={{ left: `${l3Percent}%` }}
        >
          <div className={`w-[1px] ${isL3L4Close ? 'h-6 bg-cyan-400/50' : 'h-3 bg-cyan-400/70'}`} />
          <span className={`text-[9px] font-medium text-cyan-300 whitespace-nowrap bg-[#131922] px-1.5 py-0.5 rounded border border-cyan-500/30 ${
            isL3L4Close ? 'mt-0' : 'mt-1.5'
          }`}>
            L3 ${fmt(l3)}
          </span>
        </div>

        {/* H3 (Reversal Ceiling / SL Level - Staggered if Close to H4) */}
        <div
          className="absolute top-2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-0"
          style={{ left: `${h3Percent}%` }}
        >
          <div className={`w-[1px] ${isH3H4Close ? 'h-6 bg-cyan-400/50' : 'h-3 bg-cyan-400/70'}`} />
          <span className={`text-[9px] font-medium text-cyan-300 whitespace-nowrap bg-[#131922] px-1.5 py-0.5 rounded border border-cyan-500/30 ${
            isH3H4Close ? 'mt-0' : 'mt-1.5'
          }`}>
            H3 ${fmt(h3)}
          </span>
        </div>

        {/* H4 (Breakout Level) */}
        <div
          className="absolute top-2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10"
          style={{ left: `${h4Percent}%` }}
        >
          <div className="w-[1.5px] h-3 bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
          <span className="text-[9.5px] font-bold text-emerald-300 mt-1.5 whitespace-nowrap bg-[#131922] px-1.5 py-0.5 rounded border border-emerald-500/40">
            H4 ${fmt(h4)}
          </span>
        </div>

        {/* H5 (Far Right Anchor 100%) */}
        <div className="absolute top-2 right-0 flex flex-col items-end pointer-events-none z-0">
          <div className="w-[1.5px] h-3 bg-amber-500/70" />
          <span className="text-[9px] font-medium text-amber-400/90 mt-1.5 whitespace-nowrap bg-[#131922] px-1.5 py-0.5 rounded border border-amber-500/30">
            H5 ${fmt(h5)}
          </span>
        </div>

        {/* Live Current Price Cursor with Glowing Pulse Pin & Fluid CSS Transition */}
        <div
          className="absolute -top-1.5 -translate-x-1/2 z-30 flex flex-col items-center transition-all duration-300 ease-out"
          style={{ left: `${cursorPinPercent}%` }}
        >
          {/* Top Floating Badge */}
          <div className="px-2 py-0.5 rounded text-[10px] font-black tracking-tight bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 shadow-[0_0_14px_rgba(6,182,212,0.6)] whitespace-nowrap flex items-center gap-1.5 border border-white/40 mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-ping" />
            <span>LIVE: {currencyPrefix}{fmt(currentPrice)}</span>
          </div>
          {/* Cursor Pointer Pin */}
          <div className="w-3.5 h-3.5 rounded-full bg-cyan-400 border-2 border-white shadow-[0_0_12px_#22d3ee] flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />
          </div>
          <div className="w-[2px] h-5 bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
        </div>
      </div>
    </div>
  );
});

export const CamarillaBreakoutGauge = CamarillaPriceGauge;
export default CamarillaPriceGauge;
