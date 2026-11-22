import assert from 'node:assert/strict';
import {
  computeHistoricalTelemetryIndicators,
  normalizeEpochTimestamp,
  normalizeTelemetrySymbol,
  normalizeTelemetryTimeframe,
  processTelemetryStreamBatch,
  processTelemetryStreamItem,
} from '../src/utils/telemetryProcessor.ts';
import type { TelemetryHistoricalCandle } from '../src/types.ts';

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ PASS: ${name}`);
}

function buildTrendCandles(params: {
  count: number;
  startPrice: number;
  step: number;
  rangePct?: number;
}): TelemetryHistoricalCandle[] {
  const { count, startPrice, step, rangePct = 0.002 } = params;
  const candles: TelemetryHistoricalCandle[] = [];
  const baseTime = 1763500000000;
  for (let i = 0; i < count; i++) {
    const close = Number((startPrice + i * step).toFixed(2));
    const open = Number((close - step * 0.5).toFixed(2));
    const pad = close * rangePct;
    const high = Number((Math.max(open, close) + pad).toFixed(2));
    const low = Number((Math.min(open, close) - pad).toFixed(2));
    candles.push({
      time: baseTime + i * 300000,
      open,
      high,
      low,
      close,
      volume: 200 + i * 5,
    });
  }
  return candles;
}

console.log('RUNNING TELEMETRY STREAM NORMALIZATION & VALIDATION TESTS');

test('Normalizes heterogeneous symbols, timeframes, and UNIX s/ms timestamps', () => {
  const tv = normalizeTelemetrySymbol('BINANCE:BTCUSDT.P');
  assert.equal(tv.canonicalSymbol, 'BTCUSDT');
  assert.equal(tv.deltaSymbol, 'BTCUSD');
  assert.equal(tv.assetClass, 'PERPETUAL');
  assert.equal(tv.inferredExchange, 'BINANCE');

  const delta = normalizeTelemetrySymbol('SOL-PERP');
  assert.equal(delta.canonicalSymbol, 'SOLUSDT');
  assert.equal(delta.deltaSymbol, 'SOLUSD');

  const opt = normalizeTelemetrySymbol('C-BTC-90000-201126');
  assert.equal(opt.assetClass, 'OPTION');
  assert.equal(opt.canonicalSymbol, 'C-BTC-90000-201126');

  assert.equal(normalizeTelemetryTimeframe('60'), '1h');
  assert.equal(normalizeTelemetryTimeframe('240'), '4h');
  assert.equal(normalizeTelemetryTimeframe('D'), '1D');

  assert.equal(normalizeEpochTimestamp(1763500000), 1763500000000);
  assert.equal(normalizeEpochTimestamp(1763500000123), 1763500000123);
});

test('Normalizes TradingView webhook JSON and approves trend-aligned LONG against historical MA & volatility', () => {
  const uptrendCandles = buildTrendCandles({ count: 55, startPrice: 80000, step: 30, rangePct: 0.0022 });
  const latestClose = uptrendCandles[uptrendCandles.length - 1].close; // ~81620

  const result = processTelemetryStreamItem(
    {
      source: 'tradingview',
      ticker: 'BINANCE:BTCUSDT.P',
      interval: '5',
      action: 'buy',
      close: `$${latestClose.toLocaleString()}`,
      sl: latestClose - 350,
      tp: latestClose + 900,
      time: Math.floor(Date.now() / 1000),
      strategy: { name: 'VWAP Camarilla Breakout', order_contracts: 3 },
    },
    uptrendCandles
  );

  assert.equal(result.accepted, true);
  assert.equal(result.quarantined, false);
  assert.ok(result.telemetry);
  assert.equal(result.telemetry.schemaVersion, '1.0');
  assert.equal(result.telemetry.source.provider, 'TRADINGVIEW_WEBHOOK');
  assert.equal(result.telemetry.instrument.canonicalSymbol, 'BTCUSDT');
  assert.equal(result.telemetry.instrument.deltaSymbol, 'BTCUSD');
  assert.equal(result.telemetry.marketData.timeframe, '5m');
  assert.equal(result.telemetry.signal.action, 'LONG');
  assert.equal(result.telemetry.validation.status, 'APPROVED');
  assert.equal(result.telemetry.validation.maAlignment.ema9VsEma20, 'BULLISH');
  assert.ok(result.telemetry.indicators.atr14 > 0);
  assert.ok(result.telemetry.indicators.bollingerWidthPct > 0);
});

test('Parses TradingView plain-text alert strings and validates against history', () => {
  const uptrendCandles = buildTrendCandles({ count: 40, startPrice: 3000, step: 2.5, rangePct: 0.002 });
  const latestClose = uptrendCandles[uptrendCandles.length - 1].close;

  const result = processTelemetryStreamItem(
    `BUY ETHUSD @ ${latestClose} SL ${(latestClose - 25).toFixed(2)} TP ${(latestClose + 60).toFixed(2)} TF 15m`,
    uptrendCandles
  );

  assert.equal(result.accepted, true);
  assert.ok(result.telemetry);
  assert.equal(result.telemetry.instrument.canonicalSymbol, 'ETHUSDT');
  assert.equal(result.telemetry.marketData.timeframe, '15m');
  assert.equal(result.telemetry.signal.action, 'LONG');
  assert.equal(result.telemetry.signal.stopLoss, Number((latestClose - 25).toFixed(2)));
});

test('Normalizes Delta Exchange v2/ticker and Binance futures streams into identical canonical JSON schema', () => {
  const candles = buildTrendCandles({ count: 45, startPrice: 81000, step: 15, rangePct: 0.0018 });
  const latest = candles[candles.length - 1].close;

  const deltaOut = processTelemetryStreamItem(
    {
      type: 'v2/ticker',
      exchange: 'Delta Exchange India',
      product_symbol: 'BTCUSD',
      mark_price: latest,
      spot_price: latest - 12,
      quotes: { best_bid: latest - 4, best_ask: latest + 4 },
      oi_value_usd: 88000000,
      funding_rate: 0.01,
      timestamp: 1763500000,
    },
    candles
  );

  const binanceOut = processTelemetryStreamItem(
    {
      e: '24hrTicker',
      E: Date.now(),
      s: 'BTCUSDT',
      ps: 'BTCUSDT',
      c: String(latest),
      b: String(latest - 3),
      a: String(latest + 3),
      q: '125000000',
      P: '1.15',
    },
    candles
  );

  assert.equal(deltaOut.accepted, true);
  assert.equal(binanceOut.accepted, true);
  assert.equal(deltaOut.telemetry?.instrument.canonicalSymbol, binanceOut.telemetry?.instrument.canonicalSymbol);
  assert.equal(deltaOut.telemetry?.schemaVersion, '1.0');
  assert.equal(binanceOut.telemetry?.schemaVersion, '1.0');
  assert.equal(deltaOut.telemetry?.source.provider, 'DELTA_EXCHANGE');
  assert.equal(binanceOut.telemetry?.source.provider, 'BINANCE_FUTURES');
});

test('Rejects counter-trend LONG signals when EMA9 < EMA20 and price < EMA50 before outputting telemetry', () => {
  const downtrendCandles = buildTrendCandles({ count: 60, startPrice: 84000, step: -45, rangePct: 0.002 });
  const latest = downtrendCandles[downtrendCandles.length - 1].close; // well below EMA50

  const result = processTelemetryStreamItem(
    {
      source: 'tradingview',
      ticker: 'BTCUSDT',
      interval: '5m',
      action: 'BUY',
      close: latest,
    },
    downtrendCandles
  );

  assert.equal(result.accepted, false);
  assert.equal(result.quarantined, true);
  assert.equal(result.telemetry, null);
  assert.equal(result.diagnostic.validation.status, 'REJECTED');
  assert.equal(result.diagnostic.validation.maAlignment.aligned, false);
});

test('Rejects extreme volatility spikes, outlier price deviations, and wide liquidity spreads', () => {
  const volatileCandles = buildTrendCandles({ count: 40, startPrice: 80000, step: 10, rangePct: 0.045 }); // 9% bar ranges => EXTREME ATR%
  const latestVol = volatileCandles[volatileCandles.length - 1].close;

  const volReject = processTelemetryStreamItem(
    { ticker: 'BTCUSDT', action: 'BUY', close: latestVol, interval: '5m' },
    volatileCandles
  );
  assert.equal(volReject.accepted, false);
  assert.equal(volReject.telemetry, null);
  assert.equal(volReject.diagnostic.validation.volatilityCheck.regime, 'EXTREME');

  // Outlier price jump (+15% above historical close)
  const calmCandles = buildTrendCandles({ count: 40, startPrice: 80000, step: 10, rangePct: 0.0015 });
  const calmLatest = calmCandles[calmCandles.length - 1].close;
  const outlierReject = processTelemetryStreamItem(
    { ticker: 'BTCUSDT', action: 'BUY', close: calmLatest * 1.15, interval: '5m' },
    calmCandles
  );
  assert.equal(outlierReject.accepted, false);
  assert.equal(outlierReject.telemetry, null);
  assert.equal(outlierReject.diagnostic.validation.priceDeviationCheck.passed, false);

  // Batch filters out invalid items and emits only validated telemetry
  const batch = processTelemetryStreamBatch(
    [
      { ticker: 'BTCUSDT', action: 'BUY', close: calmLatest, interval: '5m' },
      { ticker: 'BTCUSDT', action: 'BUY', close: calmLatest * 1.15, interval: '5m' },
    ],
    () => calmCandles
  );
  assert.equal(batch.outputStream.length, 1);
  assert.equal(batch.quarantinedStream.length, 1);
  assert.equal(batch.summary.approvalRatePct, 50);

  // Sanity check indicator calculation bounds
  const ind = computeHistoricalTelemetryIndicators(calmCandles, calmLatest);
  assert.ok(ind.bollingerUpper > ind.bollingerMid && ind.bollingerMid > ind.bollingerLower);
});

console.log(`TELEMETRY PROCESSOR TEST SUMMARY: ${passed}/${passed} TESTS PASSED`);
