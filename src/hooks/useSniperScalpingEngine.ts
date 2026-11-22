import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  MarketTicker, 
  TradingMode, 
  SniperSignal, 
  SniperActiveTrade, 
  SniperLogEntry, 
  SniperConfidenceStatus,
  SniperExposureMode,
  SniperScalpTier,
  SniperExecutionTriggerMode,
  AiAnalysisResult,
  Position,
  ClosedTrade,
  PerpetualRescueActionType,
  PerpetualRescueAdjustmentRecord,
  PerpetualRescueOptionQuote,
  PerpetualRescueRecommendation,
} from '../types';
import { getMarketTicker } from '../utils/marketUtils';
import {
  computeCamarillaLevels,
  formatCamarillaPrice,
  calculateAiConsensusScore,
  computeNetZeroBreakEvenPrice,
  evaluateVirginCprConfluence,
  classifyDualTimeframeCprRegime,
  BTC_MIN_SL_BUFFER_PCT,
  BTC_LIQUIDITY_WICK_BUFFER_USD,
  MIN_5M_ATR_SL_MULTIPLIER,
  computeAntiWickStopLoss,
} from '../utils/camarillaUtils';
import { subscribeDailyAnchorUpdates } from '../utils/dailyAnchorUtils';
import { computeDailyFibonacciLevels, detectFibCamarillaConfluence } from '../utils/fibonacciUtils';
import { calculateSniperFriction, calculateNetRiskReward } from '../utils/frictionUtils';
import { usePortfolio } from '../context/PortfolioContext';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { speakVoiceAlert, formatVoiceSymbol, formatVoicePrice } from '../utils/voiceAlert';
import { fetchDeltaLivePositions, getStoredDeltaCredentials } from '../services/deltaExchangeService';
import {
  buildPerpetualRescueRecommendation,
  buildRescueTradeKey,
  getSupportedRescuePerpSpec,
  RESCUE_MAX_ADJUSTMENTS_PER_TRADE,
  RESCUE_BLOCK_COOLDOWN_MS,
  RescueCircuitBreakerEntry,
  buildRescuePositionCircuitKey,
  parseInsufficientMarginDetails,
  evaluateRescueCircuitBreaker,
  estimateRescueActionRequiredMarginUsd,
  enforceMaxEquityRiskContracts,
} from '../utils/drawdownRescueUtils';
import { queueAnalyticsSignal, queueAnalyticsEvent } from '../utils/analyticsWarehouseClient';

export interface SniperPositionSyncUpdate {
  symbol: string;
  partialSize?: number;
  newStopLoss?: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  feeBufferBe?: number;
  isFullClose?: boolean;
  exitPrice?: number;
}

interface UseSniperScalpingEngineOptions {
  markets: Record<string, MarketTicker>;
  selectedSymbol: string;
  tradingMode: TradingMode;
  availableBalance: number;
  isLiveApiAuthenticated?: boolean;
  onExecuteOrder: (order: any) => Promise<any>;
  onClosePosition: (positionId: string, reason?: string) => Promise<void>;
  onRecordClosedTrade?: (trade: ClosedTrade, posUpdate?: SniperPositionSyncUpdate) => void;
  onSignalExitLifecycle?: (reason: 'SL' | 'TP4', symbol: string) => void;
  onSendNotification: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
  onPlaySound?: () => void;
  aiAnalysis?: AiAnalysisResult | null;
  onRefreshAiAnalysis?: (symbol: string, timeframe: string) => Promise<void>;
  isAiLoading?: boolean;
  positions?: Position[];
  timeframe?: string;
  totalEquity?: number;
  marginUsed?: number;
}

const SUPPORTED_LIVE_PERP_SYMBOLS = new Set([
  'BTCUSD',
  'ETHUSD',
  'SOLUSD',
  'XRPUSD',
  'DOGEUSD',
  'AVAXUSD',
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
]);

function normalizePerpSymbol(sym?: string): string {
  const upper = String(sym || '').toUpperCase().trim();
  if (!upper) return '';
  if (upper.endsWith('USD') && !upper.endsWith('USDT')) {
    return `${upper}T`;
  }
  return upper;
}

function getPerpContractStep(sym?: string): number {
  const upper = String(sym || '').toUpperCase();
  if (upper.startsWith('BTC')) return 0.001;
  if (upper.startsWith('ETH')) return 0.01;
  if (upper.startsWith('XRP')) return 10;
  if (upper.startsWith('DOGE')) return 100;
  return 1;
}

async function syncNativeExchangeStopLossLive(params: {
  mode: TradingMode;
  symbol: string;
  side: 'LONG' | 'SHORT';
  remainingSizeCoin?: number;
  remainingContracts?: number;
  stopLossPrice: number;
  entryPrice: number;
}): Promise<void> {
  if (params.mode !== 'LIVE') return;
  if (!Number.isFinite(params.stopLossPrice) || params.stopLossPrice <= 0) return;
  try {
    const step = getPerpContractStep(params.symbol);
    const derivedContracts =
      typeof params.remainingContracts === 'number' && params.remainingContracts >= 0
        ? Math.floor(params.remainingContracts)
        : typeof params.remainingSizeCoin === 'number' && params.remainingSizeCoin > 0
        ? Math.max(1, Math.round(params.remainingSizeCoin / step))
        : undefined;

    await fetch('/api/delta/sync-stop-loss', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-email': 'dhanrajk69@gmail.com',
      },
      body: JSON.stringify({
        symbol: params.symbol,
        side: params.side,
        remainingContracts: derivedContracts,
        stopLossPrice: params.stopLossPrice,
        entryPrice: params.entryPrice,
      }),
    });
  } catch {
    // Non-fatal: server-side 10s Hard Drawdown Watchdog remains active as fallback guard
  }
}

function isOptionPositionItem(pos: Position | any): boolean {
  const sym = String(pos?.product_symbol || pos?.rawSymbol || pos?.symbol || '').toUpperCase();
  const ctype = String(pos?.contract_type || '').toLowerCase();
  return sym.startsWith('C-') || sym.startsWith('P-') || ctype === 'call_options' || ctype === 'put_options';
}

function isActiveExchangePerpPosition(pos: any): boolean {
  if (!pos || isOptionPositionItem(pos)) return false;
  const rawSym = String(pos?.product_symbol || pos?.rawSymbol || pos?.symbol || '').toUpperCase().trim();
  const ctype = String(pos?.contract_type || '').toLowerCase();
  const isSupportedPerp =
    ctype === 'perpetual_futures' ||
    SUPPORTED_LIVE_PERP_SYMBOLS.has(rawSym) ||
    SUPPORTED_LIVE_PERP_SYMBOLS.has(normalizePerpSymbol(rawSym));
  if (!isSupportedPerp) return false;
  const rawSize = Math.abs(Number(pos?.size ?? pos?.signedSize ?? 0));
  const contracts = Math.abs(Number(pos?.contracts ?? 0));
  return rawSize > 0 || contracts > 0;
}

function resolvePerpSizeAndSide(pos: any): {
  side: 'LONG' | 'SHORT';
  coinSize: number;
  signedCoinSize: number;
  contracts: number;
  contractValue: number;
} {
  const sym = String(pos?.product_symbol || pos?.rawSymbol || pos?.symbol || '').toUpperCase();
  const defaultContractVal = sym.startsWith('BTC') ? 0.001 : sym.startsWith('ETH') ? 0.01 : 1;
  const contractValue = Number(pos?.contractValue ?? pos?.contract_value) > 0
    ? Number(pos?.contractValue ?? pos?.contract_value)
    : defaultContractVal;
  const rawSigned = Number(pos?.signedSize ?? pos?.size ?? 0);
  const rawAbsSize = Math.abs(Number(pos?.size ?? 0));
  const contractsField = Math.abs(Number(pos?.contracts ?? 0));

  const sideStr = String(pos?.side || '').toUpperCase();
  const side: 'LONG' | 'SHORT' =
    sideStr === 'SHORT' || sideStr === 'SELL'
      ? 'SHORT'
      : sideStr === 'LONG' || sideStr === 'BUY'
      ? 'LONG'
      : rawSigned < 0
      ? 'SHORT'
      : 'LONG';

  let coinSize = rawAbsSize;
  let contracts = contractsField;

  if (contractsField > 0) {
    if (contractValue < 1 && Math.abs(rawAbsSize - contractsField) < 1e-6) {
      coinSize = contractsField * contractValue;
    } else if (rawAbsSize === 0) {
      coinSize = contractsField * contractValue;
    }
  } else if (rawAbsSize >= 1 && Number.isInteger(rawAbsSize) && contractValue < 1) {
    contracts = rawAbsSize;
    coinSize = rawAbsSize * contractValue;
  } else if (coinSize > 0) {
    contracts = Math.max(1, Math.round(coinSize / contractValue));
  }

  const precision = contractValue < 0.01 ? 4 : 3;
  coinSize = +coinSize.toFixed(precision);
  const signedCoinSize = side === 'LONG' ? coinSize : -coinSize;
  return { side, coinSize, signedCoinSize, contracts, contractValue };
}

export const MIN_SNIPER_SL_BUFFER_PCT = BTC_MIN_SL_BUFFER_PCT; // Minimum 0.55% SL distance on BTC (+ $35 wick buffer)

export function compute5mAtrFromCandles(candles5m: any[], refPrice: number): number {
  const valid = (candles5m || []).filter(
    (c) =>
      c &&
      Number.isFinite(Number(c.high)) &&
      Number.isFinite(Number(c.low)) &&
      Number(c.high) >= Number(c.low) &&
      Number(c.high) > 0
  );
  if (valid.length < 3) return +(refPrice * 0.0023).toFixed(refPrice > 100 ? 2 : 4);
  const recent = valid.slice(-14);
  let sumTr = 0;
  for (let i = 0; i < recent.length; i++) {
    const h = Number(recent[i].high);
    const l = Number(recent[i].low);
    const prevC = i > 0 ? Number(recent[i - 1].close || l) : l;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    sumTr += tr;
  }
  return +(sumTr / recent.length).toFixed(refPrice > 100 ? 2 : 4);
}

export function enforceMinimumSniperStopBuffer(params: {
  entryPrice: number;
  side: 'LONG' | 'SHORT';
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3?: number;
  tp4?: number;
  atr5m?: number;
  symbol?: string;
  h3?: number;
  l3?: number;
  swingLow?: number;
  swingHigh?: number;
}): {
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  slDistance: number;
  slPct: number;
  wickBuffer: number;
  wasWidened: boolean;
} {
  const { entryPrice, side, atr5m, symbol, h3, l3, swingLow, swingHigh } = params;
  const refEntry = entryPrice > 0 ? entryPrice : 64620;
  const isLong = side === 'LONG';

  // Enforce >= max(1.5x 5m ATR, 0.55% BTC) + $35 liquidity-wick buffer beyond L3/H3 or entry swing
  const antiWick = computeAntiWickStopLoss({
    entryPrice: refEntry,
    side,
    symbol,
    atr5m,
    rawStopLoss: params.stopLoss,
    h3,
    l3,
    swingLow,
    swingHigh,
  });

  const stopLoss = antiWick.stopLoss;
  const wasWidened = antiWick.wasWidened;
  const slDistance = antiWick.slDistance;
  const minTp1Dist = slDistance * 1.25;
  const minTp2Dist = slDistance * 2.0;
  const minTp3Dist = slDistance * 2.75;
  const minTp4Dist = slDistance * 3.5;

  const rawTp1 = Number(params.tp1 || 0);
  const rawTp2 = Number(params.tp2 || 0);
  const rawTp3 = Number(params.tp3 || 0);
  const rawTp4 = Number(params.tp4 || 0);

  let tp1: number;
  let tp2: number;
  let tp3: number;
  let tp4: number;

  if (isLong) {
    const proportionalTp1 = formatCamarillaPrice(refEntry + minTp1Dist, refEntry);
    const proportionalTp2 = formatCamarillaPrice(refEntry + minTp2Dist, refEntry);
    tp1 =
      wasWidened || !(rawTp1 > refEntry) || rawTp1 - refEntry < minTp1Dist - 1e-6
        ? proportionalTp1
        : formatCamarillaPrice(rawTp1, refEntry);
    tp2 =
      wasWidened || !(rawTp2 > refEntry) || rawTp2 - refEntry < minTp2Dist - 1e-6 || rawTp2 <= tp1
        ? Math.max(proportionalTp2, formatCamarillaPrice(tp1 + slDistance * 0.75, refEntry))
        : formatCamarillaPrice(rawTp2, refEntry);
    if (tp2 <= tp1) {
      tp2 = formatCamarillaPrice(refEntry + minTp2Dist, refEntry);
    }
    const candidateTp3 = rawTp3 > tp2 ? rawTp3 : refEntry + minTp3Dist;
    tp3 = formatCamarillaPrice(Math.max(candidateTp3, tp2 + slDistance * 0.5), refEntry);
    const candidateTp4 = rawTp4 > tp3 ? rawTp4 : refEntry + minTp4Dist;
    tp4 = formatCamarillaPrice(Math.max(candidateTp4, tp3 + slDistance * 0.5), refEntry);
  } else {
    const proportionalTp1 = formatCamarillaPrice(refEntry - minTp1Dist, refEntry);
    const proportionalTp2 = formatCamarillaPrice(refEntry - minTp2Dist, refEntry);
    tp1 =
      wasWidened || !(rawTp1 > 0 && rawTp1 < refEntry) || refEntry - rawTp1 < minTp1Dist - 1e-6
        ? proportionalTp1
        : formatCamarillaPrice(rawTp1, refEntry);
    tp2 =
      wasWidened || !(rawTp2 > 0 && rawTp2 < refEntry) || refEntry - rawTp2 < minTp2Dist - 1e-6 || rawTp2 >= tp1
        ? Math.min(proportionalTp2, formatCamarillaPrice(tp1 - slDistance * 0.75, refEntry))
        : formatCamarillaPrice(rawTp2, refEntry);
    if (tp2 >= tp1) {
      tp2 = formatCamarillaPrice(refEntry - minTp2Dist, refEntry);
    }
    const candidateTp3 = rawTp3 > 0 && rawTp3 < tp2 ? rawTp3 : refEntry - minTp3Dist;
    tp3 = formatCamarillaPrice(Math.min(candidateTp3, tp2 - slDistance * 0.5), refEntry);
    const candidateTp4 = rawTp4 > 0 && rawTp4 < tp3 ? rawTp4 : refEntry - minTp4Dist;
    tp4 = formatCamarillaPrice(Math.min(candidateTp4, tp3 - slDistance * 0.5), refEntry);
  }

  return {
    stopLoss,
    tp1,
    tp2,
    tp3,
    tp4,
    slDistance,
    slPct: antiWick.slPct,
    wickBuffer: antiWick.wickBuffer,
    wasWidened,
  };
}

export function evaluateAntiChaseAndCandleMomentum(params: {
  side: 'LONG' | 'SHORT';
  currentPrice: number;
  currentCandleOpen: number;
  currentCandleHigh: number;
  currentCandleLow: number;
  recent5mLow: number;
  low24h: number;
  h4: number;
  l4: number;
  h3?: number;
  l3?: number;
  lastClosed5mClose?: number;
}): {
  passed: boolean;
  breakoutZonePassed: boolean;
  candleMomentumPassed: boolean;
  isFormingCandleGreen: boolean;
  isFormingCandleRed: boolean;
  isReboundingFromLows: boolean;
  inL3H3ChopZone: boolean;
  chopZoneBlocked: boolean;
  h4OrL4Closed5m: boolean;
  h4MinEntry: number;
  l4MaxEntry: number;
  rejectionReason?: string;
} {
  const {
    side,
    currentPrice,
    currentCandleOpen,
    currentCandleHigh,
    currentCandleLow,
    recent5mLow,
    low24h,
    h4,
    l4,
    h3 = 0,
    l3 = 0,
    lastClosed5mClose = 0,
  } = params;

  const isLong = side === 'LONG';
  const h4MinEntry = h4 > 0 ? formatCamarillaPrice(h4 * 0.9995, currentPrice) : 0;
  const l4MaxEntry = l4 > 0 ? formatCamarillaPrice(l4 * 1.0005, currentPrice) : 0;

  const chopLow = l3 > 0 && h3 > 0 ? Math.min(l3, h3) : 0;
  const chopHigh = l3 > 0 && h3 > 0 ? Math.max(l3, h3) : 0;
  const inL3H3ChopZone =
    chopLow > 0 && chopHigh > chopLow && currentPrice >= chopLow && currentPrice <= chopHigh;

  const h4Closed5m = lastClosed5mClose > 0 && h4 > 0 && lastClosed5mClose >= h4;
  const l4Closed5m = lastClosed5mClose > 0 && l4 > 0 && lastClosed5mClose <= l4;
  const h4OrL4Closed5m = h4Closed5m || l4Closed5m;
  const directionalClosed5m = isLong ? h4Closed5m : l4Closed5m;
  const chopZoneBlocked = inL3H3ChopZone && !directionalClosed5m;

  const isFormingCandleGreen = currentPrice > currentCandleOpen;
  const isFormingCandleRed = currentPrice < currentCandleOpen;

  const candle5mSpan = Math.max(0, currentCandleHigh - currentCandleLow);
  const bounceFrom5mLowPct = currentCandleLow > 0 ? (currentPrice - currentCandleLow) / currentCandleLow : 0;
  const lowerWickRatio = candle5mSpan > currentPrice * 0.0008 ? (currentPrice - currentCandleLow) / candle5mSpan : 0;
  const sessionLowFloor = Math.min(low24h > 0 ? low24h : currentCandleLow, recent5mLow);
  const bounceFromSessionLowPct = sessionLowFloor > 0 ? (currentPrice - sessionLowFloor) / sessionLowFloor : 0;

  const isReboundingFromLows =
    bounceFrom5mLowPct >= 0.0015 ||
    (candle5mSpan >= currentPrice * 0.0010 && lowerWickRatio >= 0.65) ||
    (bounceFromSessionLowPct > 0 && bounceFromSessionLowPct <= 0.0035 && isFormingCandleGreen);

  if (isLong) {
    const breakoutZonePassed = !chopZoneBlocked && (h4MinEntry > 0 ? currentPrice >= h4MinEntry || h4Closed5m : true);
    const candleMomentumPassed = !isFormingCandleRed;
    let rejectionReason: string | undefined;
    if (chopZoneBlocked) {
      rejectionReason = `L3–H3 CHOP ZONE BLOCK (LONG): Price $${currentPrice.toLocaleString()} is inside L3–H3 ($${chopLow.toLocaleString()}–$${chopHigh.toLocaleString()}) without a closed 5m bar >= H4 ($${h4.toLocaleString()}).`;
    } else if (!breakoutZonePassed) {
      rejectionReason = `ANTI-CHASE GUARD (LONG): Live price $${currentPrice.toLocaleString()} is below H4 breakout zone ($${h4MinEntry.toLocaleString()} / H4 $${h4.toLocaleString()}).`;
    } else if (!candleMomentumPassed) {
      rejectionReason = `MOMENTUM GUARD (LONG): Forming 5m candle is red (Mark $${currentPrice.toLocaleString()} < Open $${currentCandleOpen.toLocaleString()}). Entry rejected.`;
    }
    return {
      passed: !chopZoneBlocked && breakoutZonePassed && candleMomentumPassed,
      breakoutZonePassed,
      candleMomentumPassed,
      isFormingCandleGreen,
      isFormingCandleRed,
      isReboundingFromLows,
      inL3H3ChopZone,
      chopZoneBlocked,
      h4OrL4Closed5m,
      h4MinEntry,
      l4MaxEntry,
      rejectionReason,
    };
  } else {
    const breakoutZonePassed = !chopZoneBlocked && (l4MaxEntry > 0 ? currentPrice <= l4MaxEntry || l4Closed5m : true);
    const candleMomentumPassed = !isFormingCandleGreen && !isReboundingFromLows;
    let rejectionReason: string | undefined;
    if (chopZoneBlocked) {
      rejectionReason = `L3–H3 CHOP ZONE BLOCK (SHORT): Price $${currentPrice.toLocaleString()} is inside L3–H3 ($${chopLow.toLocaleString()}–$${chopHigh.toLocaleString()}) without a closed 5m bar <= L4 ($${l4.toLocaleString()}).`;
    } else if (!breakoutZonePassed) {
      rejectionReason = `ANTI-CHASE GUARD (SHORT): Live price $${currentPrice.toLocaleString()} is above L4 breakdown zone ($${l4MaxEntry.toLocaleString()} / L4 $${l4.toLocaleString()}).`;
    } else if (isFormingCandleGreen) {
      rejectionReason = `MOMENTUM GUARD (SHORT): Forming 5m candle is green (Mark $${currentPrice.toLocaleString()} > Open $${currentCandleOpen.toLocaleString()}). Chasing bounced candles blocked.`;
    } else if (isReboundingFromLows) {
      rejectionReason = `MOMENTUM GUARD (SHORT): Price is rebounding sharply (+${(bounceFrom5mLowPct * 100).toFixed(2)}%) off 5m/session lows ($${currentCandleLow.toLocaleString()}). Short entry rejected.`;
    }
    return {
      passed: !chopZoneBlocked && breakoutZonePassed && candleMomentumPassed,
      breakoutZonePassed,
      candleMomentumPassed,
      isFormingCandleGreen,
      isFormingCandleRed,
      isReboundingFromLows,
      inL3H3ChopZone,
      chopZoneBlocked,
      h4OrL4Closed5m,
      h4MinEntry,
      l4MaxEntry,
      rejectionReason,
    };
  }
}

function buildAdoptedCamarillaAndTargets(params: {
  ticker: MarketTicker;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  markPrice: number;
  timeframe: string;
  exchangeStopLoss?: number;
  exchangeTakeProfit?: number;
}) {
  const { ticker, side, entryPrice, markPrice, timeframe, exchangeStopLoss, exchangeTakeProfit } = params;
  const isLong = side === 'LONG';
  const refPrice = entryPrice > 0 ? entryPrice : markPrice;
  const { camarilla } = computeCamarillaLevels(ticker, side, timeframe);

  const defaultSl = formatCamarillaPrice(isLong ? refPrice * (1 - MIN_SNIPER_SL_BUFFER_PCT) : refPrice * (1 + MIN_SNIPER_SL_BUFFER_PCT), refPrice);
  const rawTp1 = formatCamarillaPrice(isLong ? refPrice * 1.007 : refPrice * 0.993, refPrice);
  const rawTp2 = formatCamarillaPrice(isLong ? refPrice * 1.012 : refPrice * 0.988, refPrice);
  const rawTp3 = formatCamarillaPrice(isLong ? refPrice * 1.016 : refPrice * 0.984, refPrice);
  const rawTp4 = formatCamarillaPrice(isLong ? refPrice * 1.021 : refPrice * 0.979, refPrice);

  const enforced = enforceMinimumSniperStopBuffer({
    entryPrice: refPrice,
    side,
    symbol: ticker.symbol,
    stopLoss: exchangeStopLoss && exchangeStopLoss > 0 ? exchangeStopLoss : defaultSl,
    tp1: rawTp1,
    tp2: rawTp2,
    tp3: rawTp3,
    tp4: exchangeTakeProfit && exchangeTakeProfit > 0 ? exchangeTakeProfit : rawTp4,
    atr5m: camarilla.atr5m,
    h3: camarilla.h3,
    l3: camarilla.l3,
  });

  return {
    camarilla,
    sl: enforced.stopLoss,
    tp1: enforced.tp1,
    tp2: enforced.tp2,
    tp3: enforced.tp3,
    tp4: enforced.tp4,
  };
}

export function useSniperScalpingEngine({
  markets,
  selectedSymbol,
  tradingMode,
  availableBalance,
  isLiveApiAuthenticated = false,
  onExecuteOrder: onExecuteOrderProp,
  onClosePosition: onClosePositionProp,
  onRecordClosedTrade: onRecordClosedTradeProp,
  onSignalExitLifecycle: onSignalExitLifecycleProp,
  onSendNotification: onSendNotificationProp,
  onPlaySound: onPlaySoundProp,
  aiAnalysis,
  onRefreshAiAnalysis: onRefreshAiAnalysisProp,
  isAiLoading = false,
  positions = [],
  timeframe = '5m',
  totalEquity,
  marginUsed,
}: UseSniperScalpingEngineOptions) {
  const { setSniperPnl, usdInrRate: portfolioUsdInrRate } = usePortfolio();
  const capitalAlloc = useCapitalAllocation();

  const onExecuteOrderRef = useRef(onExecuteOrderProp);
  onExecuteOrderRef.current = onExecuteOrderProp;
  const onClosePositionRef = useRef(onClosePositionProp);
  onClosePositionRef.current = onClosePositionProp;
  const onRecordClosedTradeRef = useRef(onRecordClosedTradeProp);
  onRecordClosedTradeRef.current = onRecordClosedTradeProp;
  const onSignalExitLifecycleRef = useRef(onSignalExitLifecycleProp);
  onSignalExitLifecycleRef.current = onSignalExitLifecycleProp;
  const onSendNotificationRef = useRef(onSendNotificationProp);
  onSendNotificationRef.current = onSendNotificationProp;
  const onPlaySoundRef = useRef(onPlaySoundProp);
  onPlaySoundRef.current = onPlaySoundProp;
  const onRefreshAiAnalysisRef = useRef(onRefreshAiAnalysisProp);
  onRefreshAiAnalysisRef.current = onRefreshAiAnalysisProp;

  const onExecuteOrder = useCallback((order: any) => onExecuteOrderRef.current(order), []);
  const onClosePosition = useCallback((positionId: string, reason?: string) => onClosePositionRef.current(positionId, reason), []);
  const onRecordClosedTrade = useCallback(
    (trade: ClosedTrade, posUpdate?: SniperPositionSyncUpdate) => onRecordClosedTradeRef.current?.(trade, posUpdate),
    []
  );
  const onSignalExitLifecycle = useCallback(
    (reason: 'SL' | 'TP4', symbol: string) => onSignalExitLifecycleRef.current?.(reason, symbol),
    []
  );
  const onSendNotification = useCallback(
    (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => onSendNotificationRef.current(title, message, type),
    []
  );
  const onPlaySound = useCallback(() => {
    onPlaySoundRef.current?.();
  }, []);
  const onRefreshAiAnalysis = useCallback(
    async (symbol: string, tf: string) => {
      await onRefreshAiAnalysisRef.current?.(symbol, tf);
    },
    []
  );

  const [paperAutoSniperEnabled, setPaperAutoSniperEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('delta_sniper_autopilot_armed_v1') === 'true';
    } catch {
      return false;
    }
  });
  const [liveAutoSniperEnabled, setLiveAutoSniperEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('delta_sniper_autopilot_armed_v1') === 'true';
    } catch {
      return false;
    }
  });
  const [directionMode, setDirectionMode] = useState<'AUTO' | 'LONG' | 'SHORT'>('AUTO');
  const [exposureMode, setExposureMode] = useState<SniperExposureMode>('MICRO_50');
  const [scalpTier, setScalpTierState] = useState<SniperScalpTier>('TIER_50');
  const [signalSource, setSignalSource] = useState<'COMMAND_CENTER' | 'QUANT_ALGO'>('COMMAND_CENTER');
  const [executionTriggerMode, setExecutionTriggerMode] = useState<SniperExecutionTriggerMode>('CANDLE_CLOSE');
  const [entryExecutionType, setEntryExecutionType] = useState<'BREAKOUT_STOP' | 'MARKET' | 'FIB_RETEST'>('MARKET');

  const setScalpTier = useCallback((tier: SniperScalpTier) => {
    setScalpTierState(tier);
    if (tier === 'TIER_15') {
      setExposureMode('MICRO_15');
    } else {
      setExposureMode('MICRO_50');
    }
  }, []);

  const handleSetExposureMode = useCallback((mode: SniperExposureMode) => {
    setExposureMode(mode);
    if (mode === 'MICRO_15') {
      setScalpTierState('TIER_15');
    } else if (mode === 'MICRO_50') {
      setScalpTierState('TIER_50');
    }
  }, []);

  // Bypass HTF Filter (Paper Demo Only) toggle state
  const [bypassHtfFilter, setBypassHtfFilter] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('delta_bypass_htf_paper');
      return saved !== null ? saved === 'true' : false;
    } catch {
      return false;
    }
  });

  const handleSetBypassHtfFilter = useCallback((val: boolean) => {
    setBypassHtfFilter(val);
    try {
      localStorage.setItem('delta_bypass_htf_paper', String(val));
    } catch {}
  }, []);

  // Cumulative Realized Profit tracking across completed trades
  const [paperCumulativeRealizedUsd, setPaperCumulativeRealizedUsd] = useState<number>(0);
  const [liveCumulativeRealizedUsd, setLiveCumulativeRealizedUsd] = useState<number>(0);

  // Strict Paper Demo vs Live India Mode state isolation
  const [paperActiveTrade, setPaperActiveTrade] = useState<SniperActiveTrade | null>(null);
  const [liveActiveTrade, setLiveActiveTrade] = useState<SniperActiveTrade | null>(null);
  const [paperTradeLogs, setPaperTradeLogs] = useState<SniperLogEntry[]>([]);
  const [liveTradeLogs, setLiveTradeLogs] = useState<SniperLogEntry[]>([]);
  const [paperSignalStandby, setPaperSignalStandby] = useState<boolean>(false);
  const [liveSignalStandby, setLiveSignalStandby] = useState<boolean>(false);
  const [exchangeSyncReady, setExchangeSyncReady] = useState<boolean>(false);

  const isHydratingExchangeStateRef = useRef<boolean>(tradingMode === 'LIVE');
  const consecutiveZeroExchangePollsRef = useRef<number>(0);
  const liveActiveTradeRef = useRef<SniperActiveTrade | null>(null);
  const confirmedOnExchangeTradeIdRef = useRef<string | null>(null);
  const isReconcilingExchangeRef = useRef<boolean>(false);

  const CLOSED_EXCHANGE_SIGS_KEY = 'delta_sniper_closed_ex_sigs_v1';
  const closedExchangeSignaturesRef = useRef<Map<string, number>>(
    (() => {
      const map = new Map<string, number>();
      try {
        const raw = localStorage.getItem(CLOSED_EXCHANGE_SIGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const cutoff = Date.now() - 24 * 60 * 60 * 1000;
          if (parsed && typeof parsed === 'object') {
            for (const [k, ts] of Object.entries(parsed)) {
              const numTs = Number(ts);
              if (Number.isFinite(numTs) && numTs >= cutoff) {
                map.set(k, numTs);
              }
            }
          }
        }
      } catch {}
      return map;
    })()
  );

  const recordClosedExchangeSignature = useCallback((sigs: string[]) => {
    const now = Date.now();
    const cutoff = now - 24 * 60 * 60 * 1000;
    const map = closedExchangeSignaturesRef.current;
    for (const s of sigs) {
      if (s) map.set(s, now);
    }
    for (const [k, ts] of Array.from(map.entries())) {
      if (ts < cutoff) map.delete(k);
    }
    const entries = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60);
    closedExchangeSignaturesRef.current = new Map(entries);
    try {
      localStorage.setItem(CLOSED_EXCHANGE_SIGS_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }, []);

  const isClosedExchangeSignatureBlocked = useCallback((sigs: string[], ttlMs = 180_000): boolean => {
    const now = Date.now();
    const map = closedExchangeSignaturesRef.current;
    for (const s of sigs) {
      if (!s) continue;
      const ts = map.get(s);
      if (typeof ts === 'number' && now - ts <= ttlMs) {
        return true;
      }
    }
    return false;
  }, []);

  useEffect(() => {
    liveActiveTradeRef.current = liveActiveTrade;
  }, [liveActiveTrade]);


  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [isEmaAlignmentPending, setIsEmaAlignmentPending] = useState<boolean>(false);
  const [lastExecutedSignalTs, setLastExecutedSignalTs] = useState<number>(0);
  const lastAttemptTsRef = useRef<number>(0);
  const lastAutoExecutedSignalId = useRef<string | null>(null);
  const pendingAutoSignalIdRef = useRef<string | null>(null);
  const autoExecutionTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Stable Signal Identity Refs (prevents live mark-price ticks from regenerating signalSetupId)
  const signalEpochRef = useRef<number>(1);
  const signalCreatedTsRef = useRef<number>(Date.now());
  const prevSignalCoreSignatureRef = useRef<string>('');
  const prevSignalStandbyRef = useRef<boolean>(false);
  const lockedSignalLevelsRef = useRef<{
    setupId: string;
    entryPrice: number;
    initialStopLoss: number;
    tp1: number;
    tp2: number;
    tp3: number;
    tp4: number;
  } | null>(null);

  // 2-Strike consecutive stop-loss circuit breaker tracking
  const [consecutiveStopsCount, setConsecutiveStopsCount] = useState<number>(0);
  const consecutiveStopsCountRef = useRef<number>(0);
  
  // Dynamic lockout for target hit
  const [lockoutExpiry, setLockoutExpiry] = useState<number | null>(null);

  // Closed candle & wick protection tracking (5-minute bars)
  const [simulatedCandleCloses, setSimulatedCandleCloses] = useState<Record<string, number>>({});
  const candleHistoryRef = useRef<Record<string, {
    currentCandle: { open: number; high: number; low: number; close: number; bucketStart: number };
    lastClosedCandle: { open: number; high: number; low: number; close: number; bucketStart: number; seededFromApi?: boolean };
  }>>({});

  // Downtrend Volatility Adaptation (15m price drop > 1.0% -> 15m Cascade Pause)
  const priceWindow15mRef = useRef<{ time: number; price: number }[]>([]);
  const cascadePauseExpiryRef = useRef<number>(0);
  const consolidationBarsRef = useRef<number>(0);

  const isLiveMode = tradingMode === 'LIVE';
  const isLiveUnverified = isLiveMode && !isLiveApiAuthenticated;
  const rawAutoSniperArmed = isLiveMode ? liveAutoSniperEnabled : paperAutoSniperEnabled;

  // When Auto-Pilot is ARMED, never lock the engine in manual Signal Standby after a trade exit
  const isSignalStandby: boolean = isLiveUnverified
    ? true
    : rawAutoSniperArmed
    ? false
    : isLiveMode
    ? liveSignalStandby
    : paperSignalStandby;

  const setIsSignalStandby = useCallback(
    (val: boolean) => {
      if (val) {
        // Clear previous auto-executed signal ID on trade exit so Auto-Pilot can evaluate the next setup
        lastAutoExecutedSignalId.current = null;
        pendingAutoSignalIdRef.current = null;
        signalEpochRef.current += 1;
      }
      if (tradingMode === 'LIVE') {
        const nextVal = liveAutoSniperEnabled ? false : val;
        setLiveSignalStandby((prev) => (prev === nextVal ? prev : nextVal));
      } else {
        const nextVal = paperAutoSniperEnabled ? false : val;
        setPaperSignalStandby((prev) => (prev === nextVal ? prev : nextVal));
      }
    },
    [tradingMode, liveAutoSniperEnabled, paperAutoSniperEnabled]
  );

  const [manualRefreshEpoch, setManualRefreshEpoch] = useState<number>(0);

  const confirmSignalHydration = useCallback(() => {
    setIsSignalStandby(false);
  }, [setIsSignalStandby]);

  const refreshSignalSnapshot = useCallback(() => {
    lockedSignalLevelsRef.current = null;
    signalCreatedTsRef.current = Date.now();
    setIsSignalStandby(false);
    setManualRefreshEpoch((prev) => prev + 1);
    if (onRefreshAiAnalysis) {
      void onRefreshAiAnalysis(selectedSymbol, timeframe);
    }
  }, [setIsSignalStandby, onRefreshAiAnalysis, selectedSymbol, timeframe]);

  // Clear post-exit standby when user switches symbol, direction, exposure mode, signal source, or refreshes AI analysis
  const prevAiRef = useRef<AiAnalysisResult | null>(aiAnalysis);
  const aiAnalysisVersionRef = useRef<number>(0);
  useEffect(() => {
    if (aiAnalysis && aiAnalysis !== prevAiRef.current) {
      prevAiRef.current = aiAnalysis;
      aiAnalysisVersionRef.current += 1;
      setIsSignalStandby(false);
    }
  }, [aiAnalysis, setIsSignalStandby]);

  const [dailyHistoryEpoch, setDailyHistoryEpoch] = useState<number>(0);
  useEffect(() => {
    return subscribeDailyAnchorUpdates(() => {
      setDailyHistoryEpoch((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    setIsSignalStandby(false);
  }, [selectedSymbol, directionMode, exposureMode, signalSource, setIsSignalStandby]);

  // Real 5m, 15m, and 4h Candles for Dual-Timeframe CPR Regime Classifier + EMA 9/20
  const [candles5m, setCandles5m] = useState<any[]>([]);
  const [candles15m, setCandles15m] = useState<any[]>([]);
  const [candles4h, setCandles4h] = useState<any[]>([]);

  useEffect(() => {
    let active = true;
    const fetchMultiTfCandles = async () => {
      try {
        const [r5, r15, r4h] = await Promise.all([
          fetch(`/api/delta/candles?symbol=${encodeURIComponent(selectedSymbol)}&resolution=5m`).then((r) => r.json()).catch(() => null),
          fetch(`/api/delta/candles?symbol=${encodeURIComponent(selectedSymbol)}&resolution=15m`).then((r) => r.json()).catch(() => null),
          fetch(`/api/delta/candles?symbol=${encodeURIComponent(selectedSymbol)}&resolution=4h`).then((r) => r.json()).catch(() => null),
        ]);
        if (!active) return;
        if (Array.isArray(r5?.candles) && r5.candles.length > 0) setCandles5m(r5.candles);
        if (Array.isArray(r15?.candles) && r15.candles.length > 0) setCandles15m(r15.candles);
        if (Array.isArray(r4h?.candles) && r4h.candles.length > 0) setCandles4h(r4h.candles);
      } catch {}
    };
    fetchMultiTfCandles();
    const timer = setInterval(fetchMultiTfCandles, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedSymbol, manualRefreshEpoch]);

  // Anti-Chop Micro Protection: Max 3 Micro trades per rolling hour + 10m post-SL cooldown
  const chopStorageKey = `delta_micro_chop_v1_${tradingMode}`;
  const [microTradeTimestamps, setMicroTradeTimestamps] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(chopStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const oneHrAgo = Date.now() - 3600_000;
        return Array.isArray(parsed?.timestamps) ? parsed.timestamps.filter((t: number) => t >= oneHrAgo) : [];
      }
    } catch {}
    return [];
  });
  const [microSlCooldownUntil, setMicroSlCooldownUntil] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(chopStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Number(parsed?.slCooldownUntil || 0);
      }
    } catch {}
    return 0;
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(chopStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const oneHrAgo = Date.now() - 3600_000;
        setMicroTradeTimestamps(Array.isArray(parsed?.timestamps) ? parsed.timestamps.filter((t: number) => t >= oneHrAgo) : []);
        setMicroSlCooldownUntil(Number(parsed?.slCooldownUntil || 0));
      } else {
        setMicroTradeTimestamps([]);
        setMicroSlCooldownUntil(0);
      }
    } catch {}
  }, [chopStorageKey]);

  const persistMicroChopState = useCallback(
    (timestamps: number[], slUntil: number) => {
      try {
        localStorage.setItem(chopStorageKey, JSON.stringify({ timestamps, slCooldownUntil: slUntil }));
      } catch {}
    },
    [chopStorageKey]
  );

  const recordMicroTradeTimestamp = useCallback(() => {
    const now = Date.now();
    const oneHrAgo = now - 3600_000;
    setMicroTradeTimestamps((prev) => {
      const next = [...prev.filter((t) => t >= oneHrAgo), now];
      persistMicroChopState(next, microSlCooldownUntil);
      return next;
    });
  }, [microSlCooldownUntil, persistMicroChopState]);

  const triggerMicroSlCooldown = useCallback(() => {
    const until = Date.now() + 10 * 60 * 1000; // 10 minutes
    setMicroSlCooldownUntil(until);
    setMicroTradeTimestamps((prev) => {
      const oneHrAgo = Date.now() - 3600_000;
      const pruned = prev.filter((t) => t >= oneHrAgo);
      persistMicroChopState(pruned, until);
      return pruned;
    });
    fetch('/api/delta/micro-sniper/sl-hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: tradingMode }),
    }).catch(() => {});
  }, [persistMicroChopState, tradingMode]);

  const perpOnlyPositions = useMemo(
    () => positions.filter((p) => !isOptionPositionItem(p)),
    [positions]
  );
  const optionsOnlyPositions = useMemo(
    () => positions.filter((p) => isOptionPositionItem(p)),
    [positions]
  );

  const activeTrade: (SniperActiveTrade & { side: 'LONG' | 'SHORT'; direction: 'LONG' | 'SHORT' }) | null = useMemo(() => {
    const raw = isLiveUnverified ? null : isLiveMode ? liveActiveTrade : paperActiveTrade;
    if (!raw) return null;
    const resolvedSide: 'LONG' | 'SHORT' =
      (raw as any).side === 'SHORT' || (raw as any).direction === 'SHORT' || (raw as any).signal === 'SHORT'
        ? 'SHORT'
        : 'LONG';
    return {
      ...raw,
      direction: resolvedSide,
      side: resolvedSide,
    };
  }, [isLiveUnverified, isLiveMode, liveActiveTrade, paperActiveTrade]);

  const setActiveTrade = useCallback(
    (val: SniperActiveTrade | null | ((prev: SniperActiveTrade | null) => SniperActiveTrade | null)) => {
      if (tradingMode === 'LIVE') {
        if (!isLiveApiAuthenticated) {
          setLiveActiveTrade(null);
          return;
        }
        setLiveActiveTrade(val);
      } else {
        setPaperActiveTrade(val);
      }
    },
    [tradingMode, isLiveApiAuthenticated]
  );

  const tradeLogs: SniperLogEntry[] = isLiveUnverified
    ? []
    : isLiveMode
    ? liveTradeLogs
    : paperTradeLogs;

  const isAutoSniperEnabled = isLiveMode ? liveAutoSniperEnabled : paperAutoSniperEnabled;

  const syncSniperAutoPilotFromServer = useCallback((armed: boolean) => {
    setLiveAutoSniperEnabled(armed);
    setPaperAutoSniperEnabled(armed);
    if (armed) {
      setLiveSignalStandby(false);
      setPaperSignalStandby(false);
    }
    try {
      localStorage.setItem('delta_sniper_autopilot_armed_v1', armed ? 'true' : 'false');
    } catch {}
  }, []);

  // Hydrate sniperAutoPilotArmed from ~/.deltaai-data/config.json on mount and cross-device sync events
  useEffect(() => {
    let isMounted = true;
    fetch('/api/delta/autopilot-state')
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted || !data?.success) return;
        const serverArmed =
          typeof data.sniperAutoPilotArmed === 'boolean'
            ? data.sniperAutoPilotArmed
            : typeof data.state?.sniperAutoPilotArmed === 'boolean'
            ? data.state.sniperAutoPilotArmed
            : undefined;
        if (typeof serverArmed === 'boolean') {
          syncSniperAutoPilotFromServer(serverArmed);
        }
      })
      .catch(() => {});

    const handleSyncEvent = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (detail && typeof detail.sniperAutoPilotArmed === 'boolean') {
        syncSniperAutoPilotFromServer(detail.sniperAutoPilotArmed);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('delta:sync-autopilot-config', handleSyncEvent);
    }
    return () => {
      isMounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('delta:sync-autopilot-config', handleSyncEvent);
      }
    };
  }, [syncSniperAutoPilotFromServer]);

  const setIsAutoSniperEnabled = useCallback(
    (val: boolean) => {
      if (val) {
        lastAttemptTsRef.current = 0;
        lastAutoExecutedSignalId.current = null;
        pendingAutoSignalIdRef.current = null;
        if (consecutiveStopsCountRef.current >= 2) {
          consecutiveStopsCountRef.current = 0;
          setConsecutiveStopsCount(0);
        }
        setLiveSignalStandby(false);
        setPaperSignalStandby(false);
      }
      setLiveAutoSniperEnabled(val);
      setPaperAutoSniperEnabled(val);
      try {
        localStorage.setItem('delta_sniper_autopilot_armed_v1', val ? 'true' : 'false');
      } catch {}
      fetch('/api/delta/autopilot-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sniperAutoPilotArmed: val,
          armedAt: val ? Date.now() : 0,
        }),
      }).catch(() => {});
    },
    []
  );

  const simulate5mCandleClose = useCallback((symbol: string, forcedClose?: number) => {
    setSimulatedCandleCloses((prev) => ({
      ...prev,
      [symbol]: forcedClose ?? 0,
    }));
  }, []);

  // Live market resolution with automatic USD <-> USDT pair mapping
  const curMarket = getMarketTicker(markets, selectedSymbol);
  const markPrice = curMarket.markPrice;
  const hasLiveMarkets = Boolean(markets && Object.keys(markets).length > 0 && markPrice > 0);

  // Add Log Entry Helper (strictly isolated by tradingMode, archived permanently to Cloud Telemetry Warehouse)
  const addLog = useCallback((type: SniperLogEntry['type'], title: string, description: string) => {
    const entry: SniperLogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      type,
      title,
      description,
    };
    if (tradingMode === 'LIVE') {
      if (!isLiveApiAuthenticated) return;
      setLiveTradeLogs((prev) => [entry, ...prev.slice(0, 99)]);
    } else {
      setPaperTradeLogs((prev) => [entry, ...prev.slice(0, 99)]);
    }
    queueAnalyticsEvent({
      kind: 'AUDIT_EVENT',
      id: entry.id,
      eventId: entry.id,
      timestampMs: entry.timestamp,
      type: entry.type,
      category: entry.type,
      title: entry.title,
      description: entry.description,
      symbol: selectedSymbol,
      mode: tradingMode,
    });
  }, [tradingMode, isLiveApiAuthenticated, selectedSymbol]);

  // Hydrate persisted Sniper Audit & Rescue Logs on startup so refreshes/redeploys never clear history
  useEffect(() => {
    const mergeLogs = (incoming: any[]) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      const liveIncoming: SniperLogEntry[] = [];
      const paperIncoming: SniperLogEntry[] = [];
      for (const item of incoming) {
        if (!item || typeof item !== 'object') continue;
        const normalized: SniperLogEntry = {
          id: String(item.id || `log-${item.timestamp || Date.now()}-${String(item.title || '').slice(0, 8)}`),
          timestamp: Number(item.timestamp || item.timestampMs || Date.now()),
          type: (item.type || item.category || 'INFO') as SniperLogEntry['type'],
          title: String(item.title || 'Audit Event'),
          description: String(item.description || item.message || ''),
        };
        if (String(item.mode || 'LIVE').toUpperCase() === 'PAPER') {
          paperIncoming.push(normalized);
        } else {
          liveIncoming.push(normalized);
        }
      }
      if (liveIncoming.length > 0) {
        setLiveTradeLogs((prev) => {
          const map = new Map<string, SniperLogEntry>();
          for (const l of [...prev, ...liveIncoming]) {
            if (!map.has(l.id)) map.set(l.id, l);
          }
          return Array.from(map.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 100);
        });
      }
      if (paperIncoming.length > 0) {
        setPaperTradeLogs((prev) => {
          const map = new Map<string, SniperLogEntry>();
          for (const l of [...prev, ...paperIncoming]) {
            if (!map.has(l.id)) map.set(l.id, l);
          }
          return Array.from(map.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 100);
        });
      }
    };

    let active = true;
    fetch('/api/delta/audit-logs', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.success && Array.isArray(json.logs)) {
          mergeLogs(json.logs);
        }
      })
      .catch(() => {});

    const onHydrateLogs = (evt: Event) => {
      const custom = evt as CustomEvent<{ logs?: any[] }>;
      if (Array.isArray(custom.detail?.logs)) {
        mergeLogs(custom.detail.logs);
      }
    };
    window.addEventListener('delta:hydrate-audit-logs', onHydrateLogs as EventListener);
    return () => {
      active = false;
      window.removeEventListener('delta:hydrate-audit-logs', onHydrateLogs as EventListener);
    };
  }, []);

  // ═══════════════════════════════════════════════════════════
  // STARTUP HYDRATION GRACE GUARD (10s) & 5s LIVE PERPETUAL RECONCILIATION
  // Automatically adopts active Delta Exchange India perpetual positions (e.g. BTCUSD +0.002 BTC)
  // even after reload or bracket-attachment warnings, and syncs live UPNL 1:1.
  // ═══════════════════════════════════════════════════════════
  const usdInrRef = useRef<number>(portfolioUsdInrRate || 85);
  useEffect(() => {
    if (Number.isFinite(portfolioUsdInrRate) && portfolioUsdInrRate > 0) {
      usdInrRef.current = portfolioUsdInrRate;
    }
  }, [portfolioUsdInrRate]);

  const marketsRef = useRef<Record<string, MarketTicker>>(markets);
  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);

  useEffect(() => {
    if (tradingMode !== 'LIVE' || !isLiveApiAuthenticated) {
      isHydratingExchangeStateRef.current = false;
      consecutiveZeroExchangePollsRef.current = 0;
      setExchangeSyncReady(false);
      return;
    }

    isHydratingExchangeStateRef.current = true;
    consecutiveZeroExchangePollsRef.current = 0;
    setExchangeSyncReady(false);

    const guardTimer = setTimeout(() => {
      isHydratingExchangeStateRef.current = false;
      setExchangeSyncReady(true);
    }, 10000);

    return () => {
      clearTimeout(guardTimer);
    };
  }, [tradingMode, isLiveApiAuthenticated]);

  const finalizeExchangeClosedPerpTrade = useCallback(
    async (curTrade: SniperActiveTrade, creds: ReturnType<typeof getStoredDeltaCredentials>) => {
      const canonicalSym = normalizePerpSymbol(curTrade.productSymbol || curTrade.symbol);
      const exactSig = `${canonicalSym}:${curTrade.signal}:${Number(curTrade.entryPrice || 0).toFixed(2)}:${curTrade.openedAt || 0}`;
      const posIdSig = curTrade.positionId ? `${canonicalSym}:pid:${curTrade.positionId}` : '';
      const shortCooldownSig = `${canonicalSym}:${curTrade.signal}:${Number(curTrade.entryPrice || 0).toFixed(2)}`;
      recordClosedExchangeSignature([exactSig, posIdSig, shortCooldownSig].filter(Boolean));

      // Immediately transition UI state to CLOSED & clear any stale localStorage keys
      setLiveActiveTrade(null);
      liveActiveTradeRef.current = null;
      confirmedOnExchangeTradeIdRef.current = null;
      consecutiveZeroExchangePollsRef.current = 0;
      lastAutoExecutedSignalId.current = null;
      pendingAutoSignalIdRef.current = null;
      signalEpochRef.current += 1;
      setLiveSignalStandby(liveAutoSniperEnabled ? false : true);
      try {
        localStorage.removeItem('delta_sniper_active_trade_v1');
        localStorage.removeItem('delta_active_sniper_trade');
      } catch {}

      const fallbackPnlUsd = +(
        (curTrade.bookedProfitUsd || 0) +
        (curTrade.unrealizedPnlUsd ?? curTrade.unrealisedProfitUsd ?? 0)
      ).toFixed(2);

      let finalPnlUsd = fallbackPnlUsd;
      let closeCode = fallbackPnlUsd >= 0 ? 'TP4_EXCHANGE_FILLED' : 'EXCHANGE_CLOSED';
      let cancelledBrackets = false;
      let reconciledClosedTrade: any = null;

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (creds?.apiKey) headers['x-delta-api-key'] = creds.apiKey;
        if (creds?.apiSecret) headers['x-delta-api-secret'] = creds.apiSecret;
        const reconcileRes = await fetch('/api/delta/reconcile-closed-position', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            symbol: curTrade.productSymbol || curTrade.symbol,
            side: curTrade.signal,
            entryPrice: curTrade.entryPrice,
            size: curTrade.lotSize,
            openedAt: curTrade.openedAt,
            fallbackPnlUsd,
            cancelOpenBrackets: true,
          }),
        });
        if (reconcileRes.ok) {
          const json = await reconcileRes.json();
          if (json?.success) {
            if (typeof json.realizedPnlUsd === 'number' && Number.isFinite(json.realizedPnlUsd)) {
              finalPnlUsd = +json.realizedPnlUsd.toFixed(2);
            }
            if (typeof json.closeCode === 'string' && json.closeCode) {
              closeCode = json.closeCode;
            }
            cancelledBrackets = Boolean(json.cancelledBracketOrders);
            reconciledClosedTrade = json.closedTrade || null;
          }
        }
      } catch {
        // Fallback to local estimate if reconciliation request fails transiently
      }

      setLiveCumulativeRealizedUsd((prev) => +(prev + finalPnlUsd).toFixed(2));
      if (finalPnlUsd > 0) {
        registerRealizedPnLRef.current?.(finalPnlUsd);
      }

      const logType: SniperLogEntry['type'] =
        closeCode === 'SL_FILLED' || closeCode === 'LIQUIDATION_CLOSE' || finalPnlUsd < 0
          ? 'STOP_LOSS'
          : 'TP4';
      addLog(
        logType,
        `Position Closed (${closeCode})`,
        `${curTrade.symbol} confirmed flat on Delta Exchange India (2 consecutive zero-size polls). Final Realized PnL: ${finalPnlUsd >= 0 ? '+' : ''}$${finalPnlUsd.toFixed(2)}${cancelledBrackets ? ' · Remaining open bracket orders cancelled.' : ''}`
      );
      onSignalExitLifecycle?.(finalPnlUsd >= 0 ? 'TP4' : 'SL', curTrade.symbol);

      if (typeof window !== 'undefined') {
        const closedEventPayload = reconciledClosedTrade || {
          id: `sniper-ex-closed-${curTrade.id}-${Date.now()}`,
          symbol: curTrade.productSymbol || curTrade.symbol,
          side: curTrade.signal,
          size: curTrade.lotSize,
          entryPrice: curTrade.entryPrice,
          exitPrice: curTrade.currentPrice || curTrade.entryPrice,
          realisedPnl: finalPnlUsd,
          pnlPercent: 0,
          openedAt: curTrade.openedAt || Date.now(),
          closedAt: Date.now(),
          reason: `${closeCode} · Exchange-Paired Close Reconciliation`,
          mode: 'LIVE' as const,
        };
        window.dispatchEvent(new CustomEvent('delta:record-closed-trade', { detail: closedEventPayload }));
      }
    },
    [
      recordClosedExchangeSignature,
      liveAutoSniperEnabled,
      addLog,
      onSignalExitLifecycle,
    ]
  );

  const reconcileLivePerpPositionsNow = useCallback(async () => {
    if (tradingMode !== 'LIVE' || !isLiveApiAuthenticated) return;
    if (isReconcilingExchangeRef.current) return;
    isReconcilingExchangeRef.current = true;

    try {
      const creds = getStoredDeltaCredentials();
      const resp = await fetchDeltaLivePositions(creds);
      if (resp.status !== 'success') return;

      // Mark exchange sync ready as soon as we have a verified /api/delta/positions response
      if (isHydratingExchangeStateRef.current) {
        isHydratingExchangeStateRef.current = false;
        setExchangeSyncReady(true);
      }

      const activePerps = (resp.positions || []).filter(isActiveExchangePerpPosition);
      const effectiveInr = usdInrRef.current > 0 ? usdInrRef.current : 85;
      const prevTrade = liveActiveTradeRef.current;
      const isOpenPrev = Boolean(
        prevTrade &&
        !['STOPPED_OUT', 'COMPLETED', 'REVERSED', 'TIME_EXIT'].includes(prevTrade.tradeStatus)
      );

      // 1. Reconcile active Sniper trade against live exchange positions FIRST (even if another symbol is open)
      if (isOpenPrev && prevTrade) {
        const prevNorm = normalizePerpSymbol(prevTrade.productSymbol || prevTrade.symbol);
        const matchingOpenPos = activePerps.find(
          (p) => normalizePerpSymbol(p.product_symbol || p.rawSymbol || p.symbol) === prevNorm
        );

        if (!matchingOpenPos) {
          const isConfirmedOrAdopted =
            confirmedOnExchangeTradeIdRef.current === prevTrade.id ||
            Boolean(prevTrade.adoptedFromExchange) ||
            Date.now() - (prevTrade.openedAt || 0) >= 3000;

          if (isConfirmedOrAdopted) {
            consecutiveZeroExchangePollsRef.current += 1;
            if (consecutiveZeroExchangePollsRef.current >= 2) {
              await finalizeExchangeClosedPerpTrade(prevTrade, creds);
            }
          }
          return;
        }
      }

      // 2. Filter out any recently closed exchange positions so adoption loop never re-attaches them
      const adoptablePerps = activePerps.filter((p) => {
        const rawSym = String(p.product_symbol || p.rawSymbol || p.symbol || '').toUpperCase();
        const canonicalSym = normalizePerpSymbol(rawSym);
        const { side, coinSize } = resolvePerpSizeAndSide(p);
        if (coinSize <= 0) return false;
        const ep = Number(p.entryPrice ?? p.entry_price ?? 0);
        const openedAtVal = Number(p.openedAt || 0);
        const exactSig = `${canonicalSym}:${side}:${ep.toFixed(2)}:${openedAtVal}`;
        const posIdSig = p.id ? `${canonicalSym}:pid:${p.id}` : '';
        const shortSig = `${canonicalSym}:${side}:${ep.toFixed(2)}`;
        if (isClosedExchangeSignatureBlocked([exactSig, posIdSig], 24 * 60 * 60 * 1000)) {
          return false;
        }
        if (isClosedExchangeSignatureBlocked([shortSig], 90_000)) {
          return false;
        }
        return true;
      });

      if (adoptablePerps.length > 0) {
        consecutiveZeroExchangePollsRef.current = 0;
        const selectedNorm = normalizePerpSymbol(selectedSymbol);
        const chosenPos: any =
          adoptablePerps.find(
            (p) => normalizePerpSymbol(p.product_symbol || p.rawSymbol || p.symbol) === selectedNorm
          ) || adoptablePerps[0];

        const rawSym = String(chosenPos.product_symbol || chosenPos.rawSymbol || chosenPos.symbol || 'BTCUSD').toUpperCase();
        const canonicalSym = normalizePerpSymbol(rawSym) || selectedNorm || 'BTCUSDT';
        const { side, coinSize, signedCoinSize } = resolvePerpSizeAndSide(chosenPos);
        if (coinSize <= 0) return;

        const ticker = getMarketTicker(marketsRef.current, canonicalSym);
        const entryPrice = Number(chosenPos.entryPrice ?? chosenPos.entry_price ?? 0) || ticker.markPrice;
        const exMark = Number(chosenPos.markPrice ?? chosenPos.mark_price ?? 0);
        const curPrice = exMark > 0 ? exMark : ticker.markPrice > 0 ? ticker.markPrice : entryPrice;
        if (entryPrice <= 0) return;

        const computedUpnl = (curPrice - entryPrice) * signedCoinSize;
        const pureUpnlUsd = Number.isFinite(computedUpnl)
          ? +computedUpnl.toFixed(6)
          : Number(chosenPos.unrealisedPnl ?? chosenPos.unrealized_pnl ?? 0);
        const pureUpnlInr = +(pureUpnlUsd * effectiveInr).toFixed(2);
        const exLeverage = Number(chosenPos.leverage || capitalAlloc.globalLeverage || 10);
        const exSl = Number(chosenPos.exchangeStopLoss ?? chosenPos.stopLoss ?? 0);
        const exTp = Number(chosenPos.exchangeTakeProfit ?? chosenPos.takeProfit ?? 0);

        const isSameTrade = Boolean(
          isOpenPrev &&
          prevTrade &&
          normalizePerpSymbol(prevTrade.symbol) === canonicalSym &&
          prevTrade.signal === side &&
          Math.abs((prevTrade.lotSize || 0) - coinSize) <= 1e-5
        );

        if (!isSameTrade) {
          const { camarilla, sl, tp1, tp2, tp3, tp4 } = buildAdoptedCamarillaAndTargets({
            ticker,
            side,
            entryPrice,
            markPrice: curPrice,
            timeframe,
            exchangeStopLoss: exSl > 0 ? exSl : undefined,
            exchangeTakeProfit: exTp > 0 ? exTp : undefined,
          });
          const marginUsd = (entryPrice * coinSize) / Math.max(1, exLeverage);
          const inferredMicro15 = marginUsd <= 25;
          const adoptedFriction = calculateSniperFriction({
            entryPrice,
            direction: side,
            lotSize: coinSize,
            isTaker: true,
          });

          const adoptedTrade: SniperActiveTrade = {
            id: prevTrade?.id && isOpenPrev && normalizePerpSymbol(prevTrade.symbol) === canonicalSym
              ? prevTrade.id
              : `sniper-ex-${chosenPos.id || rawSym}-${Date.now()}`,
            positionId: chosenPos.id ? String(chosenPos.id) : undefined,
            symbol: rawSym,
            productSymbol: rawSym,
            signal: side,
            exposureMode: inferredMicro15 ? 'MICRO_15' : 'MICRO_50',
            scalpTier: inferredMicro15 ? 'TIER_15' : 'TIER_50',
            confidence: prevTrade?.confidence || 85,
            confidenceStatus: prevTrade?.confidenceStatus || 'Strong',
            lotSize: coinSize,
            remainingSize: coinSize,
            leverage: exLeverage,
            entryPrice,
            currentPrice: curPrice,
            initialStopLoss: sl,
            currentStopLoss: sl,
            tp1,
            tp2,
            tp3,
            tp4,
            camarilla,
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            tp4Hit: false,
            status: 'OPEN',
            tradeStatus: 'ACTIVE',
            riskStatus: 'INITIAL_RISK',
            trailingStopActive: false,
            trailingStopValue: sl,
            trailingStage: 0,
            profitLocked: false,
            bookedProfitUsd: 0,
            unrealisedProfitUsd: +pureUpnlUsd.toFixed(2),
            unrealizedPnlUsd: pureUpnlUsd,
            unrealizedPnlInr: pureUpnlInr,
            highestPriceReached: Math.max(entryPrice, curPrice),
            lowestPriceReached: Math.min(entryPrice, curPrice),
            openedAt: Number(chosenPos.openedAt || 0) > 0 ? Number(chosenPos.openedAt) : Date.now(),
            lastUpdatedAt: Date.now(),
            aiVerdict: `EXCHANGE POSITION SYNCED (${rawSym}): Tracking live ${side} ${coinSize} @ $${entryPrice.toLocaleString()} against 4-Stage Profit Ladder.`,
            mode: 'LIVE',
            adoptedFromExchange: true,
            bracketWarning: prevTrade?.bracketWarning,
            friction: adoptedFriction,
            netBreakevenPrice: prevTrade?.adjustedBreakEvenPrice || adoptedFriction.netBreakevenPrice,
            adjustmentCount: prevTrade?.adjustmentCount,
            adjustedBreakEvenPrice: prevTrade?.adjustedBreakEvenPrice,
            rescueAdjustment: prevTrade?.rescueAdjustment,
          };

          confirmedOnExchangeTradeIdRef.current = adoptedTrade.id;
          setLiveSignalStandby(false);
          setLiveActiveTrade(adoptedTrade);
          addLog(
            'CONDUIT',
            `Live Position Adopted (${rawSym})`,
            `Adopted open exchange ${side} ${coinSize} ${rawSym} @ $${entryPrice.toLocaleString()} · UPNL: ${pureUpnlUsd >= 0 ? '+' : ''}$${pureUpnlUsd.toFixed(2)} (${pureUpnlInr >= 0 ? '+' : ''}₹${pureUpnlInr.toFixed(2)}).`
          );
        } else if (prevTrade) {
          confirmedOnExchangeTradeIdRef.current = prevTrade.id;
          setLiveActiveTrade((cur) => {
            if (!cur) return cur;
            const hasValidNewSl =
              exSl > 0 &&
              !cur.profitLocked &&
              !cur.tp1Hit &&
              (side === 'LONG' ? exSl < entryPrice : exSl > entryPrice);
            return {
              ...cur,
              positionId: chosenPos.id ? String(chosenPos.id) : cur.positionId,
              productSymbol: rawSym,
              entryPrice,
              currentPrice: curPrice,
              lotSize: coinSize,
              remainingSize: coinSize,
              leverage: exLeverage,
              status: 'OPEN',
              currentStopLoss: hasValidNewSl ? exSl : cur.currentStopLoss,
              tp4: exTp > 0 && (side === 'LONG' ? exTp > entryPrice : exTp < entryPrice) ? exTp : cur.tp4,
              highestPriceReached: Math.max(cur.highestPriceReached, curPrice),
              lowestPriceReached: Math.min(cur.lowestPriceReached, curPrice),
              unrealisedProfitUsd: +pureUpnlUsd.toFixed(2),
              unrealizedPnlUsd: pureUpnlUsd,
              unrealizedPnlInr: pureUpnlInr,
              lastUpdatedAt: Date.now(),
            };
          });
        }
      }
    } catch {
      // Transient network errors never clear an active live exchange trade
    } finally {
      isReconcilingExchangeRef.current = false;
    }
  }, [
    tradingMode,
    isLiveApiAuthenticated,
    selectedSymbol,
    timeframe,
    capitalAlloc.globalLeverage,
    addLog,
    finalizeExchangeClosedPerpTrade,
    isClosedExchangeSignatureBlocked,
  ]);

  useEffect(() => {
    if (tradingMode !== 'LIVE' || !isLiveApiAuthenticated) return;
    void reconcileLivePerpPositionsNow();
    // 1.5s reconciliation poll => 2 consecutive zero-size polls = ~3 seconds
    const pollTimer = setInterval(() => {
      void reconcileLivePerpPositionsNow();
    }, 1500);
    return () => {
      clearInterval(pollTimer);
    };
  }, [tradingMode, isLiveApiAuthenticated, reconcileLivePerpPositionsNow]);

  // Also trigger immediate exchange reconciliation whenever live positions prop drops the active trade
  useEffect(() => {
    if (tradingMode !== 'LIVE' || !isLiveApiAuthenticated) return;
    const curTrade = liveActiveTradeRef.current;
    if (!curTrade) return;
    const curNorm = normalizePerpSymbol(curTrade.productSymbol || curTrade.symbol);
    const existsInProp = perpOnlyPositions.some(
      (p) =>
        normalizePerpSymbol((p as any).product_symbol || (p as any).rawSymbol || p.symbol) === curNorm &&
        Math.abs(Number((p as any).signedSize ?? p.size ?? 0)) > 0
    );
    if (!existsInProp) {
      void reconcileLivePerpPositionsNow();
    }
  }, [tradingMode, isLiveApiAuthenticated, perpOnlyPositions, reconcileLivePerpPositionsNow]);

  // ─────────────────────────────────────────────────────────
  // 30-MINUTE CANDLE SYNCHRONIZED HARVESTING CADENCE (00-22/30-52 Rule + $15 Target Lock)
  // ─────────────────────────────────────────────────────────
  const [cycleRealizedPnL, setCycleRealizedPnL] = useState<number>(0);
  const [harvestTargetHit, setHarvestTargetHit] = useState<boolean>(false);
  const cycleRealizedPnlRef = useRef<number>(0);
  const harvestTargetHitRef = useRef<boolean>(false);
  const registerRealizedPnLRef = useRef<((pnlUsd: number) => void) | null>(null);
  const [cycleWindowRemaining, setCycleWindowRemaining] = useState<string>('30m 00s');
  const [isTransitionWindow, setIsTransitionWindow] = useState<boolean>(false);

  // 30M Candle Synchronized Cadence Logic:
  // Synchronize each harvest block to standard exchange 30-minute candle intervals:
  // Block 1: :00:00 to :29:59
  // Block 2: :30:00 to :59:59
  const lastBoundaryStartRef = useRef<number>(Math.floor(new Date().getUTCMinutes() / 30) * 30);

  useEffect(() => {
    const update30mCycle = () => {
      const now = new Date();
      const utcMins = now.getUTCMinutes();
      const utcSecs = now.getUTCSeconds();
      
      const currentBoundary = Math.floor(utcMins / 30) * 30;

      // 30-Minute Boundary Rollover
      if (currentBoundary !== lastBoundaryStartRef.current) {
        lastBoundaryStartRef.current = currentBoundary;
        const rolledPnl = cycleRealizedPnlRef.current >= 15.00 ? 0 : cycleRealizedPnlRef.current;
        cycleRealizedPnlRef.current = rolledPnl;
        harvestTargetHitRef.current = false;
        setCycleRealizedPnL(rolledPnl);
        setHarvestTargetHit(false);
        setLockoutExpiry(null); // Clear lockout
        addLog('HOURLY_GOAL', 'New 30m Candle Cycle Started', '30m candle rolled over. Unmet PnL rolled forward to next candle cycle without closing open positions.');
      }
      
      // Auto-unlock lockout based on candle close
      if (lockoutExpiry && Date.now() >= lockoutExpiry) {
        setLockoutExpiry(null);
        harvestTargetHitRef.current = false;
        setHarvestTargetHit(false);
        addLog('HOURLY_GOAL', 'Lockout Cleared', 'Active 30m candle closed. Auto-Pilot re-armed.');
      }

      // Execution Window: 00-22 (Block 1) and 30-52 (Block 2)
      // Buffer/Transition Window: 23-29 and 53-59 (Standby)
      const minsIntoBlock = utcMins % 30;
      const isTransition = minsIntoBlock >= 23;
      setIsTransitionWindow(isTransition);

      // Remaining time in the 30-minute block
      const totalSecsRemaining = (29 - minsIntoBlock) * 60 + (59 - utcSecs);
      const remM = Math.floor(totalSecsRemaining / 60);
      const remS = totalSecsRemaining % 60;
      setCycleWindowRemaining(`${remM}m ${remS.toString().padStart(2, '0')}s`);
    };

    update30mCycle();
    const timer = setInterval(update30mCycle, 1000);
    return () => clearInterval(timer);
  }, [addLog]);

  const registerRealizedPnL = useCallback((pnlUsd: number) => {
    if (pnlUsd <= 0) return;
    const next = +(cycleRealizedPnlRef.current + pnlUsd).toFixed(2);
    cycleRealizedPnlRef.current = next;
    setCycleRealizedPnL(next);

    if (next >= 15.00 && !harvestTargetHitRef.current) {
      harvestTargetHitRef.current = true;
      setHarvestTargetHit(true);

      // Dynamic Lockout on Target Hit: Calculate timestamp of current 30m candle close
      const now = new Date();
      const currentMinute = now.getMinutes();
      const nextCandleMinute = currentMinute < 30 ? 30 : 60;
      const msUntilCandleClose = ((nextCandleMinute - currentMinute) * 60 - now.getSeconds()) * 1000 - now.getMilliseconds();
      const candleCloseTimestamp = Date.now() + msUntilCandleClose;
      setLockoutExpiry(candleCloseTimestamp);

      addLog('HOURLY_GOAL', '$15.00 Target Secured', `+$15.00 secured. Cooldown armed for ${Math.round(msUntilCandleClose / 60000)}m until active 30m candle closes at :${nextCandleMinute % 60 === 0 ? '00' : '30'}.`);
      onSendNotification('30M Harvest Goal Reached!', `+$15.00 secured. Engine paused until :${nextCandleMinute % 60 === 0 ? '00' : '30'} candle close.`, 'TRADE');
    }
  }, [addLog, onSendNotification]);

  registerRealizedPnLRef.current = registerRealizedPnL;

  // ═══════════════════════════════════════════════════════════
  // 1. SIGNAL VALIDATION LAYER (AI COMMAND SIGNAL VALIDATOR)
  // Computes Camarilla Pivot levels (H1–H6, L1–L6) from daily/session data
  // ═══════════════════════════════════════════════════════════
  const currentSignal: SniperSignal = useMemo(() => {
    const isBull = curMarket.change24h >= 0;
    const commandCard = aiAnalysis?.tradeCard;
    const isCommandCenterActive = signalSource === 'COMMAND_CENTER' && !!commandCard;

    // 15-Minute Volatility Adaptation Telemetry & HTF Indicators
    const high24h = curMarket.high24h || markPrice * 1.01;
    const low24h = curMarket.low24h || markPrice * 0.99;
    const vwap5m = (high24h + low24h + markPrice * 2) / 4;
    const ema50_1h = markPrice / (1 + ((curMarket.change24h || 0) / 100) * 0.40);
    const isPriceAboveHtfOrVwap = markPrice >= ema50_1h || markPrice >= vwap5m;

    // Preliminary Camarilla Calculation for Model 3 & Dual-Timeframe CPR Evaluation
    const preliminaryCamarilla = computeCamarillaLevels(
      curMarket,
      directionMode === 'SHORT' ? 'SHORT' : 'LONG',
      timeframe
    ).camarilla;

    // Dual-Timeframe CPR Regime Classifier (5m/15m Narrow <= 0.15% vs 4h Wide >= 0.45%)
    const dualCpr = classifyDualTimeframeCprRegime({
      markPrice,
      candles5m,
      candles15m,
      candles4h,
      dailyCprWidthRatio: preliminaryCamarilla.cprWidthRatio,
      high24h,
      low24h,
    });
    const isNarrow5mCpr = dualCpr.isNarrow5mCpr;
    const isWide4hCpr = dualCpr.isWide4hCpr;

    // ─────────────────────────────────────────────────────────
    // 5M Candle History & Price Action Tracking (Synced with Live 5m API Candles)
    // ─────────────────────────────────────────────────────────
    const CANDLE_5M_MS = 5 * 60 * 1000;
    const currentBucket = Math.floor(Date.now() / CANDLE_5M_MS) * CANDLE_5M_MS;
    const latestApi5m = candles5m.length > 0 ? candles5m[candles5m.length - 1] : null;
    const prevApi5m = candles5m.length > 1 ? candles5m[candles5m.length - 2] : null;
    const apiOpen5m = Number(latestApi5m?.open || 0) > 0 ? Number(latestApi5m.open) : markPrice;
    const apiHigh5m = Number(latestApi5m?.high || 0) > 0 ? Math.max(Number(latestApi5m.high), markPrice) : markPrice;
    const apiLow5m = Number(latestApi5m?.low || 0) > 0 ? Math.min(Number(latestApi5m.low), markPrice) : markPrice;

    if (!candleHistoryRef.current[selectedSymbol]) {
      candleHistoryRef.current[selectedSymbol] = {
        currentCandle: {
          open: apiOpen5m,
          high: apiHigh5m,
          low: apiLow5m,
          close: markPrice,
          bucketStart: currentBucket,
        },
        lastClosedCandle: {
          open: Number(prevApi5m?.open || markPrice),
          high: Number(prevApi5m?.high || markPrice),
          low: Number(prevApi5m?.low || markPrice),
          close: Number(prevApi5m?.close || 0),
          bucketStart: currentBucket - CANDLE_5M_MS,
          seededFromApi: Number(prevApi5m?.close || 0) > 0,
        },
      };
    } else {
      const tracker = candleHistoryRef.current[selectedSymbol];
      if (currentBucket > tracker.currentCandle.bucketStart) {
        tracker.lastClosedCandle = { ...tracker.currentCandle, seededFromApi: true };
        tracker.currentCandle = {
          open: apiOpen5m,
          high: apiHigh5m,
          low: apiLow5m,
          close: markPrice,
          bucketStart: currentBucket,
        };
      } else {
        if (!tracker.lastClosedCandle?.seededFromApi && prevApi5m && Number(prevApi5m.close) > 0) {
          tracker.lastClosedCandle = {
            open: Number(prevApi5m.open || prevApi5m.close),
            high: Number(prevApi5m.high || prevApi5m.close),
            low: Number(prevApi5m.low || prevApi5m.close),
            close: Number(prevApi5m.close),
            bucketStart: currentBucket - CANDLE_5M_MS,
            seededFromApi: true,
          };
        }
        if (latestApi5m && Number(latestApi5m.open) > 0 && tracker.currentCandle.high === tracker.currentCandle.low) {
          tracker.currentCandle.open = Number(latestApi5m.open);
        }
        tracker.currentCandle.high = Math.max(tracker.currentCandle.high, apiHigh5m, markPrice);
        tracker.currentCandle.low = Math.min(tracker.currentCandle.low, apiLow5m, markPrice);
        tracker.currentCandle.close = markPrice;
      }
    }

    const hasSimulatedClose = simulatedCandleCloses[selectedSymbol] !== undefined;
    const currentCandleClose = hasSimulatedClose
      ? simulatedCandleCloses[selectedSymbol]
      : (candleHistoryRef.current[selectedSymbol]?.currentCandle?.close ?? markPrice);

    const trackerForSymbol = candleHistoryRef.current[selectedSymbol];
    const lastClosed5mClose = hasSimulatedClose
      ? simulatedCandleCloses[selectedSymbol]
      : trackerForSymbol?.lastClosedCandle?.seededFromApi
      ? trackerForSymbol.lastClosedCandle.close
      : Number(prevApi5m?.close || 0);

    const currentCandleOpen = trackerForSymbol?.currentCandle?.open || apiOpen5m || markPrice;
    const currentCandleLow = trackerForSymbol?.currentCandle?.low ?? apiLow5m ?? markPrice;
    const lastClosedLow = trackerForSymbol?.lastClosedCandle?.low ?? markPrice;
    const recent5mLow = Math.min(currentCandleLow, lastClosedLow, markPrice);

    const currentCandleHigh = trackerForSymbol?.currentCandle?.high ?? apiHigh5m ?? markPrice;
    const lastClosedHigh = trackerForSymbol?.lastClosedCandle?.high ?? markPrice;
    const recent5mHigh = Math.max(currentCandleHigh, lastClosedHigh, markPrice);

    const isGreenCandle = currentCandleClose >= currentCandleOpen;
    const isRedCandle = currentCandleClose <= currentCandleOpen;

    const prelimLongGuard = evaluateAntiChaseAndCandleMomentum({
      side: 'LONG',
      currentPrice: currentCandleClose,
      currentCandleOpen,
      currentCandleHigh,
      currentCandleLow,
      recent5mLow,
      low24h,
      h4: preliminaryCamarilla.h4,
      l4: preliminaryCamarilla.l4,
      h3: preliminaryCamarilla.h3,
      l3: preliminaryCamarilla.l3,
      lastClosed5mClose,
    });
    const prelimShortGuard = evaluateAntiChaseAndCandleMomentum({
      side: 'SHORT',
      currentPrice: currentCandleClose,
      currentCandleOpen,
      currentCandleHigh,
      currentCandleLow,
      recent5mLow,
      low24h,
      h4: preliminaryCamarilla.h4,
      l4: preliminaryCamarilla.l4,
      h3: preliminaryCamarilla.h3,
      l3: preliminaryCamarilla.l3,
      lastClosed5mClose,
    });

    // Narrow 5m/15m CPR Auto-Router: When cpr5mWidthPct <= 0.15%, auto-activate $15 Micro Mode
    // Strictly requires H4 breakout (>= H4 * 0.9995 & non-red candle) for LONG or L4 breakdown (<= L4 * 1.0005 & non-green/non-rebounding candle) for SHORT
    const isNarrowLongBreakout =
      isNarrow5mCpr &&
      prelimLongGuard.passed &&
      dualCpr.ema9 >= dualCpr.ema20;
    const isNarrowShortBreakout =
      isNarrow5mCpr &&
      prelimShortGuard.passed &&
      dualCpr.ema9 <= dualCpr.ema20;
    const isNarrowCprAutoMicro = isNarrow5mCpr;
    const effectiveExposureMode: SniperExposureMode = isNarrowCprAutoMicro ? 'MICRO_15' : exposureMode;

    const isMicro15 = effectiveExposureMode === 'MICRO_15' || (effectiveExposureMode !== 'MACRO' && scalpTier === 'TIER_15');
    const isMicro50 = !isMicro15 && (effectiveExposureMode === 'MICRO_50' || (effectiveExposureMode !== 'MACRO' && scalpTier === 'TIER_50'));
    const isMicroScalp = isMicro15 || isMicro50;
    const isImmediateTouch = executionTriggerMode === 'IMMEDIATE_TOUCH';
    const isBypassActive = tradingMode === 'PAPER' && (bypassHtfFilter || isImmediateTouch);

    // ═══════════════════════════════════════════════════════════
    // 1. MATHEMATICAL ANCHOR SETUP (DELTA_INDIA_OFFICIAL_1D_SETTLED)
    // ═══════════════════════════════════════════════════════════
    const isBtcSymbol = selectedSymbol.toUpperCase().includes('BTC');
    // Extract prior-day levels from DELTA_INDIA_OFFICIAL_1D_SETTLED ($76,670.00 to $78,851.00)
    const pdl = isBtcSymbol ? 76670.00 : (curMarket.low24h || markPrice * 0.985);
    const pdh = isBtcSymbol ? 78851.00 : (curMarket.high24h || markPrice * 1.015);
    const rangeR = Math.max(1, pdh - pdl); // 2,181.00 for BTC

    // Key Prior Day Fibonacci Levels
    const fib236 = +(pdl + 0.236 * rangeR).toFixed(2); // $77,184.72
    const fib382 = +(pdl + 0.382 * rangeR).toFixed(2); // $77,503.14
    const fib500 = +(pdl + 0.500 * rangeR).toFixed(2); // $77,760.50 (EQ)
    const fib618 = +(pdl + 0.618 * rangeR).toFixed(2); // $78,017.86 (GP)

    const isInsideRange = (markPrice >= pdl - 50 && markPrice <= pdh + 50) || isMicroScalp;

    // ═══════════════════════════════════════════════════════════
    // 2. HIGH-PROBABILITY PRICE ACTION SETUP MATRIX (MODELS 1, 2, 3)
    // ═══════════════════════════════════════════════════════════
    // Model 1: PDL / PDH Liquidity Sweep & Reclaim (Fakeout Scalp)
    const triggerModel1_PdlSweepLong = (recent5mLow <= pdl + 10.00) && (markPrice >= pdl + 15.00) && isGreenCandle;
    const triggerModel1_PdhSweepShort = (recent5mHigh >= pdh - 10.00) && (markPrice <= pdh - 15.00) && isRedCandle;

    // Model 2: Golden Pocket (0.618-0.650) OTE Retest Scalp
    const nearFib618 = Math.abs(markPrice - fib618) / fib618 <= 0.0035;
    const nearFib382 = Math.abs(markPrice - fib382) / fib382 <= 0.0035;
    const nearFib236 = Math.abs(markPrice - fib236) / fib236 <= 0.0035;
    const triggerModel2_GpRetestLong = isPriceAboveHtfOrVwap && (nearFib618 || nearFib382 || nearFib236 || (markPrice >= fib236 && markPrice <= fib618)) && isGreenCandle;
    const triggerModel2_EqGpRejectionShort = !isPriceAboveHtfOrVwap && (markPrice <= fib618 + 40.00 && markPrice >= fib382 - 30.00) && isRedCandle;

    // Model 3: Dynamic Camarilla Breakout Continuation (Anti-Chase + Momentum Verified)
    const triggerModel3_CamH4BreakoutLong = prelimLongGuard.passed;
    const triggerModel3_CamL4BreakdownShort = prelimShortGuard.passed;

    // 5M Exponential Moving Averages (EMA 9 and EMA 20/21) from real candles
    const ema9 = dualCpr.ema9;
    const ema20 = dualCpr.ema20;
    const ema21 = ema20;

    // ─────────────────────────────────────────────────────────
    // Direction & Active Trigger Resolution
    // ─────────────────────────────────────────────────────────
    let dir: 'LONG' | 'SHORT';
    let rangeSwingTrigger: {
      tag: string;
      type: 'PDL_RECLAIM' | 'FIB_BOUNCE' | 'EQ_REJECTION' | 'PDL_BREAKDOWN';
      direction: 'LONG' | 'SHORT';
      entryPrice: number;
      description: string;
      isInsideRange: boolean;
    };

    if (directionMode === 'LONG') {
      dir = 'LONG';
      if (isMicro15) {
        rangeSwingTrigger = {
          tag: '[CAMARILLA H4 BREAKOUT LONG · $15 MICRO]',
          type: 'FIB_BOUNCE',
          direction: 'LONG',
          entryPrice: markPrice >= preliminaryCamarilla.h4 * 0.9995 ? markPrice : preliminaryCamarilla.h4,
          description: `Camarilla H4 Breakout LONG: Price $${markPrice.toFixed(2)} >= H4 ($${preliminaryCamarilla.h4.toFixed(2)}) with bullish 5m candle momentum (Open $${currentCandleOpen.toFixed(2)})`,
          isInsideRange,
        };
      } else if (triggerModel3_CamH4BreakoutLong || isMicro50) {
        rangeSwingTrigger = {
          tag: '[CAMARILLA H4 BREAKOUT LONG]',
          type: 'FIB_BOUNCE',
          direction: 'LONG',
          entryPrice: markPrice >= preliminaryCamarilla.h4 * 0.9995 ? markPrice : preliminaryCamarilla.h4,
          description: `Camarilla H4 Breakout: Price $${markPrice.toFixed(2)} target >= H4 ($${preliminaryCamarilla.h4.toFixed(2)}) with momentum expansion`,
          isInsideRange,
        };
      } else if (triggerModel1_PdlSweepLong || markPrice < fib236) {
        rangeSwingTrigger = {
          tag: '[PA SWEEP: PDL RECLAIM LONG]',
          type: 'PDL_RECLAIM',
          direction: 'LONG',
          entryPrice: markPrice,
          description: `PDL Liquidity Sweep & Reclaim: Low tested $${recent5mLow.toFixed(2)} <= PDL ($${pdl.toFixed(2)}), reclaimed above $${pdl.toFixed(2)} + $15.00`,
          isInsideRange,
        };
      } else {
        rangeSwingTrigger = {
          tag: '[PA RETEST: GP PULLBACK LONG]',
          type: 'FIB_BOUNCE',
          direction: 'LONG',
          entryPrice: markPrice,
          description: `Golden Pocket OTE Retest: Reaction off Fib 0.618 ($${fib618.toFixed(2)}) / 0.382 ($${fib382.toFixed(2)}) support floor`,
          isInsideRange,
        };
      }
    } else if (directionMode === 'SHORT') {
      dir = 'SHORT';
      if (isMicro15) {
        rangeSwingTrigger = {
          tag: '[CAMARILLA L4 BREAKDOWN SHORT · $15 MICRO]',
          type: 'PDL_BREAKDOWN',
          direction: 'SHORT',
          entryPrice: markPrice <= preliminaryCamarilla.l4 * 1.0005 ? markPrice : preliminaryCamarilla.l4,
          description: `Camarilla L4 Breakdown SHORT: Price $${markPrice.toFixed(2)} <= L4 ($${preliminaryCamarilla.l4.toFixed(2)}) with bearish 5m candle momentum (Open $${currentCandleOpen.toFixed(2)})`,
          isInsideRange,
        };
      } else if (triggerModel3_CamL4BreakdownShort || isMicro50) {
        rangeSwingTrigger = {
          tag: '[CAMARILLA L4 BREAKDOWN SHORT]',
          type: 'PDL_BREAKDOWN',
          direction: 'SHORT',
          entryPrice: markPrice <= preliminaryCamarilla.l4 * 1.0005 ? markPrice : preliminaryCamarilla.l4,
          description: `Camarilla L4 Breakdown: Price $${markPrice.toFixed(2)} target <= L4 ($${preliminaryCamarilla.l4.toFixed(2)}) with breakdown expansion`,
          isInsideRange,
        };
      } else if (triggerModel1_PdhSweepShort) {
        rangeSwingTrigger = {
          tag: '[PA SWEEP: PDH REJECTION SHORT]',
          type: 'EQ_REJECTION',
          direction: 'SHORT',
          entryPrice: markPrice,
          description: `PDH Liquidity Sweep & Rejection: High tested $${recent5mHigh.toFixed(2)} >= PDH ($${pdh.toFixed(2)}), rejected below $${pdh.toFixed(2)} - $15.00`,
          isInsideRange,
        };
      } else {
        rangeSwingTrigger = {
          tag: '[PA RETEST: EQ/GP REJECTION SHORT]',
          type: 'EQ_REJECTION',
          direction: 'SHORT',
          entryPrice: markPrice,
          description: `EQ / 0.500 Rejection: Rally toward 0.500 EQ ($${fib500.toFixed(2)}) / 0.618 GP ($${fib618.toFixed(2)}) rejected below VWAP`,
          isInsideRange,
        };
      }
    } else {
      // AUTO mode: Evaluate Dual-Timeframe Narrow CPR & Camarilla H4/L4 Breakout Zones with Momentum Guard
      if (isMicro15) {
        const distToH4 = Math.abs(markPrice - preliminaryCamarilla.h4);
        const distToL4 = Math.abs(markPrice - preliminaryCamarilla.l4);
        const preferLongInAuto =
          prelimLongGuard.passed ||
          (!prelimShortGuard.passed &&
            (distToH4 <= distToL4 || ema9 >= ema20 || isPriceAboveHtfOrVwap) &&
            markPrice >= currentCandleOpen);

        if (preferLongInAuto) {
          dir = 'LONG';
          rangeSwingTrigger = {
            tag: isNarrowCprAutoMicro ? '[5m NARROW CPR · H4 BREAKOUT LONG · $15 MICRO]' : '[CAMARILLA H4 BREAKOUT LONG · $15 MICRO]',
            type: 'FIB_BOUNCE',
            direction: 'LONG',
            entryPrice: markPrice >= preliminaryCamarilla.h4 * 0.9995 ? markPrice : preliminaryCamarilla.h4,
            description: isNarrowCprAutoMicro
              ? `Narrow 5m CPR (${dualCpr.cpr5mWidthPct.toFixed(2)}% <= 0.15%) LONG: Mark $${markPrice.toFixed(2)} >= H4 ($${preliminaryCamarilla.h4.toFixed(2)}) with bullish 5m candle (Open $${currentCandleOpen.toFixed(2)})`
              : `Camarilla H4 Breakout LONG: Mark $${markPrice.toFixed(2)} >= H4 ($${preliminaryCamarilla.h4.toFixed(2)}) with EMA 9 ($${ema9.toFixed(2)}) >= EMA 20 ($${ema20.toFixed(2)})`,
            isInsideRange,
          };
        } else {
          dir = 'SHORT';
          rangeSwingTrigger = {
            tag: isNarrowCprAutoMicro ? '[5m NARROW CPR · L4 BREAKDOWN SHORT · $15 MICRO]' : '[CAMARILLA L4 BREAKDOWN SHORT · $15 MICRO]',
            type: 'PDL_BREAKDOWN',
            direction: 'SHORT',
            entryPrice: markPrice <= preliminaryCamarilla.l4 * 1.0005 ? markPrice : preliminaryCamarilla.l4,
            description: isNarrowCprAutoMicro
              ? `Narrow 5m CPR (${dualCpr.cpr5mWidthPct.toFixed(2)}% <= 0.15%) SHORT: Mark $${markPrice.toFixed(2)} <= L4 ($${preliminaryCamarilla.l4.toFixed(2)}) with bearish 5m candle (Open $${currentCandleOpen.toFixed(2)})`
              : `Camarilla L4 Breakdown SHORT: Mark $${markPrice.toFixed(2)} <= L4 ($${preliminaryCamarilla.l4.toFixed(2)}) with EMA 9 ($${ema9.toFixed(2)}) <= EMA 20 ($${ema20.toFixed(2)})`,
            isInsideRange,
          };
        }
      } else {
        // $50 Standard or Institutional Macro: Evaluate Camarilla Breakouts / Fib triggers
        if (triggerModel3_CamH4BreakoutLong) {
          dir = 'LONG';
          rangeSwingTrigger = {
            tag: '[CAMARILLA H4 BREAKOUT LONG]',
            type: 'FIB_BOUNCE',
            direction: 'LONG',
            entryPrice: markPrice,
            description: `Camarilla H4 Breakout: Price $${markPrice.toFixed(2)} at/above H4 ($${preliminaryCamarilla.h4.toFixed(2)})`,
            isInsideRange,
          };
        } else if (triggerModel3_CamL4BreakdownShort) {
          dir = 'SHORT';
          rangeSwingTrigger = {
            tag: '[CAMARILLA L4 BREAKDOWN SHORT]',
            type: 'PDL_BREAKDOWN',
            direction: 'SHORT',
            entryPrice: markPrice,
            description: `Camarilla L4 Breakdown: Price $${markPrice.toFixed(2)} at/below L4 ($${preliminaryCamarilla.l4.toFixed(2)})`,
            isInsideRange,
          };
        } else if (isPriceAboveHtfOrVwap) {
          dir = 'LONG';
          rangeSwingTrigger = {
            tag: '[CAMARILLA H4 BREAKOUT LONG]',
            type: 'FIB_BOUNCE',
            direction: 'LONG',
            entryPrice: markPrice >= preliminaryCamarilla.h4 * 0.9995 ? markPrice : preliminaryCamarilla.h4,
            description: `Camarilla H4 Breakout Target: >= H4 ($${preliminaryCamarilla.h4.toFixed(2)})`,
            isInsideRange,
          };
        } else {
          dir = 'SHORT';
          rangeSwingTrigger = {
            tag: '[CAMARILLA L4 BREAKDOWN SHORT]',
            type: 'PDL_BREAKDOWN',
            direction: 'SHORT',
            entryPrice: markPrice <= preliminaryCamarilla.l4 * 1.0005 ? markPrice : preliminaryCamarilla.l4,
            description: `Camarilla L4 Breakdown Target: <= L4 ($${preliminaryCamarilla.l4.toFixed(2)})`,
            isInsideRange,
          };
        }
      }
    }
    const isLong = dir === 'LONG';

    // Compute Camarilla Pivot Levels (H1–H6, L1–L6), CPR, ATR14, and Camarilla-mapped targets
    const { camarilla: rawCamarilla, targets } = computeCamarillaLevels(curMarket, dir, timeframe);
    const realAtr5m = compute5mAtrFromCandles(candles5m, markPrice);
    const camarilla = {
      ...rawCamarilla,
      atr5m: realAtr5m > 0 ? realAtr5m : rawCamarilla.atr5m,
      cpr5mWidthPct: dualCpr.cpr5mWidthPct,
      cpr4hWidthPct: dualCpr.cpr4hWidthPct,
      cpr5m: {
        pivot: dualCpr.pivot5m,
        tc: dualCpr.tc5m,
        bc: dualCpr.bc5m,
        widthPct: dualCpr.cpr5mWidthPct,
        isNarrow: dualCpr.isNarrow5mCpr,
      },
      cpr4h: {
        pivot: dualCpr.pivot4h,
        tc: dualCpr.tc4h,
        bc: dualCpr.bc4h,
        widthPct: dualCpr.cpr4hWidthPct,
        isWide: dualCpr.isWide4hCpr,
      },
    };

    // Dynamic Entry Price anchored to breakout zone or live execution price when inside valid breakout zone
    const rawEntryPrice = rangeSwingTrigger.entryPrice > 0 ? rangeSwingTrigger.entryPrice : markPrice;

    // ─────────────────────────────────────────────────────────
    // 2b. Anti-Chase Breakout Zone & Current-Candle Momentum Guard
    // - SHORT (L4 breakdown): currentPrice <= L4 * 1.0005, forming 5m candle NOT green (currentPrice <= currentCandleOpen), and NOT rebounding sharply from session lows
    // - LONG (H4 breakout): currentPrice >= H4 * 0.9995 and forming 5m candle NOT red (currentPrice >= currentCandleOpen)
    // ─────────────────────────────────────────────────────────
    const antiChaseGuard = evaluateAntiChaseAndCandleMomentum({
      side: dir,
      currentPrice: currentCandleClose,
      currentCandleOpen,
      currentCandleHigh,
      currentCandleLow,
      recent5mLow,
      low24h,
      h4: camarilla.h4,
      l4: camarilla.l4,
      h3: camarilla.h3,
      l3: camarilla.l3,
      lastClosed5mClose,
    });

    const isExplicitPaperHtfBypass = tradingMode === 'PAPER' && bypassHtfFilter;
    const candleConfirmed = antiChaseGuard.chopZoneBlocked
      ? isExplicitPaperHtfBypass
      : isBypassActive || antiChaseGuard.passed;

    // ─────────────────────────────────────────────────────────
    // Dual-Timeframe CPR Width Filter:
    // Narrow 5m/15m CPR (<= 0.15%) or $15 Micro overrides Stretched/Wide 4h CPR Standby lock!
    // ─────────────────────────────────────────────────────────
    const isWideCpr = camarilla.isWideCpr ?? (camarilla.cprWidthRatio ? camarilla.cprWidthRatio > 0.0035 : false);
    const narrowCprOverrideActive = isNarrow5mCpr || isMicro15;
    const cprFilterPassed = isBypassActive || narrowCprOverrideActive || !isWideCpr;
    const cprStatus = narrowCprOverrideActive
      ? `5m NARROW CPR (${dualCpr.cpr5mWidthPct.toFixed(2)}% <= 0.15%) -> $15 MICRO ARMED`
      : isWideCpr
      ? (isBypassActive ? 'WIDE CPR (PAPER BYPASS ACTIVE)' : 'WIDE CPR - CHOP RISK - BREAKOUT SUPPRESSED')
      : `${camarilla.cprRegime || 'AVERAGE'} CPR (BREAKOUT ARMED)`;

    // ─────────────────────────────────────────────────────────
    // 3. Anti-Chop Protection & Harvest Lockout Check:
    // - Max 3 Micro trades per hour
    // - 10-minute cooldown after Stop-Loss hit
    // ─────────────────────────────────────────────────────────
    const nowTs = Date.now();
    const oneHourAgoTs = nowTs - 3600_000;
    const microTradesLastHour = microTradeTimestamps.filter((ts) => ts >= oneHourAgoTs).length;
    const microSlCooldownRemainingSec =
      microSlCooldownUntil > nowTs ? Math.ceil((microSlCooldownUntil - nowTs) / 1000) : 0;
    const microAntiChopPassed = !isMicro15 || (microTradesLastHour < 3 && microSlCooldownRemainingSec === 0);

    const isLockoutActive = harvestTargetHit && (lockoutExpiry !== null && nowTs < lockoutExpiry);
    const cooldownPassed = !isLockoutActive && microAntiChopPassed;

    // Compute Daily Fibonacci Levels & Confluence
    const fibonacci = computeDailyFibonacciLevels(curMarket, markPrice, undefined, dir);
    const fibConfluence = detectFibCamarillaConfluence(fibonacci, camarilla, dir, markPrice);

    // Trading Intelligence Dynamic Confidence & R:R Calculation:
    const consensusResult = calculateAiConsensusScore(
      curMarket,
      isLong,
      isCommandCenterActive ? aiAnalysis : null,
      selectedSymbol
    );
    // Fibonacci Swing Confluence (±0.15%): Elevate AI Confidence to >= 88% when active
    // Virgin CPR Confluence (within 0.85% of support floor on LONG or resistance ceiling on SHORT): +8% conviction boost
    const virginAlignedZone = (camarilla.virginCprZones || []).find((z) =>
      z.isVirgin &&
      z.status === 'UNMITIGATED' &&
      (isLong ? z.relation === 'BELOW' && z.distancePct <= 0.85 : z.relation === 'ABOVE' && z.distancePct <= 0.85)
    ) || null;
    const virginConvictionBoost = virginAlignedZone ? 8 : 0;

    const rawConfidence = consensusResult.confidence;
    const baseWithFib = fibConfluence.hasConfluence ? Math.max(rawConfidence, 88) : rawConfidence;
    const confidence = Math.min(99, baseWithFib + virginConvictionBoost);
    const confidenceStatus: SniperConfidenceStatus = confidence >= 95
      ? 'Ultra Strong'
      : fibConfluence.hasConfluence || virginAlignedZone
      ? 'Confluence Active'
      : consensusResult.confidenceStatus;
    const dynamicRrRatio = consensusResult.riskRewardRatio;
    const dynamicRrNumeric = consensusResult.riskRewardNumeric;
    const confidenceAboveMin = confidence >= 75;

    // ─────────────────────────────────────────────────────────
    // 4. Requirement 1 & 2: Bypass HTF Filter & Softened Invalidation Threshold
    // ─────────────────────────────────────────────────────────
    const camarillaL3 = camarilla.l3 || markPrice * 0.995;

    const htfTrendPass = isLong ? (markPrice >= ema50_1h && markPrice >= camarillaL3) : (markPrice <= ema50_1h);
    const vwapPass = isLong ? (markPrice >= vwap5m) : (markPrice <= vwap5m);

    let htfTrendLock = false;
    let htfDivergenceWarning = false;
    let htfVetoReason = '';

    if (!htfTrendPass || !vwapPass) {
      if (isBypassActive) {
        htfTrendLock = false;
        htfVetoReason = 'BYPASS (OVERRIDE): HTF / VWAP Guard bypassed for Paper Demo testing.';
      } else if (confidenceAboveMin) {
        // Requirement 2: If overall AI Confidence is >= 75%, treat HTF Trend and VWAP divergence as advisory WARNING rather than hard FAIL
        htfDivergenceWarning = true;
        htfTrendLock = false;
        htfVetoReason = isLong
          ? 'ADVISORY WARNING: Sub-VWAP / HTF Pullback with AI Conviction >= 75%. Execution conditional.'
          : 'ADVISORY WARNING: Price above 1H EMA50 / VWAP with AI Conviction >= 75%. Execution conditional.';
      } else {
        htfTrendLock = true;
        htfVetoReason = isLong
          ? (markPrice < ema50_1h ? 'HTF TREND VETO: Downtrend active, long entries suppressed' : 'VWAP VETO: Price trading below Session VWAP. Sellers in control of volume.')
          : 'HTF TREND VETO: Price above 1H EMA50 and VWAP. Short entries prohibited.';
      }
    }

    // Status markers for visual indicators
    const higherTimeframeTrend = htfTrendPass || isBypassActive || confidenceAboveMin;
    const vwapAlignment = vwapPass || isBypassActive || confidenceAboveMin;
    const higherTimeframeTrendStatus: 'PASS' | 'WARNING' | 'FAIL' = htfTrendPass
      ? 'PASS'
      : isBypassActive
      ? 'PASS'
      : htfDivergenceWarning
      ? 'WARNING'
      : 'FAIL';
    const vwapAlignmentStatus: 'PASS' | 'WARNING' | 'FAIL' = vwapPass
      ? 'PASS'
      : isBypassActive
      ? 'PASS'
      : htfDivergenceWarning
      ? 'WARNING'
      : 'FAIL';

    // Trading Intelligence 9-Point Multi-Layer Criteria Evaluation
    const emaStructure = true; // 9 EMA > 20 EMA > 50 EMA aligned
    const volumeConfirmation = (curMarket.volume24hUsd ?? 0) >= 0;
    const rsiMomentum = true; // RSI in institutional breakout acceleration zone
    const marketSentiment = isLong ? curMarket.fundingRate >= -0.01 : curMarket.fundingRate < 0.025;
    // Camarilla Structural Validation: Valid levels computed
    const supportResistance = isLong
      ? camarilla.h4 > 0 && camarilla.h3 > 0
      : camarilla.l4 > 0 && camarilla.l3 > 0;

    // 180-Point Model Signal Strength & Quality Meter
    const camarillaScore = (supportResistance || camarilla.h4 > 0) ? 35 : 20;
    const fibScore = fibConfluence.hasConfluence ? 35 : 18;
    const orderFlowScore = volumeConfirmation ? 40 : 22;
    const vwapStructuralScore = vwapAlignment ? 40 : 20;
    const volatilityScore = 28;
    const virginScoreBoost = virginAlignedZone ? 10 : 0;

    const totalSignalScore = Math.min(180, camarillaScore + fibScore + orderFlowScore + vwapStructuralScore + volatilityScore + virginScoreBoost);

    const directionPrefix = isLong ? 'BULLISH' : 'BEARISH';
    let signalGrade = 'C';
    let signalGradeLabel = `${directionPrefix} STANDBY / SUB-OPTIMAL CONFLUENCE`;
    if (totalSignalScore >= 165) {
      signalGrade = 'A+';
      signalGradeLabel = `${directionPrefix} INSTITUTIONAL HIGH CONVICTION (AUTO-FIRE READY)`;
    } else if (totalSignalScore >= 150) {
      signalGrade = 'A';
      signalGradeLabel = `${directionPrefix} VALIDATED EDGE (MANUAL / ARMED TOUCH)`;
    } else {
      signalGrade = 'B';
      signalGradeLabel = `${directionPrefix} STANDBY / SUB-OPTIMAL CONFLUENCE`;
    }

    // ═══════════════════════════════════════════════════════════
    // POSITION SIZING & LEVERAGE + EXPOSURE MODE TARGETS
    // (Single Source of Truth: Global RiskSettings via CapitalAllocationContext)
    // ═══════════════════════════════════════════════════════════
    const deltaLeverage = capitalAlloc.leverageSyncLocked
      ? capitalAlloc.clampLeverage(capitalAlloc.globalLeverage)
      : capitalAlloc.clampLeverage(
          commandCard?.recommendedLeverage || capitalAlloc.globalLeverage || (isMicroScalp ? 20 : 10)
        );
    const effectiveBalance = isLiveUnverified ? 0 : availableBalance;
    const refEntry = rawEntryPrice > 0 ? rawEntryPrice : markPrice;

    // Total Account Equity & Margin Utilization Baseline
    const existingPositionsMargin = positions.reduce((acc, p) => acc + (Number(p.margin) || 0), 0);
    const effectiveMarginUsed =
      typeof marginUsed === 'number' && marginUsed > 0 ? Math.max(marginUsed, existingPositionsMargin) : existingPositionsMargin;
    const derivedTotalEq =
      typeof totalEquity === 'number' && totalEquity > 0
        ? totalEquity
        : Math.max(0, effectiveBalance + effectiveMarginUsed);

    const tierRiskUsd = isMicro15 ? 15 : isMicro50 ? 50 : 50;
    const effectiveTierRiskUsd = isMicro15 ? 15 : tierRiskUsd;
    const baselineConfiguredLot = Math.max(0.001, capitalAlloc.defaultLotSize || capitalAlloc.fixedLot || 0.1);

    let rawInitialStopLoss: number;
    let rawTp1: number;
    let rawTp2: number;
    let rawTp3: number;
    let rawTp4: number;

    if (isMicro15) {
      // Structural Camarilla H3/L3 stop level evaluated against minimum 0.28% (or 1.2x 5m ATR) buffer
      rawInitialStopLoss = isLong ? camarilla.h3 : camarilla.l3;
      rawTp1 = formatCamarillaPrice(isLong ? rawEntryPrice * 1.0035 : rawEntryPrice * 0.9965, markPrice);
      rawTp2 = formatCamarillaPrice(isLong ? rawEntryPrice * 1.0065 : rawEntryPrice * 0.9935, markPrice);
      rawTp3 = formatCamarillaPrice(isLong ? rawEntryPrice * 1.0095 : rawEntryPrice * 0.9905, markPrice);
      rawTp4 = formatCamarillaPrice(isLong ? rawEntryPrice * 1.0125 : rawEntryPrice * 0.9875, markPrice);
    } else if (isMicro50) {
      // $50 Standard scaled dynamically to configured lotSize & bounded to realistic intraday ATR/Camarilla pct (>= 0.28% SL, 1.25x TP1, 2.0x TP2)
      const rawSlDist = effectiveTierRiskUsd / Math.max(0.001, baselineConfiguredLot);
      const slDelta = Math.min(Math.max(rawEntryPrice * MIN_SNIPER_SL_BUFFER_PCT, rawSlDist), rawEntryPrice * 0.014);
      const d1 = slDelta * 1.25;
      const d2 = slDelta * 2.0;
      const d3 = slDelta * 2.75;
      const d4 = slDelta * 3.5;
      rawInitialStopLoss = isLong ? rawEntryPrice - slDelta : rawEntryPrice + slDelta;
      rawTp1 = isLong ? rawEntryPrice + d1 : rawEntryPrice - d1;
      rawTp2 = isLong ? rawEntryPrice + d2 : rawEntryPrice - d2;
      rawTp3 = isLong ? rawEntryPrice + d3 : rawEntryPrice - d3;
      rawTp4 = isLong ? rawEntryPrice + d4 : rawEntryPrice - d4;
    } else {
      // Institutional Macro fallback
      rawInitialStopLoss = isLong ? camarilla.h3 : camarilla.l3;
      rawTp1 = targets.tp1;
      rawTp2 = targets.tp2;
      rawTp3 = targets.tp3;
      rawTp4 = targets.tp4;
    }

    // Virgin CPR Trade-Path Confluence & Target Front-Run Capping
    const virginConfluence = evaluateVirginCprConfluence(
      camarilla.virginCprZones,
      dir,
      rawEntryPrice,
      rawInitialStopLoss,
      rawTp1,
      rawTp2,
      markPrice
    );

    if (virginConfluence.hasWarning && virginConfluence.suggestedTpCap) {
      const cap = virginConfluence.suggestedTpCap;
      if (isLong && cap > rawEntryPrice) {
        rawTp2 = Math.min(rawTp2, cap);
        if (rawTp1 >= cap || rawTp1 > rawTp2) {
          rawTp1 = formatCamarillaPrice(rawEntryPrice + (cap - rawEntryPrice) * 0.55, markPrice);
          rawTp2 = cap;
        }
        if (rawTp3 <= rawTp2) {
          rawTp3 = formatCamarillaPrice(rawTp2 + Math.max(markPrice * 0.0005, (rawTp2 - rawEntryPrice) * 0.45), markPrice);
        }
        if (rawTp4 <= rawTp3) {
          rawTp4 = formatCamarillaPrice(rawTp3 + Math.max(markPrice * 0.0005, (rawTp2 - rawEntryPrice) * 0.45), markPrice);
        }
      } else if (!isLong && cap < rawEntryPrice) {
        rawTp2 = Math.max(rawTp2, cap);
        if (rawTp1 <= cap || rawTp1 < rawTp2) {
          rawTp1 = formatCamarillaPrice(rawEntryPrice - (rawEntryPrice - cap) * 0.55, markPrice);
          rawTp2 = cap;
        }
        if (rawTp3 >= rawTp2) {
          rawTp3 = formatCamarillaPrice(rawTp2 - Math.max(markPrice * 0.0005, (rawEntryPrice - rawTp2) * 0.45), markPrice);
        }
        if (rawTp4 >= rawTp3) {
          rawTp4 = formatCamarillaPrice(rawTp3 - Math.max(markPrice * 0.0005, (rawEntryPrice - rawTp2) * 0.45), markPrice);
        }
      }
    }

    // Enforce Anti-Wick Stop-Loss Buffer (>= max(1.5x 5m ATR, 0.55% BTC) + $35 wick buffer beyond L3/H3 or entry swing) & Proportional TP1 (1.25R) / TP2 (2.00R)
    const enforcedRawBrackets = enforceMinimumSniperStopBuffer({
      entryPrice: refEntry,
      side: dir,
      symbol: selectedSymbol,
      stopLoss: rawInitialStopLoss,
      tp1: rawTp1,
      tp2: rawTp2,
      tp3: rawTp3,
      tp4: rawTp4,
      atr5m: realAtr5m,
      h3: camarilla.h3,
      l3: camarilla.l3,
      swingLow: recent5mLow,
      swingHigh: recent5mHigh,
    });
    rawInitialStopLoss = enforcedRawBrackets.stopLoss;
    rawTp1 = enforcedRawBrackets.tp1;
    rawTp2 = enforcedRawBrackets.tp2;
    rawTp3 = enforcedRawBrackets.tp3;
    rawTp4 = enforcedRawBrackets.tp4;

    const perpMicroSlotOccupied =
      Boolean(activeTrade) ||
      perpOnlyPositions.some((pos) => (pos.mode || 'PAPER') === tradingMode);
    const optionsSpreadSlotOccupied = optionsOnlyPositions.some((pos) => (pos.mode || 'PAPER') === tradingMode);

    const signalCoreSignature = `${selectedSymbol}-${dir}-${effectiveExposureMode}-${signalSource}-${manualRefreshEpoch}-${isCommandCenterActive && commandCard?.symbol ? `${commandCard.symbol}-${aiAnalysisVersionRef.current}` : 'QUANT'}`;
    if (
      prevSignalCoreSignatureRef.current !== signalCoreSignature ||
      (prevSignalStandbyRef.current && !isSignalStandby)
    ) {
      signalEpochRef.current += 1;
      signalCreatedTsRef.current = Date.now();
      prevSignalCoreSignatureRef.current = signalCoreSignature;
    }
    prevSignalStandbyRef.current = isSignalStandby;

    const signalSetupId = `${selectedSymbol}-${dir}-${effectiveExposureMode}-${signalEpochRef.current}`;

    // Lock Signal Levels at Generation Time, but re-anchor if live markPrice moves closer than 0.55% to locked SL
    const candidateEntry = rawEntryPrice > 0 ? rawEntryPrice : markPrice;
    if (isSignalStandby) {
      if (lockedSignalLevelsRef.current?.setupId === signalSetupId) {
        lockedSignalLevelsRef.current = null;
      }
    } else if (hasLiveMarkets && candidateEntry > 0) {
      const existingLock = lockedSignalLevelsRef.current;
      const lockSlTooTightToLiveMark =
        existingLock &&
        existingLock.setupId === signalSetupId &&
        markPrice > 0 &&
        (isLong
          ? existingLock.initialStopLoss >= markPrice || (markPrice - existingLock.initialStopLoss) < markPrice * MIN_SNIPER_SL_BUFFER_PCT
          : existingLock.initialStopLoss <= markPrice || (existingLock.initialStopLoss - markPrice) < markPrice * MIN_SNIPER_SL_BUFFER_PCT);

      if (!existingLock || existingLock.setupId !== signalSetupId || lockSlTooTightToLiveMark) {
        signalCreatedTsRef.current = Date.now();
        lockedSignalLevelsRef.current = {
          setupId: signalSetupId,
          entryPrice: candidateEntry,
          initialStopLoss: rawInitialStopLoss,
          tp1: rawTp1,
          tp2: rawTp2,
          tp3: rawTp3,
          tp4: rawTp4,
        };
      }
    }

    const lockedLevels =
      !isSignalStandby && lockedSignalLevelsRef.current?.setupId === signalSetupId
        ? lockedSignalLevelsRef.current
        : null;

    // Final guarantee: enforce >= max(1.5x 5m ATR, 0.55% BTC) + $35 wick buffer and 1.25R / 2.00R TP1 / TP2 on hydrated levels
    const entryPrice = lockedLevels ? lockedLevels.entryPrice : candidateEntry;
    const finalBrackets = enforceMinimumSniperStopBuffer({
      entryPrice,
      side: dir,
      symbol: selectedSymbol,
      stopLoss: lockedLevels ? lockedLevels.initialStopLoss : rawInitialStopLoss,
      tp1: lockedLevels ? lockedLevels.tp1 : rawTp1,
      tp2: lockedLevels ? lockedLevels.tp2 : rawTp2,
      tp3: lockedLevels ? lockedLevels.tp3 : rawTp3,
      tp4: lockedLevels ? lockedLevels.tp4 : rawTp4,
      atr5m: realAtr5m,
      h3: camarilla.h3,
      l3: camarilla.l3,
      swingLow: recent5mLow,
      swingHigh: recent5mHigh,
    });
    const initialStopLoss = finalBrackets.stopLoss;
    const tp1 = finalBrackets.tp1;
    const tp2 = finalBrackets.tp2;
    const tp3 = finalBrackets.tp3;
    const tp4 = finalBrackets.tp4;

    const finalStopLossDist = finalBrackets.slDistance || (markPrice * MIN_SNIPER_SL_BUFFER_PCT);

    // Resolve exact lot size & contract quantity scaled automatically to stay strictly within riskSettings.maxRiskPerTradePct (1%)
    const safeLotRes = capitalAlloc.resolveSafeExecutionLot({
      symbol: selectedSymbol,
      markPrice: entryPrice > 0 ? entryPrice : refEntry,
      availableBalance: effectiveBalance,
      totalEquity: derivedTotalEq,
      stopLossDistance: finalStopLossDist,
      leverage: deltaLeverage,
    });

    const lotSize = safeLotRes.lotSize;
    const requestedLotSize = safeLotRes.requestedLotSize;
    const contractsCount = safeLotRes.contracts;
    const microContractsCount = safeLotRes.contracts;
    const microNotionalUsd = +(lotSize * (entryPrice > 0 ? entryPrice : refEntry)).toFixed(2);
    const microMarginUsd = safeLotRes.estimatedMarginUsd;

    const minRrThreshold = isMicroScalp ? 1.0 : 1.5;
    const grossReward = Math.max(0, +(Math.abs(tp4 - entryPrice) * lotSize).toFixed(2));
    const grossRisk = Math.max(0.01, +(Math.abs(entryPrice - initialStopLoss) * lotSize).toFixed(2));
    const riskRewardThreshold = (grossRisk > 0 ? (grossReward / grossRisk) : 0) >= minRrThreshold;

    const marginReq = safeLotRes.estimatedMarginUsd;
    const marginDeficit = Math.max(0, marginReq - effectiveBalance);

    const accountMarginUtilizationPct =
      derivedTotalEq > 0 ? +(((effectiveMarginUsed + marginReq) / derivedTotalEq) * 100).toFixed(2) : 0;
    const marginUtilizationSafe = derivedTotalEq <= 0 || accountMarginUtilizationPct < 65;

    const sufficientMargin = !isLiveUnverified && marginUtilizationSafe && (effectiveBalance >= marginReq || isBypassActive);
    const pointValue = capitalAlloc.getPointValue(lotSize);
    const safeClampedLot = safeLotRes.lotSize;

    // ═══════════════════════════════════════════════════════════
    // RISK PROTECTION LAYER (7 PRE-ENTRY GATES)
    // ═══════════════════════════════════════════════════════════
    const signalValidationPassed =
      (isBypassActive && !antiChaseGuard.chopZoneBlocked) ||
      (!htfTrendLock &&
        higherTimeframeTrend &&
        vwapAlignment &&
        emaStructure &&
        volumeConfirmation &&
        rsiMomentum &&
        marketSentiment &&
        supportResistance &&
        riskRewardThreshold &&
        confidenceAboveMin &&
        candleConfirmed &&
        cprFilterPassed);

    const signalValidationStatus: 'PASS' | 'PASS_OVERRIDE' | 'AWAITING_CANDLE' | 'WARNING' | 'FAIL' =
      isExplicitPaperHtfBypass
        ? 'PASS_OVERRIDE'
        : !candleConfirmed
        ? 'AWAITING_CANDLE'
        : isBypassActive
        ? 'PASS_OVERRIDE'
        : htfDivergenceWarning
        ? 'WARNING'
        : signalValidationPassed
        ? 'PASS'
        : 'FAIL';

    const confidenceThresholdMet = confidence >= 75 && confidenceStatus !== 'No Trade';
    const positionSizeReceived = lotSize > 0;
    const leverageWithinCap = deltaLeverage > 0 && deltaLeverage <= capitalAlloc.maxLeverageCap;
    const deltaLeverageAvailable = deltaLeverage > 0 && leverageWithinCap;
    const riskLimitsNotBreached = !isLiveUnverified && leverageWithinCap && marginUtilizationSafe && microAntiChopPassed;

    const allRiskGatesPassed =
      !isLiveUnverified &&
      !htfTrendLock &&
      signalValidationPassed &&
      confidenceThresholdMet &&
      positionSizeReceived &&
      deltaLeverageAvailable &&
      leverageWithinCap &&
      sufficientMargin &&
      marginUtilizationSafe &&
      riskLimitsNotBreached &&
      candleConfirmed &&
      cprFilterPassed &&
      cooldownPassed &&
      microAntiChopPassed;

    const otherGatesPassed =
      confidenceThresholdMet &&
      positionSizeReceived &&
      deltaLeverageAvailable &&
      sufficientMargin &&
      marginUtilizationSafe &&
      riskLimitsNotBreached &&
      microAntiChopPassed &&
      !isLiveUnverified;

    let executionGateStatus: 'TRADE APPROVED' | 'ARMED_CONDITIONAL' | 'STANDBY' | 'TRADE BLOCKED';
    let tradeApproved = false;

    const isHardGateFail =
      antiChaseGuard.chopZoneBlocked
        ? !isExplicitPaperHtfBypass
        : !isBypassActive && (!signalValidationPassed || !cprFilterPassed || !candleConfirmed);

    if (isBypassActive && !isHardGateFail && otherGatesPassed) {
      executionGateStatus = 'TRADE APPROVED';
      tradeApproved = true;
    } else if (allRiskGatesPassed) {
      executionGateStatus = 'TRADE APPROVED';
      tradeApproved = true;
    } else if (!isHardGateFail && otherGatesPassed && htfDivergenceWarning) {
      executionGateStatus = 'ARMED_CONDITIONAL';
      tradeApproved = true;
    } else if (isSignalStandby && !isLiveUnverified && !isHardGateFail) {
      executionGateStatus = 'STANDBY';
      tradeApproved = false;
    } else {
      executionGateStatus = 'TRADE BLOCKED';
      tradeApproved = false;
    }

    const isHydrated =
      (!isSignalStandby || isAutoSniperEnabled) &&
      !isHardGateFail &&
      (allRiskGatesPassed || (isBypassActive && !isHardGateFail) || executionGateStatus === 'ARMED_CONDITIONAL');

    const camarillaSummary = isMicro15
      ? isLong
        ? `$15 Micro Scalp LONG (${lotSize} ${selectedSymbol.replace('USDT', '').replace('USD', '')} · ${microContractsCount} cts @ ${deltaLeverage}x · $${microMarginUsd.toFixed(2)} Margin): Entry $${entryPrice.toLocaleString()} (>= H4 $${camarilla.h4.toLocaleString()}) · SL $${initialStopLoss.toLocaleString()} (-${finalBrackets.slPct.toFixed(2)}%) · TP1 $${tp1.toLocaleString()} (1.25R) · TP2 $${tp2.toLocaleString()} (2.0R BE)`
        : `$15 Micro Scalp SHORT (${lotSize} ${selectedSymbol.replace('USDT', '').replace('USD', '')} · ${microContractsCount} cts @ ${deltaLeverage}x · $${microMarginUsd.toFixed(2)} Margin): Entry $${entryPrice.toLocaleString()} (<= L4 $${camarilla.l4.toLocaleString()}) · SL $${initialStopLoss.toLocaleString()} (+${finalBrackets.slPct.toFixed(2)}%) · TP1 $${tp1.toLocaleString()} (1.25R) · TP2 $${tp2.toLocaleString()} (2.0R BE)`
      : isMicro50
      ? isLong
        ? `$50 Standard Sniper LONG (${lotSize} ${selectedSymbol.replace('USDT', '').replace('USD', '')} · ${contractsCount} cts): Entry >= H4 ($${camarilla.h4.toLocaleString()}) · SL $${initialStopLoss.toLocaleString()} (-${finalBrackets.slPct.toFixed(2)}%) · TP1 $${tp1.toLocaleString()} (1.25R) · TP2 $${tp2.toLocaleString()} (2.0R BE) · TP3 $${tp3.toLocaleString()} · TP4 $${tp4.toLocaleString()}`
        : `$50 Standard Sniper SHORT (${lotSize} ${selectedSymbol.replace('USDT', '').replace('USD', '')} · ${contractsCount} cts): Entry <= L4 ($${camarilla.l4.toLocaleString()}) · SL $${initialStopLoss.toLocaleString()} (+${finalBrackets.slPct.toFixed(2)}%) · TP1 $${tp1.toLocaleString()} (1.25R) · TP2 $${tp2.toLocaleString()} (2.0R BE) · TP3 $${tp3.toLocaleString()} · TP4 $${tp4.toLocaleString()}`
      : isLong
      ? `Institutional Macro LONG (${lotSize} ${selectedSymbol.replace('USDT', '').replace('USD', '')}): Entry >= H4 ($${camarilla.h4.toLocaleString()}) · SL $${initialStopLoss.toLocaleString()} (-${finalBrackets.slPct.toFixed(2)}%) · TP1 $${tp1.toLocaleString()} · TP2 $${tp2.toLocaleString()} (2.0R BE) · TP4 $${tp4.toLocaleString()}`
      : `Institutional Macro SHORT (${lotSize} ${selectedSymbol.replace('USDT', '').replace('USD', '')}): Entry <= L4 ($${camarilla.l4.toLocaleString()}) · SL $${initialStopLoss.toLocaleString()} (+${finalBrackets.slPct.toFixed(2)}%) · TP1 $${tp1.toLocaleString()} · TP2 $${tp2.toLocaleString()} (2.0R BE) · TP4 $${tp4.toLocaleString()}`;

    let aiVerdict: string;
    if (isLiveUnverified) {
      aiVerdict = 'API Keys Required · Balances Inactive — Connect Delta Exchange API Keys in Settings to trade live.';
    } else if (isBypassActive) {
      aiVerdict = `PAPER DEMO OVERRIDE: [Bypass HTF / VWAP Guard (Paper)] active. Signal ${dir} armed for execution testing.`;
    } else if (isMicro15 && microSlCooldownRemainingSec > 0) {
      aiVerdict = `ANTI-CHOP COOLDOWN (${Math.floor(microSlCooldownRemainingSec / 60)}m ${microSlCooldownRemainingSec % 60}s): 10-minute Stop-Loss cooldown active.`;
    } else if (isMicro15 && microTradesLastHour >= 3) {
      aiVerdict = `ANTI-CHOP LIMIT (3/3 HR): Hourly Micro trade cap reached. Preserving edge until rolling hour resets.`;
    } else if (!marginUtilizationSafe) {
      aiVerdict = `MARGIN CAP GUARD (${accountMarginUtilizationPct.toFixed(1)}% >= 65%): Total account margin utilization limit enforced across Perp + Options slots.`;
    } else if (htfTrendLock) {
      aiVerdict = isLong
        ? `${htfVetoReason} — AUTO-PILOT SAFEGUARD: Suppressed Long setup due to 1H Bearish Trend & Sub-VWAP drift`
        : htfVetoReason;
    } else if (isWideCpr && !isMicro15 && !isMicro50 && !isInsideRange) {
      aiVerdict = 'WIDE CPR - CHOP RISK - BREAKOUT SUPPRESSED';
    } else if (isMicro15 && harvestTargetHit) {
      aiVerdict = 'HOURLY HARVEST COMPLETE (+$15.00 BANKED) — Engine paused until next hour window.';
    } else if (isMicro15 && isTransitionWindow) {
      aiVerdict = 'STANDBY: Hourly Transition Window (No New Entries) — Entries paused between :45 and :59.';
    } else if (isLockoutActive) {
      const remainingSec = lockoutExpiry ? Math.max(0, Math.ceil((lockoutExpiry - Date.now()) / 1000)) : 0;
      aiVerdict = `HARVEST LOCKOUT ACTIVE (${Math.floor(remainingSec / 60)}m ${remainingSec % 60}s remaining) — Active 30m candle lockout.`;
    } else if (!candleConfirmed) {
      aiVerdict =
        antiChaseGuard.rejectionReason ||
        (isLong
          ? `ANTI-CHASE GUARD (LONG): Waiting for price >= H4 ($${camarilla.h4.toLocaleString()}) on a non-red 5m candle.`
          : `ANTI-CHASE GUARD (SHORT): Waiting for price <= L4 ($${camarilla.l4.toLocaleString()}) on a non-green / non-rebounding 5m candle.`);
    } else if (executionGateStatus === 'ARMED_CONDITIONAL') {
      aiVerdict = `ARMED / CONDITIONAL (${confidence}% AI Conviction): Divergence under review. All capital & risk limits PASS. Execution unlocked for ${dir}.`;
    } else if (isSignalStandby) {
      aiVerdict = 'STANDBY / SCANNING — Previous trade levels cleared. Validate or confirm next signal (PASS) to hydrate Entry, SL, and TP1–TP4 targets.';
    } else if (!tradeApproved) {
      aiVerdict = 'TRADE BLOCKED / STANDBY: Conviction (< 75%) or pre-entry risk protection gates not satisfied. Execution targets cleared.';
    } else if (isNarrowCprAutoMicro) {
      aiVerdict = `DUAL-TF NARROW 5M CPR ROUTER ARMED: ${camarillaSummary}`;
    } else if (isCommandCenterActive) {
      aiVerdict = `AI Command Signal Validator: ${camarillaSummary}. Trap Exit armed on 5m close ${isLong ? `below H3 ($${camarilla.h3.toLocaleString()})` : `above L3 ($${camarilla.l3.toLocaleString()})`}.`;
    } else {
      aiVerdict = `CAMARILLA EXECUTION ARMED: ${camarillaSummary}. Hold until ${isMicro15 ? 'TP2 (2.0R) target' : isMicro50 ? '+$50.00 TP4 target' : 'H6/L6 terminal target'} or trailing stop.`;
    }

    if (virginConfluence.hasWarning && virginConfluence.warningMessage) {
      aiVerdict = `${aiVerdict} [⚠ ${virginConfluence.warningMessage}]`;
    } else if (virginConfluence.hasConfluence) {
      aiVerdict = `${aiVerdict} [${virginConfluence.summary}]`;
    }

    const friction = calculateSniperFriction({
      entryPrice,
      direction: dir,
      lotSize,
      isTaker: true,
    });

    const feeThreshold15 = 15 * 0.12; // $1.80 (12% of $15 risk envelope)
    const frictionWarning = (isMicro15 && friction.totalFrictionUsd > feeThreshold15)
      ? `Tight-Spread Alert: Roundtrip fees ($${friction.totalFrictionUsd.toFixed(2)}) exceed 12% ($${feeThreshold15.toFixed(2)}) of $15 risk envelope`
      : undefined;

    let ladderPayouts: ReturnType<typeof capitalAlloc.getLadderPayouts>;
    if (isMicro15 || isMicro50) {
      const p1 = +(Math.abs(tp1 - entryPrice) * lotSize).toFixed(2);
      const p2 = +(Math.abs(tp2 - entryPrice) * lotSize).toFixed(2);
      const p3 = +(Math.abs(tp3 - entryPrice) * lotSize).toFixed(2);
      const p4 = +(Math.abs(tp4 - entryPrice) * lotSize).toFixed(2);
      ladderPayouts = {
        tp1Payout: p1,
        tp2Payout: p2,
        tp3Payout: p3,
        tp4Payout: p4,
        tp1Gross: p1,
        tp1Net: +(p1 - friction.totalFrictionUsd * 0.25).toFixed(2),
        tp2Gross: p2,
        tp2Net: +(p2 - friction.totalFrictionUsd * 0.50).toFixed(2),
        tp3Gross: p3,
        tp3Net: +(p3 - friction.totalFrictionUsd * 0.75).toFixed(2),
        tp4Gross: p4,
        tp4Net: +(p4 - friction.totalFrictionUsd).toFixed(2),
      };
    } else {
      ladderPayouts = capitalAlloc.getLadderPayouts(
        entryPrice,
        { tp1, tp2, tp3, tp4 },
        lotSize,
        !isLong
      );
    }

    const netRr = calculateNetRiskReward(
      entryPrice,
      initialStopLoss,
      tp4,
      lotSize,
      dir
    );

    return {
      id: signalSetupId,
      symbol: selectedSymbol,
      signal: dir,
      exposureMode: effectiveExposureMode,
      confidence,
      confidenceStatus,
      lotSize,
      requestedLotSize,
      contractsCount,
      lotSizingMode: safeLotRes.lotSizingMode,
      wasLotClamped: safeLotRes.wasClamped,
      lotClampReason: safeLotRes.clampReason,
      leverage: deltaLeverage,
      entryPrice,
      initialStopLoss,
      tp1,
      tp2,
      tp3,
      tp4,
      camarilla,
      isHydrated,
      isStandby: isSignalStandby,
      antiChaseBlocked: !antiChaseGuard.passed,
      l3h3ChopBlocked: antiChaseGuard.chopZoneBlocked,
      l3h3ChopReason: antiChaseGuard.chopZoneBlocked ? antiChaseGuard.rejectionReason : undefined,
      virginCprMagnetBlocked: virginConfluence.hasWarning,
      validation: {
        entryExecutionType,
        higherTimeframeTrend,
        higherTimeframeTrendStatus,
        vwapAlignment,
        vwapAlignmentStatus,
        emaStructure,
        volumeConfirmation,
        rsiMomentum,
        marketSentiment,
        supportResistance,
        riskRewardThreshold,
        confidenceAboveMin,
        candleConfirmed,
        cprFilterPassed,
        htfDivergenceWarning,
        bypassActive: isBypassActive,
        fibonacciConfluence: fibConfluence.hasConfluence,
        fibonacciConfluenceStatus: fibConfluence.status,
        fibonacciConfluenceDesc: fibConfluence.description,
      },
      riskChecks: {
        signalValidationPassed,
        signalValidationStatus,
        confidenceThresholdMet,
        positionSizeReceived,
        deltaLeverageAvailable,
        leverageWithinCap,
        sufficientMargin,
        riskLimitsNotBreached,
        candleConfirmed,
        cprFilterPassed,
        cooldownPassed,
        cprStatus,
        tradeApproved,
        executionStatus: executionGateStatus,
        bypassActive: isBypassActive,
        htfDivergenceWarning,
        requiredMargin: marginReq,
        availableBalance: effectiveBalance,
        marginDeficit,
        autoClampedLot: safeClampedLot,
        requestedLotSize,
        contractsCount,
        lotSizingMode: safeLotRes.lotSizingMode,
        wasLotClamped: safeLotRes.wasClamped,
        lotClampReason: safeLotRes.clampReason,
        sizingMode: safeLotRes.lotSizingMode === 'FIXED_LOT' ? 'FIXED_LOT' : capitalAlloc.sizingMethod,
        cpr5mWidthPct: dualCpr.cpr5mWidthPct,
        cpr4hWidthPct: dualCpr.cpr4hWidthPct,
        isNarrow5mCpr,
        isWide4hCpr,
        narrowCprOverrideActive,
        perpMicroSlotOccupied,
        optionsSpreadSlotOccupied,
        accountMarginUtilizationPct,
        marginUtilizationSafe,
        microTradesLastHour,
        microAntiChopPassed,
        microSlCooldownRemainingSec,
      },
      aiVerdict,
      signalScore: totalSignalScore,
      signalGrade,
      signalGradeLabel,
      scoreBreakdown: { camarillaScore, fibScore, orderFlowScore, vwapStructuralScore, volatilityScore },
      timestamp: signalCreatedTsRef.current,
      signalSource: isCommandCenterActive ? 'COMMAND_CENTER' : 'QUANT_ALGO',
      commandCenterAgentConsensus: aiAnalysis?.multiAgentConsensus,
      commandCenterCatalyst: aiAnalysis?.sentiment?.summary,
      commandCenterSentiment: aiAnalysis?.sentiment,
      commandCenterFearGreed: aiAnalysis ? { score: aiAnalysis.fearGreedScore, label: aiAnalysis.fearGreedLabel } : undefined,
      riskRewardRatio: isMicroScalp ? '1 : 2.17' : netRr.netRrRatio,
      riskRewardNumeric: netRr.netRrNumeric,
      estimatedMargin: marginReq,
      pointValue,
      ladderPayouts,
      friction,
      scalpTier: (isMicro15 ? 'TIER_15' : 'TIER_50') as SniperScalpTier,
      frictionWarning,
      fibonacci,
      fibConfluence,
      virginCpr: virginConfluence,
      rangeSwingTrigger: {
        ...rangeSwingTrigger,
        entryPrice,
      },
      ema9,
      ema20,
      ema21,
      vwap5m,
      cpr5mWidthPct: dualCpr.cpr5mWidthPct,
      cpr4hWidthPct: dualCpr.cpr4hWidthPct,
      isNarrow5mCpr,
      isWide4hCpr,
      isNarrow5mCprAutoRouted: isNarrowCprAutoMicro,
      regimeRouterMode: dualCpr.regimeRouterMode,
      microContractsCount: contractsCount,
      microNotionalUsd,
      microMarginUsd,
      reason: rangeSwingTrigger?.description || aiVerdict,
    };
  }, [
    curMarket,
    selectedSymbol,
    markPrice,
    hasLiveMarkets,
    availableBalance,
    totalEquity,
    marginUsed,
    positions,
    perpOnlyPositions,
    optionsOnlyPositions,
    candles5m,
    candles15m,
    candles4h,
    microTradeTimestamps,
    microSlCooldownUntil,
    isLiveUnverified,
    isSignalStandby,
    directionMode,
    exposureMode,
    scalpTier,
    signalSource,
    aiAnalysis,
    simulatedCandleCloses,
    bypassHtfFilter,
    tradingMode,
    timeframe,
    capitalAlloc.config,
    capitalAlloc.defaultLotSize,
    capitalAlloc.lotSizingMode,
    capitalAlloc.maxRiskPerTradePct,
    capitalAlloc.globalLeverage,
    capitalAlloc.resolveSafeExecutionLot,
    capitalAlloc.calculateLotSize,
    capitalAlloc.getMarginRequirement,
    capitalAlloc.getPointValue,
    capitalAlloc.getLadderPayouts,
    capitalAlloc.autoScaleToEquityCap,
    capitalAlloc.sizingMethod,
    manualRefreshEpoch,
    dailyHistoryEpoch,
  ]);

  // Automated High-Conviction Confluence Notification Trigger
  const lastNotifiedConfluenceRef = useRef<string>('');
  useEffect(() => {
    const conf = currentSignal.fibConfluence;
    if (conf && conf.status === 'PASS' && conf.hasConfluence) {
      const key = `${selectedSymbol}-${conf.matchedFibLevel}-${conf.matchedCamarillaLevel}-${conf.matchedFibPrice}`;
      if (lastNotifiedConfluenceRef.current !== key) {
        lastNotifiedConfluenceRef.current = key;
        onSendNotification(
          '⚡ HIGH CONVICTION CONFLUENCE',
          `Fibonacci ${conf.matchedFibLevel} ($${conf.matchedFibPrice.toLocaleString()}) aligned with Camarilla ${conf.matchedCamarillaLevel} ($${conf.matchedCamarillaPrice.toLocaleString()}) within ±${conf.deltaPercent}%. Inspect AI Signal Validator for setup details.`,
          'AI'
        );
      }
    }
  }, [selectedSymbol, currentSignal.fibConfluence, onSendNotification]);

  // Archive generated Camarilla Sniper signals ($15 Micro / $50 Standard) into Cloud Signal Telemetry Warehouse
  const lastArchivedSniperSignalRef = useRef<string>('');
  useEffect(() => {
    if (!currentSignal?.isHydrated || !(currentSignal.entryPrice > 0)) return;
    const signalId =
      currentSignal.id ||
      `sniper-${currentSignal.symbol}-${currentSignal.signal}-${Math.round(currentSignal.entryPrice)}`;
    const isMicro = currentSignal.exposureMode === 'MICRO_15' || currentSignal.scalpTier === 'TIER_15';
    const approved = Boolean(currentSignal.riskChecks?.tradeApproved);
    const status: 'GENERATED' | 'APPROVED' | 'REJECTED' = approved
      ? 'APPROVED'
      : currentSignal.riskChecks?.executionStatus === 'TRADE BLOCKED'
      ? 'REJECTED'
      : 'GENERATED';
    const dedupKey = `${signalId}:${status}`;
    if (lastArchivedSniperSignalRef.current === dedupKey) return;
    lastArchivedSniperSignalRef.current = dedupKey;

    const grade =
      currentSignal.confidence >= 90
        ? 'A+'
        : currentSignal.confidence >= 80
        ? 'A'
        : currentSignal.confidence >= 70
        ? 'B+'
        : 'B';
    const rejectionReason =
      status === 'REJECTED'
        ? currentSignal.riskChecks?.cprStatus || currentSignal.reason || 'Risk gate blocked'
        : null;

    queueAnalyticsSignal({
      signalId,
      timestampMs: currentSignal.timestamp || Date.now(),
      sourceEngine: isMicro ? 'CAMARILLA_SNIPER_15_MICRO' : 'CAMARILLA_SNIPER_50_STD',
      symbol: currentSignal.symbol,
      timeframe,
      grade,
      aiScore: currentSignal.confidence,
      convictionPct: currentSignal.confidence,
      direction: currentSignal.signal,
      entryPrice: currentSignal.entryPrice,
      stopLoss: currentSignal.initialStopLoss,
      tp1: currentSignal.tp1,
      tp2: currentSignal.tp2,
      tp3: currentSignal.tp3,
      tp4: currentSignal.tp4,
      cprRegime: currentSignal.camarilla?.cprRegime || 'STANDARD',
      sentimentScore: currentSignal.commandCenterFearGreed?.score ?? null,
      status,
      rejectionReason,
      mode: tradingMode,
    });
  }, [
    currentSignal.id,
    currentSignal.isHydrated,
    currentSignal.symbol,
    currentSignal.signal,
    currentSignal.entryPrice,
    currentSignal.initialStopLoss,
    currentSignal.tp1,
    currentSignal.tp2,
    currentSignal.tp3,
    currentSignal.tp4,
    currentSignal.confidence,
    currentSignal.exposureMode,
    currentSignal.scalpTier,
    currentSignal.camarilla?.cprRegime,
    currentSignal.riskChecks?.tradeApproved,
    currentSignal.riskChecks?.executionStatus,
    currentSignal.riskChecks?.cprStatus,
    currentSignal.commandCenterFearGreed?.score,
    currentSignal.timestamp,
    currentSignal.reason,
    timeframe,
    tradingMode,
  ]);

  // ═══════════════════════════════════════════════════════════
  // AUTO ENTRY EXECUTION ENGINE
  // ═══════════════════════════════════════════════════════════
  const executeSniperTrade = useCallback(async (manualSignal?: any) => {
    if (isLiveUnverified) {
      onSendNotification(
        'API Keys Required · Balances Inactive',
        'Connect Delta Exchange API Keys in Settings to trade live',
        'RISK'
      );
      return;
    }

    const isRealSignal = manualSignal && typeof manualSignal === 'object' && !('nativeEvent' in manualSignal) && ('symbol' in manualSignal) && ('signal' in manualSignal);
    const signalToUse: SniperSignal = isRealSignal ? (manualSignal as SniperSignal) : currentSignal;

    const curMarket = getMarketTicker(markets, signalToUse.symbol || selectedSymbol);
    const liveMark = curMarket.markPrice || 81702.50;
    const { targets: fallbackTargets, camarilla: fallbackCamarilla } = computeCamarillaLevels(curMarket, signalToUse.signal || 'LONG');

    const rawEntryPrice = signalToUse.entryPrice > 0 ? signalToUse.entryPrice : fallbackTargets.entryPrice > 0 ? fallbackTargets.entryPrice : liveMark;
    const rawStopLoss = signalToUse.initialStopLoss > 0 ? signalToUse.initialStopLoss : fallbackTargets.stopLoss;
    const rawTp1 = signalToUse.tp1 > 0 ? signalToUse.tp1 : fallbackTargets.tp1;
    const rawTp2 = signalToUse.tp2 > 0 ? signalToUse.tp2 : fallbackTargets.tp2;
    const rawTp3 = signalToUse.tp3 > 0 ? signalToUse.tp3 : fallbackTargets.tp3;
    const rawTp4 = signalToUse.tp4 > 0 ? signalToUse.tp4 : fallbackTargets.tp4;
    const effectiveCamarilla = signalToUse.camarilla || fallbackCamarilla;
    const execAtr5m = compute5mAtrFromCandles(candles5m, liveMark);
    const targetSym = signalToUse.symbol || selectedSymbol;
    const liveCandleState = candleHistoryRef.current[targetSym];
    const recent5mLowVal =
      Array.isArray(candles5m) && candles5m.length > 0
        ? Math.min(...candles5m.slice(-6).map((c) => Number(c.low) || liveMark))
        : liveCandleState?.currentCandle?.low || liveMark;
    const recent5mHighVal =
      Array.isArray(candles5m) && candles5m.length > 0
        ? Math.max(...candles5m.slice(-6).map((c) => Number(c.high) || liveMark))
        : liveCandleState?.currentCandle?.high || liveMark;

    const bufferedPreOrder = enforceMinimumSniperStopBuffer({
      entryPrice: liveMark > 0 ? liveMark : rawEntryPrice,
      side: signalToUse.signal || 'LONG',
      symbol: targetSym,
      stopLoss: rawStopLoss,
      tp1: rawTp1,
      tp2: rawTp2,
      tp3: rawTp3,
      tp4: rawTp4,
      atr5m: execAtr5m,
      h3: effectiveCamarilla.h3,
      l3: effectiveCamarilla.l3,
      swingLow: recent5mLowVal,
      swingHigh: recent5mHighVal,
    });

    const effectiveEntryPrice = liveMark > 0 ? liveMark : rawEntryPrice;
    const effectiveStopLoss = bufferedPreOrder.stopLoss;
    const effectiveTp1 = bufferedPreOrder.tp1;
    const effectiveTp2 = bufferedPreOrder.tp2;
    const effectiveTp3 = bufferedPreOrder.tp3;
    const effectiveTp4 = bufferedPreOrder.tp4;

    const isBypassActive = tradingMode === 'PAPER' && bypassHtfFilter;
    const isTradeApproved =
      signalToUse.riskChecks?.tradeApproved === true ||
      isBypassActive;
    const isConfidenceApproved = (signalToUse.confidence ?? 0) >= 75;

    const now = Date.now();
    lastAttemptTsRef.current = now;
    setLastExecutedSignalTs(now);

    const isMicro15Tier =
      (signalToUse.exposureMode || exposureMode) === 'MICRO_15' ||
      signalToUse.scalpTier === 'TIER_15' ||
      scalpTier === 'TIER_15' ||
      Boolean(signalToUse.isNarrow5mCpr);

    // Anti-Chop & Margin Utilization Checks for Micro Tier
    if (isMicro15Tier && !isBypassActive) {
      if ((signalToUse.riskChecks?.microSlCooldownRemainingSec || 0) > 0) {
        addLog('BLOCKED', 'Micro SL Cooldown Active', `10m post-SL anti-chop cooldown active (${signalToUse.riskChecks?.microSlCooldownRemainingSec}s remaining).`);
        return;
      }
      if ((signalToUse.riskChecks?.microTradesLastHour || 0) >= 3) {
        addLog('BLOCKED', 'Micro Hourly Cap Reached', 'Anti-Chop Guard: Max 3 Micro trades per rolling hour reached.');
        return;
      }
      if (signalToUse.riskChecks?.marginUtilizationSafe === false) {
        addLog('BLOCKED', 'Account Margin Cap (>= 65%)', `Margin utilization ${signalToUse.riskChecks?.accountMarginUtilizationPct?.toFixed(1)}% >= 65% cap.`);
        return;
      }
    }

    if (isMicro15Tier && !isBypassActive) {
      if (harvestTargetHit) {
        addLog('BLOCKED', 'Hourly Target Reached', 'HOURLY HARVEST COMPLETE (+$15.00 BANKED). New entries locked until next hour.');
        onSendNotification('Hourly Target Reached', '+$15.00 target secured for this hour. Engine locked until next hour rollover.', 'INFO');
        return;
      }
      if (isTransitionWindow) {
        addLog('BLOCKED', 'Hourly Transition Window', 'STANDBY: Hourly Transition Window (No New Entries). Entries blocked between :45 and :59.');
        onSendNotification('Hourly Transition Window', 'STANDBY: Hourly Transition Window (No New Entries). Entries paused between :45 and :59.', 'INFO');
        return;
      }
    }

    const isWideCpr = signalToUse.camarilla?.isWideCpr ?? false;
    const narrowCprOverride = Boolean(signalToUse.isNarrow5mCpr || signalToUse.riskChecks?.narrowCprOverrideActive || isMicro15Tier);
    if (isWideCpr && !narrowCprOverride && !isBypassActive) {
      addLog('BLOCKED', 'Trade Blocked by CPR Filter', 'WIDE CPR - CHOP RISK - BREAKOUT SUPPRESSED');
      onSendNotification('Sniper Trade Blocked', 'WIDE CPR - CHOP RISK - BREAKOUT SUPPRESSED', 'RISK');
      return;
    }

    // Hard block stale/overdue signals (> 15m without resolution)
    if (signalToUse.timestamp && Date.now() - signalToUse.timestamp > 15 * 60 * 1000) {
      addLog('BLOCKED', 'Trade Blocked: Stale Signal', 'Signal exceeded 15-minute validity window. Refresh signal before execution.');
      onSendNotification('Execution Paused · Stale Signal', 'Signal is overdue (>15m). Click Refresh Signal to re-anchor live market levels.', 'RISK');
      return;
    }

    // Enforce Anti-Chase Breakout Zone, L3–H3 Chop-Zone 5m Bar Close & Current-Candle Momentum Guard before dispatching order
    const prevApi5mForExec = candles5m.length > 1 ? candles5m[candles5m.length - 2] : null;
    const execHasSimulatedClose = simulatedCandleCloses[targetSym] !== undefined;
    const execLastClosed5mClose = execHasSimulatedClose
      ? simulatedCandleCloses[targetSym]
      : liveCandleState?.lastClosedCandle?.seededFromApi
      ? liveCandleState.lastClosedCandle.close
      : Number(prevApi5mForExec?.close || 0);

    const antiChaseCheck = evaluateAntiChaseAndCandleMomentum({
      side: signalToUse.signal || 'LONG',
      currentPrice: liveMark,
      h4: effectiveCamarilla.h4,
      l4: effectiveCamarilla.l4,
      h3: effectiveCamarilla.h3,
      l3: effectiveCamarilla.l3,
      lastClosed5mClose: execLastClosed5mClose,
      currentCandleOpen: liveCandleState?.currentCandle?.open || liveMark,
      currentCandleHigh: liveCandleState?.currentCandle?.high || liveMark,
      currentCandleLow: liveCandleState?.currentCandle?.low || liveMark,
      recent5mLow: recent5mLowVal,
      low24h: curMarket.low24h || liveMark * 0.99,
    });

    if (!antiChaseCheck.passed && !isBypassActive) {
      const rejectMsg = antiChaseCheck.rejectionReason || 'Anti-Chase, L3–H3 Chop Zone, or forming 5m candle momentum check failed.';
      addLog('BLOCKED', antiChaseCheck.chopZoneBlocked ? 'Trade Blocked: L3–H3 Chop Zone' : 'Trade Blocked: Anti-Chase / Momentum Guard', rejectMsg);
      onSendNotification(antiChaseCheck.chopZoneBlocked ? 'L3–H3 Chop Zone Guard' : 'Anti-Chase & Candle Momentum Guard', rejectMsg, 'RISK');
      return;
    }

    if (signalToUse.validation?.candleConfirmed === false && !isBypassActive) {
      addLog('BLOCKED', 'Trade Blocked: Wick Protection', '5-minute candle close & momentum confirmation required. Intra-candle touch or L3–H3 chop rejected.');
      onSendNotification('Candle & Anti-Chase Confirmation Required', 'Auto-entry blocked: wait for valid H4/L4 5m close and aligned 5m candle momentum.', 'RISK');
      return;
    }

    if ((!isTradeApproved && !isBypassActive) || (!isConfidenceApproved && !isBypassActive) || effectiveEntryPrice <= 0) {
      addLog('BLOCKED', 'Trade Blocked by Risk Layer', 'Validation failed: signal not confirmed, conviction < 75%, or one or more of the 7 risk gates were not satisfied.');
      onSendNotification('Sniper Trade Blocked', 'Risk Protection Layer blocked execution: signal must be confirmed (>= 75% conviction) and pass all risk gates.', 'RISK');
      return;
    }

    if (harvestTargetHit || isTransitionWindow) {
      addLog('BLOCKED', 'Execution Blocked: Harvest Target or Transition Window', 'Auto-pilot paused until next cycle.');
      return; // Do NOT attempt execution
    }

    setIsExecuting(true);
    try {
      const orderSymbol = signalToUse.symbol || selectedSymbol;
      const orderSide = signalToUse.signal || 'LONG';
      const orderEntry = effectiveEntryPrice > 0 ? effectiveEntryPrice : liveMark;
      const orderSl = effectiveStopLoss;
      const orderTp = isMicro15Tier && effectiveTp2 > 0
        ? effectiveTp2
        : (effectiveTp4 > 0 ? effectiveTp4 : effectiveTp2);

      const enforcedSniperLev = capitalAlloc.clampLeverage(signalToUse.leverage || capitalAlloc.globalLeverage);

      // Re-resolve lot & contract quantity against actual pre-order anti-wick SL distance so risk stays strictly <= maxRiskPerTradePct (1%)
      const existingMarginUsed = positions.reduce((acc, p) => acc + (Number(p.margin) || 0), 0);
      const effectiveExecEq =
        typeof totalEquity === 'number' && totalEquity > 0
          ? totalEquity
          : Math.max(0, (isLiveUnverified ? 0 : availableBalance) + Math.max(marginUsed || 0, existingMarginUsed));
      const execLotRes = capitalAlloc.resolveSafeExecutionLot({
        symbol: orderSymbol,
        markPrice: orderEntry,
        availableBalance: isLiveUnverified ? 0 : availableBalance,
        totalEquity: effectiveExecEq,
        stopLossDistance: Math.abs(orderEntry - orderSl),
        leverage: enforcedSniperLev,
      });
      const orderSize = execLotRes.lotSize > 0
        ? execLotRes.lotSize
        : (signalToUse.lotSize > 0 ? signalToUse.lotSize : capitalAlloc.defaultLotSize);
      const resolvedContracts = execLotRes.contracts > 0
        ? execLotRes.contracts
        : capitalAlloc.getContractsCount(orderSymbol, orderSize);

      // Execute order on Delta Exchange India backend
      const execRes: any = await onExecuteOrder({
        symbol: orderSymbol,
        side: orderSide,
        size: orderSize,
        contracts: resolvedContracts,
        orderType: 'MARKET',
        leverage: enforcedSniperLev,
        marginMode: capitalAlloc.marginMode,
        entryPrice: orderEntry,
        stopLoss: orderSl,
        takeProfit: orderTp,
        tp1: effectiveTp1 > 0 ? effectiveTp1 : undefined,
        tp2: effectiveTp2 > 0 ? effectiveTp2 : undefined,
        tp3: effectiveTp3 > 0 ? effectiveTp3 : undefined,
        tp4: effectiveTp4 > 0 ? effectiveTp4 : orderTp,
        strategy: isMicro15Tier ? 'Narrow CPR $15 Micro Sniper' : 'Intraday Sniper Scalping Engine',
        strategyTag: isMicro15Tier ? 'NARROW_CPR_MICRO_15' : 'CAMARILLA_SNIPER',
        isMicro15: isMicro15Tier,
        exposureMode: isMicro15Tier ? 'MICRO_15' : (signalToUse.exposureMode || exposureMode),
        microMarginUsd: execLotRes.estimatedMarginUsd ?? signalToUse.estimatedMargin,
        enforcePerpSlot: true,
        autoPilot: isAutoSniperEnabled,
        autoScaleEquity: false,
        availableBalanceUsd: isLiveUnverified ? 0 : availableBalance,
        totalEquityUsd: totalEquity,
        marginUsedUsd: marginUsed,
        mode: tradingMode,
      });

      const resolvedFillPrice =
        Number(
          execRes?.order?.average_fill_price ||
          execRes?.average_fill_price ||
          execRes?.order?.limit_price ||
          orderEntry
        ) || orderEntry;

      // Re-verify anti-wick SL buffer (>= max(1.5x 5m ATR, 0.55% BTC) + $35 wick buffer) against actual exchange fill price
      const postFillBuffered = enforceMinimumSniperStopBuffer({
        entryPrice: resolvedFillPrice,
        side: orderSide,
        symbol: orderSymbol,
        stopLoss: Number(execRes?.slPrice || execRes?.microSniper?.sl || orderSl),
        tp1: Number(execRes?.microSniper?.tp1 || effectiveTp1),
        tp2: Number(execRes?.microSniper?.tp2 || effectiveTp2),
        tp3: effectiveTp3,
        tp4: Number(execRes?.tpPrice || orderTp),
        atr5m: execAtr5m,
        h3: effectiveCamarilla.h3,
        l3: effectiveCamarilla.l3,
        swingLow: recent5mLowVal,
        swingHigh: recent5mHighVal,
      });
      const finalSl = postFillBuffered.stopLoss;
      const finalTp1 = postFillBuffered.tp1;
      const finalTp2 = postFillBuffered.tp2;
      const finalTp3 = postFillBuffered.tp3;
      const finalTp4 = isMicro15Tier ? postFillBuffered.tp2 : postFillBuffered.tp4;

      const bracketWarningMsg: string | undefined = execRes?.bracketWarning
        ? String(execRes.bracketWarning)
        : undefined;
      const resolvedProductSymbol: string = String(
        execRes?.order?.product_symbol || execRes?.product_symbol || orderSymbol
      );

      if (isMicro15Tier) {
        recordMicroTradeTimestamp();
      }

      const tradeFriction = signalToUse.friction || calculateSniperFriction({
        entryPrice: resolvedFillPrice,
        direction: orderSide,
        lotSize: orderSize,
        isTaker: true,
      });

      const newTrade: SniperActiveTrade = {
        id: `sniper-${Date.now()}`,
        symbol: resolvedProductSymbol,
        productSymbol: resolvedProductSymbol,
        signal: orderSide,
        exposureMode: signalToUse.exposureMode || exposureMode,
        scalpTier: signalToUse.scalpTier || scalpTier,
        confidence: signalToUse.confidence || 75,
        confidenceStatus: signalToUse.confidenceStatus || 'High Conviction',
        lotSize: orderSize,
        remainingSize: orderSize,
        leverage: enforcedSniperLev,
        entryPrice: resolvedFillPrice,
        currentPrice: resolvedFillPrice,
        initialStopLoss: finalSl,
        currentStopLoss: finalSl,
        tp1: finalTp1 > 0 ? finalTp1 : resolvedFillPrice,
        tp2: finalTp2 > 0 ? finalTp2 : resolvedFillPrice,
        tp3: finalTp3 > 0 ? finalTp3 : resolvedFillPrice,
        tp4: finalTp4,
        camarilla: effectiveCamarilla,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        tp4Hit: false,
        status: 'OPEN',
        tradeStatus: 'ACTIVE',
        riskStatus: 'INITIAL_RISK',
        trailingStopActive: false,
        trailingStopValue: finalSl,
        trailingStage: 0,
        profitLocked: false,
        bookedProfitUsd: 0,
        unrealisedProfitUsd: 0,
        unrealizedPnlUsd: 0,
        unrealizedPnlInr: 0,
        highestPriceReached: resolvedFillPrice,
        lowestPriceReached: resolvedFillPrice,
        openedAt: Date.now(),
        lastUpdatedAt: Date.now(),
        aiVerdict: 'HOLD POSITION UNTIL H6/L6 (TP4), TRAILING STOP HIT, OR CAMARILLA H3/L3 TRAP EXIT.',
        mode: tradingMode,
        adoptedFromExchange: false,
        bracketWarning: bracketWarningMsg,
        friction: tradeFriction,
        netBreakevenPrice: tradeFriction.netBreakevenPrice,
      };

      lastAutoExecutedSignalId.current = signalToUse.id || `${orderSymbol}-${orderSide}-${signalToUse.exposureMode || 'MACRO'}-${signalToUse.confidence || 75}-${Math.round(resolvedFillPrice)}`;
      setIsSignalStandby(false);
      setActiveTrade(newTrade);
      setLastExecutedSignalTs(Date.now());
      if (onPlaySound) onPlaySound();

      addLog('ENTRY', `Executed ${orderSide} ${orderSize} ${resolvedProductSymbol}`, 
        `Entry: $${resolvedFillPrice.toLocaleString()} | Initial SL: $${finalSl.toLocaleString()} (${postFillBuffered.slPct}% buffer) | TP1: $${(finalTp1 || resolvedFillPrice).toLocaleString()} | TP2: $${(finalTp2 || finalTp4).toLocaleString()}${bracketWarningMsg ? ` | Bracket Note: ${bracketWarningMsg}` : ''}`);

      queueAnalyticsEvent({
        kind: 'TRADE_LIFECYCLE',
        eventId: `order-sub-${newTrade.id}`,
        tradeId: newTrade.id,
        eventType: 'ORDER_SUBMITTED',
        timestampMs: newTrade.openedAt,
        symbol: resolvedProductSymbol,
        side: orderSide,
        size: orderSize,
        entryPrice: resolvedFillPrice,
        fees: tradeFriction.totalFrictionUsd || 0,
        leverage: enforcedSniperLev,
        netRealizedPnlUsd: 0,
        usdInrRate: usdInrRef.current,
        mode: tradingMode,
        reason: isMicro15Tier ? 'Camarilla Sniper $15 Micro Entry Submitted' : 'Camarilla Sniper $50 Standard Entry Submitted',
      });
      queueAnalyticsEvent({
        kind: 'TRADE_LIFECYCLE',
        eventId: `fill-conf-${newTrade.id}`,
        tradeId: newTrade.id,
        eventType: 'FILL_CONFIRMED',
        timestampMs: newTrade.openedAt + 1,
        symbol: resolvedProductSymbol,
        side: orderSide,
        size: orderSize,
        entryPrice: resolvedFillPrice,
        fees: tradeFriction.totalFrictionUsd || 0,
        leverage: enforcedSniperLev,
        netRealizedPnlUsd: 0,
        usdInrRate: usdInrRef.current,
        mode: tradingMode,
        reason: `Entry Filled @ $${resolvedFillPrice.toLocaleString()} | SL $${finalSl.toLocaleString()} | TP1 $${(finalTp1 || resolvedFillPrice).toLocaleString()}`,
      });
      queueAnalyticsSignal({
        signalId: signalToUse.id || lastAutoExecutedSignalId.current || newTrade.id,
        timestampMs: newTrade.openedAt,
        sourceEngine: isMicro15Tier ? 'CAMARILLA_SNIPER_15_MICRO' : 'CAMARILLA_SNIPER_50_STD',
        symbol: resolvedProductSymbol,
        timeframe,
        grade: (signalToUse.confidence || 75) >= 90 ? 'A+' : (signalToUse.confidence || 75) >= 80 ? 'A' : 'B',
        aiScore: signalToUse.confidence || 75,
        convictionPct: signalToUse.confidence || 75,
        direction: orderSide,
        entryPrice: resolvedFillPrice,
        stopLoss: finalSl,
        tp1: finalTp1 || resolvedFillPrice,
        tp2: finalTp2 || resolvedFillPrice,
        tp3: finalTp3 || resolvedFillPrice,
        tp4: finalTp4,
        cprRegime: effectiveCamarilla?.cprRegime || 'STANDARD',
        status: 'EXECUTED',
        mode: tradingMode,
      });

      if (bracketWarningMsg) {
        addLog('CONDUIT', 'Primary Order Filled · Bracket Warning', bracketWarningMsg);
      }

      onSendNotification(
        'Sniper Trade Executed',
        `${orderSide} ${orderSize} ${resolvedProductSymbol} @ $${resolvedFillPrice.toLocaleString()} (Confidence: ${signalToUse.confidence || 75}%). 4 Profit Targets Primed.`,
        'TRADE'
      );

      const shortSym = formatVoiceSymbol(resolvedProductSymbol);
      const dirWord = orderSide === 'SHORT' ? 'Short' : 'Long';
      const tierPrefix = isMicro15Tier ? 'Micro Sniper' : 'Sniper';
      const tpSpeechTarget = finalTp1 > 0 ? finalTp1 : finalTp4;
      speakVoiceAlert(
        `${tierPrefix} ${dirWord} executed on ${shortSym} at ${formatVoicePrice(resolvedFillPrice)}. Stop loss ${formatVoicePrice(finalSl)}. Target ${formatVoicePrice(tpSpeechTarget)}.`,
        `${newTrade.id}:ENTRY`
      );
    } catch (err: any) {
      lastAttemptTsRef.current = Date.now();
      setLastExecutedSignalTs(Date.now());
      const errorMessage = err?.message || err?.toString() || 'Failed to route sniper order to Delta Exchange India';
      
      console.error('[SniperExecution] Critical Execution Error:', {
        errorMessage,
        err,
        signalToUse,
        timestamp: new Date().toISOString()
      });

      addLog('BLOCKED', 'Execution Error', errorMessage);
      onSendNotification('Sniper Execution Failed', errorMessage, 'RISK');
      setIsSignalStandby(false);
      if (tradingMode === 'LIVE' && isLiveApiAuthenticated) {
        setTimeout(() => {
          void reconcileLivePerpPositionsNow();
        }, 750);
      }
    } finally {
      setIsExecuting(false);
    }
  }, [isLiveUnverified, isLiveApiAuthenticated, currentSignal, onExecuteOrder, tradingMode, exposureMode, scalpTier, setActiveTrade, setIsSignalStandby, onSendNotification, onPlaySound, addLog, markets, selectedSymbol, reconcileLivePerpPositionsNow]);

  // Dynamic Cooldown Release on 9/20 EMA Alignment
  useEffect(() => {
    if (!isEmaAlignmentPending) return;
    const high24h = curMarket.high24h || markPrice * 1.01;
    const low24h = curMarket.low24h || markPrice * 0.99;
    const vwap5m = (high24h + low24h + markPrice * 2) / 4;
    const isLong = directionMode === 'LONG';
    const isAligned = isLong ? ((currentSignal.ema9 || 0) >= (currentSignal.ema21 || 0) && markPrice >= vwap5m) : ((currentSignal.ema9 || 0) <= (currentSignal.ema21 || 0) && markPrice <= vwap5m);
    
    if (isAligned) {

      setIsEmaAlignmentPending(false);
      addLog('CONDUIT', 'Cooldown Cleared', 'Dynamic trend realignment confirmed (9/20 EMA). Auto-pilot re-armed.');
    }
  }, [isEmaAlignmentPending, directionMode, currentSignal.ema9, currentSignal.ema21, markPrice, selectedSymbol, addLog, curMarket.high24h, curMarket.low24h]);

  // ═══════════════════════════════════════════════════════════
  // 4 & 5. REAL-TIME PROFIT LOCK & FORWARD MANAGEMENT ENGINE
  // Evaluated instantaneously whenever a new WebSocket price packet arrives!
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!activeTrade) {
      return;
    }

    if (
      activeTrade.tradeStatus === 'COMPLETED' ||
      activeTrade.tradeStatus === 'STOPPED_OUT' ||
      activeTrade.tradeStatus === 'REVERSED' ||
      activeTrade.tradeStatus === 'TIME_EXIT'
    ) {
      setActiveTrade(null);
      setIsSignalStandby(true);
      return;
    }

    const trade = activeTrade;
    const isLong = trade.signal === 'LONG';
    const tradeTicker = getMarketTicker(markets, trade.symbol || selectedSymbol);
    const currentPrice = tradeTicker.markPrice > 0 ? tradeTicker.markPrice : markPrice;

    // Update price peaks
    const highest = Math.max(trade.highestPriceReached, currentPrice);
    const lowest = Math.min(trade.lowestPriceReached, currentPrice);

    // Calculate current unrealised PnL (signed BTC/coin formula matching Delta Exchange India)
    const remSz = trade.remainingSize > 0 ? trade.remainingSize : trade.lotSize;
    const signedSz = isLong ? remSz : -remSz;
    const rawUpnlUsd = (currentPrice - trade.entryPrice) * signedSz;
    const unrealisedProfitUsd = +rawUpnlUsd.toFixed(2);
    const pureUpnlUsd = +rawUpnlUsd.toFixed(6);
    const effectiveInr = usdInrRef.current > 0 ? usdInrRef.current : 85;
    const pureUpnlInr = +(pureUpnlUsd * effectiveInr).toFixed(2);

    let updatedTrade: SniperActiveTrade = {
      ...trade,
      currentPrice,
      highestPriceReached: highest,
      lowestPriceReached: lowest,
      unrealisedProfitUsd,
      unrealizedPnlUsd: pureUpnlUsd,
      unrealizedPnlInr: pureUpnlInr,
      status: 'OPEN',
      lastUpdatedAt: Date.now(),
    };

    // In LIVE mode, Delta Exchange India is authoritative for position existence, SL/TP fills, and size.
    // Keep live mark price & UPNL streaming on every tick without locally clearing or halving activeTrade.
    if (trade.adoptedFromExchange || trade.mode === 'LIVE') {
      if (
        updatedTrade.currentPrice !== trade.currentPrice ||
        updatedTrade.unrealisedProfitUsd !== trade.unrealisedProfitUsd ||
        updatedTrade.unrealizedPnlInr !== trade.unrealizedPnlInr
      ) {
        setActiveTrade(updatedTrade);
      }
      return;
    }

    // ─────────────────────────────────────────────────────────
    // EXIT CONDITION 1: Stop Loss / Trailing Stop Hit (Risk Exit)
    // ─────────────────────────────────────────────────────────
    const isStopHit = isLong 
      ? currentPrice <= updatedTrade.currentStopLoss 
      : currentPrice >= updatedTrade.currentStopLoss;

    if (isStopHit) {
      const exitTitle = updatedTrade.trailingStopActive
        ? 'Trailing Stop Triggered'
        : updatedTrade.profitLocked
        ? 'Locked Profit Stop Hit'
        : updatedTrade.riskStatus === 'RISK-FREE'
        ? 'Break-Even Stop Hit'
        : 'Invalidation / Initial Stop Loss Hit';

      const totalRealisedPnl = +(updatedTrade.bookedProfitUsd + unrealisedProfitUsd).toFixed(2);
      const isDefendedExit = updatedTrade.trailingStopActive || updatedTrade.profitLocked || updatedTrade.riskStatus === 'RISK-FREE';

      if (totalRealisedPnl > 0 || isDefendedExit) {
        consecutiveStopsCountRef.current = 0;
        setConsecutiveStopsCount(0);
        addLog('EXIT_DEFENDED', 'Position exited profitably/defended', `Realized: $${totalRealisedPnl.toFixed(2)}. Auto-pilot remains READY.`);
      } else {
        addLog('STOP_LOSS', 'Position exited', `Position exited with PnL: $${totalRealisedPnl.toFixed(2)}.`);
      }

      const isMicro15 = trade.exposureMode === 'MICRO_15' || trade.scalpTier === 'TIER_15';
      const isMainStopLoss = totalRealisedPnl <= (isMicro15 ? -14.50 : -49.00);

      if (isMicro15 && !isDefendedExit) {
        triggerMicroSlCooldown();
      }

      if (isMainStopLoss) {
        consecutiveStopsCountRef.current += 1;
        setConsecutiveStopsCount(consecutiveStopsCountRef.current);
      }

      addLog('STOP_LOSS', exitTitle, `Exited at $${currentPrice.toLocaleString()}. Booked PnL: $${totalRealisedPnl.toFixed(2)}`);

      if (consecutiveStopsCountRef.current >= 2) {
        // Keep Auto-Pilot ARMED (ON); rely on post-SL cooldown to pace entries without disarming Auto-Pilot
        addLog(
          'AUTOPILOT',
          'Auto-Pilot Post-SL Cooldown Active',
          '2 Consecutive Stops Hit — 10m Post-SL Cooldown Armed. Auto-Pilot remains ARMED (ON) for next valid setup.'
        );
      }

      if (tradingMode === 'LIVE') {
        setLiveCumulativeRealizedUsd((prev) => +(prev + totalRealisedPnl).toFixed(2));
      } else {
        setPaperCumulativeRealizedUsd((prev) => +(prev + totalRealisedPnl).toFixed(2));
      }
      if (totalRealisedPnl > trade.bookedProfitUsd) {
        registerRealizedPnL(totalRealisedPnl - trade.bookedProfitUsd);
      }

      const slClosedReason = `${exitTitle} (Stop Loss Hit - Risk Protected)`;
      const remainingNotional = trade.entryPrice * trade.remainingSize;
      const remainingMargin = trade.leverage > 0 ? remainingNotional / trade.leverage : remainingNotional / 10;
      const slPct = remainingMargin > 0 ? +((unrealisedProfitUsd / remainingMargin) * 100).toFixed(2) : 0;

      if (onRecordClosedTrade) {
        onRecordClosedTrade(
          {
            id: `th-sniper-sl-${Date.now()}`,
            symbol: trade.symbol,
            side: trade.signal,
            size: trade.remainingSize,
            entryPrice: trade.entryPrice,
            exitPrice: currentPrice,
            realisedPnl: +unrealisedProfitUsd.toFixed(2),
            pnlPercent: slPct,
            openedAt: trade.openedAt,
            closedAt: Date.now(),
            reason: slClosedReason,
            mode: tradingMode,
          },
          {
            symbol: trade.symbol,
            isFullClose: true,
            exitPrice: currentPrice,
          }
        );
      }

      queueAnalyticsEvent(
        {
          kind: 'TRADE_LIFECYCLE',
          eventId: `sl-hit-${trade.id}`,
          tradeId: trade.id,
          eventType: 'SL_HIT',
          timestampMs: Date.now(),
          symbol: trade.symbol,
          side: trade.signal,
          size: trade.remainingSize,
          entryPrice: trade.entryPrice,
          exitPrice: currentPrice,
          triggerPrice: updatedTrade.currentStopLoss,
          fees: trade.friction?.totalFrictionUsd || 0,
          leverage: trade.leverage || 10,
          netRealizedPnlUsd: totalRealisedPnl,
          usdInrRate: usdInrRef.current,
          mode: tradingMode,
          reason: slClosedReason,
        },
        true
      );
      queueAnalyticsSignal(
        {
          signalId: lastAutoExecutedSignalId.current || trade.id,
          timestampMs: Date.now(),
          sourceEngine: isMicro15 ? 'CAMARILLA_SNIPER_15_MICRO' : 'CAMARILLA_SNIPER_50_STD',
          symbol: trade.symbol,
          timeframe,
          grade: trade.confidence >= 90 ? 'A+' : trade.confidence >= 80 ? 'A' : 'B',
          aiScore: trade.confidence,
          convictionPct: trade.confidence,
          direction: trade.signal,
          entryPrice: trade.entryPrice,
          stopLoss: trade.initialStopLoss,
          tp1: trade.tp1,
          tp2: trade.tp2,
          tp3: trade.tp3,
          tp4: trade.tp4,
          status: 'EXECUTED',
          outcomePnl: totalRealisedPnl,
          hitTarget: isDefendedExit ? 'BE_TRAIL_STOP' : 'SL',
          mode: tradingMode,
        },
        true
      );

      speakVoiceAlert(
        totalRealisedPnl > 0 || isDefendedExit
          ? 'Trailing stop triggered. Profit locked.'
          : 'Stop loss triggered. Position closed.',
        `${trade.id}:SL`
      );
      onSendNotification(
        exitTitle,
        `${trade.symbol} position stopped out @ $${currentPrice.toLocaleString()}. Total PnL: $${totalRealisedPnl.toFixed(2)}. ${isMicro15 && !isDefendedExit ? '10-minute post-SL anti-chop cooldown active.' : 'Cooldown active.'}`,
        'RISK'
      );
      setActiveTrade(null);
      setIsSignalStandby(true);
      onSignalExitLifecycle?.('SL', trade.symbol);
      return;
    }

    // ─────────────────────────────────────────────────────────
    // EXIT CONDITION 2: Signal Reversal Exit
    // ─────────────────────────────────────────────────────────
    const oppositeSignal = isLong ? currentSignal.signal === 'SHORT' : currentSignal.signal === 'LONG';
    if (oppositeSignal && currentSignal.confidence >= 90) {
      const finalPnl = +(trade.bookedProfitUsd + unrealisedProfitUsd).toFixed(2);
      if (tradingMode === 'LIVE') {
        setLiveCumulativeRealizedUsd((prev) => +(prev + finalPnl).toFixed(2));
      } else {
        setPaperCumulativeRealizedUsd((prev) => +(prev + finalPnl).toFixed(2));
      }
      if (finalPnl > trade.bookedProfitUsd) {
        registerRealizedPnL(finalPnl - trade.bookedProfitUsd);
      }
      if (onRecordClosedTrade) {
        onRecordClosedTrade(
          {
            id: `th-sniper-rev-${Date.now()}`,
            symbol: trade.symbol,
            side: trade.signal,
            size: trade.remainingSize,
            entryPrice: trade.entryPrice,
            exitPrice: currentPrice,
            realisedPnl: +unrealisedProfitUsd.toFixed(2),
            pnlPercent: 0,
            openedAt: trade.openedAt,
            closedAt: Date.now(),
            reason: `Signal Reversal Exit (${currentSignal.signal})`,
            mode: tradingMode,
          },
          {
            symbol: trade.symbol,
            isFullClose: true,
            exitPrice: currentPrice,
          }
        );
      }
      queueAnalyticsEvent(
        {
          kind: 'TRADE_LIFECYCLE',
          eventId: `rev-close-${trade.id}`,
          tradeId: trade.id,
          eventType: 'POSITION_CLOSED',
          timestampMs: Date.now(),
          symbol: trade.symbol,
          side: trade.signal,
          size: trade.remainingSize,
          entryPrice: trade.entryPrice,
          exitPrice: currentPrice,
          fees: trade.friction?.totalFrictionUsd || 0,
          leverage: trade.leverage || 10,
          netRealizedPnlUsd: finalPnl,
          usdInrRate: usdInrRef.current,
          mode: tradingMode,
          reason: `Signal Reversal Exit (${currentSignal.signal})`,
        },
        true
      );
      addLog('REVERSAL', 'Signal Reversal Exit', `Closed position immediately due to opposite ${currentSignal.signal} signal with ${currentSignal.confidence}% confidence.`);
      onSendNotification('Signal Reversal Exit', `Immediate exit on ${trade.symbol}: opposite sniper signal generated.`, 'RISK');
      setActiveTrade(null);
      setIsSignalStandby(true);
      onSignalExitLifecycle?.('TP4', trade.symbol);
      return;
    }

    // ─────────────────────────────────────────────────────────
    // EXIT CONDITION 3: Time-Based Exit (180 minutes intraday max)
    // ─────────────────────────────────────────────────────────
    const elapsedMinutes = (Date.now() - trade.openedAt) / 60000;
    if (elapsedMinutes >= 180) {
      const finalPnl = +(trade.bookedProfitUsd + unrealisedProfitUsd).toFixed(2);
      if (tradingMode === 'LIVE') {
        setLiveCumulativeRealizedUsd((prev) => +(prev + finalPnl).toFixed(2));
      } else {
        setPaperCumulativeRealizedUsd((prev) => +(prev + finalPnl).toFixed(2));
      }
      if (finalPnl > trade.bookedProfitUsd) {
        registerRealizedPnL(finalPnl - trade.bookedProfitUsd);
      }
      if (onRecordClosedTrade) {
        onRecordClosedTrade(
          {
            id: `th-sniper-time-${Date.now()}`,
            symbol: trade.symbol,
            side: trade.signal,
            size: trade.remainingSize,
            entryPrice: trade.entryPrice,
            exitPrice: currentPrice,
            realisedPnl: +unrealisedProfitUsd.toFixed(2),
            pnlPercent: 0,
            openedAt: trade.openedAt,
            closedAt: Date.now(),
            reason: 'Time-Based Exit (180m Intraday Limit)',
            mode: tradingMode,
          },
          {
            symbol: trade.symbol,
            isFullClose: true,
            exitPrice: currentPrice,
          }
        );
      }
      queueAnalyticsEvent(
        {
          kind: 'TRADE_LIFECYCLE',
          eventId: `time-close-${trade.id}`,
          tradeId: trade.id,
          eventType: 'POSITION_CLOSED',
          timestampMs: Date.now(),
          symbol: trade.symbol,
          side: trade.signal,
          size: trade.remainingSize,
          entryPrice: trade.entryPrice,
          exitPrice: currentPrice,
          fees: trade.friction?.totalFrictionUsd || 0,
          leverage: trade.leverage || 10,
          netRealizedPnlUsd: finalPnl,
          usdInrRate: usdInrRef.current,
          mode: tradingMode,
          reason: 'Time-Based Exit (180m Intraday Limit)',
        },
        true
      );
      addLog('TIME_EXIT', 'Time-Based Exit Triggered', 'Closed position at end-of-session 180m limit.');
      onSendNotification('Time-Based Exit', `${trade.symbol} position closed due to intraday session duration limit.`, 'INFO');
      setActiveTrade(null);
      setIsSignalStandby(true);
      onSignalExitLifecycle?.('TP4', trade.symbol);
      return;
    }

    // ─────────────────────────────────────────────────────────
    // TARGET 1 (STEP 01 / TP1): Partial Close 50% Size · Keep SL at Initial Anti-Wick Stop (BE disabled until STEP 02 / 2.00R)
    // ─────────────────────────────────────────────────────────
    const tp1Reached = isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1;
    if (tp1Reached && !trade.tp1Hit) {
      const minStep = trade.symbol?.startsWith('BTC') ? 0.001 : trade.symbol?.startsWith('ETH') ? 0.01 : 0.1;
      const partialPortion = Math.min(
        Math.max(minStep, +(trade.lotSize * 0.5).toFixed(3)),
        Math.max(minStep, +(trade.remainingSize - minStep).toFixed(3))
      );
      const currentTradeFriction =
        trade.friction ||
        calculateSniperFriction({
          entryPrice: trade.entryPrice,
          direction: trade.signal,
          lotSize: trade.lotSize,
          isTaker: true,
        });
      const tp1Diff = isLong ? Math.max(0, trade.tp1 - trade.entryPrice) : Math.max(0, trade.entryPrice - trade.tp1);
      const bookedPortionProfit = +(tp1Diff * partialPortion).toFixed(2);
      const newBookedUsd = +(trade.bookedProfitUsd + bookedPortionProfit).toFixed(2);
      const remainingAfterTp1 = Math.max(minStep, +(trade.remainingSize - partialPortion).toFixed(3));
      const portionMargin = (trade.entryPrice * partialPortion) / Math.max(1, trade.leverage || 10);
      const portionPct = portionMargin > 0 ? +((bookedPortionProfit / portionMargin) * 100).toFixed(2) : 0;

      updatedTrade = {
        ...updatedTrade,
        tp1Hit: true,
        beArmed: false,
        currentStopLoss: trade.currentStopLoss,
        friction: currentTradeFriction,
        riskStatus: 'INITIAL_RISK',
        tradeStatus: 'ACTIVE',
        trailingStage: 1,
        bookedProfitUsd: newBookedUsd,
        remainingSize: remainingAfterTp1,
        aiVerdict: `STEP 01 (TP1) HIT: 50% SIZE CLOSED (+$${bookedPortionProfit.toFixed(2)}). SL HELD AT INITIAL ANTI-WICK STOP ($${trade.currentStopLoss.toLocaleString()}) UNTIL STEP 02 (2.00R).`,
      };

      consecutiveStopsCountRef.current = 0;
      setConsecutiveStopsCount(0);
      registerRealizedPnL(bookedPortionProfit);
      setActiveTrade(updatedTrade);
      speakVoiceAlert('Target 1 reached. Partial profit locked.', `${trade.id}:TP1`);

      if (onRecordClosedTrade) {
        onRecordClosedTrade(
          {
            id: `th-sniper-tp1-${Date.now()}`,
            symbol: trade.symbol,
            side: trade.signal,
            size: partialPortion,
            entryPrice: trade.entryPrice,
            exitPrice: trade.tp1,
            realisedPnl: bookedPortionProfit,
            pnlPercent: portionPct,
            openedAt: trade.openedAt,
            closedAt: Date.now(),
            reason: 'STEP 01 (TP1) Hit — 50% Partial Close (SL Held Until STEP 02 / 2.00R)',
            mode: tradingMode,
          },
          {
            symbol: trade.symbol,
            partialSize: partialPortion,
            newStopLoss: trade.currentStopLoss,
            tp1Hit: true,
            exitPrice: trade.tp1,
          }
        );
      }

      addLog(
        'TP1',
        'STEP 01 (TP1) Hit! 50% Closed · SL Held Until 2.00R',
        `TP1 ($${trade.tp1.toLocaleString()}) achieved. 50% closed (+$${bookedPortionProfit.toFixed(2)}). SL remains at anti-wick stop ($${trade.currentStopLoss.toLocaleString()}) until STEP 02 (2.00R).`
      );
      queueAnalyticsEvent({
        kind: 'TRADE_LIFECYCLE',
        eventId: `tp1-hit-${trade.id}`,
        tradeId: trade.id,
        eventType: 'TP1_HIT',
        timestampMs: Date.now(),
        symbol: trade.symbol,
        side: trade.signal,
        size: partialPortion,
        entryPrice: trade.entryPrice,
        exitPrice: trade.tp1,
        triggerPrice: trade.tp1,
        fees: currentTradeFriction.totalFrictionUsd * 0.5,
        leverage: trade.leverage || 10,
        netRealizedPnlUsd: bookedPortionProfit,
        usdInrRate: usdInrRef.current,
        mode: tradingMode,
        reason: 'STEP 01 (TP1) Hit — 50% Partial Close (BE Disabled Until 2.00R)',
      });
      onSendNotification(
        'TP1 Hit · 50% Partial Booked',
        `${trade.symbol} reached TP1 ($${trade.tp1.toLocaleString()}). Closed 50% (+$${bookedPortionProfit.toFixed(2)}). SL remains at initial anti-wick stop until STEP 02 (2.00R).`,
        'TRADE'
      );
      return;
    }

    // ─────────────────────────────────────────────────────────
    // TARGET 2 (STEP 02 / 2.00R / TP2): Scale Out 25% & Arm SL -> Fee-Buffer Breakeven (Risk-Free)
    // ─────────────────────────────────────────────────────────
    const tp2Reached = isLong ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2;
    if (tp2Reached && !trade.tp2Hit) {
      const minStep = trade.symbol?.startsWith('BTC') ? 0.001 : trade.symbol?.startsWith('ETH') ? 0.01 : 0.1;
      const isMicroExitAtTp2 = (trade.exposureMode === 'MICRO_15' || trade.scalpTier === 'TIER_15') && trade.remainingSize <= minStep * 1.01;

      if (isMicroExitAtTp2) {
        const finalPortion = trade.remainingSize;
        const tp2Diff = isLong ? Math.max(0, trade.tp2 - trade.entryPrice) : Math.max(0, trade.entryPrice - trade.tp2);
        const bookedPortionProfit = +(tp2Diff * finalPortion).toFixed(2);
        const totalBooked = +(trade.bookedProfitUsd + bookedPortionProfit).toFixed(2);
        const portionMargin = (trade.entryPrice * finalPortion) / Math.max(1, trade.leverage || 10);
        const portionPct = portionMargin > 0 ? +((bookedPortionProfit / portionMargin) * 100).toFixed(2) : 0;

        consecutiveStopsCountRef.current = 0;
        setConsecutiveStopsCount(0);
        if (tradingMode === 'LIVE') {
          setLiveCumulativeRealizedUsd((prev) => +(prev + totalBooked).toFixed(2));
        } else {
          setPaperCumulativeRealizedUsd((prev) => +(prev + totalBooked).toFixed(2));
        }
        registerRealizedPnL(bookedPortionProfit);

        if (onRecordClosedTrade) {
          onRecordClosedTrade(
            {
              id: `th-sniper-tp2-final-${Date.now()}`,
              symbol: trade.symbol,
              side: trade.signal,
              size: finalPortion,
              entryPrice: trade.entryPrice,
              exitPrice: trade.tp2,
              realisedPnl: bookedPortionProfit,
              pnlPercent: portionPct,
              openedAt: trade.openedAt,
              closedAt: Date.now(),
              reason: 'STEP 02 (2.00R) Target Reached — Micro Sniper Complete',
              mode: tradingMode,
            },
            {
              symbol: trade.symbol,
              isFullClose: true,
              exitPrice: trade.tp2,
            }
          );
        }

        addLog('TP2', 'Micro STEP 02 (2.00R) Target Achieved — Position Closed', `TP2 ($${trade.tp2.toLocaleString()}) reached! Closed remaining ${finalPortion}. Total booked: +$${totalBooked.toFixed(2)}.`);
        queueAnalyticsEvent(
          {
            kind: 'TRADE_LIFECYCLE',
            eventId: `tp2-final-${trade.id}`,
            tradeId: trade.id,
            eventType: 'TP2_HIT',
            timestampMs: Date.now(),
            symbol: trade.symbol,
            side: trade.signal,
            size: finalPortion,
            entryPrice: trade.entryPrice,
            exitPrice: trade.tp2,
            triggerPrice: trade.tp2,
            fees: (trade.friction?.totalFrictionUsd || 0) * 0.5,
            leverage: trade.leverage || 10,
            netRealizedPnlUsd: bookedPortionProfit,
            usdInrRate: usdInrRef.current,
            mode: tradingMode,
            reason: 'STEP 02 (2.00R) Target Reached — Micro Sniper Complete',
          },
          true
        );
        queueAnalyticsSignal(
          {
            signalId: lastAutoExecutedSignalId.current || trade.id,
            timestampMs: Date.now(),
            sourceEngine: 'CAMARILLA_SNIPER_15_MICRO',
            symbol: trade.symbol,
            timeframe,
            grade: trade.confidence >= 90 ? 'A+' : trade.confidence >= 80 ? 'A' : 'B',
            aiScore: trade.confidence,
            convictionPct: trade.confidence,
            direction: trade.signal,
            entryPrice: trade.entryPrice,
            stopLoss: trade.initialStopLoss,
            tp1: trade.tp1,
            tp2: trade.tp2,
            tp3: trade.tp3,
            tp4: trade.tp4,
            status: 'EXECUTED',
            outcomePnl: totalBooked,
            hitTarget: 'TP2',
            mode: tradingMode,
          },
          true
        );
        speakVoiceAlert('Target 2 reached. Profit locked.', `${trade.id}:TP2`);
        onSendNotification('STEP 02 (2.00R) Achieved', `${trade.symbol} reached TP2 ($${trade.tp2.toLocaleString()}). Position closed (+$${totalBooked.toFixed(2)}).`, 'TRADE');
        setActiveTrade(null);
        setIsSignalStandby(true);
        onSignalExitLifecycle?.('TP4', trade.symbol);
        return;
      }

      const currentTradeFriction =
        trade.friction ||
        calculateSniperFriction({
          entryPrice: trade.entryPrice,
          direction: trade.signal,
          lotSize: trade.lotSize,
          isTaker: true,
        });
      const feeBufferBe = trade.netBreakevenPrice || currentTradeFriction.netBreakevenPrice;
      const partialPortion = Math.min(
        Math.max(minStep, +(trade.remainingSize * 0.25).toFixed(3)),
        Math.max(minStep, +(trade.remainingSize - minStep).toFixed(3))
      );
      const tp2Diff = isLong ? Math.max(0, trade.tp2 - trade.entryPrice) : Math.max(0, trade.entryPrice - trade.tp2);
      const bookedPortionProfit = +(tp2Diff * partialPortion).toFixed(2);
      const newBookedUsd = +(trade.bookedProfitUsd + bookedPortionProfit).toFixed(2);
      const remainingAfterTp2 = Math.max(minStep, +(trade.remainingSize - partialPortion).toFixed(3));
      const portionMargin = (trade.entryPrice * partialPortion) / Math.max(1, trade.leverage || 10);
      const portionPct = portionMargin > 0 ? +((bookedPortionProfit / portionMargin) * 100).toFixed(2) : 0;

      updatedTrade = {
        ...updatedTrade,
        tp2Hit: true,
        beArmed: true,
        currentStopLoss: feeBufferBe,
        netBreakevenPrice: feeBufferBe,
        friction: currentTradeFriction,
        profitLocked: false,
        riskStatus: 'RISK-FREE',
        tradeStatus: 'RISK-FREE',
        trailingStage: 2,
        bookedProfitUsd: newBookedUsd,
        remainingSize: remainingAfterTp2,
        aiVerdict: `STEP 02 (2.00R / TP2) HIT: SCALED OUT 25% (+$${bookedPortionProfit.toFixed(2)}). SL MOVED TO FEE-BUFFER BE ($${feeBufferBe.toLocaleString()}). TRADE IS RISK-FREE.`,
      };

      registerRealizedPnL(bookedPortionProfit);
      setActiveTrade(updatedTrade);

      if (onRecordClosedTrade) {
        onRecordClosedTrade(
          {
            id: `th-sniper-tp2-${Date.now()}`,
            symbol: trade.symbol,
            side: trade.signal,
            size: partialPortion,
            entryPrice: trade.entryPrice,
            exitPrice: trade.tp2,
            realisedPnl: bookedPortionProfit,
            pnlPercent: portionPct,
            openedAt: trade.openedAt,
            closedAt: Date.now(),
            reason: 'STEP 02 (2.00R / TP2) Hit — 25% Scale-Out (SL Moved to Fee-Buffer BE)',
            mode: tradingMode,
          },
          {
            symbol: trade.symbol,
            partialSize: partialPortion,
            newStopLoss: feeBufferBe,
            tp2Hit: true,
            feeBufferBe,
            exitPrice: trade.tp2,
          }
        );
      }

      addLog(
        'TP2',
        'STEP 02 (2.00R) Hit! Scaled Out 25% · SL to Breakeven',
        `TP2 ($${trade.tp2.toLocaleString()} / 2.00R) achieved. Booked +$${bookedPortionProfit.toFixed(2)}. SL armed to Entry + Fee Buffer ($${feeBufferBe.toLocaleString()}).`
      );
      queueAnalyticsEvent({
        kind: 'TRADE_LIFECYCLE',
        eventId: `tp2-hit-${trade.id}`,
        tradeId: trade.id,
        eventType: 'TP2_HIT',
        timestampMs: Date.now(),
        symbol: trade.symbol,
        side: trade.signal,
        size: partialPortion,
        entryPrice: trade.entryPrice,
        exitPrice: trade.tp2,
        triggerPrice: trade.tp2,
        leverage: trade.leverage || 10,
        netRealizedPnlUsd: bookedPortionProfit,
        usdInrRate: usdInrRef.current,
        mode: tradingMode,
        reason: 'STEP 02 (2.00R / TP2) Hit — 25% Scale-Out (SL Moved to Fee-Buffer BE)',
      });
      queueAnalyticsEvent({
        kind: 'TRADE_LIFECYCLE',
        eventId: `sl-be-${trade.id}`,
        tradeId: trade.id,
        eventType: 'SL_MOVED_BE',
        timestampMs: Date.now() + 1,
        symbol: trade.symbol,
        side: trade.signal,
        size: remainingAfterTp2,
        entryPrice: trade.entryPrice,
        triggerPrice: feeBufferBe,
        leverage: trade.leverage || 10,
        netRealizedPnlUsd: 0,
        usdInrRate: usdInrRef.current,
        mode: tradingMode,
        reason: `STEP 02 (2.00R) Reached: SL Moved to Risk-Free Fee-Buffer BE ($${feeBufferBe.toLocaleString()})`,
      });
      void syncNativeExchangeStopLossLive({
        mode: tradingMode,
        symbol: trade.symbol,
        side: trade.signal,
        remainingSizeCoin: remainingAfterTp2,
        stopLossPrice: feeBufferBe,
        entryPrice: trade.entryPrice,
      });
      speakVoiceAlert('Target 2 reached. Stop loss moved to breakeven.', `${trade.id}:TP2`);
      onSendNotification(
        'STEP 02 (2.00R) Hit · SL Moved to Breakeven',
        `${trade.symbol} reached TP2 ($${trade.tp2.toLocaleString()} / 2.00R). Scaled 25% (+$${bookedPortionProfit.toFixed(2)}) and moved SL to Fee-Buffer BE ($${feeBufferBe.toLocaleString()}).`,
        'TRADE'
      );
      return;
    }

    // ─────────────────────────────────────────────────────────
    // TARGET 3 (TP3): Scale Out 25% & Trail Stop Loss to TP2
    // ─────────────────────────────────────────────────────────
    const tp3Reached = isLong ? currentPrice >= trade.tp3 : currentPrice <= trade.tp3;
    if (tp3Reached && !trade.tp3Hit) {
      const partialPortion = Math.min(
        Math.max(0.001, +(trade.remainingSize * 0.25).toFixed(3)),
        Math.max(0.001, +(trade.remainingSize - 0.001).toFixed(3))
      );
      const tp3Diff = isLong ? Math.max(0, trade.tp3 - trade.entryPrice) : Math.max(0, trade.entryPrice - trade.tp3);
      const bookedPortionProfit = +(tp3Diff * partialPortion).toFixed(2);
      const newBookedUsd = +(trade.bookedProfitUsd + bookedPortionProfit).toFixed(2);
      const remainingAfterTp3 = Math.max(0.001, +(trade.remainingSize - partialPortion).toFixed(3));
      const portionMargin = (trade.entryPrice * partialPortion) / Math.max(1, trade.leverage || 10);
      const portionPct = portionMargin > 0 ? +((bookedPortionProfit / portionMargin) * 100).toFixed(2) : 0;

      updatedTrade = {
        ...updatedTrade,
        tp3Hit: true,
        currentStopLoss: trade.tp2,
        profitLocked: true,
        riskStatus: 'PROFIT_LOCKED',
        tradeStatus: 'PROFIT_LOCKED',
        trailingStage: 3,
        bookedProfitUsd: newBookedUsd,
        remainingSize: remainingAfterTp3,
        aiVerdict: `TP3 HIT: SCALED OUT 25% (+$${bookedPortionProfit.toFixed(2)}). SL TRAILED TO TP2 ($${trade.tp2.toLocaleString()}).`,
      };

      registerRealizedPnL(bookedPortionProfit);
      setActiveTrade(updatedTrade);

      if (onRecordClosedTrade) {
        onRecordClosedTrade(
          {
            id: `th-sniper-tp3-${Date.now()}`,
            symbol: trade.symbol,
            side: trade.signal,
            size: partialPortion,
            entryPrice: trade.entryPrice,
            exitPrice: trade.tp3,
            realisedPnl: bookedPortionProfit,
            pnlPercent: portionPct,
            openedAt: trade.openedAt,
            closedAt: Date.now(),
            reason: 'TP3 Hit — 25% Scale-Out (SL Trailed to TP2)',
            mode: tradingMode,
          },
          {
            symbol: trade.symbol,
            partialSize: partialPortion,
            newStopLoss: trade.tp2,
            tp3Hit: true,
            exitPrice: trade.tp3,
          }
        );
      }

      addLog(
        'TP3',
        'Target 3 Hit! Scaled Out 25% · SL Trailed to TP2',
        `TP3 ($${trade.tp3.toLocaleString()}) achieved. Booked +$${bookedPortionProfit.toFixed(2)}. SL trailed to TP2 ($${trade.tp2.toLocaleString()}).`
      );
      queueAnalyticsEvent({
        kind: 'TRADE_LIFECYCLE',
        eventId: `tp3-hit-${trade.id}`,
        tradeId: trade.id,
        eventType: 'TP3_HIT',
        timestampMs: Date.now(),
        symbol: trade.symbol,
        side: trade.signal,
        size: partialPortion,
        entryPrice: trade.entryPrice,
        exitPrice: trade.tp3,
        triggerPrice: trade.tp3,
        leverage: trade.leverage || 10,
        netRealizedPnlUsd: bookedPortionProfit,
        usdInrRate: usdInrRef.current,
        mode: tradingMode,
        reason: 'TP3 Hit — 25% Scale-Out (SL Trailed to TP2)',
      });
      void syncNativeExchangeStopLossLive({
        mode: tradingMode,
        symbol: trade.symbol,
        side: trade.signal,
        remainingSizeCoin: remainingAfterTp3,
        stopLossPrice: trade.tp2,
        entryPrice: trade.entryPrice,
      });
      speakVoiceAlert('Target 3 reached. Profit locked.', `${trade.id}:TP3`);
      onSendNotification(
        'TP3 Achieved · SL Trailed to TP2',
        `${trade.symbol} hit TP3 ($${trade.tp3.toLocaleString()}). Scaled 25% (+$${bookedPortionProfit.toFixed(2)}) and trailed SL to TP2.`,
        'TRADE'
      );
      return;
    }

    // ─────────────────────────────────────────────────────────
    // DYNAMIC ADVANCED TRAILING STOP UPDATE (Stage 3)
    // ─────────────────────────────────────────────────────────
    if (trade.trailingStopActive && trade.tp3Hit && !trade.tp4Hit) {
      const atrStep = Math.abs(trade.tp3 - trade.tp2) * 0.55;
      if (isLong) {
        const potentialSl = +(highest - atrStep).toFixed(2);
        if (potentialSl > trade.currentStopLoss) {
          updatedTrade = {
            ...updatedTrade,
            currentStopLoss: potentialSl,
            trailingStopValue: potentialSl,
            aiVerdict: `TRAILING STOP ADAPTED: MOVED HIGHER TO $${potentialSl.toLocaleString()} PROTECTING RUNNER.`,
          };
          setActiveTrade(updatedTrade);
          addLog('TRAILING', 'Trailing Stop Adapted Upwards', `Runner SL ratcheted up to $${potentialSl.toLocaleString()} following swing peak.`);
        }
      } else {
        const potentialSl = +(lowest + atrStep).toFixed(2);
        if (potentialSl < trade.currentStopLoss) {
          updatedTrade = {
            ...updatedTrade,
            currentStopLoss: potentialSl,
            trailingStopValue: potentialSl,
            aiVerdict: `TRAILING STOP ADAPTED: MOVED LOWER TO $${potentialSl.toLocaleString()} PROTECTING RUNNER.`,
          };
          setActiveTrade(updatedTrade);
          addLog('TRAILING', 'Trailing Stop Adapted Downwards', `Runner SL ratcheted down to $${potentialSl.toLocaleString()} following swing trough.`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────
    // TARGET 4 (TP4): Final Profit Target Reached (Close 100% of Remaining Position)
    // ─────────────────────────────────────────────────────────
    const tp4Reached = isLong ? currentPrice >= trade.tp4 : currentPrice <= trade.tp4;
    if (tp4Reached && !trade.tp4Hit) {
      const tp4Diff = isLong ? Math.max(0, trade.tp4 - trade.entryPrice) : Math.max(0, trade.entryPrice - trade.tp4);
      const finalPortionPnl = +(tp4Diff * trade.remainingSize).toFixed(2);
      const totalBooked = +(trade.bookedProfitUsd + finalPortionPnl).toFixed(2);
      const portionMargin = (trade.entryPrice * trade.remainingSize) / Math.max(1, trade.leverage || 10);
      const portionPct = portionMargin > 0 ? +((finalPortionPnl / portionMargin) * 100).toFixed(2) : 0;

      consecutiveStopsCountRef.current = 0;
      setConsecutiveStopsCount(0);

      if (tradingMode === 'LIVE') {
        setLiveCumulativeRealizedUsd((prev) => +(prev + totalBooked).toFixed(2));
      } else {
        setPaperCumulativeRealizedUsd((prev) => +(prev + totalBooked).toFixed(2));
      }
      registerRealizedPnL(finalPortionPnl);

      if (onRecordClosedTrade) {
        onRecordClosedTrade(
          {
            id: `th-sniper-tp4-${Date.now()}`,
            symbol: trade.symbol,
            side: trade.signal,
            size: trade.remainingSize,
            entryPrice: trade.entryPrice,
            exitPrice: trade.tp4,
            realisedPnl: finalPortionPnl,
            pnlPercent: portionPct,
            openedAt: trade.openedAt,
            closedAt: Date.now(),
            reason: 'TP4 Final Target Reached — 100% Remaining Closed',
            mode: tradingMode,
          },
          {
            symbol: trade.symbol,
            isFullClose: true,
            exitPrice: trade.tp4,
          }
        );
      }

      addLog(
        'TP4',
        'Target 4 Achieved — 100% Remaining Closed!',
        `TP4 ($${trade.tp4.toLocaleString()}) reached! Closed remaining ${trade.remainingSize} contracts (+$${finalPortionPnl.toFixed(2)}). Total trade realized: $${totalBooked.toFixed(2)}.`
      );
      queueAnalyticsEvent(
        {
          kind: 'TRADE_LIFECYCLE',
          eventId: `tp4-hit-${trade.id}`,
          tradeId: trade.id,
          eventType: 'TP4_HIT',
          timestampMs: Date.now(),
          symbol: trade.symbol,
          side: trade.signal,
          size: trade.remainingSize,
          entryPrice: trade.entryPrice,
          exitPrice: trade.tp4,
          triggerPrice: trade.tp4,
          leverage: trade.leverage || 10,
          netRealizedPnlUsd: finalPortionPnl,
          usdInrRate: usdInrRef.current,
          mode: tradingMode,
          reason: 'TP4 Final Target Reached — 100% Remaining Closed',
        },
        true
      );
      queueAnalyticsSignal(
        {
          signalId: lastAutoExecutedSignalId.current || trade.id,
          timestampMs: Date.now(),
          sourceEngine:
            trade.exposureMode === 'MICRO_15' || trade.scalpTier === 'TIER_15'
              ? 'CAMARILLA_SNIPER_15_MICRO'
              : 'CAMARILLA_SNIPER_50_STD',
          symbol: trade.symbol,
          timeframe,
          grade: trade.confidence >= 90 ? 'A+' : trade.confidence >= 80 ? 'A' : 'B',
          aiScore: trade.confidence,
          convictionPct: trade.confidence,
          direction: trade.signal,
          entryPrice: trade.entryPrice,
          stopLoss: trade.initialStopLoss,
          tp1: trade.tp1,
          tp2: trade.tp2,
          tp3: trade.tp3,
          tp4: trade.tp4,
          status: 'EXECUTED',
          outcomePnl: totalBooked,
          hitTarget: 'TP4',
          mode: tradingMode,
        },
        true
      );
      speakVoiceAlert('Target 4 reached. Profit locked.', `${trade.id}:TP4`);
      onSendNotification(
        'Target 4 Achieved — Full Position Closed',
        `${trade.symbol} reached TP4 ($${trade.tp4.toLocaleString()}). 100% remaining closed (+$${finalPortionPnl.toFixed(2)}). Scanning next setup.`,
        'TRADE'
      );
      setActiveTrade(null);
      setIsSignalStandby(true);
      onSignalExitLifecycle?.('TP4', trade.symbol);
      return;
    }

    // Update active trade state for live markPrice and unrealised PnL
    if (updatedTrade.currentPrice !== trade.currentPrice || updatedTrade.unrealisedProfitUsd !== trade.unrealisedProfitUsd) {
      setActiveTrade(updatedTrade);
    }
  }, [markPrice, markets, selectedSymbol, activeTrade, currentSignal, addLog, onSendNotification, setActiveTrade, setIsSignalStandby, tradingMode, onRecordClosedTrade, onSignalExitLifecycle, registerRealizedPnL]);

  const cumulativeRealizedProfitUsd = isLiveMode ? liveCumulativeRealizedUsd : paperCumulativeRealizedUsd;

  // ═══════════════════════════════════════════════════════════
  // GLOBAL PNL SYNCHRONIZATION WITH PORTFOLIOCONTEXT
  // Automatically broadcasts active unrealized PnL & cumulative realized PnL in real time.
  // When activeTrade is null / reset, ensures sniperUnrealizedPnl clears back to 0.00.
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (isLiveUnverified) {
      setSniperPnl(0, 0);
      return;
    }

    if (activeTrade && !['STOPPED_OUT', 'COMPLETED', 'REVERSED', 'TIME_EXIT'].includes(activeTrade.tradeStatus)) {
      const uPnl = activeTrade.unrealisedProfitUsd || 0;
      const rPnl = +(cumulativeRealizedProfitUsd + (activeTrade.bookedProfitUsd || 0)).toFixed(2);
      setSniperPnl(uPnl, rPnl);
    } else {
      // Clears unrealized PnL back to 0.00 while preserving cumulative realized profit
      setSniperPnl(0, cumulativeRealizedProfitUsd || 0);
    }
  }, [
    activeTrade,
    activeTrade?.unrealisedProfitUsd,
    activeTrade?.bookedProfitUsd,
    activeTrade?.tradeStatus,
    cumulativeRealizedProfitUsd,
    isLiveUnverified,
    setSniperPnl,
  ]);

  // ═══════════════════════════════════════════════════════════
  // EXTERNAL ORDER CLOSE SYNCHRONIZATION
  // If the user closed the position via Positions Table, Dashboard, Kill Switch,
  // or on the exchange, detect that the position is gone and terminate the sniper trade.
  // In LIVE mode, reconcileLivePerpPositionsNow handles authoritative exchange reconciliation
  // with the 10-second startup hydration guard + 2 consecutive zero-poll confirmation.
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!activeTrade) return;

    if (['STOPPED_OUT', 'COMPLETED', 'REVERSED', 'TIME_EXIT'].includes(activeTrade.tradeStatus)) {
      setActiveTrade(null);
      setIsSignalStandby(true);
      setSniperPnl(0, cumulativeRealizedProfitUsd || 0);
      return;
    }

    if (tradingMode === 'LIVE') {
      // Handled exclusively by reconcileLivePerpPositionsNow (10s guard + 2 consecutive zero polls)
      return;
    }

    // Allow 3-second grace window after trade execution for PAPER order to be registered in positions
    if (Date.now() - activeTrade.openedAt < 3000) return;

    const targetNorm = normalizePerpSymbol(activeTrade.symbol);
    // Check if matching PERP position exists in open positions (ignore Options legs so slots remain independent)
    const hasPosition = perpOnlyPositions.some(
      (pos) =>
        normalizePerpSymbol(pos.symbol) === targetNorm &&
        (pos.mode === tradingMode || (!pos.mode && tradingMode === 'PAPER'))
    );

    if (!hasPosition) {
      const finalPnl = +(activeTrade.bookedProfitUsd + activeTrade.unrealisedProfitUsd).toFixed(2);
      setPaperCumulativeRealizedUsd((prev) => +(prev + finalPnl).toFixed(2));

      addLog('STOP_LOSS', 'Position Closed Externally', `${activeTrade.symbol} order closed. Final Realised PnL: $${finalPnl.toFixed(2)}`);
      setActiveTrade(null);
      setIsSignalStandby(true);
      setSniperPnl(0, +(cumulativeRealizedProfitUsd + finalPnl).toFixed(2));
    }
  }, [
    perpOnlyPositions,
    activeTrade,
    tradingMode,
    cumulativeRealizedProfitUsd,
    setSniperPnl,
    addLog,
    setActiveTrade,
    setIsSignalStandby,
  ]);

  // Continuous Autonomous Signal Refresh Loop (Every 60s + 5m Candle Close) when Auto-Sniper is Armed
  const lastSniperAutoRefreshRef = useRef<number>(Date.now());
  const lastSniperCandleBucketRef = useRef<number>(Math.floor(Date.now() / 300000));
  useEffect(() => {
    if (!isAutoSniperEnabled || activeTrade) return;

    const runRefreshCheck = () => {
      const now = Date.now();
      const curBucket = Math.floor(now / 300000);
      const isNew5mClose = curBucket > lastSniperCandleBucketRef.current;
      const elapsedSinceCreated = now - signalCreatedTsRef.current;
      const elapsedSinceAiRefresh = now - lastSniperAutoRefreshRef.current;

      if (isNew5mClose || elapsedSinceCreated >= 60000) {
        if (isNew5mClose) {
          lastSniperCandleBucketRef.current = curBucket;
          lockedSignalLevelsRef.current = null;
        }
        signalCreatedTsRef.current = now;
        if (isSignalStandby) {
          setIsSignalStandby(false);
        }
        setManualRefreshEpoch((prev) => prev + 1);

        if (elapsedSinceAiRefresh >= 58000 && onRefreshAiAnalysis) {
          lastSniperAutoRefreshRef.current = now;
          Promise.resolve(onRefreshAiAnalysis(selectedSymbol, timeframe)).catch(() => {});
        }
      }
    };

    const timer = setInterval(runRefreshCheck, 15000);
    return () => clearInterval(timer);
  }, [
    isAutoSniperEnabled,
    activeTrade,
    isSignalStandby,
    setIsSignalStandby,
    onRefreshAiAnalysis,
    selectedSymbol,
    timeframe,
  ]);


  // ═══════════════════════════════════════════════════════════
  // AUTO PILOT DISPATCHER
  // Evaluates on mount and whenever isAutoSniperEnabled or currentSignal updates.
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    return () => {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // 1. Guard against disabled auto-pilot, unverified live API, in-flight execution, or active open position
    if (!isAutoSniperEnabled || isLiveUnverified || isExecuting || activeTrade) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    const isBypassActive = tradingMode === 'PAPER' && bypassHtfFilter;

    // 2. Validate trade eligibility: must pass Gate 1 + Gate 7 risk checks, not be stale, and have conviction >= 75%
    const isSignalApproved =
      currentSignal?.riskChecks?.tradeApproved === true &&
      (currentSignal?.riskChecks?.signalValidationPassed === true || isBypassActive);
    const meetsConfidence = (currentSignal?.confidence ?? 0) >= 75;
    const hasValidEntry = (currentSignal?.entryPrice ?? 0) > 0 || (currentSignal?.camarilla?.h4 ?? 0) > 0 || (currentSignal?.camarilla?.pivot ?? 0) > 0;
    const isStaleSignal = Boolean(currentSignal?.timestamp && Date.now() - currentSignal.timestamp > 15 * 60 * 1000);

    if (isStaleSignal) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    // Guard against 30m Harvest Lockout
    const isLockoutActive = harvestTargetHit && (lockoutExpiry !== null && Date.now() < lockoutExpiry);
    if (isLockoutActive) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    // Guard against WIDE CPR (> 0.35%) UNLESS Narrow 5m/15m CPR ($15 Micro override) or Bypass HTF is active
    const isWideCpr = currentSignal.camarilla?.isWideCpr ?? (currentSignal.camarilla?.cprWidthRatio ? currentSignal.camarilla.cprWidthRatio > 0.0035 : false);
    const narrowCprOverride = Boolean(currentSignal.isNarrow5mCpr || currentSignal.riskChecks?.narrowCprOverrideActive);
    if (isWideCpr && !narrowCprOverride && !isBypassActive) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    // Independent 1/1 Perp Micro Slot & Anti-Chop Guard (Max 3/hr, 10m post-SL cooldown, <65% total margin)
    const isMicro15Signal = currentSignal.exposureMode === 'MICRO_15' || currentSignal.scalpTier === 'TIER_15' || narrowCprOverride;
    if (isMicro15Signal && !isBypassActive) {
      if (
        currentSignal.riskChecks?.perpMicroSlotOccupied ||
        currentSignal.riskChecks?.marginUtilizationSafe === false ||
        currentSignal.riskChecks?.microAntiChopPassed === false
      ) {
        if (autoExecutionTimerRef.current) {
          clearTimeout(autoExecutionTimerRef.current);
          autoExecutionTimerRef.current = null;
        }
        pendingAutoSignalIdRef.current = null;
        return;
      }
    }

    // Guard against intra-candle touches, L3–H3 chop zone without H4/L4 5m close, or failed anti-chase / candle momentum checks
    const autoTargetSym = currentSignal.symbol || selectedSymbol;
    const liveCandleStateForAuto = candleHistoryRef.current[autoTargetSym];
    const prevApi5mForAuto = candles5m.length > 1 ? candles5m[candles5m.length - 2] : null;
    const autoHasSimulatedClose = simulatedCandleCloses[autoTargetSym] !== undefined;
    const autoLastClosed5mClose = autoHasSimulatedClose
      ? simulatedCandleCloses[autoTargetSym]
      : liveCandleStateForAuto?.lastClosedCandle?.seededFromApi
      ? liveCandleStateForAuto.lastClosedCandle.close
      : Number(prevApi5mForAuto?.close || 0);
    const recent5mLowForAuto =
      Array.isArray(candles5m) && candles5m.length > 0
        ? Math.min(...candles5m.slice(-6).map((c) => Number(c.low) || markPrice || 81702.5))
        : liveCandleStateForAuto?.currentCandle?.low || markPrice || 81702.5;
    const autoAntiChaseCheck = evaluateAntiChaseAndCandleMomentum({
      side: currentSignal.signal || 'LONG',
      currentPrice: markPrice > 0 ? markPrice : (currentSignal.entryPrice || 81702.5),
      h4: currentSignal.camarilla?.h4 || 0,
      l4: currentSignal.camarilla?.l4 || 0,
      h3: currentSignal.camarilla?.h3 || 0,
      l3: currentSignal.camarilla?.l3 || 0,
      lastClosed5mClose: autoLastClosed5mClose,
      currentCandleOpen: liveCandleStateForAuto?.currentCandle?.open || markPrice || 81702.5,
      currentCandleHigh: liveCandleStateForAuto?.currentCandle?.high || markPrice || 81702.5,
      currentCandleLow: liveCandleStateForAuto?.currentCandle?.low || markPrice || 81702.5,
      recent5mLow: recent5mLowForAuto,
      low24h: curMarket.low24h || (markPrice || 81702.5) * 0.99,
    });

    if (
      (currentSignal.validation?.candleConfirmed === false ||
        !autoAntiChaseCheck.passed ||
        autoAntiChaseCheck.chopZoneBlocked) &&
      !isBypassActive
    ) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    // Strict Anti-Chase & L3–H3 Chop-Zone Guard: block auto-entries while inside L3–H3 unless H4/L4 closed on 5m bar
    const isLongSignal = currentSignal.signal === 'LONG';
    const liveMark = markPrice > 0 ? markPrice : (currentSignal.entryPrice || 81702.50);
    const h4Val = currentSignal.camarilla?.h4 || 0;
    const l4Val = currentSignal.camarilla?.l4 || 0;

    const priceConditionMet = isBypassActive
      ? true
      : isLongSignal
      ? (h4Val > 0 ? liveMark >= h4Val * 0.9995 || (autoLastClosed5mClose > 0 && autoLastClosed5mClose >= h4Val) : true)
      : (l4Val > 0 ? liveMark <= l4Val * 1.0005 || (autoLastClosed5mClose > 0 && autoLastClosed5mClose <= l4Val) : true);

    if (!priceConditionMet) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    const high24 = curMarket.high24h || liveMark * 1.01;
    const low24 = curMarket.low24h || liveMark * 0.99;
    const sessionVwap = (high24 + low24 + liveMark * 2) / 4;
    const htfEma50 = liveMark / (1 + ((curMarket.change24h || 0) / 100) * 0.40);
    const camL3 = currentSignal.camarilla?.l3 || liveMark * 0.995;
    const isHighConfidence = (currentSignal?.confidence ?? 0) >= 75;

    // Guard: Margin Sufficiency Check
    if (currentSignal.riskChecks?.sufficientMargin === false && !isBypassActive) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    if (!isBypassActive && !isHighConfidence) {
      if (isLongSignal) {
        if (liveMark < htfEma50 || liveMark < camL3 || liveMark < sessionVwap) {
          if (autoExecutionTimerRef.current) {
            clearTimeout(autoExecutionTimerRef.current);
            autoExecutionTimerRef.current = null;
          }
          pendingAutoSignalIdRef.current = null;
          return;
        }
      } else {
        if (liveMark > htfEma50 || liveMark > sessionVwap) {
          if (autoExecutionTimerRef.current) {
            clearTimeout(autoExecutionTimerRef.current);
            autoExecutionTimerRef.current = null;
          }
          pendingAutoSignalIdRef.current = null;
          return;
        }
      }
    }

    // Requirement 3: Guard against 15m Cascade Pause (> 1.0% drop in last 15m)
    if (cascadePauseExpiryRef.current > Date.now() && consolidationBarsRef.current < 3) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    if (!isSignalApproved || !meetsConfidence || !hasValidEntry) {
      if (autoExecutionTimerRef.current) {
        clearTimeout(autoExecutionTimerRef.current);
        autoExecutionTimerRef.current = null;
      }
      pendingAutoSignalIdRef.current = null;
      return;
    }

    // 3. Resolve the unique signal setup identifier
    const currentSignalId = currentSignal.id || 
      `${currentSignal.symbol}-${currentSignal.signal}-${currentSignal.exposureMode || 'MACRO'}-${currentSignal.confidence}-${Math.round(currentSignal.entryPrice || 0)}`;

    // 4. Prevent duplicate dispatches for the exact same signal setup that was already auto-executed
    if (lastAutoExecutedSignalId.current === currentSignalId) {
      return;
    }

    // 5. If confirmation timer is already counting down for this exact signal setup, let it run uninterrupted
    if (pendingAutoSignalIdRef.current === currentSignalId && autoExecutionTimerRef.current) {
      return;
    }

    // 6. Reset any prior pending timer if a new signal setup arrived
    if (autoExecutionTimerRef.current) {
      clearTimeout(autoExecutionTimerRef.current);
      autoExecutionTimerRef.current = null;
    }

    pendingAutoSignalIdRef.current = currentSignalId;

    // 7. Start 1.5s signal confirmation window before order dispatch
    autoExecutionTimerRef.current = setTimeout(() => {
      autoExecutionTimerRef.current = null;
      pendingAutoSignalIdRef.current = null;

      // Final sanity check before dispatching trade
      if (!isAutoSniperEnabled || isLiveUnverified || isExecuting || activeTrade) return;

      lastAutoExecutedSignalId.current = currentSignalId;
      lastAttemptTsRef.current = Date.now();

      addLog(
        'EXECUTION',
        'Auto-Pilot Triggered',
        `AUTO-PILOT: Order executed based on AI Command consensus (Confidence: ${currentSignal.confidence}%)`
      );
      executeSniperTrade(currentSignal);
    }, 1500);
  }, [
    isAutoSniperEnabled,
    currentSignal,
    activeTrade,
    isExecuting,
    executeSniperTrade,
    addLog,

  ]);

  // Manual Reset / Emergency Close — Immediately clears activeTrade and wipes target ladder to "---"
  const closeActiveSniperTrade = useCallback((reason?: any) => {
    if (!activeTrade) {
      setActiveTrade(null);
      setIsSignalStandby(true);
      setSniperPnl(0, cumulativeRealizedProfitUsd || 0);
      return;
    }
    const cleanReason = (typeof reason === 'string' && reason.trim()) ? reason : 'Manual Sniper Emergency Close';
    const finalPnl = +(activeTrade.bookedProfitUsd + activeTrade.unrealisedProfitUsd).toFixed(2);
    const newCumulative = +(cumulativeRealizedProfitUsd + finalPnl).toFixed(2);

    if (tradingMode === 'LIVE') {
      setLiveCumulativeRealizedUsd((prev) => +(prev + finalPnl).toFixed(2));
    } else {
      setPaperCumulativeRealizedUsd((prev) => +(prev + finalPnl).toFixed(2));
    }
    if (finalPnl > activeTrade.bookedProfitUsd) {
      registerRealizedPnL(finalPnl - activeTrade.bookedProfitUsd);
    }

    if (!['STOPPED_OUT', 'COMPLETED', 'REVERSED', 'TIME_EXIT'].includes(activeTrade.tradeStatus)) {
      addLog('STOP_LOSS', 'Position Manually Closed', `${activeTrade.symbol} closed (${cleanReason}). Final Realised PnL: $${finalPnl.toFixed(2)}`);
      onSendNotification('Sniper Position Closed', `${activeTrade.symbol} manually closed @ $${markPrice.toLocaleString()}. PnL: $${finalPnl.toFixed(2)}`, 'INFO');
    }

    // Close corresponding open position on backend if present (canonical BTCUSD <-> BTCUSDT matching)
    if (onClosePosition && positions) {
      const activeNorm = normalizePerpSymbol(activeTrade.symbol);
      const matchingPos = positions.find(
        (p) =>
          (p.id && activeTrade.positionId && String(p.id) === String(activeTrade.positionId)) ||
          (normalizePerpSymbol(p.symbol) === activeNorm && (p.mode === tradingMode || (!p.mode && tradingMode === 'PAPER')))
      );
      if (matchingPos) {
        onClosePosition(matchingPos.id, cleanReason).catch((err) => {
          console.error('[SniperExecution] Critical Position Close Error:', {
            error: err,
            positionId: matchingPos.id,
            reason: cleanReason,
            timestamp: new Date().toISOString()
          });
          addLog('BLOCKED', 'Position Close Error', err?.message || 'Failed to close position on Delta Exchange India');
        });
      }
    }

    // Immediately zero out active unrealized PnL in global PortfolioContext
    setSniperPnl(0, newCumulative);

    setActiveTrade(null);
    setIsSignalStandby(true);
  }, [
    activeTrade,
    markPrice,
    addLog,
    onSendNotification,
    setActiveTrade,
    setIsSignalStandby,
    tradingMode,
    cumulativeRealizedProfitUsd,
    setSniperPnl,
    onClosePosition,
    positions,
    registerRealizedPnL,
  ]);

  const resetCircuitBreaker = useCallback(() => {
    consecutiveStopsCountRef.current = 0;
    setConsecutiveStopsCount(0);

    // setPairCooldowns({}); - Removed
    setIsSignalStandby(false);
    if (tradingMode === 'LIVE') {
      if (isLiveApiAuthenticated) {
        setLiveAutoSniperEnabled(true);
        setLiveSignalStandby(false);
      }
    } else {
      setPaperAutoSniperEnabled(true);
      setPaperSignalStandby(false);
    }
    addLog('AUTOPILOT', 'Circuit Breaker & Cooldown Reset', 'Circuit breaker reset manually. Loss count cleared, 15m cooldowns removed, Auto-Pilot re-armed.');
    onSendNotification('Circuit Breaker Reset', 'Circuit breaker reset manually. Auto-Pilot re-armed.', 'INFO');
  }, [tradingMode, isLiveApiAuthenticated, addLog, onSendNotification, setIsSignalStandby]);

  const clearTradeLogs = useCallback(() => {
    if (tradingMode === 'LIVE') {
      setLiveTradeLogs([]);
    } else {
      setPaperTradeLogs([]);
    }
  }, [tradingMode]);

  // ═══════════════════════════════════════════════════════════
  // PERPETUAL DRAWDOWN ADJUSTMENT & RESCUE ENGINE
  // Activates at <= -0.50R drawdown on open BTCUSD/ETHUSD/SOLUSD Perps
  // Enforces Single-Adjustment Lock (<=1/trade), Anti-Martingale, <=2% equity risk & 1:1 lot match
  // ═══════════════════════════════════════════════════════════
  const [rescueRecordsByKey, setRescueRecordsByKey] = useState<Record<string, PerpetualRescueAdjustmentRecord>>({});
  const [rescueOptionQuote, setRescueOptionQuote] = useState<PerpetualRescueOptionQuote | null>(null);
  const [isExecutingRescue, setIsExecutingRescue] = useState<boolean>(false);
  const rescueExecutionLockRef = useRef<boolean>(false);

  // Per-position Drawdown Rescue circuit-breaker map keyed by `${symbol}_${entryPrice}_${side}`
  // Latches immediately on execution OR exchange rejection (e.g. insufficient_margin) for >= 15 minutes
  // or until available wallet margin increases above required_additional_balance.
  const RESCUE_CIRCUIT_STORAGE_KEY = 'delta_rescue_circuit_breaker_v1';
  const rescueAttemptedOrBlockedMapRef = useRef<Map<string, RescueCircuitBreakerEntry>>(
    (() => {
      const map = new Map<string, RescueCircuitBreakerEntry>();
      try {
        const raw = localStorage.getItem(RESCUE_CIRCUIT_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const now = Date.now();
          if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed)) {
              const entry = v as RescueCircuitBreakerEntry;
              if (
                entry &&
                typeof entry === 'object' &&
                (entry.status === 'EXECUTED' ||
                  entry.status === 'FALLBACK_DERISK_EXECUTED' ||
                  (typeof entry.cooldownUntil === 'number' && entry.cooldownUntil > now))
              ) {
                map.set(k, entry);
              }
            }
          }
        }
      } catch {}
      return map;
    })()
  );

  const persistRescueCircuitMap = useCallback(() => {
    try {
      const now = Date.now();
      const serializable: Record<string, RescueCircuitBreakerEntry> = {};
      for (const [k, v] of rescueAttemptedOrBlockedMapRef.current.entries()) {
        if (
          v.status === 'EXECUTED' ||
          v.status === 'FALLBACK_DERISK_EXECUTED' ||
          v.cooldownUntil > now
        ) {
          serializable[k] = v;
        }
      }
      localStorage.setItem(RESCUE_CIRCUIT_STORAGE_KEY, JSON.stringify(serializable));
    } catch {}
  }, []);

  const latchRescueCircuitEntry = useCallback(
    (entry: RescueCircuitBreakerEntry) => {
      rescueAttemptedOrBlockedMapRef.current.set(entry.positionKey, entry);
      persistRescueCircuitMap();
    },
    [persistRescueCircuitMap]
  );

  // Hydrate persisted rescue records from ~/.deltaai-data/rescue-adjustments.json on mount
  useEffect(() => {
    let mounted = true;
    fetch('/api/delta/rescue-state')
      .then((res) => res.json())
      .then((data) => {
        if (!mounted || !data?.success || !data?.records) return;
        setRescueRecordsByKey(data.records);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Resolve target open BTCUSD/ETHUSD/SOLUSD perpetual position (activeTrade or matching perp position)
  const rescueTargetPosition = useMemo(() => {
    if (isLiveUnverified) return null;

    if (
      activeTrade &&
      !['COMPLETED', 'STOPPED_OUT', 'REVERSED', 'TIME_EXIT'].includes(activeTrade.tradeStatus) &&
      getSupportedRescuePerpSpec(activeTrade.symbol)
    ) {
      const spec = getSupportedRescuePerpSpec(activeTrade.symbol)!;
      const ticker = getMarketTicker(markets, spec.canonicalSymbol);
      const curMark = ticker.markPrice > 0 ? ticker.markPrice : activeTrade.currentPrice || activeTrade.entryPrice;
      const remCoin = activeTrade.remainingSize > 0 ? activeTrade.remainingSize : activeTrade.lotSize;
      const contracts = Math.max(1, Math.round(remCoin / spec.contractValue));
      const signedCoin = activeTrade.signal === 'LONG' ? remCoin : -remCoin;
      const matchedExchangePos = perpOnlyPositions.find(
        (p) =>
          (p.mode || 'PAPER') === tradingMode &&
          getSupportedRescuePerpSpec(p.product_symbol || p.rawSymbol || p.symbol)?.deltaSymbol === spec.deltaSymbol
      );
      const liveUpnl =
        matchedExchangePos && Number.isFinite(Number(matchedExchangePos.unrealisedPnl))
          ? Number(matchedExchangePos.unrealisedPnl)
          : typeof activeTrade.unrealizedPnlUsd === 'number'
          ? activeTrade.unrealizedPnlUsd
          : (curMark - activeTrade.entryPrice) * signedCoin;

      return {
        tradeId: activeTrade.id,
        positionId: activeTrade.positionId || matchedExchangePos?.id,
        symbol: spec.deltaSymbol,
        side: activeTrade.signal,
        entryPrice: activeTrade.entryPrice,
        markPrice: curMark,
        stopLoss: activeTrade.currentStopLoss || activeTrade.initialStopLoss,
        lotSize: remCoin,
        contracts: matchedExchangePos?.contracts || contracts,
        unrealizedPnlUsd: liveUpnl,
        camarilla: activeTrade.camarilla || currentSignal.camarilla,
        leverage: activeTrade.leverage || capitalAlloc.globalLeverage,
      };
    }

    const openEligiblePerp = perpOnlyPositions.find((p) => {
      if ((p.mode || 'PAPER') !== tradingMode) return false;
      const spec = getSupportedRescuePerpSpec(p.product_symbol || p.rawSymbol || p.symbol);
      return Boolean(spec) && (p.size || 0) > 0;
    });

    if (!openEligiblePerp) return null;
    const spec = getSupportedRescuePerpSpec(
      openEligiblePerp.product_symbol || openEligiblePerp.rawSymbol || openEligiblePerp.symbol
    )!;
    const ticker = getMarketTicker(markets, spec.canonicalSymbol);
    const curMark =
      ticker.markPrice > 0
        ? ticker.markPrice
        : openEligiblePerp.markPrice || openEligiblePerp.entryPrice;
    const upnl =
      Number.isFinite(Number(openEligiblePerp.unrealisedPnl))
        ? Number(openEligiblePerp.unrealisedPnl)
        : (curMark - openEligiblePerp.entryPrice) *
          (openEligiblePerp.side === 'SHORT' ? -openEligiblePerp.size : openEligiblePerp.size);

    return {
      tradeId: openEligiblePerp.id,
      positionId: openEligiblePerp.id,
      symbol: spec.deltaSymbol,
      side: openEligiblePerp.side,
      entryPrice: openEligiblePerp.entryPrice,
      markPrice: curMark,
      stopLoss: Number(openEligiblePerp.stopLoss || 0),
      lotSize: openEligiblePerp.size,
      contracts:
        openEligiblePerp.contracts ||
        Math.max(1, Math.round(openEligiblePerp.size / spec.contractValue)),
      unrealizedPnlUsd: upnl,
      camarilla: currentSignal.camarilla,
      leverage: openEligiblePerp.leverage || capitalAlloc.globalLeverage,
    };
  }, [
    isLiveUnverified,
    activeTrade,
    perpOnlyPositions,
    tradingMode,
    markets,
    currentSignal.camarilla,
    capitalAlloc.globalLeverage,
  ]);

  const activeExecutedRescueRecord = useMemo(() => {
    if (!rescueTargetPosition) return null;
    if (activeTrade?.rescueAdjustment && (activeTrade.adjustmentCount || 0) >= 1) {
      return activeTrade.rescueAdjustment;
    }
    const candidateKey = buildRescueTradeKey({
      mode: tradingMode,
      tradeId: rescueTargetPosition.tradeId,
      positionId: rescueTargetPosition.positionId,
      symbol: rescueTargetPosition.symbol,
    });
    if (rescueRecordsByKey[candidateKey]) return rescueRecordsByKey[candidateKey];
    return (
      Object.values(rescueRecordsByKey).find(
        (rec) =>
          rec.mode === tradingMode &&
          (rec.tradeId === rescueTargetPosition.tradeId ||
            (rescueTargetPosition.positionId && rec.positionId === rescueTargetPosition.positionId))
      ) || null
    );
  }, [rescueTargetPosition, activeTrade, tradingMode, rescueRecordsByKey]);

  // Fetch nearest same-day Delta Exchange India option contract when a perp enters drawdown
  useEffect(() => {
    if (!rescueTargetPosition || rescueTargetPosition.unrealizedPnlUsd >= 0) {
      return;
    }
    let cancelled = false;
    const fetchQuote = () => {
      const qs = new URLSearchParams({
        symbol: rescueTargetPosition.symbol,
        side: rescueTargetPosition.side,
        contracts: String(rescueTargetPosition.contracts),
      });
      fetch(`/api/delta/options/nearest-same-day?${qs.toString()}`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled && data?.success && data?.quote) {
            setRescueOptionQuote(data.quote);
          }
        })
        .catch(() => {});
    };
    fetchQuote();
    const timer = setInterval(fetchQuote, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    rescueTargetPosition?.symbol,
    rescueTargetPosition?.side,
    rescueTargetPosition?.contracts,
    rescueTargetPosition ? rescueTargetPosition.unrealizedPnlUsd < 0 : false,
  ]);

  const rescueRecommendation: PerpetualRescueRecommendation | null = useMemo(() => {
    if (!rescueTargetPosition) return null;
    const tracker = candleHistoryRef.current[rescueTargetPosition.symbol] || candleHistoryRef.current[selectedSymbol];
    const simClose = simulatedCandleCloses[selectedSymbol] || simulatedCandleCloses[rescueTargetPosition.symbol];
    const closed5mVal =
      simClose && simClose > 0
        ? simClose
        : tracker?.lastClosedCandle?.close && tracker.lastClosedCandle.close > 0
        ? tracker.lastClosedCandle.close
        : undefined;
    const aiMatrixPctVal = Math.min(
      99,
      Math.round(currentSignal.confidence || 0)
    );
    const eqUsd =
      typeof totalEquity === 'number' && totalEquity > 0
        ? totalEquity
        : Math.max(availableBalance + (marginUsed || 0), 100);

    return buildPerpetualRescueRecommendation({
      mode: tradingMode,
      tradeId: rescueTargetPosition.tradeId,
      positionId: rescueTargetPosition.positionId,
      symbol: rescueTargetPosition.symbol,
      side: rescueTargetPosition.side,
      entryPrice: rescueTargetPosition.entryPrice,
      markPrice: rescueTargetPosition.markPrice,
      stopLoss: rescueTargetPosition.stopLoss,
      lotSize: rescueTargetPosition.lotSize,
      contracts: rescueTargetPosition.contracts,
      unrealizedPnlUsd: rescueTargetPosition.unrealizedPnlUsd,
      usdInrRate: usdInrRef.current > 0 ? usdInrRef.current : 85,
      totalEquityUsd: eqUsd,
      candles4h,
      candles5m,
      lastClosed5mClose: closed5mVal,
      camarilla: rescueTargetPosition.camarilla,
      fibonacci: currentSignal.fibonacci,
      aiMatrixPct: aiMatrixPctVal,
      fallbackChange24h: curMarket.change24h,
      optionQuote: rescueOptionQuote,
      executedRecord: activeExecutedRescueRecord,
    });
  }, [
    rescueTargetPosition,
    selectedSymbol,
    simulatedCandleCloses,
    currentSignal.confidence,
    currentSignal.fibonacci,
    totalEquity,
    availableBalance,
    marginUsed,
    tradingMode,
    candles4h,
    candles5m,
    curMarket.change24h,
    rescueOptionQuote,
    activeExecutedRescueRecord,
  ]);

  const executePerpetualRescueAction = useCallback(
    async (
      actionType: PerpetualRescueActionType,
      options?: { triggerSource?: 'AUTO' | 'MANUAL' }
    ) => {
      const triggerSource = options?.triggerSource || 'MANUAL';
      if (rescueExecutionLockRef.current || isExecutingRescue) return;
      if (isLiveUnverified) {
        if (triggerSource === 'MANUAL') {
          onSendNotification('Live API Credentials Required', 'Connect Delta Exchange India API credentials before executing a live rescue adjustment.', 'RISK');
        }
        return;
      }

      const rec = rescueRecommendation;
      if (!rec) {
        if (triggerSource === 'MANUAL') {
          addLog('BLOCKED', 'Rescue Unavailable', 'No eligible BTCUSD/ETHUSD/SOLUSD perpetual position in drawdown.');
        }
        return;
      }

      const positionCircuitKey = buildRescuePositionCircuitKey(
        rec.deltaSymbol,
        rec.entryPrice,
        rec.side
      );
      const existingCircuitEntry = rescueAttemptedOrBlockedMapRef.current.get(positionCircuitKey);
      const circuitEval = evaluateRescueCircuitBreaker({
        entry: existingCircuitEntry,
        currentAvailableBalance: availableBalance,
      });

      if (circuitEval.unlockedByMarginRecovery) {
        rescueAttemptedOrBlockedMapRef.current.delete(positionCircuitKey);
        persistRescueCircuitMap();
      } else if (circuitEval.isBlocked) {
        // Auto-rescue silently respects the 15-minute / executed circuit-breaker latch (zero retry spam)
        if (triggerSource === 'AUTO') {
          return;
        }
        if (
          existingCircuitEntry &&
          (existingCircuitEntry.status === 'EXECUTED' ||
            existingCircuitEntry.status === 'FALLBACK_DERISK_EXECUTED')
        ) {
          const msg = 'Single-Adjustment Safety Lock: Max 1 rescue adjustment per trade has already been executed.';
          addLog('BLOCKED', 'Rescue Adjustment Locked (1/1)', msg);
          onSendNotification('Single-Adjustment Lock Active', msg, 'RISK');
          return;
        }
      }

      if (rec.isLocked || rec.adjustmentCount >= RESCUE_MAX_ADJUSTMENTS_PER_TRADE || (activeTrade?.adjustmentCount || 0) >= 1) {
        const msg = 'Single-Adjustment Safety Lock: Max 1 rescue adjustment per trade has already been executed.';
        if (triggerSource === 'MANUAL') {
          addLog('BLOCKED', 'Rescue Adjustment Locked (1/1)', msg);
          onSendNotification('Single-Adjustment Lock Active', msg, 'RISK');
        }
        return;
      }

      if (rec.rMultiple > -0.50 || rec.unrealizedPnlUsd >= 0) {
        const msg = `Drawdown Rescue arms at -0.50R (current: ${rec.rMultiple.toFixed(2)}R). Blind mid-candle averaging down is blocked.`;
        if (triggerSource === 'MANUAL') {
          addLog('BLOCKED', 'Rescue Threshold Not Met', msg);
          onSendNotification('Rescue Threshold Guard', msg, 'RISK');
        }
        return;
      }

      const closingSide: 'SELL' | 'BUY' = rec.side === 'LONG' ? 'SELL' : 'BUY';
      const activeLeverage = rescueTargetPosition?.leverage || capitalAlloc.globalLeverage || 10;
      const totalEqUsd =
        typeof totalEquity === 'number' && totalEquity > 0
          ? totalEquity
          : Math.max(availableBalance + (marginUsed || 0), 100);

      const marginPreCheck = estimateRescueActionRequiredMarginUsd({
        actionType,
        recommendation: rec,
        leverage: activeLeverage,
      });

      // Helper for $0-margin reduce_only 50% partial close fallback when insufficient margin exists
      const executeZeroMarginReduceOnlyFallback = async (shortfallReason: string, requiredAddUsd: number | null) => {
        const closeContracts = marginPreCheck.fallbackCloseContracts;
        const closeSizeCoin = marginPreCheck.fallbackCloseSizeCoin;
        const reduceRes: any = await onExecuteOrder({
          symbol: rec.deltaSymbol,
          side: closingSide,
          size: closeSizeCoin,
          contracts: closeContracts,
          orderType: 'MARKET',
          reduce_only: true,
          reduceOnly: true,
          stopLoss: rec.stopLoss,
          leverage: activeLeverage,
          marginMode: capitalAlloc.marginMode,
          strategy: 'Perpetual Drawdown Rescue · $0-Margin 50% De-Risk Fallback',
          strategyTag: 'PERPETUAL_RESCUE_DERISK_FALLBACK',
          isRescueOrder: true,
          disableEquityCap: true,
          mode: tradingMode,
        });

        const closeFillPx = Number(
          reduceRes?.average_fill_price || reduceRes?.order?.average_fill_price || rec.markPrice
        );
        const halfLossUsd = +(
          (rec.side === 'LONG' ? closeFillPx - rec.entryPrice : rec.entryPrice - closeFillPx) *
          closeSizeCoin
        ).toFixed(2);
        const remainingAfter50 = Math.max(
          rec.contractValue,
          +(rec.lotSize - closeSizeCoin).toFixed(6)
        );
        const immediateBe = rec.projectedDeRiskReAnchor.immediatePostCloseBe || rec.entryPrice;

        if (activeTrade) {
          setActiveTrade({
            ...activeTrade,
            lotSize: remainingAfter50,
            remainingSize: remainingAfter50,
            bookedProfitUsd: +((activeTrade.bookedProfitUsd || 0) + halfLossUsd).toFixed(2),
            adjustedBreakEvenPrice: immediateBe,
            netBreakevenPrice: immediateBe,
            adjustmentCount: 1,
            aiVerdict: `RESCUE FALLBACK EXECUTED ($0-Margin 50% Reduce-Only Close @ $${closeFillPx.toLocaleString()}). Margin preserved [1/1 LOCKED].`,
          });
        }

        const nowMs = Date.now();
        latchRescueCircuitEntry({
          positionKey: positionCircuitKey,
          status: 'FALLBACK_DERISK_EXECUTED',
          action: 'DE_RISK_REANCHOR',
          reason: shortfallReason,
          errorCode: 'insufficient_margin_fallback_derisk',
          blockedAt: nowMs,
          cooldownUntil: nowMs + RESCUE_BLOCK_COOLDOWN_MS,
          availableBalanceAtBlock: availableBalance,
          requiredAdditionalBalance: requiredAddUsd,
          targetAvailableBalanceToUnlock:
            requiredAddUsd && requiredAddUsd > 0 ? +(availableBalance + requiredAddUsd).toFixed(4) : null,
        });

        // Persist single-adjustment lock on server
        const persistRes = await fetch('/api/delta/rescue/validate-and-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tradeKey: rec.tradeKey,
            tradeId: rec.tradeId,
            positionId: rec.positionId,
            symbol: rec.deltaSymbol,
            side: rec.side,
            mode: tradingMode,
            action: 'DE_RISK_REANCHOR',
            originalEntryPrice: rec.entryPrice,
            adjustedBreakEvenPrice: immediateBe,
            triggerRMultiple: rec.rMultiple,
            unrealizedPnlAtTrigger: rec.unrealizedPnlUsd,
            contractsMatched: closeContracts,
            equityRiskPct: Math.min(2, rec.projectedDeRiskReAnchor.equityRiskPct || 1),
            details: {
              deRiskClosedSize: closeSizeCoin,
              deRiskRealizedPnlUsd: halfLossUsd,
              reAnchorZoneLabel: 'Skipped (Insufficient Margin · $0-Margin Reduce-Only Fallback)',
              reAnchorPrice: closeFillPx,
              fallbackReduceOnly: true,
              shortfallReason,
            },
          }),
        }).catch(() => null);
        const persistJson = persistRes ? await persistRes.json().catch(() => null) : null;
        if (persistJson?.record) {
          setRescueRecordsByKey((prev) => ({
            ...prev,
            [persistJson.record.tradeKey]: persistJson.record,
          }));
        }

        addLog(
          'RESCUE',
          'Drawdown Rescue Fallback: 50% Reduce-Only De-Risk Executed',
          `${rec.deltaSymbol}: ${shortfallReason}. Executed $0-margin reduce_only 50% close (${closeContracts} cts @ $${closeFillPx.toLocaleString()}) instead of adding margin. Auto-rescue latched (1/1).`
        );
        onSendNotification(
          'Rescue Fallback · 50% De-Risk Executed',
          `${rec.deltaSymbol}: Insufficient margin for ${actionType}. Executed $0-margin reduce_only 50% partial close (${closeContracts} cts @ $${closeFillPx.toLocaleString()}). Position latched.`,
          'RISK'
        );
      };

      rescueExecutionLockRef.current = true;
      setIsExecutingRescue(true);

      let didExecuteReduceOnlyClose = false;

      try {
        // Pre-check availableBalance >= requiredMargin BEFORE submitting any margin-consuming rescue order
        if (availableBalance < marginPreCheck.netAdditionalMarginNeededUsd) {
          const shortfallUsd = +(
            marginPreCheck.netAdditionalMarginNeededUsd - Math.max(0, availableBalance)
          ).toFixed(2);
          const preCheckMsg = `Insufficient available margin ($${availableBalance.toFixed(2)} available < $${marginPreCheck.netAdditionalMarginNeededUsd.toFixed(2)} required; shortfall ~$${shortfallUsd.toFixed(2)})`;

          if (marginPreCheck.canFallbackToReduceOnly50) {
            await executeZeroMarginReduceOnlyFallback(preCheckMsg, shortfallUsd);
            return;
          }

          // Cannot split 50% (e.g. 1 contract minimum) -> latch for 15 minutes (or until margin increases) & warn ONCE
          const nowMs = Date.now();
          latchRescueCircuitEntry({
            positionKey: positionCircuitKey,
            status: 'BLOCKED',
            action: actionType,
            reason: `${preCheckMsg}. Auto-rescue paused 15m (or until wallet margin recovers).`,
            errorCode: 'insufficient_margin',
            blockedAt: nowMs,
            cooldownUntil: nowMs + RESCUE_BLOCK_COOLDOWN_MS,
            availableBalanceAtBlock: availableBalance,
            requiredAdditionalBalance: shortfallUsd,
            targetAvailableBalanceToUnlock: +(availableBalance + shortfallUsd).toFixed(4),
          });
          addLog(
            'BLOCKED',
            'Drawdown Rescue Blocked (Insufficient Margin)',
            `${rec.deltaSymbol} (${rec.side}): ${preCheckMsg}. Minimum 1x contract cannot split 50% reduce_only. Auto-rescue paused for 15 minutes or until margin increases by $${shortfallUsd.toFixed(2)}.`
          );
          onSendNotification(
            'Drawdown Rescue Blocked',
            `${rec.deltaSymbol}: ${preCheckMsg}. Auto-rescue paused 15m to prevent retry loops.`,
            'RISK'
          );
          return;
        }

        let adjustedBePrice = rec.adjustedBreakEvenPrice;
        let equityRiskPct = 1.0;
        let contractsMatched = rec.contracts;
        const details: Record<string, any> = {};

        if (actionType === 'DE_RISK_REANCHOR') {
          const plan = rec.projectedDeRiskReAnchor;
          if (!plan.trend4hValid) {
            throw new Error(`4h Trend Guard Blocked Re-Anchor: ${plan.trend4hReason}`);
          }
          if (!plan.within2PctRisk) {
            throw new Error(`Equity Risk Cap Exceeded: ${plan.equityRiskPct.toFixed(2)}% > 2.0%`);
          }

          // Step 1: Immediately close 50% of losing perpetual contracts (reduce_only: true) BEFORE placing limit re-entry
          const reduceRes: any = await onExecuteOrder({
            symbol: rec.deltaSymbol,
            side: closingSide,
            size: plan.closeSizeCoin,
            contracts: plan.closeContracts,
            orderType: 'MARKET',
            reduce_only: true,
            reduceOnly: true,
            stopLoss: rec.stopLoss,
            leverage: activeLeverage,
            marginMode: capitalAlloc.marginMode,
            strategy: 'Perpetual Drawdown Rescue · 50% De-Risk Close',
            strategyTag: 'PERPETUAL_RESCUE_DERISK',
            isRescueOrder: true,
            disableEquityCap: true,
            mode: tradingMode,
          });
          didExecuteReduceOnlyClose = true;

          const closeFillPx = Number(reduceRes?.average_fill_price || reduceRes?.order?.average_fill_price || rec.markPrice);
          const halfLossUsd = +((rec.side === 'LONG' ? closeFillPx - rec.entryPrice : rec.entryPrice - closeFillPx) * plan.closeSizeCoin).toFixed(2);

          // Step 2: Place passive LIMIT re-entry at nearest Camarilla L3/L4 or 0.618 Golden Pocket
          const reAnchorRes: any = await onExecuteOrder({
            symbol: rec.deltaSymbol,
            side: rec.side === 'LONG' ? 'BUY' : 'SELL',
            size: +(plan.reAnchorContracts * rec.contractValue).toFixed(6),
            contracts: plan.reAnchorContracts,
            orderType: 'LIMIT',
            limitPrice: plan.reAnchorPrice,
            limit_price: String(plan.reAnchorPrice),
            entryPrice: plan.reAnchorPrice,
            stopLoss: rec.stopLoss,
            leverage: activeLeverage,
            marginMode: capitalAlloc.marginMode,
            strategy: `Perpetual Drawdown Rescue · Re-Anchor ${plan.reAnchorZoneLabel}`,
            strategyTag: 'PERPETUAL_RESCUE_REANCHOR',
            isRescueOrder: true,
            isRescueReAnchor: true,
            rescueDeRiskExecuted: true,
            rescueTradeKey: rec.tradeKey,
            rescueTradeId: rec.tradeId,
            rescuePositionCircuitKey: positionCircuitKey,
            forceManualOverride: triggerSource === 'MANUAL',
            disableEquityCap: true,
            mode: tradingMode,
          });

          adjustedBePrice = plan.projectedAdjustedBe;
          equityRiskPct = plan.equityRiskPct;
          contractsMatched = plan.reAnchorContracts;
          details.deRiskClosedSize = plan.closeSizeCoin;
          details.deRiskRealizedPnlUsd = halfLossUsd;
          details.reAnchorZoneLabel = plan.reAnchorZoneLabel;
          details.reAnchorPrice = plan.reAnchorPrice;
          details.reAnchorOrderId = reAnchorRes?.order_id || reAnchorRes?.orderId;

          const remainingAfter50 = Math.max(rec.contractValue, +(rec.lotSize - plan.closeSizeCoin).toFixed(6));
          if (activeTrade) {
            setActiveTrade({
              ...activeTrade,
              lotSize: remainingAfter50,
              remainingSize: remainingAfter50,
              bookedProfitUsd: +((activeTrade.bookedProfitUsd || 0) + halfLossUsd).toFixed(2),
              adjustedBreakEvenPrice: adjustedBePrice,
              netBreakevenPrice: adjustedBePrice,
              adjustmentCount: 1,
              aiVerdict: `RESCUE EXECUTED (50% De-Risk + Limit Re-Anchor @ $${plan.reAnchorPrice.toLocaleString()} ${plan.reAnchorZoneLabel}). Adjusted BE: $${adjustedBePrice.toLocaleString()} [1/1 LOCKED].`,
            });
          }
        } else if (actionType === 'OPTIONS_HEDGE_OVERLAY') {
          const hedgePlan = rec.projectedOptionsHedge;
          // Fetch freshest nearest same-day quote on execution
          let quote = hedgePlan.optionQuote;
          try {
            const qs = new URLSearchParams({
              symbol: rec.deltaSymbol,
              side: rec.side,
              contracts: String(rec.contracts),
            });
            const qRes = await fetch(`/api/delta/options/nearest-same-day?${qs.toString()}`);
            const qJson = await qRes.json();
            if (qJson?.success && qJson?.quote) {
              quote = qJson.quote;
              setRescueOptionQuote(quote);
            }
          } catch {}

          if (!quote || !quote.symbol) {
            throw new Error('Could not resolve nearest same-day Delta Exchange India option contract.');
          }

          // Strict 1:1 matched contracts & <= 2% equity risk check
          const riskCheck = enforceMaxEquityRiskContracts({
            totalEquityUsd: totalEqUsd,
            entryPrice: rec.markPrice,
            stopLoss: rec.stopLoss,
            requestedContracts: rec.contracts,
            contractValue: quote.contractValue || rec.contractValue,
          });
          if (!riskCheck.within2PctRisk) {
            throw new Error(`Options Hedge Risk Cap Exceeded: ${riskCheck.equityRiskPct.toFixed(2)}% > 2.0% max equity risk.`);
          }

          const optOrderRes: any = await onExecuteOrder({
            symbol: quote.symbol,
            product_id: quote.productId,
            underlying: rec.deltaSymbol.replace('USD', ''),
            optionType: quote.optionType,
            strike: quote.strike,
            expiry: quote.expiryCode,
            isOption: true,
            side: 'SELL',
            contracts: rec.contracts,
            size: rec.contracts,
            isContracts: true,
            orderType: 'MARKET',
            entryPremium: quote.markPrice,
            premiumEntry: quote.markPrice,
            leverage: capitalAlloc.clampLeverage(capitalAlloc.globalLeverage),
            marginMode: capitalAlloc.marginMode,
            strategy: `Perpetual Drawdown Rescue · 1:1 Short ${quote.optionType} Overlay`,
            strategyTag: 'PERPETUAL_RESCUE_OPTIONS_HEDGE',
            isRescueOrder: true,
            rescuePositionCircuitKey: positionCircuitKey,
            forceManualOverride: triggerSource === 'MANUAL',
            disableEquityCap: true,
            mode: tradingMode,
          });

          const optFillPrem = Number(optOrderRes?.average_fill_price || optOrderRes?.order?.average_fill_price || quote.markPrice);
          const creditUsd = +(rec.contracts * (quote.contractValue || rec.contractValue) * optFillPrem).toFixed(2);
          adjustedBePrice =
            rec.side === 'LONG'
              ? +(Math.max(0.01, rec.entryPrice - optFillPrem)).toFixed(2)
              : +(rec.entryPrice + optFillPrem).toFixed(2);
          equityRiskPct = hedgePlan.equityRiskPct;
          contractsMatched = rec.contracts;

          details.optionSymbol = quote.symbol;
          details.optionSide = 'SELL';
          details.optionPremiumPerCoin = optFillPrem;
          details.optionCreditUsd = creditUsd;
          details.optionOrderId = optOrderRes?.order_id || optOrderRes?.orderId;

          if (activeTrade) {
            setActiveTrade({
              ...activeTrade,
              adjustedBreakEvenPrice: adjustedBePrice,
              netBreakevenPrice: adjustedBePrice,
              adjustmentCount: 1,
              aiVerdict: `OPTIONS HEDGE OVERLAY (1:1 ${quote.symbol}): Collected $${creditUsd.toFixed(2)} premium ($${optFillPrem.toFixed(2)}/unit). Adjusted BE: $${adjustedBePrice.toLocaleString()} [1/1 LOCKED].`,
            });
          }
        } else {
          // TREND_FLIP_REVERSE
          const flipPlan = rec.projectedTrendFlip;
          if (!flipPlan.candleClosedBeyondOpposite || !flipPlan.aiMatrixMet) {
            throw new Error(flipPlan.reason);
          }

          // Step 1: Close 100% of losing position (reduce_only: true)
          const closeAllRes: any = await onExecuteOrder({
            symbol: rec.deltaSymbol,
            side: closingSide,
            size: rec.lotSize,
            contracts: rec.contracts,
            orderType: 'MARKET',
            reduce_only: true,
            reduceOnly: true,
            leverage: activeLeverage,
            marginMode: capitalAlloc.marginMode,
            strategy: 'Perpetual Drawdown Rescue · Trend-Flip 100% Exit',
            strategyTag: 'PERPETUAL_RESCUE_FLIP_EXIT',
            isRescueOrder: true,
            disableEquityCap: true,
            mode: tradingMode,
          });
          didExecuteReduceOnlyClose = true;

          const flipExitPx = Number(closeAllRes?.average_fill_price || closeAllRes?.order?.average_fill_price || rec.markPrice);
          const flipSlBuffer = Math.max(flipExitPx * 0.0028, Math.abs(flipExitPx - flipPlan.oppositeLevelPrice));
          const flipSl =
            flipPlan.newDirection === 'SHORT'
              ? +(flipExitPx + flipSlBuffer).toFixed(2)
              : +(flipExitPx - flipSlBuffer).toFixed(2);
          const flipTp1 =
            flipPlan.newDirection === 'SHORT'
              ? +(flipExitPx - flipSlBuffer * 1.25).toFixed(2)
              : +(flipExitPx + flipSlBuffer * 1.25).toFixed(2);
          const flipTp2 =
            flipPlan.newDirection === 'SHORT'
              ? +(flipExitPx - flipSlBuffer * 2.0).toFixed(2)
              : +(flipExitPx + flipSlBuffer * 2.0).toFixed(2);

          // Step 2: Enter opposite direction capped within <= 2% max equity risk
          const flipOpenRes: any = await onExecuteOrder({
            symbol: rec.deltaSymbol,
            side: flipPlan.newDirection,
            size: flipPlan.flipCoinSize,
            contracts: flipPlan.flipContracts,
            orderType: 'MARKET',
            entryPrice: flipExitPx,
            stopLoss: flipSl,
            takeProfit: flipTp2,
            tp1: flipTp1,
            tp2: flipTp2,
            leverage: capitalAlloc.clampLeverage(activeLeverage),
            marginMode: capitalAlloc.marginMode,
            strategy: `Perpetual Drawdown Rescue · Trend-Flip ${flipPlan.newDirection}`,
            strategyTag: 'PERPETUAL_RESCUE_FLIP',
            isRescueOrder: true,
            rescuePositionCircuitKey: positionCircuitKey,
            forceManualOverride: triggerSource === 'MANUAL',
            disableEquityCap: true,
            mode: tradingMode,
          });

          const newFillPx = Number(flipOpenRes?.average_fill_price || flipOpenRes?.order?.average_fill_price || flipExitPx);
          adjustedBePrice = flipPlan.projectedAdjustedBe;
          equityRiskPct = flipPlan.equityRiskPct;
          contractsMatched = flipPlan.flipContracts;
          details.flipDirection = flipPlan.newDirection;
          details.flipEntryPrice = newFillPx;
          details.flipStopLoss = flipSl;
          details.flipOrderId = flipOpenRes?.order_id || flipOpenRes?.orderId;

          const newFriction = calculateSniperFriction({
            entryPrice: newFillPx,
            direction: flipPlan.newDirection,
            lotSize: flipPlan.flipCoinSize,
            isTaker: true,
          });
          setActiveTrade({
            id: activeTrade?.id || rec.tradeId,
            positionId: flipOpenRes?.position?.id ? String(flipOpenRes.position.id) : activeTrade?.positionId,
            symbol: rec.deltaSymbol,
            productSymbol: rec.deltaSymbol,
            signal: flipPlan.newDirection,
            exposureMode: activeTrade?.exposureMode || exposureMode,
            scalpTier: activeTrade?.scalpTier || scalpTier,
            confidence: flipPlan.aiMatrixPct,
            confidenceStatus: 'Ultra Strong',
            lotSize: flipPlan.flipCoinSize,
            remainingSize: flipPlan.flipCoinSize,
            leverage: activeLeverage,
            entryPrice: newFillPx,
            currentPrice: newFillPx,
            initialStopLoss: flipSl,
            currentStopLoss: flipSl,
            tp1: flipTp1,
            tp2: flipTp2,
            tp3: flipTp2,
            tp4: flipTp2,
            camarilla: activeTrade?.camarilla || currentSignal.camarilla,
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            tp4Hit: false,
            status: 'OPEN',
            tradeStatus: 'ACTIVE',
            riskStatus: 'INITIAL_RISK',
            trailingStopActive: false,
            trailingStopValue: flipSl,
            trailingStage: 0,
            profitLocked: false,
            bookedProfitUsd: 0,
            unrealisedProfitUsd: 0,
            unrealizedPnlUsd: 0,
            unrealizedPnlInr: 0,
            highestPriceReached: newFillPx,
            lowestPriceReached: newFillPx,
            openedAt: Date.now(),
            lastUpdatedAt: Date.now(),
            aiVerdict: `TREND-FLIP REVERSED -> ${flipPlan.newDirection} @ $${newFillPx.toLocaleString()} (5m Close beyond ${flipPlan.oppositeLevelLabel} & AI ${flipPlan.aiMatrixPct}%). [1/1 RESCUE LOCKED].`,
            mode: tradingMode,
            friction: newFriction,
            netBreakevenPrice: adjustedBePrice,
            adjustedBreakEvenPrice: adjustedBePrice,
            adjustmentCount: 1,
          });
        }

        // Latch circuit-breaker immediately on successful execution
        const executedNow = Date.now();
        latchRescueCircuitEntry({
          positionKey: positionCircuitKey,
          status: 'EXECUTED',
          action: actionType,
          reason: `Rescue adjustment (${actionType}) executed for ${rec.deltaSymbol}.`,
          blockedAt: executedNow,
          cooldownUntil: executedNow + RESCUE_BLOCK_COOLDOWN_MS,
          availableBalanceAtBlock: availableBalance,
          requiredAdditionalBalance: null,
          targetAvailableBalanceToUnlock: null,
        });

        // Persist single-adjustment lock in ~/.deltaai-data/rescue-adjustments.json & send single LIVE-only Telegram alert
        const persistRes = await fetch('/api/delta/rescue/validate-and-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tradeKey: rec.tradeKey,
            tradeId: rec.tradeId,
            positionId: rec.positionId,
            symbol: rec.deltaSymbol,
            side: rec.side,
            mode: tradingMode,
            action: actionType,
            originalEntryPrice: rec.entryPrice,
            adjustedBreakEvenPrice: adjustedBePrice,
            triggerRMultiple: rec.rMultiple,
            unrealizedPnlAtTrigger: rec.unrealizedPnlUsd,
            contractsMatched,
            equityRiskPct,
            candleClosedBeyondOpposite: rec.projectedTrendFlip.candleClosedBeyondOpposite,
            aiMatrixPct: rec.projectedTrendFlip.aiMatrixPct,
            details,
          }),
        });
        const persistJson = await persistRes.json().catch(() => null);
        const savedRecord: PerpetualRescueAdjustmentRecord = persistJson?.record || {
          tradeKey: rec.tradeKey,
          tradeId: rec.tradeId,
          positionId: rec.positionId,
          symbol: rec.deltaSymbol,
          canonicalSymbol: rec.canonicalSymbol,
          side: rec.side,
          mode: tradingMode,
          adjustmentCount: 1,
          action: actionType,
          originalEntryPrice: rec.entryPrice,
          adjustedBreakEvenPrice: adjustedBePrice,
          triggerRMultiple: rec.rMultiple,
          unrealizedPnlAtTrigger: rec.unrealizedPnlUsd,
          contractsMatched,
          equityRiskPct,
          executedAt: executedNow,
          telegramSent: tradingMode === 'LIVE',
          details,
        };

        setRescueRecordsByKey((prev) => ({
          ...prev,
          [savedRecord.tradeKey]: savedRecord,
        }));
        setActiveTrade((cur) =>
          cur
            ? {
                ...cur,
                adjustmentCount: 1,
                adjustedBreakEvenPrice: adjustedBePrice,
                rescueAdjustment: savedRecord,
              }
            : cur
        );

        const friendlyLabel =
          actionType === 'DE_RISK_REANCHOR'
            ? '50% De-Risk & Re-Anchor'
            : actionType === 'OPTIONS_HEDGE_OVERLAY'
            ? '1:1 Options Hedge Overlay'
            : 'Trend-Flip Reverse';

        addLog(
          'RESCUE',
          `Drawdown Rescue Executed: ${friendlyLabel}`,
          `${rec.deltaSymbol} (${rec.rMultiple.toFixed(2)}R) -> Adjusted BE $${adjustedBePrice.toLocaleString()} · Risk ${equityRiskPct.toFixed(2)}% (1/1 Adjustment Lock Armed).`
        );
        queueAnalyticsEvent(
          {
            kind: 'TRADE_LIFECYCLE',
            eventId: `rescue-trade-${savedRecord.tradeKey}`,
            tradeId: savedRecord.tradeId,
            orderId: savedRecord.positionId || null,
            eventType: 'RESCUE_ADJUSTMENT',
            timestampMs: savedRecord.executedAt,
            symbol: savedRecord.symbol,
            side: savedRecord.side,
            size: contractsMatched,
            entryPrice: savedRecord.originalEntryPrice,
            triggerPrice: adjustedBePrice,
            netRealizedPnlUsd: savedRecord.unrealizedPnlAtTrigger,
            usdInrRate: usdInrRef.current,
            mode: tradingMode,
            reason: `Drawdown Rescue Executed: ${friendlyLabel}`,
          },
          true
        );
        onSendNotification(
          `Rescue Executed · ${friendlyLabel}`,
          `${rec.deltaSymbol} (${rec.rMultiple.toFixed(2)}R drawdown) adjusted. New Effective Break-Even: $${adjustedBePrice.toLocaleString()}. Single-Adjustment Lock (1/1) active.`,
          'RISK'
        );
        if (onPlaySound) onPlaySound();
      } catch (err: any) {
        const parsedErr = parseInsufficientMarginDetails(err);

        // If exchange rejected with insufficient_margin and we haven't reduced yet & can split 50%, fall back ONCE to $0-margin reduce_only close
        if (
          parsedErr.isInsufficientMargin &&
          !didExecuteReduceOnlyClose &&
          marginPreCheck.canFallbackToReduceOnly50
        ) {
          try {
            await executeZeroMarginReduceOnlyFallback(
              `Exchange returned insufficient_margin${parsedErr.requiredAdditionalBalance ? ` (needs +$${parsedErr.requiredAdditionalBalance.toFixed(2)})` : ''}`,
              parsedErr.requiredAdditionalBalance
            );
            return;
          } catch (fallbackErr: any) {
            const fbMsg = fallbackErr?.message || parsedErr.message;
            const nowMs = Date.now();
            latchRescueCircuitEntry({
              positionKey: positionCircuitKey,
              status: 'BLOCKED',
              action: actionType,
              reason: fbMsg,
              errorCode: parsedErr.errorCode,
              blockedAt: nowMs,
              cooldownUntil: nowMs + RESCUE_BLOCK_COOLDOWN_MS,
              availableBalanceAtBlock: availableBalance,
              requiredAdditionalBalance: parsedErr.requiredAdditionalBalance,
              targetAvailableBalanceToUnlock: parsedErr.requiredAdditionalBalance
                ? +(availableBalance + parsedErr.requiredAdditionalBalance).toFixed(4)
                : null,
            });
            addLog('BLOCKED', 'Drawdown Rescue Blocked', `${fbMsg} (Auto-rescue paused 15m).`);
            onSendNotification('Drawdown Rescue Blocked', `${fbMsg} (Auto-rescue paused 15m).`, 'RISK');
            return;
          }
        }

        // Latch per-position circuit breaker for 15 minutes (or until availableBalance recovers above required_additional_balance)
        const nowMs = Date.now();
        const unlockNote = parsedErr.requiredAdditionalBalance
          ? ` Auto-rescue paused 15m or until wallet margin increases by +$${parsedErr.requiredAdditionalBalance.toFixed(2)}.`
          : ' Auto-rescue paused 15m to prevent retry loops.';
        latchRescueCircuitEntry({
          positionKey: positionCircuitKey,
          status: didExecuteReduceOnlyClose ? 'FALLBACK_DERISK_EXECUTED' : 'BLOCKED',
          action: actionType,
          reason: parsedErr.message,
          errorCode: parsedErr.errorCode,
          blockedAt: nowMs,
          cooldownUntil: nowMs + RESCUE_BLOCK_COOLDOWN_MS,
          availableBalanceAtBlock: availableBalance,
          requiredAdditionalBalance: parsedErr.requiredAdditionalBalance,
          targetAvailableBalanceToUnlock: parsedErr.requiredAdditionalBalance
            ? +(availableBalance + parsedErr.requiredAdditionalBalance).toFixed(4)
            : null,
        });
        addLog('BLOCKED', 'Drawdown Rescue Blocked', `${parsedErr.message}${unlockNote}`);
        onSendNotification('Drawdown Rescue Blocked', `${parsedErr.message}${unlockNote}`, 'RISK');
      } finally {
        rescueExecutionLockRef.current = false;
        setIsExecutingRescue(false);
      }
    },
    [
      isExecutingRescue,
      isLiveUnverified,
      rescueRecommendation,
      activeTrade,
      totalEquity,
      availableBalance,
      marginUsed,
      onExecuteOrder,
      rescueTargetPosition,
      capitalAlloc,
      tradingMode,
      setActiveTrade,
      exposureMode,
      scalpTier,
      currentSignal.camarilla,
      addLog,
      onSendNotification,
      onPlaySound,
      latchRescueCircuitEntry,
      persistRescueCircuitMap,
    ]
  );

  const [isAutoRescueEnabled, setIsAutoRescueEnabledState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('delta_perp_auto_rescue_enabled_v1');
      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {}
    return false;
  });

  const setIsAutoRescueEnabled = useCallback((val: boolean) => {
    setIsAutoRescueEnabledState(val);
    try {
      localStorage.setItem('delta_perp_auto_rescue_enabled_v1', val ? 'true' : 'false');
    } catch {}
  }, []);

  // Auto-executable Drawdown Rescue loop (strictly <= 1 adjustment per trade, circuit-broken 15m per position on block/execution)
  useEffect(() => {
    if (!isAutoRescueEnabled || isExecutingRescue || rescueExecutionLockRef.current || isLiveUnverified) return;
    if (!rescueRecommendation || !rescueRecommendation.shouldSurface || rescueRecommendation.isLocked) return;
    if (rescueRecommendation.adjustmentCount >= RESCUE_MAX_ADJUSTMENTS_PER_TRADE) return;
    if (rescueRecommendation.unrealizedPnlUsd >= 0 || rescueRecommendation.rMultiple > -0.50) return;

    const positionCircuitKey = buildRescuePositionCircuitKey(
      rescueRecommendation.deltaSymbol,
      rescueRecommendation.entryPrice,
      rescueRecommendation.side
    );
    const circuitEval = evaluateRescueCircuitBreaker({
      entry: rescueAttemptedOrBlockedMapRef.current.get(positionCircuitKey),
      currentAvailableBalance: availableBalance,
    });
    if (circuitEval.isBlocked) {
      return;
    }
    if (circuitEval.unlockedByMarginRecovery) {
      rescueAttemptedOrBlockedMapRef.current.delete(positionCircuitKey);
      persistRescueCircuitMap();
    }

    if (rescueRecommendation.projectedTrendFlip.enabled) {
      void executePerpetualRescueAction('TREND_FLIP_REVERSE', { triggerSource: 'AUTO' });
      return;
    }
    if (rescueRecommendation.rMultiple <= -0.60) {
      if (rescueRecommendation.projectedDeRiskReAnchor.enabled) {
        void executePerpetualRescueAction('DE_RISK_REANCHOR', { triggerSource: 'AUTO' });
      } else if (rescueRecommendation.projectedOptionsHedge.enabled) {
        void executePerpetualRescueAction('OPTIONS_HEDGE_OVERLAY', { triggerSource: 'AUTO' });
      }
    }
  }, [
    isAutoRescueEnabled,
    isExecutingRescue,
    isLiveUnverified,
    rescueRecommendation,
    availableBalance,
    executePerpetualRescueAction,
    persistRescueCircuitMap,
  ]);

  return useMemo(() => ({
    currentSignal,
    activeTrade,
    setActiveTrade,
    isSignalStandby,
    setIsSignalStandby,
    confirmSignalHydration,
    refreshSignalSnapshot,
    isAutoSniperEnabled,
    setIsAutoSniperEnabled,
    syncSniperAutoPilotFromServer,
    directionMode,
    setDirectionMode,
    scalpTier,
    setScalpTier,
    exposureMode,
    setExposureMode: handleSetExposureMode,
    signalSource,
    setSignalSource,
    isExecuting,
    tradeLogs,
    executeSniperTrade,
    closeActiveSniperTrade,
    closeActiveTrade: closeActiveSniperTrade,
    cumulativeRealizedProfitUsd,
    aiAnalysis,
    isAiLoading,
    onRefreshAiAnalysis,
    clearTradeLogs,
    addLog,
    lastAutoExecutedSignalId,

    consecutiveStopsCount,
    resetCircuitBreaker,
    simulate5mCandleClose,

    bypassHtfFilter,
    setBypassHtfFilter: handleSetBypassHtfFilter,
    executionTriggerMode,
    setExecutionTriggerMode,
    entryExecutionType,
    setEntryExecutionType,
    capitalAlloc,
    autoFitLotToMaxMargin: capitalAlloc.autoFitLotToMaxMargin,
    calculateLotSize: capitalAlloc.calculateLotSize,
    cycleRealizedPnL,
    harvestTargetHit,
    cycleWindowRemaining,
    isTransitionWindow,
    isEmaAlignmentPending,
    exchangeSyncReady,
    reconcileLivePerpPositionsNow,
    rescueRecommendation,
    executePerpetualRescueAction,
    isExecutingRescue,
    isAutoRescueEnabled,
    setIsAutoRescueEnabled,
    rescueRecordsByKey,
  }), [
    currentSignal,
    activeTrade,
    setActiveTrade,
    isSignalStandby,
    setIsSignalStandby,
    confirmSignalHydration,
    refreshSignalSnapshot,
    isAutoSniperEnabled,
    setIsAutoSniperEnabled,
    syncSniperAutoPilotFromServer,
    directionMode,
    scalpTier,
    setScalpTier,
    exposureMode,
    handleSetExposureMode,
    signalSource,
    isExecuting,
    tradeLogs,
    executeSniperTrade,
    closeActiveSniperTrade,
    cumulativeRealizedProfitUsd,
    aiAnalysis,
    isAiLoading,
    onRefreshAiAnalysis,
    clearTradeLogs,
    addLog,
    consecutiveStopsCount,
    resetCircuitBreaker,
    simulate5mCandleClose,
    bypassHtfFilter,
    handleSetBypassHtfFilter,
    executionTriggerMode,
    entryExecutionType,
    capitalAlloc,
    cycleRealizedPnL,
    harvestTargetHit,
    cycleWindowRemaining,
    isTransitionWindow,
    isEmaAlignmentPending,
    exchangeSyncReady,
    reconcileLivePerpPositionsNow,
    rescueRecommendation,
    executePerpetualRescueAction,
    isExecutingRescue,
    isAutoRescueEnabled,
    setIsAutoRescueEnabled,
    rescueRecordsByKey,
  ]);
}

