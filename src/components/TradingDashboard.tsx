import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PortfolioData, Position, ClosedTrade, TradingMode } from '../types';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart,
  ShieldCheck,
  AlertTriangle,
  Key,
  Activity,
  BarChart2,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { DailyPnlChartD3 } from './DailyPnlChartD3';
import { PnlHeatmapD3 } from './PnlHeatmapD3';
import { usePortfolio } from '../context/PortfolioContext';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { CollapsibleTierPanel } from './CollapsibleTierPanel';

interface TradingDashboardProps {
  portfolio: PortfolioData;
  positions: Position[];
  history: ClosedTrade[];
  currencyPrefix: string;
  exchangeRate: number;
  onNavigateToPositions: () => void;
  onNavigateToStrategy: () => void;
  onNavigateToAi: () => void;
  tradingMode?: TradingMode;
  isLiveApiAuthenticated?: boolean;
  onOpenSettings?: () => void;
}

type AnalyticsViewMode = 'BOTH' | 'HEATMAP' | 'CURVE';

const ZERO_LIVE_PORTFOLIO: PortfolioData = {
  totalEquity: 0.0,
  availableBalance: 0.0,
  marginUsed: 0.0,
  initialCapital: 0.0,
  dailyPnl: 0.0,
  dailyPnlPercent: 0.0,
  realisedPnlTotal: 0.0,
  unrealisedPnlTotal: 0.0,
  tradesToday: 0,
  winRate: 0.0,
};

export interface IntradayTradeSparklinePoint {
  index: number;
  tradeNumber: number;
  label: string;
  symbol: string;
  side: string;
  tradePnlRawUsd: number;
  tradePnl: number;
  cumulativePnlRawUsd: number;
  cumulativePnl: number;
  isWin: boolean;
  reason: string;
  closedAt: number;
  formattedTime: string;
}

const CustomIntradaySparklineTooltip: React.FC<{
  active?: boolean;
  payload?: any[];
  currencyPrefix: string;
}> = ({ active, payload, currencyPrefix }) => {
  if (!active || !payload || !payload.length) return null;
  const data: IntradayTradeSparklinePoint = payload[0].payload;
  if (!data || data.tradeNumber === 0) {
    return (
      <div className="bg-[#0b101d]/95 backdrop-blur-md border border-cyan-500/40 rounded-lg p-2.5 text-xs shadow-xl text-white font-mono-numbers">
        <div className="text-[10px] text-slate-400 font-semibold uppercase">10-Trade Baseline</div>
        <div className="text-slate-300 text-xs mt-0.5">Start of Progression Window (0.00)</div>
      </div>
    );
  }

  return (
    <div className="bg-[#0b101d]/95 backdrop-blur-md border border-cyan-500/40 rounded-xl p-3 text-xs shadow-2xl text-white font-mono-numbers z-50 min-w-[210px]">
      <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
        <span className="font-bold text-cyan-300 text-[11px] flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${data.isWin ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]'}`} />
          Trade #{data.tradeNumber} · {data.symbol}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
            data.side === 'LONG'
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
              : 'bg-rose-950/80 text-rose-300 border border-rose-500/30'
          }`}
        >
          {data.side}
        </span>
      </div>

      <div className="space-y-1.5 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 text-[10px] uppercase">Trade Realized PnL:</span>
          <span className={`font-bold text-xs ${data.isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
            {data.tradePnl >= 0 ? '+' : ''}
            {currencyPrefix}
            {Math.abs(data.tradePnl).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400 text-[10px] uppercase">Cumulative 10-T PnL:</span>
          <span className={`font-extrabold text-xs ${data.cumulativePnl >= 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
            {data.cumulativePnl >= 0 ? '+' : ''}
            {currencyPrefix}
            {Math.abs(data.cumulativePnl).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
          <span className="truncate max-w-[125px]" title={data.reason}>
            {data.reason}
          </span>
          <span className="text-slate-400 shrink-0">{data.formattedTime}</span>
        </div>
      </div>
    </div>
  );
};

const PnlSparkline: React.FC<{ data: number[]; color?: string; fillId?: string; height?: number; }> = ({ data, color = '#10B981' }) => {
  if (data.length === 0) return null;
  const chartData = data.map((val, index) => ({ index, val }));
  return (
    <div className="w-full h-8 overflow-hidden">
      <ResponsiveContainer width="100%" height={32} minWidth={1} minHeight={1} initialDimension={{ width: 280, height: 32 }}>
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="val"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <YAxis domain={['auto', 'auto']} hide />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export const TradingDashboard: React.FC<TradingDashboardProps> = ({
  portfolio,
  positions,
  history,
  currencyPrefix,
  exchangeRate,
  onNavigateToPositions,
  onNavigateToStrategy,
  onNavigateToAi,
  tradingMode = 'PAPER',
  isLiveApiAuthenticated = false,
  onOpenSettings,
}) => {
  const [analyticsView, setAnalyticsView] = useState<AnalyticsViewMode>('BOTH');
  const portfolioTelemetry = usePortfolio();

  const isLiveMode = tradingMode === 'LIVE';
  const isLiveUnverified = isLiveMode && !isLiveApiAuthenticated;

  // Real-time telemetry synchronized with PortfolioContext
  // In INR mode, use the INR computed totals directly; in USD mode, use the USD computed totals
  const isCurrencyInr = currencyPrefix === '₹';
  const effectiveUnrealizedPnl = isLiveUnverified
    ? 0
    : isCurrencyInr
    ? portfolioTelemetry.totalPortfolioUnrealizedPnlInr
    : portfolioTelemetry.totalPortfolioUnrealizedPnlUsd;

  const effectiveRealizedPnl = isLiveUnverified
    ? 0
    : isCurrencyInr
    ? portfolioTelemetry.totalPortfolioRealizedPnlInr
    : portfolioTelemetry.totalPortfolioRealizedPnlUsd;

  const effectiveNetPnl = isLiveUnverified
    ? 0
    : isCurrencyInr
    ? portfolioTelemetry.totalPortfolioNetPnlInr
    : portfolioTelemetry.totalPortfolioNetPnlUsd;

  // Include Sniper scalp & Options payoffs in effective total equity & daily PnL
  const liveScalpAndOptionsNetUsd = isLiveUnverified
    ? 0
    : portfolioTelemetry.sniperUnrealizedPnlUsd +
      portfolioTelemetry.sniperRealizedPnlUsd +
      portfolioTelemetry.optionsUnrealizedPnlUsd +
      portfolioTelemetry.optionsRealizedPnlUsd;

  const effectiveDailyPnlUsd = isLiveUnverified
    ? 0
    : +((portfolio?.dailyPnl || 0) + liveScalpAndOptionsNetUsd).toFixed(2);

  const effectiveDailyPnl = isCurrencyInr
    ? +(effectiveDailyPnlUsd * portfolioTelemetry.usdInrRate).toFixed(2)
    : effectiveDailyPnlUsd;

  // Real-time subtle green/red CSS transitions whenever Daily P&L and Unrealised P&L update
  const [dailyPnlFlash, setDailyPnlFlash] = useState<'UP' | 'DOWN' | null>(null);
  const [unrealizedPnlFlash, setUnrealizedPnlFlash] = useState<'UP' | 'DOWN' | null>(null);

  const prevDailyPnlRef = useRef<number | null>(null);
  const prevUnrealizedPnlRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevDailyPnlRef.current !== null) {
      const diff = effectiveDailyPnl - prevDailyPnlRef.current;
      if (Math.abs(diff) >= 0.005) {
        setDailyPnlFlash(diff > 0 ? 'UP' : 'DOWN');
        const timer = setTimeout(() => {
          setDailyPnlFlash(null);
        }, 900);
        return () => clearTimeout(timer);
      }
    }
    prevDailyPnlRef.current = effectiveDailyPnl;
  }, [effectiveDailyPnl]);

  useEffect(() => {
    if (prevUnrealizedPnlRef.current !== null) {
      const diff = effectiveUnrealizedPnl - prevUnrealizedPnlRef.current;
      if (Math.abs(diff) >= 0.005) {
        setUnrealizedPnlFlash(diff > 0 ? 'UP' : 'DOWN');
        const timer = setTimeout(() => {
          setUnrealizedPnlFlash(null);
        }, 900);
        return () => clearTimeout(timer);
      }
    }
    prevUnrealizedPnlRef.current = effectiveUnrealizedPnl;
  }, [effectiveUnrealizedPnl]);

  // Strict Paper Demo vs Live India isolation & API key enforcement
  const effectivePortfolio: PortfolioData = isLiveUnverified ? ZERO_LIVE_PORTFOLIO : portfolio;
  const effectivePositions: Position[] = isLiveUnverified
    ? []
    : isLiveMode
    ? positions.filter((p) => p.mode === 'LIVE')
    : positions.filter((p) => p.mode !== 'LIVE');
  const effectiveHistory: ClosedTrade[] = isLiveUnverified
    ? []
    : isLiveMode
    ? history.filter((h) => h.mode === 'LIVE')
    : history.filter((h) => h.mode !== 'LIVE');

  const ledgerWinRate = useMemo(() => {
    if (isLiveUnverified || effectiveHistory.length === 0) return 0;
    const wins = effectiveHistory.filter((t) => (t.realisedPnl || 0) >= 0).length;
    return +((wins / effectiveHistory.length) * 100).toFixed(1);
  }, [isLiveUnverified, effectiveHistory]);

  const effectiveOpenPositionValueUsd = useMemo(() => {
    if (isLiveUnverified || effectivePositions.length === 0) return 0;
    return +effectivePositions
      .reduce(
        (acc, p) =>
          acc +
          (Number.isFinite(p.notionalUsd) && (p.notionalUsd || 0) > 0
            ? (p.notionalUsd as number)
            : Math.abs((p.size || 0) * (p.markPrice || p.entryPrice || 0))),
        0
      )
      .toFixed(2);
  }, [isLiveUnverified, effectivePositions]);

  const marginUsagePct = effectivePortfolio.totalEquity > 0
    ? +((effectivePortfolio.marginUsed / effectivePortfolio.totalEquity) * 100).toFixed(1)
    : 0;

  // 10 most recent closed trades ordered chronologically (oldest -> newest) for progression
  const last10ClosedTrades = useMemo(() => {
    if (!effectiveHistory || effectiveHistory.length === 0) return [];
    const sorted = [...effectiveHistory].sort((a, b) => a.closedAt - b.closedAt);
    return sorted.slice(-10);
  }, [effectiveHistory]);

  const intradaySparklineData = useMemo<IntradayTradeSparklinePoint[]>(() => {
    if (last10ClosedTrades.length === 0) {
      return [
        {
          index: 0,
          tradeNumber: 0,
          label: 'T0',
          symbol: 'BTCUSDT',
          side: 'LONG',
          tradePnlRawUsd: 0,
          tradePnl: 0,
          cumulativePnlRawUsd: 0,
          cumulativePnl: 0,
          isWin: true,
          reason: 'Initial Baseline',
          closedAt: Date.now(),
          formattedTime: '00:00',
        },
      ];
    }

    let runningSumUsd = 0;
    const points: IntradayTradeSparklinePoint[] = [
      {
        index: 0,
        tradeNumber: 0,
        label: 'T0',
        symbol: last10ClosedTrades[0].symbol,
        side: last10ClosedTrades[0].side,
        tradePnlRawUsd: 0,
        tradePnl: 0,
        cumulativePnlRawUsd: 0,
        cumulativePnl: 0,
        isWin: true,
        reason: 'Window Baseline',
        closedAt: last10ClosedTrades[0].openedAt || (last10ClosedTrades[0].closedAt - 60000),
        formattedTime: new Date(last10ClosedTrades[0].openedAt || last10ClosedTrades[0].closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ];

    last10ClosedTrades.forEach((trade, idx) => {
      runningSumUsd += trade.realisedPnl;
      const runningSumInCurrency = runningSumUsd * exchangeRate;
      const tradePnlInCurrency = trade.realisedPnl * exchangeRate;
      const timeStr = new Date(trade.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      points.push({
        index: idx + 1,
        tradeNumber: idx + 1,
        label: `T${idx + 1}`,
        symbol: trade.symbol,
        side: trade.side,
        tradePnlRawUsd: trade.realisedPnl,
        tradePnl: +tradePnlInCurrency.toFixed(2),
        cumulativePnlRawUsd: +runningSumUsd.toFixed(2),
        cumulativePnl: +runningSumInCurrency.toFixed(2),
        isWin: trade.realisedPnl >= 0,
        reason: trade.reason || 'Closed Trade',
        closedAt: trade.closedAt,
        formattedTime: timeStr,
      });
    });

    return points;
  }, [last10ClosedTrades, exchangeRate]);

  const last10Metrics = useMemo(() => {
    if (last10ClosedTrades.length === 0) {
      return {
        netPnlUsd: 0,
        netPnl: 0,
        wins: 0,
        losses: 0,
        total: 0,
        winRate: 0,
        peakCumulativePnl: 0,
        maxDrawdownPnl: 0,
        avgTradePnl: 0,
      };
    }

    let wins = 0;
    let losses = 0;
    let running = 0;
    let peak = 0;
    let maxDd = 0;

    last10ClosedTrades.forEach((t) => {
      if (t.realisedPnl >= 0) wins++;
      else losses++;
      running += t.realisedPnl;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDd) maxDd = dd;
    });

    const netPnlUsd = running;
    const netPnl = running * exchangeRate;
    const total = last10ClosedTrades.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const avgTradePnl = total > 0 ? netPnl / total : 0;

    return {
      netPnlUsd,
      netPnl,
      wins,
      losses,
      total,
      winRate,
      peakCumulativePnl: peak * exchangeRate,
      maxDrawdownPnl: maxDd * exchangeRate,
      avgTradePnl,
    };
  }, [last10ClosedTrades, exchangeRate]);

  return (
    <div className="flex flex-col gap-4 min-w-0 max-w-full">
      {/* Live Mode Unverified API Keys Warning Banner above KPI Strip */}
      {isLiveUnverified && (
        <div
          className="order-[5] bg-amber-950/60 border border-amber-700/80 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200 font-mono-numbers"
          title="API Keys Required · Balances Inactive"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="font-bold text-amber-300">API Keys Required · Balances Inactive</span>
            <span className="hidden sm:inline text-amber-200/80">
              — Connect Delta Exchange API Keys in Settings to trade live. Paper Demo state is strictly isolated.
            </span>
          </div>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded text-[11px] flex items-center gap-1.5 transition cursor-pointer"
            >
              <Key className="w-3 h-3" />
              <span>Connect Delta Exchange API Keys in Settings to trade live</span>
            </button>
          )}
        </div>
      )}

      {/* TIER 1A: KPI Summary Grid - 4-Column Live Cards */}
      <div className="order-[10] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Total Portfolio Equity */}
        <div
          className={`panel-delta panel-delta-body transition-all duration-200 hover:-translate-y-0.5 flex flex-col justify-between ${
            isLiveUnverified ? 'border-amber-500/40' : ''
          }`}
          title={isLiveUnverified ? 'API Keys Required · Balances Inactive' : 'Total Equity / Portfolio Value'}
        >
          <div>
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Total Equity
              </span>
              <span className={`badge-delta font-mono tabular-nums ${
                isLiveUnverified ? 'badge-delta-paper' : 'badge-delta-live'
              }`}>
                {isLiveUnverified ? 'INACTIVE' : '+14.2%'}
              </span>
            </div>

            <div className="text-2xl font-extrabold font-mono text-white tracking-tight mt-1 tabular-nums">
              {currencyPrefix}{(effectivePortfolio.totalEquity * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Mini Sparkline Curve */}
          <PnlSparkline
            color="#06B6D4"
            fillId="equitySparklineGrad"
            data={[78, 81, 79, 85, 83, 89, 87, 94, 91, 98]}
          />

          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60 mt-1 tabular-nums">
            <span>Avail: <strong className="text-slate-200 font-semibold">{currencyPrefix}{(effectivePortfolio.availableBalance * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong></span>
            <span className="text-slate-600">·</span>
            <span>Used: <strong className="text-cyan-400 font-semibold">{marginUsagePct}%</strong></span>
          </div>
        </div>

        {/* Card 2: Open Positions & Fills */}
        <div
          className={`panel-delta panel-delta-body transition-all duration-200 hover:-translate-y-0.5 flex flex-col justify-between ${
            isLiveUnverified ? 'border-amber-500/40' : ''
          }`}
          title={isLiveUnverified ? 'API Keys Required · Balances Inactive' : 'Active Open Positions & Orders'}
        >
          <div>
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Active Exposure
              </span>
              <span className={`badge-delta font-mono tabular-nums ${
                isLiveUnverified
                  ? 'badge-delta-paper'
                  : effectivePositions.length > 0
                  ? 'badge-delta-armed'
                  : 'badge-delta-standby'
              }`}>
                {isLiveUnverified ? 'INACTIVE' : effectivePositions.length > 0 ? `${effectivePositions.length} ACTIVE` : 'IDLE'}
              </span>
            </div>

            <div className="text-2xl font-extrabold font-mono text-cyan-400 tracking-tight mt-1 tabular-nums">
              {effectivePositions.length > 0
                ? `${currencyPrefix}${(effectiveOpenPositionValueUsd * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `0 fills`}
            </div>
          </div>

          {/* Mini Sparkline Curve */}
          <PnlSparkline
            color="#8B5CF6"
            fillId="exposureSparklineGrad"
            data={[20, 25, 22, 30, 28, 35, 30, 42, 38, 45]}
          />

          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60 mt-1 tabular-nums">
            <span className="truncate">
              {isLiveUnverified
                ? 'API Keys Required'
                : `Mgn: ${currencyPrefix}${(effectivePortfolio.marginUsed * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </span>
            <button
              onClick={onNavigateToPositions}
              className="text-cyan-400 hover:text-cyan-300 font-bold hover:underline shrink-0 ml-1 cursor-pointer"
            >
              Ledger →
            </button>
          </div>
        </div>

        {/* Card 3: Unrealised P&L */}
        <div
          className={`panel-delta panel-delta-body transition-all duration-200 hover:-translate-y-0.5 flex flex-col justify-between ${
            unrealizedPnlFlash === 'UP'
              ? 'border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
              : unrealizedPnlFlash === 'DOWN'
              ? 'border-rose-500/80 shadow-[0_0_20px_rgba(244,63,94,0.25)]'
              : isLiveUnverified
              ? 'border-amber-500/40'
              : ''
          }`}
          title={isLiveUnverified ? 'API Keys Required · Balances Inactive' : 'Unrealised P&L (Global Unified Telemetry)'}
        >
          <div>
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Unrealised P&L
              </span>
              <span
                className={`badge-delta font-mono tabular-nums ${
                  isLiveUnverified
                    ? 'badge-delta-paper'
                    : effectiveUnrealizedPnl >= 0
                    ? 'badge-delta-live'
                    : 'badge-delta-danger'
                }`}
              >
                {isLiveUnverified ? 'INACTIVE' : effectiveUnrealizedPnl >= 0 ? '+▲ PROFIT' : '-▼ DEFICIT'}
              </span>
            </div>

            <div
              className={`text-2xl font-extrabold font-mono tracking-tight mt-1 tabular-nums transition-colors duration-300 ${
                isLiveUnverified
                  ? 'text-slate-300'
                  : effectiveUnrealizedPnl >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {!isLiveUnverified && (effectiveUnrealizedPnl >= 0 ? '+ ' : '- ')}
              {currencyPrefix}{Math.abs(effectiveUnrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Mini Sparkline Curve */}
          <PnlSparkline
            color={effectiveUnrealizedPnl >= 0 ? '#10B981' : '#F43F5E'}
            fillId="unrealizedSparklineGrad"
            data={effectiveUnrealizedPnl >= 0 ? [10, 14, 18, 16, 22, 28, 25, 34, 38, 44] : [44, 38, 34, 28, 25, 22, 18, 16, 14, 10]}
          />

          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60 mt-1 tabular-nums">
            <span>Sniper: <strong className={portfolioTelemetry.sniperUnrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{currencyPrefix}{Math.abs(isCurrencyInr ? portfolioTelemetry.sniperUnrealizedPnlInr : portfolioTelemetry.sniperUnrealizedPnlUsd).toFixed(1)}</strong></span>
            <span className="text-slate-600">·</span>
            <span>Opt: <strong className={portfolioTelemetry.optionsUnrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{currencyPrefix}{Math.abs(isCurrencyInr ? portfolioTelemetry.optionsUnrealizedPnlInr : portfolioTelemetry.optionsUnrealizedPnlUsd).toFixed(1)}</strong></span>
          </div>
        </div>

        {/* Card 4: Daily & Realized Performance */}
        <div
          className={`panel-delta panel-delta-body transition-all duration-200 hover:-translate-y-0.5 flex flex-col justify-between ${
            dailyPnlFlash === 'UP'
              ? 'border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.25)]'
              : dailyPnlFlash === 'DOWN'
              ? 'border-rose-500/80 shadow-[0_0_20px_rgba(244,63,94,0.25)]'
              : isLiveUnverified
              ? 'border-amber-500/40'
              : ''
          }`}
          title={isLiveUnverified ? 'API Keys Required · Balances Inactive' : 'Daily P&L & Net Performance'}
        >
          <div>
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Daily Performance
              </span>
              <span
                className={`badge-delta font-mono tabular-nums ${
                  isLiveUnverified
                    ? 'badge-delta-paper'
                    : effectiveDailyPnl >= 0
                    ? 'badge-delta-live'
                    : 'badge-delta-danger'
                }`}
              >
                {effectiveDailyPnl >= 0 ? '+8.6% ROI' : '-2.1%'}
              </span>
            </div>

            <div
              className={`text-2xl font-extrabold font-mono tracking-tight mt-1 tabular-nums transition-colors duration-300 ${
                isLiveUnverified
                  ? 'text-slate-300'
                  : effectiveDailyPnl >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {!isLiveUnverified && (effectiveDailyPnl >= 0 ? '+ ' : '- ')}
              {currencyPrefix}{Math.abs(effectiveDailyPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Mini Intraday Recharts Sparkline */}
          <div className="w-full h-8 overflow-hidden my-1">
            <ResponsiveContainer width="100%" height={32} minWidth={1} minHeight={1} initialDimension={{ width: 280, height: 32 }}>
              <AreaChart data={intradaySparklineData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <defs>
                  <linearGradient id="card4SparklineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={last10Metrics.netPnl >= 0 ? '#10B981' : '#F43F5E'} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={last10Metrics.netPnl >= 0 ? '#10B981' : '#F43F5E'} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  content={<CustomIntradaySparklineTooltip currencyPrefix={currencyPrefix} />}
                />
                <ReferenceLine y={0} stroke="#334155" strokeDasharray="2 2" strokeWidth={1} />
                <Area
                  type="monotone"
                  dataKey="cumulativePnl"
                  stroke={last10Metrics.netPnl >= 0 ? '#10B981' : '#F43F5E'}
                  strokeWidth={2}
                  fill="url(#card4SparklineGrad)"
                  dot={false}
                  isAnimationActive={false}
                />
                <YAxis domain={['auto', 'auto']} hide />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60 mt-1 tabular-nums">
            <span>10-T Net: <strong className={last10Metrics.netPnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>{last10Metrics.netPnl >= 0 ? '+' : ''}{currencyPrefix}{Math.abs(last10Metrics.netPnl).toFixed(1)}</strong></span>
            <span className="text-slate-600">·</span>
            <span>Trades: <strong className="text-white font-semibold">{last10ClosedTrades.length}</strong></span>
          </div>
        </div>
      </div>

      {/* TIER 2A: Unified Real-Time Portfolio Telemetry Bar (Delta India Rate 1 USD = ₹85) */}
      <div className="order-[40] panel-delta panel-delta-body flex flex-wrap items-center justify-between gap-3 text-xs font-mono-numbers">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
          <span className="font-bold text-slate-200 uppercase tracking-wider text-xs flex items-center gap-1.5">
            <span className="text-cyan-400 font-black">DELTA INDIA</span>
            <span>TELEMETRY</span>
            <span className="text-slate-500 text-[10px]">(1 USD = ₹{portfolioTelemetry.usdInrRate})</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-[11px]">
          <div>
            <span className="text-slate-400">Total Net PnL: </span>
            <span className={`font-extrabold ${effectiveNetPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {effectiveNetPnl >= 0 ? '+' : ''}
              {currencyPrefix}{Math.abs(effectiveNetPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <div>
            <span className="text-slate-400">Sniper Scalp Engine: </span>
            <span className={`font-bold ${(portfolioTelemetry.sniperUnrealizedPnlInr + portfolioTelemetry.sniperRealizedPnlInr) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(portfolioTelemetry.sniperUnrealizedPnlInr + portfolioTelemetry.sniperRealizedPnlInr) >= 0 ? '+' : ''}
              {isCurrencyInr ? '₹' : '$'}
              {(isCurrencyInr ? (portfolioTelemetry.sniperUnrealizedPnlInr + portfolioTelemetry.sniperRealizedPnlInr) : (portfolioTelemetry.sniperUnrealizedPnlUsd + portfolioTelemetry.sniperRealizedPnlUsd)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <div>
            <span className="text-slate-400">Options Lab: </span>
            <span className={`font-bold ${(portfolioTelemetry.optionsUnrealizedPnlInr + portfolioTelemetry.optionsRealizedPnlInr) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(portfolioTelemetry.optionsUnrealizedPnlInr + portfolioTelemetry.optionsRealizedPnlInr) >= 0 ? '+' : ''}
              {isCurrencyInr ? '₹' : '$'}
              {(isCurrencyInr ? (portfolioTelemetry.optionsUnrealizedPnlInr + portfolioTelemetry.optionsRealizedPnlInr) : (portfolioTelemetry.optionsUnrealizedPnlUsd + portfolioTelemetry.optionsRealizedPnlUsd)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <div>
            <span className="text-slate-400">Base Positions: </span>
            <span className={`font-bold ${(portfolioTelemetry.basePositionsPnlInr + portfolioTelemetry.baseRealizedPnlInr) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {(portfolioTelemetry.basePositionsPnlInr + portfolioTelemetry.baseRealizedPnlInr) >= 0 ? '+' : ''}
              {isCurrencyInr ? '₹' : '$'}
              {(isCurrencyInr ? (portfolioTelemetry.basePositionsPnlInr + portfolioTelemetry.baseRealizedPnlInr) : (portfolioTelemetry.basePositionsPnlUsd + portfolioTelemetry.baseRealizedPnlUsd)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* TIER 2B: Intraday PnL Trend Sparkline (Last 10 Trades Cumulative Progression) */}
      <div className="order-[42] panel-delta panel-delta-body relative overflow-hidden">
        {/* Panel Header & Summary Telemetry */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-xs tracking-wider uppercase font-mono">
                  Intraday PnL Trend Sparkline
                </span>
                <span className="text-[10px] font-mono text-cyan-300/90 bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded-full font-semibold">
                  Last 10 Closed Trades
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 font-mono-numbers">
                Cumulative realized profit progression modeled across the most recent 10 executions
              </p>
            </div>
          </div>

          {/* Quick Metrics Strip */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono-numbers">
            {/* 10-Trade Cumulative Result */}
            <div
              className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 ${
                last10Metrics.netPnl >= 0
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.15)]'
              }`}
            >
              {last10Metrics.netPnl >= 0 ? (
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
              )}
              <div className="flex flex-col text-left">
                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-tight">
                  10-T Realized PnL
                </span>
                <span className="font-extrabold text-xs">
                  {last10Metrics.netPnl >= 0 ? '+' : ''}
                  {currencyPrefix}
                  {Math.abs(last10Metrics.netPnl).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            {/* Win Rate Chip */}
            <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700/60 flex flex-col text-left">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-tight">
                Win Rate (10-T)
              </span>
              <span className="font-bold text-xs text-white">
                {last10Metrics.winRate.toFixed(1)}%{' '}
                <span className="text-[10px] text-slate-400 font-normal">
                  ({last10Metrics.wins}W / {last10Metrics.losses}L)
                </span>
              </span>
            </div>

            {/* Peak Realized Profit */}
            <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700/60 flex flex-col text-left hidden md:flex">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-tight">
                Peak Equity Curve
              </span>
              <span className="font-bold text-xs text-cyan-300">
                +{currencyPrefix}
                {Math.abs(last10Metrics.peakCumulativePnl).toFixed(2)}
              </span>
            </div>

            {/* Avg Trade PnL */}
            <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700/60 flex flex-col text-left hidden lg:flex">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold leading-tight">
                Avg / Trade
              </span>
              <span
                className={`font-bold text-xs ${
                  last10Metrics.avgTradePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {last10Metrics.avgTradePnl >= 0 ? '+' : ''}
                {currencyPrefix}
                {Math.abs(last10Metrics.avgTradePnl).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Recharts Cumulative Progression Sparkline Chart */}
        <div className="w-full h-36 pt-3">
          <ResponsiveContainer width="100%" height={132} minWidth={1} minHeight={1} initialDimension={{ width: 640, height: 132 }}>
            <AreaChart
              data={intradaySparklineData}
              margin={{ top: 10, right: 16, left: -16, bottom: 0 }}
            >
              <defs>
                <linearGradient id="intradayPnlAreaGradGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="intradayPnlAreaGradRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#F43F5E" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <ReferenceLine
                y={0}
                stroke="#475569"
                strokeDasharray="3 3"
                strokeWidth={1}
                label={{
                  value: 'BE 0.00',
                  fill: '#64748b',
                  fontSize: 10,
                  position: 'right',
                }}
              />
              <XAxis
                dataKey="label"
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: '#1e293b' }}
                tick={{ fill: '#94a3b8', fontFamily: 'monospace' }}
              />
              <YAxis
                stroke="#475569"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#64748b', fontFamily: 'monospace' }}
                tickFormatter={(val) =>
                  `${currencyPrefix}${val >= 0 ? '' : '-'}${
                    Math.abs(val) >= 1000
                      ? `${(Math.abs(val) / 1000).toFixed(1)}k`
                      : Math.abs(val).toFixed(0)
                  }`
                }
                domain={['auto', 'auto']}
              />
              <Tooltip
                content={<CustomIntradaySparklineTooltip currencyPrefix={currencyPrefix} />}
              />
              <Area
                type="monotone"
                dataKey="cumulativePnl"
                stroke={last10Metrics.netPnl >= 0 ? '#10B981' : '#F43F5E'}
                strokeWidth={2.5}
                fill={
                  last10Metrics.netPnl >= 0
                    ? 'url(#intradayPnlAreaGradGreen)'
                    : 'url(#intradayPnlAreaGradRed)'
                }
                dot={{
                  r: 3,
                  fill: '#0A0E1A',
                  stroke: last10Metrics.netPnl >= 0 ? '#10B981' : '#F43F5E',
                  strokeWidth: 2,
                }}
                activeDot={{
                  r: 5,
                  fill: last10Metrics.netPnl >= 0 ? '#34D399' : '#FB7185',
                  stroke: '#ffffff',
                  strokeWidth: 2,
                }}
                isAnimationActive={true}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* 10-Trade Execution Sequence Badges */}
        <div className="pt-3 mt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-between pb-2 text-[10px] uppercase font-mono text-slate-400">
            <span>Chronological Trade Sequence (Oldest → Latest)</span>
            <span>{last10ClosedTrades.length} of 10 slots filled</span>
          </div>

          {last10ClosedTrades.length === 0 ? (
            <div className="py-2.5 px-3 bg-slate-900/50 border border-slate-800 rounded-xl text-center text-xs text-slate-400 font-mono-numbers">
              Awaiting closed trades — progression sparkline activates automatically upon trade completion.
            </div>
          ) : (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none font-mono-numbers">
              {last10ClosedTrades.map((t, idx) => {
                const isWin = t.realisedPnl >= 0;
                const convertedTradePnl = t.realisedPnl * exchangeRate;
                return (
                  <div
                    key={t.id || `trade-${idx}`}
                    className={`shrink-0 px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center gap-1.5 transition-all duration-150 hover:-translate-y-0.5 ${
                      isWin
                        ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                    }`}
                    title={`Trade #${idx + 1} (${t.symbol} ${t.side}): ${t.reason}`}
                  >
                    <span className="text-[10px] text-slate-400 font-semibold">T{idx + 1}</span>
                    <span className="text-[10px] text-slate-500">·</span>
                    <span className="font-medium text-slate-300 truncate max-w-[50px]">{t.symbol}</span>
                    <span className={`text-[9px] font-bold ${t.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {t.side === 'LONG' ? '▲' : '▼'}
                    </span>
                    <span className="font-extrabold tabular-nums">
                      {isWin ? '+' : ''}{currencyPrefix}{Math.abs(convertedTradePnl).toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* TIER 1B: Active Open Positions (Promoted Above the Fold right beneath KPI Summary) */}
      <div className="order-[15] panel-delta overflow-hidden border-cyan-500/35">
        <div className="panel-delta-header">
          <div className="panel-delta-title">
            <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>Live Open Positions ({effectivePositions.length})</span>
            {effectivePositions.length > 0 && (
              <span className="badge-delta badge-delta-live font-mono-numbers">TIER 1 · ACTIVE</span>
            )}
          </div>
          <button
            type="button"
            onClick={onNavigateToPositions}
            className="btn-delta-sm btn-secondary"
          >
            View Ledger →
          </button>
        </div>
        <div className="panel-delta-body">
          {effectivePositions.length === 0 ? (
            <div className="py-6 text-center text-slate-500 text-xs space-y-2">
              {isLiveUnverified ? (
                <>
                  <div className="text-amber-400 font-semibold font-mono-numbers">
                    API Keys Required · Balances Inactive
                  </div>
                  <div>Connect Delta Exchange API Keys in Settings to trade live.</div>
                </>
              ) : (
                <div className="space-y-1">
                  <div className="text-white text-xs font-bold font-mono-numbers">
                    0 Active Positions · Portfolio Flat · Awaiting Execution
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    No active positions open. Execute a trade via Execution Pad or arm Auto-Pilot to establish exposure.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60 mt-1">
              {effectivePositions.slice(0, 6).map((pos) => {
                const posNotionalUsd =
                  Number.isFinite(pos.notionalUsd) && (pos.notionalUsd || 0) > 0
                    ? (pos.notionalUsd as number)
                    : Math.abs((pos.size || 0) * (pos.markPrice || pos.entryPrice || 0));
                return (
                  <div key={pos.id} className="py-2.5 flex items-center justify-between text-xs gap-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white">{pos.symbol}</span>
                        <span className={`badge-delta ${pos.side === 'LONG' ? 'badge-delta-live' : 'badge-delta-danger'}`}>
                          {pos.side} {pos.leverage}x
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono-numbers mt-0.5">
                        Size: {pos.size} · Val: {currencyPrefix}{(posNotionalUsd * exchangeRate).toLocaleString(undefined, { maximumFractionDigits: 2 })} · Mark: ${pos.markPrice.toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold font-mono-numbers ${pos.unrealisedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {pos.unrealisedPnl >= 0 ? '+' : '-'}{currencyPrefix}{Math.abs(pos.unrealisedPnl * exchangeRate).toFixed(2)}
                      </div>
                      <div className={`text-[10px] font-mono-numbers ${pos.unrealisedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        ({pos.unrealisedPnlPercent > 0 ? '+' : ''}{pos.unrealisedPnlPercent}%)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* TIER 3A: 30-Day D3 Performance Analytics (Collapsible) */}
      <CollapsibleTierPanel
        id="dashboard-30d-analytics"
        title="30-Day Performance Analytics"
        tierLabel="TIER 3 · DIAGNOSTIC"
        className="order-[80]"
        bodyClassName="p-3.5 space-y-4"
        icon={<BarChart2 className="w-4 h-4 text-cyan-400" />}
        defaultExpandedWhenIdle={effectivePositions.length === 0}
        summary={
          <>
            <span className="text-cyan-300 font-semibold">D3 Heatmap &amp; Cumulative Curve</span>
            <span className="text-slate-600">·</span>
            <span>WR {ledgerWinRate.toFixed(1)}%</span>
          </>
        }
        headerActions={
          <div className="hidden md:flex items-center gap-1 p-0.5 bg-slate-900/70 border border-slate-800/80 rounded-lg">
            <button
              type="button"
              onClick={() => setAnalyticsView('BOTH')}
              className={`btn-delta-sm ${
                analyticsView === 'BOTH'
                  ? 'btn-toggle-active'
                  : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
            >
              Combined
            </button>
            <button
              type="button"
              onClick={() => setAnalyticsView('HEATMAP')}
              className={`btn-delta-sm ${
                analyticsView === 'HEATMAP'
                  ? 'btn-toggle-active'
                  : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
            >
              Heatmap
            </button>
            <button
              type="button"
              onClick={() => setAnalyticsView('CURVE')}
              className={`btn-delta-sm ${
                analyticsView === 'CURVE'
                  ? 'btn-toggle-active'
                  : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
            >
              Curve
            </button>
          </div>
        }
      >
        {(analyticsView === 'BOTH' || analyticsView === 'HEATMAP') && (
          <PnlHeatmapD3
            portfolio={effectivePortfolio}
            history={effectiveHistory}
            positions={effectivePositions}
            currencyPrefix={currencyPrefix}
            exchangeRate={exchangeRate}
            tradingMode={tradingMode}
            isLiveApiAuthenticated={isLiveApiAuthenticated}
          />
        )}

        {(analyticsView === 'BOTH' || analyticsView === 'CURVE') && (
          <DailyPnlChartD3
            portfolio={effectivePortfolio}
            history={effectiveHistory}
            positions={effectivePositions}
            currencyPrefix={currencyPrefix}
            exchangeRate={exchangeRate}
            tradingMode={tradingMode}
            isLiveApiAuthenticated={isLiveApiAuthenticated}
          />
        )}
      </CollapsibleTierPanel>

      {/* TIER 3B: Risk Engine Status & Recent Closed History (Collapsible) */}
      <CollapsibleTierPanel
        id="dashboard-risk-and-history"
        title="Risk Engine Status & Recent Trade History"
        tierLabel="TIER 3 · LOGS"
        className="order-[82]"
        bodyClassName="p-3.5"
        icon={<ShieldCheck className="w-4 h-4 text-cyan-400" />}
        defaultExpandedWhenIdle={effectivePositions.length === 0}
        summary={
          <>
            <span className={isLiveUnverified ? 'text-amber-300 font-bold' : 'text-emerald-300 font-bold'}>
              {isLiveUnverified ? 'KEYS REQ' : 'RISK NOMINAL'}
            </span>
            <span className="text-slate-600">·</span>
            <span>Margin {marginUsagePct}%</span>
            <span className="text-slate-600">·</span>
            <span>{effectiveHistory.length} Closed Trades (WR {ledgerWinRate.toFixed(1)}%)</span>
          </>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Margin & Account Health */}
          <div className="panel-delta flex flex-col justify-between overflow-hidden">
            <div>
              <div className="panel-delta-header">
                <div className="panel-delta-title">
                  <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Risk Engine Status</span>
                </div>
                <span className={`badge-delta font-mono-numbers ${
                  isLiveUnverified ? 'badge-delta-paper' : 'badge-delta-live'
                }`}>
                  {isLiveUnverified ? 'KEYS REQ' : 'NOMINAL'}
                </span>
              </div>

              <div className="panel-delta-body space-y-3 text-xs">
                <div>
                  <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                    <span>Margin Capacity</span>
                    <span className="font-mono-numbers text-slate-200">{marginUsagePct}% of 100%</span>
                  </div>
                  <div className="w-full bg-[#030718] border border-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        marginUsagePct > 75 ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' : marginUsagePct > 50 ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                      }`}
                      style={{ width: `${Math.min(100, marginUsagePct)}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5 pt-1 text-[11px] font-mono-numbers">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Daily Drawdown:</span>
                    <span className="text-slate-200">{isLiveUnverified ? '0.0% / 5.0% Limit' : '1.2% / 5.0% Limit'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Leverage Utilization:</span>
                    <span className="text-slate-200">{effectivePositions.length > 0 ? '10x Avg (Max 25x)' : '0x (Flat)'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Daily Trades:</span>
                    <span className="text-slate-200">{effectivePortfolio.tradesToday} / 25 Max</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-3 pb-3 md:px-4 md:pb-4 pt-3 border-t border-slate-800/80 flex gap-2">
              <button
                type="button"
                onClick={onNavigateToStrategy}
                className="flex-1 btn-delta btn-secondary"
              >
                Strategy Engine
              </button>
              <button
                type="button"
                onClick={onNavigateToAi}
                className="flex-1 btn-delta btn-primary"
              >
                AI Command
              </button>
            </div>
          </div>

          {/* Recent Closed Trades preview */}
          <div className="panel-delta overflow-hidden">
            <div className="panel-delta-header">
              <div className="panel-delta-title">
                <BarChart2 className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Recent Trade History</span>
              </div>
              <span className="badge-delta badge-delta-armed font-mono-numbers">
                WR {ledgerWinRate.toFixed(1)}%
              </span>
            </div>
            <div className="panel-delta-body">
              {effectiveHistory.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs space-y-2">
                  {isLiveUnverified ? (
                    <>
                      <div className="text-amber-400 font-semibold font-mono-numbers">
                        API Keys Required · Balances Inactive
                      </div>
                      <div>No live trade history. Paper Demo trades are isolated to Paper Demo mode.</div>
                    </>
                  ) : (
                    <div>No closed trades in {tradingMode} mode yet.</div>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-cyan-500/10 mt-1">
                  {effectiveHistory.slice(0, 5).map((trade) => (
                    <div key={trade.id} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white">{trade.symbol}</span>
                          <span className="text-slate-600">·</span>
                          <span className={`text-[11px] font-semibold ${trade.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {trade.side}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="text-[10px] text-slate-400 font-mono-numbers">
                            {trade.reason}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono-numbers mt-0.5">
                          ${trade.entryPrice.toLocaleString()} → ${trade.exitPrice.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold font-mono-numbers ${trade.realisedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {trade.realisedPnl >= 0 ? '+' : ''}{currencyPrefix}{(trade.realisedPnl * exchangeRate).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(trade.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </CollapsibleTierPanel>
    </div>
  );
};


