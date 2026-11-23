export interface OhlcCandle {
  time: number; // UNIX seconds or ms (normalized internally)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type RegimeDirection = 'LONG' | 'SHORT' | 'NEUTRAL';
export type RegimeRouteDestination =
  | 'PERPETUALS'
  | 'OPTIONS_DEBIT_SPREAD'
  | 'NO_TRADE';

export interface UnifiedRegimeRouterResult {
  statusLabel: string; // e.g. "NO TRADE (CHOP / LOW VOLATILITY)" | "TREND BULL · PERPETUALS" | "WIDE CPR · BULL CALL SPREAD"
  isNoTrade: boolean;
  noTradeReasons: string[];
  routeDestination: RegimeRouteDestination;
  recommendedOptionsStrategy: 'Bull Call Spread' | 'Bear Put Spread' | null;
  direction: RegimeDirection;
  // Multi-timeframe telemetry
  close1h: number;
  ema50_1h: number;
  sessionVwap: number;
  bias1h: RegimeDirection;
  ema20_4h: number;
  ema50_4h: number;
  bias4h: RegimeDirection;
  ema20_15m: number;
  atr14_15m: number;
  atrPct_15m: number;
  adx14_15m: number;
  // Daily CPR telemetry
  cprWidthPct: number;
  cprPercentile: number;
  cprClassification: 'NARROW' | 'NORMAL' | 'WIDE';
  isWideCpr: boolean;
  isHighVolatility: boolean;
  // Execution guidance for Perpetuals 15m Maker Pullback
  pullbackEntryZone: number;
  swingInvalidation: number;
  atrStopDistance: number;
  recommendedStopLoss: number;
  feeAdjustedBePrice: number;
  tp1Target: number; // +1.35R
  tp2Target: number; // +2.50R
  tp3Target: number; // +3.25R
}

export function normalizeCandleTimeSec(t: number): number {
  return t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
}

export function computeEmaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(0);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  out[0] = values[0];
  for (let i = 1; i < values.length; i += 1) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function computeAtrSeries(candles: OhlcCandle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return out;
  let atr = Math.max(0, candles[0].high - candles[0].low);
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

export function computeAdxSeries(candles: OhlcCandle[], period = 14): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(0);
  if (n < 2) return out;

  const trArr = new Array(n).fill(0);
  const plusDmArr = new Array(n).fill(0);
  const minusDmArr = new Array(n).fill(0);

  for (let i = 1; i < n; i += 1) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const upMove = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    plusDmArr[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDmArr[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    trArr[i] = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
  }

  let smoothTr = 0;
  let smoothPlusDm = 0;
  let smoothMinusDm = 0;
  const initEnd = Math.min(period, n - 1);
  for (let i = 1; i <= initEnd; i += 1) {
    smoothTr += trArr[i];
    smoothPlusDm += plusDmArr[i];
    smoothMinusDm += minusDmArr[i];
  }

  const dxArr = new Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    if (i > period) {
      smoothTr = smoothTr - smoothTr / period + trArr[i];
      smoothPlusDm = smoothPlusDm - smoothPlusDm / period + plusDmArr[i];
      smoothMinusDm = smoothMinusDm - smoothMinusDm / period + minusDmArr[i];
    }
    if (i >= initEnd && smoothTr > 0) {
      const plusDi = (smoothPlusDm / smoothTr) * 100;
      const minusDi = (smoothMinusDm / smoothTr) * 100;
      const sumDi = plusDi + minusDi;
      dxArr[i] = sumDi > 0 ? (Math.abs(plusDi - minusDi) / sumDi) * 100 : 0;
    }
  }

  let adx = 0;
  const adxStart = Math.min(n - 1, initEnd + period - 1);
  let seedCount = 0;
  for (let i = initEnd; i <= adxStart; i += 1) {
    adx += dxArr[i];
    seedCount += 1;
  }
  if (seedCount > 0) {
    adx /= seedCount;
  }
  for (let i = initEnd; i < n; i += 1) {
    if (i <= adxStart) {
      out[i] = dxArr[i];
    } else {
      adx = ((adx * (period - 1)) + dxArr[i]) / period;
      out[i] = adx;
    }
  }
  return out;
}

export function computeSessionVwapSeries(candles: OhlcCandle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  let curDay = '';
  let cumPv = 0;
  let cumVol = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const tSec = normalizeCandleTimeSec(c.time);
    const dayKey = new Date(tSec * 1000).toISOString().slice(0, 10);
    if (dayKey !== curDay) {
      curDay = dayKey;
      cumPv = 0;
      cumVol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    const vol = Math.max(Number(c.volume || 1), 1);
    cumPv += typical * vol;
    cumVol += vol;
    out[i] = cumVol > 0 ? cumPv / cumVol : c.close;
  }
  return out;
}

export function computeRsiSeries(closes: number[], period = 14): number[] {
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

export interface DailyCprDayStats {
  dayKey: string;
  pivot: number;
  bc: number;
  tc: number;
  h3: number;
  h4: number;
  l3: number;
  l4: number;
  cprWidth: number;
  cprWidthPct: number;
  cprPercentile: number;
  isWideCpr: boolean;
}

export function computeDailyCprStats(candles: OhlcCandle[]): Map<string, DailyCprDayStats> {
  const dayOhlc = new Map<string, { high: number; low: number; close: number }>();
  const orderedDays: string[] = [];

  for (const c of candles) {
    const tSec = normalizeCandleTimeSec(c.time);
    const dayKey = new Date(tSec * 1000).toISOString().slice(0, 10);
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

  const widthHistory: number[] = [];
  const pivotsByDay = new Map<string, DailyCprDayStats>();

  for (let i = 1; i < orderedDays.length; i += 1) {
    const prev = dayOhlc.get(orderedDays[i - 1])!;
    const range = Math.max(prev.high - prev.low, prev.close * 0.002);
    const pivot = (prev.high + prev.low + prev.close) / 3;
    const bcRaw = (prev.high + prev.low) / 2;
    const tcRaw = 2 * pivot - bcRaw;
    const bc = Math.min(bcRaw, tcRaw);
    const tc = Math.max(bcRaw, tcRaw);
    const cprWidth = Math.abs(tc - bc);
    const cprWidthPct = pivot > 0 ? (cprWidth / pivot) * 100 : 0.25;

    widthHistory.push(cprWidthPct);
    const windowWidths = widthHistory.slice(-30);
    let cprPercentile = 50;
    if (windowWidths.length >= 3) {
      const belowOrEq = windowWidths.filter((w) => w <= cprWidthPct).length;
      cprPercentile = Math.round((belowOrEq / windowWidths.length) * 100);
    } else {
      cprPercentile = cprWidthPct >= 0.45 ? 85 : cprWidthPct <= 0.18 ? 20 : 50;
    }

    const isWideCpr = cprPercentile >= 80 || cprWidthPct >= 0.45;
    pivotsByDay.set(orderedDays[i], {
      dayKey: orderedDays[i],
      pivot,
      bc,
      tc,
      h3: prev.close + range * (1.1 / 4),
      h4: prev.close + range * (1.1 / 2),
      l3: prev.close - range * (1.1 / 4),
      l4: prev.close - range * (1.1 / 2),
      cprWidth,
      cprWidthPct: +cprWidthPct.toFixed(4),
      cprPercentile,
      isWideCpr,
    });
  }

  return pivotsByDay;
}

export function resampleCandlesToBucketSec(candles: OhlcCandle[], bucketSec: number): OhlcCandle[] {
  if (!candles || candles.length === 0 || bucketSec <= 0) return [];
  const sorted = [...candles]
    .map((c) => ({ ...c, time: normalizeCandleTimeSec(c.time) }))
    .filter((c) => c.time > 0 && c.close > 0)
    .sort((a, b) => a.time - b.time);

  const buckets = new Map<number, OhlcCandle>();
  for (const c of sorted) {
    const bTime = Math.floor(c.time / bucketSec) * bucketSec;
    const existing = buckets.get(bTime);
    if (!existing) {
      buckets.set(bTime, {
        time: bTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: Number(c.volume || 0),
      });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume = Number(existing.volume || 0) + Number(c.volume || 0);
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

function roundPx(val: number, ref: number): number {
  const decimals = ref < 1 ? 4 : ref < 10 ? 3 : 2;
  return +val.toFixed(decimals);
}

export function evaluateUnifiedRegimeRouter(params: {
  symbol?: string;
  markPrice: number;
  candles15m?: OhlcCandle[];
  candles1h?: OhlcCandle[];
  candles4h?: OhlcCandle[];
  candles5m?: OhlcCandle[];
  dailyCprWidthPct?: number;
  dailyCprPercentile?: number;
}): UnifiedRegimeRouterResult {
  const sym = String(params.symbol || 'BTCUSDT').toUpperCase();
  const isBtc = sym.includes('BTC') || (!sym && params.markPrice >= 15000);

  const base15m =
    params.candles15m && params.candles15m.length >= 15
      ? params.candles15m
      : params.candles5m && params.candles5m.length >= 15
      ? resampleCandlesToBucketSec(params.candles5m, 900)
      : params.candles1h || [];

  const candles15m = [...base15m]
    .map((c) => ({ ...c, time: normalizeCandleTimeSec(c.time) }))
    .filter((c) => c.close > 0)
    .sort((a, b) => a.time - b.time);

  const candles1h =
    params.candles1h && params.candles1h.length >= 5
      ? [...params.candles1h].map((c) => ({ ...c, time: normalizeCandleTimeSec(c.time) })).sort((a, b) => a.time - b.time)
      : resampleCandlesToBucketSec(candles15m, 3600);

  const candles4h =
    params.candles4h && params.candles4h.length >= 5
      ? [...params.candles4h].map((c) => ({ ...c, time: normalizeCandleTimeSec(c.time) })).sort((a, b) => a.time - b.time)
      : resampleCandlesToBucketSec(candles1h.length >= 5 ? candles1h : candles15m, 14400);

  const latestMark =
    params.markPrice > 0
      ? params.markPrice
      : candles15m[candles15m.length - 1]?.close || candles1h[candles1h.length - 1]?.close || 80000;

  // 15m EMA20, ATR(14), ADX(14), Session VWAP
  const closes15m = candles15m.map((c) => c.close);
  const ema20_15mArr = computeEmaSeries(closes15m, 20);
  const atr14_15mArr = computeAtrSeries(candles15m, 14);
  const adx14_15mArr = computeAdxSeries(candles15m, 14);
  const vwap15mArr = computeSessionVwapSeries(candles15m);

  const ema20_15m = ema20_15mArr[ema20_15mArr.length - 1] || latestMark;
  const atr14_15m = atr14_15mArr[atr14_15mArr.length - 1] || latestMark * 0.004;
  const adx14_15m = +(adx14_15mArr[adx14_15mArr.length - 1] || 0).toFixed(2);
  const atrPct_15m = latestMark > 0 ? +((atr14_15m / latestMark) * 100).toFixed(3) : 0;

  // Session VWAP (prefer 15m session VWAP, else 1H session VWAP)
  const vwap1hArr = computeSessionVwapSeries(candles1h);
  const sessionVwap =
    vwap15mArr[vwap15mArr.length - 1] ||
    vwap1hArr[vwap1hArr.length - 1] ||
    latestMark;

  // 1H Close vs 1H EMA 50 & Session VWAP
  const closes1h = candles1h.map((c) => c.close);
  const ema50_1hArr = computeEmaSeries(closes1h, 50);
  const close1h = closes1h[closes1h.length - 1] || latestMark;
  const ema50_1h = ema50_1hArr[ema50_1hArr.length - 1] || close1h;

  let bias1h: RegimeDirection = 'NEUTRAL';
  if (close1h > ema50_1h && close1h > sessionVwap) {
    bias1h = 'LONG';
  } else if (close1h < ema50_1h && close1h < sessionVwap) {
    bias1h = 'SHORT';
  }

  // 4H EMA 20 vs EMA 50
  const closes4h = candles4h.map((c) => c.close);
  const ema20_4hArr = computeEmaSeries(closes4h, 20);
  const ema50_4hArr = computeEmaSeries(closes4h, 50);
  const ema20_4h = ema20_4hArr[ema20_4hArr.length - 1] || latestMark;
  const ema50_4h = ema50_4hArr[ema50_4hArr.length - 1] || latestMark;

  let bias4h: RegimeDirection = 'NEUTRAL';
  if (ema20_4h > ema50_4h) bias4h = 'LONG';
  else if (ema20_4h < ema50_4h) bias4h = 'SHORT';

  // Daily CPR statistics
  const cprSource = candles15m.length >= 20 ? candles15m : candles1h;
  const dailyCprMap = computeDailyCprStats(cprSource);
  const latestDayStats = Array.from(dailyCprMap.values()).pop();
  const cprWidthPct =
    typeof params.dailyCprWidthPct === 'number' && Number.isFinite(params.dailyCprWidthPct)
      ? +params.dailyCprWidthPct.toFixed(4)
      : latestDayStats?.cprWidthPct ?? 0.24;
  const cprPercentile =
    typeof params.dailyCprPercentile === 'number' && Number.isFinite(params.dailyCprPercentile)
      ? Math.round(params.dailyCprPercentile)
      : latestDayStats?.cprPercentile ?? (cprWidthPct >= 0.45 ? 85 : cprWidthPct <= 0.18 ? 20 : 50);

  const isWideCpr = cprPercentile >= 80 || cprWidthPct >= 0.45;
  const isNarrowCpr = !isWideCpr && (cprPercentile <= 25 || cprWidthPct <= 0.18);
  const cprClassification: 'NARROW' | 'NORMAL' | 'WIDE' = isWideCpr
    ? 'WIDE'
    : isNarrowCpr
    ? 'NARROW'
    : 'NORMAL';
  const isHighVolatility = atrPct_15m >= 1.25;

  // Hard Regime Gating Rules
  const noTradeReasons: string[] = [];
  if (candles15m.length < 15) {
    noTradeReasons.push('Insufficient 15m candles (< 15 bars)');
  }
  if (adx14_15m < 22) {
    noTradeReasons.push(`15M ADX(14) ${adx14_15m.toFixed(1)} < 22`);
  }
  if (atrPct_15m < 0.30) {
    noTradeReasons.push(`15M ATR% ${atrPct_15m.toFixed(2)}% < 0.30%`);
  }
  if (bias4h === 'NEUTRAL' || bias1h === 'NEUTRAL' || bias4h !== bias1h) {
    noTradeReasons.push(`4H (${bias4h}) / 1H (${bias1h}) trend conflict`);
  }

  const isNoTrade = noTradeReasons.length > 0;
  const direction: RegimeDirection = isNoTrade ? 'NEUTRAL' : bias1h;

  let routeDestination: RegimeRouteDestination = 'NO_TRADE';
  let recommendedOptionsStrategy: 'Bull Call Spread' | 'Bear Put Spread' | null = null;
  let statusLabel = 'NO TRADE (CHOP / LOW VOLATILITY)';

  if (!isNoTrade) {
    if (isWideCpr || isHighVolatility) {
      routeDestination = 'OPTIONS_DEBIT_SPREAD';
      recommendedOptionsStrategy = direction === 'LONG' ? 'Bull Call Spread' : 'Bear Put Spread';
      statusLabel =
        direction === 'LONG'
          ? 'OPTIONS LAB · BULL CALL SPREAD'
          : 'OPTIONS LAB · BEAR PUT SPREAD';
    } else {
      routeDestination = 'PERPETUALS';
      statusLabel =
        direction === 'LONG'
          ? 'PERPETUALS · 15M BULL PULLBACK'
          : 'PERPETUALS · 15M BEAR PULLBACK';
    }
  }

  // 15m swing invalidation over last 6 bars
  const recentBars = candles15m.slice(-6);
  const recentSwingLow =
    recentBars.length > 0 ? Math.min(...recentBars.map((b) => b.low)) : latestMark * 0.994;
  const recentSwingHigh =
    recentBars.length > 0 ? Math.max(...recentBars.map((b) => b.high)) : latestMark * 1.006;

  const minStopPct = isBtc ? 0.0055 : 0.0045;
  const atrStopDistance = Math.max(atr14_15m * 1.5, latestMark * minStopPct);

  // Pullback maker zone sits in the 15M EMA20 / Session VWAP band
  const rawZone =
    direction === 'LONG'
      ? Math.min(latestMark * 0.9995, (ema20_15m * 0.65 + sessionVwap * 0.35))
      : direction === 'SHORT'
      ? Math.max(latestMark * 1.0005, (ema20_15m * 0.65 + sessionVwap * 0.35))
      : (ema20_15m + sessionVwap) / 2;

  // Keep limit pullback realistic (within 1.5x ATR of live price)
  const maxOffset = Math.max(atr14_15m * 1.25, latestMark * 0.004);
  const pullbackEntryZone = roundPx(
    direction === 'LONG'
      ? Math.max(latestMark - maxOffset, Math.min(latestMark * 0.9994, rawZone))
      : direction === 'SHORT'
      ? Math.min(latestMark + maxOffset, Math.max(latestMark * 1.0006, rawZone))
      : rawZone,
    latestMark
  );

  const swingInvalidation = roundPx(
    direction === 'SHORT' ? recentSwingHigh : recentSwingLow,
    latestMark
  );

  const recommendedStopLoss = roundPx(
    direction === 'SHORT'
      ? Math.max(pullbackEntryZone + atrStopDistance, recentSwingHigh + atr14_15m * 0.25)
      : Math.min(pullbackEntryZone - atrStopDistance, recentSwingLow - atr14_15m * 0.25),
    latestMark
  );

  const actualRiskDist = Math.max(
    Math.abs(pullbackEntryZone - recommendedStopLoss),
    atrStopDistance
  );

  const feeAdjustedBePrice = roundPx(
    direction === 'SHORT'
      ? pullbackEntryZone * (1 - 0.0015)
      : pullbackEntryZone * (1 + 0.0015),
    latestMark
  );

  const tp1Target = roundPx(
    direction === 'SHORT'
      ? pullbackEntryZone - actualRiskDist * 1.35
      : pullbackEntryZone + actualRiskDist * 1.35,
    latestMark
  );
  const tp2Target = roundPx(
    direction === 'SHORT'
      ? pullbackEntryZone - actualRiskDist * 2.5
      : pullbackEntryZone + actualRiskDist * 2.5,
    latestMark
  );
  const tp3Target = roundPx(
    direction === 'SHORT'
      ? pullbackEntryZone - actualRiskDist * 3.25
      : pullbackEntryZone + actualRiskDist * 3.25,
    latestMark
  );

  return {
    statusLabel,
    isNoTrade,
    noTradeReasons,
    routeDestination,
    recommendedOptionsStrategy,
    direction,
    close1h: roundPx(close1h, latestMark),
    ema50_1h: roundPx(ema50_1h, latestMark),
    sessionVwap: roundPx(sessionVwap, latestMark),
    bias1h,
    ema20_4h: roundPx(ema20_4h, latestMark),
    ema50_4h: roundPx(ema50_4h, latestMark),
    bias4h,
    ema20_15m: roundPx(ema20_15m, latestMark),
    atr14_15m: roundPx(atr14_15m, latestMark),
    atrPct_15m,
    adx14_15m,
    cprWidthPct,
    cprPercentile,
    cprClassification,
    isWideCpr,
    isHighVolatility,
    pullbackEntryZone,
    swingInvalidation,
    atrStopDistance: roundPx(atrStopDistance, latestMark),
    recommendedStopLoss,
    feeAdjustedBePrice,
    tp1Target,
    tp2Target,
    tp3Target,
  };
}

export interface Ema921MomentumCrossResult {
  hasConfirmedCross: boolean;
  filtersPassed: boolean;
  direction: RegimeDirection;
  crossDirection: RegimeDirection;
  statusLabel: string;
  rejectionReasons: string[];
  entryPrice: number;
  stopLoss: number;
  feeAdjustedBePrice: number;
  tp1Target: number; // +100 pts (~1.1R) - 60% Maker Limit Partial Bank
  tp2Target: number;
  tp3Target: number;
  tp4Target: number; // +220 pts (2.5R) - 40% EMA 21 Runner
  partialClosePct: number;
  runnerPct: number;
  ema9_5m: number;
  ema21_5m: number;
  ema21Prev2_5m: number;
  ema21SlopeUp: boolean;
  ema21SlopeDown: boolean;
  ema50_15m: number;
  sessionVwap: number;
  adx14_5m: number;
  atr14_5m: number;
  barBodyConfirmed: boolean;
  vwapAligned: boolean;
  ema50Aligned: boolean;
  slDistancePts: number;
  tp1DistancePts: number;
  tp4DistancePts: number;
  beOffsetPts: number;
}

/**
 * Filtered 5m EMA 9/21 Momentum Cross (100pt Scalp + Runner):
 * - Confirmed 5m bar-close EMA 9/21 crossover + candle body confirmation (no mid-bar flicker)
 * - EMA 21 directional slope (EMA21[t] > EMA21[t-2] for LONG; inverse for SHORT)
 * - Session VWAP & 15m EMA 50 alignment (LONG above both; SHORT below both)
 * - 5m ADX(14) >= 20
 * - SL: 1.2x 5m ATR(14) beyond crossover swing (~85-110 pts BTC)
 * - TP1: 60% partial bank @ +100 pts (~1.1R) maker limit -> SL to Entry +/- $35 -> 40% EMA 21 runner toward +220 pts (2.5R)
 */
export function evaluateEma921MomentumCross5m(params: {
  symbol?: string;
  markPrice: number;
  candles5m: OhlcCandle[];
  candles15m?: OhlcCandle[];
  useLastClosedBar?: boolean;
  lotSizeBtc?: number;
}): Ema921MomentumCrossResult {
  const sym = String(params.symbol || 'BTCUSDT').toUpperCase();
  const isBtc = sym.includes('BTC') || (!sym && params.markPrice >= 15000);

  const sorted5m = [...(params.candles5m || [])]
    .map((c) => ({ ...c, time: normalizeCandleTimeSec(c.time) }))
    .filter((c) => c.close > 0)
    .sort((a, b) => a.time - b.time);

  const sorted15m =
    params.candles15m && params.candles15m.length >= 10
      ? [...params.candles15m]
          .map((c) => ({ ...c, time: normalizeCandleTimeSec(c.time) }))
          .filter((c) => c.close > 0)
          .sort((a, b) => a.time - b.time)
      : resampleCandlesToBucketSec(sorted5m, 900);

  const latestMark =
    params.markPrice > 0
      ? params.markPrice
      : sorted5m[sorted5m.length - 1]?.close || 80000;

  const defaultLotBtc = params.lotSizeBtc && params.lotSizeBtc > 0 ? params.lotSizeBtc : (isBtc ? 0.09 : 0.1);
  const defaultRoundTripFee = latestMark * defaultLotBtc * 0.000472;
  const defaultTp1Pts = roundPx((15.00 + defaultRoundTripFee) / defaultLotBtc, latestMark);

  if (sorted5m.length < 25) {
    return {
      hasConfirmedCross: false,
      filtersPassed: false,
      direction: 'NEUTRAL',
      crossDirection: 'NEUTRAL',
      statusLabel: 'NO TRADE (INSUFFICIENT 5M BARS)',
      rejectionReasons: ['Insufficient 5m candles (< 25 bars)'],
      entryPrice: roundPx(latestMark, latestMark),
      stopLoss: roundPx(latestMark - (isBtc ? 95 : latestMark * 0.0012), latestMark),
      feeAdjustedBePrice: roundPx(latestMark + (isBtc ? 35 : latestMark * 0.00042), latestMark),
      tp1Target: roundPx(latestMark + defaultTp1Pts, latestMark),
      tp2Target: roundPx(latestMark + defaultTp1Pts * 1.45, latestMark),
      tp3Target: roundPx(latestMark + defaultTp1Pts * 1.85, latestMark),
      tp4Target: roundPx(latestMark + 220, latestMark),
      partialClosePct: 70,
      runnerPct: 30,
      ema9_5m: roundPx(latestMark, latestMark),
      ema21_5m: roundPx(latestMark, latestMark),
      ema21Prev2_5m: roundPx(latestMark, latestMark),
      ema21SlopeUp: false,
      ema21SlopeDown: false,
      ema50_15m: roundPx(latestMark, latestMark),
      sessionVwap: roundPx(latestMark, latestMark),
      adx14_5m: 0,
      atr14_5m: 0,
      barBodyConfirmed: false,
      vwapAligned: false,
      ema50Aligned: false,
      slDistancePts: isBtc ? 95 : roundPx(latestMark * 0.0012, latestMark),
      tp1DistancePts: defaultTp1Pts,
      tp4DistancePts: 220,
      beOffsetPts: isBtc ? 35 : roundPx(latestMark * 0.00042, latestMark),
    };
  }

  // Evaluate on last CLOSED 5m bar in live mode (n - 2) or exact bar in closed-bar simulation (n - 1)
  const closedIdx =
    params.useLastClosedBar && sorted5m.length >= 26
      ? sorted5m.length - 2
      : sorted5m.length - 1;

  const closes5m = sorted5m.map((c) => c.close);
  const ema9Arr = computeEmaSeries(closes5m, 9);
  const ema21Arr = computeEmaSeries(closes5m, 21);
  const atr5mArr = computeAtrSeries(sorted5m, 14);
  const adx5mArr = computeAdxSeries(sorted5m, 14);
  const vwap5mArr = computeSessionVwapSeries(sorted5m);

  const bar = sorted5m[closedIdx];
  const prevIdx = Math.max(0, closedIdx - 1);
  const prev2Idx = Math.max(0, closedIdx - 2);

  const ema9Cur = ema9Arr[closedIdx];
  const ema9Prev = ema9Arr[prevIdx];
  const ema21Cur = ema21Arr[closedIdx];
  const ema21Prev = ema21Arr[prevIdx];
  const ema21Prev2 = ema21Arr[prev2Idx];

  const adx14_5m = +(adx5mArr[closedIdx] || 0).toFixed(2);
  const atr14_5m = atr5mArr[closedIdx] || (isBtc ? 78 : bar.close * 0.001);
  const sessionVwap = vwap5mArr[closedIdx] || bar.close;

  // 15m EMA 50 aligned up to closed 5m bar time
  const aligned15m = sorted15m.filter((c) => c.time <= bar.time + 899);
  const ema50_15mArr = computeEmaSeries(
    (aligned15m.length > 0 ? aligned15m : sorted15m).map((c) => c.close),
    50
  );
  const ema50_15m = ema50_15mArr[ema50_15mArr.length - 1] || bar.close;

  const bullCross = ema9Prev <= ema21Prev && ema9Cur > ema21Cur;
  const bearCross = ema9Prev >= ema21Prev && ema9Cur < ema21Cur;

  const crossDirection: RegimeDirection = bullCross
    ? 'LONG'
    : bearCross
    ? 'SHORT'
    : 'NEUTRAL';

  const trendDir: RegimeDirection =
    crossDirection !== 'NEUTRAL'
      ? crossDirection
      : ema9Cur >= ema21Cur
      ? 'LONG'
      : 'SHORT';

  const ema21SlopeUp = ema21Cur > ema21Prev2;
  const ema21SlopeDown = ema21Cur < ema21Prev2;

  const isLongBias = trendDir === 'LONG';
  const barBodyConfirmed = isLongBias ? bar.close > bar.open : bar.close < bar.open;
  const slopeConfirmed = isLongBias ? ema21SlopeUp : ema21SlopeDown;
  const vwapAligned = isLongBias ? bar.close > sessionVwap : bar.close < sessionVwap;
  const ema50Aligned = isLongBias ? bar.close > ema50_15m : bar.close < ema50_15m;
  const adxPassed = adx14_5m >= 20;

  const rejectionReasons: string[] = [];
  if (crossDirection === 'NEUTRAL') {
    rejectionReasons.push('Awaiting confirmed 5m bar-close EMA 9/21 cross');
  }
  if (!barBodyConfirmed) {
    rejectionReasons.push('5m candle body close did not confirm direction');
  }
  if (!slopeConfirmed) {
    rejectionReasons.push('5m EMA 21 slope flat/against signal');
  }
  if (!vwapAligned) {
    rejectionReasons.push(`Price ${isLongBias ? 'below' : 'above'} Session VWAP`);
  }
  if (!ema50Aligned) {
    rejectionReasons.push(`Price ${isLongBias ? 'below' : 'above'} 15m EMA 50`);
  }
  if (!adxPassed) {
    rejectionReasons.push(`5m ADX(14) ${adx14_5m.toFixed(1)} < 20 (chop filter)`);
  }

  const hasConfirmedCross = crossDirection !== 'NEUTRAL' && barBodyConfirmed;
  const filtersPassed =
    hasConfirmedCross && slopeConfirmed && vwapAligned && ema50Aligned && adxPassed;

  const entryPrice = roundPx(bar.close, bar.close);
  const swingBars = sorted5m.slice(Math.max(0, closedIdx - 3), closedIdx + 1);
  const swingLow = Math.min(...swingBars.map((b) => b.low));
  const swingHigh = Math.max(...swingBars.map((b) => b.high));

  // Initial Stop-Loss: 1.2x 5m ATR(14) (~85–110 pts on BTC) beyond crossover swing
  const rawAtrStopDist = atr14_5m * 1.2;
  const atrStopDist = isBtc
    ? Math.min(110, Math.max(85, rawAtrStopDist))
    : Math.max(rawAtrStopDist, entryPrice * 0.0012);

  const swingRoomBuffer = isBtc ? Math.min(15, atr14_5m * 0.15) : atr14_5m * 0.15;
  let stopLossRaw = isLongBias
    ? Math.min(entryPrice - atrStopDist, swingLow - swingRoomBuffer)
    : Math.max(entryPrice + atrStopDist, swingHigh + swingRoomBuffer);

  if (isBtc) {
    const rawDist = Math.abs(entryPrice - stopLossRaw);
    const swingDist = isLongBias ? Math.abs(entryPrice - swingLow) : Math.abs(swingHigh - entryPrice);
    if (rawDist > 115 && swingDist <= 105) {
      stopLossRaw = isLongBias ? entryPrice - 110 : entryPrice + 110;
    } else if (rawDist < 85) {
      stopLossRaw = isLongBias ? entryPrice - 85 : entryPrice + 85;
    }
  }

  const stopLoss = roundPx(stopLossRaw, entryPrice);
  const slDistancePts = roundPx(Math.abs(entryPrice - stopLoss), entryPrice);

  const activeLotBtc = params.lotSizeBtc && params.lotSizeBtc > 0 ? params.lotSizeBtc : (isBtc ? 0.09 : 0.1);
  const roundTripFeeUsd = entryPrice * activeLotBtc * 0.000472;
  const tp1DistancePts = roundPx((15.00 + roundTripFeeUsd) / activeLotBtc, entryPrice);
  const tp4DistancePts = isBtc ? 220 : roundPx(slDistancePts * 2.5, entryPrice);
  const beOffsetPts = isBtc ? 35 : roundPx(entryPrice * 0.00042, entryPrice);

  const sign = isLongBias ? 1 : -1;
  const tp1Target = roundPx(entryPrice + sign * tp1DistancePts, entryPrice);
  const tp2Target = roundPx(entryPrice + sign * (tp1DistancePts + (tp4DistancePts - tp1DistancePts) * 0.42), entryPrice);
  const tp3Target = roundPx(entryPrice + sign * (tp1DistancePts + (tp4DistancePts - tp1DistancePts) * 0.72), entryPrice);
  const tp4Target = roundPx(entryPrice + sign * tp4DistancePts, entryPrice);
  const feeAdjustedBePrice = roundPx(entryPrice + sign * beOffsetPts, entryPrice);

  const statusLabel = filtersPassed
    ? `5M EMA 9/21 CROSS ${trendDir} · +$15 NET TARGET (70%) + RUNner`
    : hasConfirmedCross
    ? `5M CROSS FILTERED OUT (${rejectionReasons[0] || 'CHOP'})`
    : `5M EMA 9/21 WATCHING · ${rejectionReasons[0] || 'NO CROSS'}`;

  return {
    hasConfirmedCross,
    filtersPassed,
    direction: filtersPassed ? crossDirection : 'NEUTRAL',
    crossDirection,
    statusLabel,
    rejectionReasons,
    entryPrice,
    stopLoss,
    feeAdjustedBePrice,
    tp1Target,
    tp2Target,
    tp3Target,
    tp4Target,
    partialClosePct: 70,
    runnerPct: 30,
    ema9_5m: roundPx(ema9Cur, entryPrice),
    ema21_5m: roundPx(ema21Cur, entryPrice),
    ema21Prev2_5m: roundPx(ema21Prev2, entryPrice),
    ema21SlopeUp,
    ema21SlopeDown,
    ema50_15m: roundPx(ema50_15m, entryPrice),
    sessionVwap: roundPx(sessionVwap, entryPrice),
    adx14_5m,
    atr14_5m: roundPx(atr14_5m, entryPrice),
    barBodyConfirmed,
    vwapAligned,
    ema50Aligned,
    slDistancePts,
    tp1DistancePts,
    tp4DistancePts,
    beOffsetPts,
  };
}

