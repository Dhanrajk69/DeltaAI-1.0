import {
  NormalizedTelemetryEnvelope,
  NormalizedTelemetryIndicators,
  NormalizedTelemetryValidation,
  TelemetryHistoricalCandle,
  TelemetryIngestionResult,
  TelemetrySignalAction,
  TelemetrySourceProvider,
  TelemetryTimeframe,
  TelemetryValidationStatus,
  TelemetryVolatilityRegime,
} from '../types';

export interface TelemetryProcessorThresholds {
  minCandlesRequired?: number;
  maxPriceDeviationPct?: number;
  maxAtrPctIntraday?: number;
  maxZScoreExtreme?: number;
  maxExtensionAtrMultiple?: number;
  maxSpreadBps?: number;
  minCompressedBbWidthPct?: number;
  strictMode?: boolean;
}

const DEFAULT_THRESHOLDS: Required<TelemetryProcessorThresholds> = {
  minCandlesRequired: 20,
  maxPriceDeviationPct: 8.0,
  maxAtrPctIntraday: 3.2,
  maxZScoreExtreme: 3.2,
  maxExtensionAtrMultiple: 2.35,
  maxSpreadBps: 40,
  minCompressedBbWidthPct: 0.08,
  strictMode: false,
};

function sanitizeNumber(val: unknown): number | undefined {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : undefined;
  }
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,\s%]/g, '').trim();
    if (!cleaned) return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function roundAdaptive(val: number, referencePrice?: number): number {
  if (!Number.isFinite(val)) return 0;
  const ref = Math.abs(referencePrice ?? val);
  const decimals = ref >= 1000 ? 2 : ref >= 10 ? 3 : ref >= 1 ? 4 : 6;
  return Number(val.toFixed(decimals));
}

function computeSimpleHash(input: unknown): string {
  const str = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function normalizeEpochTimestamp(rawTs: unknown, fallbackMs: number = Date.now()): number {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs) && rawTs > 0) {
    // Distinguish UNIX seconds (10 digits) vs milliseconds (13 digits)
    return rawTs < 1e12 ? Math.round(rawTs * 1000) : Math.round(rawTs);
  }
  if (typeof rawTs === 'string') {
    const trimmed = rawTs.trim();
    if (!trimmed) return fallbackMs;
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      return num < 1e12 ? Math.round(num * 1000) : Math.round(num);
    }
    const parsedDate = Date.parse(trimmed);
    if (Number.isFinite(parsedDate) && parsedDate > 0) {
      return parsedDate;
    }
  }
  return fallbackMs;
}

export function normalizeTelemetryTimeframe(rawTf: unknown): TelemetryTimeframe {
  const s = String(rawTf ?? '').trim().toLowerCase();
  if (!s) return '5m';
  if (s === '1' || s === '1m' || s === '1min') return '1m';
  if (s === '3' || s === '3m' || s === '3min') return '3m';
  if (s === '5' || s === '5m' || s === '5min') return '5m';
  if (s === '15' || s === '15m' || s === '15min') return '15m';
  if (s === '30' || s === '30m' || s === '30min') return '30m';
  if (s === '60' || s === '1h' || s === '1hr' || s === '60m') return '1h';
  if (s === '240' || s === '4h' || s === '4hr') return '4h';
  if (s === 'd' || s === '1d' || s === 'day' || s === 'daily' || s === '1440') return '1D';
  return '5m';
}

export function normalizeTelemetrySymbol(rawSymbolInput: unknown): {
  rawSymbol: string;
  canonicalSymbol: string;
  deltaSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  assetClass: 'PERPETUAL' | 'SPOT' | 'OPTION' | 'UNKNOWN';
  inferredExchange?: string;
} {
  const raw = String(rawSymbolInput ?? '').trim();
  const upper = raw.toUpperCase();
  if (!upper) {
    return {
      rawSymbol: '',
      canonicalSymbol: 'UNKNOWN',
      deltaSymbol: 'UNKNOWN',
      baseAsset: 'UNKNOWN',
      quoteAsset: 'USDT',
      assetClass: 'UNKNOWN',
    };
  }

  let inferredExchange: string | undefined;
  let symPart = upper;
  if (upper.includes(':')) {
    const parts = upper.split(':');
    inferredExchange = parts[0].trim();
    symPart = parts.slice(1).join(':').trim();
  }

  // Options syntax e.g. C-BTC-90000-201126
  if (/^[CP]-[A-Z0-9]+-\d+/.test(symPart)) {
    const segs = symPart.split('-');
    return {
      rawSymbol: raw,
      canonicalSymbol: symPart,
      deltaSymbol: symPart,
      baseAsset: segs[1] || 'BTC',
      quoteAsset: 'USD',
      assetClass: 'OPTION',
      inferredExchange,
    };
  }

  const isPerpTag =
    symPart.endsWith('.P') ||
    symPart.endsWith('-PERP') ||
    symPart.endsWith('_PERP') ||
    symPart.endsWith('PERP');

  const cleaned = symPart
    .replace(/\.P$/i, '')
    .replace(/[-_]?PERP$/i, '')
    .replace(/[-_/]/g, '');

  let baseAsset = cleaned;
  let quoteAsset = 'USDT';

  if (cleaned.endsWith('USDT')) {
    baseAsset = cleaned.slice(0, -4);
    quoteAsset = 'USDT';
  } else if (cleaned.endsWith('USDC')) {
    baseAsset = cleaned.slice(0, -4);
    quoteAsset = 'USDC';
  } else if (cleaned.endsWith('USD')) {
    baseAsset = cleaned.slice(0, -3);
    quoteAsset = 'USD';
  } else if (cleaned.endsWith('BUSD')) {
    baseAsset = cleaned.slice(0, -4);
    quoteAsset = 'USDT';
  }

  const canonicalSymbol = `${baseAsset}USDT`;
  const deltaSymbol = `${baseAsset}USD`;
  const assetClass: 'PERPETUAL' | 'SPOT' =
    isPerpTag || quoteAsset === 'USD' || inferredExchange === 'DELTA' || !inferredExchange
      ? 'PERPETUAL'
      : 'SPOT';

  return {
    rawSymbol: raw,
    canonicalSymbol,
    deltaSymbol,
    baseAsset,
    quoteAsset: quoteAsset === 'USD' ? 'USDT' : quoteAsset,
    assetClass,
    inferredExchange,
  };
}

function normalizeSignalAction(rawAction: unknown, fallbackSide?: unknown): {
  present: boolean;
  action: TelemetrySignalAction;
} {
  const candidates = [rawAction, fallbackSide]
    .map((v) => String(v ?? '').trim().toUpperCase())
    .filter(Boolean);

  for (const val of candidates) {
    if (['BUY', 'LONG', 'BUY_LONG', 'ENTER_LONG', 'BULL', 'BULLISH', 'CALL'].includes(val)) {
      return { present: true, action: 'LONG' };
    }
    if (['SELL', 'SHORT', 'SELL_SHORT', 'ENTER_SHORT', 'BEAR', 'BEARISH', 'PUT'].includes(val)) {
      return { present: true, action: 'SHORT' };
    }
    if (['EXIT', 'CLOSE', 'FLATTEN', 'FLAT', 'CLOSE_LONG', 'CLOSE_SHORT'].includes(val)) {
      return { present: true, action: 'EXIT' };
    }
    if (['NEUTRAL', 'HOLD', 'NONE', 'HEARTBEAT', 'TICK'].includes(val)) {
      return { present: false, action: 'NEUTRAL' };
    }
  }

  return { present: false, action: 'NEUTRAL' };
}

interface ParsedRawTelemetry {
  provider: TelemetrySourceProvider;
  channel?: string;
  exchangeLabel?: string;
  rawSymbol: string;
  timeframe: TelemetryTimeframe;
  eventTimestampMs: number;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  bid?: number;
  ask?: number;
  high24h?: number;
  low24h?: number;
  volume?: number;
  openInterest?: number;
  fundingRate?: number;
  change24hPct?: number;
  signalPresent: boolean;
  signalAction: TelemetrySignalAction;
  strategy?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  contracts?: number;
  confidenceInput?: number;
  parseError?: string;
}

function parsePlainTextAlert(text: string): ParsedRawTelemetry {
  const trimmed = text.trim();
  const actionMatch = trimmed.match(/\b(BUY|SELL|LONG|SHORT|EXIT|CLOSE|FLAT)\b/i);
  const symbolMatch = trimmed.match(
    /\b(?:[A-Z]+:)?([A-Z]{2,10}(?:[-_/]?(?:USDT|USD|PERP)|\.P)?)\b/i
  );
  // Find explicit symbol token avoiding keywords
  const tokens = trimmed.split(/[\s,;]+/);
  let detectedSym = '';
  for (const tok of tokens) {
    const cleanTok = tok.toUpperCase();
    if (
      /^(BUY|SELL|LONG|SHORT|EXIT|CLOSE|FLAT|@|AT|SL|TP|TF|PRICE|CLOSE=|ENTRY)$/i.test(cleanTok) ||
      /^\d+(\.\d+)?$/.test(cleanTok)
    ) {
      continue;
    }
    if (
      cleanTok.includes(':') ||
      /(USDT|USD|PERP|\.P)$/i.test(cleanTok) ||
      /^(BTC|ETH|SOL|XRP|DOGE|AVAX)$/i.test(cleanTok)
    ) {
      detectedSym = tok;
      break;
    }
  }
  if (!detectedSym && symbolMatch) {
    detectedSym = symbolMatch[0];
  }

  const priceMatch =
    trimmed.match(/(?:@|price\s*[=:]\s*|close\s*[=:]\s*|entry\s*[=:]\s*)(\$?[\d,]+(?:\.\d+)?)/i) ||
    trimmed.match(/\b([\d,]{3,}(?:\.\d+)?)\b/);
  const slMatch = trimmed.match(/\bsl\s*[=:]?\s*(\$?[\d,]+(?:\.\d+)?)/i);
  const tpMatch = trimmed.match(/\btp\s*[=:]?\s*(\$?[\d,]+(?:\.\d+)?)/i);
  const tfMatch = trimmed.match(/\b(?:tf|interval|timeframe)\s*[=:]?\s*([0-9]+[mhd]?|1D)\b/i);

  const actionNorm = normalizeSignalAction(actionMatch ? actionMatch[1] : undefined);
  const price = priceMatch ? sanitizeNumber(priceMatch[1]) : undefined;

  return {
    provider: 'TRADINGVIEW_WEBHOOK',
    channel: 'webhook/text',
    exchangeLabel: 'TradingView',
    rawSymbol: detectedSym,
    timeframe: normalizeTelemetryTimeframe(tfMatch ? tfMatch[1] : '5m'),
    eventTimestampMs: Date.now(),
    price,
    entryPrice: price,
    stopLoss: slMatch ? sanitizeNumber(slMatch[1]) : undefined,
    takeProfit: tpMatch ? sanitizeNumber(tpMatch[1]) : undefined,
    signalPresent: actionNorm.present,
    signalAction: actionNorm.action,
    strategy: 'TradingView Text Alert',
    parseError: !detectedSym ? 'Unable to locate ticker symbol in plain-text telemetry payload.' : undefined,
  };
}

export function parseRawTelemetryPayload(
  rawInput: unknown,
  explicitSource?: TelemetrySourceProvider
): ParsedRawTelemetry {
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return {
        provider: explicitSource || 'CUSTOM_JSON',
        rawSymbol: '',
        timeframe: '5m',
        eventTimestampMs: Date.now(),
        signalPresent: false,
        signalAction: 'NEUTRAL',
        parseError: 'Empty telemetry payload string.',
      };
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsedJson = JSON.parse(trimmed);
        return parseRawTelemetryPayload(parsedJson, explicitSource);
      } catch {
        return parsePlainTextAlert(trimmed);
      }
    }
    return parsePlainTextAlert(trimmed);
  }

  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return {
      provider: explicitSource || 'CUSTOM_JSON',
      rawSymbol: '',
      timeframe: '5m',
      eventTimestampMs: Date.now(),
      signalPresent: false,
      signalAction: 'NEUTRAL',
      parseError: 'Telemetry payload must be a JSON object or TradingView alert string.',
    };
  }

  const obj = rawInput as Record<string, any>;
  // Handle nested exchange envelopes like { result: { ... } } or { data: { ... } } or Binance kline { e: 'kline', k: { ... } }
  const kline = obj.k && typeof obj.k === 'object' ? obj.k : null;
  const body: Record<string, any> =
    obj.result && typeof obj.result === 'object' && !Array.isArray(obj.result)
      ? { ...obj, ...obj.result }
      : obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
      ? { ...obj, ...obj.data }
      : obj;

  const isBinanceTicker =
    typeof body.s === 'string' &&
    (body.c !== undefined || body.p !== undefined || body.e === '24hrTicker' || Boolean(kline));
  const isBybitTicker =
    typeof body.symbol === 'string' &&
    (body.lastPrice !== undefined || body.bid1Price !== undefined || body.ask1Price !== undefined);
  const isDeltaTicker =
    String(body.type || '').includes('ticker') ||
    String(body.channel || '').includes('ticker') ||
    body.product_symbol !== undefined ||
    body.mark_price !== undefined ||
    body.oi_value_usd !== undefined ||
    String(body.exchange || '').toLowerCase().includes('delta');
  const isTradingView =
    body.ticker !== undefined ||
    body.strategy !== undefined ||
    body.interval !== undefined ||
    body.passphrase !== undefined ||
    body.alert_name !== undefined ||
    String(body.source || '').toLowerCase().includes('tradingview');

  const provider: TelemetrySourceProvider = explicitSource
    ? explicitSource
    : isTradingView
    ? 'TRADINGVIEW_WEBHOOK'
    : isDeltaTicker
    ? 'DELTA_EXCHANGE'
    : isBinanceTicker
    ? body.s?.endsWith('PERP') || String(body.ps || '').length > 0
      ? 'BINANCE_FUTURES'
      : 'BINANCE_SPOT'
    : isBybitTicker
    ? 'BYBIT'
    : 'CUSTOM_JSON';

  const rawSymbol = String(
    kline?.s ||
      body.product_symbol ||
      body.ticker ||
      body.symbol ||
      body.s ||
      body.pair ||
      body.instrument ||
      ''
  ).trim();

  const timeframe = normalizeTelemetryTimeframe(
    kline?.i || body.timeframe || body.interval || body.tf || body.resolution || '5m'
  );

  const rawTs =
    kline?.T ||
    kline?.t ||
    body.timestamp ||
    body.time ||
    body.E ||
    body.ts ||
    body.createdAt;
  const eventTimestampMs = normalizeEpochTimestamp(rawTs, Date.now());

  const quotes = body.quotes && typeof body.quotes === 'object' ? body.quotes : {};
  const bid = sanitizeNumber(quotes.best_bid ?? body.best_bid ?? body.bid1Price ?? body.b ?? body.bid);
  const ask = sanitizeNumber(quotes.best_ask ?? body.best_ask ?? body.ask1Price ?? body.a ?? body.ask);

  const open = sanitizeNumber(kline?.o ?? body.open ?? body.o);
  const high = sanitizeNumber(kline?.h ?? body.high ?? body.h);
  const low = sanitizeNumber(kline?.l ?? body.low ?? body.l);
  const price = sanitizeNumber(
    kline?.c ??
      body.mark_price ??
      body.markPrice ??
      body.close ??
      body.price ??
      body.lastPrice ??
      body.ltp ??
      body.c ??
      body.spot_price ??
      (bid && ask ? (bid + ask) / 2 : undefined)
  );

  const high24h = sanitizeNumber(body.high24h ?? body.highPrice24h ?? body.high_24h ?? body.h24);
  const low24h = sanitizeNumber(body.low24h ?? body.lowPrice24h ?? body.low_24h ?? body.l24);
  const volume = sanitizeNumber(
    kline?.v ?? body.turnover_usd ?? body.volume24hUsd ?? body.volume24h ?? body.volume ?? body.v ?? body.q
  );
  const openInterest = sanitizeNumber(
    body.oi_value_usd ?? body.openInterestUsd ?? body.openInterest ?? body.oi
  );
  const fundingRate = sanitizeNumber(body.funding_rate ?? body.fundingRate ?? body.fundingRate24h);
  const change24hPct = sanitizeNumber(
    body.mark_change_24h ?? body.ltp_change_24h ?? body.change24h ?? body.P ?? body.price24hPcnt
  );

  const stratObj = body.strategy && typeof body.strategy === 'object' ? body.strategy : null;
  const rawAction =
    stratObj?.order_action ??
    stratObj?.market_position ??
    body.action ??
    body.signal ??
    body.order_action ??
    body.direction;
  const { present: signalPresent, action: signalAction } = normalizeSignalAction(
    rawAction,
    body.side
  );

  const entryPrice = sanitizeNumber(
    stratObj?.order_price ?? body.entryPrice ?? body.entry ?? body.limitPrice ?? price
  );
  const stopLoss = sanitizeNumber(body.stopLoss ?? body.stop_loss ?? body.sl ?? stratObj?.sl);
  const takeProfit = sanitizeNumber(body.takeProfit ?? body.take_profit ?? body.tp ?? stratObj?.tp);
  const contracts = sanitizeNumber(
    stratObj?.order_contracts ?? body.contracts ?? body.size ?? body.qty ?? body.lotSize
  );
  const confidenceInput = sanitizeNumber(body.confidence ?? body.score ?? body.aiConfidence);

  const exchangeLabel = String(
    body.exchange ||
      (provider === 'DELTA_EXCHANGE'
        ? 'Delta Exchange India'
        : provider === 'TRADINGVIEW_WEBHOOK'
        ? 'TradingView'
        : provider === 'BINANCE_FUTURES' || provider === 'BINANCE_SPOT'
        ? 'Binance'
        : provider === 'BYBIT'
        ? 'Bybit'
        : 'Custom Feed')
  );

  return {
    provider,
    channel: String(body.channel || body.type || (isTradingView ? 'tradingview/webhook' : 'market/ticker')),
    exchangeLabel,
    rawSymbol,
    timeframe,
    eventTimestampMs,
    price,
    open,
    high,
    low,
    bid,
    ask,
    high24h,
    low24h,
    volume,
    openInterest,
    fundingRate,
    change24hPct,
    signalPresent,
    signalAction,
    strategy:
      typeof body.strategy === 'string'
        ? body.strategy
        : body.strategyName || body.alert_name || stratObj?.name || undefined,
    entryPrice,
    stopLoss,
    takeProfit,
    contracts,
    confidenceInput,
    parseError: !rawSymbol ? 'Missing symbol / ticker identifier in telemetry payload.' : undefined,
  };
}

function calcEmaSeries(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcSma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-Math.min(period, values.length));
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return sum / slice.length;
}

export function computeHistoricalTelemetryIndicators(
  candles: TelemetryHistoricalCandle[],
  referencePrice?: number
): NormalizedTelemetryIndicators {
  const validCandles = (Array.isArray(candles) ? candles : []).filter(
    (c) =>
      Number.isFinite(Number(c?.close)) &&
      Number(c.close) > 0 &&
      Number.isFinite(Number(c?.high)) &&
      Number.isFinite(Number(c?.low))
  );

  if (validCandles.length === 0) {
    const fallback = referencePrice && referencePrice > 0 ? referencePrice : 0;
    return {
      candleCount: 0,
      latestClose: fallback,
      ema9: fallback,
      ema20: fallback,
      ema50: fallback,
      sma20: fallback,
      sma50: fallback,
      vwap: fallback,
      atr14: 0,
      atrPct: 0,
      bollingerUpper: fallback,
      bollingerMid: fallback,
      bollingerLower: fallback,
      bollingerWidthPct: 0,
      zScore: 0,
      realizedVolPct: 0,
    };
  }

  const closes = validCandles.map((c) => Number(c.close));
  const latestClose = closes[closes.length - 1];
  const ref = referencePrice && referencePrice > 0 ? referencePrice : latestClose;

  const ema9 = calcEmaSeries(closes, 9);
  const ema20 = calcEmaSeries(closes, 20);
  const ema50 = calcEmaSeries(closes, 50);
  const sma20 = calcSma(closes, 20);
  const sma50 = calcSma(closes, 50);

  // Session VWAP across available lookback (up to 48 bars)
  const vwapSlice = validCandles.slice(-48);
  let pvSum = 0;
  let volSum = 0;
  for (const bar of vwapSlice) {
    const typical = (Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3;
    const vol = Math.max(1, Number(bar.volume || 1));
    pvSum += typical * vol;
    volSum += vol;
  }
  const vwap = volSum > 0 ? pvSum / volSum : latestClose;

  // True Range & Wilder/EMA ATR(14)
  const trueRanges: number[] = [];
  for (let i = 0; i < validCandles.length; i++) {
    const cur = validCandles[i];
    const h = Number(cur.high);
    const l = Number(cur.low);
    if (i === 0) {
      trueRanges.push(Math.max(0, h - l));
    } else {
      const prevClose = Number(validCandles[i - 1].close);
      const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
      trueRanges.push(Math.max(0, tr));
    }
  }
  const atrPeriod = Math.min(14, trueRanges.length);
  let atr14 = calcSma(trueRanges.slice(0, atrPeriod), atrPeriod);
  for (let i = atrPeriod; i < trueRanges.length; i++) {
    atr14 = (atr14 * (atrPeriod - 1) + trueRanges[i]) / atrPeriod;
  }
  const atrPct = latestClose > 0 ? (atr14 / latestClose) * 100 : 0;

  // 20-period Bollinger Bands & Z-Score
  const bbWindow = closes.slice(-Math.min(20, closes.length));
  const bbMean = bbWindow.reduce((a, b) => a + b, 0) / bbWindow.length;
  const variance =
    bbWindow.reduce((acc, v) => acc + Math.pow(v - bbMean, 2), 0) / bbWindow.length;
  const stdDev = Math.sqrt(Math.max(0, variance));
  const bollingerUpper = bbMean + 2 * stdDev;
  const bollingerLower = Math.max(0, bbMean - 2 * stdDev);
  const bollingerWidthPct = bbMean > 0 ? ((bollingerUpper - bollingerLower) / bbMean) * 100 : 0;
  const zScore = stdDev > 1e-9 ? (ref - bbMean) / stdDev : 0;

  // Realized volatility from log returns (standard deviation in %)
  const returns: number[] = [];
  for (let i = 1; i < bbWindow.length; i++) {
    if (bbWindow[i - 1] > 0 && bbWindow[i] > 0) {
      returns.push(Math.log(bbWindow[i] / bbWindow[i - 1]));
    }
  }
  let realizedVolPct = 0;
  if (returns.length >= 2) {
    const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
    const retVar =
      returns.reduce((acc, r) => acc + Math.pow(r - meanRet, 2), 0) / returns.length;
    realizedVolPct = Math.sqrt(retVar) * Math.sqrt(returns.length) * 100;
  }

  return {
    candleCount: validCandles.length,
    latestClose: roundAdaptive(latestClose, ref),
    ema9: roundAdaptive(ema9, ref),
    ema20: roundAdaptive(ema20, ref),
    ema50: roundAdaptive(ema50, ref),
    sma20: roundAdaptive(sma20, ref),
    sma50: roundAdaptive(sma50, ref),
    vwap: roundAdaptive(vwap, ref),
    atr14: roundAdaptive(atr14, ref),
    atrPct: Number(atrPct.toFixed(3)),
    bollingerUpper: roundAdaptive(bollingerUpper, ref),
    bollingerMid: roundAdaptive(bbMean, ref),
    bollingerLower: roundAdaptive(bollingerLower, ref),
    bollingerWidthPct: Number(bollingerWidthPct.toFixed(3)),
    zScore: Number(zScore.toFixed(2)),
    realizedVolPct: Number(realizedVolPct.toFixed(3)),
  };
}

export function validateTelemetryAgainstHistory(params: {
  parsed: ParsedRawTelemetry;
  indicators: NormalizedTelemetryIndicators;
  candles: TelemetryHistoricalCandle[];
  thresholds?: TelemetryProcessorThresholds;
}): NormalizedTelemetryValidation {
  const cfg = { ...DEFAULT_THRESHOLDS, ...(params.thresholds || {}) };
  const { parsed, indicators, candles } = params;
  const reasons: string[] = [];

  if (parsed.parseError) {
    reasons.push(parsed.parseError);
  }

  const refPrice = parsed.price ?? indicators.latestClose;
  const hasValidPrice = typeof refPrice === 'number' && Number.isFinite(refPrice) && refPrice > 0;
  if (!hasValidPrice) {
    reasons.push('Telemetry price is missing or non-positive.');
  }

  const hasSufficientHistory = indicators.candleCount >= cfg.minCandlesRequired;
  if (!hasSufficientHistory) {
    reasons.push(
      `Insufficient historical candles (${indicators.candleCount}/${cfg.minCandlesRequired} required for MA & volatility validation).`
    );
  }

  // 1. Price sanity / outlier deviation against historical latest close
  const deviationPct =
    hasValidPrice && indicators.latestClose > 0
      ? Number((((refPrice - indicators.latestClose) / indicators.latestClose) * 100).toFixed(3))
      : 0;
  const absDevPct = Math.abs(deviationPct);
  const priceDeviationPassed = hasValidPrice && (indicators.latestClose <= 0 || absDevPct <= cfg.maxPriceDeviationPct);
  const priceDeviationReason = !hasValidPrice
    ? 'Invalid price'
    : priceDeviationPassed
    ? `Price within ${absDevPct.toFixed(2)}% of historical close ($${indicators.latestClose})`
    : `Rejected outlier price: ${absDevPct.toFixed(2)}% deviation exceeds ${cfg.maxPriceDeviationPct}% threshold vs $${indicators.latestClose}`;
  if (!priceDeviationPassed) {
    reasons.push(priceDeviationReason);
  }

  // 2. Moving Average Alignment Check
  const ema9VsEma20: 'BULLISH' | 'BEARISH' | 'FLAT' =
    indicators.ema9 > indicators.ema20 * 1.0003
      ? 'BULLISH'
      : indicators.ema9 < indicators.ema20 * 0.9997
      ? 'BEARISH'
      : 'FLAT';

  const priceVsSma20Pct =
    hasValidPrice && indicators.sma20 > 0
      ? Number((((refPrice - indicators.sma20) / indicators.sma20) * 100).toFixed(3))
      : 0;
  const priceVsEma50Pct =
    hasValidPrice && indicators.ema50 > 0
      ? Number((((refPrice - indicators.ema50) / indicators.ema50) * 100).toFixed(3))
      : 0;
  const extensionAtrRatio =
    hasValidPrice && indicators.atr14 > 0
      ? Number((Math.abs(refPrice - indicators.ema20) / indicators.atr14).toFixed(2))
      : 0;

  let maAligned = true;
  let maOverextended = false;
  let maReason = `EMA9 ($${indicators.ema9}) vs EMA20 ($${indicators.ema20}) is ${ema9VsEma20}; Price ${priceVsSma20Pct >= 0 ? '+' : ''}${priceVsSma20Pct.toFixed(2)}% vs SMA20`;

  if (parsed.signalPresent && (parsed.signalAction === 'LONG' || parsed.signalAction === 'SHORT')) {
    const isLong = parsed.signalAction === 'LONG';
    if (isLong) {
      const severeCounterTrend =
        hasSufficientHistory &&
        refPrice < indicators.ema50 * 0.996 &&
        ema9VsEma20 === 'BEARISH';
      const moderatePullbackOk =
        refPrice >= indicators.ema20 * 0.996 || ema9VsEma20 === 'BULLISH' || refPrice >= indicators.sma20 * 0.996;
      const chasingTop =
        indicators.atr14 > 0 &&
        refPrice - indicators.ema20 > cfg.maxExtensionAtrMultiple * indicators.atr14;

      if (severeCounterTrend) {
        maAligned = false;
        maReason = `Rejected counter-trend LONG: Price ($${refPrice}) below EMA50 ($${indicators.ema50}) with bearish EMA9/EMA20 cross.`;
        reasons.push(maReason);
      } else if (chasingTop) {
        maOverextended = true;
        maAligned = !cfg.strictMode;
        maReason = `Caution LONG extension: Price is +${extensionAtrRatio}x ATR above EMA20 (max ${cfg.maxExtensionAtrMultiple}x).`;
        reasons.push(maReason);
      } else if (!moderatePullbackOk && hasSufficientHistory) {
        maAligned = false;
        maReason = `Rejected weak LONG: Price ($${refPrice}) below SMA20 ($${indicators.sma20}) without bullish EMA9/20 recovery.`;
        reasons.push(maReason);
      } else {
        maReason = `MA Verified LONG: ${ema9VsEma20} EMA9/20 ribbon, ${priceVsSma20Pct >= 0 ? '+' : ''}${priceVsSma20Pct.toFixed(2)}% vs SMA20 (${extensionAtrRatio}x ATR).`;
      }
    } else {
      const severeCounterTrend =
        hasSufficientHistory &&
        refPrice > indicators.ema50 * 1.004 &&
        ema9VsEma20 === 'BULLISH';
      const moderateBounceShortOk =
        refPrice <= indicators.ema20 * 1.004 || ema9VsEma20 === 'BEARISH' || refPrice <= indicators.sma20 * 1.004;
      const chasingBottom =
        indicators.atr14 > 0 &&
        indicators.ema20 - refPrice > cfg.maxExtensionAtrMultiple * indicators.atr14;

      if (severeCounterTrend) {
        maAligned = false;
        maReason = `Rejected counter-trend SHORT: Price ($${refPrice}) above EMA50 ($${indicators.ema50}) with bullish EMA9/EMA20 cross.`;
        reasons.push(maReason);
      } else if (chasingBottom) {
        maOverextended = true;
        maAligned = !cfg.strictMode;
        maReason = `Caution SHORT extension: Price is -${extensionAtrRatio}x ATR below EMA20 (max ${cfg.maxExtensionAtrMultiple}x).`;
        reasons.push(maReason);
      } else if (!moderateBounceShortOk && hasSufficientHistory) {
        maAligned = false;
        maReason = `Rejected weak SHORT: Price ($${refPrice}) above SMA20 ($${indicators.sma20}) without bearish EMA9/20 rollover.`;
        reasons.push(maReason);
      } else {
        maReason = `MA Verified SHORT: ${ema9VsEma20} EMA9/20 ribbon, ${priceVsSma20Pct >= 0 ? '+' : ''}${priceVsSma20Pct.toFixed(2)}% vs SMA20 (${extensionAtrRatio}x ATR).`;
      }
    }

    // Validate SL/TP geometry when supplied
    if (hasValidPrice) {
      if (parsed.stopLoss !== undefined) {
        const badSl = parsed.signalAction === 'LONG' ? parsed.stopLoss >= refPrice : parsed.stopLoss <= refPrice;
        if (badSl) {
          maAligned = false;
          reasons.push(
            `Invalid risk geometry: ${parsed.signalAction} SL ($${parsed.stopLoss}) sits on wrong side of entry ($${refPrice}).`
          );
        }
      }
      if (parsed.takeProfit !== undefined) {
        const badTp = parsed.signalAction === 'LONG' ? parsed.takeProfit <= refPrice : parsed.takeProfit >= refPrice;
        if (badTp) {
          maAligned = false;
          reasons.push(
            `Invalid target geometry: ${parsed.signalAction} TP ($${parsed.takeProfit}) sits on wrong side of entry ($${refPrice}).`
          );
        }
      }
    }
  }

  // 3. Volatility Indicator Gate (ATR%, Bollinger Width%, Z-Score, Candle Range / ATR, Bid-Ask Spread)
  const latestCandle = candles.length > 0 ? candles[candles.length - 1] : undefined;
  const incomingRange =
    parsed.high !== undefined && parsed.low !== undefined && parsed.high >= parsed.low
      ? parsed.high - parsed.low
      : latestCandle
      ? Math.max(0, Number(latestCandle.high) - Number(latestCandle.low))
      : 0;
  const candleRangeToAtrRatio =
    indicators.atr14 > 0 ? Number((incomingRange / indicators.atr14).toFixed(2)) : 0;

  const spreadBps =
    parsed.bid && parsed.ask && parsed.ask >= parsed.bid && refPrice > 0
      ? Number((((parsed.ask - parsed.bid) / refPrice) * 10000).toFixed(2))
      : undefined;

  const maxAtrLimit =
    parsed.timeframe === '4h' || parsed.timeframe === '1D'
      ? cfg.maxAtrPctIntraday * 2.2
      : cfg.maxAtrPctIntraday;

  let regime: TelemetryVolatilityRegime = 'NORMAL';
  if (
    indicators.atrPct >= maxAtrLimit ||
    Math.abs(indicators.zScore) >= cfg.maxZScoreExtreme ||
    candleRangeToAtrRatio >= 3.5
  ) {
    regime = 'EXTREME';
  } else if (indicators.atrPct >= maxAtrLimit * 0.45 || indicators.bollingerWidthPct >= 2.2 || Math.abs(indicators.zScore) >= 2.1) {
    regime = 'ELEVATED';
  } else if (indicators.bollingerWidthPct > 0 && indicators.bollingerWidthPct < cfg.minCompressedBbWidthPct) {
    regime = 'COMPRESSED';
  }

  let volPassed = true;
  let volReason = `Volatility ${regime}: ATR(14) ${indicators.atrPct.toFixed(2)}%, BB Width ${indicators.bollingerWidthPct.toFixed(2)}%, Z-Score ${indicators.zScore}`;

  if (regime === 'EXTREME') {
    volPassed = false;
    volReason = `Rejected EXTREME volatility regime: ATR% ${indicators.atrPct.toFixed(2)}% / Z-Score ${indicators.zScore} / Bar Range ${candleRangeToAtrRatio}x ATR.`;
    reasons.push(volReason);
  } else if (spreadBps !== undefined && spreadBps > cfg.maxSpreadBps) {
    volPassed = false;
    volReason = `Rejected liquidity spread anomaly: ${spreadBps} bps exceeds ${cfg.maxSpreadBps} bps ceiling.`;
    reasons.push(volReason);
  } else if (regime === 'COMPRESSED' && parsed.signalPresent) {
    volReason = `Caution COMPRESSED volatility squeeze (BB Width ${indicators.bollingerWidthPct.toFixed(2)}%); breakout confirmation pending.`;
    reasons.push(volReason);
  }

  // Final status & score
  let status: TelemetryValidationStatus = 'APPROVED';
  if (
    parsed.parseError ||
    !hasValidPrice ||
    !priceDeviationPassed ||
    !volPassed ||
    (parsed.signalPresent && !maAligned) ||
    (!hasSufficientHistory && parsed.signalPresent)
  ) {
    status = 'REJECTED';
  } else if (maOverextended || regime === 'COMPRESSED' || regime === 'ELEVATED' || !hasSufficientHistory) {
    status = 'WARN_CAUTION';
  }

  let score = 96;
  if (status === 'REJECTED') {
    score = Math.max(12, 45 - reasons.length * 10);
  } else if (status === 'WARN_CAUTION') {
    score = Math.max(62, 82 - reasons.length * 6);
  }
  if (!hasSufficientHistory) score = Math.min(score, 55);

  if (reasons.length === 0) {
    reasons.push('Normalized & validated against historical EMA/SMA trend alignment and ATR/Bollinger volatility bounds.');
  }

  return {
    status,
    validForOutput: status !== 'REJECTED',
    score,
    maAlignment: {
      aligned: maAligned,
      ema9VsEma20,
      priceVsSma20Pct,
      priceVsEma50Pct,
      extensionAtrRatio,
      reason: maReason,
    },
    volatilityCheck: {
      passed: volPassed,
      regime,
      atr14: indicators.atr14,
      atrPct: indicators.atrPct,
      bollingerWidthPct: indicators.bollingerWidthPct,
      zScore: indicators.zScore,
      candleRangeToAtrRatio,
      spreadBps,
      reason: volReason,
    },
    priceDeviationCheck: {
      passed: priceDeviationPassed,
      deviationPct,
      reason: priceDeviationReason,
    },
    reasons,
  };
}

export function processTelemetryStreamItem(
  rawInput: unknown,
  historicalCandles: TelemetryHistoricalCandle[],
  options?: {
    source?: TelemetrySourceProvider;
    thresholds?: TelemetryProcessorThresholds;
    receivedAtMs?: number;
  }
): TelemetryIngestionResult {
  const receivedAtMs = options?.receivedAtMs ?? Date.now();
  const parsed = parseRawTelemetryPayload(rawInput, options?.source);
  const symbolMeta = normalizeTelemetrySymbol(parsed.rawSymbol);
  const candles = Array.isArray(historicalCandles) ? historicalCandles : [];
  const latestCandle = candles.length > 0 ? candles[candles.length - 1] : undefined;

  const resolvedPrice = parsed.price ?? latestCandle?.close ?? 0;
  const indicators = computeHistoricalTelemetryIndicators(candles, resolvedPrice);
  const validation = validateTelemetryAgainstHistory({
    parsed: { ...parsed, price: resolvedPrice > 0 ? resolvedPrice : undefined },
    indicators,
    candles,
    thresholds: options?.thresholds,
  });

  const spreadBps = validation.volatilityCheck.spreadBps;
  const envelope: NormalizedTelemetryEnvelope = {
    schemaVersion: '1.0',
    telemetryId: `tel_${receivedAtMs.toString(36)}_${computeSimpleHash(rawInput).slice(6)}`,
    receivedAtIso: new Date(receivedAtMs).toISOString(),
    receivedAtMs,
    eventTimestampIso: new Date(parsed.eventTimestampMs).toISOString(),
    eventTimestampMs: parsed.eventTimestampMs,
    source: {
      provider: parsed.provider,
      rawSymbol: symbolMeta.rawSymbol || 'UNKNOWN',
      assetClass: symbolMeta.assetClass,
      channel: parsed.channel,
      exchangeLabel: symbolMeta.inferredExchange || parsed.exchangeLabel,
    },
    instrument: {
      canonicalSymbol: symbolMeta.canonicalSymbol,
      deltaSymbol: symbolMeta.deltaSymbol,
      baseAsset: symbolMeta.baseAsset,
      quoteAsset: symbolMeta.quoteAsset,
    },
    marketData: {
      price: roundAdaptive(resolvedPrice, resolvedPrice),
      open: parsed.open !== undefined ? roundAdaptive(parsed.open, resolvedPrice) : undefined,
      high: parsed.high !== undefined ? roundAdaptive(parsed.high, resolvedPrice) : undefined,
      low: parsed.low !== undefined ? roundAdaptive(parsed.low, resolvedPrice) : undefined,
      bid: parsed.bid !== undefined ? roundAdaptive(parsed.bid, resolvedPrice) : undefined,
      ask: parsed.ask !== undefined ? roundAdaptive(parsed.ask, resolvedPrice) : undefined,
      spreadBps,
      high24h: parsed.high24h !== undefined ? roundAdaptive(parsed.high24h, resolvedPrice) : undefined,
      low24h: parsed.low24h !== undefined ? roundAdaptive(parsed.low24h, resolvedPrice) : undefined,
      volume: parsed.volume,
      openInterest: parsed.openInterest,
      fundingRate: parsed.fundingRate,
      change24hPct: parsed.change24hPct !== undefined ? Number(parsed.change24hPct.toFixed(2)) : undefined,
      timeframe: parsed.timeframe,
    },
    signal: {
      present: parsed.signalPresent,
      action: parsed.signalAction,
      strategy: parsed.strategy,
      entryPrice: roundAdaptive(parsed.entryPrice ?? resolvedPrice, resolvedPrice),
      stopLoss: parsed.stopLoss !== undefined ? roundAdaptive(parsed.stopLoss, resolvedPrice) : undefined,
      takeProfit: parsed.takeProfit !== undefined ? roundAdaptive(parsed.takeProfit, resolvedPrice) : undefined,
      contracts: parsed.contracts,
      confidenceInput: parsed.confidenceInput,
    },
    indicators,
    validation,
    rawPayloadHash: computeSimpleHash(rawInput),
  };

  return {
    accepted: validation.validForOutput,
    quarantined: !validation.validForOutput,
    telemetry: validation.validForOutput ? envelope : null,
    diagnostic: envelope,
  };
}

export function processTelemetryStreamBatch(
  rawItems: unknown[],
  resolveCandles: (canonicalSymbol: string, timeframe: TelemetryTimeframe) => TelemetryHistoricalCandle[],
  options?: {
    source?: TelemetrySourceProvider;
    thresholds?: TelemetryProcessorThresholds;
  }
): {
  outputStream: NormalizedTelemetryEnvelope[];
  quarantinedStream: NormalizedTelemetryEnvelope[];
  summary: {
    totalProcessed: number;
    acceptedCount: number;
    rejectedCount: number;
    approvalRatePct: number;
  };
} {
  const outputStream: NormalizedTelemetryEnvelope[] = [];
  const quarantinedStream: NormalizedTelemetryEnvelope[] = [];

  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    const preParsed = parseRawTelemetryPayload(item, options?.source);
    const sym = normalizeTelemetrySymbol(preParsed.rawSymbol);
    const candles = resolveCandles(sym.canonicalSymbol, preParsed.timeframe);
    const result = processTelemetryStreamItem(item, candles, options);
    if (result.telemetry) {
      outputStream.push(result.telemetry);
    } else {
      quarantinedStream.push(result.diagnostic);
    }
  }

  const totalProcessed = outputStream.length + quarantinedStream.length;
  const approvalRatePct =
    totalProcessed > 0 ? Number(((outputStream.length / totalProcessed) * 100).toFixed(1)) : 100;

  return {
    outputStream,
    quarantinedStream,
    summary: {
      totalProcessed,
      acceptedCount: outputStream.length,
      rejectedCount: quarantinedStream.length,
      approvalRatePct,
    },
  };
}
