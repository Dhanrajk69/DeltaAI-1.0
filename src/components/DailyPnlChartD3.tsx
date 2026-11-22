import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { PortfolioData, ClosedTrade, Position, TradingMode } from '../types';
import { BarChart3, Calendar, Award, Activity } from 'lucide-react';
import {
  buildSynchronized30DayPnlSeries,
  type CalendarTimezoneMode,
  type DailyPnlBucketPoint,
} from '../utils/dailyPnlBucketing';

export type DailyPnlPoint = DailyPnlBucketPoint;

interface DailyPnlChartD3Props {
  portfolio: PortfolioData;
  history: ClosedTrade[];
  positions?: Position[];
  currencyPrefix: string;
  exchangeRate: number;
  tradingMode?: TradingMode;
  isLiveApiAuthenticated?: boolean;
  timezone?: CalendarTimezoneMode;
}

export const DailyPnlChartD3: React.FC<DailyPnlChartD3Props> = ({
  portfolio,
  history,
  positions = [],
  currencyPrefix,
  exchangeRate,
  tradingMode = 'PAPER',
  isLiveApiAuthenticated = false,
  timezone = 'IST',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [chartMode, setChartMode] = useState<'COMBINED' | 'BARS' | 'CUMULATIVE'>('COMBINED');
  const [hoveredPoint, setHoveredPoint] = useState<DailyPnlPoint | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 860, height: 270 });

  // Observe container width for responsive D3 rendering
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.floor(entry.contentRect.width));
        setDimensions({ width: w, height: 270 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Synchronized 30-day PnL series bucketed by actual IST/UTC date (YYYY-MM-DD); floating unrealized PnL strictly reserved for TODAY LIVE
  const data: DailyPnlPoint[] = useMemo(() => {
    return buildSynchronized30DayPnlSeries({
      portfolio,
      history,
      positions,
      exchangeRate,
      tradingMode,
      isLiveApiAuthenticated,
      days: 30,
      timezone,
    });
  }, [
    portfolio,
    history,
    positions,
    exchangeRate,
    tradingMode,
    isLiveApiAuthenticated,
    timezone,
  ]);

  // 30-Day Institutional Summary Metrics (counting only sessions with non-zero PnL)
  const summary = useMemo(() => {
    const activeDays = data.filter((d) => d.tradesCount > 0 || d.openPositionsCount > 0 || Math.abs(d.dailyPnl) > 0);
    const winDays = activeDays.filter((d) => d.dailyPnl > 0).length;
    const lossDays = activeDays.filter((d) => d.dailyPnl < 0).length;
    const totalActive = winDays + lossDays;
    const totalNetPnl = data.length > 0 ? data[data.length - 1].cumulativePnl : 0;
    const bestDay = data.reduce((best, cur) => (cur.dailyPnl > best.dailyPnl ? cur : best), data[0]);
    const worstDay = data.reduce((worst, cur) => (cur.dailyPnl < worst.dailyPnl ? cur : worst), data[0]);
    const grossProfit = d3.sum(data.filter((d) => d.dailyPnl > 0), (d) => d.dailyPnl);
    const grossLoss = Math.abs(d3.sum(data.filter((d) => d.dailyPnl < 0), (d) => d.dailyPnl));
    const profitFactor =
      grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 99.9 : 0;
    const avgDailyPnl =
      activeDays.length > 0 ? +(d3.mean(activeDays, (d) => d.dailyPnl) || 0).toFixed(2) : 0;

    return {
      winDays,
      lossDays,
      activeSessions: activeDays.length,
      winDayRate: totalActive > 0 ? +((winDays / totalActive) * 100).toFixed(1) : 0,
      totalNetPnl,
      bestDay,
      worstDay,
      profitFactor,
      avgDailyPnl,
    };
  }, [data]);

  // Render D3 SVG Visualization
  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;
    const margin = { top: 20, right: 56, bottom: 32, left: 64 };
    const innerWidth = Math.max(100, width - margin.left - margin.right);
    const innerHeight = Math.max(80, height - margin.top - margin.bottom);

    const defs = svg.append('defs');

    // Positive Bar Gradient (Emerald)
    const posGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-pnl-pos-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    posGrad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.95);
    posGrad.append('stop').attr('offset', '100%').attr('stop-color', '#059669').attr('stop-opacity', 0.35);

    // Negative Bar Gradient (Rose)
    const negGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-pnl-neg-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    negGrad.append('stop').attr('offset', '0%').attr('stop-color', '#e11d48').attr('stop-opacity', 0.35);
    negGrad.append('stop').attr('offset', '100%').attr('stop-color', '#f43f5e').attr('stop-opacity', 0.95);

    // Cumulative Area Gradient (Cyan)
    const cumAreaGrad = defs
      .append('linearGradient')
      .attr('id', 'd3-cum-area-grad')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    cumAreaGrad.append('stop').attr('offset', '0%').attr('stop-color', '#22d3ee').attr('stop-opacity', 0.28);
    cumAreaGrad.append('stop').attr('offset', '100%').attr('stop-color', '#22d3ee').attr('stop-opacity', 0.0);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const xScale = d3
      .scaleBand<string>()
      .domain(data.map((d) => d.shortDate))
      .range([0, innerWidth])
      .padding(0.26);

    const minDaily = d3.min(data, (d) => d.dailyPnl) ?? 0;
    const maxDaily = d3.max(data, (d) => d.dailyPnl) ?? 0;
    const maxAbsDaily = Math.max(Math.abs(minDaily), Math.abs(maxDaily), 10);
    const yPadDaily = maxAbsDaily * 0.18;

    const yScaleDaily = d3
      .scaleLinear()
      .domain([Math.min(0, minDaily - yPadDaily), Math.max(0, maxDaily + yPadDaily)])
      .nice()
      .range([innerHeight, 0]);

    const minCum = d3.min(data, (d) => d.cumulativePnl) ?? 0;
    const maxCum = d3.max(data, (d) => d.cumulativePnl) ?? 0;
    const cumSpan = Math.max(maxCum - minCum, 20);
    const cumPad = cumSpan * 0.18;

    const yScaleCum = d3
      .scaleLinear()
      .domain([Math.min(0, minCum - cumPad * 0.5), Math.max(0, maxCum + cumPad)])
      .nice()
      .range([innerHeight, 0]);

    const primaryYScale = chartMode === 'CUMULATIVE' ? yScaleCum : yScaleDaily;

    // Horizontal Grid Lines
    const yTicks = primaryYScale.ticks(5);
    g.append('g')
      .attr('class', 'grid-lines')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => primaryYScale(d))
      .attr('y2', (d) => primaryYScale(d))
      .attr('stroke', '#1e293b')
      .attr('stroke-dasharray', '3,3')
      .attr('stroke-width', 1);

    // Zero Baseline Reference Line
    const zeroY = primaryYScale(0);
    if (zeroY >= 0 && zeroY <= innerHeight) {
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', zeroY)
        .attr('y2', zeroY)
        .attr('stroke', '#475569')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '4,2');
    }

    // 1. Render Daily PnL Bars (in COMBINED or BARS mode)
    if (chartMode === 'COMBINED' || chartMode === 'BARS') {
      const zeroLineY = yScaleDaily(0);
      g.append('g')
        .selectAll('rect.pnl-bar')
        .data(data)
        .join('rect')
        .attr('class', 'pnl-bar')
        .attr('x', (d) => xScale(d.shortDate) || 0)
        .attr('width', xScale.bandwidth())
        .attr('y', (d) => (d.dailyPnl >= 0 ? yScaleDaily(d.dailyPnl) : zeroLineY))
        .attr('height', (d) => Math.max(2, Math.abs(yScaleDaily(d.dailyPnl) - zeroLineY)))
        .attr('rx', 2.5)
        .attr('fill', (d) => (d.dailyPnl >= 0 ? 'url(#d3-pnl-pos-grad)' : 'url(#d3-pnl-neg-grad)'))
        .attr('stroke', (d) => (d.dailyPnl >= 0 ? '#10b981' : '#f43f5e'))
        .attr('stroke-width', 0.8);
    }

    // 2. Render Cumulative PnL Line & Area (in COMBINED or CUMULATIVE mode)
    if (chartMode === 'COMBINED' || chartMode === 'CUMULATIVE') {
      const activeCumScale = chartMode === 'CUMULATIVE' ? yScaleCum : yScaleCum;

      if (chartMode === 'CUMULATIVE') {
        const areaGenerator = d3
          .area<DailyPnlPoint>()
          .x((d) => (xScale(d.shortDate) || 0) + xScale.bandwidth() / 2)
          .y0(innerHeight)
          .y1((d) => activeCumScale(d.cumulativePnl))
          .curve(d3.curveMonotoneX);

        g.append('path')
          .datum(data)
          .attr('fill', 'url(#d3-cum-area-grad)')
          .attr('d', areaGenerator);
      }

      const lineGenerator = d3
        .line<DailyPnlPoint>()
        .x((d) => (xScale(d.shortDate) || 0) + xScale.bandwidth() / 2)
        .y((d) => activeCumScale(d.cumulativePnl))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#22d3ee')
        .attr('stroke-width', 2.2)
        .attr('d', lineGenerator);

      // Data nodes on cumulative curve
      g.append('g')
        .selectAll('circle.cum-node')
        .data(data)
        .join('circle')
        .attr('class', 'cum-node')
        .attr('cx', (d) => (xScale(d.shortDate) || 0) + xScale.bandwidth() / 2)
        .attr('cy', (d) => activeCumScale(d.cumulativePnl))
        .attr('r', (_d, idx) => (idx === data.length - 1 ? 4 : 2.2))
        .attr('fill', (_d, idx) => (idx === data.length - 1 ? '#22d3ee' : '#090d16'))
        .attr('stroke', '#22d3ee')
        .attr('stroke-width', 1.6);
    }

    // X-Axis (show every 4th date label so it stays crisp)
    const tickDates = data.filter((_, i) => i % 4 === 0 || i === data.length - 1).map((d) => d.shortDate);
    const xAxis = d3.axisBottom(xScale).tickValues(tickDates).tickSizeOuter(0);

    const xAxisGroup = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);

    xAxisGroup.select('.domain').attr('stroke', '#334155');
    xAxisGroup.selectAll('line').attr('stroke', '#334155');
    xAxisGroup
      .selectAll('text')
      .attr('fill', '#94a3b8')
      .attr('font-size', '10px')
      .attr('font-family', 'JetBrains Mono, monospace');

    // Left Y-Axis (Daily PnL or Cumulative PnL)
    const formatVal = (val: d3.NumberValue) => {
      const n = Number(val);
      const sign = n > 0 ? '+' : n < 0 ? '-' : '';
      const abs = Math.abs(n);
      if (abs >= 1000) return `${sign}${currencyPrefix}${(abs / 1000).toFixed(1)}k`;
      return `${sign}${currencyPrefix}${abs.toFixed(0)}`;
    };

    const leftAxis = d3.axisLeft(primaryYScale).ticks(5).tickFormat(formatVal);
    const leftAxisGroup = g.append('g').call(leftAxis);
    leftAxisGroup.select('.domain').remove();
    leftAxisGroup.selectAll('line').remove();
    leftAxisGroup
      .selectAll('text')
      .attr('fill', '#94a3b8')
      .attr('font-size', '10px')
      .attr('font-family', 'JetBrains Mono, monospace');

    // Right Y-Axis (Cumulative Equity Scale when in COMBINED mode)
    if (chartMode === 'COMBINED') {
      const rightAxis = d3.axisRight(yScaleCum).ticks(5).tickFormat(formatVal);
      const rightAxisGroup = g.append('g').attr('transform', `translate(${innerWidth},0)`).call(rightAxis);
      rightAxisGroup.select('.domain').remove();
      rightAxisGroup.selectAll('line').remove();
      rightAxisGroup
        .selectAll('text')
        .attr('fill', '#22d3ee')
        .attr('font-size', '10px')
        .attr('font-family', 'JetBrains Mono, monospace');
    }

    // Interactive Crosshair Guide Line
    const hoverLine = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0)
      .style('pointer-events', 'none');

    // Invisible Hover Hit Columns for each day
    g.append('g')
      .selectAll('rect.hit-zone')
      .data(data)
      .join('rect')
      .attr('class', 'hit-zone')
      .attr('x', (d) => xScale(d.shortDate) || 0)
      .attr('y', 0)
      .attr('width', xScale.bandwidth())
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mouseenter', (_event, d) => {
        const cx = (xScale(d.shortDate) || 0) + xScale.bandwidth() / 2;
        hoverLine.attr('x1', cx).attr('x2', cx).style('opacity', 1);
        setHoveredPoint(d);
      })
      .on('mouseleave', () => {
        hoverLine.style('opacity', 0);
        setHoveredPoint(null);
      });
  }, [data, dimensions, chartMode, currencyPrefix]);

  const activePoint = hoveredPoint || data[data.length - 1];

  return (
    <div className="panel-delta p-4 space-y-3.5">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-950/70 border border-emerald-700/70 flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="panel-delta-title text-white">
                30-Day Daily P&L Performance & Cumulative Curve
              </h2>
              <span className="badge-delta badge-delta-armed font-mono-numbers">
                D3 QUANT TELEMETRY
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Daily realised + floating net PnL distribution (bars) overlaid with 30-day compounding equity trajectory
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1.5 self-start lg:self-center">
          <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
            <button
              onClick={() => setChartMode('COMBINED')}
              className={`btn-delta-sm ${
                chartMode === 'COMBINED'
                  ? 'btn-primary'
                  : 'btn-secondary'
              }`}
            >
              Combined Overlay
            </button>
            <button
              onClick={() => setChartMode('BARS')}
              className={`btn-delta-sm ${
                chartMode === 'BARS'
                  ? 'btn-primary'
                  : 'btn-secondary'
              }`}
            >
              Daily Bars
            </button>
            <button
              onClick={() => setChartMode('CUMULATIVE')}
              className={`btn-delta-sm ${
                chartMode === 'CUMULATIVE'
                  ? 'btn-toggle-active'
                  : 'btn-secondary'
              }`}
            >
              Cumulative Curve
            </button>
          </div>
        </div>
      </div>

      {/* 30-Day Analytics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 font-mono-numbers">
        <div className="p-2.5 bg-slate-950/90 border border-slate-800/80 rounded">
          <span className="text-[10px] text-slate-400 uppercase block">30D Cumulative Net PnL</span>
          <span className={`text-sm font-bold mt-0.5 block ${summary.totalNetPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {summary.totalNetPnl >= 0 ? '+' : ''}
            {currencyPrefix}
            {summary.totalNetPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="p-2.5 bg-slate-950/90 border border-slate-800/80 rounded">
          <span className="text-[10px] text-slate-400 uppercase block">Profitable Days</span>
          <span className="text-sm font-bold text-white mt-0.5 block">
            {summary.winDays}W / {summary.lossDays}L{' '}
            <span className="text-xs text-emerald-400">({summary.winDayRate}%)</span>
          </span>
        </div>

        <div className="p-2.5 bg-slate-950/90 border border-slate-800/80 rounded">
          <span className="text-[10px] text-slate-400 uppercase block">Best Session ({summary.bestDay?.shortDate})</span>
          <span className="text-sm font-bold text-emerald-400 mt-0.5 block">
            +{currencyPrefix}
            {summary.bestDay?.dailyPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        <div className="p-2.5 bg-slate-950/90 border border-slate-800/80 rounded">
          <span className="text-[10px] text-slate-400 uppercase block">Max Daily Drawdown ({summary.worstDay?.shortDate})</span>
          <span className="text-sm font-bold text-rose-400 mt-0.5 block">
            {currencyPrefix}
            {summary.worstDay?.dailyPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

          <div className="p-2.5 bg-slate-950/90 border border-slate-800/80 rounded col-span-2 sm:col-span-1">
          <span className="text-[10px] text-slate-400 uppercase block">Profit Factor · Avg Active Day</span>
          <span className="text-sm font-bold text-cyan-400 mt-0.5 block">
            {summary.profitFactor >= 99 ? 'MAX' : `${summary.profitFactor}x`} ·{' '}
            {summary.avgDailyPnl >= 0 ? '+' : '-'}
            {currencyPrefix}
            {Math.abs(summary.avgDailyPnl).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>

      {/* Interactive Hover Inspection HUD Bar */}
      {activePoint && (
        <div className="px-3 py-2 bg-[#060a12] border border-slate-800 rounded flex flex-wrap items-center justify-between gap-2 text-xs font-mono-numbers">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-slate-300 font-semibold">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              <span>{activePoint.dateStr}</span>
              <span className="text-[10px] text-slate-500">({timezone})</span>
              {activePoint.isToday ? (
                <span className="badge-delta badge-delta-live">TODAY LIVE</span>
              ) : (
                <span className="badge-delta badge-delta-armed">REALIZED</span>
              )}
            </span>
            <span className="text-slate-600">|</span>
            <span>
              {activePoint.isToday ? 'Net PnL:' : 'Realized PnL:'}{' '}
              <strong
                className={
                  activePoint.dailyPnl > 0
                    ? 'text-emerald-400'
                    : activePoint.dailyPnl < 0
                    ? 'text-rose-400'
                    : 'text-slate-300'
                }
              >
                {activePoint.dailyPnl > 0 ? '+' : activePoint.dailyPnl < 0 ? '-' : ''}
                {currencyPrefix}
                {Math.abs(activePoint.dailyPnl).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                ({activePoint.dailyPnlPct >= 0 ? '+' : ''}
                {activePoint.dailyPnlPct}%)
              </strong>
            </span>
            {activePoint.isToday && (activePoint.openPositionsCount > 0 || Math.abs(activePoint.unrealizedPnl) > 0) && (
              <>
                <span className="text-slate-600">|</span>
                <span className="text-[11px] text-amber-300">
                  Floating:{' '}
                  <strong className={activePoint.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {activePoint.openPositionsCount}P {activePoint.unrealizedPnl >= 0 ? '+' : '-'}
                    {currencyPrefix}
                    {Math.abs(activePoint.unrealizedPnl).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </span>
              </>
            )}
            <span className="text-slate-600">|</span>
            <span>
              30D Cumulative:{' '}
              <strong className="text-cyan-400">
                {activePoint.cumulativePnl >= 0 ? '+' : '-'}
                {currencyPrefix}
                {Math.abs(activePoint.cumulativePnl).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-emerald-400" />
              <span>
                {activePoint.tradesCount} Fills ({activePoint.wins}W/{activePoint.losses}L · {activePoint.winRate}% WR)
              </span>
            </span>
            <span className="hidden md:flex items-center gap-1 text-slate-300">
              <Award className="w-3 h-3 text-amber-400" />
              <span>Lead: {activePoint.topStrategy}</span>
            </span>
          </div>
        </div>
      )}

      {/* D3 SVG Canvas Container */}
      <div ref={containerRef} className="w-full overflow-hidden">
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="w-full block select-none overflow-visible"
        />
      </div>

      {/* Legend Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400 border-t border-slate-800/60">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
            <span>Profitable Session</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
            <span>Drawdown Session</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-cyan-400 inline-block" />
            <span className="text-cyan-300">Cumulative 30D Equity Curve (Right Axis)</span>
          </span>
        </div>
        <span className="font-mono-numbers text-[10px] text-slate-500">
          Hover over any session bar to inspect granular execution metrics
        </span>
      </div>
    </div>
  );
};
