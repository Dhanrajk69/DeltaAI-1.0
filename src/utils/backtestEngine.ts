import {
  OhlcCandle,
  computeAdxSeries,
  computeAtrSeries,
  computeDailyCprStats,
  computeEmaSeries,
  computeRsiSeries,
  computeSessionVwapSeries,
  evaluateUnifiedRegimeRouter,
  normalizeCandleTimeSec,
  resampleCandlesToBucketSec,
} from './aiMatrixEngine.ts';
import type {
  BacktestEquityPoint,
  BacktestTradeRecord,
  HistoricalBacktestStrategyMode,
  HistoricalBacktestSummary,
  HistoricalResolution,
} from '../server/historicalBacktestEngine.ts';

export const DELTA_MAKER_FEE_RATE = 0.0002; // 0.02% post_only maker fee (0.0236% incl. 18% GST)
export const DELTA_TAKER_FEE_RATE_UNIFIED = 0.00059; // 0.059% taker fee
export const DELTA_GST_RATE_UNIFIED = 0.18; // 18% GST on trading fees
export const FEE_ADJUSTED_BE_BUFFER = 0.0015; // Entry ± 0.15% fee+GST buffer
export const EMA921_BE_OFFSET_USD_BTC = 35; // Entry ± $35 fee+GST breakeven on BTC
export const EMA921_PARTIAL_PTS_BTC = 100; // +100 pts (~1.1R) 60% partial bank on BTC
export const EMA921_RUNNER_PTS_BTC = 220; // +220 pts (2.5R) 40% runner target on BTC
export const MAX_TRADES_PER_UTC_DAY = 3;
export const POST_SL_COOLDOWN_BARS = 3;
export const PENDING_LIMIT_TTL_BARS = 3;

export const BACKTEST_CONTRACT_VALUE_MAP: Record<string, number> = {
  BTCUSD: 0.001,
  ETHUSD: 0.01,
  SOLUSD: 1,
  XRPUSD: 10,
  DOGEUSD: 100,
  AVAXUSD: 1,
};

function normalizeBacktestSymbol(symbol: string): string {
  const clean = String(symbol || 'BTCUSD').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.endsWith('USDT')) {
    const mapped = `${clean.slice(0, -4)}USD`;
    if (mapped in BACKTEST_CONTRACT_VALUE_MAP) return mapped;
  }
  if (clean in BACKTEST_CONTRACT_VALUE_MAP) return clean;
  return 'BTCUSD';
}

export interface UnifiedBacktestParams {
  symbol: string;
  timeframe: HistoricalResolution;
  days: number;
  strategyMode: HistoricalBacktestStrategyMode;
  candles: OhlcCandle[];
  initialCapitalUsd?: number;
  leverage?: number;
  riskPerTradePct?: number;
  takerFeeRate?: number;
  makerFeeRate?: number;
  gstRate?: number;
  slippageBps?: number;
  usdInrRate?: number;
}

/**
 * Unified Multi-Timeframe & 5m EMA 9/21 Momentum Cross Backtest Simulation Engine
 */
export function runUnifiedStrategyBacktest(
  params: UnifiedBacktestParams
): HistoricalBacktestSummary {
  const symbol = normalizeBacktestSymbol(params.symbol);
  const candles = [...params.candles]
    .map((c) => ({ ...c, time: normalizeCandleTimeSec(c.time) }))
    .filter((c) => c.close > 0)
    .sort((a, b) => a.time - b.time);

  const initialCapitalUsd = Math.max(50, Number(params.initialCapitalUsd || 1000));
  const leverage = Math.max(1, Math.min(20, Number(params.leverage || 10)));
  const riskPerTradePct = Math.max(0.25, Math.min(3, Number(params.riskPerTradePct || 1.0)));
  const takerFeeRate = params.takerFeeRate ?? DELTA_TAKER_FEE_RATE_UNIFIED;
  const makerFeeRate = params.makerFeeRate ?? DELTA_MAKER_FEE_RATE;
  const gstRate = params.gstRate ?? DELTA_GST_RATE_UNIFIED;
  const slippageRate = (params.slippageBps ?? 2) / 10_000;
  const usdInrRate = params.usdInrRate && params.usdInrRate > 0 ? params.usdInrRate : 89.0;
  const contractVal = BACKTEST_CONTRACT_VALUE_MAP[symbol] ?? 0.001;
  const isBtc = symbol.includes('BTC');
  const isEma921Mode = params.strategyMode === 'EMA_9_21_MOMENTUM_5M';

  if (candles.length < (isEma921Mode ? 30 : 15)) {
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
  const ema21 = computeEmaSeries(closes, 21);
  const atr14 = computeAtrSeries(candles, 14);
  const adx14 = computeAdxSeries(candles, 14);
  const rsi14 = computeRsiSeries(closes, 14);
  const vwap = computeSessionVwapSeries(candles);
  const dailyCpr = computeDailyCprStats(candles);

  // Precompute 15m EMA 50 aligned by bar timestamp for O(N) 5m EMA 9/21 filtering
  const candles15m = resampleCandlesToBucketSec(candles, 900);
  const ema50_15mSeries = computeEmaSeries(candles15m.map((c) => c.close), 50);
  const ema50_15mAtBar: number[] = new Array(candles.length).fill(0);
  {
    let ptr15 = 0;
    for (let i = 0; i < candles.length; i += 1) {
      while (ptr15 + 1 < candles15m.length && candles15m[ptr15 + 1].time <= candles[i].time) {
        ptr15 += 1;
      }
      ema50_15mAtBar[i] = ema50_15mSeries[ptr15] ?? candles[i].close;
    }
  }

  interface PendingLimitOrder {
    side: 'LONG' | 'SHORT';
    limitPrice: number;
    stopLoss: number;
    takeProfit: number;
    expiresAtIdx: number;
    grade: string;
  }

  interface OpenSimTrade {
    side: 'LONG' | 'SHORT';
    entryTime: number;
    entryPrice: number;
    stopLoss: number;
    initialStopLoss: number;
    takeProfit: number;
    tp1Price: number;
    feeBePrice: number;
    movedToBe: boolean;
    emaTrailActive: boolean;
    trailWithEma21: boolean;
    partialBankPct: number; // 0.60 for EMA_9_21_MOMENTUM_5M, 0 for unified
    remainingFraction: number;
    partialGrossUsd: number;
    partialFeeUsd: number;
    partialGstUsd: number;
    partialSlippageUsd: number;
    partialNetUsd: number;
    contracts: number;
    isMakerEntry: boolean;
    grade?: string;
  }

  let equity = initialCapitalUsd;
  let peakEquity = initialCapitalUsd;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;
  let openTrade: OpenSimTrade | null = null;
  let pendingLimit: PendingLimitOrder | null = null;
  let cooldownUntilIdx = 0;
  const tradesPerUtcDay = new Map<string, number>();

  const trades: BacktestTradeRecord[] = [];
  const rawEquityCurve: BacktestEquityPoint[] = [];
  const dailyEndEquity = new Map<string, number>();

  const bookPartialBank = (exitPrice: number) => {
    if (!openTrade || openTrade.partialBankPct <= 0 || openTrade.movedToBe) return;
    const bankFraction = openTrade.partialBankPct;
    const totalCoinQty = openTrade.contracts * contractVal;
    const bankCoinQty = totalCoinQty * bankFraction;
    const bankEntryNotional = openTrade.entryPrice * bankCoinQty;
    const bankExitNotional = exitPrice * bankCoinQty;
    const grossPnlUsd =
      openTrade.side === 'LONG'
        ? (exitPrice - openTrade.entryPrice) * bankCoinQty
        : (openTrade.entryPrice - exitPrice) * bankCoinQty;
    const entryFeeRate = openTrade.isMakerEntry ? makerFeeRate : takerFeeRate;
    // Partial TP uses limit take-profit (0.02% maker + 18% GST = 0.0236%)
    const feeUsd = bankEntryNotional * entryFeeRate + bankExitNotional * makerFeeRate;
    const gstUsd = feeUsd * gstRate;
    const netPnlUsd = grossPnlUsd - feeUsd - gstUsd;

    equity = Math.max(1, equity + netPnlUsd);
    if (equity > peakEquity) peakEquity = equity;

    openTrade.partialGrossUsd += grossPnlUsd;
    openTrade.partialFeeUsd += feeUsd;
    openTrade.partialGstUsd += gstUsd;
    openTrade.partialNetUsd += netPnlUsd;
    openTrade.remainingFraction = Math.max(0.1, +(1 - bankFraction).toFixed(2));
  };

  const closeOpenTrade = (
    bar: OhlcCandle,
    rawExitPrice: number,
    exitReason: BacktestTradeRecord['exitReason'],
    isMakerExit: boolean
  ) => {
    if (!openTrade) return;
    // Maker TP exits fill cleanly at limit price with 0 slippage; stop/market exits pay slippage
    const exitPrice = isMakerExit
      ? rawExitPrice
      : openTrade.side === 'LONG'
      ? rawExitPrice * (1 - slippageRate)
      : rawExitPrice * (1 + slippageRate);

    const totalCoinQty = openTrade.contracts * contractVal;
    const remCoinQty = totalCoinQty * openTrade.remainingFraction;
    const entryNotional = openTrade.entryPrice * remCoinQty;
    const exitNotional = exitPrice * remCoinQty;
    const totalAvgNotional =
      (openTrade.entryPrice * totalCoinQty + exitPrice * remCoinQty + openTrade.tp1Price * totalCoinQty * (1 - openTrade.remainingFraction)) /
      2;

    const remGrossPnlUsd =
      openTrade.side === 'LONG'
        ? (exitPrice - openTrade.entryPrice) * remCoinQty
        : (openTrade.entryPrice - exitPrice) * remCoinQty;

    const entryFeeRate = openTrade.isMakerEntry ? makerFeeRate : takerFeeRate;
    const exitFeeRate = isMakerExit ? makerFeeRate : takerFeeRate;
    const remFeeUsd = entryNotional * entryFeeRate + exitNotional * exitFeeRate;
    const remGstUsd = remFeeUsd * gstRate;
    const remSlippageUsd = isMakerExit ? 0 : exitNotional * slippageRate;
    const remNetPnlUsd = remGrossPnlUsd - remFeeUsd - remGstUsd;

    equity = Math.max(1, equity + remNetPnlUsd);
    if (equity > peakEquity) peakEquity = equity;
    const ddUsd = Math.max(0, peakEquity - equity);
    const ddPct = peakEquity > 0 ? (ddUsd / peakEquity) * 100 : 0;
    if (ddUsd > maxDrawdownUsd) maxDrawdownUsd = ddUsd;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

    const totalGrossUsd = openTrade.partialGrossUsd + remGrossPnlUsd;
    const totalFeeUsd = openTrade.partialFeeUsd + remFeeUsd;
    const totalGstUsd = openTrade.partialGstUsd + remGstUsd;
    const totalSlippageUsd = openTrade.partialSlippageUsd + remSlippageUsd;
    const totalNetPnlUsd = openTrade.partialNetUsd + remNetPnlUsd;
    const netPnlInr = totalNetPnlUsd * usdInrRate;

    const riskDist = Math.max(
      Math.abs(openTrade.entryPrice - openTrade.initialStopLoss),
      openTrade.entryPrice * 0.001
    );
    const riskDollars = Math.max(0.01, riskDist * totalCoinQty);
    const rMultiple = +(totalNetPnlUsd / riskDollars).toFixed(2);

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
      notionalUsd: +totalAvgNotional.toFixed(2),
      grossPnlUsd: +totalGrossUsd.toFixed(4),
      feeUsd: +totalFeeUsd.toFixed(4),
      gstUsd: +totalGstUsd.toFixed(4),
      slippageUsd: +totalSlippageUsd.toFixed(4),
      netPnlUsd: +totalNetPnlUsd.toFixed(4),
      netPnlInr: +netPnlInr.toFixed(2),
      rMultiple,
      exitReason,
      grade: openTrade.grade,
    });

    openTrade = null;
  };

  for (let i = 0; i < candles.length; i += 1) {
    const bar = candles[i];
    const dayKey = new Date(bar.time * 1000).toISOString().slice(0, 10);
    const dayCount = tradesPerUtcDay.get(dayKey) || 0;

    // 1. Check resting post_only limit order fill or 3-bar expiration (Unified Router modes)
    if (!openTrade && pendingLimit) {
      if (i > pendingLimit.expiresAtIdx || dayCount >= MAX_TRADES_PER_UTC_DAY || i < cooldownUntilIdx) {
        pendingLimit = null;
      } else {
        const touched =
          pendingLimit.side === 'LONG'
            ? bar.low <= pendingLimit.limitPrice && bar.high >= pendingLimit.limitPrice
            : bar.high >= pendingLimit.limitPrice && bar.low <= pendingLimit.limitPrice;
        if (touched) {
          const entryPrice = pendingLimit.limitPrice;
          const riskBudgetUsd = equity * (riskPerTradePct / 100);
          const stopDist = Math.max(
            Math.abs(entryPrice - pendingLimit.stopLoss),
            entryPrice * (isBtc ? 0.0055 : 0.0045)
          );
          const riskContracts = Math.floor(riskBudgetUsd / (stopDist * contractVal));
          const maxMarginContracts = Math.floor(
            (equity * 0.85 * leverage) / (entryPrice * contractVal)
          );
          const contracts = Math.max(1, Math.min(riskContracts, Math.max(1, maxMarginContracts)));
          const tp1Price =
            pendingLimit.side === 'LONG'
              ? entryPrice + stopDist * 1.35
              : entryPrice - stopDist * 1.35;
          const feeBePrice =
            pendingLimit.side === 'LONG'
              ? entryPrice * (1 + FEE_ADJUSTED_BE_BUFFER)
              : entryPrice * (1 - FEE_ADJUSTED_BE_BUFFER);

          openTrade = {
            side: pendingLimit.side,
            entryTime: bar.time,
            entryPrice,
            stopLoss: pendingLimit.stopLoss,
            initialStopLoss: pendingLimit.stopLoss,
            takeProfit: pendingLimit.takeProfit,
            tp1Price,
            feeBePrice,
            movedToBe: false,
            emaTrailActive: false,
            trailWithEma21: false,
            partialBankPct: 0,
            remainingFraction: 1,
            partialGrossUsd: 0,
            partialFeeUsd: 0,
            partialGstUsd: 0,
            partialSlippageUsd: 0,
            partialNetUsd: 0,
            contracts,
            isMakerEntry: true,
            grade: pendingLimit.grade,
          };
          tradesPerUtcDay.set(dayKey, dayCount + 1);
          pendingLimit = null;
        }
      }
    }

    // 2. Manage active trade conservatively (check SL before TP)
    if (openTrade) {
      const riskDist = Math.abs(openTrade.entryPrice - openTrade.initialStopLoss);
      const trailEmaVal = openTrade.trailWithEma21 ? ema21[i] : ema20[i];

      if (openTrade.side === 'LONG') {
        if (bar.low <= openTrade.stopLoss) {
          const reason = openTrade.movedToBe ? 'BE_STOP' : 'SL_HIT';
          closeOpenTrade(bar, openTrade.stopLoss, reason, false);
          if (reason === 'SL_HIT') cooldownUntilIdx = i + POST_SL_COOLDOWN_BARS;
        } else if (bar.high >= openTrade.takeProfit) {
          // If 60% partial never booked cleanly in same bar, book 60% + 40% at limit or runner
          if (openTrade.partialBankPct > 0 && !openTrade.movedToBe && bar.high >= openTrade.tp1Price) {
            bookPartialBank(openTrade.tp1Price);
            openTrade.movedToBe = true;
          }
          closeOpenTrade(bar, openTrade.takeProfit, 'TP_HIT', true);
          cooldownUntilIdx = i + 1;
        } else {
          if (!openTrade.movedToBe && riskDist > 0 && bar.high >= openTrade.tp1Price) {
            if (openTrade.partialBankPct > 0) {
              bookPartialBank(openTrade.tp1Price);
            }
            openTrade.stopLoss = Math.max(openTrade.stopLoss, openTrade.feeBePrice);
            openTrade.movedToBe = true;
            openTrade.emaTrailActive = true;
          } else if (openTrade.emaTrailActive && trailEmaVal > openTrade.stopLoss) {
            const candidateTrail = openTrade.trailWithEma21 ? trailEmaVal : trailEmaVal * 0.999;
            if (candidateTrail > openTrade.stopLoss && candidateTrail < bar.close) {
              openTrade.stopLoss = candidateTrail;
            }
          }
        }
      } else {
        if (bar.high >= openTrade.stopLoss) {
          const reason = openTrade.movedToBe ? 'BE_STOP' : 'SL_HIT';
          closeOpenTrade(bar, openTrade.stopLoss, reason, false);
          if (reason === 'SL_HIT') cooldownUntilIdx = i + POST_SL_COOLDOWN_BARS;
        } else if (bar.low <= openTrade.takeProfit) {
          if (openTrade.partialBankPct > 0 && !openTrade.movedToBe && bar.low <= openTrade.tp1Price) {
            bookPartialBank(openTrade.tp1Price);
            openTrade.movedToBe = true;
          }
          closeOpenTrade(bar, openTrade.takeProfit, 'TP_HIT', true);
          cooldownUntilIdx = i + 1;
        } else {
          if (!openTrade.movedToBe && riskDist > 0 && bar.low <= openTrade.tp1Price) {
            if (openTrade.partialBankPct > 0) {
              bookPartialBank(openTrade.tp1Price);
            }
            openTrade.stopLoss = Math.min(openTrade.stopLoss, openTrade.feeBePrice);
            openTrade.movedToBe = true;
            openTrade.emaTrailActive = true;
          } else if (openTrade.emaTrailActive && trailEmaVal < openTrade.stopLoss) {
            const candidateTrail = openTrade.trailWithEma21 ? trailEmaVal : trailEmaVal * 1.001;
            if (candidateTrail < openTrade.stopLoss && candidateTrail > bar.close) {
              openTrade.stopLoss = candidateTrail;
            }
          }
        }
      }
    }

    // 3a. 5m EMA 9/21 Momentum Cross (100pt Scalp + Runner) Strategy Mode
    if (
      isEma921Mode &&
      !openTrade &&
      i >= 25 &&
      i >= cooldownUntilIdx &&
      i < candles.length - 1
    ) {
      const adx = adx14[i] || 0;
      const atr = atr14[i] || (isBtc ? 78 : bar.close * 0.001);
      const bullCross = ema9[i - 1] <= ema21[i - 1] && ema9[i] > ema21[i];
      const bearCross = ema9[i - 1] >= ema21[i - 1] && ema9[i] < ema21[i];
      const ema21Up = ema21[i] > ema21[i - 2];
      const ema21Down = ema21[i] < ema21[i - 2];
      const ema50_15m = ema50_15mAtBar[i] || bar.close;

      const longConfirmed =
        bullCross &&
        bar.close > bar.open &&
        ema21Up &&
        bar.close > vwap[i] &&
        bar.close > ema50_15m &&
        adx >= 20;

      const shortConfirmed =
        bearCross &&
        bar.close < bar.open &&
        ema21Down &&
        bar.close < vwap[i] &&
        bar.close < ema50_15m &&
        adx >= 20;

      if (longConfirmed || shortConfirmed) {
        const side: 'LONG' | 'SHORT' = longConfirmed ? 'LONG' : 'SHORT';
        const entryPrice = bar.close;
        const swingBars = candles.slice(Math.max(0, i - 3), i + 1);
        const swingLow = Math.min(...swingBars.map((c) => c.low));
        const swingHigh = Math.max(...swingBars.map((c) => c.high));

        // 1.2x 5m ATR(14) (~85–110 pts on BTC) beyond crossover swing
        const atrStopDist = isBtc
          ? Math.min(110, Math.max(85, atr * 1.2))
          : Math.max(atr * 1.2, entryPrice * 0.0012);
        const swingRoom = isBtc ? Math.min(15, atr * 0.15) : atr * 0.15;
        let stopLoss =
          side === 'LONG'
            ? Math.min(entryPrice - atrStopDist, swingLow - swingRoom)
            : Math.max(entryPrice + atrStopDist, swingHigh + swingRoom);
        if (isBtc) {
          const d = Math.abs(entryPrice - stopLoss);
          const swingDist = side === 'LONG' ? Math.abs(entryPrice - swingLow) : Math.abs(swingHigh - entryPrice);
          if (d > 115 && swingDist <= 105) {
            stopLoss = side === 'LONG' ? entryPrice - 110 : entryPrice + 110;
          } else if (d < 85) {
            stopLoss = side === 'LONG' ? entryPrice - 85 : entryPrice + 85;
          }
        }

        const slDist = Math.max(Math.abs(entryPrice - stopLoss), atrStopDist);
        const riskBudgetUsd = equity * (riskPerTradePct / 100);
        const riskContracts = Math.floor(riskBudgetUsd / (slDist * contractVal));
        const maxMarginContracts = Math.floor(
          (equity * 0.85 * leverage) / (entryPrice * contractVal)
        );
        const contracts = Math.max(1, Math.min(riskContracts, Math.max(1, maxMarginContracts)));
        const lotSizeBtc = contracts * contractVal;
        const roundTripFeeUsd = entryPrice * lotSizeBtc * 0.000472;
        const tp1Dist = (15.00 + roundTripFeeUsd) / lotSizeBtc;
        const tp4Dist = isBtc ? EMA921_RUNNER_PTS_BTC : slDist * 2.5;
        const beOffset = isBtc ? EMA921_BE_OFFSET_USD_BTC : entryPrice * 0.00042;
        const sign = side === 'LONG' ? 1 : -1;

        openTrade = {
          side,
          entryTime: bar.time,
          entryPrice,
          stopLoss,
          initialStopLoss: stopLoss,
          takeProfit: entryPrice + sign * tp4Dist,
          tp1Price: entryPrice + sign * tp1Dist,
          feeBePrice: entryPrice + sign * beOffset,
          movedToBe: false,
          emaTrailActive: false,
          trailWithEma21: true,
          partialBankPct: 0.7,
          remainingFraction: 1,
          partialGrossUsd: 0,
          partialFeeUsd: 0,
          partialGstUsd: 0,
          partialSlippageUsd: 0,
          partialNetUsd: 0,
          contracts,
          isMakerEntry: false,
          grade: adx >= 28 ? 'A+' : 'A',
        };
      }
    }

    // 3b. Evaluate Unified Regime Router for new post_only Limit Pullback setup
    if (
      !isEma921Mode &&
      !openTrade &&
      !pendingLimit &&
      i >= 50 &&
      i >= cooldownUntilIdx &&
      i < candles.length - 2 &&
      dayCount < MAX_TRADES_PER_UTC_DAY
    ) {
      const atr = Math.max(atr14[i], bar.close * 0.003);
      const atrPct = bar.close > 0 ? (atr / bar.close) * 100 : 0;
      const adx = adx14[i] || 0;
      const piv = dailyCpr.get(dayKey);

      // Gate: ADX >= 22 and ATR% >= 0.30%
      if (adx >= 22 && atrPct >= 0.30) {
        const windowCandles = candles.slice(Math.max(0, i - 240), i + 1);
        const router = evaluateUnifiedRegimeRouter({
          symbol,
          markPrice: bar.close,
          candles15m: windowCandles,
          dailyCprWidthPct: piv?.cprWidthPct,
          dailyCprPercentile: piv?.cprPercentile,
        });

        const minStopDist = Math.max(atr * 1.5, bar.close * (isBtc ? 0.0055 : 0.0045));
        const recentWindow = candles.slice(Math.max(0, i - 5), i + 1);
        const swingLow = Math.min(...recentWindow.map((c) => c.low));
        const swingHigh = Math.max(...recentWindow.map((c) => c.high));

        if (params.strategyMode === 'CAMARILLA_CPR_SNIPER' && piv && !piv.isWideCpr) {
          const prevBar = candles[i - 1];
          const bullTrigger =
            (!router.isNoTrade && router.direction === 'LONG') ||
            (bar.close > piv.h4 &&
              prevBar.close <= piv.h4 &&
              bar.close > vwap[i] &&
              ema9[i] > ema20[i]);
          const bearTrigger =
            (!router.isNoTrade && router.direction === 'SHORT') ||
            (bar.close < piv.l4 &&
              prevBar.close >= piv.l4 &&
              bar.close < vwap[i] &&
              ema9[i] < ema20[i]);

          if (bullTrigger) {
            const limitPx = Math.min(bar.close, Math.max(bar.close - atr * 0.45, (ema20[i] + vwap[i]) / 2));
            const sl = Math.min(limitPx - minStopDist, swingLow - atr * 0.2);
            const rDist = Math.max(limitPx - sl, minStopDist);
            pendingLimit = {
              side: 'LONG',
              limitPrice: limitPx,
              stopLoss: sl,
              takeProfit: limitPx + rDist * 2.85,
              expiresAtIdx: i + PENDING_LIMIT_TTL_BARS,
              grade: router.isNoTrade ? 'A' : 'A+',
            };
          } else if (bearTrigger) {
            const limitPx = Math.max(bar.close, Math.min(bar.close + atr * 0.45, (ema20[i] + vwap[i]) / 2));
            const sl = Math.max(limitPx + minStopDist, swingHigh + atr * 0.2);
            const rDist = Math.max(sl - limitPx, minStopDist);
            pendingLimit = {
              side: 'SHORT',
              limitPrice: limitPx,
              stopLoss: sl,
              takeProfit: limitPx - rDist * 2.85,
              expiresAtIdx: i + PENDING_LIMIT_TTL_BARS,
              grade: router.isNoTrade ? 'A' : 'A+',
            };
          }
        } else if (
          params.strategyMode === 'AI_MATRIX_CONSENSUS' &&
          !router.isNoTrade &&
          router.routeDestination === 'PERPETUALS'
        ) {
          if (router.direction === 'LONG' && rsi14[i] >= 50 && rsi14[i] <= 72) {
            const limitPx = router.pullbackEntryZone;
            const sl = Math.min(limitPx - minStopDist, swingLow - atr * 0.2);
            const rDist = Math.max(limitPx - sl, minStopDist);
            pendingLimit = {
              side: 'LONG',
              limitPrice: limitPx,
              stopLoss: sl,
              takeProfit: limitPx + rDist * 2.85,
              expiresAtIdx: i + PENDING_LIMIT_TTL_BARS,
              grade: adx >= 28 ? 'A+' : 'A',
            };
          } else if (router.direction === 'SHORT' && rsi14[i] <= 50 && rsi14[i] >= 28) {
            const limitPx = router.pullbackEntryZone;
            const sl = Math.max(limitPx + minStopDist, swingHigh + atr * 0.2);
            const rDist = Math.max(sl - limitPx, minStopDist);
            pendingLimit = {
              side: 'SHORT',
              limitPrice: limitPx,
              stopLoss: sl,
              takeProfit: limitPx - rDist * 2.85,
              expiresAtIdx: i + PENDING_LIMIT_TTL_BARS,
              grade: adx >= 28 ? 'A+' : 'A',
            };
          }
        }
      }
    }

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

  if (openTrade) {
    closeOpenTrade(candles[candles.length - 1], candles[candles.length - 1].close, 'END_OF_RANGE', false);
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
    usdInrRate,
    equityCurve,
    trades,
  };
}
