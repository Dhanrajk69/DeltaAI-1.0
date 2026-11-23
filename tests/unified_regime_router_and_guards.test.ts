import assert from 'node:assert/strict';
import {
  evaluateUnifiedRegimeRouter,
  OhlcCandle,
} from '../src/utils/aiMatrixEngine.ts';
import {
  runUnifiedStrategyBacktest,
  MAX_TRADES_PER_UTC_DAY,
} from '../src/utils/backtestEngine.ts';
import { buildOptionsProfitLadder } from '../src/utils/optionsProfitLadder.ts';
import type { OptionStrategyPosition } from '../src/types.ts';

function buildSyntheticCandles(
  count: number,
  stepSec: number,
  startSec: number,
  priceFn: (i: number) => { open: number; high: number; low: number; close: number }
): OhlcCandle[] {
  const out: OhlcCandle[] = [];
  for (let i = 0; i < count; i += 1) {
    const px = priceFn(i);
    out.push({
      time: startSec + i * stepSec,
      open: px.open,
      high: px.high,
      low: px.low,
      close: px.close,
      volume: 150 + (i % 10) * 15,
    });
  }
  return out;
}

const baseStartSec = Math.floor(Date.UTC(2026, 2, 1, 0, 0, 0) / 1000);

// 1. Unified Regime Router: Chop / Low Volatility Gate -> NO TRADE (CHOP / LOW VOLATILITY)
{
  const flat15m = buildSyntheticCandles(80, 900, baseStartSec, (i) => {
    const mid = 80000 + Math.sin(i * 0.4) * 35;
    return {
      open: mid - 10,
      high: mid + 25,
      low: mid - 25,
      close: mid + (i % 2 === 0 ? 5 : -5),
    };
  });
  const flat1h = buildSyntheticCandles(80, 3600, baseStartSec - 80 * 3600, () => ({
    open: 80000,
    high: 80040,
    low: 79960,
    close: 80005,
  }));
  const flat4h = buildSyntheticCandles(80, 14400, baseStartSec - 80 * 14400, () => ({
    open: 80000,
    high: 80050,
    low: 79950,
    close: 80000,
  }));

  const chopResult = evaluateUnifiedRegimeRouter({
    symbol: 'BTCUSDT',
    markPrice: 80005,
    candles15m: flat15m,
    candles1h: flat1h,
    candles4h: flat4h,
  });

  assert.equal(chopResult.isNoTrade, true);
  assert.equal(chopResult.routeDestination, 'NO_TRADE');
  assert.equal(chopResult.statusLabel, 'NO TRADE (CHOP / LOW VOLATILITY)');
  assert.ok(chopResult.adx14_15m < 22 || chopResult.atrPct_15m < 0.3);
}

// 2. Unified Regime Router: 4H vs 1H Trend Conflict -> NO TRADE (CHOP / LOW VOLATILITY)
{
  const trend15m = buildSyntheticCandles(80, 900, baseStartSec, (i) => {
    const close = 76000 + i * 160;
    return { open: close - 90, high: close + 180, low: close - 210, close };
  });
  const bull1h = buildSyntheticCandles(80, 3600, baseStartSec - 80 * 3600, (i) => {
    const close = 76000 + i * 140;
    return { open: close - 80, high: close + 220, low: close - 220, close };
  });
  const bear4h = buildSyntheticCandles(80, 14400, baseStartSec - 80 * 14400, (i) => {
    const close = 90000 - i * 120;
    return { open: close + 100, high: close + 240, low: close - 240, close };
  });

  const conflictRes = evaluateUnifiedRegimeRouter({
    symbol: 'BTCUSDT',
    markPrice: bull1h[bull1h.length - 1].close,
    candles15m: trend15m,
    candles1h: bull1h,
    candles4h: bear4h,
  });

  assert.equal(conflictRes.isNoTrade, true);
  assert.equal(conflictRes.bias1h, 'LONG');
  assert.equal(conflictRes.bias4h, 'SHORT');
  assert.equal(conflictRes.statusLabel, 'NO TRADE (CHOP / LOW VOLATILITY)');
}

// 3. Unified Regime Router: Bullish Alignment + Normal CPR -> PERPETUALS (1.5x ATR Stop >= 0.55% BTC, Fee BE +0.15%)
{
  const bull15m = buildSyntheticCandles(120, 900, baseStartSec, (i) => {
    const close = 80000 + i * 120;
    return { open: close - 80, high: close + 260, low: close - 260, close };
  });
  const bull1h = buildSyntheticCandles(90, 3600, baseStartSec - 90 * 3600, (i) => {
    const close = 76000 + i * 200;
    return { open: close - 120, high: close + 300, low: close - 280, close };
  });
  const bull4h = buildSyntheticCandles(90, 14400, baseStartSec - 90 * 14400, (i) => {
    const close = 72000 + i * 250;
    return { open: close - 150, high: close + 400, low: close - 350, close };
  });

  const mark = bull1h[bull1h.length - 1].close;
  const perpRes = evaluateUnifiedRegimeRouter({
    symbol: 'BTCUSDT',
    markPrice: mark,
    candles15m: bull15m,
    candles1h: bull1h,
    candles4h: bull4h,
    dailyCprWidthPct: 0.22,
    dailyCprPercentile: 45,
  });

  assert.equal(perpRes.isNoTrade, false);
  assert.equal(perpRes.direction, 'LONG');
  assert.equal(perpRes.routeDestination, 'PERPETUALS');
  assert.ok(perpRes.adx14_15m >= 22);
  assert.ok(perpRes.atrPct_15m >= 0.30);
  // Check minimum 0.55% BTC stop distance and +0.15% fee-adjusted BE
  const slDistPct = (perpRes.pullbackEntryZone - perpRes.recommendedStopLoss) / perpRes.pullbackEntryZone;
  assert.ok(slDistPct >= 0.0054, `Expected >= 0.55% stop distance, got ${slDistPct}`);
  const beBufferPct = (perpRes.feeAdjustedBePrice - perpRes.pullbackEntryZone) / perpRes.pullbackEntryZone;
  assert.ok(Math.abs(beBufferPct - 0.0015) < 0.0002, `Expected ~0.15% BE buffer, got ${beBufferPct}`);

  // 4. Same Bullish Trend + Wide CPR (>= 80th percentile) -> OPTIONS_DEBIT_SPREAD (Bull Call Spread)
  const wideCprRes = evaluateUnifiedRegimeRouter({
    symbol: 'BTCUSDT',
    markPrice: mark,
    candles15m: bull15m,
    candles1h: bull1h,
    candles4h: bull4h,
    dailyCprWidthPct: 0.55,
    dailyCprPercentile: 85,
  });

  assert.equal(wideCprRes.isNoTrade, false);
  assert.equal(wideCprRes.routeDestination, 'OPTIONS_DEBIT_SPREAD');
  assert.equal(wideCprRes.recommendedOptionsStrategy, 'Bull Call Spread');
}

// 5. Bearish Alignment + Wide CPR -> OPTIONS_DEBIT_SPREAD (Bear Put Spread)
{
  const bear15m = buildSyntheticCandles(120, 900, baseStartSec, (i) => {
    const close = 96000 - i * 130;
    return { open: close + 90, high: close + 280, low: close - 280, close };
  });
  const bear1h = buildSyntheticCandles(90, 3600, baseStartSec - 90 * 3600, (i) => {
    const close = 98000 - i * 210;
    return { open: close + 120, high: close + 300, low: close - 320, close };
  });
  const bear4h = buildSyntheticCandles(90, 14400, baseStartSec - 90 * 14400, (i) => {
    const close = 102000 - i * 260;
    return { open: close + 160, high: close + 350, low: close - 380, close };
  });

  const bearOpt = evaluateUnifiedRegimeRouter({
    symbol: 'BTCUSDT',
    markPrice: bear1h[bear1h.length - 1].close,
    candles15m: bear15m,
    candles1h: bear1h,
    candles4h: bear4h,
    dailyCprWidthPct: 0.62,
    dailyCprPercentile: 90,
  });

  assert.equal(bearOpt.isNoTrade, false);
  assert.equal(bearOpt.direction, 'SHORT');
  assert.equal(bearOpt.routeDestination, 'OPTIONS_DEBIT_SPREAD');
  assert.equal(bearOpt.recommendedOptionsStrategy, 'Bear Put Spread');
}

// 6. Backtest Engine: Max 3 Trades Per UTC Day Guard & Post-Only Maker Fees
{
  const btCandles = buildSyntheticCandles(400, 900, baseStartSec, (i) => {
    // Oscillating upward trend with periodic pullbacks that trigger fills without breaking trend
    const wave = (i % 8 === 0 ? -380 : 0);
    const close = 80000 + i * 95 + wave;
    return {
      open: close - 60,
      high: close + 320,
      low: close - 450,
      close,
    };
  });

  const summary = runUnifiedStrategyBacktest({
    symbol: 'BTCUSD',
    timeframe: '15m',
    days: 5,
    strategyMode: 'AI_MATRIX_CONSENSUS',
    candles: btCandles,
    initialCapitalUsd: 2000,
    leverage: 10,
    riskPerTradePct: 1,
  });

  const countsByDay = new Map<string, number>();
  for (const t of summary.trades) {
    const day = t.entryTimeIso.slice(0, 10);
    countsByDay.set(day, (countsByDay.get(day) || 0) + 1);
  }
  for (const [day, count] of countsByDay.entries()) {
    assert.ok(
      count <= MAX_TRADES_PER_UTC_DAY,
      `Expected <= ${MAX_TRADES_PER_UTC_DAY} trades on ${day}, got ${count}`
    );
  }
}

// 7. Options Profit Ladder for Debit Spreads -> 1.5x–2.2x (+50%, +75%, +100%, +120%)
{
  const debitSpreadPos: OptionStrategyPosition = {
    id: 'test-bull-call',
    strategyName: 'Bull Call Spread',
    category: 'DIRECTIONAL',
    symbol: 'BTCUSDT',
    underlyingPrice: 82000,
    entryUnderlyingPrice: 82000,
    marketOutlook: 'Bullish',
    volatilityOutlook: 'Moderate',
    confidence: 82,
    signalStrength: 'Strong',
    status: 'ACTIVE',
    openedAt: Date.now() - 60_000,
    lotSize: 1,
    leverage: 1,
    netPremiumCollectedOrPaid: -100,
    netDebitPaidUsd: 100,
    maxProfitUsd: 120,
    maxRiskUsd: 100,
    unrealisedPnlUsd: 55,
    realisedPnlUsd: 0,
    currentProfitPercent: 55,
    maxProfitTargetPercent: 120,
    marginStatus: 'Safe',
    riskStatus: 'Normal',
    expiryStatus: 'Healthy',
    rollingRequired: false,
    aiVerdict: 'Debit spread test',
    legs: [
      {
        id: 'l1',
        type: 'CALL',
        action: 'BUY',
        strike: 82000,
        expiry: '2026-03-02',
        dte: 1,
        premiumEntry: 320,
        premiumCurrent: 390,
        delta: 0.53,
        gamma: 0.0001,
        theta: -25,
        vega: 18,
        iv: 52,
        contracts: 1,
      },
      {
        id: 'l2',
        type: 'CALL',
        action: 'SELL',
        strike: 83500,
        expiry: '2026-03-02',
        dte: 1,
        premiumEntry: 220,
        premiumCurrent: 235,
        delta: -0.27,
        gamma: -0.00008,
        theta: 18,
        vega: -14,
        iv: 51,
        contracts: 1,
      },
    ],
    greeks: {
      netDelta: 0.26,
      netGamma: 0.00002,
      netTheta: -7,
      netVega: 4,
      averageIv: 51.5,
      thetaStatus: 'Negative',
      vegaStatus: 'Healthy',
    },
  };

  const ladder = buildOptionsProfitLadder(debitSpreadPos, 82300, 85, true);
  assert.equal(ladder.isCreditStrategy, false);
  assert.deepEqual(
    ladder.steps.map((s) => s.targetPct),
    [50, 75, 100, 120]
  );
  assert.equal(ladder.steps[0].isAchieved, true);
}

console.log('✅ All unified regime router, maker pullback, debit spread, and daily cap tests passed.');
