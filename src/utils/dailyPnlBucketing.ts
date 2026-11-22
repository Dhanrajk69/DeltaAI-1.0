import type { ClosedTrade, PortfolioData, Position, TradingMode } from '../types.ts';

export type CalendarTimezoneMode = 'IST' | 'UTC';

export interface DailyPnlBucketPoint {
  date: Date;
  dateKey: string; // Canonical YYYY-MM-DD in selected timezone (IST or UTC)
  dateStr: string; // e.g., "Nov 19, 2026"
  shortDate: string; // e.g., "Nov 19"
  isToday: boolean;
  dailyPnl: number; // Scaled by exchangeRate (past days = realized only; today = realized + floating unrealized)
  realizedPnl: number; // Scaled by exchangeRate (closed fills only)
  unrealizedPnl: number; // Scaled by exchangeRate (strictly 0 for past days; floating PnL strictly on TODAY LIVE)
  dailyPnlPct: number;
  cumulativePnl: number;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  openPositionsCount: number; // Strictly 0 for past days; active positions count strictly on TODAY LIVE
  topStrategy: string;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats an epoch timestamp (ms) into canonical `YYYY-MM-DD` in IST (`Asia/Kolkata`) or `UTC`.
 */
export function formatDateKeyInTimezone(ms: number, timezone: CalendarTimezoneMode = 'IST'): string {
  const tz = timezone === 'UTC' ? 'UTC' : 'Asia/Kolkata';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));

  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

/**
 * Resolves a trade's exact completion timestamp in epoch milliseconds.
 * Returns `null` when a trade lacks a valid timestamp so it is NEVER dumped into TODAY.
 */
export function resolveTradeClosedTimestampMs(trade: Partial<ClosedTrade> & Record<string, any>): number | null {
  if (!trade || typeof trade !== 'object') return null;

  const candidates = [trade.created_at, trade.closedAt, trade.timestamp];
  for (const raw of candidates) {
    if (raw === null || raw === undefined || raw === '') continue;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      if (raw > 1e14) return Math.floor(raw / 1000); // microseconds
      if (raw < 1e12) return Math.floor(raw * 1000); // seconds
      return raw;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (/^\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (Number.isFinite(num) && num > 0) {
          if (num > 1e14) return Math.floor(num / 1000);
          if (num < 1e12) return Math.floor(num * 1000);
          return num;
        }
      }
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }

  return null;
}

function buildDateKeyOffset(baseDateKey: string, offsetDays: number): {
  dateKey: string;
  date: Date;
  shortDate: string;
  dateStr: string;
} {
  const [y, m, d] = baseDateKey.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + offsetDays, 12, 0, 0));
  const year = utcDate.getUTCFullYear();
  const monthIdx = utcDate.getUTCMonth();
  const day = utcDate.getUTCDate();
  const dateKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const shortDate = `${MONTH_SHORT[monthIdx]} ${day}`;
  const dateStr = `${MONTH_SHORT[monthIdx]} ${day}, ${year}`;
  return { dateKey, date: utcDate, shortDate, dateStr };
}

function inferTopStrategyForDay(trades: ClosedTrade[], isLiveMode: boolean): string {
  if (trades.length === 0) {
    return isLiveMode ? 'No Closed Fills' : 'Inactive / Standby';
  }
  const counts = new Map<string, number>();
  for (const t of trades) {
    const label =
      t.reason && t.reason.trim().length > 0
        ? t.reason.trim()
        : t.symbol.startsWith('C-') || t.symbol.startsWith('P-')
        ? 'Delta Options Execution'
        : 'Delta Perpetual Execution';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  let bestLabel = trades[0].reason || 'Live Delta Execution';
  let bestCount = -1;
  for (const [label, cnt] of counts.entries()) {
    if (cnt > bestCount) {
      bestCount = cnt;
      bestLabel = label;
    }
  }
  return bestLabel;
}

export interface BuildDailyPnlSeriesParams {
  portfolio: Pick<PortfolioData, 'initialCapital' | 'dailyPnl' | 'unrealisedPnlTotal' | 'tradesToday' | 'winRate'>;
  history: ClosedTrade[];
  positions?: Position[];
  exchangeRate: number;
  tradingMode: TradingMode;
  isLiveApiAuthenticated: boolean;
  days?: number;
  timezone?: CalendarTimezoneMode;
  nowMs?: number;
}

/**
 * Builds a synchronized 30-day calendar PnL series for both the 30-Day Heatmap and Daily PnL Curve:
 * - Groups completed closed fills by their exact `YYYY-MM-DD` date in IST/UTC (never dumping
 *   timestamp-less trades into TODAY).
 * - Computes every past day's realized PnL, wins, losses, and win rate strictly from that day's closed fills.
 * - Reserves floating unrealized PnL (and open position count) strictly for `TODAY LIVE`.
 */
export function buildSynchronized30DayPnlSeries(params: BuildDailyPnlSeriesParams): DailyPnlBucketPoint[] {
  const {
    portfolio,
    history,
    positions = [],
    exchangeRate,
    tradingMode,
    isLiveApiAuthenticated,
    days = 30,
    timezone = 'IST',
    nowMs = Date.now(),
  } = params;

  const isLiveMode = tradingMode === 'LIVE';
  const isLiveInactive = isLiveMode && !isLiveApiAuthenticated;
  const todayKey = formatDateKeyInTimezone(nowMs, timezone);
  const baseCap = portfolio.initialCapital > 0 ? portfolio.initialCapital : 1000;

  // Group valid timestamped closed fills by canonical YYYY-MM-DD date key
  const bucketMap = new Map<string, ClosedTrade[]>();
  const relevantHistory = Array.isArray(history)
    ? history.filter((t) => {
        if (!t) return false;
        if (isLiveMode) return t.mode === 'LIVE' || t.source === 'DELTA_FILL';
        return t.mode !== 'LIVE';
      })
    : [];

  for (const trade of relevantHistory) {
    const closedMs = resolveTradeClosedTimestampMs(trade);
    // Strictly skip timestamp-less trades rather than dumping them into TODAY
    if (closedMs === null) continue;
    const key = formatDateKeyInTimezone(closedMs, timezone);
    const list = bucketMap.get(key);
    if (list) list.push(trade);
    else bucketMap.set(key, [trade]);
  }

  // Only show demo offsets in PAPER mode when no real paper closed trades exist yet
  const usePaperDemoBaseline = !isLiveMode && relevantHistory.length === 0;
  const paperDemoStrategies = [
    'Intraday Sniper Scalper',
    'Bull Call Spread (Options)',
    'Iron Condor Theta Engine',
    'VWAP + EMA Momentum',
    'AI Command Setup',
  ];
  const paperDemoOffsets = [
    185.4, -92.3, 310.8, 145.2, -64.5, 420.0, 275.6, -138.0, 195.4, 340.2,
    -85.0, 225.8, 490.5, -175.2, 160.0, 290.4, 380.1, -110.6, 245.0, 515.8,
    -95.4, 175.0, 305.2, -142.8, 280.6, 410.5, 190.2, -78.5, 365.0,
  ];

  // Calculate live unrealized floating PnL strictly for TODAY LIVE
  const openPositionsCount = isLiveInactive ? 0 : positions.length;
  const liveFloatingUnrealizedUsd = isLiveInactive
    ? 0
    : typeof portfolio.unrealisedPnlTotal === 'number' && Number.isFinite(portfolio.unrealisedPnlTotal)
    ? portfolio.unrealisedPnlTotal
    : positions.reduce((sum, p) => sum + (Number(p.unrealisedPnl) || 0), 0);

  const points: DailyPnlBucketPoint[] = [];
  let runningCumulative = 0;

  for (let i = days - 1; i >= 0; i--) {
    const { dateKey, date, shortDate, dateStr } = buildDateKeyOffset(todayKey, -i);
    const isToday = i === 0;
    const dayTrades = isLiveInactive ? [] : bucketMap.get(dateKey) || [];

    let realizedUsd = 0;
    let unrealizedUsd = 0;
    let tradesCount = 0;
    let wins = 0;
    let losses = 0;
    let winRate = 0;
    let topStrategy = isLiveMode ? 'No Closed Fills' : 'Inactive / Standby';

    if (isLiveInactive) {
      realizedUsd = 0;
      unrealizedUsd = 0;
    } else if (usePaperDemoBaseline && !isToday) {
      realizedUsd = paperDemoOffsets[(days - 1 - i) % paperDemoOffsets.length];
      tradesCount = Math.max(3, Math.round(5 + Math.abs(Math.sin(i * 1.7)) * 9));
      winRate = realizedUsd >= 0 ? Math.round(66 + (i % 22)) : Math.round(38 + (i % 15));
      wins = Math.round((tradesCount * winRate) / 100);
      losses = Math.max(0, tradesCount - wins);
      topStrategy = paperDemoStrategies[(days - 1 - i) % paperDemoStrategies.length];
    } else {
      // Exact date-bucketed closed fills for this calendar day
      tradesCount = dayTrades.length;
      for (const t of dayTrades) {
        const pnl = Number(t.realisedPnl) || 0;
        realizedUsd += pnl;
        if (pnl > 0) wins += 1;
        else if (pnl < 0) losses += 1;
      }
      realizedUsd = Number(realizedUsd.toFixed(2));
      winRate = tradesCount > 0 ? Math.round((wins / tradesCount) * 100) : 0;
      topStrategy = inferTopStrategyForDay(dayTrades, isLiveMode);

      if (isToday) {
        // Reserve floating unrealized PnL strictly for TODAY LIVE
        unrealizedUsd = Number(liveFloatingUnrealizedUsd.toFixed(2));
        if (tradesCount === 0 && openPositionsCount > 0) {
          topStrategy = `${openPositionsCount} Open Live Position${openPositionsCount === 1 ? '' : 's'}`;
        }
      }
    }

    const netUsd = Number((realizedUsd + unrealizedUsd).toFixed(2));
    const scaledNet = Number((netUsd * exchangeRate).toFixed(2));
    const scaledRealized = Number((realizedUsd * exchangeRate).toFixed(2));
    const scaledUnrealized = Number((unrealizedUsd * exchangeRate).toFixed(2));
    runningCumulative = Number((runningCumulative + scaledNet).toFixed(2));
    const dailyPct =
      isLiveInactive || baseCap <= 0 ? 0 : Number(((netUsd / baseCap) * 100).toFixed(2));

    points.push({
      date,
      dateKey,
      dateStr,
      shortDate,
      isToday,
      dailyPnl: scaledNet,
      realizedPnl: scaledRealized,
      unrealizedPnl: scaledUnrealized,
      dailyPnlPct: dailyPct,
      cumulativePnl: runningCumulative,
      tradesCount,
      wins,
      losses,
      winRate,
      openPositionsCount: isToday ? openPositionsCount : 0,
      topStrategy,
    });
  }

  return points;
}
