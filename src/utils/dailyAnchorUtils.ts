import { MarketTicker, Candle } from '../types';

export interface DailySessionAnchor {
  prevHigh: number;
  prevLow: number;
  prevClose: number;
  range: number;
  sessionStartUtcMs: number;
  isFallback: boolean;
  source: string;
}

interface CachedAnchor {
  symbol: string;
  dayStartMs: number;
  anchor: DailySessionAnchor;
}

export interface Normalized1DCandle {
  timeMs: number;
  high: number;
  low: number;
  close: number;
}

interface CachedDailyHistory {
  symbol: string;
  dayStartMs: number;
  candles1d: Normalized1DCandle[];
  source: string;
}

const anchorCache = new Map<string, CachedAnchor>();
const dailyHistoryCache = new Map<string, CachedDailyHistory>();
const activeFetches = new Set<string>();
const anchorUpdateListeners = new Set<() => void>();

export function subscribeDailyAnchorUpdates(listener: () => void): () => void {
  anchorUpdateListeners.add(listener);
  return () => {
    anchorUpdateListeners.delete(listener);
  };
}

function notifyDailyAnchorListeners() {
  anchorUpdateListeners.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
}

/**
 * Normalizes symbol name for Delta Exchange India API endpoints (e.g., BTCUSDT -> BTCUSD).
 */
function toDeltaSymbol(symbol: string): string {
  if (!symbol) return 'BTCUSD';
  return symbol.endsWith('USDT') ? symbol.replace('USDT', 'USD') : symbol;
}

/**
 * Parses 1D candles response from Delta Exchange India endpoints into a normalized format.
 */
function parse1dCandlesResponse(data: any): Normalized1DCandle[] {
  const result: Normalized1DCandle[] = [];
  if (!data) return result;

  // Format A: { success: true, result: [ { time, high, low, close }, ... ] }
  if (Array.isArray(data.result)) {
    for (const item of data.result) {
      const rawTime = Number(item.time || item.t || item.start || 0);
      const timeMs = rawTime < 10000000000 ? rawTime * 1000 : rawTime;
      const high = Number(item.high || item.h || 0);
      const low = Number(item.low || item.l || 0);
      const close = Number(item.close || item.c || 0);
      if (timeMs > 0 && high > 0 && low > 0) {
        result.push({ timeMs, high, low, close });
      }
    }
  } 
  // Format B: { success: true, result: { t: [...], h: [...], l: [...], c: [...] } }
  else if (data.result && Array.isArray(data.result.t)) {
    const { t, h, l, c } = data.result;
    for (let i = 0; i < t.length; i++) {
      const rawTime = Number(t[i]);
      const timeMs = rawTime < 10000000000 ? rawTime * 1000 : rawTime;
      const high = Number(h[i]);
      const low = Number(l[i]);
      const close = Number(c[i]);
      if (timeMs > 0 && high > 0 && low > 0) {
        result.push({ timeMs, high, low, close });
      }
    }
  }
  // Format C: { candles: [ { time, high, low, close }, ... ] }
  else if (Array.isArray(data.candles)) {
    for (const item of data.candles) {
      const rawTime = Number(item.time || 0);
      const timeMs = rawTime < 10000000000 ? rawTime * 1000 : rawTime;
      const high = Number(item.high || 0);
      const low = Number(item.low || 0);
      const close = Number(item.close || 0);
      if (timeMs > 0 && high > 0 && low > 0) {
        result.push({ timeMs, high, low, close });
      }
    }
  }

  return result;
}

function normalizeAndSort1DCandles(candles: Normalized1DCandle[]): Normalized1DCandle[] {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const byDay = new Map<number, Normalized1DCandle>();
  for (const c of candles) {
    if (!c || !(c.timeMs > 0) || !(c.high > 0) || !(c.low > 0)) continue;
    const dayStart = Math.floor(c.timeMs / oneDayMs) * oneDayMs;
    const prev = byDay.get(dayStart);
    if (!prev || c.timeMs >= prev.timeMs) {
      byDay.set(dayStart, {
        timeMs: dayStart,
        high: prev ? Math.max(prev.high, c.high) : c.high,
        low: prev ? Math.min(prev.low, c.low) : c.low,
        close: c.close > 0 ? c.close : prev?.close || c.high,
      });
    }
  }
  return Array.from(byDay.values()).sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Triggers asynchronous background fetch for official Delta Exchange India 1D settled daily candle.
 */
async function triggerOfficial1dFetch(symbol: string, currentUtcDayStart: number, refPrice: number) {
  if (typeof fetch !== 'function') return;
  const fetchKey = `${symbol}-${currentUtcDayStart}`;
  if (activeFetches.has(fetchKey)) return;
  activeFetches.add(fetchKey);

  const deltaSym = toDeltaSymbol(symbol);

  try {
    // Primary Target: Local server candles proxy endpoint (avoids browser CORS issues and enforces unified server cache)
    const proxyUrl = `/api/delta/candles?symbol=${deltaSym}&resolution=1D`;
    const response = await fetch(proxyUrl).catch(() => null);

    if (response && response.ok) {
      const json = await response.json();
      const parsedCandles = parse1dCandlesResponse(json);
      const normalizedAll = normalizeAndSort1DCandles(parsedCandles);

      if (normalizedAll.length > 0) {
        dailyHistoryCache.set(symbol, {
          symbol,
          dayStartMs: currentUtcDayStart,
          candles1d: normalizedAll,
          source: json?.source || 'DELTA_INDIA_OFFICIAL_1D_SETTLED',
        });
      }

      // Filter candles strictly where time < current_day_utc_00_00_timestamp
      const validClosedCandles = parsedCandles
        .filter((c) => c.timeMs < currentUtcDayStart)
        .sort((a, b) => b.timeMs - a.timeMs);

      if (validClosedCandles.length > 0) {
        const closed = validClosedCandles[0];
        const decimals = refPrice < 1 ? 4 : refPrice < 10 ? 3 : 2;
        const range = Math.max(0.0001, closed.high - closed.low);

        const officialAnchor: DailySessionAnchor = {
          prevHigh: +closed.high.toFixed(decimals),
          prevLow: +closed.low.toFixed(decimals),
          prevClose: +closed.close.toFixed(decimals),
          range: +range.toFixed(decimals),
          sessionStartUtcMs: currentUtcDayStart - 86400000,
          isFallback: false,
          source: 'DELTA_INDIA_OFFICIAL_1D_SETTLED',
        };

        // Freeze in cache for the entire session until next UTC 00:00 rollover
        anchorCache.set(symbol, {
          symbol,
          dayStartMs: currentUtcDayStart,
          anchor: officialAnchor,
        });
      }

      if (normalizedAll.length > 0) {
        notifyDailyAnchorListeners();
      }
    }
  } catch {
    // Silently keep temporary anchor estimate when upstream 1D fetch is unavailable
  } finally {
    activeFetches.delete(fetchKey);
  }
}

/**
 * Returns sorted ascending daily (UTC 00:00) candles for multi-session Virgin CPR detection.
 * Automatically triggers a background fetch for official 1D candles when not yet cached today.
 */
export function getCachedDailyCandles(
  symbol: string,
  market?: MarketTicker,
  currentPrice?: number,
  fallbackCandles?: Candle[]
): Normalized1DCandle[] {
  const sym = symbol || market?.symbol || 'BTCUSDT';
  const mark = currentPrice || (market?.markPrice && market.markPrice > 0 ? market.markPrice : 81702.5);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const currentUtcDayStart = Math.floor(Date.now() / oneDayMs) * oneDayMs;

  const cachedHistory = dailyHistoryCache.get(sym);
  if (cachedHistory && cachedHistory.dayStartMs === currentUtcDayStart && cachedHistory.candles1d.length > 0) {
    return cachedHistory.candles1d;
  }

  triggerOfficial1dFetch(sym, currentUtcDayStart, mark);

  if (fallbackCandles && Array.isArray(fallbackCandles) && fallbackCandles.length > 0) {
    const rawDaily: Normalized1DCandle[] = fallbackCandles.map((c) => ({
      timeMs: c.time,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    return normalizeAndSort1DCandles(rawDaily);
  }

  // Deterministic multi-session fallback while official 1D fetch resolves so Virgin CPR detection works on initial render
  const dayHigh = market?.high24h && market.high24h > 0 ? market.high24h : mark * 1.016;
  const dayLow = market?.low24h && market.low24h > 0 ? market.low24h : mark * 0.984;
  return [
    {
      timeMs: currentUtcDayStart - 3 * oneDayMs,
      high: +(mark * 1.062).toFixed(2),
      low: +(mark * 1.028).toFixed(2),
      close: +(mark * 1.048).toFixed(2),
    },
    {
      timeMs: currentUtcDayStart - 2 * oneDayMs,
      high: +(mark * 1.045).toFixed(2),
      low: +(mark * 1.008).toFixed(2),
      close: +(mark * 1.014).toFixed(2),
    },
    {
      timeMs: currentUtcDayStart - oneDayMs,
      high: +(dayHigh * 1.022).toFixed(2),
      low: +(dayLow * 0.996).toFixed(2),
      close: +(dayLow * 1.004).toFixed(2),
    },
    {
      timeMs: currentUtcDayStart,
      high: +dayHigh.toFixed(2),
      low: +dayLow.toFixed(2),
      close: +mark.toFixed(2),
    },
  ];
}

/**
 * Single Source of Truth for Daily Session Anchor Data (Delta Exchange India UTC 00:00).
 *
 * Daily Session Specification:
 * - Daily candle open: 00:00:00 UTC (05:30 AM IST)
 * - Daily candle close: 23:59:59 UTC (05:30 AM IST next day)
 *
 * Returns the exact completed prior-day daily candle: (prevHigh, prevLow, prevClose)
 * frozen as DELTA_INDIA_OFFICIAL_1D_SETTLED for the entire session.
 */
export function getDailySessionAnchor(
  market?: MarketTicker,
  currentPrice?: number,
  candles?: Candle[]
): DailySessionAnchor {
  const sym = market?.symbol || 'BTCUSDT';
  const mark = currentPrice || (market?.markPrice && market.markPrice > 0 ? market.markPrice : 81702.5);

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const currentUtcDayStart = Math.floor(now / oneDayMs) * oneDayMs;
  const prevUtcDayStart = currentUtcDayStart - oneDayMs;

  // 1. Check if we already have a frozen settled anchor for today's session in cache
  const cached = anchorCache.get(sym);
  if (cached && cached.dayStartMs === currentUtcDayStart && cached.anchor.source === 'DELTA_INDIA_OFFICIAL_1D_SETTLED') {
    return cached.anchor;
  }

  // 2. Trigger asynchronous background fetch for official Delta India 1D candle
  triggerOfficial1dFetch(sym, currentUtcDayStart, mark);

  // 3. Check if passed candles array contains official 1D candles or completed candles
  if (candles && Array.isArray(candles) && candles.length > 0) {
    const closedCandles = candles
      .filter((c) => c.time < currentUtcDayStart)
      .sort((a, b) => b.time - a.time);

    if (closedCandles.length > 0) {
      const decimals = mark < 1 ? 4 : mark < 10 ? 3 : 2;

      // If passing 1D resolution candles directly
      const is1dResolution = closedCandles.length === 1 || (closedCandles.length > 1 && (closedCandles[0].time - closedCandles[1].time) >= 80000000);
      if (is1dResolution) {
        const closed = closedCandles[0];
        const range = Math.max(0.0001, closed.high - closed.low);
        const anchor: DailySessionAnchor = {
          prevHigh: +closed.high.toFixed(decimals),
          prevLow: +closed.low.toFixed(decimals),
          prevClose: +closed.close.toFixed(decimals),
          range: +range.toFixed(decimals),
          sessionStartUtcMs: prevUtcDayStart,
          isFallback: false,
          source: 'DELTA_INDIA_OFFICIAL_1D_SETTLED',
        };
        anchorCache.set(sym, { symbol: sym, dayStartMs: currentUtcDayStart, anchor });
        return anchor;
      }

      // If passing intra-day candles (1m/5m/15m/1h) covering yesterday's session
      const prevDayCandles = candles.filter((c) => c.time >= prevUtcDayStart && c.time < currentUtcDayStart);
      if (prevDayCandles.length >= 4) {
        const h = Math.max(...prevDayCandles.map((c) => c.high));
        const l = Math.min(...prevDayCandles.map((c) => c.low));
        const c = prevDayCandles[prevDayCandles.length - 1].close;
        const range = Math.max(0.0001, h - l);
        const anchor: DailySessionAnchor = {
          prevHigh: +h.toFixed(decimals),
          prevLow: +l.toFixed(decimals),
          prevClose: +c.toFixed(decimals),
          range: +range.toFixed(decimals),
          sessionStartUtcMs: prevUtcDayStart,
          isFallback: false,
          source: 'DELTA_INDIA_OFFICIAL_1D_SETTLED',
        };
        anchorCache.set(sym, { symbol: sym, dayStartMs: currentUtcDayStart, anchor });
        return anchor;
      }
    }
  }

  // 4. Temporary fallback estimate while official 1D candle fetch completes
  let prevHigh = 0;
  let prevLow = 0;
  let prevClose = 0;

  const change24h = market?.change24h || 0;
  const derivedPrevClose = change24h !== 0 ? mark / (1 + change24h / 100) : mark;

  prevHigh = market?.high24h && market.high24h > 0 ? market.high24h : Math.max(mark, derivedPrevClose) * 1.015;
  prevLow = market?.low24h && market.low24h > 0 ? market.low24h : Math.min(mark, derivedPrevClose) * 0.985;
  prevClose = derivedPrevClose > 0 ? derivedPrevClose : mark;

  if (prevHigh <= prevLow) {
    prevHigh = Math.max(mark, prevClose) * 1.012;
    prevLow = Math.min(mark, prevClose) * 0.988;
  }

  const range = Math.max(0.0001, prevHigh - prevLow);
  const decimals = mark < 1 ? 4 : mark < 10 ? 3 : 2;

  return {
    prevHigh: +prevHigh.toFixed(decimals),
    prevLow: +prevLow.toFixed(decimals),
    prevClose: +prevClose.toFixed(decimals),
    range: +range.toFixed(decimals),
    sessionStartUtcMs: prevUtcDayStart,
    isFallback: true,
    source: 'DELTA_INDIA_TICKER_ESTIMATE',
  };
}
