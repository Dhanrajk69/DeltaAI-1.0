import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  StopLossWatchdogStore,
  evaluateHardDrawdownBreach,
  resolveMandatoryStopLossPrice,
  syncNativeExchangeStopLoss,
} from '../src/server/stopLossWatchdog.ts';
import {
  DELTA_GST_RATE,
  DELTA_TAKER_FEE_RATE,
  backtestTradesToCsv,
  fetchDeltaHistoricalCandles,
  runHistoricalBacktest,
  type DeltaOhlcvCandle,
} from '../src/server/historicalBacktestEngine.ts';
import type { WarehouseSignalRecord } from '../src/server/analyticsWarehouse.ts';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function runTests() {
  console.log('Running Native Stop-Loss Watchdog & Historical Backtest Engine tests...');

  // ── 1. Hard Drawdown Breach Evaluation ────────────────────────────────────
  {
    const entry = 80000;
    const sl = 79200; // 1% risk = $800 per BTC
    const recordedStop = {
      symbol: 'BTCUSD',
      canonicalSymbol: 'BTCUSDT',
      side: 'LONG' as const,
      contracts: 10,
      entryPrice: entry,
      stopLossPrice: sl,
      initialRiskPerUnit: 800,
      updatedAt: Date.now(),
      mode: 'LIVE' as const,
    };

    // Within 0.15% tolerance (0.10% below SL => 79120.8, -1.10R): should NOT trigger
    const safeEval = evaluateHardDrawdownBreach(
      { symbol: 'BTCUSD', side: 'LONG', contracts: 10, entryPrice: entry, markPrice: 79130 },
      recordedStop
    );
    assert.equal(safeEval.shouldTrigger, false, '0.09% below SL should stay within 0.15% grace tolerance');

    // Breaches SL by > 0.15% (79200 * (1 - 0.002) = 79041.6): MUST trigger
    const slBreachEval = evaluateHardDrawdownBreach(
      { symbol: 'BTCUSD', side: 'LONG', contracts: 10, entryPrice: entry, markPrice: 79040 },
      recordedStop
    );
    assert.equal(slBreachEval.shouldTrigger, true);
    assert.equal(slBreachEval.breachType, 'SL_BREACH_0_15_PCT');
    assert.ok(slBreachEval.breachPctBeyondSl > 0.15);

    // SHORT position breaching SL by > 0.15%
    const shortSlEval = evaluateHardDrawdownBreach(
      { symbol: 'ETHUSD', side: 'SHORT', contracts: 5, entryPrice: 2000, markPrice: 2025, stopLoss: 2020 },
      {
        symbol: 'ETHUSD',
        canonicalSymbol: 'ETHUSDT',
        side: 'SHORT',
        contracts: 5,
        entryPrice: 2000,
        stopLossPrice: 2020,
        initialRiskPerUnit: 20,
        updatedAt: Date.now(),
        mode: 'LIVE',
      }
    );
    assert.equal(shortSlEval.shouldTrigger, true);
    assert.equal(shortSlEval.breachType, 'SL_BREACH_0_15_PCT');

    // Loss reaches -1.55R even if stopLossPrice was widened -> MUST trigger MAX_R_LOSS_1_5R
    const rBreachEval = evaluateHardDrawdownBreach(
      { symbol: 'BTCUSD', side: 'LONG', contracts: 10, entryPrice: 80000, markPrice: 78750 },
      {
        ...recordedStop,
        stopLossPrice: 78000, // widened SL, but initialRiskPerUnit was 800 -> -1250/800 = -1.56R
        initialRiskPerUnit: 800,
      }
    );
    assert.equal(rBreachEval.shouldTrigger, true);
    assert.equal(rBreachEval.breachType, 'MAX_R_LOSS_1_5R');
    assert.ok(rBreachEval.rMultiple <= -1.5);

    // Mandatory fallback SL when requestedStopLoss is omitted or inverted
    const fallbackSl = resolveMandatoryStopLossPrice({
      side: 'LONG',
      entryPrice: 100000,
      requestedStopLoss: 105000, // invalid for LONG
    });
    assert.equal(fallbackSl, 98800, 'Should fall back to 1.2% below entry for LONG');
    console.log('  ✓ Hard drawdown breach evaluator & mandatory SL fallback verified');
  }

  // ── 2. Native Exchange Stop-Loss Sync & Store Persistence ─────────────────
  {
    const tmpDir = makeTempDir('delta-watchdog-test-');
    const store = new StopLossWatchdogStore(tmpDir);

    let openOrders: any[] = [];
    const dispatchedPayloads: any[] = [];
    const cancelledOrderIds: Array<string | number> = [];

    const mockDepsBase = {
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      environment: 'PROD' as const,
      productId: 27,
      productSymbol: 'BTCUSD',
      canonicalSymbol: 'BTCUSDT',
      positionSide: 'LONG' as const,
      entryPrice: 80000,
      store,
      fetchSignedGet: async () => ({ ok: true, status: 200, json: { result: openOrders } }),
      dispatchOrder: async ({ orderPayload }: any) => {
        dispatchedPayloads.push(orderPayload);
        const newId = 1000 + dispatchedPayloads.length;
        openOrders.push({
          id: newId,
          product_id: 27,
          product_symbol: 'BTCUSD',
          stop_order_type: orderPayload.stop_order_type,
          stop_price: orderPayload.stop_price,
          size: orderPayload.size,
          unfilled_size: orderPayload.size,
          reduce_only: orderPayload.reduce_only,
        });
        return { ok: true, orderId: newId, state: 'open' };
      },
      cancelOrder: async ({ orderId }: any) => {
        cancelledOrderIds.push(orderId);
        openOrders = openOrders.filter((o) => o.id !== orderId);
        return { ok: true, status: 200 };
      },
    };

    // Initial live fill: 10 contracts -> creates native reduce_only stop_loss_order
    const firstSync = await syncNativeExchangeStopLoss({
      ...mockDepsBase,
      remainingContracts: 10,
      stopLossPrice: 79000,
    });
    assert.equal(firstSync.ok, true);
    assert.equal(firstSync.action, 'CREATED');
    assert.equal(dispatchedPayloads.length, 1);
    assert.equal(dispatchedPayloads[0].stop_order_type, 'stop_loss_order');
    assert.equal(dispatchedPayloads[0].reduce_only, true);
    assert.equal(dispatchedPayloads[0].size, 10);
    assert.equal(dispatchedPayloads[0].side, 'sell');

    // Re-syncing identical size & SL -> reuses existing order without duplicates
    const reuseSync = await syncNativeExchangeStopLoss({
      ...mockDepsBase,
      remainingContracts: 10,
      stopLossPrice: 79000,
    });
    assert.equal(reuseSync.action, 'REUSED');
    assert.equal(dispatchedPayloads.length, 1);

    // 50% partial close -> remainingContracts becomes 5 -> cancels 10-ct SL and creates 5-ct SL
    const partialSync = await syncNativeExchangeStopLoss({
      ...mockDepsBase,
      remainingContracts: 5,
      stopLossPrice: 79000,
    });
    assert.equal(partialSync.ok, true);
    assert.equal(partialSync.action, 'CREATED');
    assert.equal(partialSync.cancelledCount, 1);
    assert.equal(cancelledOrderIds.length, 1);
    assert.equal(dispatchedPayloads[1].size, 5);
    assert.equal(dispatchedPayloads[1].reduce_only, true);

    // Verify persistence on disk
    const reloadedStore = new StopLossWatchdogStore(tmpDir);
    const saved = reloadedStore.getStop('BTCUSD');
    assert.ok(saved);
    assert.equal(saved?.contracts, 5);
    assert.equal(saved?.stopLossPrice, 79000);

    // Full close -> cancels lingering SL and clears store
    const closeSync = await syncNativeExchangeStopLoss({
      ...mockDepsBase,
      remainingContracts: 0,
      stopLossPrice: 0,
    });
    assert.equal(closeSync.action, 'CANCELLED_ALL');
    assert.equal(closeSync.cancelledCount, 1);
    assert.equal(store.getStop('BTCUSD'), undefined);

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('  ✓ Native exchange stop_loss_order sync, resize on 50% partial close & persistence verified');
  }

  // ── 3. Delta Historical OHLCV Chunked Pagination + Disk Cache ─────────────
  {
    const tmpDir = makeTempDir('delta-candles-test-');
    const step = 300; // 5m
    const totalBars = 2400; // > 1,800 bars -> requires 2 paginated chunks
    const startSec = 1_700_000_000;
    const endSec = startSec + totalBars * step;

    let fetchCalls = 0;
    const mockFetcher = async (url: string) => {
      fetchCalls += 1;
      const u = new URL(url);
      const qStart = Number(u.searchParams.get('start'));
      const qEnd = Number(u.searchParams.get('end'));
      const rows: DeltaOhlcvCandle[] = [];
      for (let t = qStart; t <= qEnd; t += step) {
        const px = 80000 + Math.sin(t / 3600) * 500;
        rows.push({
          time: t,
          open: px,
          high: px + 40,
          low: px - 40,
          close: px + 10,
          volume: 120,
        });
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: rows }),
      };
    };

    const firstFetch = await fetchDeltaHistoricalCandles({
      dataDir: tmpDir,
      symbol: 'BTCUSD',
      resolution: '5m',
      startSec,
      endSec,
      fetcher: mockFetcher,
    });
    assert.equal(firstFetch.source, 'DELTA_EXCHANGE_INDIA');
    assert.equal(firstFetch.chunksFetched, 2, '2,400 bars should paginate across 2 chunks (1,800 max/chunk)');
    assert.ok(firstFetch.candles.length >= 2400);
    assert.ok(fs.existsSync(path.join(tmpDir, 'candles-cache', 'BTCUSD_5m.json')));

    // Repeat fetch should hit DISK_CACHE with 0 network calls
    const beforeCalls = fetchCalls;
    const cachedFetch = await fetchDeltaHistoricalCandles({
      dataDir: tmpDir,
      symbol: 'BTCUSD',
      resolution: '5m',
      startSec,
      endSec,
      fetcher: mockFetcher,
    });
    assert.equal(cachedFetch.fromCache, true);
    assert.equal(cachedFetch.source, 'DISK_CACHE');
    assert.equal(fetchCalls, beforeCalls, 'Second fetch must be served completely from disk cache');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('  ✓ Delta Exchange India historical candles chunked pagination & disk cache verified');
  }

  // ── 4. Backtester Simulation, Exact Fee/GST Math & Warehouse Replay ───────
  {
    const baseTime = Math.floor(Date.UTC(2026, 9, 1, 0, 0, 0) / 1000);
    const candles: DeltaOhlcvCandle[] = [];
    // Generate 160 hourly bars (~6.7 days) with an uptrend breakout to trigger signals cleanly
    for (let i = 0; i < 160; i += 1) {
      const t = baseTime + i * 3600;
      const wave = i < 40 ? 80000 + Math.sin(i * 0.4) * 180 : 80000 + (i - 40) * 120 + Math.sin(i * 0.5) * 220;
      candles.push({
        time: t,
        open: wave - 30,
        high: wave + 160,
        low: wave - 140,
        close: wave + 45,
        volume: 500 + (i % 10) * 40,
      });
    }

    const replaySignal: WarehouseSignalRecord = {
      eventId: 'sig-replay-1',
      signalId: 'sig-replay-1',
      timestamp_utc: new Date((baseTime + 60 * 3600) * 1000).toISOString(),
      timestamp_ist: new Date((baseTime + 60 * 3600) * 1000).toISOString(),
      timestampMs: (baseTime + 60 * 3600) * 1000,
      sourceEngine: 'CAMARILLA_SNIPER',
      symbol: 'BTCUSD',
      timeframe: '1h',
      grade: 'A+',
      aiScore: 88,
      convictionPct: 86,
      direction: 'LONG',
      entryPrice: candles[60].close,
      stopLoss: candles[60].close - 600,
      tp1: candles[60].close + 900,
      tp2: candles[60].close + 1500,
      tp3: null,
      tp4: null,
      cprRegime: 'NARROW_TRENDING',
      sentimentScore: 42,
      status: 'GENERATED',
      rejectionReason: null,
      outcomePnl: null,
      hitTarget: null,
      mode: 'LIVE',
    };

    const replayRes = runHistoricalBacktest({
      symbol: 'BTCUSD',
      timeframe: '1h',
      days: 7,
      strategyMode: 'WAREHOUSE_SIGNALS_REPLAY',
      candles,
      warehouseSignals: [replaySignal],
      initialCapitalUsd: 1000,
      leverage: 10,
      usdInrRate: 89,
    });

    assert.equal(replayRes.signalsMatchedCount, 1);
    assert.equal(replayRes.totalTrades, 1);
    const tr = replayRes.trades[0];
    assert.equal(tr.signalId, 'sig-replay-1');
    assert.equal(tr.exitReason, 'TP_HIT');
    // Verify exact 0.059% fee + 18% GST relationship
    const expectedGst = +(tr.feeUsd * DELTA_GST_RATE).toFixed(4);
    assert.ok(Math.abs(tr.gstUsd - expectedGst) <= 0.001, 'GST must equal 18% of Taker fee');
    assert.ok(tr.feeUsd > 0 && DELTA_TAKER_FEE_RATE === 0.00059);
    assert.ok(Math.abs(tr.netPnlUsd - (tr.grossPnlUsd - tr.feeUsd - tr.gstUsd)) <= 0.002);

    // Verify Camarilla CPR Sniper & AI Matrix Consensus run cleanly without errors
    const camRes = runHistoricalBacktest({
      symbol: 'BTCUSD',
      timeframe: '1h',
      days: 7,
      strategyMode: 'CAMARILLA_CPR_SNIPER',
      candles,
      initialCapitalUsd: 1000,
      leverage: 10,
    });
    assert.ok(camRes.equityCurve.length > 0);
    assert.ok(camRes.totalTrades >= 1, 'Camarilla breakout series should produce >= 1 simulated trade');

    const aiRes = runHistoricalBacktest({
      symbol: 'BTCUSD',
      timeframe: '1h',
      days: 7,
      strategyMode: 'AI_MATRIX_CONSENSUS',
      candles,
      initialCapitalUsd: 1000,
      leverage: 10,
    });
    assert.ok(aiRes.equityCurve.length > 0);

    // Verify CSV export
    const csv = backtestTradesToCsv(replayRes.trades);
    assert.ok(csv.startsWith('trade_id,symbol,side,strategy_mode,'));
    assert.ok(csv.includes('sig-replay-1'));
    assert.ok(csv.includes('TP_HIT'));

    console.log('  ✓ Historical backtester, Warehouse Signals Replay, exact 0.059% fee + 18% GST & CSV export verified');
  }

  console.log('\nALL WATCHDOG & HISTORICAL BACKTEST TESTS PASSED ✓');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
