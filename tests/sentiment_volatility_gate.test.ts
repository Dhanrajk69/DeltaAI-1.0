import assert from 'node:assert/strict';
import { processTelemetryStreamItem } from '../src/utils/telemetryProcessor.ts';
import {
  analyzeMarketSentimentTrend,
  evaluateSentimentAndVolatilityBeforeAlert,
  validateSignalHistoricalVolatility,
} from '../src/utils/sentimentVolatilityGate.ts';
import type { TelemetryHistoricalCandle } from '../src/types.ts';

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ PASS: ${name}`);
}

function buildCandles(params: {
  count: number;
  startPrice: number;
  step: number;
  rangePct?: number;
  tailShockBars?: number;
  tailShockRangePct?: number;
}): TelemetryHistoricalCandle[] {
  const {
    count,
    startPrice,
    step,
    rangePct = 0.002,
    tailShockBars = 0,
    tailShockRangePct = 0.015,
  } = params;
  const candles: TelemetryHistoricalCandle[] = [];
  const baseTime = 1763500000000;
  for (let i = 0; i < count; i++) {
    const close = Number((startPrice + i * step).toFixed(2));
    const open = Number((close - step * 0.5).toFixed(2));
    const isShock = tailShockBars > 0 && i >= count - tailShockBars;
    const pad = close * (isShock ? tailShockRangePct : rangePct);
    const high = Number((Math.max(open, close) + pad).toFixed(2));
    const low = Number((Math.min(open, close) - pad).toFixed(2));
    candles.push({
      time: baseTime + i * 300000,
      open,
      high,
      low,
      close,
      volume: 250 + i * 4,
    });
  }
  return candles;
}

console.log('RUNNING SENTIMENT TREND & PRE-ALERT VOLATILITY GATE TESTS');

test('Analyzes multi-factor market sentiment and detects IMPROVING and REVERSING_UP trends', () => {
  const bullCandles = buildCandles({ count: 50, startPrice: 80000, step: 35, rangePct: 0.002 });
  const latest = bullCandles[bullCandles.length - 1].close;
  const ingested = processTelemetryStreamItem(
    {
      source: 'tradingview',
      ticker: 'BTCUSDT',
      interval: '5m',
      action: 'BUY',
      close: latest,
      sl: latest - 450,
      tp: latest + 1000,
    },
    bullCandles
  );

  const reversingHistory = [
    { timestampMs: 1, score: -32, price: 80200 },
    { timestampMs: 2, score: -24, price: 80400 },
    { timestampMs: 3, score: -15, price: 80800 },
  ];

  const sentiment = analyzeMarketSentimentTrend({
    telemetry: ingested.diagnostic,
    candles: bullCandles,
    context: {
      change24hPct: 2.8,
      fundingRate: 0.015,
      liquidationsLong24h: 1800000,
      liquidationsShort24h: 7200000,
      newsAggregateScore: 48,
      previousHistory: reversingHistory,
    },
  });

  assert.ok(sentiment.compositeScore >= 35, `Expected bullish compositeScore, got ${sentiment.compositeScore}`);
  assert.equal(sentiment.trendDirection, 'REVERSING_UP');
  assert.equal(sentiment.signalAlignment, 'ALIGNED');
  assert.ok(sentiment.trendDelta > 30);
});

test('Approves healthy volatility + aligned sentiment signal as ALLOW_HIGH_PRIORITY', () => {
  const bullCandles = buildCandles({ count: 55, startPrice: 80000, step: 25, rangePct: 0.002 });
  const latest = bullCandles[bullCandles.length - 1].close;
  const ingested = processTelemetryStreamItem(
    {
      source: 'tradingview',
      ticker: 'BTCUSDT',
      interval: '5m',
      action: 'BUY',
      close: latest,
      sl: latest - 500, // ~1.4x ATR
      tp: latest + 1200, // 2.4:1 R:R
    },
    bullCandles
  );

  const evalRes = evaluateSentimentAndVolatilityBeforeAlert({
    telemetry: ingested.diagnostic,
    candles: bullCandles,
    sentimentContext: {
      change24hPct: 2.1,
      fundingRate: 0.012,
      liquidationsLong24h: 2000000,
      liquidationsShort24h: 5500000,
      newsAggregateScore: 30,
      previousHistory: [
        { timestampMs: 1, score: 25, price: 80900 },
        { timestampMs: 2, score: 32, price: 81100 },
      ],
    },
  });

  assert.equal(evalRes.decision, 'ALLOW_HIGH_PRIORITY');
  assert.equal(evalRes.shouldAlert, true);
  assert.equal(evalRes.alertPriority, 'high');
  assert.equal(evalRes.disableNotification, false);
  assert.equal(evalRes.volatility.passed, true);
  assert.ok(evalRes.volatility.riskRewardRatio && evalRes.volatility.riskRewardRatio >= 2);
});

test('Blocks alert when sudden historical volatility expansion exceeds baseline ATR ratio threshold', () => {
  // 50 calm bars (0.15% range) followed by 10 extreme shock bars (1.4% range => ~9x baseline ATR)
  const shockCandles = buildCandles({
    count: 60,
    startPrice: 80000,
    step: 20,
    rangePct: 0.0015,
    tailShockBars: 10,
    tailShockRangePct: 0.014,
  });
  const latest = shockCandles[shockCandles.length - 1].close;

  const ingested = processTelemetryStreamItem(
    {
      source: 'tradingview',
      ticker: 'BTCUSDT',
      interval: '5m',
      action: 'BUY',
      close: latest,
      sl: latest - 1200,
      tp: latest + 2600,
    },
    shockCandles
  );

  const volCheck = validateSignalHistoricalVolatility({
    telemetry: ingested.diagnostic,
    candles: shockCandles,
  });
  assert.equal(volCheck.passed, false);
  assert.equal(volCheck.regime, 'EXTREME');
  assert.ok(volCheck.atrExpansionRatio >= 2.2);

  const evalRes = evaluateSentimentAndVolatilityBeforeAlert({
    telemetry: ingested.diagnostic,
    candles: shockCandles,
    sentimentContext: { change24hPct: 2.0, fundingRate: 0.01 },
  });
  assert.equal(evalRes.decision, 'BLOCK_ALERT');
  assert.equal(evalRes.shouldAlert, false);
  assert.equal(evalRes.alertPriority, 'none');
});

test('Blocks alert when Stop-Loss is dangerously tight vs ATR(14) whipsaw noise', () => {
  const bullCandles = buildCandles({ count: 55, startPrice: 80000, step: 25, rangePct: 0.0025 });
  const latest = bullCandles[bullCandles.length - 1].close;
  // ATR is ~$400+; placing SL only $40 away (~0.1x ATR) must be blocked
  const ingested = processTelemetryStreamItem(
    {
      source: 'tradingview',
      ticker: 'BTCUSDT',
      interval: '5m',
      action: 'BUY',
      close: latest,
      sl: latest - 40,
      tp: latest + 600,
    },
    bullCandles
  );

  const evalRes = evaluateSentimentAndVolatilityBeforeAlert({
    telemetry: ingested.diagnostic,
    candles: bullCandles,
    sentimentContext: { change24hPct: 1.5, fundingRate: 0.01 },
  });

  assert.equal(evalRes.decision, 'BLOCK_ALERT');
  assert.equal(evalRes.shouldAlert, false);
  assert.equal(evalRes.volatility.passed, false);
  assert.ok(
    evalRes.volatility.stopDistanceAtrRatio !== undefined &&
      evalRes.volatility.stopDistanceAtrRatio < 0.45
  );
});

test('Downgrades mildly divergent / elevated volatility signals to ALLOW_SILENT_CAUTION (priority: low)', () => {
  // Moderate expansion (~1.6x baseline) -> ELEVATED volatility regime, not EXTREME
  const elevatedCandles = buildCandles({
    count: 55,
    startPrice: 80000,
    step: 15,
    rangePct: 0.0016,
    tailShockBars: 10,
    tailShockRangePct: 0.0038,
  });
  const latest = elevatedCandles[elevatedCandles.length - 1].close;

  const ingested = processTelemetryStreamItem(
    {
      source: 'tradingview',
      ticker: 'BTCUSDT',
      interval: '5m',
      action: 'BUY',
      close: latest,
      sl: latest - 600,
      tp: latest + 1400,
    },
    elevatedCandles
  );

  const evalRes = evaluateSentimentAndVolatilityBeforeAlert({
    telemetry: ingested.diagnostic,
    candles: elevatedCandles,
    sentimentContext: { change24hPct: 1.2, fundingRate: 0.01 },
  });

  assert.equal(evalRes.decision, 'ALLOW_SILENT_CAUTION');
  assert.equal(evalRes.shouldAlert, true);
  assert.equal(evalRes.alertPriority, 'low');
  assert.equal(evalRes.disableNotification, true);
});

console.log(`SENTIMENT & VOLATILITY GATE TEST SUMMARY: ${passed}/${passed} TESTS PASSED`);
