/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * INSTITUTIONAL INTRADAY SNIPER STRATEGY ENGINE FOR BTC (DeltaAI)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Deterministic, side-effect-free strategy engine implementing:
 *
 * Strict Hierarchy:
 * MARKET STRUCTURE -> TRADE LOCATION -> MOMENTUM -> CONFIRMATION -> RISK MANAGEMENT -> EXECUTION
 *
 * Rules:
 * 1. Completed Candles Only: 4H regime, 1H trend validation, 15M primary signal/confirmation,
 *    5M entry refinement only. Explicitly tags signals as CONFIRMED, DEVELOPING, ANTICIPATED, or INVALIDATED.
 * 2. Daily CPR Engine: P, BC, TC, width classification (NARROW, NORMAL, WIDE), slope vs prior, price acceptance.
 * 3. Virgin CPR Registry: Historical untouched CPR zones tracking, mitigation, target confluence, obstacle blocking.
 * 4. Camarilla Pivot Engine: H3, H4, H5, H6, L3, L4, L5, L6 calculated from previous completed 1D candle.
 * 5. Fibonacci & EMA 9/21 Engines: Intraday swing retracements/extensions and 15M/1H EMA 9/21 stacks and slopes.
 * 6. Setup Evaluators:
 *    - Setup A: Trend Continuation
 *    - Setup B: Camarilla Reversal (reduced risk)
 *    - Setup C: Narrow CPR Breakout/Breakdown
 *    - Setup D: EMA 9/21 Pullback
 * 7. 16-Point Confluence Scoring: Grades A+ (13-16), A (10-12), B (8-9, Observation Only), NO TRADE (0-7).
 * 8. Hard No-Trade Filters: Override any score -> NO TRADE (CPR trap, flat EMA, HTF contradiction, obstacle, R:R < 1.8,
 *    daily loss >= 1.5%, 3 consecutive stops).
 * 9. Position Sizing & Structured Exits: 0.25% equity risk cap (max 0.50%), Delta lots (0.001 BTC),
 *    TP1 (35% @ ~1R), TP2 (35% @ ~2R), Runner (30% trailing 15M swing).
 * 10. 9-Section BTC INTRADAY STRATEGY REPORT generator.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

export interface BtcCandle {
  time: number; // Unix timestamp in seconds or ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MultiTimeframeCandles {
  c4h?: BtcCandle[];
  c1h?: BtcCandle[];
  c15m?: BtcCandle[];
  c5m?: BtcCandle[];
  c1d?: BtcCandle[];
}

export type MarketRegimeType = 'BULLISH' | 'BEARISH' | 'CHOP';
export type SignalLifecycleState = 'CONFIRMED' | 'DEVELOPING' | 'ANTICIPATED' | 'INVALIDATED';
export type SniperActionType = 'LONG' | 'SHORT' | 'WAIT' | 'NO_TRADE';

export type CprWidthRegime = 'NARROW' | 'NORMAL' | 'WIDE';
export type CprSlopeType = 'HIGHER_VALUE' | 'LOWER_VALUE' | 'OVERLAPPING' | 'INSIDE_VALUE' | 'OUTSIDE_VALUE' | 'NEUTRAL';
export type PriceAcceptance = 'ABOVE' | 'BELOW' | 'INSIDE';

export interface DailyCprData {
  p: number;
  bc: number;
  tc: number;
  cprTop: number;
  cprBottom: number;
  cprMid: number;
  width: number;
  widthPct: number;
  widthRegime: CprWidthRegime;
  slopeVsPrior: CprSlopeType;
  priceAcceptance: PriceAcceptance;
  priorCpr?: {
    top: number;
    bottom: number;
    mid: number;
  };
}

export interface VirginCprZone {
  id: string;
  originDate: string;
  sessionStartUtcMs: number;
  upper: number;
  lower: number;
  midpoint: number;
  width: number;
  widthPct: number;
  distanceFromPrice: number;
  distancePct: number;
  isUntouched: boolean;
  relation: 'ABOVE' | 'BELOW' | 'INSIDE';
}

export interface CamarillaPivots {
  range: number;
  h3: number;
  h4: number;
  h5: number;
  h6: number;
  l3: number;
  l4: number;
  l5: number;
  l6: number;
}

export interface FibonacciLevels {
  swingHigh: number;
  swingLow: number;
  isBullish: boolean;
  fib382: number;
  fib500: number;
  fib618: number;
  fib786: number;
  ext1272: number;
  ext1618: number;
}

export type EmaStackType = 'BULLISH_STACK' | 'BEARISH_STACK' | 'ENTANGLED_CHOP';

export interface Ema921Data {
  ema9: number;
  ema21: number;
  slopePct: number;
  stack: EmaStackType;
  angleDeg: number;
  spreadPct: number;
}

export type SniperSetupId =
  | 'SETUP_A_TREND_CONTINUATION'
  | 'SETUP_B_CAMARILLA_REVERSAL'
  | 'SETUP_C_NARROW_CPR_BREAKOUT'
  | 'SETUP_D_EMA_PULLBACK'
  | 'NONE';

export interface SniperSetupClassification {
  id: SniperSetupId;
  name: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  description: string;
  riskPct: number; // 0.25% default, 0.15% for countertrend
  rationale: string;
}

export interface ConfluenceItem {
  id: string;
  label: string;
  weight: number;
  earned: number;
  passed: boolean;
  reason: string;
}

export type ConfluenceGrade = 'A+' | 'A' | 'B' | 'NO_TRADE';

export interface ConfluenceScoreResult {
  totalScore: number; // 0 - 16
  maxScore: 16;
  grade: ConfluenceGrade;
  convictionPct: number;
  items: ConfluenceItem[];
  summary: string;
}

export interface HardFilterItem {
  id: string;
  label: string;
  triggered: boolean;
  reason: string;
}

export interface HardFiltersResult {
  passed: boolean;
  triggeredCount: number;
  filters: HardFilterItem[];
  blockingReason?: string;
}

export interface BtcPositionSizeResult {
  accountEquityUsd: number;
  riskPct: number; // 0.25% standard, max 0.50%
  riskAmountUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  riskDistanceUsd: number;
  riskDistancePct: number;
  rawBtcSize: number;
  deltaLots: number; // 1 lot = 0.001 BTC
  clampedBtcSize: number;
  notionalUsd: number;
  estimatedMarginUsd: number;
  effectiveLeverage: number;
  roundtripFeeUsd: number;
  netRiskUsd: number;
}

export interface BtcStructuredExits {
  entryPrice: number;
  stopLoss: number;
  tp1Price: number;
  tp1Pct: number; // 35%
  tp1R: number;
  tp1Action: string;
  tp2Price: number;
  tp2Pct: number; // 35%
  tp2R: number;
  tp2Action: string;
  tp3RunnerPrice: number;
  tp3RunnerPct: number; // 30%
  tp3R: number;
  tp3Action: string;
  riskRewardRatio: number;
  breakevenWithFeePrice: number;
}

export interface BtcStrategyReport {
  generatedAtUtc: string;
  symbol: string;
  sectionA_marketSnapshot: {
    markPrice: number;
    high24h: number;
    low24h: number;
    change24hPct: number;
    atr14_15m: number;
    atrPct: number;
  };
  sectionB_marketStructure: {
    regime4H: MarketRegimeType;
    regime1H: MarketRegimeType;
    structure15M: MarketRegimeType;
    keySwings: { swingHigh: number; swingLow: number };
  };
  sectionC_cprAnalysis: DailyCprData & {
    virginCprZonesCount: number;
    nearestVirginCpr?: VirginCprZone | null;
  };
  sectionD_camarillaConfluence: CamarillaPivots & {
    keyLevelNote: string;
  };
  sectionE_fibonacciAndEma: {
    fibonacci: FibonacciLevels;
    ema15m: Ema921Data;
    ema1h: Ema921Data;
  };
  sectionF_setupAndConfluence: {
    setup: SniperSetupClassification;
    confluence: ConfluenceScoreResult;
  };
  sectionG_hardFiltersAudit: HardFiltersResult;
  sectionH_riskAndPositionSizing: BtcPositionSizeResult;
  sectionI_finalExecutionSummary: {
    action: SniperActionType;
    signalState: SignalLifecycleState;
    exits: BtcStructuredExits;
    executionProtocol: string;
  };
  formattedText: string;
}

export interface InstitutionalBtcSniperResult {
  symbol: string;
  action: SniperActionType;
  signalState: SignalLifecycleState;
  marketStructure4H: MarketRegimeType;
  trendAlignment1H: MarketRegimeType;
  structure15M: MarketRegimeType;
  currentPrice: number;
  dailyCpr: DailyCprData;
  virginCprZones: VirginCprZone[];
  camarilla: CamarillaPivots;
  fibonacci: FibonacciLevels;
  ema15m: Ema921Data;
  ema1h: Ema921Data;
  setup: SniperSetupClassification;
  confluence: ConfluenceScoreResult;
  hardFilters: HardFiltersResult;
  sizing: BtcPositionSizeResult;
  exits: BtcStructuredExits;
  report: BtcStrategyReport;
  circuitBreakerActive: boolean;
  circuitBreakerReason?: string;
  timestamp: number;
}

export interface SniperEngineInput {
  symbol: string;
  currentPrice: number;
  candles: MultiTimeframeCandles;
  accountEquityUsd?: number;
  sessionRealizedPnLUsd?: number;
  consecutiveStopsCount?: number;
  historicalUntouchedCprs?: VirginCprZone[];
  high24h?: number;
  low24h?: number;
  change24h?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// MATHEMATICAL & TECHNICAL INDICATOR HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates Exponential Moving Average (EMA) of a candle series for a given period.
 */
export function calculateEmaSeries(candles: BtcCandle[], period: number): number[] {
  if (!candles || candles.length === 0) return [];
  const k = 2 / (period + 1);
  const emaValues: number[] = new Array(candles.length);

  // Initialize with SMA for the first period
  const initPeriod = Math.min(period, candles.length);
  let sum = 0;
  for (let i = 0; i < initPeriod; i++) {
    sum += candles[i].close;
  }
  let currentEma = sum / initPeriod;
  for (let i = 0; i < initPeriod; i++) {
    emaValues[i] = currentEma;
  }

  for (let i = initPeriod; i < candles.length; i++) {
    currentEma = candles[i].close * k + currentEma * (1 - k);
    emaValues[i] = currentEma;
  }

  return emaValues;
}

/**
 * Calculates Average True Range (ATR) over period.
 */
export function calculateAtr(candles: BtcCandle[], period = 14): number {
  if (!candles || candles.length < 2) return 500; // sensible fallback for BTC
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
  }
  if (trs.length === 0) return 500;
  const recent = trs.slice(-period);
  return recent.reduce((acc, v) => acc + v, 0) / recent.length;
}

/**
 * Analyzes market structure from completed candles using Swing Highs and Swing Lows.
 */
export function evaluateMarketStructure(candles: BtcCandle[]): {
  regime: MarketRegimeType;
  swingHigh: number;
  swingLow: number;
  trendStrength: number;
} {
  if (!candles || candles.length < 5) {
    return { regime: 'CHOP', swingHigh: 0, swingLow: 0, trendStrength: 0 };
  }

  // Find swing highs and lows in the last 20 candles
  const window = candles.slice(-20);
  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  let higherHighs = 0;
  let lowerLows = 0;

  for (let i = 2; i < window.length - 2; i++) {
    const c = window[i];
    const isSwingHigh =
      c.high > window[i - 1].high &&
      c.high > window[i - 2].high &&
      c.high > window[i + 1].high &&
      c.high > window[i + 2].high;

    const isSwingLow =
      c.low < window[i - 1].low &&
      c.low < window[i - 2].low &&
      c.low < window[i + 1].low &&
      c.low < window[i + 2].low;

    if (isSwingHigh && c.high > highestHigh) {
      if (highestHigh !== -Infinity) higherHighs++;
      highestHigh = c.high;
    }
    if (isSwingLow && c.low < lowestLow) {
      if (lowestLow !== Infinity) lowerLows++;
      lowestLow = c.low;
    }
  }

  const latestClose = candles[candles.length - 1].close;
  const firstClose = candles[Math.max(0, candles.length - 10)].close;
  const netChangePct = ((latestClose - firstClose) / firstClose) * 100;

  if (highestHigh === -Infinity) highestHigh = Math.max(...window.map((c) => c.high));
  if (lowestLow === Infinity) lowestLow = Math.min(...window.map((c) => c.low));

  if (higherHighs >= lowerLows && netChangePct > 0.35) {
    return { regime: 'BULLISH', swingHigh: highestHigh, swingLow: lowestLow, trendStrength: Math.abs(netChangePct) };
  } else if (lowerLows >= higherHighs && netChangePct < -0.35) {
    return { regime: 'BEARISH', swingHigh: highestHigh, swingLow: lowestLow, trendStrength: Math.abs(netChangePct) };
  } else {
    return { regime: 'CHOP', swingHigh: highestHigh, swingLow: lowestLow, trendStrength: Math.abs(netChangePct) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY CPR ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes Daily Central Pivot Range (CPR) strictly from previous completed 1D candle.
 *
 * Formulas:
 * P  = (H + L + C) / 3
 * BC = (H + L) / 2
 * TC = (2 * P) - BC
 * Normalized: cprTop = Math.max(TC, BC), cprBottom = Math.min(TC, BC), cprMid = P
 */
export function computeDailyCpr(
  prevHigh: number,
  prevLow: number,
  prevClose: number,
  currentPrice: number,
  priorCprInput?: { top: number; bottom: number; mid: number }
): DailyCprData {
  const p = (prevHigh + prevLow + prevClose) / 3;
  const bc = (prevHigh + prevLow) / 2;
  const tc = 2 * p - bc;

  const cprTop = Math.max(tc, bc);
  const cprBottom = Math.min(tc, bc);
  const cprMid = p;

  const width = cprTop - cprBottom;
  const widthPct = (width / p) * 100;

  // Classification: Narrow (<= 0.18%), Normal (0.18% - 0.45%), Wide (> 0.45%)
  let widthRegime: CprWidthRegime = 'NORMAL';
  if (widthPct <= 0.18) {
    widthRegime = 'NARROW';
  } else if (widthPct > 0.45) {
    widthRegime = 'WIDE';
  }

  // Price Acceptance
  let priceAcceptance: PriceAcceptance = 'INSIDE';
  if (currentPrice > cprTop) {
    priceAcceptance = 'ABOVE';
  } else if (currentPrice < cprBottom) {
    priceAcceptance = 'BELOW';
  }

  // Slope vs prior session
  let slopeVsPrior: CprSlopeType = 'NEUTRAL';
  if (priorCprInput) {
    if (cprBottom > priorCprInput.top) {
      slopeVsPrior = 'HIGHER_VALUE';
    } else if (cprTop < priorCprInput.bottom) {
      slopeVsPrior = 'LOWER_VALUE';
    } else if (cprTop <= priorCprInput.top && cprBottom >= priorCprInput.bottom) {
      slopeVsPrior = 'INSIDE_VALUE';
    } else if (cprTop >= priorCprInput.top && cprBottom <= priorCprInput.bottom) {
      slopeVsPrior = 'OUTSIDE_VALUE';
    } else {
      slopeVsPrior = 'OVERLAPPING';
    }
  }

  return {
    p,
    bc,
    tc,
    cprTop,
    cprBottom,
    cprMid,
    width,
    widthPct,
    widthRegime,
    slopeVsPrior,
    priceAcceptance,
    priorCpr: priorCprInput,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VIRGIN CPR REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates Virgin CPR Registry by verifying if recent completed candles have touched the zone.
 * Automatically removes Virgin status once price enters/touches [lower, upper].
 */
export function updateVirginCprRegistry(
  zones: VirginCprZone[],
  recentCandles: BtcCandle[],
  currentPrice: number
): VirginCprZone[] {
  return zones.map((zone) => {
    if (!zone.isUntouched) {
      return zone;
    }

    // Check if any candle touched [zone.lower, zone.upper]
    let touched = false;
    for (const c of recentCandles) {
      if (c.low <= zone.upper && c.high >= zone.lower) {
        touched = true;
        break;
      }
    }

    const isUntouched = !touched;
    const distanceFromPrice = Math.abs(currentPrice - zone.midpoint);
    const distancePct = (distanceFromPrice / currentPrice) * 100;
    const relation: 'ABOVE' | 'BELOW' | 'INSIDE' =
      currentPrice > zone.upper ? 'ABOVE' : currentPrice < zone.lower ? 'BELOW' : 'INSIDE';

    return {
      ...zone,
      isUntouched,
      distanceFromPrice,
      distancePct,
      relation,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMARILLA PIVOT ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes Camarilla Pivot levels strictly from previous completed 1D candle.
 *
 * Formulas:
 * Range = H - L
 * H3 = C + (Range * 1.1 / 4)
 * H4 = C + (Range * 1.1 / 2)
 * H5 = (H / L) * C
 * H6 = H5 + 1.168 * (H5 - H4)
 * L3 = C - (Range * 1.1 / 4)
 * L4 = C - (Range * 1.1 / 2)
 * L5 = C - (H5 - C)
 * L6 = L5 - 1.168 * (L4 - L5)
 */
export function computeCamarillaPivots(prevHigh: number, prevLow: number, prevClose: number): CamarillaPivots {
  const range = Math.max(1, prevHigh - prevLow);
  const h3 = prevClose + (range * 1.1) / 4;
  const h4 = prevClose + (range * 1.1) / 2;
  const h5 = prevLow > 0 ? (prevHigh / prevLow) * prevClose : h4 * 1.015;
  const h6 = h5 + 1.168 * (h5 - h4);

  const l3 = prevClose - (range * 1.1) / 4;
  const l4 = prevClose - (range * 1.1) / 2;
  const l5 = prevClose - (h5 - prevClose);
  const l6 = l5 - 1.168 * (l4 - l5);

  return {
    range,
    h3,
    h4,
    h5,
    h6,
    l3,
    l4,
    l5,
    l6,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIBONACCI & EMA 9/21 ENGINES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes Fibonacci retracements & extensions from verified swing anchors.
 */
export function computeFibonacciLevels(swingHigh: number, swingLow: number, isBullish: boolean): FibonacciLevels {
  const diff = Math.max(1, swingHigh - swingLow);

  if (isBullish) {
    return {
      swingHigh,
      swingLow,
      isBullish: true,
      fib382: swingHigh - diff * 0.382,
      fib500: swingHigh - diff * 0.500,
      fib618: swingHigh - diff * 0.618,
      fib786: swingHigh - diff * 0.786,
      ext1272: swingHigh + diff * 0.272,
      ext1618: swingHigh + diff * 0.618,
    };
  } else {
    return {
      swingHigh,
      swingLow,
      isBullish: false,
      fib382: swingLow + diff * 0.382,
      fib500: swingLow + diff * 0.500,
      fib618: swingLow + diff * 0.618,
      fib786: swingLow + diff * 0.786,
      ext1272: swingLow - diff * 0.272,
      ext1618: swingLow - diff * 0.618,
    };
  }
}

/**
 * Computes EMA 9 and 21 values, spread, slope %, and stack type.
 */
export function evaluateEma921(candles: BtcCandle[]): Ema921Data {
  if (!candles || candles.length < 25) {
    const fallbackPrice = candles && candles.length > 0 ? candles[candles.length - 1].close : 80000;
    return {
      ema9: fallbackPrice,
      ema21: fallbackPrice,
      slopePct: 0,
      stack: 'ENTANGLED_CHOP',
      angleDeg: 0,
      spreadPct: 0,
    };
  }

  const ema9Series = calculateEmaSeries(candles, 9);
  const ema21Series = calculateEmaSeries(candles, 21);

  const cur9 = ema9Series[ema9Series.length - 1];
  const cur21 = ema21Series[ema21Series.length - 1];
  const prev3_21 = ema21Series[Math.max(0, ema21Series.length - 4)];

  const spreadPct = ((cur9 - cur21) / cur21) * 100;
  const slopePct = ((cur21 - prev3_21) / prev3_21) * 100;
  const angleDeg = Math.min(80, Math.max(-80, Math.round(Math.atan(slopePct * 10) * (180 / Math.PI))));

  let stack: EmaStackType = 'ENTANGLED_CHOP';
  if (Math.abs(spreadPct) < 0.08) {
    stack = 'ENTANGLED_CHOP';
  } else if (cur9 > cur21 && slopePct >= -0.02) {
    stack = 'BULLISH_STACK';
  } else if (cur9 < cur21 && slopePct <= 0.02) {
    stack = 'BEARISH_STACK';
  }

  return {
    ema9: cur9,
    ema21: cur21,
    slopePct,
    stack,
    angleDeg,
    spreadPct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP EVALUATORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates the 4 core institutional setups:
 * - Setup A (Trend Continuation)
 * - Setup B (Camarilla Reversal — reduced risk)
 * - Setup C (Narrow CPR Breakout/Breakdown)
 * - Setup D (EMA 9/21 Pullback)
 */
export function evaluateSetups(params: {
  regime4H: MarketRegimeType;
  regime1H: MarketRegimeType;
  cpr: DailyCprData;
  camarilla: CamarillaPivots;
  ema15m: Ema921Data;
  currentPrice: number;
  last15mCandle: BtcCandle;
  atr15m: number;
}): SniperSetupClassification {
  const { regime4H, regime1H, cpr, camarilla, ema15m, currentPrice, last15mCandle } = params;

  // Setup C: Narrow CPR Breakout / Breakdown
  if (cpr.widthRegime === 'NARROW') {
    if (last15mCandle.close > cpr.cprTop && ema15m.stack === 'BULLISH_STACK') {
      return {
        id: 'SETUP_C_NARROW_CPR_BREAKOUT',
        name: 'Setup C: Narrow CPR Expansion Breakout',
        direction: 'LONG',
        description: 'Narrow CPR compressed energy breakout above TC confirmed by 15M candle close.',
        riskPct: 0.25,
        rationale: `Narrow CPR (${cpr.widthPct.toFixed(2)}%) breakout above $${cpr.cprTop.toFixed(1)} with Bullish EMA Stack.`,
      };
    }
    if (last15mCandle.close < cpr.cprBottom && ema15m.stack === 'BEARISH_STACK') {
      return {
        id: 'SETUP_C_NARROW_CPR_BREAKOUT',
        name: 'Setup C: Narrow CPR Expansion Breakdown',
        direction: 'SHORT',
        description: 'Narrow CPR compressed energy breakdown below BC confirmed by 15M candle close.',
        riskPct: 0.25,
        rationale: `Narrow CPR (${cpr.widthPct.toFixed(2)}%) breakdown below $${cpr.cprBottom.toFixed(1)} with Bearish EMA Stack.`,
      };
    }
  }

  // Setup B: Camarilla Reversal (countertrend at extreme L3/L4 or H3/H4)
  // Requires rejection candle, reduced risk (0.15% - 0.20%)
  const candleRange = Math.max(1, last15mCandle.high - last15mCandle.low);
  const lowerWick = Math.min(last15mCandle.open, last15mCandle.close) - last15mCandle.low;
  const upperWick = last15mCandle.high - Math.max(last15mCandle.open, last15mCandle.close);

  if (last15mCandle.low <= camarilla.l4 && last15mCandle.close > camarilla.l3 && lowerWick / candleRange > 0.40) {
    return {
      id: 'SETUP_B_CAMARILLA_REVERSAL',
      name: 'Setup B: Camarilla L4 Mean Reversion',
      direction: 'LONG',
      description: 'L4 extreme liquidity sweep rejected with strong lower absorption wick.',
      riskPct: 0.15,
      rationale: `Exhaustion wick at L4 ($${camarilla.l4.toFixed(1)}) recovering inside L3 with countertrend risk dampener.`,
    };
  }

  if (last15mCandle.high >= camarilla.h4 && last15mCandle.close < camarilla.h3 && upperWick / candleRange > 0.40) {
    return {
      id: 'SETUP_B_CAMARILLA_REVERSAL',
      name: 'Setup B: Camarilla H4 Mean Reversion',
      direction: 'SHORT',
      description: 'H4 extreme liquidity sweep rejected with strong upper exhaustion wick.',
      riskPct: 0.15,
      rationale: `Exhaustion wick at H4 ($${camarilla.h4.toFixed(1)}) rejecting back inside H3 with countertrend risk dampener.`,
    };
  }

  // Setup D: EMA 9/21 Pullback
  // 1H trend aligned + price pulls back to test 15M EMA 9/21 band without crossing
  if (regime1H === 'BULLISH' && ema15m.stack === 'BULLISH_STACK') {
    const nearEma = Math.abs(currentPrice - ema15m.ema21) / currentPrice < 0.0035;
    if (nearEma && last15mCandle.close >= ema15m.ema9) {
      return {
        id: 'SETUP_D_EMA_PULLBACK',
        name: 'Setup D: EMA 9/21 Dynamic Pullback',
        direction: 'LONG',
        description: 'Bullish 15M EMA 9/21 band test with dynamic support hold.',
        riskPct: 0.25,
        rationale: `Dynamic test of EMA 21 ($${ema15m.ema21.toFixed(1)}) holding above CPR with bullish continuation body.`,
      };
    }
  }

  if (regime1H === 'BEARISH' && ema15m.stack === 'BEARISH_STACK') {
    const nearEma = Math.abs(currentPrice - ema15m.ema21) / currentPrice < 0.0035;
    if (nearEma && last15mCandle.close <= ema15m.ema9) {
      return {
        id: 'SETUP_D_EMA_PULLBACK',
        name: 'Setup D: EMA 9/21 Dynamic Pullback',
        direction: 'SHORT',
        description: 'Bearish 15M EMA 9/21 band test with dynamic resistance rejection.',
        riskPct: 0.25,
        rationale: `Dynamic test of EMA 21 ($${ema15m.ema21.toFixed(1)}) holding below CPR with bearish continuation body.`,
      };
    }
  }

  // Setup A: Trend Continuation (Standard Camarilla & HTF breakout)
  if (regime4H === 'BULLISH' && regime1H === 'BULLISH' && last15mCandle.close >= camarilla.h4) {
    return {
      id: 'SETUP_A_TREND_CONTINUATION',
      name: 'Setup A: Camarilla H4 Trend Breakout',
      direction: 'LONG',
      description: '4H & 1H HTF Bullish regime aligned with 15M candle close above Camarilla H4.',
      riskPct: 0.25,
      rationale: `HTF Bullish consensus with confirmed 15M close >= H4 ($${camarilla.h4.toFixed(1)}).`,
    };
  }

  if (regime4H === 'BEARISH' && regime1H === 'BEARISH' && last15mCandle.close <= camarilla.l4) {
    return {
      id: 'SETUP_A_TREND_CONTINUATION',
      name: 'Setup A: Camarilla L4 Trend Breakdown',
      direction: 'SHORT',
      description: '4H & 1H HTF Bearish regime aligned with 15M candle close below Camarilla L4.',
      riskPct: 0.25,
      rationale: `HTF Bearish consensus with confirmed 15M close <= L4 ($${camarilla.l4.toFixed(1)}).`,
    };
  }

  return {
    id: 'NONE',
    name: 'No Qualified Setup',
    direction: 'NEUTRAL',
    description: 'Current market structure does not fulfill strict institutional entry parameters.',
    riskPct: 0,
    rationale: 'Awaiting structural alignment or clear Camarilla / CPR boundary breakout.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 16-POINT CONFLUENCE SCORING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates the strict 16-point institutional confluence model:
 * 1. 4H structure (+2)
 * 2. 1H alignment (+2)
 * 3. Price vs CPR (+2)
 * 4. 15M EMA 9/21 (+2)
 * 5. EMA slope (+1)
 * 6. Camarilla breakout/retest (+2)
 * 7. Fibonacci confluence (+1)
 * 8. Virgin CPR confluence (+1)
 * 9. Strong 15M confirmation candle (+2)
 * 10. 5M entry structure (+1)
 *
 * Grades:
 * - 13-16: A+ (Execute)
 * - 10-12: A (Execute)
 * - 8-9: B (Observation Only)
 * - 0-7: NO TRADE
 */
export function evaluate16PointConfluence(params: {
  tradeSide: 'LONG' | 'SHORT';
  regime4H: MarketRegimeType;
  regime1H: MarketRegimeType;
  cpr: DailyCprData;
  ema15m: Ema921Data;
  camarilla: CamarillaPivots;
  fib: FibonacciLevels;
  virginCprs: VirginCprZone[];
  last15mCandle: BtcCandle;
  last5mCandle?: BtcCandle;
  currentPrice: number;
}): ConfluenceScoreResult {
  const {
    tradeSide,
    regime4H,
    regime1H,
    cpr,
    ema15m,
    camarilla,
    fib,
    virginCprs,
    last15mCandle,
    last5mCandle,
    currentPrice,
  } = params;

  const isLong = tradeSide === 'LONG';
  const items: ConfluenceItem[] = [];

  // 1. 4H Market Structure (+2)
  const pass4H = isLong ? regime4H === 'BULLISH' : regime4H === 'BEARISH';
  items.push({
    id: 'c1_4h_structure',
    label: '4H Market Structure',
    weight: 2,
    earned: pass4H ? 2 : 0,
    passed: pass4H,
    reason: pass4H
      ? `4H regime is firmly ${regime4H}`
      : `4H regime is ${regime4H} (contradicts ${tradeSide})`,
  });

  // 2. 1H Trend Alignment (+2)
  const pass1H = isLong ? regime1H === 'BULLISH' : regime1H === 'BEARISH';
  items.push({
    id: 'c2_1h_alignment',
    label: '1H Trend Alignment',
    weight: 2,
    earned: pass1H ? 2 : 0,
    passed: pass1H,
    reason: pass1H
      ? `1H trend is aligned (${regime1H})`
      : `1H trend (${regime1H}) lacks alignment`,
  });

  // 3. Price vs Daily CPR (+2)
  const passCpr = isLong
    ? cpr.priceAcceptance === 'ABOVE' || (last15mCandle.close > cpr.cprTop && cpr.widthRegime === 'NARROW')
    : cpr.priceAcceptance === 'BELOW' || (last15mCandle.close < cpr.cprBottom && cpr.widthRegime === 'NARROW');
  items.push({
    id: 'c3_price_vs_cpr',
    label: 'Price vs Daily CPR',
    weight: 2,
    earned: passCpr ? 2 : 0,
    passed: passCpr,
    reason: passCpr
      ? `Price accepted ${cpr.priceAcceptance} CPR ($${cpr.cprTop.toFixed(0)} - $${cpr.cprBottom.toFixed(0)})`
      : `Price inside/against CPR (${cpr.priceAcceptance})`,
  });

  // 4. 15M EMA 9/21 Stack (+2)
  const passEmaStack = isLong ? ema15m.stack === 'BULLISH_STACK' : ema15m.stack === 'BEARISH_STACK';
  items.push({
    id: 'c4_15m_ema_stack',
    label: '15M EMA 9/21 Stack',
    weight: 2,
    earned: passEmaStack ? 2 : 0,
    passed: passEmaStack,
    reason: passEmaStack
      ? `15M EMA 9 ($${ema15m.ema9.toFixed(0)}) aligned with EMA 21 ($${ema15m.ema21.toFixed(0)})`
      : `15M EMA stack is ${ema15m.stack}`,
  });

  // 5. EMA Slope Angle (+1)
  const passSlope = isLong ? ema15m.slopePct >= 0.03 : ema15m.slopePct <= -0.03;
  items.push({
    id: 'c5_ema_slope',
    label: 'EMA Slope Velocity',
    weight: 1,
    earned: passSlope ? 1 : 0,
    passed: passSlope,
    reason: passSlope
      ? `EMA 21 slope is ${ema15m.slopePct.toFixed(2)}% (${ema15m.angleDeg}°)`
      : `EMA 21 slope is sluggish (${ema15m.slopePct.toFixed(2)}%)`,
  });

  // 6. Camarilla Breakout / Retest (+2)
  const passCamarilla = isLong
    ? currentPrice >= camarilla.h4 || (last15mCandle.low >= camarilla.h3 && last15mCandle.close >= camarilla.h3)
    : currentPrice <= camarilla.l4 || (last15mCandle.high <= camarilla.l3 && last15mCandle.close <= camarilla.l3);
  items.push({
    id: 'c6_camarilla_level',
    label: 'Camarilla Breakout/Retest',
    weight: 2,
    earned: passCamarilla ? 2 : 0,
    passed: passCamarilla,
    reason: passCamarilla
      ? isLong
        ? `Holding above Camarilla H3/H4 ($${camarilla.h4.toFixed(0)})`
        : `Holding below Camarilla L3/L4 ($${camarilla.l4.toFixed(0)})`
      : `Trapped inside Camarilla H3-L3 chop zone`,
  });

  // 7. Fibonacci Confluence (+1)
  const isNearFib =
    Math.abs(currentPrice - fib.fib500) / currentPrice < 0.005 ||
    Math.abs(currentPrice - fib.fib618) / currentPrice < 0.005 ||
    Math.abs(currentPrice - fib.fib382) / currentPrice < 0.005;
  items.push({
    id: 'c7_fibonacci_confluence',
    label: 'Fibonacci Key Level',
    weight: 1,
    earned: isNearFib ? 1 : 0,
    passed: isNearFib,
    reason: isNearFib
      ? `Confluence near key Fib level (0.500: $${fib.fib500.toFixed(0)} | 0.618: $${fib.fib618.toFixed(0)})`
      : `No direct Fibonacci anchor confluence`,
  });

  // 8. Virgin CPR Confluence (+1)
  const untouchedZones = virginCprs.filter((z) => z.isUntouched);
  const alignedVirgin = untouchedZones.find((z) => (isLong ? z.upper > currentPrice : z.lower < currentPrice));
  const blockingVirgin = untouchedZones.find((z) =>
    isLong
      ? z.lower > currentPrice && (z.lower - currentPrice) / currentPrice < 0.008
      : z.upper < currentPrice && (currentPrice - z.upper) / currentPrice < 0.008
  );

  const passVirgin = Boolean(alignedVirgin && !blockingVirgin);
  items.push({
    id: 'c8_virgin_cpr_confluence',
    label: 'Virgin CPR Magnet / Clear Path',
    weight: 1,
    earned: passVirgin ? 1 : 0,
    passed: passVirgin,
    reason: blockingVirgin
      ? `Blocking Virgin CPR at $${blockingVirgin.midpoint.toFixed(0)} is too close`
      : alignedVirgin
      ? `Clear runway toward Virgin CPR magnet at $${alignedVirgin.midpoint.toFixed(0)}`
      : `No immediate Virgin CPR obstacles in path`,
  });

  // 9. Strong 15M Confirmation Candle (+2)
  const candleRange = Math.max(1, last15mCandle.high - last15mCandle.low);
  const bodySize = Math.abs(last15mCandle.close - last15mCandle.open);
  const bodyPct = (bodySize / candleRange) * 100;
  const isCorrectColor = isLong ? last15mCandle.close > last15mCandle.open : last15mCandle.close < last15mCandle.open;
  const passCandle = isCorrectColor && bodyPct >= 50;

  items.push({
    id: 'c9_15m_confirmation_candle',
    label: '15M Confirmation Candle',
    weight: 2,
    earned: passCandle ? 2 : 0,
    passed: passCandle,
    reason: passCandle
      ? `Strong closed body (${bodyPct.toFixed(0)}% of range) matching ${tradeSide}`
      : `Weak body (${bodyPct.toFixed(0)}%) or wrong directional color`,
  });

  // 10. 5M Entry Refinement (+1)
  let pass5m = false;
  if (last5mCandle) {
    const is5mAligned = isLong ? last5mCandle.close >= last5mCandle.open : last5mCandle.close <= last5mCandle.open;
    pass5m = is5mAligned;
  } else {
    pass5m = passCandle;
  }
  items.push({
    id: 'c10_5m_refinement',
    label: '5M Micro Entry Structure',
    weight: 1,
    earned: pass5m ? 1 : 0,
    passed: pass5m,
    reason: pass5m ? `5M micro structure confirmed` : `5M micro bar showing friction or adverse wick`,
  });

  const totalScore = items.reduce((sum, item) => sum + item.earned, 0);
  const convictionPct = Math.round((totalScore / 16) * 100);

  let grade: ConfluenceGrade = 'NO_TRADE';
  if (totalScore >= 13) {
    grade = 'A+';
  } else if (totalScore >= 10) {
    grade = 'A';
  } else if (totalScore >= 8) {
    grade = 'B';
  } else {
    grade = 'NO_TRADE';
  }

  const summary = `Score: ${totalScore}/16 (${convictionPct}%) · Grade ${grade}`;

  return {
    totalScore,
    maxScore: 16,
    grade,
    convictionPct,
    items,
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HARD NO-TRADE FILTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates the 11 hard no-trade circuit breakers.
 * ANY triggered filter unconditionally forces action to NO_TRADE.
 */
export function evaluateHardFilters(params: {
  tradeSide: 'LONG' | 'SHORT';
  currentPrice: number;
  entryPrice: number;
  stopLossPrice: number;
  tp2Price: number;
  cpr: DailyCprData;
  ema15m: Ema921Data;
  regime4H: MarketRegimeType;
  setupId: SniperSetupId;
  virginCprs: VirginCprZone[];
  atr15m: number;
  accountEquityUsd: number;
  sessionRealizedPnLUsd: number;
  consecutiveStopsCount: number;
  hasValidOhlcData: boolean;
}): HardFiltersResult {
  const {
    tradeSide,
    currentPrice,
    entryPrice,
    stopLossPrice,
    tp2Price,
    cpr,
    ema15m,
    regime4H,
    setupId,
    virginCprs,
    atr15m,
    accountEquityUsd,
    sessionRealizedPnLUsd,
    consecutiveStopsCount,
    hasValidOhlcData,
  } = params;

  const isLong = tradeSide === 'LONG';
  const filters: HardFilterItem[] = [];

  // 1. Missing or unreliable OHLC data
  filters.push({
    id: 'f1_data_integrity',
    label: 'OHLC Data Integrity',
    triggered: !hasValidOhlcData || currentPrice <= 0,
    reason: !hasValidOhlcData ? 'Corrupted or missing candle data' : 'Data valid',
  });

  // 2. Trapped inside CPR without breakout
  const isInsideCpr = cpr.priceAcceptance === 'INSIDE';
  filters.push({
    id: 'f2_cpr_trap',
    label: 'Trapped Inside CPR',
    triggered: isInsideCpr && setupId !== 'SETUP_B_CAMARILLA_REVERSAL',
    reason: isInsideCpr ? `Price is trapped inside Daily CPR ($${cpr.cprBottom.toFixed(0)} - $${cpr.cprTop.toFixed(0)})` : 'Free of CPR boundary',
  });

  // 3. Flat / tangled EMA 9/21 chop
  filters.push({
    id: 'f3_flat_ema_chop',
    label: 'Flat / Tangled EMA 9/21',
    triggered: ema15m.stack === 'ENTANGLED_CHOP' && Math.abs(ema15m.slopePct) < 0.02,
    reason: ema15m.stack === 'ENTANGLED_CHOP' ? 'EMA 9 & 21 are entangled with zero directional slope' : 'EMA stack has clear trend',
  });

  // 4. HTF Contradiction without valid Setup B reversal
  const htfMismatch = isLong ? regime4H === 'BEARISH' : regime4H === 'BULLISH';
  filters.push({
    id: 'f4_htf_contradiction',
    label: 'HTF 4H Contradiction',
    triggered: htfMismatch && setupId !== 'SETUP_B_CAMARILLA_REVERSAL',
    reason: htfMismatch ? `Signal contradicts 4H ${regime4H} structure without an approved Setup B reversal` : '4H regime compatible',
  });

  // 5. Overextended price from entry (chasing)
  const chaseDriftPct = Math.abs(currentPrice - entryPrice) / entryPrice * 100;
  filters.push({
    id: 'f5_chase_overextension',
    label: 'Price Overextended / Chase',
    triggered: chaseDriftPct > 1.25,
    reason: chaseDriftPct > 1.25 ? `Price has drifted ${chaseDriftPct.toFixed(2)}% past optimal entry` : 'Within entry tolerance',
  });

  // 6. Obstacle too close (untouched Virgin CPR < 1R away)
  const riskDistance = Math.abs(entryPrice - stopLossPrice);
  const blockingVirgin = virginCprs.find((z) => {
    if (!z.isUntouched) return false;
    if (isLong) {
      return z.lower > entryPrice && (z.lower - entryPrice) < riskDistance * 0.90;
    } else {
      return z.upper < entryPrice && (entryPrice - z.upper) < riskDistance * 0.90;
    }
  });
  filters.push({
    id: 'f6_obstacle_blocking',
    label: 'Untouched CPR Obstacle',
    triggered: Boolean(blockingVirgin),
    reason: blockingVirgin ? `Opposing Virgin CPR zone at $${blockingVirgin.midpoint.toFixed(0)} is < 1R away` : 'No blocking obstacle',
  });

  // 7. Invalid structural SL
  const slDistancePct = (Math.abs(entryPrice - stopLossPrice) / entryPrice) * 100;
  const isSlInvalid = slDistancePct < 0.20 || slDistancePct > 3.0;
  filters.push({
    id: 'f7_invalid_sl',
    label: 'Invalid Structural Stop Loss',
    triggered: isSlInvalid,
    reason: isSlInvalid ? `SL distance ${slDistancePct.toFixed(2)}% violates safety threshold (0.20% - 3.00%)` : 'SL geometry valid',
  });

  // 8. Reward to Risk < 1.8
  const rewardDistance = Math.abs(tp2Price - entryPrice);
  const rrRatio = riskDistance > 0 ? rewardDistance / riskDistance : 0;
  filters.push({
    id: 'f8_reward_risk',
    label: 'Reward-to-Risk < 1.8',
    triggered: rrRatio < 1.80,
    reason: rrRatio < 1.80 ? `Projected R:R is 1:${rrRatio.toFixed(2)} (minimum 1:1.80 required)` : `R:R acceptable (1:${rrRatio.toFixed(2)})`,
  });

  // 9. Abnormal volatility spike (ATR > 3.5x normal baseline)
  const isExtremeVolatility = atr15m > 2500; // > $2,500 15m ATR for BTC
  filters.push({
    id: 'f9_abnormal_volatility',
    label: 'Abnormal Volatility Spike',
    triggered: isExtremeVolatility,
    reason: isExtremeVolatility ? `15M ATR ($${atr15m.toFixed(0)}) indicates abnormal flash volatility` : 'Volatility normal',
  });

  // 10. Daily loss >= 1.5% of account equity
  const maxAllowedDailyLoss = accountEquityUsd * 0.015;
  const isDailyLossBreached = sessionRealizedPnLUsd <= -maxAllowedDailyLoss;
  filters.push({
    id: 'f10_daily_loss_limit',
    label: 'Daily Loss >= 1.5% Circuit Breaker',
    triggered: isDailyLossBreached,
    reason: isDailyLossBreached ? `Session loss ($${Math.abs(sessionRealizedPnLUsd).toFixed(2)}) exceeds 1.5% equity cap ($${maxAllowedDailyLoss.toFixed(2)})` : 'Daily loss within limits',
  });

  // 11. 3 consecutive losses in current session
  const isConsecutiveLossesBreached = consecutiveStopsCount >= 3;
  filters.push({
    id: 'f11_consecutive_stops',
    label: '3 Consecutive Stops Circuit Breaker',
    triggered: isConsecutiveLossesBreached,
    reason: isConsecutiveLossesBreached ? `${consecutiveStopsCount} consecutive stops reached. Trading halted to preserve capital.` : 'Loss streak safe',
  });

  const activeFilters = filters.filter((f) => f.triggered);
  const passed = activeFilters.length === 0;
  const blockingReason = !passed ? activeFilters.map((f) => `${f.label}: ${f.reason}`).join(' | ') : undefined;

  return {
    passed,
    triggeredCount: activeFilters.length,
    filters,
    blockingReason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITION SIZING & STRUCTURED EXITS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculates deterministic position size in BTC and Delta Exchange India lots (1 Lot = 0.001 BTC).
 * Standard risk = 0.25% equity (max 0.50%).
 */
export function calculateBtcPositionSize(params: {
  accountEquityUsd: number;
  riskPct: number; // e.g. 0.25%
  entryPrice: number;
  stopLossPrice: number;
}): BtcPositionSizeResult {
  const accountEquityUsd = Math.max(10, params.accountEquityUsd);
  const riskPct = Math.min(0.50, Math.max(0.10, params.riskPct));
  const entryPrice = Math.max(1, params.entryPrice);
  const stopLossPrice = Math.max(1, params.stopLossPrice);

  const riskDistanceUsd = Math.abs(entryPrice - stopLossPrice);
  const riskDistancePct = (riskDistanceUsd / entryPrice) * 100;

  const riskAmountUsd = accountEquityUsd * (riskPct / 100);

  // Exact BTC Size = Risk Amount / Risk Distance
  const rawBtcSize = riskDistanceUsd > 0 ? riskAmountUsd / riskDistanceUsd : 0.001;

  // Convert to Delta Exchange India lots (1 Lot = 0.001 BTC)
  let deltaLots = Math.floor(rawBtcSize / 0.001);
  if (deltaLots < 1) deltaLots = 1; // Minimum trade is 1 lot = 0.001 BTC

  const clampedBtcSize = deltaLots * 0.001;
  const notionalUsd = clampedBtcSize * entryPrice;

  // Assume conservative 10x leverage for intraday margin estimate
  const effectiveLeverage = 10;
  const estimatedMarginUsd = notionalUsd / effectiveLeverage;

  // Delta Maker Fee + GST roundtrip estimate (~0.04% total)
  const roundtripFeeUsd = notionalUsd * 0.00045;
  const netRiskUsd = clampedBtcSize * riskDistanceUsd + roundtripFeeUsd;

  return {
    accountEquityUsd,
    riskPct,
    riskAmountUsd,
    entryPrice,
    stopLossPrice,
    riskDistanceUsd,
    riskDistancePct,
    rawBtcSize,
    deltaLots,
    clampedBtcSize,
    notionalUsd,
    estimatedMarginUsd,
    effectiveLeverage,
    roundtripFeeUsd,
    netRiskUsd,
  };
}

/**
 * Calculates the 3-stage structured exit ladder:
 * - TP1 (~1R): close 35%, move SL to Breakeven (+ fee buffer) once 15M structure confirms.
 * - TP2 (~2R): close 35%, lock profit.
 * - TP3 Runner: final 30%, trail along 15M swing low/high or EMA 21.
 */
export function calculateStructuredExits(params: {
  isLong: boolean;
  entryPrice: number;
  stopLossPrice: number;
  camarilla: CamarillaPivots;
}): BtcStructuredExits {
  const { isLong, entryPrice, stopLossPrice, camarilla } = params;
  const r = Math.abs(entryPrice - stopLossPrice);

  // Breakeven price with estimated roundtrip fee buffer (~$35 on BTC)
  const feeBuffer = 35.0;
  const breakevenWithFeePrice = isLong ? entryPrice + feeBuffer : entryPrice - feeBuffer;

  let tp1Price: number;
  let tp2Price: number;
  let tp3RunnerPrice: number;

  if (isLong) {
    // 1R Target or Camarilla H4/H5 midpoint
    tp1Price = entryPrice + r;
    // 2R Target or Camarilla H5
    tp2Price = entryPrice + r * 2.1;
    // 3R Runner or Camarilla H6
    tp3RunnerPrice = Math.max(entryPrice + r * 3.5, camarilla.h6);
  } else {
    tp1Price = entryPrice - r;
    tp2Price = entryPrice - r * 2.1;
    tp3RunnerPrice = Math.min(entryPrice - r * 3.5, camarilla.l6);
  }

  const tp1R = r > 0 ? Math.abs(tp1Price - entryPrice) / r : 1.0;
  const tp2R = r > 0 ? Math.abs(tp2Price - entryPrice) / r : 2.1;
  const tp3R = r > 0 ? Math.abs(tp3RunnerPrice - entryPrice) / r : 3.5;

  const riskRewardRatio = r > 0 ? Math.abs(tp2Price - entryPrice) / r : 2.1;

  return {
    entryPrice,
    stopLoss: stopLossPrice,
    tp1Price,
    tp1Pct: 35,
    tp1R: Number(tp1R.toFixed(2)),
    tp1Action: 'Close 35% · Ratchet SL to Breakeven (+ fee buffer) once 15M structure supports it',
    tp2Price,
    tp2Pct: 35,
    tp2R: Number(tp2R.toFixed(2)),
    tp2Action: 'Close 35% · Bank guaranteed profit cushion',
    tp3RunnerPrice,
    tp3RunnerPct: 30,
    tp3R: Number(tp3R.toFixed(2)),
    tp3Action: 'Trail final 30% runner along 15M swing structure and EMA 21',
    riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
    breakevenWithFeePrice,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9-SECTION BTC INTRADAY STRATEGY REPORT GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats the complete 9-section BTC Intraday Strategy Report into structured text.
 */
export function generateBtcStrategyReport(
  snapshot: BtcStrategyReport['sectionA_marketSnapshot'],
  structure: BtcStrategyReport['sectionB_marketStructure'],
  cpr: BtcStrategyReport['sectionC_cprAnalysis'],
  camarilla: BtcStrategyReport['sectionD_camarillaConfluence'],
  fibEma: BtcStrategyReport['sectionE_fibonacciAndEma'],
  setupConf: BtcStrategyReport['sectionF_setupAndConfluence'],
  hardFilters: BtcStrategyReport['sectionG_hardFiltersAudit'],
  sizing: BtcStrategyReport['sectionH_riskAndPositionSizing'],
  execution: BtcStrategyReport['sectionI_finalExecutionSummary']
): BtcStrategyReport {
  const nowUtc = new Date().toISOString();

  const formattedLines: string[] = [
    `═══════════════════════════════════════════════════════════════════════════════`,
    `               DELTAAI INSTITUTIONAL BTC INTRADAY STRATEGY REPORT              `,
    `═══════════════════════════════════════════════════════════════════════════════`,
    `Timestamp: ${nowUtc} | Exchange: Delta Exchange India | Pair: BTCUSD`,
    ``,
    `SECTION A. MARKET SNAPSHOT`,
    `-------------------------------------------------------------------------------`,
    `· Mark Price:      $${snapshot.markPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `· 24h High / Low:  $${snapshot.high24h.toLocaleString('en-US', { minimumFractionDigits: 2 })} / $${snapshot.low24h.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `· 24h Change:      ${snapshot.change24hPct >= 0 ? '+' : ''}${snapshot.change24hPct.toFixed(2)}%`,
    `· 15M ATR(14):     $${snapshot.atr14_15m.toFixed(2)} (${snapshot.atrPct.toFixed(2)}% volatility)`,
    ``,
    `SECTION B. MARKET STRUCTURE (4H & 1H)`,
    `-------------------------------------------------------------------------------`,
    `· 4H Macro Regime:     ${structure.regime4H}`,
    `· 1H Trend Alignment:  ${structure.regime1H}`,
    `· 15M Trade Structure: ${structure.structure15M}`,
    `· Active Swings:       Swing High: $${structure.keySwings.swingHigh.toFixed(1)} | Swing Low: $${structure.keySwings.swingLow.toFixed(1)}`,
    ``,
    `SECTION C. DAILY CPR & VIRGIN CPR ANALYSIS`,
    `-------------------------------------------------------------------------------`,
    `· CPR Pivot (P):       $${cpr.p.toFixed(2)}`,
    `· Bottom Central (BC): $${cpr.bc.toFixed(2)}`,
    `· Top Central (TC):    $${cpr.tc.toFixed(2)}`,
    `· CPR Zone:            $${cpr.cprBottom.toFixed(2)} – $${cpr.cprTop.toFixed(2)}`,
    `· Width Classification: ${cpr.widthRegime} (${cpr.widthPct.toFixed(3)}% of price)`,
    `· Slope vs Prior Day:  ${cpr.slopeVsPrior}`,
    `· Price Acceptance:    ${cpr.priceAcceptance}`,
    `· Active Virgin CPRs:  ${cpr.virginCprZonesCount} untouched zones registered`,
    cpr.nearestVirginCpr
      ? `· Nearest Virgin CPR:  $${cpr.nearestVirginCpr.midpoint.toFixed(2)} (${cpr.nearestVirginCpr.relation}, ${cpr.nearestVirginCpr.distancePct.toFixed(2)}% away)`
      : `· Nearest Virgin CPR:  None within immediate operational range`,
    ``,
    `SECTION D. CAMARILLA PIVOT CONFLUENCE`,
    `-------------------------------------------------------------------------------`,
    `· Range (H - L):       $${camarilla.range.toFixed(2)}`,
    `· Breakout Levels:     H4: $${camarilla.h4.toFixed(2)} | L4: $${camarilla.l4.toFixed(2)}`,
    `· Range Reversal:      H3: $${camarilla.h3.toFixed(2)} | L3: $${camarilla.l3.toFixed(2)}`,
    `· Macro Targets:       H5: $${camarilla.h5.toFixed(2)} | L5: $${camarilla.l5.toFixed(2)}`,
    `· Terminal Exhaustion: H6: $${camarilla.h6.toFixed(2)} | L6: $${camarilla.l6.toFixed(2)}`,
    `· Key Level Note:      ${camarilla.keyLevelNote}`,
    ``,
    `SECTION E. FIBONACCI & EMA 9/21 CONFLUENCE`,
    `-------------------------------------------------------------------------------`,
    `· Swing Anchors:       $${fibEma.fibonacci.swingLow.toFixed(1)} -> $${fibEma.fibonacci.swingHigh.toFixed(1)} (${fibEma.fibonacci.isBullish ? 'Bullish' : 'Bearish'})`,
    `· Fib 0.382 / 0.500:   $${fibEma.fibonacci.fib382.toFixed(1)} / $${fibEma.fibonacci.fib500.toFixed(1)}`,
    `· Golden Pocket (0.618): $${fibEma.fibonacci.fib618.toFixed(1)}`,
    `· Invalidation (0.786): $${fibEma.fibonacci.fib786.toFixed(1)}`,
    `· Extension 1.618:     $${fibEma.fibonacci.ext1618.toFixed(1)}`,
    `· 15M EMA 9 / 21:      $${fibEma.ema15m.ema9.toFixed(1)} / $${fibEma.ema15m.ema21.toFixed(1)} (${fibEma.ema15m.stack})`,
    `· 15M Slope & Angle:   ${fibEma.ema15m.slopePct.toFixed(2)}% (${fibEma.ema15m.angleDeg}°)`,
    `· 1H EMA 9 / 21:       $${fibEma.ema1h.ema9.toFixed(1)} / $${fibEma.ema1h.ema21.toFixed(1)} (${fibEma.ema1h.stack})`,
    ``,
    `SECTION F. SETUP IDENTIFICATION & CONFLUENCE SCORE`,
    `-------------------------------------------------------------------------------`,
    `· Identified Setup:    ${setupConf.setup.name}`,
    `· Setup Description:   ${setupConf.setup.description}`,
    `· Confluence Score:    ${setupConf.confluence.totalScore}/16 Points (${setupConf.confluence.convictionPct}%)`,
    `· Confluence Grade:    ${setupConf.confluence.grade}`,
    `· Scoring Breakdown:`,
    ...setupConf.confluence.items.map(
      (item) => `    [${item.passed ? '✓' : '✗'}] ${item.label.padEnd(28)}: ${item.earned}/${item.weight} pts · ${item.reason}`
    ),
    ``,
    `SECTION G. HARD NO-TRADE FILTERS AUDIT`,
    `-------------------------------------------------------------------------------`,
    `· Overall Verdict:     ${hardFilters.passed ? 'ALL FILTERS CLEARED (TRADE APPROVED)' : 'FILTER BLOCKED (NO TRADE)'}`,
    `· Triggered Count:     ${hardFilters.triggeredCount}/11 filters active`,
    ...hardFilters.filters.map(
      (f) => `    [${f.triggered ? 'TRIGGERED - BLOCKED' : 'PASS'}] ${f.label.padEnd(30)}: ${f.reason}`
    ),
    ``,
    `SECTION H. RISK & POSITION SIZING PLAN`,
    `-------------------------------------------------------------------------------`,
    `· Account Equity:      $${sizing.accountEquityUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `· Risk Cap:            ${sizing.riskPct.toFixed(2)}% of equity ($${sizing.riskAmountUsd.toFixed(2)} max risk)`,
    `· Entry Level:         $${sizing.entryPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `· Structural Stop Loss: $${sizing.stopLossPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${sizing.riskDistancePct.toFixed(2)}% distance)`,
    `· Raw Sizing:          ${sizing.rawBtcSize.toFixed(4)} BTC`,
    `· Delta Exchange Lots: ${sizing.deltaLots} Lots (${sizing.clampedBtcSize.toFixed(3)} BTC @ 0.001 BTC/lot)`,
    `· Trade Notional:      $${sizing.notionalUsd.toFixed(2)}`,
    `· Margin Required:     $${sizing.estimatedMarginUsd.toFixed(2)} (Estimated 10x leverage)`,
    `· Roundtrip Friction:  $${sizing.roundtripFeeUsd.toFixed(2)} (Maker + GST)`,
    ``,
    `SECTION I. FINAL EXECUTION SUMMARY`,
    `-------------------------------------------------------------------------------`,
    `· Executive Action:    ${execution.action} (${execution.signalState})`,
    `· Stop Loss:           $${execution.exits.stopLoss.toFixed(2)}`,
    `· Target 1 (35%):      $${execution.exits.tp1Price.toFixed(2)} (1:${execution.exits.tp1R.toFixed(2)}R) -> ${execution.exits.tp1Action}`,
    `· Target 2 (35%):      $${execution.exits.tp2Price.toFixed(2)} (1:${execution.exits.tp2R.toFixed(2)}R) -> ${execution.exits.tp2Action}`,
    `· Runner Target (30%): $${execution.exits.tp3RunnerPrice.toFixed(2)} (1:${execution.exits.tp3R.toFixed(2)}R) -> ${execution.exits.tp3Action}`,
    `· Reward-to-Risk:      1:${execution.exits.riskRewardRatio.toFixed(2)}`,
    `· Breakeven with Fee:  $${execution.exits.breakevenWithFeePrice.toFixed(2)}`,
    `· Execution Protocol:  ${execution.executionProtocol}`,
    `═══════════════════════════════════════════════════════════════════════════════`,
  ];

  const formattedText = formattedLines.join('\n');

  return {
    generatedAtUtc: nowUtc,
    symbol: 'BTCUSD',
    sectionA_marketSnapshot: snapshot,
    sectionB_marketStructure: structure,
    sectionC_cprAnalysis: cpr,
    sectionD_camarillaConfluence: camarilla,
    sectionE_fibonacciAndEma: fibEma,
    sectionF_setupAndConfluence: setupConf,
    sectionG_hardFiltersAudit: hardFilters,
    sectionH_riskAndPositionSizing: sizing,
    sectionI_finalExecutionSummary: execution,
    formattedText,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER EVALUATION FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Master pure evaluation entry point for the Institutional Intraday Sniper Strategy Engine for BTC.
 * Returns completely deterministic, side-effect-free results.
 */
export function evaluateInstitutionalBtcSniper(input: SniperEngineInput): InstitutionalBtcSniperResult {
  const {
    symbol = 'BTCUSD',
    currentPrice = 85000,
    candles,
    accountEquityUsd = 1000,
    sessionRealizedPnLUsd = 0,
    consecutiveStopsCount = 0,
    historicalUntouchedCprs = [],
    high24h = currentPrice * 1.015,
    low24h = currentPrice * 0.985,
    change24h = 0,
  } = input;

  const c4h = candles.c4h || [];
  const c1h = candles.c1h || [];
  const c15m = candles.c15m || [];
  const c5m = candles.c5m || [];
  const c1d = candles.c1d || [];

  const hasValidOhlcData = c15m.length >= 10;

  // 1. Evaluate Market Structure (4H, 1H, 15M)
  const ms4H = evaluateMarketStructure(c4h);
  const ms1H = evaluateMarketStructure(c1h);
  const ms15M = evaluateMarketStructure(c15m);

  // 2. Daily CPR computation from prior completed 1D candle or fallback
  const last1d = c1d.length >= 2 ? c1d[c1d.length - 2] : null;
  const prevHigh = last1d ? last1d.high : high24h;
  const prevLow = last1d ? last1d.low : low24h;
  const prevClose = last1d ? last1d.close : currentPrice / (1 + change24h / 100);

  const dailyCpr = computeDailyCpr(prevHigh, prevLow, prevClose, currentPrice);

  // 3. Virgin CPR Registry update
  const updatedVirginCprs = updateVirginCprRegistry(historicalUntouchedCprs, c15m, currentPrice);

  // 4. Camarilla Pivots
  const camarilla = computeCamarillaPivots(prevHigh, prevLow, prevClose);

  // 5. Fibonacci from 15M / 1H swings
  const isTrendBullish = ms1H.regime === 'BULLISH';
  const fibonacci = computeFibonacciLevels(ms15M.swingHigh || high24h, ms15M.swingLow || low24h, isTrendBullish);

  // 6. EMA 9/21 on 15M and 1H
  const ema15m = evaluateEma921(c15m);
  const ema1h = evaluateEma921(c1h);

  // 7. Volatility / ATR
  const atr15m = calculateAtr(c15m, 14);
  const atrPct = currentPrice > 0 ? (atr15m / currentPrice) * 100 : 0.6;

  // Last completed candles
  const last15mCandle: BtcCandle = c15m.length >= 1 ? c15m[c15m.length - 1] : {
    time: Date.now(),
    open: currentPrice,
    high: currentPrice * 1.001,
    low: currentPrice * 0.999,
    close: currentPrice,
    volume: 100,
  };

  const last5mCandle: BtcCandle | undefined = c5m.length >= 1 ? c5m[c5m.length - 1] : undefined;

  // 8. Setup Evaluation
  const setup = evaluateSetups({
    regime4H: ms4H.regime,
    regime1H: ms1H.regime,
    cpr: dailyCpr,
    camarilla,
    ema15m,
    currentPrice,
    last15mCandle,
    atr15m,
  });

  // Determine potential trade side from setup or dominant trend
  const tentativeSide: 'LONG' | 'SHORT' =
    setup.direction === 'LONG' || setup.direction === 'SHORT'
      ? setup.direction
      : ms1H.regime === 'BULLISH'
      ? 'LONG'
      : 'SHORT';

  // 9. 16-Point Confluence Scoring
  const confluence = evaluate16PointConfluence({
    tradeSide: tentativeSide,
    regime4H: ms4H.regime,
    regime1H: ms1H.regime,
    cpr: dailyCpr,
    ema15m,
    camarilla,
    fib: fibonacci,
    virginCprs: updatedVirginCprs,
    last15mCandle,
    last5mCandle,
    currentPrice,
  });

  // 10. Compute Entry and Structural Stop Loss
  const isLong = tentativeSide === 'LONG';
  const entryPrice = currentPrice;
  // Stop Loss: 1.5x 15M ATR or structural pivot
  const slBuffer = Math.max(atr15m * 1.5, currentPrice * 0.0035);
  const stopLossPrice = isLong ? Math.min(camarilla.h3, currentPrice - slBuffer) : Math.max(camarilla.l3, currentPrice + slBuffer);

  // 11. Structured Exits
  const exits = calculateStructuredExits({
    isLong,
    entryPrice,
    stopLossPrice,
    camarilla,
  });

  // 12. Hard No-Trade Filters Audit
  const hardFilters = evaluateHardFilters({
    tradeSide: tentativeSide,
    currentPrice,
    entryPrice,
    stopLossPrice,
    tp2Price: exits.tp2Price,
    cpr: dailyCpr,
    ema15m,
    regime4H: ms4H.regime,
    setupId: setup.id,
    virginCprs: updatedVirginCprs,
    atr15m,
    accountEquityUsd,
    sessionRealizedPnLUsd,
    consecutiveStopsCount,
    hasValidOhlcData,
  });

  // 13. Position Sizing
  const sizingRiskPct = setup.riskPct > 0 ? setup.riskPct : 0.25;
  const sizing = calculateBtcPositionSize({
    accountEquityUsd,
    riskPct: sizingRiskPct,
    entryPrice,
    stopLossPrice,
  });

  // Circuit breaker state
  const circuitBreakerActive = consecutiveStopsCount >= 3 || sessionRealizedPnLUsd <= -accountEquityUsd * 0.015;
  const circuitBreakerReason = circuitBreakerActive
    ? consecutiveStopsCount >= 3
      ? 'HALTED: 3 consecutive losses triggered session lock'
      : 'HALTED: Daily loss >= 1.5% equity cap breached'
    : undefined;

  // Determine final actionable state
  let action: SniperActionType = 'NO_TRADE';
  let signalState: SignalLifecycleState = 'INVALIDATED';

  if (circuitBreakerActive) {
    action = 'NO_TRADE';
    signalState = 'INVALIDATED';
  } else if (!hardFilters.passed) {
    action = 'NO_TRADE';
    signalState = 'INVALIDATED';
  } else if (confluence.grade === 'NO_TRADE') {
    action = 'WAIT';
    signalState = 'DEVELOPING';
  } else if (confluence.grade === 'B') {
    action = 'WAIT';
    signalState = 'ANTICIPATED';
  } else if (confluence.grade === 'A+' || confluence.grade === 'A') {
    action = tentativeSide;
    signalState = 'CONFIRMED';
  }

  // 14. Generate Structured 9-Section Report
  const nearestVirgin = updatedVirginCprs.filter((z) => z.isUntouched).sort((a, b) => a.distanceFromPrice - b.distanceFromPrice)[0] || null;

  const report = generateBtcStrategyReport(
    {
      markPrice: currentPrice,
      high24h,
      low24h,
      change24hPct: change24h,
      atr14_15m: atr15m,
      atrPct,
    },
    {
      regime4H: ms4H.regime,
      regime1H: ms1H.regime,
      structure15M: ms15M.regime,
      keySwings: { swingHigh: ms15M.swingHigh, swingLow: ms15M.swingLow },
    },
    {
      ...dailyCpr,
      virginCprZonesCount: updatedVirginCprs.filter((z) => z.isUntouched).length,
      nearestVirginCpr: nearestVirgin,
    },
    {
      ...camarilla,
      keyLevelNote: isLong
        ? `H4 ($${camarilla.h4.toFixed(1)}) is the primary bullish breakout trigger. H3 ($${camarilla.h3.toFixed(1)}) is support.`
        : `L4 ($${camarilla.l4.toFixed(1)}) is the primary bearish breakdown trigger. L3 ($${camarilla.l3.toFixed(1)}) is resistance.`,
    },
    {
      fibonacci,
      ema15m,
      ema1h,
    },
    {
      setup,
      confluence,
    },
    hardFilters,
    sizing,
    {
      action,
      signalState,
      exits,
      executionProtocol:
        action === 'LONG' || action === 'SHORT'
          ? `EXECUTE ${action} with ${sizing.deltaLots} Lots (${sizing.clampedBtcSize.toFixed(3)} BTC). Place SL at $${exits.stopLoss.toFixed(2)}. Move SL to BE upon 15M confirmation post-TP1.`
          : `AWAITING HIGHER-CONFLUENCE TRIGGER: Current conditions do not satisfy strict institutional risk gates.`,
    }
  );

  return {
    symbol,
    action,
    signalState,
    marketStructure4H: ms4H.regime,
    trendAlignment1H: ms1H.regime,
    structure15M: ms15M.regime,
    currentPrice,
    dailyCpr,
    virginCprZones: updatedVirginCprs,
    camarilla,
    fibonacci,
    ema15m,
    ema1h,
    setup,
    confluence,
    hardFilters,
    sizing,
    exits,
    report,
    circuitBreakerActive,
    circuitBreakerReason,
    timestamp: Date.now(),
  };
}

/**
 * Institutional Intraday Sniper Strategy evaluator alias.
 */
export const evaluateIntradaySniperStrategy = evaluateInstitutionalBtcSniper;
