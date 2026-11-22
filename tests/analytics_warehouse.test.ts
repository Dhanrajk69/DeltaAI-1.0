import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAnalyticsWarehouse,
  formatIstIso,
  formatUtcIso,
} from '../src/server/analyticsWarehouse.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('Running Cloud Signal & Trade Telemetry Warehouse unit tests...');

runTest('formats UTC and IST ISO-8601 timestamps accurately', () => {
  const ts = Date.parse('2026-11-19T16:32:04.000Z');
  assert.equal(formatUtcIso(ts), '2026-11-19T16:32:04.000Z');
  assert.equal(formatIstIso(ts), '2026-11-19T22:02:04+05:30');
});

runTest('appends signals_archive.jsonl, deduplicates repeated polls, and tracks lifecycle outcome transitions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltaai-wh-sig-'));
  try {
    const wh = createAnalyticsWarehouse(tmpDir);
    const ts = Date.parse('2026-11-19T10:15:00.000Z');

    const first = wh.recordSignal({
      signalId: 'sniper-BTCUSDT-LONG-91250',
      timestampMs: ts,
      sourceEngine: 'CAMARILLA_SNIPER_15_MICRO',
      symbol: 'BTCUSDT',
      timeframe: '5m',
      grade: 'A+',
      aiScore: 92,
      convictionPct: 92,
      direction: 'LONG',
      entryPrice: 91250,
      stopLoss: 90950,
      tp1: 91570,
      tp2: 91840,
      tp3: 92100,
      tp4: 92450,
      cprRegime: 'NARROW_CPR',
      sentimentScore: 68,
      status: 'GENERATED',
      mode: 'LIVE',
    });
    assert.equal(first.appended, true);
    assert.equal(first.record.timestamp_utc, '2026-11-19T10:15:00.000Z');
    assert.equal(first.record.timestamp_ist, '2026-11-19T15:45:00+05:30');

    // Polling duplicate must be ignored
    const dup = wh.recordSignal({
      signalId: 'sniper-BTCUSDT-LONG-91250',
      timestampMs: ts + 6000,
      sourceEngine: 'CAMARILLA_SNIPER_15_MICRO',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entryPrice: 91250,
      status: 'GENERATED',
    });
    assert.equal(dup.appended, false);

    // Status + outcome transition appends a new lifecycle state row
    const executed = wh.recordSignal({
      signalId: 'sniper-BTCUSDT-LONG-91250',
      timestampMs: ts + 120000,
      sourceEngine: 'CAMARILLA_SNIPER_15_MICRO',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entryPrice: 91250,
      status: 'EXECUTED',
      outcomePnl: 18.45,
      hitTarget: 'TP2',
      mode: 'LIVE',
    });
    assert.equal(executed.appended, true);

    const allRows = wh.loadSignalsArchive();
    assert.equal(allRows.length, 2);

    const latestUnique = wh.loadLatestUniqueSignals(10);
    assert.equal(latestUnique.length, 1);
    assert.equal(latestUnique[0].status, 'EXECUTED');
    assert.equal(latestUnique[0].outcomePnl, 18.45);
    assert.equal(latestUnique[0].hitTarget, 'TP2');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

runTest('archives trade lifecycle events and Delta Exchange fills with 18% GST, INR conversion, and fillId dedup', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltaai-wh-trd-'));
  try {
    const wh = createAnalyticsWarehouse(tmpDir);

    const tp1 = wh.recordTradeLifecycleEvent({
      eventId: 'tp1-hit-sniper-1',
      tradeId: 'sniper-1',
      eventType: 'TP1_HIT',
      timestampMs: Date.parse('2026-11-19T11:00:00.000Z'),
      symbol: 'BTCUSD',
      side: 'LONG',
      size: 0.002,
      entryPrice: 91250,
      exitPrice: 91570,
      fees: 0.5,
      leverage: 20,
      netRealizedPnlUsd: 12.5,
      usdInrRate: 85,
      mode: 'LIVE',
      reason: 'TP1 Hit — 50% Partial Close',
    });
    assert.equal(tp1.appended, true);
    assert.equal(tp1.record.gst, 0.09); // 18% of 0.5
    assert.equal(tp1.record.netRealizedPnlInr, 1062.5);

    const slBe = wh.recordTradeLifecycleEvent({
      eventId: 'sl-be-sniper-1',
      tradeId: 'sniper-1',
      eventType: 'SL_MOVED_BE',
      timestampMs: Date.parse('2026-11-19T11:00:01.000Z'),
      symbol: 'BTCUSD',
      side: 'LONG',
      size: 0.002,
      entryPrice: 91250,
      triggerPrice: 91290,
      mode: 'LIVE',
      reason: 'SL Moved to Risk-Free BE',
    });
    assert.equal(slBe.appended, true);

    const fill1 = wh.recordClosedTradeAsLifecycle(
      {
        id: 'delta-fill-998877',
        fillId: '998877',
        orderId: 'ord-5544',
        symbol: 'ETHUSD',
        side: 'SHORT',
        size: 0.25,
        entryPrice: 3150,
        exitPrice: 3110,
        realisedPnl: 10.0,
        pnlPercent: 6.4,
        openedAt: Date.parse('2026-11-19T16:10:00.000Z'),
        closedAt: Date.parse('2026-11-19T16:32:04.000Z'),
        created_at: '2026-11-19T16:32:04.000Z',
        commission: 0.2,
        reason: 'Delta Exchange Fill',
        mode: 'LIVE',
        source: 'DELTA_FILL',
      },
      85
    );
    assert.equal(fill1, true);

    // Repeating same fillId must deduplicate
    const fillDup = wh.recordClosedTradeAsLifecycle(
      {
        id: 'delta-fill-998877-dup',
        fillId: '998877',
        orderId: 'ord-5544',
        symbol: 'ETHUSD',
        side: 'SHORT',
        size: 0.25,
        entryPrice: 3150,
        exitPrice: 3110,
        realisedPnl: 10.0,
        pnlPercent: 6.4,
        openedAt: Date.parse('2026-11-19T16:10:00.000Z'),
        closedAt: Date.parse('2026-11-19T16:32:04.000Z'),
        created_at: '2026-11-19T16:32:04.000Z',
        commission: 0.2,
        reason: 'Delta Exchange Fill',
        mode: 'LIVE',
        source: 'DELTA_FILL',
      },
      85
    );
    assert.equal(fillDup, false);
    assert.equal(wh.loadTradesArchive().length, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

runTest('archives audit events (HOURLY_GOAL, RESCUE, CONDUIT, KILL_SWITCH) and survives server restarts with dedup intact', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltaai-wh-restart-'));
  try {
    const wh1 = createAnalyticsWarehouse(tmpDir);
    assert.equal(
      wh1.recordAuditEvent({
        id: 'audit-rescue-1',
        type: 'RESCUE',
        title: 'Drawdown Rescue Executed',
        description: '50% De-Risk & Re-Anchor on BTCUSD, adjusted BE "$90,400"',
        symbol: 'BTCUSD',
        mode: 'LIVE',
      }).appended,
      true
    );
    assert.equal(
      wh1.recordAuditEvent({
        id: 'audit-kill-1',
        type: 'KILL_SWITCH',
        title: 'Emergency Kill Switch',
        description: 'Flattened all live positions',
        mode: 'LIVE',
      }).appended,
      true
    );
    assert.equal(
      wh1.recordSignal({
        signalId: 'persist-sig-1',
        sourceEngine: 'OPTIONS_LAB:Iron Condor',
        symbol: 'BTCUSDT',
        direction: 'NEUTRAL',
        entryPrice: 91000,
        status: 'APPROVED',
      }).appended,
      true
    );

    // Simulate VM restart / new zip deploy creating a fresh warehouse instance pointing to same directory
    const wh2 = createAnalyticsWarehouse(tmpDir);
    assert.equal(wh2.loadAuditEventsArchive().length, 2);
    assert.equal(wh2.loadLatestUniqueSignals().length, 1);

    // Re-submitting same audit ID or signal after restart must still deduplicate!
    assert.equal(
      wh2.recordAuditEvent({
        id: 'audit-rescue-1',
        type: 'RESCUE',
        title: 'Drawdown Rescue Executed',
        description: 'Duplicate after restart',
      }).appended,
      false
    );
    assert.equal(
      wh2.recordSignal({
        signalId: 'persist-sig-1',
        sourceEngine: 'OPTIONS_LAB:Iron Condor',
        symbol: 'BTCUSDT',
        direction: 'NEUTRAL',
        entryPrice: 91000,
        status: 'APPROVED',
      }).appended,
      false
    );

    // Verify JSON & CSV exports
    const sigCsv = wh2.exportDataset('signals', 'csv');
    assert.equal(sigCsv.count, 1);
    assert.ok(sigCsv.body.includes('signalId,timestamp_utc,timestamp_ist'));
    assert.ok(sigCsv.body.includes('persist-sig-1'));

    const allCsv = wh2.exportDataset('all', 'csv');
    assert.equal(allCsv.count, 3);
    assert.ok(allCsv.body.includes('recordKind,eventId,refId'));
    // Escaped quotes & commas in audit description
    assert.ok(allCsv.body.includes('""$90,400""'));

    const allJson = wh2.exportDataset('all', 'json');
    const parsed = JSON.parse(allJson.body);
    assert.equal(parsed.counts.signals, 1);
    assert.equal(parsed.counts.auditEvents, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log('All Cloud Signal & Trade Telemetry Warehouse unit tests passed!');
