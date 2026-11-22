import fs from 'fs';
import path from 'path';
import type { WarehouseSignalRecord } from './analyticsWarehouse.ts';

export type HistoricalResolution = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
export type HistoricalBacktestStrategyMode =
  | 'CAMARILLA_CPR_SNIPER'
  | 'AI_MATRIX_CONSENSUS'
  | 'WAREHOUSE_SIGNALS_REPLAY';

export interface DeltaOhlcvCandle {
  time: number; // UNIX seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalCandlesFetchResult {
  symbol: string;
  resolution: HistoricalResolution;
  startSec: number;
  endSec: number;
  candles: DeltaOhlcvCandle[];
  fromCache: boolean;
  chunksFetched: number;
  source: 'DELTA_EXCHANGE_INDIA' | 'DISK_CACHE';
}

export interface BacktestTradeRecord {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  strategyMode: HistoricalBacktestStrategyMode;
  entryTime: number; // UNIX seconds
  exitTime: number; // UNIX seconds
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

export interface BacktestEquityPoint {
  time: number; // UNIX seconds
  timestampIso: string;
  equityUsd: number;
  cumulativePnlUsd: number;
  drawdownPct: number;
}

export interface HistoricalBacktestSummary {
  symbol: string;
  timeframe: HistoricalResolution;
  days: number;
  strategyMode: HistoricalBacktestStrategyMode;
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
  trades: BacktestTradeRecord[];
}

export const SUPPORTED_HISTORICAL_SYMBOLS = [
  'BTCUSD',
  'ETHUSD',
  'SOLUSD',
  'XRPUSD',
  'DOGEUSD',
  'AVAXUSD',
] as const;

export const RESOLUTION_SECONDS_MAP: Record<HistoricalResolution, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export const DELTA_CONTRACT_VALUE_MAP: Record<string, number> = {
  BTCUSD: 0.001,
  ETHUSD: 0.01,
  SOLUSD: 1,
  XRPUSD: 10,
  DOGEUSD: 100,
  AVAXUSD: 1,
};

// Delta Exchange India official fee schedule: 0.059% base taker fee + 18% GST
export const DELTA_TAKER_FEE_RATE = 0.00059;
export const DELTA_GST_RATE = 0.18;
export const DEFAULT_SLIPPAGE_BPS = 2; // 0.02% per side

export function normalizeDeltaHistoricalSymbol(symbol: string): string {
  const clean = String(symbol || 'BTCUSD').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.endsWith('USDT')) {
    const mapped = `${clean.slice(0, -4)}USD`;
    if ((SUPPORTED_HISTORICAL_SYMBOLS as readonly string[]).includes(mapped)) return mapped;
  }
  if ((SUPPORTED_HISTORICAL_SYMBOLS as readonly string[]).includes(clean)) return clean;
  return 'BTCUSD';
}

export function normalizeHistoricalResolution(res: string): HistoricalResolution {
  const lower = String(res || '15m').trim().toLowerCase();
  if (lower in RESOLUTION_SECONDS_MAP) {
    return lower as HistoricalResolution;
  }
  return '15m';
}

function getCacheFilePath(dataDir: string, symbol: string, resolution: HistoricalResolution): string {
  return path.join(dataDir, 'candles-cache', `${symbol}_${resolution}.json`);
}

function loadCachedCandles(
  dataDir: string,
  symbol: string,
  resolution: HistoricalResolution
): DeltaOhlcvCandle[] {
  try {
    const filePath = getCacheFilePath(dataDir, symbol, resolution);
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed?.candles)) return [];
    return parsed.candles
      .filter(
        (c: any) =>
          c &&
          Number.isFinite(Number(c.time)) &&
          Number.isFinite(Number(c.close)) &&
          Number(c.close) > 0
      )
      .map((c: any) => ({
        time: Math.floor(Number(c.time)),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume || 0),
      }))
      .sort((a: DeltaOhlcvCandle, b: DeltaOhlcvCandle) => a.time - b.time);
  } catch {
    return [];
  }
}

function saveCachedCandles(
  dataDir: string,
  symbol: string,
  resolution: HistoricalResolution,
  candles: DeltaOhlcvCandle[]
): void {
  try {
    const filePath = getCacheFilePath(dataDir, symbol, resolution);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Cap disk cache per pair/resolution to most recent 40,000 bars (~138 days at 5m)
    const trimmed = candles.length > 40_000 ? candles.slice(candles.length - 40_000) : candles;
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        symbol,
        resolution,
        updatedAt: Date.now(),
        count: trimmed.length,
        candles: trimmed,
      }),
      'utf8'
    );
  } catch {
    // Non-fatal disk cache write failure
  }
}

export function mergeAndSortCandles(
  a: DeltaOhlcvCandle[],
  b: DeltaOhlcvCandle[]
): DeltaOhlcvCandle[] {
  const byTime = new Map<number, DeltaOhlcvCandle>();
  for (const c of a) {
    if (c && Number.isFinite(c.time) && c.close > 0) {
      byTime.set(Math.floor(c.time), { ...c, time: Math.floor(c.time) });
    }
  }
  for (const c of b) {
    if (c && Number.isFinite(c.time) && c.close > 0) {
      byTime.set(Math.floor(c.time), { ...c, time: Math.floor(c.time) });
    }
  }
  return Array.from(byTime.values()).sort((x, y) => x.time - y.time);
}

/**
 * Fetches multi-day historical OHLCV candles from Delta Exchange India
 * (`GET https://api.india.delta.exchange/v2/history/candles`) with automatic chunked pagination
 * and persistent disk caching in `DELTAAI_DATA_DIR/candles-cache/`.
 */
export async function fetchDeltaHistoricalCandles(params: {
  dataDir: string;
  symbol: string;
  resolution: HistoricalResolution;
  startSec: number;
  endSec: number;
  forceRefresh?: boolean;
  fetcher?: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
}): Promise<HistoricalCandlesFetchResult> {
  const symbol = normalizeDeltaHistoricalSymbol(params.symbol);
  const resolution = normalizeHistoricalResolution(params.resolution);
  const stepSec = RESOLUTION_SECONDS_MAP[resolution];
  const endSec = Math.floor(params.endSec);
  const startSec = Math.max(0, Math.floor(params.startSec));

  const cachedAll = loadCachedCandles(params.dataDir, symbol, resolution);
  const cachedInRange = cachedAll.filter((c) => c.time >= startSec && c.time <= endSec);

  const cacheCoversStart =
    cachedInRange.length > 0 && cachedInRange[0].time <= startSec + stepSec * 4;
  const cacheCoversEnd =
    cachedInRange.length > 0 &&
    cachedInRange[cachedInRange.length - 1].time >= endSec - stepSec * 3;

  if (!params.forceRefresh && cacheCoversStart && cacheCoversEnd) {
    return {
      symbol,
      resolution,
      startSec,
      endSec,
      candles: cachedInRange,
      fromCache: true,
      chunksFetched: 0,
      source: 'DISK_CACHE',
    };
  }

  // Determine missing ranges to minimize upstream calls
  const rangesToFetch: Array<{ start: number; end: number }> = [];
  if (params.forceRefresh || cachedInRange.length === 0) {
    rangesToFetch.push({ start: startSec, end: endSec });
  } else {
    if (!cacheCoversStart) {
      rangesToFetch.push({ start: startSec, end: cachedInRange[0].time });
    }
    if (!cacheCoversEnd) {
      rangesToFetch.push({
        start: cachedInRange[cachedInRange.length - 1].time,
        end: endSec,
      });
    }
  }

  // Delta Exchange India returns up to ~2000 candles per call; paginate at 1,800 candles/chunk
  const maxChunkDurationSec = stepSec * 1800;
  const fetchFn =
    params.fetcher ||
    (async (url: string) => {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'DeltaAI-Institutional/1.0',
        },
        signal: AbortSignal.timeout(12000),
      });
      return {
        ok: res.ok,
        status: res.status,
        json: () => res.json(),
      };
    });

  const fetchedCandles: DeltaOhlcvCandle[] = [];
  let chunksFetched = 0;

  for (const range of rangesToFetch) {
    let cursor = range.start;
    let safetyCounter = 0;
    while (cursor < range.end && safetyCounter < 45) {
      safetyCounter += 1;
      const chunkEnd = Math.min(range.end, cursor + maxChunkDurationSec);
      const url = `https://api.india.delta.exchange/v2/history/candles?symbol=${encodeURIComponent(
        symbol
      )}&resolution=${encodeURIComponent(resolution)}&start=${cursor}&end=${chunkEnd}`;

      let chunkRows: any[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const resp = await fetchFn(url);
          if (resp.ok) {
            const payload = await resp.json();
            if (Array.isArray(payload?.result)) {
              chunkRows = payload.result;
              chunksFetched += 1;
              break;
            }
          }
        } catch {
          // Retry once on transient network hiccup
        }
      }

      for (const row of chunkRows) {
        const rawT = Number(row?.time);
        const t = rawT > 1e12 ? Math.floor(rawT / 1000) : Math.floor(rawT);
        const open = Number(row?.open);
        const high = Number(row?.high);
        const low = Number(row?.low);
        const close = Number(row?.close);
        const volume = Number(row?.volume || 0);
        if (
          Number.isFinite(t) &&
          Number.isFinite(open) &&
          Number.isFinite(high) &&
          Number.isFinite(low) &&
          Number.isFinite(close) &&
          close > 0
        ) {
          fetchedCandles.push({ time: t, open, high, low, close, volume });
        }
      }

      cursor = chunkEnd + stepSec;
    }
  }

  const mergedAll = mergeAndSortCandles(cachedAll, fetchedCandles);
  if (fetchedCandles.length > 0) {
    saveCachedCandles(params.dataDir, symbol, resolution, mergedAll);
  }

  const finalSlice = mergedAll.filter((c) => c.time >= startSec && c.time <= endSec);
  return {
    symbol,
    resolution,
    startSec,
    endSec,
    candles: finalSlice,
    fromCache: chunksFetched === 0,
    chunksFetched,
    source: chunksFetched > 0 ? 'DELTA_EXCHANGE_INDIA' : 'DISK_CACHE',
  };
}

// ── Technical Helpers for Deterministic Candle-by-Candle Simulation ─────────

function computeEmaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(0);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  out[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function computeAtrSeries(candles: DeltaOhlcvCandle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return out;
  let atr = candles[0].high - candles[0].low;
  out[0] = atr;
  for (let i = 1; i < candles.length; i += 1) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    atr = (atr * (period - 1) + tr) / period;
    out[i] = atr;
  }
  return out;
}

function computeRsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = new Array(closes.length).fill(50);
  if (closes.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

interface DailyPivots {
  h3: number;
  h4: number;
  l3: number;
  l4: number;
  pivot: number;
  cprWidthPct: number;
}

function computeDailyPivotsByDayKey(candles: DeltaOhlcvCandle[]): Map<string, DailyPivots> {
  const dayOhlc = new Map<string, { high: number; low: number; close: number }>();
  const orderedDays: string[] = [];

  for (const c of candles) {
    const dayKey = new Date(c.time * 1000).toISOString().slice(0, 10);
    const existing = dayOhlc.get(dayKey);
    if (!existing) {
      orderedDays.push(dayKey);
      dayOhlc.set(dayKey, { high: c.high, low: c.low, close: c.close });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
    }
  }

  const pivotsByDay = new Map<string, DailyPivots>();
  for (let i = 1; i < orderedDays.length; i += 1) {
    const prev = dayOhlc.get(orderedDays[i - 1])!;
    const range = Math.max(prev.high - prev.low, prev.close * 0.002);
    const pivot = (prev.high + prev.low + prev.close) / 3;
    const bc = (prev.high + prev.low) / 2;
    const tc = pivot - bc + pivot;
    const cprWidthPct = pivot > 0 ? (Math.abs(tc - bc) / pivot) * 100 : 0.3;

    pivotsByDay.set(orderedDays[i], {
      h3: prev.close + range * (1.1 / 4),
      h4: prev.close + range * (1.1 / 2),
      l3: prev.close - range * (1.1 / 4),
      l4: prev.close - range * (1.1 / 2),
      pivot,
      cprWidthPct,
    });
  }
  return pivotsByDay;
}

function computeSessionVwapSeries(candles: DeltaOhlcvCandle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  let curDay = '';
  let cumPv = 0;
  let cumVol = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const dayKey = new Date(c.time * 1000).toISOString().slice(0, 10);
    if (dayKey !== curDay) {
      curDay = dayKey;
      cumPv = 0;
      cumVol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    const vol = Math.max(c.volume || 1, 1);
    cumPv += typical * vol;
    cumVol += vol;
    out[i] = cumVol > 0 ? cumPv / cumVol : c.close;
  }
  return out;
}

/**
 * Simulates trades candle-by-candle against real Delta Exchange India historical OHLCV candles,
 * deducting exact Delta Exchange India Taker fees (0.059% + 18% GST) and slippage.
 */
export function runHistoricalBacktest(params: {
  symbol: string;
  timeframe: HistoricalResolution;
  days: number;
  strategyMode: HistoricalBacktestStrategyMode;
  candles: DeltaOhlcvCandle[];
  warehouseSignals?: WarehouseSignalRecord[];
  initialCapitalUsd?: number;
  leverage?: number;
  riskPerTradePct?: number;
  feeRate?: number;
  gstRate?: number;
  slippageBps?: number;
  usdInrRate?: number;
}): HistoricalBacktestSummary {
  const symbol = normalizeDeltaHistoricalSymbol(params.symbol);
  const candles = [...params.candles].sort((a, b) => a.time - b.time);
  const initialCapitalUsd = Math.max(50, Number(params.initialCapitalUsd || 1000));
  const leverage = Math.max(1, Math.min(20, Number(params.leverage || 10)));
  const riskPerTradePct = Math.max(0.25, Math.min(3, Number(params.riskPerTradePct || 1.0)));
  const feeRate = params.feeRate ?? DELTA_TAKER_FEE_RATE;
  const gstRate = params.gstRate ?? DELTA_GST_RATE;
  const slippageRate = (params.slippageBps ?? DEFAULT_SLIPPAGE_BPS) / 10_000;
  const usdInrRate = params.usdInrRate && params.usdInrRate > 0 ? params.usdInrRate : 89.0;
  const contractVal = DELTA_CONTRACT_VALUE_MAP[symbol] ?? 0.001;

  if (candles.length < 5) {
    return {
      symbol,
      timeframe: params.timeframe,
      days: params.days,
      strategyMode: params.strategyMode,
      candlesCount: candles.length,
      startIso: candles[0] ? new Date(candles[0].time * 1000).toISOString() : new Date().toISOString(),
      endIso: candles[candles.length - 1]
        ? new Date(candles[candles.length - 1].time * 1000).toISOString()
        : new Date().toISOString(),
      initialCapitalUsd,
      finalEquityUsd: initialCapitalUsd,
      netProfitUsd: 0,
      netProfitInr: 0,
      returnPct: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRatePct: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      maxDrawdownUsd: 0,
      sharpeRatio: 0,
      totalFeesUsd: 0,
      totalGstUsd: 0,
      totalSlippageUsd: 0,
      avgWinUsd: 0,
      avgLossUsd: 0,
      expectancyUsd: 0,
      usdInrRate,
      note: 'Insufficient historical OHLCV candles returned for this range.',
      equityCurve: [],
      trades: [],
    };
  }

  const closes = candles.map((c) => c.close);
  const ema9 = computeEmaSeries(closes, 9);
  const ema20 = computeEmaSeries(closes, 20);
  const ema50 = computeEmaSeries(closes, 50);
  const atr14 = computeAtrSeries(candles, 14);
  const rsi14 = computeRsiSeries(closes, 14);
  const vwap = computeSessionVwapSeries(candles);
  const dailyPivots = computeDailyPivotsByDayKey(candles);

  // Pre-index Cloud Warehouse signals by candle index for WAREHOUSE_SIGNALS_REPLAY
  const replaySignalsByBarIdx = new Map<number, WarehouseSignalRecord>();
  let signalsMatchedCount = 0;
  if (params.strategyMode === 'WAREHOUSE_SIGNALS_REPLAY' && Array.isArray(params.warehouseSignals)) {
    const firstBarTime = candles[0].time;
    const lastBarTime = candles[candles.length - 1].time;
    const matchingSigs = params.warehouseSignals
      .filter((s) => {
        if (!s || s.direction === 'NEUTRAL') return false;
        const sigSym = normalizeDeltaHistoricalSymbol(s.symbol);
        if (sigSym !== symbol) return false;
        const sigSec = Math.floor((s.timestampMs || Date.parse(s.timestamp_utc || '')) / 1000);
        return sigSec >= firstBarTime && sigSec <= lastBarTime;
      })
      .sort((a, b) => a.timestampMs - b.timestampMs);

    signalsMatchedCount = matchingSigs.length;
    let barPtr = 0;
    for (const sig of matchingSigs) {
      const sigSec = Math.floor((sig.timestampMs || Date.parse(sig.timestamp_utc || '')) / 1000);
      while (barPtr < candles.length - 1 && candles[barPtr].time < sigSec) {
        barPtr += 1;
      }
      if (!replaySignalsByBarIdx.has(barPtr)) {
        replaySignalsByBarIdx.set(barPtr, sig);
      }
    }
  }

  interface OpenSimTrade {
    side: 'LONG' | 'SHORT';
    entryTime: number;
    entryPrice: number;
    stopLoss: number;
    initialStopLoss: number;
    takeProfit: number;
    movedToBe: boolean;
    contracts: number;
    signalId?: string;
    grade?: string;
  }

  let equity = initialCapitalUsd;
  let peakEquity = initialCapitalUsd;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;
  let openTrade: OpenSimTrade | null = null;
  let cooldownUntilIdx = 0;

  const trades: BacktestTradeRecord[] = [];
  const rawEquityCurve: BacktestEquityPoint[] = [];
  const dailyEndEquity = new Map<string, number>();

  const closeOpenTrade = (
    bar: DeltaOhlcvCandle,
    rawExitPrice: number,
    exitReason: BacktestTradeRecord['exitReason']
  ) => {
    if (!openTrade) return;
    // Apply realistic slippage against fill direction
    const exitPrice =
      openTrade.side === 'LONG'
        ? rawExitPrice * (1 - slippageRate)
        : rawExitPrice * (1 + slippageRate);
    const coinQty = openTrade.contracts * contractVal;
    const entryNotional = openTrade.entryPrice * coinQty;
    const exitNotional = exitPrice * coinQty;
    const avgNotional = (entryNotional + exitNotional) / 2;

    const grossPnlUsd =
      openTrade.side === 'LONG'
        ? (exitPrice - openTrade.entryPrice) * coinQty
        : (openTrade.entryPrice - exitPrice) * coinQty;

    // Exact Delta Exchange India fee (0.059% per side) + 18% GST on fee
    const feeUsd = (entryNotional + exitNotional) * feeRate;
    const gstUsd = feeUsd * gstRate;
    const slippageUsd = (entryNotional + exitNotional) * slippageRate;
    const netPnlUsd = grossPnlUsd - feeUsd - gstUsd;
    const netPnlInr = netPnlUsd * usdInrRate;

    const riskDist = Math.max(Math.abs(openTrade.entryPrice - openTrade.initialStopLoss), openTrade.entryPrice * 0.002);
    const riskDollars = Math.max(0.01, riskDist * coinQty);
    const rMultiple = +(netPnlUsd / riskDollars).toFixed(2);

    equity = Math.max(1, equity + netPnlUsd);
    if (equity > peakEquity) peakEquity = equity;
    const ddUsd = Math.max(0, peakEquity - equity);
    const ddPct = peakEquity > 0 ? (ddUsd / peakEquity) * 100 : 0;
    if (ddUsd > maxDrawdownUsd) maxDrawdownUsd = ddUsd;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    trades.push({
      id: `bt-${trades.length + 1}-${bar.time}`,
      symbol,
      side: openTrade.side,
      strategyMode: params.strategyMode,
      entryTime: openTrade.entryTime,
      exitTime: bar.time,
      entryTimeIso: new Date(openTrade.entryTime * 1000).toISOString(),
      exitTimeIso: new Date(bar.time * 1000).toISOString(),
      entryPrice: +openTrade.entryPrice.toFixed(openTrade.entryPrice >= 100 ? 2 : 4),
      exitPrice: +exitPrice.toFixed(exitPrice >= 100 ? 2 : 4),
      stopLoss: +openTrade.stopLoss.toFixed(openTrade.stopLoss >= 100 ? 2 : 4),
      takeProfit: +openTrade.takeProfit.toFixed(openTrade.takeProfit >= 100 ? 2 : 4),
      contracts: openTrade.contracts,
      notionalUsd: +avgNotional.toFixed(2),
      grossPnlUsd: +grossPnlUsd.toFixed(4),
      feeUsd: +feeUsd.toFixed(4),
      gstUsd: +gstUsd.toFixed(4),
      slippageUsd: +slippageUsd.toFixed(4),
      netPnlUsd: +netPnlUsd.toFixed(4),
      netPnlInr: +netPnlInr.toFixed(2),
      rMultiple,
      exitReason,
      signalId: openTrade.signalId,
      grade: openTrade.grade,
    });

    openTrade = null;
  };

  for (let i = 0; i < candles.length; i += 1) {
    const bar = candles[i];
    const dayKey = new Date(bar.time * 1000).toISOString().slice(0, 10);

    // 1. Evaluate open trade intrabar SL/TP conservatively (check SL before TP on same bar)
    if (openTrade) {
      const riskDist = Math.abs(openTrade.entryPrice - openTrade.initialStopLoss);
      if (openTrade.side === 'LONG') {
        if (bar.low <= openTrade.stopLoss) {
          closeOpenTrade(bar, openTrade.stopLoss, openTrade.movedToBe ? 'BE_STOP' : 'SL_HIT');
          cooldownUntilIdx = i + 2;
        } else if (bar.high >= openTrade.takeProfit) {
          closeOpenTrade(bar, openTrade.takeProfit, 'TP_HIT');
          cooldownUntilIdx = i + 1;
        } else if (!openTrade.movedToBe && riskDist > 0 && bar.high >= openTrade.entryPrice + riskDist * 1.1) {
          // Move stop-loss to break-even + fee buffer once +1.1R reached
          openTrade.stopLoss = openTrade.entryPrice * (1 + feeRate * 2.5);
          openTrade.movedToBe = true;
        }
      } else {
        if (bar.high >= openTrade.stopLoss) {
          closeOpenTrade(bar, openTrade.stopLoss, openTrade.movedToBe ? 'BE_STOP' : 'SL_HIT');
          cooldownUntilIdx = i + 2;
        } else if (bar.low <= openTrade.takeProfit) {
          closeOpenTrade(bar, openTrade.takeProfit, 'TP_HIT');
          cooldownUntilIdx = i + 1;
        } else if (!openTrade.movedToBe && riskDist > 0 && bar.low <= openTrade.entryPrice - riskDist * 1.1) {
          openTrade.stopLoss = openTrade.entryPrice * (1 - feeRate * 2.5);
          openTrade.movedToBe = true;
        }
      }
    }

    // 2. Check new entry triggers if flat and past warm-up
    if (!openTrade && i >= cooldownUntilIdx && i < candles.length - 1) {
      let entryCandidate: {
        side: 'LONG' | 'SHORT';
        entryPrice: number;
        stopLoss: number;
        takeProfit: number;
        signalId?: string;
        grade?: string;
      } | null = null;

      if (params.strategyMode === 'WAREHOUSE_SIGNALS_REPLAY') {
        const sig = replaySignalsByBarIdx.get(i);
        if (sig && sig.direction !== 'NEUTRAL') {
          const side: 'LONG' | 'SHORT' = sig.direction === 'SHORT' ? 'SHORT' : 'LONG';
          const entryPx = bar.close;
          const atr = Math.max(atr14[i], entryPx * 0.004);
          const slPx =
            sig.stopLoss &&
            sig.stopLoss > 0 &&
            (side === 'LONG' ? sig.stopLoss < entryPx : sig.stopLoss > entryPx)
              ? sig.stopLoss
              : side === 'LONG'
              ? entryPx - atr * 1.5
              : entryPx + atr * 1.5;
          const riskDist = Math.max(Math.abs(entryPx - slPx), entryPx * 0.003);
          const tpPx =
            sig.tp2 && sig.tp2 > 0 && (side === 'LONG' ? sig.tp2 > entryPx : sig.tp2 < entryPx)
              ? sig.tp2
              : sig.tp1 && sig.tp1 > 0 && (side === 'LONG' ? sig.tp1 > entryPx : sig.tp1 < entryPx)
              ? sig.tp1
              : side === 'LONG'
              ? entryPx + riskDist * 2.2
              : entryPx - riskDist * 2.2;
          entryCandidate = {
            side,
            entryPrice: entryPx,
            stopLoss: slPx,
            takeProfit: tpPx,
            signalId: sig.signalId,
            grade: sig.grade,
          };
        }
      } else if (i >= 50) {
        const prevBar = candles[i - 1];
        const atr = Math.max(atr14[i], bar.close * 0.003);
        const piv = dailyPivots.get(dayKey);

        if (params.strategyMode === 'CAMARILLA_CPR_SNIPER') {
          if (piv && piv.cprWidthPct <= 1.25) {
            const bullBreakout =
              bar.close > piv.h4 &&
              prevBar.close <= piv.h4 &&
              bar.close > vwap[i] &&
              ema9[i] > ema20[i];
            const bearBreakdown =
              bar.close < piv.l4 &&
              prevBar.close >= piv.l4 &&
              bar.close < vwap[i] &&
              ema9[i] < ema20[i];

            if (bullBreakout) {
              const sl = Math.min(piv.h3, bar.close - atr * 1.4);
              const riskDist = Math.max(bar.close - sl, atr);
              entryCandidate = {
                side: 'LONG',
                entryPrice: bar.close,
                stopLoss: bar.close - riskDist,
                takeProfit: bar.close + riskDist * 2.2,
                grade: 'A',
              };
            } else if (bearBreakdown) {
              const sl = Math.max(piv.l3, bar.close + atr * 1.4);
              const riskDist = Math.max(sl - bar.close, atr);
              entryCandidate = {
                side: 'SHORT',
                entryPrice: bar.close,
                stopLoss: bar.close + riskDist,
                takeProfit: bar.close - riskDist * 2.2,
                grade: 'A',
              };
            }
          }
        } else if (params.strategyMode === 'AI_MATRIX_CONSENSUS') {
          // Multi-factor confluence: EMA 9/20/50 trend stack + VWAP + RSI + ATR expansion
          const bullTrend = ema9[i] > ema20[i] && ema20[i] > ema50[i] && bar.close > vwap[i];
          const bearTrend = ema9[i] < ema20[i] && ema20[i] < ema50[i] && bar.close < vwap[i];
          const bullPullbackReclaim =
            bullTrend && prevBar.low <= ema20[i] * 1.001 && bar.close > ema9[i] && rsi14[i] >= 52 && rsi14[i] <= 70;
          const bearPullbackReclaim =
            bearTrend && prevBar.high >= ema20[i] * 0.999 && bar.close < ema9[i] && rsi14[i] <= 48 && rsi14[i] >= 30;

          if (bullPullbackReclaim) {
            const riskDist = Math.max(atr * 1.5, bar.close * 0.004);
            entryCandidate = {
              side: 'LONG',
              entryPrice: bar.close,
              stopLoss: bar.close - riskDist,
              takeProfit: bar.close + riskDist * 2.5,
              grade: rsi14[i] >= 58 ? 'A+' : 'A',
            };
          } else if (bearPullbackReclaim) {
            const riskDist = Math.max(atr * 1.5, bar.close * 0.004);
            entryCandidate = {
              side: 'SHORT',
              entryPrice: bar.close,
              stopLoss: bar.close + riskDist,
              takeProfit: bar.close - riskDist * 2.5,
              grade: rsi14[i] <= 42 ? 'A+' : 'A',
            };
          }
        }
      }

      if (entryCandidate) {
        const entryWithSlippage =
          entryCandidate.side === 'LONG'
            ? entryCandidate.entryPrice * (1 + slippageRate)
            : entryCandidate.entryPrice * (1 - slippageRate);
        const riskBudgetUsd = equity * (riskPerTradePct / 100);
        const stopDist = Math.max(
          Math.abs(entryWithSlippage - entryCandidate.stopLoss),
          entryWithSlippage * 0.0025
        );
        const riskContracts = Math.floor(riskBudgetUsd / (stopDist * contractVal));
        const maxMarginContracts = Math.floor(
          (equity * 0.85 * leverage) / (entryWithSlippage * contractVal)
        );
        const contracts = Math.max(1, Math.min(riskContracts, Math.max(1, maxMarginContracts)));

        openTrade = {
          side: entryCandidate.side,
          entryTime: bar.time,
          entryPrice: entryWithSlippage,
          stopLoss: entryCandidate.stopLoss,
          initialStopLoss: entryCandidate.stopLoss,
          takeProfit: entryCandidate.takeProfit,
          movedToBe: false,
          contracts,
          signalId: entryCandidate.signalId,
          grade: entryCandidate.grade,
        };
      }
    }

    // Track equity point & daily end equity
    const ddPctNow = peakEquity > 0 ? Math.max(0, ((peakEquity - equity) / peakEquity) * 100) : 0;
    dailyEndEquity.set(dayKey, equity);
    rawEquityCurve.push({
      time: bar.time,
      timestampIso: new Date(bar.time * 1000).toISOString(),
      equityUsd: +equity.toFixed(2),
      cumulativePnlUsd: +(equity - initialCapitalUsd).toFixed(2),
      drawdownPct: +ddPctNow.toFixed(2),
    });
  }

  // Close any open position at the final bar close
  if (openTrade) {
    closeOpenTrade(candles[candles.length - 1], candles[candles.length - 1].close, 'END_OF_RANGE');
    const lastBar = candles[candles.length - 1];
    const ddPctNow = peakEquity > 0 ? Math.max(0, ((peakEquity - equity) / peakEquity) * 100) : 0;
    rawEquityCurve[rawEquityCurve.length - 1] = {
      time: lastBar.time,
      timestampIso: new Date(lastBar.time * 1000).toISOString(),
      equityUsd: +equity.toFixed(2),
      cumulativePnlUsd: +(equity - initialCapitalUsd).toFixed(2),
      drawdownPct: +ddPctNow.toFixed(2),
    };
  }

  // Downsample equity curve to <= 180 points for smooth rendering
  const equityCurve: BacktestEquityPoint[] = [];
  if (rawEquityCurve.length <= 180) {
    equityCurve.push(...rawEquityCurve);
  } else {
    const stride = (rawEquityCurve.length - 1) / 179;
    for (let k = 0; k < 180; k += 1) {
      equityCurve.push(rawEquityCurve[Math.round(k * stride)]);
    }
  }

  const winsList = trades.filter((t) => t.netPnlUsd > 0);
  const lossesList = trades.filter((t) => t.netPnlUsd <= 0);
  const totalTrades = trades.length;
  const wins = winsList.length;
  const losses = lossesList.length;
  const winRatePct = totalTrades > 0 ? +((wins / totalTrades) * 100).toFixed(1) : 0;
  const grossWinUsd = winsList.reduce((acc, t) => acc + t.netPnlUsd, 0);
  const grossLossAbsUsd = Math.abs(lossesList.reduce((acc, t) => acc + t.netPnlUsd, 0));
  const profitFactor =
    grossLossAbsUsd > 0 ? +(grossWinUsd / grossLossAbsUsd).toFixed(2) : grossWinUsd > 0 ? 9.99 : 0;

  const totalFeesUsd = +trades.reduce((acc, t) => acc + t.feeUsd, 0).toFixed(4);
  const totalGstUsd = +trades.reduce((acc, t) => acc + t.gstUsd, 0).toFixed(4);
  const totalSlippageUsd = +trades.reduce((acc, t) => acc + t.slippageUsd, 0).toFixed(4);
  const netProfitUsd = +(equity - initialCapitalUsd).toFixed(2);
  const netProfitInr = +(netProfitUsd * usdInrRate).toFixed(2);
  const returnPct = +((netProfitUsd / initialCapitalUsd) * 100).toFixed(2);
  const avgWinUsd = wins > 0 ? +(grossWinUsd / wins).toFixed(2) : 0;
  const avgLossUsd = losses > 0 ? +(-grossLossAbsUsd / losses).toFixed(2) : 0;
  const expectancyUsd = totalTrades > 0 ? +(netProfitUsd / totalTrades).toFixed(2) : 0;

  // Annualized Sharpe ratio from daily equity returns
  const dailyEquities = Array.from(dailyEndEquity.values());
  const dailyReturns: number[] = [];
  for (let d = 1; d < dailyEquities.length; d += 1) {
    if (dailyEquities[d - 1] > 0) {
      dailyReturns.push((dailyEquities[d] - dailyEquities[d - 1]) / dailyEquities[d - 1]);
    }
  }
  let sharpeRatio = 0;
  if (dailyReturns.length >= 2) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
    const std = Math.sqrt(variance);
    sharpeRatio = std > 1e-8 ? +((mean / std) * Math.sqrt(365)).toFixed(2) : 0;
  }

  let note: string | undefined;
  if (params.strategyMode === 'WAREHOUSE_SIGNALS_REPLAY' && signalsMatchedCount === 0) {
    note = `No archived signals found in signals_archive.jsonl for ${symbol} inside the last ${params.days}D window.`;
  }

  return {
    symbol,
    timeframe: params.timeframe,
    days: params.days,
    strategyMode: params.strategyMode,
    candlesCount: candles.length,
    startIso: new Date(candles[0].time * 1000).toISOString(),
    endIso: new Date(candles[candles.length - 1].time * 1000).toISOString(),
    initialCapitalUsd,
    finalEquityUsd: +equity.toFixed(2),
    netProfitUsd,
    netProfitInr,
    returnPct,
    totalTrades,
    wins,
    losses,
    winRatePct,
    profitFactor,
    maxDrawdownPct: +maxDrawdownPct.toFixed(2),
    maxDrawdownUsd: +maxDrawdownUsd.toFixed(2),
    sharpeRatio,
    totalFeesUsd,
    totalGstUsd,
    totalSlippageUsd,
    avgWinUsd,
    avgLossUsd,
    expectancyUsd,
    signalsMatchedCount:
      params.strategyMode === 'WAREHOUSE_SIGNALS_REPLAY' ? signalsMatchedCount : undefined,
    usdInrRate,
    note,
    equityCurve,
    trades,
  };
}

export function backtestTradesToCsv(trades: BacktestTradeRecord[]): string {
  const headers = [
    'trade_id',
    'symbol',
    'side',
    'strategy_mode',
    'entry_time_utc',
    'exit_time_utc',
    'entry_price',
    'exit_price',
    'stop_loss',
    'take_profit',
    'contracts',
    'notional_usd',
    'gross_pnl_usd',
    'fee_usd_0_059pct',
    'gst_usd_18pct',
    'slippage_usd',
    'net_pnl_usd',
    'net_pnl_inr',
    'r_multiple',
    'exit_reason',
    'signal_id',
    'grade',
  ];
  const rows = trades.map((t) =>
    [
      t.id,
      t.symbol,
      t.side,
      t.strategyMode,
      t.entryTimeIso,
      t.exitTimeIso,
      t.entryPrice,
      t.exitPrice,
      t.stopLoss,
      t.takeProfit,
      t.contracts,
      t.notionalUsd,
      t.grossPnlUsd,
      t.feeUsd,
      t.gstUsd,
      t.slippageUsd,
      t.netPnlUsd,
      t.netPnlInr,
      t.rMultiple,
      t.exitReason,
      t.signalId || '',
      t.grade || '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}
