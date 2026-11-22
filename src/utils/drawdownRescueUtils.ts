import {
  CamarillaLevels,
  PerpetualRescueActionType,
  PerpetualRescueAdjustmentRecord,
  PerpetualRescueOptionQuote,
  PerpetualRescueRecommendation,
  TradingMode,
} from '../types';
import { FibonacciLevels } from './fibonacciUtils';

export const RESCUE_TRIGGER_R_MULTIPLE = -0.50;
export const RESCUE_MAX_ADJUSTMENTS_PER_TRADE = 1;
export const RESCUE_MAX_EQUITY_RISK_PCT = 2; // <= 2% max equity risk
export const RESCUE_TREND_FLIP_MIN_AI_MATRIX_PCT = 80;
export const MIN_PERP_SL_BUFFER_PCT = 0.0028;
export const RESCUE_BLOCK_COOLDOWN_MS = 15 * 60 * 1000; // 15-minute latch after execution or exchange rejection
export const NOTIFICATION_DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5-minute notification spam deduplication window

export interface PerpContractSpec {
  underlying: 'BTC' | 'ETH' | 'SOL';
  deltaSymbol: 'BTCUSD' | 'ETHUSD' | 'SOLUSD';
  canonicalSymbol: 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT';
  contractValue: number;
  strikeStep: number;
  priceDecimals: number;
}

const SUPPORTED_PERP_SPECS: Record<'BTC' | 'ETH' | 'SOL', PerpContractSpec> = {
  BTC: {
    underlying: 'BTC',
    deltaSymbol: 'BTCUSD',
    canonicalSymbol: 'BTCUSDT',
    contractValue: 0.001,
    strikeStep: 200,
    priceDecimals: 2,
  },
  ETH: {
    underlying: 'ETH',
    deltaSymbol: 'ETHUSD',
    canonicalSymbol: 'ETHUSDT',
    contractValue: 0.01,
    strikeStep: 20,
    priceDecimals: 2,
  },
  SOL: {
    underlying: 'SOL',
    deltaSymbol: 'SOLUSD',
    canonicalSymbol: 'SOLUSDT',
    contractValue: 1,
    strikeStep: 2,
    priceDecimals: 3,
  },
};

export function getSupportedRescuePerpSpec(symbol?: string): PerpContractSpec | null {
  const upper = String(symbol || '').trim().toUpperCase();
  if (!upper || upper.startsWith('C-') || upper.startsWith('P-')) return null;
  if (upper === 'BTCUSD' || upper === 'BTCUSDT') return SUPPORTED_PERP_SPECS.BTC;
  if (upper === 'ETHUSD' || upper === 'ETHUSDT') return SUPPORTED_PERP_SPECS.ETH;
  if (upper === 'SOLUSD' || upper === 'SOLUSDT') return SUPPORTED_PERP_SPECS.SOL;
  return null;
}

export function isEligibleRescuePerpSymbol(symbol?: string): boolean {
  return getSupportedRescuePerpSpec(symbol) !== null;
}

export function buildRescueTradeKey(params: {
  mode: TradingMode;
  tradeId?: string;
  positionId?: string;
  symbol: string;
}): string {
  const spec = getSupportedRescuePerpSpec(params.symbol);
  const normSym = spec?.deltaSymbol || String(params.symbol || 'UNKNOWN').toUpperCase();
  const idPart = String(params.tradeId || params.positionId || normSym).trim();
  return `${params.mode}:${normSym}:${idPart}`;
}

export function computePositionDrawdownRMultiple(params: {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  markPrice: number;
}): {
  rMultiple: number;
  riskDistance: number;
  effectiveStopLoss: number;
  drawdownPctFromEntry: number;
} {
  const entry = Number(params.entryPrice) || 0;
  const mark = Number(params.markPrice) || entry;
  if (entry <= 0 || mark <= 0) {
    return {
      rMultiple: 0,
      riskDistance: 0,
      effectiveStopLoss: Number(params.stopLoss) || 0,
      drawdownPctFromEntry: 0,
    };
  }

  const isLong = params.side === 'LONG';
  const minRiskDist = entry * MIN_PERP_SL_BUFFER_PCT;
  const rawSl = Number(params.stopLoss) || 0;
  const rawDist =
    rawSl > 0
      ? isLong
        ? Math.max(0, entry - rawSl)
        : Math.max(0, rawSl - entry)
      : 0;
  const riskDistance = Math.max(rawDist, minRiskDist);
  const effectiveStopLoss =
    rawDist >= minRiskDist
      ? rawSl
      : isLong
      ? +(entry - riskDistance).toFixed(2)
      : +(entry + riskDistance).toFixed(2);

  const signedMove = isLong ? mark - entry : entry - mark;
  const rMultiple = +(signedMove / riskDistance).toFixed(3);
  const drawdownPctFromEntry = +((signedMove / entry) * 100).toFixed(3);

  return {
    rMultiple,
    riskDistance,
    effectiveStopLoss,
    drawdownPctFromEntry,
  };
}

function calcSimpleEma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

export interface RescueCandleInput {
  open: number;
  high: number;
  low: number;
  close: number;
  time?: number;
}

export function evaluate4hTrendValidity(params: {
  candles4h: RescueCandleInput[];
  side: 'LONG' | 'SHORT';
  markPrice: number;
  fallbackChange24h?: number;
}): {
  isValid: boolean;
  ema9: number;
  ema20: number;
  reason: string;
} {
  const { candles4h, side, markPrice, fallbackChange24h = 0 } = params;
  const isLong = side === 'LONG';

  if (Array.isArray(candles4h) && candles4h.length >= 4) {
    const closes = candles4h.map((c) => Number(c.close)).filter((n) => Number.isFinite(n) && n > 0);
    if (closes.length >= 4) {
      const ema9 = calcSimpleEma(closes, Math.min(9, closes.length));
      const ema20 = calcSimpleEma(closes, Math.min(20, closes.length));
      const latest = candles4h[candles4h.length - 1];
      const prev = candles4h[candles4h.length - 2];

      if (isLong) {
        const structureHigherLow = Number(latest.low) >= Number(prev.low) * 0.996;
        const aboveEmaFloor = markPrice >= ema20 * 0.995;
        const emaBullish = ema9 >= ema20 * 0.999;
        const valid = (emaBullish && aboveEmaFloor) || (aboveEmaFloor && structureHigherLow);
        return {
          isValid: valid,
          ema9: +ema9.toFixed(2),
          ema20: +ema20.toFixed(2),
          reason: valid
            ? `4h Trend Valid (EMA9 $${ema9.toFixed(0)} / EMA20 $${ema20.toFixed(0)} · Structure Intact)`
            : `4h Trend Invalidated (Mark $${markPrice.toFixed(0)} < EMA20 $${ema20.toFixed(0)})`,
        };
      } else {
        const structureLowerHigh = Number(latest.high) <= Number(prev.high) * 1.004;
        const belowEmaCeiling = markPrice <= ema20 * 1.005;
        const emaBearish = ema9 <= ema20 * 1.001;
        const valid = (emaBearish && belowEmaCeiling) || (belowEmaCeiling && structureLowerHigh);
        return {
          isValid: valid,
          ema9: +ema9.toFixed(2),
          ema20: +ema20.toFixed(2),
          reason: valid
            ? `4h Trend Valid (EMA9 $${ema9.toFixed(0)} / EMA20 $${ema20.toFixed(0)} · Bearish Intact)`
            : `4h Trend Invalidated (Mark $${markPrice.toFixed(0)} > EMA20 $${ema20.toFixed(0)})`,
        };
      }
    }
  }

  // Fallback when 4h candle history is still hydrating: use 24h change polarity
  const fallbackValid = isLong ? fallbackChange24h >= -1.5 : fallbackChange24h <= 1.5;
  return {
    isValid: fallbackValid,
    ema9: markPrice,
    ema20: markPrice,
    reason: fallbackValid
      ? `4h Macro Bias Aligned (${fallbackChange24h >= 0 ? '+' : ''}${fallbackChange24h.toFixed(2)}% 24h)`
      : `4h Macro Trend Adverse (${fallbackChange24h.toFixed(2)}% 24h)`,
  };
}

export function selectNearestReAnchorLiquidityZone(params: {
  side: 'LONG' | 'SHORT';
  markPrice: number;
  camarilla?: Partial<CamarillaLevels>;
  fibonacci?: Partial<FibonacciLevels> & { gp618?: number };
  priceDecimals?: number;
}): {
  price: number;
  label: string;
} {
  const { side, markPrice, camarilla, fibonacci, priceDecimals = 2 } = params;
  const isLong = side === 'LONG';
  const fib618Price = Number(fibonacci?.fib618 || fibonacci?.gp618 || 0);

  const candidates: Array<{ label: string; price: number }> = isLong
    ? [
        { label: 'Camarilla L3', price: Number(camarilla?.l3 || 0) },
        { label: 'Camarilla L4', price: Number(camarilla?.l4 || 0) },
        { label: '0.618 Golden Pocket', price: fib618Price },
      ]
    : [
        { label: 'Camarilla H3', price: Number(camarilla?.h3 || 0) },
        { label: 'Camarilla H4', price: Number(camarilla?.h4 || 0) },
        { label: '0.618 Golden Pocket', price: fib618Price },
      ];

  const validLevels = candidates.filter((c) => Number.isFinite(c.price) && c.price > 0);

  // Strictly choose levels on the passive limit side of current mark (never market-chase!)
  const passiveLevels = validLevels.filter((c) =>
    isLong ? c.price <= markPrice * 0.9992 : c.price >= markPrice * 1.0008
  );

  if (passiveLevels.length > 0) {
    passiveLevels.sort((a, b) => Math.abs(markPrice - a.price) - Math.abs(markPrice - b.price));
    return {
      price: +passiveLevels[0].price.toFixed(priceDecimals),
      label: passiveLevels[0].label,
    };
  }

  // If all computed structural levels sit slightly past mark, derive anchored L4 / 0.618 zone passively away from mark
  const fallbackDist = markPrice * 0.0032;
  const fallbackPrice = isLong ? markPrice - fallbackDist : markPrice + fallbackDist;
  const closestValid =
    validLevels.length > 0
      ? validLevels.sort((a, b) => Math.abs(markPrice - a.price) - Math.abs(markPrice - b.price))[0]
      : null;

  return {
    price: +fallbackPrice.toFixed(priceDecimals),
    label: closestValid ? `${closestValid.label} Pullback Zone` : isLong ? 'Camarilla L4 Zone' : 'Camarilla H4 Zone',
  };
}

export function evaluate5mTrendFlipCondition(params: {
  candles5m: RescueCandleInput[];
  lastClosed5mClose?: number;
  side: 'LONG' | 'SHORT';
  camarilla?: Partial<CamarillaLevels>;
  aiMatrixPct: number;
  markPrice: number;
}): {
  ready: boolean;
  candleClosedBeyondOpposite: boolean;
  oppositeLevelLabel: 'H4' | 'L4';
  oppositeLevelPrice: number;
  closed5mClose: number;
  aiMatrixPct: number;
  aiMatrixMet: boolean;
  newDirection: 'LONG' | 'SHORT';
  reason: string;
} {
  const { candles5m, lastClosed5mClose, side, camarilla, aiMatrixPct, markPrice } = params;
  const isLong = side === 'LONG';
  const newDirection: 'LONG' | 'SHORT' = isLong ? 'SHORT' : 'LONG';
  const oppositeLevelLabel: 'H4' | 'L4' = isLong ? 'L4' : 'H4';

  const rawOppLevel = isLong ? Number(camarilla?.l4 || 0) : Number(camarilla?.h4 || 0);
  const oppositeLevelPrice =
    rawOppLevel > 0
      ? rawOppLevel
      : isLong
      ? +(markPrice * 0.996).toFixed(2)
      : +(markPrice * 1.004).toFixed(2);

  // Strictly use CONFIRMED CLOSED 5m candle (either explicit closed bar or index length-2 from live candles5m)
  let closedClose = Number(lastClosed5mClose || 0);
  if (closedClose <= 0 && Array.isArray(candles5m)) {
    if (candles5m.length >= 2) {
      closedClose = Number(candles5m[candles5m.length - 2].close || 0);
    } else if (candles5m.length === 1) {
      closedClose = Number(candles5m[0].close || 0);
    }
  }
  if (closedClose <= 0) closedClose = markPrice;

  const candleClosedBeyondOpposite = isLong
    ? closedClose <= oppositeLevelPrice
    : closedClose >= oppositeLevelPrice;
  const normalizedAiPct = Math.round(Number(aiMatrixPct) || 0);
  const aiMatrixMet = normalizedAiPct >= RESCUE_TREND_FLIP_MIN_AI_MATRIX_PCT;
  const ready = candleClosedBeyondOpposite && aiMatrixMet;

  let reason = '';
  if (ready) {
    reason = `5m Closed $${closedClose.toLocaleString()} ${isLong ? '<=' : '>='} ${oppositeLevelLabel} ($${oppositeLevelPrice.toLocaleString()}) & AI Matrix ${normalizedAiPct}% >= 80%`;
  } else if (!candleClosedBeyondOpposite && !aiMatrixMet) {
    reason = `Awaiting 5m close ${isLong ? '<=' : '>='} ${oppositeLevelLabel} ($${oppositeLevelPrice.toLocaleString()}) & AI Matrix >= 80% (currently ${normalizedAiPct}%)`;
  } else if (!candleClosedBeyondOpposite) {
    reason = `Blocked: Latest closed 5m ($${closedClose.toLocaleString()}) has not closed beyond ${oppositeLevelLabel} ($${oppositeLevelPrice.toLocaleString()})`;
  } else {
    reason = `Blocked: AI Matrix ${normalizedAiPct}% < 80% required threshold`;
  }

  return {
    ready,
    candleClosedBeyondOpposite,
    oppositeLevelLabel,
    oppositeLevelPrice,
    closed5mClose: closedClose,
    aiMatrixPct: normalizedAiPct,
    aiMatrixMet,
    newDirection,
    reason,
  };
}

export function enforceMaxEquityRiskContracts(params: {
  totalEquityUsd: number;
  entryPrice: number;
  stopLoss: number;
  requestedContracts: number;
  contractValue: number;
  maxEquityRiskPct?: number;
}): {
  safeContracts: number;
  coinSize: number;
  riskUsd: number;
  maxAllowedRiskUsd: number;
  equityRiskPct: number;
  within2PctRisk: boolean;
} {
  const maxPct = params.maxEquityRiskPct ?? RESCUE_MAX_EQUITY_RISK_PCT;
  const equity = Math.max(1, Number(params.totalEquityUsd) || 100);
  const maxAllowedRiskUsd = +(equity * (maxPct / 100)).toFixed(2);
  const cVal = Math.max(0.0001, Number(params.contractValue) || 0.001);
  const slDist = Math.max(
    Math.abs(params.entryPrice - params.stopLoss),
    params.entryPrice * MIN_PERP_SL_BUFFER_PCT
  );
  const riskPerContract = slDist * cVal;
  const rawMaxContracts =
    riskPerContract > 0 ? Math.floor(maxAllowedRiskUsd / riskPerContract) : params.requestedContracts;
  const requested = Math.max(1, Math.round(params.requestedContracts || 1));
  const safeContracts = Math.max(1, Math.min(requested, Math.max(1, rawMaxContracts)));
  const coinSize = +(safeContracts * cVal).toFixed(cVal < 0.01 ? 4 : cVal < 1 ? 2 : 0);
  const riskUsd = +(safeContracts * riskPerContract).toFixed(2);
  const equityRiskPct = +((riskUsd / equity) * 100).toFixed(2);
  const within2PctRisk = riskUsd <= maxAllowedRiskUsd + 0.05;

  return {
    safeContracts,
    coinSize,
    riskUsd,
    maxAllowedRiskUsd,
    equityRiskPct,
    within2PctRisk,
  };
}

export function computeAdjustedBreakEvenProjection(params: {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  markPrice: number;
  reAnchorPrice: number;
  optionCreditPerCoin: number;
  priceDecimals?: number;
}): {
  deRiskImmediateBe: number;
  deRiskReAnchoredBe: number;
  optionsHedgeBe: number;
  flipRecoveryTargetPrice: number;
} {
  const { side, entryPrice, markPrice, reAnchorPrice, optionCreditPerCoin, priceDecimals = 2 } = params;
  const isLong = side === 'LONG';

  // 1) Closing 50% at mark realizes 0.5 * lossPerCoin; remaining 50% needs to move further by that loss
  const immediateLossPerCoin = isLong ? Math.max(0, entryPrice - markPrice) : Math.max(0, markPrice - entryPrice);
  const deRiskImmediateBe = isLong
    ? +(entryPrice + immediateLossPerCoin).toFixed(priceDecimals)
    : +(entryPrice - immediateLossPerCoin).toFixed(priceDecimals);

  // When remaining 50% (at entryPrice) is joined by 50% limit re-anchor at reAnchorPrice:
  // Combined avg = (entryPrice + reAnchorPrice)/2, recovering 0.5*lossPerCoin over full 1.0x size
  // => Net Break-Even = (entryPrice + reAnchorPrice)/2 +/- 0.5*lossPerCoin = entryPrice + (reAnchorPrice - markPrice)/2
  const deRiskReAnchoredBe = isLong
    ? +((entryPrice + reAnchorPrice) / 2 + immediateLossPerCoin * 0.5).toFixed(priceDecimals)
    : +((entryPrice + reAnchorPrice) / 2 - immediateLossPerCoin * 0.5).toFixed(priceDecimals);

  // 2) Options Hedge Overlay (1:1 matched contracts collecting optionCreditPerCoin)
  // Lowers LONG breakeven by credit collected; raises SHORT breakeven by credit collected
  const credit = Math.max(0, Number(optionCreditPerCoin) || 0);
  const optionsHedgeBe = isLong
    ? +(Math.max(0.01, entryPrice - credit)).toFixed(priceDecimals)
    : +(entryPrice + credit).toFixed(priceDecimals);

  // 3) Trend-Flip Reverse (100% flipped into opposite direction at markPrice with 1:1 lot sizing)
  // To recover 1R realized drawdown loss on flipped direction from markPrice:
  const flipRecoveryTargetPrice = isLong
    ? +(Math.max(0.01, markPrice - immediateLossPerCoin)).toFixed(priceDecimals)
    : +(markPrice + immediateLossPerCoin).toFixed(priceDecimals);

  return {
    deRiskImmediateBe,
    deRiskReAnchoredBe,
    optionsHedgeBe,
    flipRecoveryTargetPrice,
  };
}

export function buildPerpetualRescueRecommendation(params: {
  mode: TradingMode;
  tradeId: string;
  positionId?: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  markPrice: number;
  stopLoss: number;
  lotSize: number;
  contracts?: number;
  unrealizedPnlUsd: number;
  usdInrRate: number;
  totalEquityUsd: number;
  candles4h: RescueCandleInput[];
  candles5m: RescueCandleInput[];
  lastClosed5mClose?: number;
  camarilla?: Partial<CamarillaLevels>;
  fibonacci?: Partial<FibonacciLevels> & { gp618?: number };
  aiMatrixPct: number;
  fallbackChange24h?: number;
  optionQuote?: PerpetualRescueOptionQuote | null;
  executedRecord?: PerpetualRescueAdjustmentRecord | null;
}): PerpetualRescueRecommendation | null {
  const spec = getSupportedRescuePerpSpec(params.symbol);
  if (!spec) return null;

  const entry = Number(params.entryPrice) || 0;
  const mark = Number(params.markPrice) || 0;
  if (entry <= 0 || mark <= 0) return null;

  const tradeKey = buildRescueTradeKey({
    mode: params.mode,
    tradeId: params.tradeId,
    positionId: params.positionId,
    symbol: spec.deltaSymbol,
  });

  const { rMultiple, effectiveStopLoss, drawdownPctFromEntry } = computePositionDrawdownRMultiple({
    side: params.side,
    entryPrice: entry,
    stopLoss: params.stopLoss,
    markPrice: mark,
  });

  const executedRecord = params.executedRecord || null;
  const adjustmentCount = executedRecord ? Math.max(1, executedRecord.adjustmentCount) : 0;
  const isLocked = adjustmentCount >= RESCUE_MAX_ADJUSTMENTS_PER_TRADE;
  const isInDrawdownThreshold = params.unrealizedPnlUsd < 0 && rMultiple <= RESCUE_TRIGGER_R_MULTIPLE;
  const shouldSurface = isInDrawdownThreshold || isLocked;

  const matchedContracts =
    params.contracts && params.contracts > 0
      ? Math.max(1, Math.round(params.contracts))
      : Math.max(1, Math.round((Number(params.lotSize) || spec.contractValue) / spec.contractValue));
  const matchedCoinSize = +(matchedContracts * spec.contractValue).toFixed(
    spec.contractValue < 0.01 ? 4 : spec.contractValue < 1 ? 2 : 0
  );

  // Action 1: 50% De-Risk & Re-Anchor
  const trend4h = evaluate4hTrendValidity({
    candles4h: params.candles4h,
    side: params.side,
    markPrice: mark,
    fallbackChange24h: params.fallbackChange24h,
  });
  const reAnchorZone = selectNearestReAnchorLiquidityZone({
    side: params.side,
    markPrice: mark,
    camarilla: params.camarilla,
    fibonacci: params.fibonacci,
    priceDecimals: spec.priceDecimals,
  });

  const halfCloseContracts = matchedContracts >= 2 ? Math.floor(matchedContracts * 0.5) : 1;
  const halfCloseCoinSize = +(halfCloseContracts * spec.contractValue).toFixed(
    spec.contractValue < 0.01 ? 4 : spec.contractValue < 1 ? 2 : 0
  );
  const reAnchorSlDist = Math.max(
    Math.abs(reAnchorZone.price - effectiveStopLoss),
    reAnchorZone.price * MIN_PERP_SL_BUFFER_PCT
  );
  const reAnchorSl =
    params.side === 'LONG'
      ? +(reAnchorZone.price - reAnchorSlDist).toFixed(spec.priceDecimals)
      : +(reAnchorZone.price + reAnchorSlDist).toFixed(spec.priceDecimals);
  const reAnchorRiskCheck = enforceMaxEquityRiskContracts({
    totalEquityUsd: params.totalEquityUsd,
    entryPrice: reAnchorZone.price,
    stopLoss: reAnchorSl,
    requestedContracts: halfCloseContracts,
    contractValue: spec.contractValue,
  });

  // Action 2: 1:1 Options Hedge Overlay (ATM/OTM Short Call for LONG, Short Put for SHORT)
  const targetOptionType: 'CALL' | 'PUT' = params.side === 'LONG' ? 'CALL' : 'PUT';
  const fallbackOptionPrem = +(mark * 0.0045).toFixed(2);
  const optionCreditPerCoin = params.optionQuote?.markPrice
    ? Number(params.optionQuote.markPrice)
    : fallbackOptionPrem;
  const optionRiskCheck = enforceMaxEquityRiskContracts({
    totalEquityUsd: params.totalEquityUsd,
    entryPrice: mark,
    stopLoss: effectiveStopLoss,
    requestedContracts: matchedContracts,
    contractValue: spec.contractValue,
  });

  // Action 3: Trend-Flip Reverse
  const flipEval = evaluate5mTrendFlipCondition({
    candles5m: params.candles5m,
    lastClosed5mClose: params.lastClosed5mClose,
    side: params.side,
    camarilla: params.camarilla,
    aiMatrixPct: params.aiMatrixPct,
    markPrice: mark,
  });
  const flipSlDist = Math.max(mark * MIN_PERP_SL_BUFFER_PCT, Math.abs(mark - flipEval.oppositeLevelPrice));
  const flipNewStopLoss =
    flipEval.newDirection === 'SHORT'
      ? +(mark + flipSlDist).toFixed(spec.priceDecimals)
      : +(mark - flipSlDist).toFixed(spec.priceDecimals);
  const flipRiskCheck = enforceMaxEquityRiskContracts({
    totalEquityUsd: params.totalEquityUsd,
    entryPrice: mark,
    stopLoss: flipNewStopLoss,
    requestedContracts: matchedContracts,
    contractValue: spec.contractValue,
  });

  const beProjection = computeAdjustedBreakEvenProjection({
    side: params.side,
    entryPrice: entry,
    markPrice: mark,
    reAnchorPrice: reAnchorZone.price,
    optionCreditPerCoin,
    priceDecimals: spec.priceDecimals,
  });

  const currentAdjustedBe = executedRecord
    ? executedRecord.adjustedBreakEvenPrice
    : beProjection.optionsHedgeBe;

  const totalEq = Math.max(1, Number(params.totalEquityUsd) || 100);
  const maxRiskAllowedUsd = +(totalEq * (RESCUE_MAX_EQUITY_RISK_PCT / 100)).toFixed(2);
  const inrRate = params.usdInrRate > 0 ? params.usdInrRate : 85;

  return {
    eligible: true,
    shouldSurface,
    isLocked,
    lockReason: isLocked
      ? `Single-Adjustment Safety Lock Active (1/1 Used: ${executedRecord?.action || 'ADJUSTED'})`
      : undefined,
    tradeKey,
    tradeId: params.tradeId,
    positionId: params.positionId,
    symbol: params.symbol,
    deltaSymbol: spec.deltaSymbol,
    canonicalSymbol: spec.canonicalSymbol,
    side: params.side,
    mode: params.mode,
    entryPrice: entry,
    markPrice: mark,
    stopLoss: effectiveStopLoss,
    lotSize: Number(params.lotSize) || matchedCoinSize,
    contracts: matchedContracts,
    contractValue: spec.contractValue,
    unrealizedPnlUsd: +Number(params.unrealizedPnlUsd).toFixed(2),
    unrealizedPnlInr: +(Number(params.unrealizedPnlUsd) * inrRate).toFixed(2),
    rMultiple,
    drawdownPctFromEntry,
    adjustmentCount,
    maxAdjustments: 1,
    adjustedBreakEvenPrice: currentAdjustedBe,
    equityRiskCapPct: 2,
    maxRiskAllowedUsd,
    projectedDeRiskReAnchor: {
      enabled: !isLocked && isInDrawdownThreshold && trend4h.isValid && matchedContracts >= 1,
      trend4hValid: trend4h.isValid,
      trend4hReason: trend4h.reason,
      closeFraction: 0.5,
      closeSizeCoin: halfCloseCoinSize,
      closeContracts: halfCloseContracts,
      reAnchorContracts: reAnchorRiskCheck.safeContracts,
      reAnchorPrice: reAnchorZone.price,
      reAnchorZoneLabel: reAnchorZone.label,
      projectedAdjustedBe: beProjection.deRiskReAnchoredBe,
      immediatePostCloseBe: beProjection.deRiskImmediateBe,
      equityRiskPct: reAnchorRiskCheck.equityRiskPct,
      within2PctRisk: reAnchorRiskCheck.within2PctRisk,
    },
    projectedOptionsHedge: {
      enabled: !isLocked && isInDrawdownThreshold && matchedContracts >= 1,
      optionType: targetOptionType,
      matchedContracts,
      matchedCoinSize,
      optionQuote: params.optionQuote || null,
      projectedAdjustedBe: beProjection.optionsHedgeBe,
      beImprovementUsdPerCoin: +optionCreditPerCoin.toFixed(spec.priceDecimals),
      equityRiskPct: optionRiskCheck.equityRiskPct,
      within2PctRisk: optionRiskCheck.within2PctRisk,
      reason: params.optionQuote
        ? `1:1 ${params.optionQuote.symbol} Short ${targetOptionType} ($${params.optionQuote.markPrice.toFixed(2)} prem)`
        : `Nearest Same-Day Delta ${spec.underlying} ${targetOptionType} (1:1 · ${matchedContracts} cts)`,
    },
    projectedTrendFlip: {
      enabled: !isLocked && isInDrawdownThreshold && flipEval.ready,
      candleClosedBeyondOpposite: flipEval.candleClosedBeyondOpposite,
      oppositeLevelLabel: flipEval.oppositeLevelLabel,
      oppositeLevelPrice: flipEval.oppositeLevelPrice,
      closed5mClose: flipEval.closed5mClose,
      aiMatrixPct: flipEval.aiMatrixPct,
      aiMatrixMet: flipEval.aiMatrixMet,
      newDirection: flipEval.newDirection,
      newEntryPrice: mark,
      newStopLoss: flipNewStopLoss,
      flipContracts: flipRiskCheck.safeContracts,
      flipCoinSize: flipRiskCheck.coinSize,
      projectedAdjustedBe: beProjection.flipRecoveryTargetPrice,
      equityRiskPct: flipRiskCheck.equityRiskPct,
      within2PctRisk: flipRiskCheck.within2PctRisk,
      reason: flipEval.reason,
    },
    executedRecord,
  };
}

export interface RescueCircuitBreakerEntry {
  positionKey: string;
  status: 'EXECUTED' | 'BLOCKED' | 'FALLBACK_DERISK_EXECUTED';
  action: PerpetualRescueActionType;
  reason: string;
  errorCode?: string;
  blockedAt: number;
  cooldownUntil: number;
  availableBalanceAtBlock: number;
  requiredAdditionalBalance: number | null;
  targetAvailableBalanceToUnlock: number | null;
}

/**
 * Canonical per-position circuit-breaker key: `${symbol}_${entryPrice}_${side}`
 */
export function buildRescuePositionCircuitKey(
  symbol: string,
  entryPrice: number,
  side: 'LONG' | 'SHORT'
): string {
  const spec = getSupportedRescuePerpSpec(symbol);
  const normSymbol = spec?.deltaSymbol || String(symbol || 'UNKNOWN').trim().toUpperCase();
  const normEntry = Number.isFinite(entryPrice) && entryPrice > 0 ? Number(entryPrice.toFixed(4)) : 0;
  const normSide = String(side || 'LONG').trim().toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  return `${normSymbol}_${normEntry}_${normSide}`;
}

export function parseInsufficientMarginDetails(err: any): {
  isInsufficientMargin: boolean;
  errorCode: string;
  requiredAdditionalBalance: number | null;
  message: string;
} {
  const message = String(err?.message || err || 'Rescue adjustment rejected by exchange.');
  const rawCode = String(err?.code || err?.error_code || '').trim().toLowerCase();
  const lowerMsg = message.toLowerCase();
  const isInsufficientMargin =
    rawCode.includes('insufficient_margin') ||
    rawCode.includes('insufficient_balance') ||
    lowerMsg.includes('insufficient_margin') ||
    lowerMsg.includes('insufficient margin') ||
    lowerMsg.includes('insufficient_balance') ||
    lowerMsg.includes('insufficient balance') ||
    lowerMsg.includes('required_additional_balance');

  let requiredAdditionalBalance: number | null = null;
  const directCandidates = [
    err?.requiredAdditionalBalance,
    err?.required_additional_balance,
    err?.upstreamContext?.required_additional_balance,
    err?.context?.required_additional_balance,
  ];
  for (const val of directCandidates) {
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) {
      requiredAdditionalBalance = +n.toFixed(4);
      break;
    }
  }

  if (requiredAdditionalBalance === null) {
    const match = message.match(/required_additional_balance["']?\s*[:=]\s*["']?([0-9]+(?:\.[0-9]+)?)/i);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        requiredAdditionalBalance = +parsed.toFixed(4);
      }
    }
  }

  const errorCode = isInsufficientMargin
    ? 'insufficient_margin'
    : rawCode || 'exchange_rejected';

  return {
    isInsufficientMargin,
    errorCode,
    requiredAdditionalBalance,
    message,
  };
}

/**
 * Evaluates whether auto-rescue is latched/paused for a given `${symbol}_${entryPrice}_${side}` position.
 * - EXECUTED / FALLBACK_DERISK_EXECUTED: permanently latched for that position (single adjustment).
 * - BLOCKED: paused for at least 15 minutes, UNLESS wallet available balance increased above
 *   `availableBalanceAtBlock + requiredAdditionalBalance` (margin recovery).
 */
export function evaluateRescueCircuitBreaker(params: {
  entry?: RescueCircuitBreakerEntry | null;
  currentAvailableBalance: number;
  now?: number;
}): {
  isBlocked: boolean;
  reason: string | null;
  remainingMs: number;
  unlockedByMarginRecovery: boolean;
} {
  const { entry, currentAvailableBalance } = params;
  const now = params.now ?? Date.now();
  if (!entry) {
    return {
      isBlocked: false,
      reason: null,
      remainingMs: 0,
      unlockedByMarginRecovery: false,
    };
  }

  if (entry.status === 'EXECUTED' || entry.status === 'FALLBACK_DERISK_EXECUTED') {
    return {
      isBlocked: true,
      reason: entry.reason || 'Rescue already executed for this position (1/1 lock).',
      remainingMs: Number.POSITIVE_INFINITY,
      unlockedByMarginRecovery: false,
    };
  }

  const safeAvail = Number.isFinite(currentAvailableBalance) ? currentAvailableBalance : 0;
  if (
    entry.requiredAdditionalBalance !== null &&
    entry.requiredAdditionalBalance > 0
  ) {
    const unlockTarget =
      entry.targetAvailableBalanceToUnlock !== null && entry.targetAvailableBalanceToUnlock > 0
        ? entry.targetAvailableBalanceToUnlock
        : entry.availableBalanceAtBlock + entry.requiredAdditionalBalance;
    if (safeAvail >= unlockTarget && safeAvail > entry.availableBalanceAtBlock) {
      return {
        isBlocked: false,
        reason: null,
        remainingMs: 0,
        unlockedByMarginRecovery: true,
      };
    }
  }

  if (now < entry.cooldownUntil) {
    return {
      isBlocked: true,
      reason: entry.reason,
      remainingMs: Math.max(0, entry.cooldownUntil - now),
      unlockedByMarginRecovery: false,
    };
  }

  return {
    isBlocked: false,
    reason: null,
    remainingMs: 0,
    unlockedByMarginRecovery: false,
  };
}

/**
 * Pre-check margin requirement for a Drawdown Rescue action before hitting the exchange.
 * Computes estimated required margin and whether a $0-margin `reduce_only: true` 50% partial close fallback is viable.
 */
export function estimateRescueActionRequiredMarginUsd(params: {
  actionType: PerpetualRescueActionType;
  recommendation: PerpetualRescueRecommendation;
  leverage: number;
}): {
  requiredMarginUsd: number;
  estimatedReleasedMarginUsd: number;
  netAdditionalMarginNeededUsd: number;
  canFallbackToReduceOnly50: boolean;
  fallbackCloseContracts: number;
  fallbackCloseSizeCoin: number;
} {
  const { actionType, recommendation } = params;
  const lev = Math.max(1, Number(params.leverage) || 10);
  const contractVal = recommendation.contractValue || 0.001;
  const contracts = Math.max(1, Math.round(recommendation.contracts || 1));

  // 50% partial close requires at least 2 contracts so we reduce 50% (not 100%)
  const canFallbackToReduceOnly50 = contracts >= 2;
  const fallbackCloseContracts = canFallbackToReduceOnly50 ? Math.max(1, Math.floor(contracts * 0.5)) : 0;
  const fallbackCloseSizeCoin = +(fallbackCloseContracts * contractVal).toFixed(6);

  if (actionType === 'DE_RISK_REANCHOR') {
    const plan = recommendation.projectedDeRiskReAnchor;
    // Step 1 (reduce_only 50% close) releases ~50% of current position margin
    const released = +(((plan.closeSizeCoin * recommendation.entryPrice) / lev) * 0.85).toFixed(2);
    const reAnchorNotional = plan.reAnchorContracts * contractVal * plan.reAnchorPrice;
    const step2Required = +((reAnchorNotional / lev) * 1.08).toFixed(2);
    const netAdditional = +Math.max(0, step2Required - released).toFixed(2);
    return {
      requiredMarginUsd: step2Required,
      estimatedReleasedMarginUsd: released,
      netAdditionalMarginNeededUsd: netAdditional,
      canFallbackToReduceOnly50,
      fallbackCloseContracts,
      fallbackCloseSizeCoin,
    };
  }

  if (actionType === 'OPTIONS_HEDGE_OVERLAY') {
    const hedgePlan = recommendation.projectedOptionsHedge;
    const underlyingNotional = hedgePlan.matchedContracts * contractVal * recommendation.markPrice;
    const optionPrem = hedgePlan.optionQuote?.markPrice || 0;
    const creditUsd = hedgePlan.matchedContracts * contractVal * optionPrem;
    // Delta Exchange India short option initial margin (~10% of underlying notional or lev-adjusted floor)
    const effectiveOptLev = Math.max(1, Math.min(lev, 10));
    const required = +Math.max(underlyingNotional / effectiveOptLev, creditUsd * 1.5, 1).toFixed(2);
    return {
      requiredMarginUsd: required,
      estimatedReleasedMarginUsd: 0,
      netAdditionalMarginNeededUsd: required,
      canFallbackToReduceOnly50,
      fallbackCloseContracts,
      fallbackCloseSizeCoin,
    };
  }

  // TREND_FLIP_REVERSE
  const flipPlan = recommendation.projectedTrendFlip;
  const released = +(((recommendation.lotSize * recommendation.entryPrice) / lev) * 0.85).toFixed(2);
  const flipNotional = flipPlan.flipCoinSize * recommendation.markPrice;
  const flipRequired = +((flipNotional / lev) * 1.1).toFixed(2);
  const netAdditional = +Math.max(0, flipRequired - released).toFixed(2);
  return {
    requiredMarginUsd: flipRequired,
    estimatedReleasedMarginUsd: released,
    netAdditionalMarginNeededUsd: netAdditional,
    canFallbackToReduceOnly50,
    fallbackCloseContracts,
    fallbackCloseSizeCoin,
  };
}

/**
 * Deduplicates consecutive/repeated platform notifications within a 5-minute window.
 * Specifically normalizes volatile numeric balances on `Drawdown Rescue Blocked` / `insufficient_margin`
 * alerts so repeated margin rejections can never flood the notification drawer.
 */
export function shouldSuppressDuplicateNotification(params: {
  recentMap: Map<string, number>;
  title: string;
  message: string;
  type: string;
  now?: number;
  windowMs?: number;
}): boolean {
  const now = params.now ?? Date.now();
  const windowMs = params.windowMs ?? NOTIFICATION_DEDUP_WINDOW_MS;
  const normTitle = String(params.title || '').trim().toLowerCase();
  const normMsg = String(params.message || '').trim().toLowerCase();
  const normType = String(params.type || 'INFO').trim().toUpperCase();

  // Prune stale entries outside the deduplication window
  for (const [k, ts] of params.recentMap.entries()) {
    if (now - ts >= windowMs) {
      params.recentMap.delete(k);
    }
  }

  const isRescueBlockedOrMargin =
    normTitle.includes('drawdown rescue blocked') ||
    normTitle.includes('rescue blocked') ||
    normMsg.includes('insufficient_margin') ||
    normMsg.includes('insufficient margin') ||
    normMsg.includes('required_additional_balance');

  const key = isRescueBlockedOrMargin
    ? `${normType}|${normTitle}|${normMsg.replace(/[0-9]+(?:\.[0-9]+)?/g, '#')}`
    : `${normType}|${normTitle}|${normMsg}`;

  const lastTs = params.recentMap.get(key);
  if (typeof lastTs === 'number' && now - lastTs < windowMs) {
    return true;
  }

  params.recentMap.set(key, now);
  return false;
}

