import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Position, ClosedTrade, TradingMode } from '../types';
import {
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Flame,
  Zap,
  Play,
  Pause,
  ArrowUpDown,
  Sliders,
  ChevronDown,
  Award
} from 'lucide-react';

interface PositionsTableProps {
  positions: Position[];
  history: ClosedTrade[];
  onClosePosition: (positionId: string) => Promise<void>;
  onAutoHedge: (symbol: string) => Promise<void>;
  tradingMode: TradingMode;
  currencyPrefix: string;
  exchangeRate: number;
}

export type AutoSortRankingMode =
  | 'PROFIT_DESC'    // Most Profitable / Highest Realized or Unrealized PnL at the top
  | 'RISK_ASC'       // Highest Risk / Deepest Drawdown at the top for immediate oversight
  | 'MAGNITUDE_DESC' // Highest Dollar PnL Volatility / Impact
  | 'PERCENT_DESC'   // Highest ROI %
  | 'PERCENT_ASC';   // Worst Drawdown %

export const PositionsTable: React.FC<PositionsTableProps> = ({
  positions,
  history,
  onClosePosition,
  onAutoHedge,
  tradingMode,
  currencyPrefix,
  exchangeRate,
}) => {
  const [activeTab, setActiveTab] = useState<'POSITIONS' | 'HISTORY'>('POSITIONS');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [hedgingSymbol, setHedgingSymbol] = useState<string | null>(null);

  // Auto-Sort State Configuration
  const [autoSortEnabled, setAutoSortEnabled] = useState<boolean>(true);
  const [rankingMode, setRankingMode] = useState<AutoSortRankingMode>('PROFIT_DESC');
  const [sortIntervalSec, setSortIntervalSec] = useState<number>(3);
  const [countdown, setCountdown] = useState<number>(3);
  const [isRankFlashing, setIsRankFlashing] = useState<boolean>(false);
  const [columnSortKey, setColumnSortKey] = useState<string | null>(null);
  const [columnSortDir, setColumnSortDir] = useState<'asc' | 'desc'>('desc');

  // Freeze order during active user interaction unless periodic tick applies
  const [rankedPositions, setRankedPositions] = useState<Position[]>(positions);

  // Sorting comparator implementation
  const sortComparator = useMemo(() => {
    return (a: Position, b: Position): number => {
      // If user clicked a specific column header
      if (columnSortKey) {
        let valA: any = (a as any)[columnSortKey];
        let valB: any = (b as any)[columnSortKey];
        if (typeof valA === 'string') {
          return columnSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return columnSortDir === 'asc' ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
      }

      // Default ranking modes
      switch (rankingMode) {
        case 'PROFIT_DESC':
          // Most profitable first (highest positive PnL at top)
          return (b.unrealisedPnl || 0) - (a.unrealisedPnl || 0);
        case 'RISK_ASC':
          // Highest risk / largest loss first (deepest negative PnL at top)
          return (a.unrealisedPnl || 0) - (b.unrealisedPnl || 0);
        case 'MAGNITUDE_DESC':
          // Highest absolute exposure/PnL swing at top
          return Math.abs(b.unrealisedPnl || 0) - Math.abs(a.unrealisedPnl || 0);
        case 'PERCENT_DESC':
          return (b.unrealisedPnlPercent || 0) - (a.unrealisedPnlPercent || 0);
        case 'PERCENT_ASC':
          return (a.unrealisedPnlPercent || 0) - (b.unrealisedPnlPercent || 0);
        default:
          return (b.unrealisedPnl || 0) - (a.unrealisedPnl || 0);
      }
    };
  }, [rankingMode, columnSortKey, columnSortDir]);

  // Function to perform immediate re-rank
  const applySort = () => {
    const sorted = [...positions].sort(sortComparator);
    setRankedPositions(sorted);
    setIsRankFlashing(true);
    setTimeout(() => setIsRankFlashing(false), 600);
  };

  // Immediate sort when positions array size changes or ranking mode switches
  const prevPosLengthRef = useRef(positions.length);
  useEffect(() => {
    if (positions.length !== prevPosLengthRef.current) {
      prevPosLengthRef.current = positions.length;
      applySort();
    }
  }, [positions]);

  useEffect(() => {
    applySort();
    setCountdown(sortIntervalSec);
  }, [rankingMode, columnSortKey, columnSortDir]);

  // Periodic Auto-Sort Timer
  useEffect(() => {
    if (!autoSortEnabled || positions.length <= 1) {
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          applySort();
          return sortIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoSortEnabled, positions, sortComparator, sortIntervalSec]);

  // Keep rankedPositions values (markPrice, notionalUsd, unrealisedPnl) live-updated on every tick while preserving current rank order
  useEffect(() => {
    setRankedPositions((prev) => {
      if (prev.length !== positions.length) {
        return [...positions].sort(sortComparator);
      }
      const posMap = new Map(positions.map((p) => [p.id, p]));
      return prev.map((oldPos) => posMap.get(oldPos.id) || oldPos);
    });
  }, [positions, sortComparator]);

  // Calculate quick metrics for oversight banner
  const { topPerformer, highestRisk, totalUnrealized, totalNotionalUsd, totalMarginUsd } = useMemo(() => {
    if (positions.length === 0) {
      return {
        topPerformer: null,
        highestRisk: null,
        totalUnrealized: 0,
        totalNotionalUsd: 0,
        totalMarginUsd: 0,
      };
    }
    let top = positions[0];
    let risk = positions[0];
    let sum = 0;
    let notionalSum = 0;
    let marginSum = 0;
    positions.forEach((p) => {
      const upnl = p.unrealisedPnl || 0;
      const notional =
        Number.isFinite(p.notionalUsd) && (p.notionalUsd || 0) > 0
          ? (p.notionalUsd as number)
          : Math.abs((p.size || 0) * (p.markPrice || p.entryPrice || 0));
      sum += upnl;
      notionalSum += notional;
      marginSum += p.margin || 0;
      if (upnl > (top.unrealisedPnl || 0)) top = p;
      if (upnl < (risk.unrealisedPnl || 0)) risk = p;
    });
    return {
      topPerformer: top,
      highestRisk: risk,
      totalUnrealized: sum,
      totalNotionalUsd: +notionalSum.toFixed(2),
      totalMarginUsd: +marginSum.toFixed(2),
    };
  }, [positions]);

  // Handle column header clicks
  const handleColumnHeaderClick = (key: string) => {
    if (columnSortKey === key) {
      if (columnSortDir === 'desc') {
        setColumnSortDir('asc');
      } else {
        // Clear column sort and return to rankingMode
        setColumnSortKey(null);
        setColumnSortDir('desc');
      }
    } else {
      setColumnSortKey(key);
      setColumnSortDir('desc');
    }
  };

  const handleClose = async (posId: string) => {
    setClosingId(posId);
    try {
      await onClosePosition(posId);
    } catch (err) {
      console.warn('Close position caught error:', err);
    } finally {
      setClosingId(null);
    }
  };

  const handleHedge = async (sym: string) => {
    setHedgingSymbol(sym);
    try {
      await onAutoHedge(sym);
    } catch (err) {
      console.warn('Auto hedge caught error:', err);
    } finally {
      setHedgingSymbol(null);
    }
  };

  return (
    <div className="space-y-4 font-mono-numbers">
      {/* Tab Switcher & Summary Strip */}
      <div className="panel-delta panel-delta-body flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('POSITIONS')}
            className={`btn-delta ${
              activeTab === 'POSITIONS'
                ? 'btn-toggle-active'
                : 'btn-secondary'
            }`}
          >
            <span>Open Positions ({positions.length})</span>
            {positions.length > 0 && autoSortEnabled && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('HISTORY')}
            className={`btn-delta ${
              activeTab === 'HISTORY'
                ? 'btn-toggle-active'
                : 'btn-secondary'
            }`}
          >
            Closed Trades History ({history.length})
          </button>
        </div>

        <div className="text-xs text-slate-400 flex flex-wrap items-center gap-3">
          <span>Mode: <strong className="text-white">{tradingMode}</strong></span>
          <span className="text-slate-700">·</span>
          <span>Delta Exchange India Engine</span>
          {positions.length > 0 && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-slate-300">
                Position Value:{' '}
                <strong className="text-cyan-300">
                  {currencyPrefix}
                  {(totalNotionalUsd * exchangeRate).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </span>
              <span className="text-slate-700">·</span>
              <span className="text-slate-300">
                Margin Used:{' '}
                <strong className="text-white">
                  {currencyPrefix}
                  {(totalMarginUsd * exchangeRate).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </span>
              <span className="text-slate-700">·</span>
              <span className="text-slate-300">
                Net PnL:{' '}
                <strong className={totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {totalUnrealized >= 0 ? '+' : '-'}
                  {currencyPrefix}
                  {Math.abs(totalUnrealized * exchangeRate).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </span>
            </>
          )}
        </div>
      </div>

      {activeTab === 'POSITIONS' ? (
        <div className="space-y-3">
          {/* ═══════════════════════════════════════════════════════════
              AUTO-SORT & REAL-TIME OVERSIGHT CONTROL PANEL
              ═══════════════════════════════════════════════════════════ */}
          <div className="panel-delta panel-delta-body relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent pointer-events-none" />

            {/* Left Section: Auto-Sort Status & Mode Selector */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Auto-Sort Toggle Button */}
              <button
                type="button"
                onClick={() => {
                  setAutoSortEnabled(!autoSortEnabled);
                  if (!autoSortEnabled) {
                    setCountdown(sortIntervalSec);
                    applySort();
                  }
                }}
                className={`btn-delta select-none ${
                  autoSortEnabled
                    ? 'btn-toggle-active border-emerald-500/50 text-emerald-300 bg-emerald-500/15'
                    : 'btn-secondary'
                }`}
                title={autoSortEnabled ? 'Periodic Auto-Sort Active: ranks positions automatically' : 'Auto-Sort Paused: positions keep current order'}
              >
                {autoSortEnabled ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>AUTO-SORT: ACTIVE</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3 text-slate-400" />
                    <span>AUTO-SORT: PAUSED</span>
                  </>
                )}
              </button>

              {/* Ranking Mode Buttons */}
              <div className="flex items-center gap-1 bg-slate-900/70 p-1 rounded-lg border border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    setColumnSortKey(null);
                    setRankingMode('PROFIT_DESC');
                  }}
                  className={`btn-delta-sm select-none ${
                    rankingMode === 'PROFIT_DESC' && !columnSortKey
                      ? 'btn-toggle-active border-emerald-500/50 text-emerald-300 bg-emerald-500/15'
                      : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                  title="Rank top gainers and most profitable positions first"
                >
                  <TrendingUp className="w-3 h-3 text-emerald-400" />
                  <span>Most Profitable</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setColumnSortKey(null);
                    setRankingMode('RISK_ASC');
                  }}
                  className={`btn-delta-sm select-none ${
                    rankingMode === 'RISK_ASC' && !columnSortKey
                      ? 'btn-danger'
                      : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                  title="Rank deepest drawdowns and highest risk positions first for emergency oversight"
                >
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  <span>Highest Risk</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setColumnSortKey(null);
                    setRankingMode('MAGNITUDE_DESC');
                  }}
                  className={`btn-delta-sm select-none ${
                    rankingMode === 'MAGNITUDE_DESC' && !columnSortKey
                      ? 'btn-toggle-active'
                      : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                  title="Rank by largest absolute dollar swing"
                >
                  <Zap className="w-3 h-3 text-cyan-400" />
                  <span>Volatility</span>
                </button>
              </div>

              {/* Cadence Selector (3s / 5s / 10s) */}
              <div className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-900/70 px-2 py-1 rounded-lg border border-slate-800/80">
                <span className="text-slate-500">Cadence:</span>
                {[3, 5, 10].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => {
                      setSortIntervalSec(sec);
                      setCountdown(sec);
                    }}
                    className={`btn-delta-sm px-2 ${
                      sortIntervalSec === sec
                        ? 'btn-toggle-active'
                        : 'bg-transparent border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
              </div>
            </div>

            {/* Right Section: Telemetry & Manual Re-rank */}
            <div className="flex items-center gap-2 self-end md:self-auto">
              {autoSortEnabled && positions.length > 1 && (
                <div className="badge-delta badge-delta-armed">
                  <RefreshCw className={`w-3 h-3 text-cyan-400 ${countdown === 1 ? 'animate-spin' : ''}`} />
                  <span>Next rank: {countdown}s</span>
                </div>
              )}

              {/* Manual Re-rank Trigger */}
              <button
                type="button"
                onClick={applySort}
                className="btn-delta btn-toggle-active"
                title="Force immediate re-ranking of all open positions"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRankFlashing ? 'animate-spin' : ''}`} />
                <span>Sort Now</span>
              </button>
            </div>
          </div>

          {/* Highlights Header Strip: Top Performer & Highest Risk Oversight */}
          {positions.length > 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {topPerformer && (
                <div className="panel-delta panel-delta-body border-emerald-500/35 bg-gradient-to-r from-emerald-950/30 to-[#0B111E] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                      <Award className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Top Performer</div>
                      <div className="text-white font-bold text-xs">{topPerformer.symbol} ({topPerformer.side})</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-bold text-sm">
                      +{currencyPrefix}{(topPerformer.unrealisedPnl * exchangeRate).toFixed(2)}
                    </div>
                    <div className="text-[10px] text-emerald-500">
                      +{topPerformer.unrealisedPnlPercent.toFixed(2)}%
                    </div>
                  </div>
                </div>
              )}

              {highestRisk && (
                <div className="panel-delta panel-delta-body border-rose-500/35 bg-gradient-to-r from-rose-950/30 to-[#0B111E] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/40">
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </span>
                    <div>
                      <div className="text-[10px] text-rose-400 font-bold uppercase tracking-wider">Highest Risk / Drawdown</div>
                      <div className="text-white font-bold text-xs">{highestRisk.symbol} ({highestRisk.side})</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={highestRisk.unrealisedPnl >= 0 ? 'text-emerald-400 font-bold text-sm' : 'text-rose-400 font-bold text-sm'}>
                      {highestRisk.unrealisedPnl >= 0 ? '+' : '-'}{currencyPrefix}{Math.abs(highestRisk.unrealisedPnl * exchangeRate).toFixed(2)}
                    </div>
                    <div className={highestRisk.unrealisedPnl >= 0 ? 'text-[10px] text-emerald-500' : 'text-[10px] text-rose-500'}>
                      {highestRisk.unrealisedPnlPercent > 0 ? '+' : ''}{highestRisk.unrealisedPnlPercent.toFixed(2)}%
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Active Positions Table */}
          <div className="panel-delta overflow-hidden">
            {positions.length === 0 ? (
              <div className="py-14 px-4 text-center flex flex-col items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mb-3 shadow-inner">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                </div>
                <h3 className="text-white text-sm font-bold tracking-wide font-mono-numbers">
                  0 Active Positions · Portfolio Flat · Awaiting Execution
                </h3>
                <p className="text-slate-400 text-xs mt-1.5 max-w-md leading-relaxed">
                  No active positions open. Execute a trade via Execution Pad or arm Auto-Pilot to establish exposure.
                </p>
                <span className="text-[11px] text-slate-500 font-mono-numbers mt-2 px-2.5 py-1 rounded bg-slate-900/60 border border-slate-800">
                  Zero capital at risk · Delta Exchange India Engine Standby
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 select-none">
                    <tr>
                      <th className="py-2.5 px-3 font-medium text-center w-12">Rank</th>
                      <th
                        onClick={() => handleColumnHeaderClick('symbol')}
                        className="py-2.5 px-4 font-medium cursor-pointer hover:text-white transition"
                      >
                        <div className="flex items-center gap-1">
                          <span>Position / Symbol</span>
                          {columnSortKey === 'symbol' && (
                            <ArrowUpDown className="w-3 h-3 text-cyan-400" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnHeaderClick('size')}
                        className="py-2.5 px-4 font-medium text-right cursor-pointer hover:text-white transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Size</span>
                          {columnSortKey === 'size' && (
                            <ArrowUpDown className="w-3 h-3 text-cyan-400" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnHeaderClick('notionalUsd')}
                        className="py-2.5 px-4 font-medium text-right cursor-pointer hover:text-white transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-cyan-300">Position Value</span>
                          {columnSortKey === 'notionalUsd' && (
                            <ArrowUpDown className="w-3 h-3 text-cyan-400" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnHeaderClick('entryPrice')}
                        className="py-2.5 px-4 font-medium text-right cursor-pointer hover:text-white transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Entry Price</span>
                          {columnSortKey === 'entryPrice' && (
                            <ArrowUpDown className="w-3 h-3 text-cyan-400" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnHeaderClick('markPrice')}
                        className="py-2.5 px-4 font-medium text-right cursor-pointer hover:text-white transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Mark Price</span>
                          {columnSortKey === 'markPrice' && (
                            <ArrowUpDown className="w-3 h-3 text-cyan-400" />
                          )}
                        </div>
                      </th>
                      <th className="py-2.5 px-4 font-medium text-right">Est. Liq Price</th>
                      <th
                        onClick={() => handleColumnHeaderClick('margin')}
                        className="py-2.5 px-4 font-medium text-right cursor-pointer hover:text-white transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Margin</span>
                          {columnSortKey === 'margin' && (
                            <ArrowUpDown className="w-3 h-3 text-cyan-400" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleColumnHeaderClick('unrealisedPnl')}
                        className="py-2.5 px-4 font-medium text-right cursor-pointer hover:text-white transition"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-cyan-300 font-bold">Unrealised P&L</span>
                          {(!columnSortKey || columnSortKey === 'unrealisedPnl') && (
                            <ArrowUpDown className="w-3.5 h-3.5 text-cyan-400" />
                          )}
                        </div>
                      </th>
                      <th className="py-2.5 px-4 font-medium text-right text-emerald-400">TP / SL Protection</th>
                      <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {rankedPositions.map((pos, index) => {
                      const isLong = pos.side === 'LONG';
                      const isProfit = (pos.unrealisedPnl || 0) >= 0;
                      const isTopRanked = index === 0;
                      const posNotionalUsd =
                        Number.isFinite(pos.notionalUsd) && (pos.notionalUsd || 0) > 0
                          ? (pos.notionalUsd as number)
                          : Math.abs((pos.size || 0) * (pos.markPrice || pos.entryPrice || 0));

                      const isOptionSymbol = /^(C|P)-/i.test(pos.symbol);
                      const effectiveTp =
                        pos.takeProfit && pos.takeProfit > 0
                          ? pos.takeProfit
                          : isOptionSymbol
                          ? +(pos.entryPrice * (isLong ? 1.25 : 0.60)).toFixed(2)
                          : +(pos.entryPrice * (isLong ? 1.03 : 0.97)).toFixed(2);
                      const effectiveSl =
                        pos.stopLoss && pos.stopLoss > 0
                          ? pos.stopLoss
                          : isOptionSymbol
                          ? +(pos.entryPrice * (isLong ? 0.70 : 1.30)).toFixed(2)
                          : +(pos.entryPrice * (isLong ? 0.985 : 1.015)).toFixed(2);

                      return (
                        <tr
                          key={pos.id}
                          className={`transition-colors duration-300 ${
                            isTopRanked
                              ? rankingMode === 'RISK_ASC'
                                ? 'bg-rose-950/20 hover:bg-rose-950/30'
                                : 'bg-emerald-950/20 hover:bg-emerald-950/30'
                              : 'hover:bg-slate-900/50'
                          }`}
                        >
                          {/* Rank Column */}
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold font-mono border ${
                                isTopRanked
                                  ? rankingMode === 'RISK_ASC'
                                    ? 'bg-rose-950/80 border-rose-500/70 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                                    : 'bg-emerald-950/80 border-emerald-500/70 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                                  : index === 1
                                  ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-300'
                                  : 'bg-slate-900 border-slate-700/80 text-slate-400'
                              }`}
                            >
                              #{index + 1}
                            </span>
                          </td>

                          {/* Position / Symbol Column */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-white tracking-wide">{pos.symbol}</span>
                              <span className={`badge-delta ${
                                isLong ? 'badge-delta-live' : 'badge-delta-danger'
                              }`}>
                                {pos.side} {pos.leverage}x
                              </span>
                              {isTopRanked && (
                                <span className={`badge-delta ${
                                  rankingMode === 'RISK_ASC'
                                    ? 'badge-delta-danger'
                                    : 'badge-delta-live'
                                }`}>
                                  {rankingMode === 'RISK_ASC' ? 'PRIORITY RISK' : 'TOP GAINER'}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{pos.strategy}</div>
                          </td>

                          {/* Size */}
                          <td className="py-3 px-4 text-right font-semibold text-white">
                            <div>{pos.size} {pos.symbol.replace(/USDT|USD/g, '') || 'units'}</div>
                            {pos.contracts !== undefined && (
                              <div className="text-[10px] text-slate-400 font-normal">
                                {pos.contracts} cont
                              </div>
                            )}
                          </td>

                          {/* Position Value (Notional) */}
                          <td className="py-3 px-4 text-right font-bold text-cyan-300">
                            <div>
                              {currencyPrefix}
                              {(posNotionalUsd * exchangeRate).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            {currencyPrefix === '₹' && (
                              <div className="text-[10px] text-slate-400 font-normal">
                                ${posNotionalUsd.toFixed(2)}
                              </div>
                            )}
                          </td>

                          {/* Entry Price */}
                          <td className="py-3 px-4 text-right text-slate-300">
                            ${pos.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>

                          {/* Mark Price */}
                          <td className="py-3 px-4 text-right font-bold text-white">
                            ${pos.markPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>

                          {/* Est Liq Price */}
                          <td className="py-3 px-4 text-right text-amber-400">
                            ${pos.liquidationPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>

                          {/* Margin */}
                          <td className="py-3 px-4 text-right text-slate-300">
                            {currencyPrefix}
                            {((pos.margin || 0) * exchangeRate).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>

                          {/* Unrealised P&L */}
                          <td className="py-3 px-4 text-right">
                            <div className={`font-bold text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isProfit ? '+' : '-'}
                              {currencyPrefix}
                              {Math.abs((pos.unrealisedPnl || 0) * exchangeRate).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            <div className={`text-[10px] ${isProfit ? 'text-emerald-500' : 'text-rose-500'}`}>
                              ({pos.unrealisedPnlPercent > 0 ? '+' : ''}{pos.unrealisedPnlPercent.toFixed(2)}%)
                            </div>
                          </td>

                          {/* TP / SL Protection */}
                          <td className="py-3 px-4 text-right text-[11px] font-mono">
                            <div className="text-emerald-400 font-bold">
                              TP: ${effectiveTp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              {isOptionSymbol && (
                                <span className="text-[9px] text-emerald-500 ml-1">
                                  ({isLong ? '+25%' : '-40%'})
                                </span>
                              )}
                            </div>
                            <div className="text-rose-400 font-bold">
                              SL: ${effectiveSl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              {isOptionSymbol && (
                                <span className="text-[9px] text-rose-500 ml-1">(-30%)</span>
                              )}
                            </div>
                            <div className="mt-0.5 badge-delta badge-delta-live">
                              reduce_only ARMED
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleHedge(pos.symbol)}
                                disabled={hedgingSymbol === pos.symbol}
                                className="btn-delta-sm btn-toggle-active"
                                title="Auto Hedge: create delta neutral hedge"
                              >
                                Hedge
                              </button>
                              <button
                                onClick={() => handleClose(pos.id)}
                                disabled={closingId === pos.id}
                                className="btn-delta-sm btn-danger"
                                title="Market Close Position immediately"
                              >
                                {closingId === pos.id ? 'Closing...' : 'Close'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Closed Trades History Table */
        <div className="panel-delta overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Symbol / Side</th>
                  <th className="py-2.5 px-4 font-medium text-right">Size</th>
                  <th className="py-2.5 px-4 font-medium text-right">Entry Price</th>
                  <th className="py-2.5 px-4 font-medium text-right">Exit Price</th>
                  <th className="py-2.5 px-4 font-medium text-right">Realised P&L</th>
                  <th className="py-2.5 px-4 font-medium text-right">Return %</th>
                  <th className="py-2.5 px-4 font-medium text-right">Closed Timestamp</th>
                  <th className="py-2.5 px-4 font-medium text-right">Exit Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono-numbers">
                {history.map((tr) => {
                  const isProfit = tr.realisedPnl >= 0;
                  return (
                    <tr key={tr.id} className="hover:bg-slate-900/50 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white">{tr.symbol}</span>
                          <span className={`text-[10px] font-bold px-1 rounded ${
                            tr.side === 'LONG' ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                          }`}>
                            {tr.side}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-300">
                        {tr.size}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400">
                        ${tr.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-white">
                        ${tr.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-bold">
                        <span className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
                          {isProfit ? '+' : '-'}{currencyPrefix}{Math.abs(tr.realisedPnl * exchangeRate).toFixed(2)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold">
                        <span className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
                          {isProfit ? '+' : ''}{tr.pnlPercent.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400 text-[11px]">
                        {new Date(tr.closedAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400 text-[11px]">
                        {tr.reason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

