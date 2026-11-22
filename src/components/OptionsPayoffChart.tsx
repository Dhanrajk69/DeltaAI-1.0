import React, { useState, useMemo } from 'react';
import { OptionLeg, OptionStrategyName } from '../types';
import { formatInrFirstPnl } from '../utils/marketUtils';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  ShieldAlert, 
  Sliders, 
  Maximize2, 
  Eye, 
  Compass,
  Zap,
  Info
} from 'lucide-react';

interface OptionsPayoffChartProps {
  strategyName: OptionStrategyName;
  legs: OptionLeg[];
  currentSpot: number;
  entrySpot?: number;
  unrealisedPnl?: number;
  currentProfitPercent?: number;
  currencyPrefix?: string;
  usdInrRate?: number;
  isPositionActive?: boolean;
}

interface PayoffPoint {
  spot: number;
  expiryPnl: number;
  t0Pnl: number;
}

export const OptionsPayoffChart: React.FC<OptionsPayoffChartProps> = React.memo(({
  strategyName,
  legs,
  currentSpot,
  entrySpot = currentSpot,
  unrealisedPnl = 0,
  currentProfitPercent = 0,
  currencyPrefix = '$',
  usdInrRate = 85.0,
  isPositionActive = false,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<PayoffPoint | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [showT0Curve, setShowT0Curve] = useState<boolean>(true);
  const [showStrikes, setShowStrikes] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<'NORMAL' | 'WIDE'>('NORMAL');

  // Compute strikes, range, and payoff curves
  const {
    points,
    minSpot,
    maxSpot,
    minPnl,
    maxPnl,
    maxProfitUsd,
    maxLossUsd,
    breakevens,
    strikes,
    isNetCredit,
    netPremium,
    currentSpotExpiryPnl,
    currentSpotT0Pnl,
  } = useMemo(() => {
    if (!legs || legs.length === 0) {
      return {
        points: [],
        minSpot: currentSpot * 0.85,
        maxSpot: currentSpot * 1.15,
        minPnl: -500,
        maxPnl: 500,
        maxProfitUsd: 0,
        maxLossUsd: 0,
        breakevens: [],
        strikes: [],
        isNetCredit: false,
        netPremium: 0,
        currentSpotExpiryPnl: 0,
        currentSpotT0Pnl: 0,
      };
    }

    const legStrikes = legs.map((l) => l.strike);
    const minStrike = Math.min(...legStrikes);
    const maxStrike = Math.max(...legStrikes);

    const rangePct = zoomLevel === 'WIDE' ? 0.18 : 0.12;
    const centerSpot = entrySpot || currentSpot;
    const lowerBound = Math.min(minStrike * 0.95, centerSpot * (1 - rangePct));
    const upperBound = Math.max(maxStrike * 1.05, centerSpot * (1 + rangePct));

    const totalSteps = 160;
    const stepSize = (upperBound - lowerBound) / totalSteps;

    // Calculate net premium collected or paid
    let netPrem = 0;
    legs.forEach((leg) => {
      const legNet = leg.premiumEntry * leg.contracts;
      if (leg.action === 'SELL') {
        netPrem += legNet;
      } else {
        netPrem -= legNet;
      }
    });

    // Helper: compute at-expiry payoff for any price S
    const calcExpiryPnl = (s: number): number => {
      let total = 0;

      // Special cases for Covered Call / Covered Put
      if (strategyName === 'Covered Call') {
        // Long underlying + Short Call
        const contracts = legs[0]?.contracts || 0.25;
        const stockPnl = (s - centerSpot) * contracts;
        total += stockPnl;
      } else if (strategyName === 'Covered Put') {
        // Short underlying + Short Put
        const contracts = legs[0]?.contracts || 0.25;
        const stockPnl = (centerSpot - s) * contracts;
        total += stockPnl;
      }

      legs.forEach((leg) => {
        let intrinsic = 0;
        if (leg.type === 'CALL') {
          intrinsic = Math.max(0, s - leg.strike);
        } else {
          intrinsic = Math.max(0, leg.strike - s);
        }

        if (leg.action === 'BUY') {
          total += (intrinsic - leg.premiumEntry) * leg.contracts;
        } else {
          total += (leg.premiumEntry - intrinsic) * leg.contracts;
        }
      });

      return +total.toFixed(2);
    };

    // Helper: compute estimated T+0 curve with remaining time value
    const calcT0Pnl = (s: number, expiryPnl: number): number => {
      let extrinsicSum = 0;
      legs.forEach((leg) => {
        const dteRatio = Math.sqrt(Math.max(1, leg.dte) / 7);
        const distance = Math.abs(s - leg.strike);
        const atmBand = leg.strike * 0.04;
        const bellFactor = Math.exp(-0.5 * Math.pow(distance / atmBand, 2));
        const legExtrinsic = leg.premiumEntry * 0.45 * dteRatio * bellFactor * leg.contracts;

        if (leg.action === 'BUY') {
          extrinsicSum += legExtrinsic;
        } else {
          extrinsicSum -= legExtrinsic;
        }
      });

      return +(expiryPnl + extrinsicSum).toFixed(2);
    };

    const calculatedPoints: PayoffPoint[] = [];
    const bPoints: number[] = [];
    let prevPoint: PayoffPoint | null = null;

    let maxP = -Infinity;
    let minP = Infinity;

    for (let i = 0; i <= totalSteps; i++) {
      const s = lowerBound + i * stepSize;
      const expPnl = calcExpiryPnl(s);
      const t0 = calcT0Pnl(s, expPnl);

      maxP = Math.max(maxP, expPnl, t0);
      minP = Math.min(minP, expPnl, t0);

      const pt = { spot: +s.toFixed(2), expiryPnl: expPnl, t0Pnl: t0 };
      calculatedPoints.push(pt);

      // Detect Breakeven crossing where sign flips
      if (prevPoint) {
        if (
          (prevPoint.expiryPnl < 0 && expPnl >= 0) || 
          (prevPoint.expiryPnl > 0 && expPnl <= 0)
        ) {
          // Linear interpolation for exact zero crossing
          const fraction = Math.abs(prevPoint.expiryPnl) / (Math.abs(prevPoint.expiryPnl) + Math.abs(expPnl));
          const beSpot = prevPoint.spot + fraction * (pt.spot - prevPoint.spot);
          bPoints.push(+beSpot.toFixed(2));
        }
      }
      prevPoint = pt;
    }

    const curExpPnl = calcExpiryPnl(currentSpot);
    const curT0 = calcT0Pnl(currentSpot, curExpPnl);

    // Padding for visual appeal
    const pnlPadding = Math.max((maxP - minP) * 0.15, 40);
    const chartMaxPnl = maxP > 0 ? maxP + pnlPadding : pnlPadding;
    const chartMinPnl = minP < 0 ? minP - pnlPadding : -pnlPadding;

    return {
      points: calculatedPoints,
      minSpot: lowerBound,
      maxSpot: upperBound,
      minPnl: chartMinPnl,
      maxPnl: chartMaxPnl,
      maxProfitUsd: +Math.max(0, maxP).toFixed(2),
      maxLossUsd: +Math.abs(Math.min(0, minP)).toFixed(2),
      breakevens: bPoints,
      strikes: legs,
      isNetCredit: netPrem > 0,
      netPremium: +netPrem.toFixed(2),
      currentSpotExpiryPnl: curExpPnl,
      currentSpotT0Pnl: curT0,
    };
  }, [legs, currentSpot, entrySpot, strategyName, zoomLevel]);

  // SVG Dimension Constants
  const width = 800;
  const height = 340;
  const padding = { top: 30, right: 40, bottom: 45, left: 65 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Scale Functions
  const scaleX = (s: number) => {
    return padding.left + ((s - minSpot) / (maxSpot - minSpot)) * plotWidth;
  };

  const scaleY = (pnl: number) => {
    return padding.top + ((maxPnl - pnl) / (maxPnl - minPnl)) * plotHeight;
  };

  const zeroY = scaleY(0);
  const currentSpotX = scaleX(currentSpot);

  // Path Generator for Expiry Payoff
  const expiryPath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, pt, idx) => {
      const x = scaleX(pt.spot);
      const y = scaleY(pt.expiryPnl);
      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, '');
  }, [points, minSpot, maxSpot, minPnl, maxPnl]);

  // Path Generator for T+0 Curve
  const t0Path = useMemo(() => {
    if (points.length === 0 || !showT0Curve) return '';
    return points.reduce((acc, pt, idx) => {
      const x = scaleX(pt.spot);
      const y = scaleY(pt.t0Pnl);
      return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
    }, '');
  }, [points, minSpot, maxSpot, minPnl, maxPnl, showT0Curve]);

  // Profit Area Fill (Green above zero)
  const profitAreaPath = useMemo(() => {
    if (points.length === 0) return '';
    const startX = scaleX(points[0].spot);
    const endX = scaleX(points[points.length - 1].spot);

    let d = `M ${startX} ${zeroY}`;
    points.forEach((pt) => {
      const x = scaleX(pt.spot);
      const y = pt.expiryPnl >= 0 ? scaleY(pt.expiryPnl) : zeroY;
      d += ` L ${x} ${y}`;
    });
    d += ` L ${endX} ${zeroY} Z`;
    return d;
  }, [points, minSpot, maxSpot, minPnl, maxPnl, zeroY]);

  // Loss Area Fill (Red below zero)
  const lossAreaPath = useMemo(() => {
    if (points.length === 0) return '';
    const startX = scaleX(points[0].spot);
    const endX = scaleX(points[points.length - 1].spot);

    let d = `M ${startX} ${zeroY}`;
    points.forEach((pt) => {
      const x = scaleX(pt.spot);
      const y = pt.expiryPnl <= 0 ? scaleY(pt.expiryPnl) : zeroY;
      d += ` L ${x} ${y}`;
    });
    d += ` L ${endX} ${zeroY} Z`;
    return d;
  }, [points, minSpot, maxSpot, minPnl, maxPnl, zeroY]);

  // Mouse hover handler
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    const svgY = ((e.clientY - rect.top) / rect.height) * height;

    if (svgX >= padding.left && svgX <= width - padding.right) {
      const spotFraction = (svgX - padding.left) / plotWidth;
      const hoveredSpot = minSpot + spotFraction * (maxSpot - minSpot);

      // Find closest point
      let closest = points[0];
      let minDiff = Infinity;
      for (const p of points) {
        const diff = Math.abs(p.spot - hoveredSpot);
        if (diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }

      setHoveredPoint(closest);
      setMousePos({ x: svgX, y: svgY });
    }
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
    setMousePos(null);
  };

  // Y-axis ticks
  const yTicks = useMemo(() => {
    const ticks: number[] = [0];
    const step = (maxPnl - minPnl) / 5;
    for (let val = step; val < maxPnl; val += step) {
      ticks.push(+val.toFixed(0));
    }
    for (let val = -step; val > minPnl; val -= step) {
      ticks.push(+val.toFixed(0));
    }
    return ticks.sort((a, b) => b - a);
  }, [minPnl, maxPnl]);

  // X-axis ticks (Spot prices)
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = 5;
    const step = (maxSpot - minSpot) / (count + 1);
    for (let i = 1; i <= count; i++) {
      ticks.push(+(minSpot + i * step).toFixed(0));
    }
    return ticks;
  }, [minSpot, maxSpot]);

  const activeHover = hoveredPoint || {
    spot: currentSpot,
    expiryPnl: currentSpotExpiryPnl,
    t0Pnl: currentSpotT0Pnl,
  };

  return (
    <div className="w-full min-w-0 panel-delta panel-delta-body space-y-3 font-sans">
      {/* Payoff Chart Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 shrink-0">
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="panel-delta-title">
                OPTIONS STRATEGY PAYOFF CHART
              </h3>
              <span className="badge-delta badge-delta-armed font-mono-numbers">
                {strategyName.toUpperCase()}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Interactive multi-leg Profit & Loss profile at expiration vs real-time estimated T+0 curve.
            </p>
          </div>
        </div>

        {/* Chart View Controls */}
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setShowT0Curve(!showT0Curve)}
            className={`btn-delta-sm ${showT0Curve ? 'btn-toggle-active' : 'btn-secondary'}`}
          >
            <Eye className="h-3 w-3" />
            <span>T+0 Curve</span>
          </button>

          <button
            type="button"
            onClick={() => setShowStrikes(!showStrikes)}
            className={`btn-delta-sm ${showStrikes ? 'btn-toggle-active' : 'btn-secondary'}`}
          >
            <Target className="h-3 w-3" />
            <span>Strikes</span>
          </button>

          <button
            type="button"
            onClick={() => setZoomLevel(zoomLevel === 'NORMAL' ? 'WIDE' : 'NORMAL')}
            className={`btn-delta-sm ${zoomLevel === 'WIDE' ? 'btn-toggle-active' : 'btn-secondary'}`}
          >
            <Maximize2 className="h-3 w-3" />
            <span>{zoomLevel === 'NORMAL' ? 'Zoom Out' : 'Zoom In'}</span>
          </button>
        </div>
      </div>

      {/* Payoff Key Metrics Chips — Zero Pre-Execution Projection Rule */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs font-mono-numbers">
        <div className="rounded bg-slate-950 border border-slate-800 p-2">
          <span className="text-[10px] text-slate-400 uppercase block">Max Profit (₹ / $)</span>
          {isPositionActive ? (
            <>
              <span className="font-extrabold text-emerald-400 text-xs mt-0.5 block">
                {maxProfitUsd > 100000
                  ? 'Unlimited'
                  : formatInrFirstPnl(maxProfitUsd, usdInrRate, { showPlusSign: true }).inrText}
              </span>
              {maxProfitUsd <= 100000 && (
                <span className="text-[10px] text-slate-400 block">
                  ({formatInrFirstPnl(maxProfitUsd, usdInrRate, { showPlusSign: true }).usdText})
                </span>
              )}
            </>
          ) : (
            <>
              <span className="font-extrabold text-slate-500 text-xs mt-0.5 block">---</span>
              <span className="text-[10px] text-slate-500 block">Awaiting Execution</span>
            </>
          )}
        </div>

        <div className="rounded bg-slate-950 border border-slate-800 p-2">
          <span className="text-[10px] text-slate-400 uppercase block">Max Loss / Risk (₹ / $)</span>
          {isPositionActive ? (
            <>
              <span className="font-extrabold text-rose-400 text-xs mt-0.5 block">
                {maxLossUsd > 100000
                  ? 'Substantial'
                  : formatInrFirstPnl(-Math.abs(maxLossUsd), usdInrRate, { showPlusSign: true }).inrText}
              </span>
              {maxLossUsd <= 100000 && (
                <span className="text-[10px] text-slate-400 block">
                  ({formatInrFirstPnl(-Math.abs(maxLossUsd), usdInrRate, { showPlusSign: true }).usdText})
                </span>
              )}
            </>
          ) : (
            <>
              <span className="font-extrabold text-slate-500 text-xs mt-0.5 block">---</span>
              <span className="text-[10px] text-slate-500 block">Awaiting Execution</span>
            </>
          )}
        </div>

        <div className="rounded bg-slate-950 border border-slate-800 p-2">
          <span className="text-[10px] text-slate-400 uppercase block">Net Premium</span>
          {isPositionActive ? (
            <>
              <span className={`font-extrabold text-xs mt-0.5 block ${isNetCredit ? 'text-emerald-400' : 'text-cyan-400'}`}>
                {formatInrFirstPnl(netPremium, usdInrRate, { showPlusSign: true }).inrText}
              </span>
              <span className="text-[10px] text-slate-400 block">
                ({formatInrFirstPnl(netPremium, usdInrRate, { showPlusSign: true }).usdText} · {isNetCredit ? 'Credit' : 'Debit'})
              </span>
            </>
          ) : (
            <>
              <span className="font-extrabold text-slate-500 text-xs mt-0.5 block">---</span>
              <span className="text-[10px] text-slate-500 block">Awaiting Execution</span>
            </>
          )}
        </div>

        <div className="rounded bg-slate-950 border border-slate-800 p-2">
          <span className="text-[10px] text-slate-400 uppercase block">Breakeven(s)</span>
          <div className="font-bold text-amber-300 text-xs mt-0.5 truncate">
            {isPositionActive
              ? breakevens.length > 0 
                ? breakevens.map((b) => `$${b.toLocaleString()}`).join(' | ') 
                : 'N/A (Defined Range)'
              : 'Awaiting Execution'}
          </div>
        </div>

        <div className="rounded bg-slate-950 border border-slate-800 p-2">
          <span className="text-[10px] text-slate-400 uppercase block">Live Spot PnL (₹ / $)</span>
          {isPositionActive ? (
            <>
              <span className={`font-extrabold text-xs mt-0.5 block ${unrealisedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatInrFirstPnl(unrealisedPnl, usdInrRate, { showPlusSign: true }).inrText}
              </span>
              <span className="text-[10px] text-slate-400 block">
                ({formatInrFirstPnl(unrealisedPnl, usdInrRate, { showPlusSign: true }).usdText} · {currentProfitPercent}%)
              </span>
            </>
          ) : (
            <>
              <span className="font-extrabold text-slate-500 text-xs mt-0.5 block">---</span>
              <span className="text-[10px] text-slate-500 block">Awaiting Execution</span>
            </>
          )}
        </div>

        <div className="rounded bg-slate-950 border border-slate-800 p-2">
          <span className="text-[10px] text-slate-400 uppercase block">Current Spot</span>
          <span className="font-extrabold text-cyan-400 text-sm mt-0.5 block">
            ${currentSpot.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* SVG Payoff Visualization Canvas */}
      <div className="relative w-full overflow-hidden rounded-lg border border-slate-800 bg-[#060a12]">
        {/* Dynamic Hover Tooltip Overlay */}
        {hoveredPoint && mousePos && (
          <div 
            className="absolute z-20 pointer-events-none rounded-md border border-cyan-500 bg-slate-950/95 p-2 shadow-2xl text-[11px] font-mono-numbers backdrop-blur-md"
            style={{
              left: `${Math.min(Math.max((mousePos.x / width) * 100, 15), 78)}%`,
              top: '12px',
              transform: 'translateX(-50%)',
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1 mb-1">
              <span className="text-slate-400 font-semibold">Underlying Spot:</span>
              <span className="font-extrabold text-white">
                ${hoveredPoint.spot.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[10px]">
              <div>
                <span className="text-slate-400 block">At Expiry PnL:</span>
                <span className={`font-bold text-xs block ${hoveredPoint.expiryPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatInrFirstPnl(hoveredPoint.expiryPnl, usdInrRate, { showPlusSign: true }).inrText}
                </span>
                <span className="text-[9.5px] text-slate-400">
                  ({formatInrFirstPnl(hoveredPoint.expiryPnl, usdInrRate, { showPlusSign: true }).usdText})
                </span>
              </div>
              {showT0Curve && (
                <div>
                  <span className="text-slate-400 block">T+0 Est. PnL:</span>
                  <span className={`font-bold text-xs block ${hoveredPoint.t0Pnl >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>
                    {formatInrFirstPnl(hoveredPoint.t0Pnl, usdInrRate, { showPlusSign: true }).inrText}
                  </span>
                  <span className="text-[9.5px] text-slate-400">
                    ({formatInrFirstPnl(hoveredPoint.t0Pnl, usdInrRate, { showPlusSign: true }).usdText})
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            {/* Profit Zone Green Gradient */}
            <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
            </linearGradient>

            {/* Loss Zone Red Gradient */}
            <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.28" />
            </linearGradient>

            {/* Current Spot Vertical Beam Gradient */}
            <linearGradient id="spotBeam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
            </linearGradient>
          </defs>

          {/* Grid lines (horizontal) */}
          {yTicks.map((tick) => {
            const y = scaleY(tick);
            return (
              <g key={`y-tick-${tick}`}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke={tick === 0 ? '#475569' : '#1e293b'}
                  strokeWidth={tick === 0 ? 1.5 : 0.8}
                  strokeDasharray={tick === 0 ? undefined : '3 3'}
                />
                <text
                  x={padding.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize="9"
                  fontFamily="monospace"
                  fill={tick === 0 ? '#94a3b8' : tick > 0 ? '#10b981' : '#f43f5e'}
                >
                  {tick > 0 ? `+${tick}` : tick}
                </text>
              </g>
            );
          })}

          {/* Grid lines (vertical spot) */}
          {xTicks.map((tick) => {
            const x = scaleX(tick);
            return (
              <g key={`x-tick-${tick}`}>
                <line
                  x1={x}
                  y1={padding.top}
                  x2={x}
                  y2={height - padding.bottom}
                  stroke="#1e293b"
                  strokeWidth={0.8}
                  strokeDasharray="2 2"
                />
                <text
                  x={x}
                  y={height - padding.bottom + 14}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontFamily="monospace"
                  fill="#64748b"
                >
                  {currencyPrefix}{tick.toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* Shaded Profit & Loss Areas */}
          <path d={profitAreaPath} fill="url(#profitGrad)" />
          <path d={lossAreaPath} fill="url(#lossGrad)" />

          {/* Breakeven Vertical Markers */}
          {breakevens.map((be, idx) => {
            const beX = scaleX(be);
            if (beX < padding.left || beX > width - padding.right) return null;
            return (
              <g key={`be-${idx}`}>
                <line
                  x1={beX}
                  y1={padding.top}
                  x2={beX}
                  y2={height - padding.bottom}
                  stroke="#fbbf24"
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                />
                <rect
                  x={beX - 32}
                  y={height - padding.bottom + 18}
                  width={64}
                  height={15}
                  rx={3}
                  fill="#78350f"
                  stroke="#fbbf24"
                  strokeWidth={0.8}
                />
                <text
                  x={beX}
                  y={height - padding.bottom + 29}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="bold"
                  fill="#fef08a"
                >
                  BE {idx + 1}: {currencyPrefix}{be.toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* Option Strike Price Vertical Lines */}
          {showStrikes && strikes.map((leg) => {
            const sX = scaleX(leg.strike);
            if (sX < padding.left || sX > width - padding.right) return null;
            const isCall = leg.type === 'CALL';
            const isBuy = leg.action === 'BUY';

            return (
              <g key={`strike-${leg.id}`}>
                <line
                  x1={sX}
                  y1={padding.top + 10}
                  x2={sX}
                  y2={height - padding.bottom}
                  stroke={isCall ? '#38bdf8' : '#c084fc'}
                  strokeWidth={0.9}
                  strokeDasharray="2 2"
                />
                {/* Strike Badge */}
                <rect
                  x={sX - 22}
                  y={padding.top - 18}
                  width={44}
                  height={14}
                  rx={2.5}
                  fill={isCall ? '#0c4a6e' : '#581c87'}
                  stroke={isCall ? '#0284c7' : '#9333ea'}
                  strokeWidth={0.7}
                />
                <text
                  x={sX}
                  y={padding.top - 8}
                  textAnchor="middle"
                  fontSize="8"
                  fontFamily="monospace"
                  fontWeight="bold"
                  fill={isCall ? '#bae6fd' : '#f3e8ff'}
                >
                  {leg.strike >= 1000 ? `${(leg.strike / 1000).toFixed(0)}k` : leg.strike} {leg.type[0]} ({isBuy ? 'B' : 'S'})
                </text>
              </g>
            );
          })}

          {/* T+0 Curve (Cyan Dashed) */}
          {showT0Curve && t0Path && (
            <path
              d={t0Path}
              fill="none"
              stroke="#06b6d4"
              strokeWidth={2}
              strokeDasharray="4 4"
              opacity={0.85}
            />
          )}

          {/* Expiry Payoff Curve (Solid High-Contrast Green/White) */}
          {expiryPath && (
            <path
              d={expiryPath}
              fill="none"
              stroke="#10b981"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Zero PnL Reference Line (Axis) */}
          <line
            x1={padding.left}
            y1={zeroY}
            x2={width - padding.right}
            y2={zeroY}
            stroke="#94a3b8"
            strokeWidth={1.2}
          />

          {/* Current Spot Price Vertical Marker */}
          {currentSpotX >= padding.left && currentSpotX <= width - padding.right && (
            <g>
              <line
                x1={currentSpotX}
                y1={padding.top - 10}
                x2={currentSpotX}
                y2={height - padding.bottom}
                stroke="#06b6d4"
                strokeWidth={2}
                strokeDasharray="4 2"
              />
              {/* Current Spot Circle on Expiry Line */}
              <circle
                cx={currentSpotX}
                cy={scaleY(currentSpotExpiryPnl)}
                r={5}
                fill="#06b6d4"
                stroke="#ffffff"
                strokeWidth={2}
                className="animate-pulse"
              />
              {/* Top Banner Tag */}
              <rect
                x={currentSpotX - 45}
                y={padding.top - 24}
                width={90}
                height={16}
                rx={3}
                fill="#083344"
                stroke="#06b6d4"
                strokeWidth={1}
              />
              <text
                x={currentSpotX}
                y={padding.top - 13}
                textAnchor="middle"
                fontSize="8.5"
                fontFamily="monospace"
                fontWeight="extrabold"
                fill="#67e8f9"
              >
                LIVE: {currencyPrefix}{currentSpot.toLocaleString(undefined, { minimumFractionDigits: 1 })}
              </text>
            </g>
          )}

          {/* Hover Crosshair Vertical Line */}
          {hoveredPoint && (
            <g>
              <line
                x1={scaleX(hoveredPoint.spot)}
                y1={padding.top}
                x2={scaleX(hoveredPoint.spot)}
                y2={height - padding.bottom}
                stroke="#ffffff"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.8}
              />
              <circle
                cx={scaleX(hoveredPoint.spot)}
                cy={scaleY(hoveredPoint.expiryPnl)}
                r={4}
                fill="#ffffff"
                stroke="#10b981"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      </div>

      {/* Chart Legend & Explanation */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400 pt-1 border-t border-slate-800/80">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-emerald-400 rounded" />
            <span className="text-slate-300 font-semibold">At Expiry PnL Profile</span>
          </div>
          {showT0Curve && (
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t border-dashed border-cyan-400" />
              <span className="text-cyan-300 font-semibold">T+0 Live Estimate</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <span className="text-slate-300">Live Spot Marker</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-slate-300">Breakeven</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-mono-numbers">
          <Info className="h-3 w-3 text-cyan-400" />
          <span>Calculated directly from Delta Exchange India options contract legs</span>
        </div>
      </div>
    </div>
  );
});
