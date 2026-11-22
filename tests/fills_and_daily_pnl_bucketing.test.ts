import assert from 'node:assert/strict';
import {
  normalizeDeltaExchangeFills,
  mergeTradesDeduplicated,
} from '../src/server/deltaFillsNormalizer.ts';
import {
  buildSynchronized30DayPnlSeries,
  formatDateKeyInTimezone,
} from '../src/utils/dailyPnlBucketing.ts';
import type { ClosedTrade, Position } from '../src/types.ts';

function runTests() {
  // 1. Normalize Delta Exchange India /v2/fills across BTCUSD, ETHUSD, SOLUSD, and Option fills
  const rawFills = [
    {
      id: 900101,
      order_id: 'ord-btc-1',
      product_symbol: 'BTCUSD',
      side: 'sell', // closing a LONG
      size: 50,
      price: '91420.5',
      commission: '0.42',
      realized_pnl: '48.25',
      fill_type: 'normal',
      created_at: '2026-11-19T16:32:04Z',
      meta_data: { entry_price: '90455.5' },
    },
    {
      id: 900102,
      order_id: 'ord-eth-1',
      product_symbol: 'ETHUSD',
      side: 'buy', // closing a SHORT
      size: 20,
      price: '3120.0',
      commission: '0.18',
      realized_pnl: '-14.10',
      fill_type: 'normal',
      created_at: '2026-11-19T12:15:00Z',
      meta_data: { avg_entry_price: '3049.5' },
    },
    {
      id: 900103,
      order_id: 'ord-sol-1',
      product_symbol: 'SOLUSD',
      side: 'sell',
      size: 10,
      price: '218.4',
      commission: '0.09',
      meta_data: { pnl: '22.85', entry_price: '216.115' },
      created_at: '2026-11-19T08:45:00Z',
    },
    {
      id: 900104,
      order_id: 'ord-opt-1',
      product_symbol: 'C-BTC-92000-201126',
      product: { symbol: 'C-BTC-92000-201126', contract_type: 'call_options', contract_value: 0.001 },
      side: 'buy',
      size: 15,
      price: '420',
      realized_pnl: '19.50',
      fill_type: 'settlement',
      created_at: '2026-11-19T17:00:00Z',
    },
    // Pure opening fill (no realized_pnl and no close metadata) -> should NOT be treated as closed trade
    {
      id: 900105,
      order_id: 'ord-open-only',
      product_symbol: 'BTCUSD',
      side: 'buy',
      size: 40,
      price: '91000',
      realized_pnl: '0',
      fill_type: 'normal',
      created_at: '2026-11-20T03:00:00Z',
    },
  ];

  const normalized = normalizeDeltaExchangeFills(rawFills);
  assert.equal(normalized.length, 4, 'Should capture all 4 closed perpetual/option fills and ignore pure open fill');

  const btcFill = normalized.find((t) => t.fillId === '900101')!;
  assert.equal(btcFill.symbol, 'BTCUSD');
  assert.equal(btcFill.side, 'LONG');
  assert.equal(btcFill.realisedPnl, 48.25);
  assert.equal(btcFill.created_at, '2026-11-19T16:32:04.000Z');
  assert.equal(btcFill.mode, 'LIVE');

  const ethFill = normalized.find((t) => t.fillId === '900102')!;
  assert.equal(ethFill.side, 'SHORT');
  assert.equal(ethFill.realisedPnl, -14.1);

  const optFill = normalized.find((t) => t.fillId === '900104')!;
  assert.equal(optFill.contractType, 'call_options');
  assert.equal(optFill.realisedPnl, 19.5);

  // 2. Deduplication by fill.id / order_id & preserving journal metadata
  const existingLocalTrades: ClosedTrade[] = [
    {
      id: 'local-ord-btc-1',
      orderId: 'ord-btc-1',
      symbol: 'BTCUSD',
      side: 'LONG',
      size: 50,
      entryPrice: 90455.5,
      exitPrice: 91420.5,
      realisedPnl: 48.0, // slightly stale local estimate
      pnlPercent: 1.0,
      openedAt: Date.parse('2026-11-19T15:00:00Z'),
      closedAt: Date.parse('2026-11-19T16:32:04Z'),
      created_at: '2026-11-19T16:32:04.000Z',
      reason: 'Local Take Profit',
      mode: 'LIVE',
      notes: 'Clean Camarilla H3 breakout',
      sentimentTag: 'PERFECT_EXECUTION',
    },
  ];

  const merged = mergeTradesDeduplicated(existingLocalTrades, normalized);
  assert.equal(merged.length, 4, 'Matching orderId must deduplicate rather than duplicate');
  const mergedBtc = merged.find((t) => t.orderId === 'ord-btc-1')!;
  assert.equal(mergedBtc.realisedPnl, 48.25, 'Exchange fill realized PnL should update local estimate');
  assert.equal(mergedBtc.fillId, '900101');
  assert.equal(mergedBtc.notes, 'Clean Camarilla H3 breakout', 'Must preserve local journal notes');

  // 3. 30-day calendar bucketing: Nov 19 realized fills vs Nov 20 TODAY LIVE floating unrealized PnL
  const nowMs = Date.parse('2026-11-20T04:48:55Z'); // Nov 20 in both UTC and IST (10:18:55 IST)
  const timestampLessLegacyTrade: ClosedTrade = {
    id: 'corrupt-no-ts',
    symbol: 'BTCUSD',
    side: 'LONG',
    size: 10,
    entryPrice: 90000,
    exitPrice: 91000,
    realisedPnl: 999.99,
    pnlPercent: 10,
    openedAt: 0,
    closedAt: 0,
    reason: 'Legacy corrupted record without timestamp',
    mode: 'LIVE',
  };

  const openPositions: Position[] = [
    {
      id: 'pos-1',
      symbol: 'BTCUSD',
      side: 'LONG',
      size: 20,
      entryPrice: 91500,
      markPrice: 90200,
      leverage: 10,
      margin: 180,
      liquidationPrice: 82000,
      unrealisedPnl: -38.12,
      unrealisedPnlPercent: -21.1,
      openedAt: nowMs - 3600_000,
      strategy: 'Live Delta Execution',
      mode: 'LIVE',
    },
    {
      id: 'pos-2',
      symbol: 'ETHUSD',
      side: 'SHORT',
      size: 15,
      entryPrice: 3100,
      markPrice: 3248,
      leverage: 10,
      margin: 120,
      liquidationPrice: 3400,
      unrealisedPnl: -22.26,
      unrealisedPnlPercent: -18.5,
      openedAt: nowMs - 1800_000,
      strategy: 'Live Delta Execution',
      mode: 'LIVE',
    },
  ];

  const seriesIst = buildSynchronized30DayPnlSeries({
    portfolio: {
      initialCapital: 1000,
      dailyPnl: 0,
      unrealisedPnlTotal: -60.38,
      tradesToday: 0,
      winRate: 0,
    },
    history: [...merged, timestampLessLegacyTrade],
    positions: openPositions,
    exchangeRate: 1,
    tradingMode: 'LIVE',
    isLiveApiAuthenticated: true,
    days: 30,
    timezone: 'IST',
    nowMs,
  });

  assert.equal(seriesIst.length, 30);
  const nov19 = seriesIst.find((p) => p.dateKey === '2026-11-19')!;
  const nov20 = seriesIst.find((p) => p.dateKey === '2026-11-20')!;

  assert.ok(nov19, 'Nov 19 cell must exist');
  assert.ok(nov20, 'Nov 20 cell must exist');
  assert.equal(nov19.isToday, false);
  assert.equal(nov20.isToday, true);

  // Nov 19 has 4 closed fills: +48.25, -14.10, +22.85, +19.50 => Net +76.50, 3W / 1L, 75% WR, 0 unrealized
  assert.equal(nov19.tradesCount, 4);
  assert.equal(nov19.wins, 3);
  assert.equal(nov19.losses, 1);
  assert.equal(nov19.winRate, 75);
  assert.equal(nov19.realizedPnl, 76.5);
  assert.equal(nov19.unrealizedPnl, 0, 'Past days must NEVER include unrealized floating PnL');
  assert.equal(nov19.dailyPnl, 76.5);
  assert.equal(nov19.openPositionsCount, 0);

  // Nov 20 (TODAY LIVE) must NOT contain the $999.99 timestamp-less trade and MUST hold strictly the 2P -$60.38 floating PnL
  assert.equal(nov20.tradesCount, 0, 'Timestamp-less trade must NOT be dumped into TODAY');
  assert.equal(nov20.realizedPnl, 0);
  assert.equal(nov20.unrealizedPnl, -60.38, 'TODAY LIVE holds exact floating unrealized PnL');
  assert.equal(nov20.dailyPnl, -60.38);
  assert.equal(nov20.openPositionsCount, 2);

  // 4. IST vs UTC timezone boundary check (2026-11-19T20:00:00Z = Nov 19 UTC, Nov 20 01:30 IST)
  const boundaryMs = Date.parse('2026-11-19T20:00:00Z');
  assert.equal(formatDateKeyInTimezone(boundaryMs, 'UTC'), '2026-11-19');
  assert.equal(formatDateKeyInTimezone(boundaryMs, 'IST'), '2026-11-20');

  console.log('ALL FILLS MERGE & 30-DAY DAILY PNL BUCKETING TESTS PASSED (6/6)');
}

runTests();
