import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { PortfolioData, ClosedTrade, Position, TradingMode } from '../types';
import { Grid, Flame, TrendingUp, TrendingDown, Calendar, CheckCircle2 } from 'lucide-react';
import { DailyPnlPoint } from './DailyPnlChartD3';
import {
  buildSynchronized30DayPnlSeries,
  type CalendarTimezoneMode,
} from '../utils/dailyPnlBucketing';

interface PnlHeatmapD3Props {
  portfolio: PortfolioData;
  history: ClosedTrade[];
  positions?: Position[];
  currencyPrefix: string;
  exchangeRate: number;
  tradingMode?: TradingMode;
  isLiveApiAuthenticated?: boolean;
  timezone?: CalendarTimezoneMode;
}

type HeatmapFilter = 'ALL' | 'GAINS' | 'LOSSES' | 'OUTLIERS';

export const PnlHeatmapD3: React.FC<PnlHeatmapD3Props> = ({
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
  const [filterMode, setFilterMode] = useState<HeatmapFilter>('ALL');
  const [selectedDay, setSelectedDay] = useState<DailyPnlPoint | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 860, height: 245 });

  // Observe container width for responsive D3 rendering
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.floor(entry.contentRect.width));
        const h = w < 540 ? 300 : 245;
        setDimensions({ width: w, height: h });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Synchronized 30-day PnL series bucketed by actual IST/UTC date (YYYY-MM-DD); floating unrealized PnL strictly on TODAY LIVE
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

  // Summary intensity statistics (strictly over days with realized/floating PnL activity)
  const stats = useMemo(() => {
    const gains = data.filter((d) => d.dailyPnl > 0);
    const losses = data.filter((d) => d.dailyPnl < 0);
    const maxGain = d3.max(gains, (d) => d.dailyPnl) || 1;
    const maxLossAbs = Math.abs(d3.min(losses, (d) => d.dailyPnl) || -1);
    const avgGain = d3.mean(gains, (d) => d.dailyPnl) || 0;
    const avgLoss = d3.mean(losses, (d) => d.dailyPnl) || 0;

    // Calculate current winning streak across active trading sessions from end
    let currentStreak = 0;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].tradesCount === 0 && data[i].openPositionsCount === 0 && data[i].dailyPnl === 0) {
        continue;
      }
      if (data[i].dailyPnl > 0) currentStreak++;
      else break;
    }

    return {
      gainDays: gains.length,
      lossDays: losses.length,
      maxGain,
      maxLossAbs,
      avgGain,
      avgLoss,
      currentStreak,
    };
  }, [data]);

  // Render D3 Heatmap Matrix
  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;
    const isCompact = width < 540;
    const cols = isCompact ? 5 : 10;
    const rows = Math.ceil(data.length / cols);

    const margin = { top: 24, right: 10, bottom: 8, left: 10 };
    const innerWidth = Math.max(260, width - margin.left - margin.right);
    const innerHeight = Math.max(150, height - margin.top - margin.bottom);

    const cellGap = 6;
    const cellWidth = (innerWidth - cellGap * (cols - 1)) / cols;
    const cellHeight = (innerHeight - cellGap * (rows - 1)) / rows;

    // D3 Color Scales for Gains (Emerald Intensity) & Losses (Rose Intensity)
    const gainColorScale = d3
      .scaleLinear<string>()
      .domain([0, stats.maxGain])
      .range(['#064e3b', '#10b981'])
      .interpolate(d3.interpolateRgb);

    const gainBorderScale = d3
      .scaleLinear<string>()
      .domain([0, stats.maxGain])
      .range(['#047857', '#34d399'])
      .interpolate(d3.interpolateRgb);

    const lossColorScale = d3
      .scaleLinear<string>()
      .domain([0, stats.maxLossAbs])
      .range(['#4c0519', '#f43f5e'])
      .interpolate(d3.interpolateRgb);

    const lossBorderScale = d3
      .scaleLinear<string>()
      .domain([0, stats.maxLossAbs])
      .range(['#881337', '#fb7185'])
      .interpolate(d3.interpolateRgb);

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Column Header Labels (Day slot index in row)
    const colIndices = d3.range(cols);
    g.selectAll('.col-header')
      .data(colIndices)
      .enter()
      .append('text')
      .attr('class', 'col-header')
      .attr('x', (colIdx) => colIdx * (cellWidth + cellGap) + cellWidth / 2)
      .attr('y', -8)
      .attr('text-anchor', 'middle')
      .attr('fill', '#64748b')
      .attr('font-size', '9px')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text((colIdx) => `D+${colIdx + 1}`);

    const outlierThresholdGain = stats.maxGain * 0.65;
    const outlierThresholdLoss = stats.maxLossAbs * 0.65;

    const hasDayActivity = (d: DailyPnlPoint) =>
      d.tradesCount > 0 || d.openPositionsCount > 0 || Math.abs(d.dailyPnl) > 0;

    const isCellActive = (d: DailyPnlPoint) => {
      if (filterMode === 'GAINS') return d.dailyPnl > 0;
      if (filterMode === 'LOSSES') return d.dailyPnl < 0;
      if (filterMode === 'OUTLIERS') {
        return (
          (d.dailyPnl > 0 && d.dailyPnl >= outlierThresholdGain) ||
          (d.dailyPnl < 0 && Math.abs(d.dailyPnl) >= outlierThresholdLoss)
        );
      }
      return true;
    };

    // Create cell groups
    const cells = g
      .selectAll('.heatmap-cell')
      .data(data)
      .enter()
      .append('g')
      .attr('class', 'heatmap-cell')
      .attr('transform', (_, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const x = col * (cellWidth + cellGap);
        const y = row * (cellHeight + cellGap);
        return `translate(${x},${y})`;
      })
      .style('cursor', 'pointer');

    // Background Rect with D3 intensity fill (neutral slate for empty no-fill days)
    cells
      .append('rect')
      .attr('class', 'cell-bg')
      .attr('width', cellWidth)
      .attr('height', cellHeight)
      .attr('rx', 5)
      .attr('ry', 5)
      .attr('fill', (d) => {
        if (!isCellActive(d) || !hasDayActivity(d)) return '#0b1222';
        if (d.dailyPnl === 0) return '#0f172a';
        return d.dailyPnl > 0
          ? gainColorScale(d.dailyPnl)
          : lossColorScale(Math.abs(d.dailyPnl));
      })
      .attr('fill-opacity', (d) => {
        if (!isCellActive(d)) return 0.3;
        if (!hasDayActivity(d)) return 0.65;
        if (d.dailyPnl === 0) return 0.7;
        const intensityRatio =
          d.dailyPnl > 0
            ? Math.min(1, d.dailyPnl / stats.maxGain)
            : Math.min(1, Math.abs(d.dailyPnl) / stats.maxLossAbs);
        return 0.45 + intensityRatio * 0.5;
      })
      .attr('stroke', (d) => {
        if (d.isToday) return '#22d3ee';
        if (!isCellActive(d) || !hasDayActivity(d) || d.dailyPnl === 0) return '#1e293b';
        return d.dailyPnl > 0
          ? gainBorderScale(d.dailyPnl)
          : lossBorderScale(Math.abs(d.dailyPnl));
      })
      .attr('stroke-width', (d) => (d.isToday ? 1.8 : 1))
      .attr('stroke-opacity', (d) => (d.isToday ? 0.95 : isCellActive(d) && hasDayActivity(d) ? 0.85 : 0.4));

    // Intensity Bar Indicator along bottom of each cell
    cells
      .append('rect')
      .attr('x', 4)
      .attr('y', cellHeight - 5)
      .attr('width', (d) => {
        if (!isCellActive(d) || !hasDayActivity(d) || d.dailyPnl === 0) return 0;
        const usableW = Math.max(0, cellWidth - 8);
        const ratio =
          d.dailyPnl > 0
            ? Math.min(1, d.dailyPnl / stats.maxGain)
            : Math.min(1, Math.abs(d.dailyPnl) / stats.maxLossAbs);
        return Math.max(4, usableW * ratio);
      })
      .attr('height', 2.5)
      .attr('rx', 1.25)
      .attr('fill', (d) => (d.dailyPnl >= 0 ? '#34d399' : '#fb7185'))
      .attr('opacity', (d) => (isCellActive(d) && hasDayActivity(d) ? 0.9 : 0.15));

    // Top row inside cell: Short Date + LIVE badge for TODAY
    cells
      .append('text')
      .attr('x', 6)
      .attr('y', 13)
      .attr('fill', (d) =>
        d.isToday
          ? '#67e8f9'
          : isCellActive(d) && hasDayActivity(d)
          ? '#e2e8f0'
          : '#64748b'
      )
      .attr('font-size', isCompact ? '8.5px' : '9.5px')
      .attr('font-weight', '600')
      .attr('font-family', 'Inter, sans-serif')
      .text((d) => (d.isToday ? `${d.shortDate} • LIVE` : d.shortDate));

    // Return % badge in top-right of cell (when cell is wide enough and active)
    if (cellWidth >= 74) {
      cells
        .append('text')
        .attr('x', cellWidth - 6)
        .attr('y', 13)
        .attr('text-anchor', 'end')
        .attr('fill', (d) => {
          if (!isCellActive(d) || !hasDayActivity(d)) return '#475569';
          return d.dailyPnl >= 0 ? '#6ee7b7' : '#fda4af';
        })
        .attr('font-size', '8px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text((d) =>
          !hasDayActivity(d) ? '' : `${d.dailyPnlPct >= 0 ? '+' : ''}${d.dailyPnlPct}%`
        );
    }

    // Center/Main PnL Value inside cell
    cells
      .append('text')
      .attr('x', 6)
      .attr('y', cellHeight / 2 + 6)
      .attr('fill', (d) => {
        if (!isCellActive(d) || !hasDayActivity(d)) return '#475569';
        if (d.dailyPnl === 0) return '#cbd5e1';
        return d.dailyPnl > 0 ? '#ecfdf5' : '#fff1f2';
      })
      .attr('font-size', isCompact ? '10px' : '11px')
      .attr('font-weight', '700')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text((d) => {
        if (!hasDayActivity(d)) return '—';
        const sign = d.dailyPnl > 0 ? '+' : d.dailyPnl < 0 ? '-' : '';
        const absVal = Math.abs(d.dailyPnl);
        const formatted =
          absVal >= 1000
            ? `${(absVal / 1000).toFixed(1)}k`
            : absVal >= 100
            ? absVal.toFixed(0)
            : absVal.toFixed(2);
        return `${sign}${currencyPrefix}${formatted}`;
      });

    // Sub-caption: Closed fills / WR for past days; floating open positions indicator strictly on TODAY LIVE
    if (cellHeight >= 52) {
      cells
        .append('text')
        .attr('x', 6)
        .attr('y', cellHeight - 10)
        .attr('fill', (d) => {
          if (!isCellActive(d)) return '#334155';
          if (d.isToday && d.openPositionsCount > 0) return '#fcd34d';
          return hasDayActivity(d) ? '#cbd5e1' : '#475569';
        })
        .attr('fill-opacity', 0.88)
        .attr('font-size', '8.2px')
        .attr('font-family', 'JetBrains Mono, monospace')
        .text((d) => {
          if (d.isToday && (d.openPositionsCount > 0 || Math.abs(d.unrealizedPnl) > 0)) {
            const fSign = d.unrealizedPnl >= 0 ? '+' : '-';
            const fAbs = Math.abs(d.unrealizedPnl).toFixed(2);
            return `${d.openPositionsCount}P ${fSign}${currencyPrefix}${fAbs}`;
          }
          if (d.tradesCount === 0) return 'No fills';
          return `${d.tradesCount}T · ${d.winRate}% WR`;
        });
    }

    // Interactive Hover & Click Handlers
    cells
      .on('mouseenter', function (_, d) {
        d3.select(this)
          .select('.cell-bg')
          .transition()
          .duration(120)
          .attr('stroke', '#38bdf8')
          .attr('stroke-width', 2)
          .attr('fill-opacity', 0.95);
        setSelectedDay(d);
      })
      .on('mouseleave', function (_, d) {
        d3.select(this)
          .select('.cell-bg')
          .transition()
          .duration(150)
          .attr('stroke', () => {
            if (d.isToday) return '#22d3ee';
            if (!isCellActive(d) || !hasDayActivity(d) || d.dailyPnl === 0) return '#1e293b';
            return d.dailyPnl > 0
              ? gainBorderScale(d.dailyPnl)
              : lossBorderScale(Math.abs(d.dailyPnl));
          })
          .attr('stroke-width', d.isToday ? 1.8 : 1)
          .attr('fill-opacity', () => {
            if (!isCellActive(d)) return 0.3;
            if (!hasDayActivity(d)) return 0.65;
            if (d.dailyPnl === 0) return 0.7;
            const intensityRatio =
              d.dailyPnl > 0
                ? Math.min(1, d.dailyPnl / stats.maxGain)
                : Math.min(1, Math.abs(d.dailyPnl) / stats.maxLossAbs);
            return 0.45 + intensityRatio * 0.5;
          });
      });
  }, [data, dimensions, filterMode, stats, currencyPrefix]);

  const activePoint = selectedDay || data[data.length - 1];
  const activeIntensityPct = useMemo(() => {
    if (!activePoint) return 0;
    if (activePoint.dailyPnl >= 0) {
      return Math.min(100, Math.round((activePoint.dailyPnl / stats.maxGain) * 100));
    }
    return Math.min(100, Math.round((Math.abs(activePoint.dailyPnl) / stats.maxLossAbs) * 100));
  }, [activePoint, stats]);

  return (
    <div className="panel-delta p-4">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Grid className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="panel-delta-title text-white">
                30-Day PnL Performance Heatmap (D3 Matrix)
              </h2>
              <span className="badge-delta badge-delta-live font-mono-numbers">
                {stats.gainDays}G / {stats.lossDays}R
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Color-coded daily return intensity — hover any session cell to inspect execution metrics
            </p>
          </div>
        </div>

        {/* Intensity Legend & Filter Controls */}
        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3">
          {/* Color Scale Legend */}
          <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 rounded-md text-[10px] font-mono-numbers">
            <span className="text-rose-400 font-semibold">Max Loss</span>
            <div className="flex items-center gap-0.5">
              <span className="w-3 h-2.5 rounded-xs bg-[#f43f5e]" />
              <span className="w-3 h-2.5 rounded-xs bg-[#9f1239]" />
              <span className="w-3 h-2.5 rounded-xs bg-[#4c0519]" />
              <span className="w-1.5 h-2.5 bg-slate-800 mx-0.5" />
              <span className="w-3 h-2.5 rounded-xs bg-[#064e3b]" />
              <span className="w-3 h-2.5 rounded-xs bg-[#059669]" />
              <span className="w-3 h-2.5 rounded-xs bg-[#10b981]" />
            </div>
            <span className="text-emerald-400 font-semibold">Max Gain</span>
          </div>

          {/* Filter Mode Selector */}
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {(
              [
                { id: 'ALL', label: 'All 30D' },
                { id: 'GAINS', label: `Gains (${stats.gainDays})` },
                { id: 'LOSSES', label: `Losses (${stats.lossDays})` },
                { id: 'OUTLIERS', label: 'Peak Intensity' },
              ] as { id: HeatmapFilter; label: string }[]
            ).map((btn) => (
              <button
                key={btn.id}
                onClick={() => setFilterMode(btn.id)}
                className={`btn-delta-sm ${
                  filterMode === btn.id
                    ? 'btn-primary'
                    : 'btn-secondary'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-400 uppercase">Avg Green Day</div>
            <div className="text-xs sm:text-sm font-bold font-mono-numbers text-emerald-400 mt-0.5">
              +{currencyPrefix}
              {stats.avgGain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <TrendingUp className="w-4 h-4 text-emerald-400/70" />
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-400 uppercase">Avg Red Day</div>
            <div className="text-xs sm:text-sm font-bold font-mono-numbers text-rose-400 mt-0.5">
              -{currencyPrefix}
              {Math.abs(stats.avgLoss).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <TrendingDown className="w-4 h-4 text-rose-400/70" />
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-400 uppercase">Gain / Loss Ratio</div>
            <div className="text-xs sm:text-sm font-bold font-mono-numbers text-cyan-400 mt-0.5">
              {(stats.avgGain / Math.max(1, Math.abs(stats.avgLoss))).toFixed(2)}x Payoff
            </div>
          </div>
          <Flame className="w-4 h-4 text-cyan-400/70" />
        </div>

        <div className="bg-slate-900/60 border border-slate-800/80 rounded px-3 py-2 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-400 uppercase">Active Win Streak</div>
            <div className="text-xs sm:text-sm font-bold font-mono-numbers text-emerald-400 mt-0.5">
              {stats.currentStreak} {stats.currentStreak === 1 ? 'Session' : 'Sessions'}
            </div>
          </div>
          <CheckCircle2 className="w-4 h-4 text-emerald-400/70" />
        </div>
      </div>

      {/* D3 SVG Matrix Container */}
      <div ref={containerRef} className="w-full overflow-hidden select-none">
        <svg ref={svgRef} className="w-full block" />
      </div>

      {/* Interactive Cell Inspector Footer */}
      {activePoint && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-slate-300 font-medium">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-mono-numbers">{activePoint.dateStr}</span>
              <span className="text-[10px] text-slate-500 font-mono-numbers">({timezone})</span>
              {activePoint.isToday && (
                <span className="badge-delta badge-delta-live text-[9px]">TODAY LIVE</span>
              )}
            </span>

            <span
              className={`badge-delta font-mono-numbers ${
                activePoint.dailyPnl > 0
                  ? 'badge-delta-live'
                  : activePoint.dailyPnl < 0
                  ? 'badge-delta-danger'
                  : 'bg-slate-800/80 text-slate-300 border-slate-700'
              }`}
            >
              {activePoint.isToday ? 'Net PnL:' : 'Realized PnL:'}{' '}
              {activePoint.dailyPnl > 0 ? '+' : activePoint.dailyPnl < 0 ? '-' : ''}
              {currencyPrefix}
              {Math.abs(activePoint.dailyPnl).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              ({activePoint.dailyPnlPct >= 0 ? '+' : ''}
              {activePoint.dailyPnlPct}%)
            </span>

            {activePoint.isToday && (activePoint.openPositionsCount > 0 || Math.abs(activePoint.unrealizedPnl) > 0) && (
              <span className="text-amber-300 font-mono-numbers">
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
            )}

            <span className="text-slate-400 font-mono-numbers">
              Intensity:{' '}
              <strong className={activePoint.dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {activeIntensityPct}%
              </strong>
            </span>

            <span className="text-slate-400 font-mono-numbers">
              Closed Fills: <strong className="text-slate-200">{activePoint.tradesCount}</strong> (
              <span className="text-emerald-400">{activePoint.wins}W</span> /{' '}
              <span className="text-rose-400">{activePoint.losses}L</span> ·{' '}
              <strong className="text-slate-200">{activePoint.winRate}% WR</strong>)
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span>Lead Strategy:</span>
            <span className="badge-delta badge-delta-armed">
              {activePoint.topStrategy}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
