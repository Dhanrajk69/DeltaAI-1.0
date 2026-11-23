import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Download,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Database,
  AlertTriangle,
  Clock,
  Activity,
  Layers,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

type HistoricalSymbol = 'BTCUSD' | 'ETHUSD' | 'SOLUSD' | 'XRPUSD' | 'DOGEUSD' | 'AVAXUSD';
type HistoricalTimeframe = '5m' | '15m' | '1h' | '4h';
type StrategyMode =
  | 'CAMARILLA_CPR_SNIPER'
  | 'AI_MATRIX_CONSENSUS'
  | 'EMA_9_21_MOMENTUM_5M'
  | 'WAREHOUSE_SIGNALS_REPLAY';

interface BacktestEquityPoint {
  time: number;
  timestampIso: string;
  equityUsd: number;
  cumulativePnlUsd: number;
  drawdownPct: number;
}

interface BacktestTradeRow {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  strategyMode: StrategyMode;
  entryTime: number;
  exitTime: number;
  entryTimeIso: string;
  exitTimeIso: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  contracts: number;
  notionalUsd: number;
  grossPnlUsd: number;
  feeUsd: number;
  gstUsd: number;
  slippageUsd: number;
  netPnlUsd: number;
  netPnlInr: number;
  rMultiple: number;
  exitReason: 'TP_HIT' | 'SL_HIT' | 'BE_STOP' | 'END_OF_RANGE';
  signalId?: string;
  grade?: string;
}

interface BacktestSummary {
  symbol: string;
  timeframe: string;
  days: number;
  strategyMode: StrategyMode;
  candlesCount: number;
  startIso: string;
  endIso: string;
  initialCapitalUsd: number;
  finalEquityUsd: number;
  netProfitUsd: number;
  netProfitInr: number;
  returnPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  maxDrawdownUsd: number;
  sharpeRatio: number;
  totalFeesUsd: number;
  totalGstUsd: number;
  totalSlippageUsd: number;
  avgWinUsd: number;
  avgLossUsd: number;
  expectancyUsd: number;
  signalsMatchedCount?: number;
  usdInrRate: number;
  note?: string;
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTradeRow[];
}

interface WatchdogStatus {
  running: boolean;
  intervalMs: number;
  slBreachTolerancePct: number;
  maxNegativeR: number;
  lastCheckAt: number;
  activeStops: Array<{
    symbol: string;
    side: 'LONG' | 'SHORT';
    contracts: number;
    entryPrice: number;
    stopLossPrice: number;
    slOrderId?: string | number | null;
  }>;
  recentExecutions: Array<{
    id: string;
    timestamp: number;
    symbol: string;
    side: 'LONG' | 'SHORT';
    markPrice: number;
    stopLossPrice: number;
    reason: string;
    ok: boolean;
  }>;
}

interface DeltaHistoricalBacktesterProps {
  currencyPrefix: string;
  exchangeRate: number;
}

const SYMBOLS: HistoricalSymbol[] = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'AVAXUSD'];
const TIMEFRAMES: HistoricalTimeframe[] = ['5m', '15m', '1h', '4h'];
const DATE_RANGES: Array<{ days: number; label: string }> = [
  { days: 7, label: '7D' },
  { days: 14, label: '14D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
];

const STRATEGY_MODES: Array<{ value: StrategyMode; label: string; desc: string }> = [
  {
    value: 'CAMARILLA_CPR_SNIPER',
    label: 'Camarilla CPR Sniper',
    desc: 'H4/L4 breakout + CPR width regime + VWAP & EMA9/20 alignment',
  },
  {
    value: 'EMA_9_21_MOMENTUM_5M',
    label: 'EMA 9/21 Momentum Cross (5m Sniper)',
    desc: '5m bar-close EMA 9/21 cross + EMA21 slope + VWAP & 15m EMA50 + ADX>=20 · 1.2x ATR SL, 60% @ +100pt (0.0236% maker incl. GST), Entry±$35 BE, 40% EMA21 -> +220pt',
  },
  {
    value: 'AI_MATRIX_CONSENSUS',
    label: 'AI Matrix Consensus',
    desc: 'EMA 9/20/50 trend stack + VWAP pullback reclaim + RSI & ATR risk sizing',
  },
  {
    value: 'WAREHOUSE_SIGNALS_REPLAY',
    label: 'Cloud Warehouse Signals Replay',
    desc: 'Replays archived signals from signals_archive.jsonl bar-by-bar against Delta OHLCV',
  },
];

function formatCompactUtc(iso: string): string {
  if (!iso) return '-';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
  if (!m) return iso;
  return `${m[2]}-${m[3]} ${m[4]}`;
}

export const DeltaHistoricalBacktester: React.FC<DeltaHistoricalBacktesterProps> = ({
  currencyPrefix,
  exchangeRate,
}) => {
  const [symbol, setSymbol] = useState<HistoricalSymbol>('BTCUSD');
  const [timeframe, setTimeframe] = useState<HistoricalTimeframe>('15m');
  const [days, setDays] = useState<number>(14);
  const [strategyMode, setStrategyMode] = useState<StrategyMode>('CAMARILLA_CPR_SNIPER');
  const [initialCapitalUsd, setInitialCapitalUsd] = useState<number>(1000);
  const [leverage, setLeverage] = useState<number>(10);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [candleSource, setCandleSource] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState<boolean>(false);
  const [watchdog, setWatchdog] = useState<WatchdogStatus | null>(null);

  const isInr = currencyPrefix === '₹';
  const fxRate = summary?.usdInrRate || exchangeRate || 89;

  const fetchWatchdogStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/delta/watchdog-status?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'x-admin-email': 'dhanrajk69@gmail.com' },
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.success) setWatchdog(json);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const runBacktest = useCallback(
    async (forceRefresh = false) => {
      setIsRunning(true);
      setError(null);
      try {
        const res = await fetch('/api/delta/backtest/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-email': 'dhanrajk69@gmail.com',
          },
          body: JSON.stringify({
            symbol,
            timeframe,
            days,
            strategyMode,
            initialCapitalUsd,
            leverage,
            riskPerTradePct: 1.0,
            forceRefresh,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || `Backtest request failed (${res.status})`);
        }
        setSummary(json.summary);
        setCandleSource(json.candleSource || 'DELTA_EXCHANGE_INDIA');
        setFromCache(Boolean(json.fromCache));
      } catch (err: any) {
        setError(err?.message || 'Unable to execute Delta Exchange India historical backtest.');
      } finally {
        setIsRunning(false);
      }
    },
    [symbol, timeframe, days, strategyMode, initialCapitalUsd, leverage]
  );

  useEffect(() => {
    void fetchWatchdogStatus();
    const timer = window.setInterval(() => void fetchWatchdogStatus(), 15_000);
    return () => window.clearInterval(timer);
  }, [fetchWatchdogStatus]);

  useEffect(() => {
    void runBacktest(false);
    // Run once on initial mount with default parameters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExportCsv = async () => {
    if (!summary || summary.trades.length === 0) return;
    setIsExporting(true);
    try {
      const res = await fetch('/api/delta/backtest/export-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-email': 'dhanrajk69@gmail.com',
        },
        body: JSON.stringify({
          symbol: summary.symbol,
          timeframe: summary.timeframe,
          strategyMode: summary.strategyMode,
          trades: summary.trades,
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/i);
      const filename =
        fnMatch?.[1] ||
        `deltaai-backtest-${summary.symbol}-${summary.timeframe}-${new Date().toISOString().slice(0, 10)}.csv`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } finally {
      setIsExporting(false);
    }
  };

  const chartData = useMemo(() => {
    if (!summary?.equityCurve) return [];
    return summary.equityCurve.map((pt) => ({
      label: formatCompactUtc(pt.timestampIso),
      equity: isInr ? +(pt.equityUsd * fxRate).toFixed(2) : pt.equityUsd,
      cumulativePnl: isInr ? +(pt.cumulativePnlUsd * fxRate).toFixed(2) : pt.cumulativePnlUsd,
      drawdownPct: -Math.abs(pt.drawdownPct),
    }));
  }, [summary, isInr, fxRate]);

  const formatMoney = (usd: number) => {
    const val = isInr ? usd * fxRate : usd;
    const sign = val > 0 ? '+' : val < 0 ? '-' : '';
    return `${sign}${currencyPrefix}${Math.abs(val).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const activeStrategyInfo = STRATEGY_MODES.find((m) => m.value === strategyMode);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4 shadow-xl min-w-0 max-w-full">
      {/* Header & Server-Side Hard Drawdown Watchdog Badge */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 border-b border-slate-800/80 pb-3.5 min-w-0">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <BarChart3 className="w-4 h-4 text-cyan-400 shrink-0" />
            <h3 className="text-sm sm:text-base font-bold text-slate-100 tracking-tight break-words">
              Delta Exchange India Historical Backtester & Warehouse Replay
            </h3>
            <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-mono font-semibold text-cyan-300 uppercase tracking-wider max-w-full truncate">
              Real /v2/history/candles OHLCV
            </span>
          </div>
          <p className="text-xs text-slate-400 break-words">
            Candle-by-candle simulation with exact Delta India Taker fees (0.059%) + 18% GST + 2 bps slippage. Disk-cached in{' '}
            <span className="font-mono text-slate-300 break-all">DELTAAI_DATA_DIR/candles-cache/</span>.
          </p>
        </div>

        {/* Server-side Hard Stop Watchdog Strip */}
        <div className="flex flex-wrap items-center gap-2 bg-slate-950/80 border border-emerald-500/25 rounded-lg px-3 py-2 shrink-0 max-w-full">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="text-[11px] leading-tight min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 font-semibold text-emerald-300">
              <span>Hard Stop Watchdog</span>
              <span className="font-mono text-[10px] text-emerald-400/90">
                10s · &gt;0.15% SL / -1.5R
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono break-words">
              {watchdog
                ? `${watchdog.activeStops.length} Live SL Guarded · ${watchdog.recentExecutions.length} Watchdog Closes`
                : 'Connecting to watchdog telemetry...'}
            </div>
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
        {/* Symbol */}
        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Symbol
          </label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value as HistoricalSymbol)}
            className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono font-semibold text-slate-100 focus:outline-none focus:border-cyan-500"
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Timeframe */}
        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Timeframe
          </label>
          <div className="grid grid-cols-4 gap-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`py-1.5 rounded text-[11px] font-mono font-semibold transition-colors ${
                  timeframe === tf
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/50'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Date Range */}
        <div className="md:col-span-2">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Date Range
          </label>
          <div className="grid grid-cols-4 gap-1">
            {DATE_RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setDays(r.days)}
                className={`py-1.5 rounded text-[11px] font-mono font-semibold transition-colors ${
                  days === r.days
                    ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-400/50'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Strategy Mode */}
        <div className="md:col-span-3">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            Strategy Engine
          </label>
          <select
            value={strategyMode}
            onChange={(e) => {
              const nextMode = e.target.value as StrategyMode;
              setStrategyMode(nextMode);
              if (nextMode === 'EMA_9_21_MOMENTUM_5M') {
                setTimeframe('5m');
              }
            }}
            className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-100 focus:outline-none focus:border-cyan-500"
          >
            {STRATEGY_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Capital & Leverage + Run */}
        <div className="md:col-span-3 flex items-end gap-2">
          <div className="w-24">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Capital ($)
            </label>
            <input
              type="number"
              min={50}
              max={1000000}
              step={100}
              value={initialCapitalUsd}
              onChange={(e) => setInitialCapitalUsd(Math.max(50, Number(e.target.value) || 1000))}
              className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="w-16">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Lev
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={leverage}
              onChange={(e) =>
                setLeverage(Math.max(1, Math.min(20, Number(e.target.value) || 10)))
              }
              className="w-full bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            disabled={isRunning}
            onClick={() => void runBacktest(false)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors whitespace-nowrap"
          >
            {isRunning ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>{isRunning ? 'Simulating...' : 'Run Backtest'}</span>
          </button>
        </div>
      </div>

      {/* Strategy description & action metadata row */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>{activeStrategyInfo?.desc}</span>
        </div>
        <div className="flex items-center gap-2">
          {summary && (
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700">
              {summary.candlesCount.toLocaleString()} bars ·{' '}
              {fromCache ? 'Disk Cache' : candleSource === 'DELTA_EXCHANGE_INDIA' ? 'Live Delta API' : 'Synced'}
            </span>
          )}
          <button
            type="button"
            disabled={isRunning}
            onClick={() => void runBacktest(true)}
            className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded px-2 py-1 transition-colors"
            title="Force refresh historical OHLCV candles from Delta Exchange India"
          >
            <RefreshCw className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} />
            <span>Refresh OHLCV</span>
          </button>
          <button
            type="button"
            disabled={!summary || summary.trades.length === 0 || isExporting}
            onClick={() => void handleExportCsv()}
            className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 border border-emerald-500/30 rounded px-2.5 py-1 font-medium transition-colors"
          >
            <Download className="w-3 h-3" />
            <span>{isExporting ? 'Exporting...' : 'Export CSV Log'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary?.note && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs rounded-lg px-3 py-2">
          <Database className="w-4 h-4 shrink-0 text-amber-400" />
          <span>{summary.note}</span>
        </div>
      )}

      {/* KPI Metrics Grid */}
      {summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {/* Net Profit */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Net Profit ({isInr ? '₹' : '$'})
              </div>
              <div
                className={`mt-1 text-base font-mono font-bold ${
                  summary.netProfitUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatMoney(summary.netProfitUsd)}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                {summary.returnPct >= 0 ? '+' : ''}
                {summary.returnPct.toFixed(2)}% ·{' '}
                {isInr
                  ? `$${summary.netProfitUsd.toFixed(2)}`
                  : `₹${summary.netProfitInr.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              </div>
            </div>

            {/* Win Rate */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Win Rate
              </div>
              <div
                className={`mt-1 text-base font-mono font-bold ${
                  summary.winRatePct >= 50 ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {summary.winRatePct.toFixed(1)}%
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                {summary.wins}W / {summary.losses}L ({summary.totalTrades} trades)
              </div>
            </div>

            {/* Profit Factor */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Profit Factor
              </div>
              <div
                className={`mt-1 text-base font-mono font-bold ${
                  summary.profitFactor >= 1.5
                    ? 'text-emerald-400'
                    : summary.profitFactor >= 1.0
                    ? 'text-cyan-300'
                    : 'text-rose-400'
                }`}
              >
                {summary.profitFactor.toFixed(2)}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                Exp: {formatMoney(summary.expectancyUsd)}/trade
              </div>
            </div>

            {/* Max Drawdown */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Max Drawdown
              </div>
              <div className="mt-1 text-base font-mono font-bold text-rose-400">
                -{summary.maxDrawdownPct.toFixed(2)}%
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                Peak Drop: {currencyPrefix}
                {(isInr ? summary.maxDrawdownUsd * fxRate : summary.maxDrawdownUsd).toFixed(2)}
              </div>
            </div>

            {/* Sharpe Ratio */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Sharpe Ratio
              </div>
              <div
                className={`mt-1 text-base font-mono font-bold ${
                  summary.sharpeRatio >= 1.2
                    ? 'text-emerald-400'
                    : summary.sharpeRatio >= 0
                    ? 'text-slate-100'
                    : 'text-rose-400'
                }`}
              >
                {summary.sharpeRatio.toFixed(2)}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                Annualized (365d)
              </div>
            </div>

            {/* Delta India Fees + GST + Slippage */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Fees + 18% GST + Slip
              </div>
              <div className="mt-1 text-base font-mono font-bold text-amber-300">
                -{currencyPrefix}
                {(
                  (summary.totalFeesUsd + summary.totalGstUsd + summary.totalSlippageUsd) *
                  (isInr ? fxRate : 1)
                ).toFixed(2)}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                Fee ${summary.totalFeesUsd.toFixed(2)} · GST ${summary.totalGstUsd.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Equity Curve & Drawdown Overlay */}
          <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs font-semibold text-slate-200">
                  Simulated Equity Curve & Drawdown Overlay ({summary.symbol} · {summary.timeframe} · {summary.days}D)
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" /> Equity ({currencyPrefix})
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-400" /> Drawdown (%)
                </span>
              </div>
            </div>

            {chartData.length > 1 ? (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="btEquityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                      minTickGap={34}
                      axisLine={{ stroke: '#334155' }}
                    />
                    <YAxis
                      yAxisId="equity"
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                      width={62}
                      domain={['auto', 'auto']}
                      axisLine={{ stroke: '#334155' }}
                    />
                    <YAxis
                      yAxisId="dd"
                      orientation="right"
                      tick={{ fill: '#fb7185', fontSize: 10 }}
                      width={42}
                      domain={[-Math.max(5, Math.ceil(summary.maxDrawdownPct * 1.3)), 0]}
                      tickFormatter={(v) => `${v}%`}
                      axisLine={{ stroke: '#334155' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '8px',
                        fontSize: '11px',
                      }}
                      formatter={(value: any, name: any) => {
                        if (name === 'equity') {
                          return [`${currencyPrefix}${Number(value).toLocaleString()}`, 'Equity'];
                        }
                        if (name === 'drawdownPct') {
                          return [`${Number(value).toFixed(2)}%`, 'Drawdown'];
                        }
                        return [value, String(name ?? '')];
                      }}
                    />
                    <ReferenceLine
                      yAxisId="equity"
                      y={isInr ? +(summary.initialCapitalUsd * fxRate).toFixed(2) : summary.initialCapitalUsd}
                      stroke="#475569"
                      strokeDasharray="4 4"
                    />
                    <Area
                      yAxisId="equity"
                      type="monotone"
                      dataKey="equity"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      fill="url(#btEquityGrad)"
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="dd"
                      type="monotone"
                      dataKey="drawdownPct"
                      stroke="#fb7185"
                      strokeWidth={1.3}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-xs text-slate-500">
                No equity curve points available for the selected range.
              </div>
            )}
          </div>

          {/* Simulated Trade Log Table */}
          <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-semibold text-slate-200">
                  Simulated Trade Log ({summary.trades.length} fills)
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                Avg Win {formatMoney(summary.avgWinUsd)} · Avg Loss {formatMoney(summary.avgLossUsd)}
              </span>
            </div>

            {summary.trades.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No simulated trades triggered under {activeStrategyInfo?.label} in this {summary.days}D window.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-900/95 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-2.5">Entry / Exit (UTC)</th>
                      <th className="py-2 px-2.5">Side</th>
                      <th className="py-2 px-2.5 text-right">Entry</th>
                      <th className="py-2 px-2.5 text-right">Exit</th>
                      <th className="py-2 px-2.5 text-right">Cts</th>
                      <th className="py-2 px-2.5 text-right">Fee+GST</th>
                      <th className="py-2 px-2.5 text-right">R-Mult</th>
                      <th className="py-2 px-2.5 text-right">Net PnL</th>
                      <th className="py-2 px-2.5">Exit Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-[11px] font-mono">
                    {summary.trades
                      .slice()
                      .reverse()
                      .slice(0, 120)
                      .map((tr) => {
                        const isWin = tr.netPnlUsd > 0;
                        return (
                          <tr key={tr.id} className="hover:bg-slate-900/70 transition-colors">
                            <td className="py-1.5 px-2.5 text-slate-300 whitespace-nowrap">
                              <div>{formatCompactUtc(tr.entryTimeIso)}</div>
                              <div className="text-[10px] text-slate-500">
                                → {formatCompactUtc(tr.exitTimeIso)}
                              </div>
                            </td>
                            <td className="py-1.5 px-2.5">
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  tr.side === 'LONG'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-rose-500/15 text-rose-300'
                                }`}
                              >
                                {tr.side === 'LONG' ? (
                                  <TrendingUp className="w-2.5 h-2.5" />
                                ) : (
                                  <TrendingDown className="w-2.5 h-2.5" />
                                )}
                                {tr.side}
                              </span>
                            </td>
                            <td className="py-1.5 px-2.5 text-right text-slate-200">
                              ${tr.entryPrice.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-2.5 text-right text-slate-200">
                              ${tr.exitPrice.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-2.5 text-right text-slate-300">{tr.contracts}</td>
                            <td className="py-1.5 px-2.5 text-right text-amber-300/90">
                              -${(tr.feeUsd + tr.gstUsd).toFixed(2)}
                            </td>
                            <td
                              className={`py-1.5 px-2.5 text-right font-semibold ${
                                tr.rMultiple >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {tr.rMultiple >= 0 ? '+' : ''}
                              {tr.rMultiple.toFixed(2)}R
                            </td>
                            <td
                              className={`py-1.5 px-2.5 text-right font-bold whitespace-nowrap ${
                                isWin ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {formatMoney(tr.netPnlUsd)}
                            </td>
                            <td className="py-1.5 px-2.5">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  tr.exitReason === 'TP_HIT'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : tr.exitReason === 'BE_STOP'
                                    ? 'bg-cyan-500/15 text-cyan-300'
                                    : tr.exitReason === 'SL_HIT'
                                    ? 'bg-rose-500/15 text-rose-300'
                                    : 'bg-slate-700/60 text-slate-300'
                                }`}
                              >
                                {tr.exitReason.replace(/_/g, ' ')}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
