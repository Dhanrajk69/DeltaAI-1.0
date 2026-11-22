import assert from 'node:assert/strict';
import {
  buildPerpetualRescueRecommendation,
  buildRescuePositionCircuitKey,
  buildRescueTradeKey,
  computeAdjustedBreakEvenProjection,
  computePositionDrawdownRMultiple,
  enforceMaxEquityRiskContracts,
  estimateRescueActionRequiredMarginUsd,
  evaluate4hTrendValidity,
  evaluate5mTrendFlipCondition,
  evaluateRescueCircuitBreaker,
  getSupportedRescuePerpSpec,
  isEligibleRescuePerpSymbol,
  NOTIFICATION_DEDUP_WINDOW_MS,
  parseInsufficientMarginDetails,
  RESCUE_BLOCK_COOLDOWN_MS,
  selectNearestReAnchorLiquidityZone,
  shouldSuppressDuplicateNotification,
} from '../src/utils/drawdownRescueUtils.ts';
import type { PerpetualRescueAdjustmentRecord } from '../src/types.ts';

let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ PASS: ${name}`);
}

console.log('RUNNING PERPETUAL DRAWDOWN RESCUE ENGINE TESTS');

test('Symbol eligibility allows BTCUSD/ETHUSD/SOLUSD and USDT perpetuals, rejects options and unsupported assets', () => {
  assert.equal(isEligibleRescuePerpSymbol('BTCUSD'), true);
  assert.equal(isEligibleRescuePerpSymbol('btcusdt'), true);
  assert.equal(isEligibleRescuePerpSymbol('ETHUSD'), true);
  assert.equal(isEligibleRescuePerpSymbol('ETHUSDT'), true);
  assert.equal(isEligibleRescuePerpSymbol('SOLUSD'), true);
  assert.equal(isEligibleRescuePerpSymbol('SOLUSDT'), true);

  // Reject options & unsupported symbols
  assert.equal(isEligibleRescuePerpSymbol('C-BTC-90000-191126'), false);
  assert.equal(isEligibleRescuePerpSymbol('P-ETH-3200-191126'), false);
  assert.equal(isEligibleRescuePerpSymbol('XRPUSD'), false);
  assert.equal(isEligibleRescuePerpSymbol(''), false);

  assert.equal(getSupportedRescuePerpSpec('BTCUSDT')?.contractValue, 0.001);
  assert.equal(getSupportedRescuePerpSpec('ETHUSD')?.contractValue, 0.01);
  assert.equal(getSupportedRescuePerpSpec('SOLUSD')?.contractValue, 1);

  assert.equal(
    buildRescueTradeKey({ mode: 'LIVE', tradeId: 't-101', symbol: 'BTCUSDT' }),
    'LIVE:BTCUSD:t-101'
  );
});

test('Computes -0.50R drawdown trigger accurately for LONG and SHORT positions', () => {
  // LONG: Entry 65000, SL 64000 (1R = 1000). At 64500 => -0.50R
  const longHalfR = computePositionDrawdownRMultiple({
    side: 'LONG',
    entryPrice: 65000,
    stopLoss: 64000,
    markPrice: 64500,
  });
  assert.equal(longHalfR.rMultiple, -0.5);
  assert.equal(longHalfR.riskDistance, 1000);

  // LONG in mild drawdown: -0.25R should be > -0.50R
  const longMild = computePositionDrawdownRMultiple({
    side: 'LONG',
    entryPrice: 65000,
    stopLoss: 64000,
    markPrice: 64750,
  });
  assert.equal(longMild.rMultiple, -0.25);

  // SHORT: Entry 3000, SL 3100 (1R = 100). At 3060 => -0.60R
  const shortDrawdown = computePositionDrawdownRMultiple({
    side: 'SHORT',
    entryPrice: 3000,
    stopLoss: 3100,
    markPrice: 3060,
  });
  assert.equal(shortDrawdown.rMultiple, -0.6);
});

test('Enforces strict <= 2% max equity risk contract cap', () => {
  // Equity = $1,000 => max allowed risk = $20.
  // Entry $65,000, SL $64,000 => SL dist = $1,000 * 0.001 (BTC contractValue) = $1.00 risk/contract.
  // Requesting 50 contracts ($50 risk) must clamp to 20 contracts ($20 risk = 2%).
  const capped = enforceMaxEquityRiskContracts({
    totalEquityUsd: 1000,
    entryPrice: 65000,
    stopLoss: 64000,
    requestedContracts: 50,
    contractValue: 0.001,
  });
  assert.equal(capped.safeContracts, 20);
  assert.equal(capped.maxAllowedRiskUsd, 20);
  assert.equal(capped.riskUsd, 20);
  assert.equal(capped.equityRiskPct, 2);
  assert.equal(capped.within2PctRisk, true);

  // Requesting 4 contracts ($4 risk = 0.4%) keeps 4 contracts.
  const withinLimit = enforceMaxEquityRiskContracts({
    totalEquityUsd: 1000,
    entryPrice: 65000,
    stopLoss: 64000,
    requestedContracts: 4,
    contractValue: 0.001,
  });
  assert.equal(withinLimit.safeContracts, 4);
  assert.equal(withinLimit.equityRiskPct, 0.4);
  assert.equal(withinLimit.within2PctRisk, true);
});

test('Validates 4h trend and selects passive nearest L3/L4 or 0.618 Golden Pocket re-anchor zone', () => {
  const uptrendCandles = [
    { open: 63000, high: 63500, low: 62800, close: 63400 },
    { open: 63400, high: 64100, low: 63300, close: 64000 },
    { open: 64000, high: 64700, low: 63900, close: 64600 },
    { open: 64600, high: 65000, low: 64400, close: 64700 },
    { open: 64700, high: 65100, low: 64350, close: 64500 },
  ];
  const validLong = evaluate4hTrendValidity({
    candles4h: uptrendCandles,
    side: 'LONG',
    markPrice: 64500,
  });
  assert.equal(validLong.isValid, true);

  const downtrendCandles = [
    { open: 66000, high: 66100, low: 65400, close: 65500 },
    { open: 65500, high: 65600, low: 64800, close: 64900 },
    { open: 64900, high: 65000, low: 64000, close: 64100 },
    { open: 64100, high: 64200, low: 63300, close: 63400 },
  ];
  const invalidLong = evaluate4hTrendValidity({
    candles4h: downtrendCandles,
    side: 'LONG',
    markPrice: 63400,
  });
  assert.equal(invalidLong.isValid, false);

  // Re-anchor must strictly stay on passive side below markPrice for LONG
  const zone = selectNearestReAnchorLiquidityZone({
    side: 'LONG',
    markPrice: 64500,
    camarilla: { l3: 64250, l4: 63800, h3: 65200, h4: 65600 },
    fibonacci: { gp618: 64120 },
  });
  assert.equal(zone.price, 64250);
  assert.equal(zone.label, 'Camarilla L3');

  // If L3 is above mark, it must skip L3 and pick fib618 (64050) or L4 (63800) passively
  const zonePassiveOnly = selectNearestReAnchorLiquidityZone({
    side: 'LONG',
    markPrice: 64200,
    camarilla: { l3: 64350, l4: 63800 },
    fibonacci: { fib618: 64050 },
  });
  assert.equal(zonePassiveOnly.price, 64050);
  assert.equal(zonePassiveOnly.label, '0.618 Golden Pocket');
});

test('Requires closed 5m candle beyond opposite H4/L4 AND AI Matrix >= 80% for Trend-Flip Reverse', () => {
  // Forming last bar (index length-1) is ignored; previous closed bar (index length-2) is checked.
  const candlesBlockedByUnclosedBar = [
    { open: 64400, high: 64450, low: 64150, close: 64200 }, // previous closed 5m close > L4 (64000)
    { open: 64200, high: 64210, low: 63850, close: 63900 }, // current forming bar dipped below L4
  ];
  const flipNotClosedYet = evaluate5mTrendFlipCondition({
    candles5m: candlesBlockedByUnclosedBar,
    side: 'LONG',
    camarilla: { l4: 64000, h4: 65500 },
    aiMatrixPct: 86,
    markPrice: 63900,
  });
  assert.equal(flipNotClosedYet.candleClosedBeyondOpposite, false);
  assert.equal(flipNotClosedYet.ready, false);

  // Now closed 5m bar IS <= L4, but AI Matrix is 75% (< 80%)
  const candlesClosedBelowL4 = [
    { open: 64200, high: 64220, low: 63880, close: 63920 }, // closed beyond L4 64000
    { open: 63920, high: 63950, low: 63850, close: 63900 },
  ];
  const lowAiFlip = evaluate5mTrendFlipCondition({
    candles5m: candlesClosedBelowL4,
    side: 'LONG',
    camarilla: { l4: 64000, h4: 65500 },
    aiMatrixPct: 75,
    markPrice: 63900,
  });
  assert.equal(lowAiFlip.candleClosedBeyondOpposite, true);
  assert.equal(lowAiFlip.aiMatrixMet, false);
  assert.equal(lowAiFlip.ready, false);

  // Closed 5m beyond L4 AND AI Matrix >= 80% => ready!
  const readyFlip = evaluate5mTrendFlipCondition({
    candles5m: candlesClosedBelowL4,
    side: 'LONG',
    camarilla: { l4: 64000, h4: 65500 },
    aiMatrixPct: 84,
    markPrice: 63900,
  });
  assert.equal(readyFlip.ready, true);
  assert.equal(readyFlip.newDirection, 'SHORT');
});

test('Computes Adjusted Break-Even projections across De-Risk, Options Hedge Overlay, and Flip', () => {
  const proj = computeAdjustedBreakEvenProjection({
    side: 'LONG',
    entryPrice: 65000,
    markPrice: 64500, // lossPerCoin = 500
    reAnchorPrice: 64000,
    optionCreditPerCoin: 300,
    priceDecimals: 2,
  });
  // De-risk 50% at 64500 & re-anchor 50% at 64000: avg = 64500 + 250 = 64750
  assert.equal(proj.deRiskImmediateBe, 65500);
  assert.equal(proj.deRiskReAnchoredBe, 64750);
  // Options credit 300 lowers LONG break-even from 65000 -> 64700
  assert.equal(proj.optionsHedgeBe, 64700);
  // Flip recovery from 64500 for 500 lossPerCoin -> 64000
  assert.equal(proj.flipRecoveryTargetPrice, 64000);
});

test('Surfaces rescue recommendation at <= -0.50R and locks all actions once adjustmentCount === 1', () => {
  const baseCandles4h = [
    { open: 63500, high: 64000, low: 63400, close: 63900 },
    { open: 63900, high: 64500, low: 63800, close: 64400 },
    { open: 64400, high: 64900, low: 64300, close: 64800 },
    { open: 64800, high: 65100, low: 64350, close: 64500 },
  ];
  const baseCandles5m = [
    { open: 64600, high: 64650, low: 63900, close: 63950 },
    { open: 63950, high: 64550, low: 63920, close: 64500 },
  ];

  // At -0.20R (mark 64800), shouldSurface = false
  const mildRec = buildPerpetualRescueRecommendation({
    mode: 'PAPER',
    tradeId: 'trade-1',
    symbol: 'BTCUSD',
    side: 'LONG',
    entryPrice: 65000,
    markPrice: 64800,
    stopLoss: 64000,
    lotSize: 0.01,
    contracts: 10,
    unrealizedPnlUsd: -2.0,
    usdInrRate: 85,
    totalEquityUsd: 1000,
    candles4h: baseCandles4h,
    candles5m: baseCandles5m,
    camarilla: { l3: 64200, l4: 64000, h3: 65300, h4: 65600 },
    fibonacci: { gp618: 64150 },
    aiMatrixPct: 82,
  });
  assert.ok(mildRec);
  assert.equal(mildRec.shouldSurface, false);

  // At -0.50R (mark 64500), shouldSurface = true, 1:1 matched contracts = 10
  const activeRec = buildPerpetualRescueRecommendation({
    mode: 'LIVE',
    tradeId: 'trade-1',
    symbol: 'BTCUSD',
    side: 'LONG',
    entryPrice: 65000,
    markPrice: 64500,
    stopLoss: 64000,
    lotSize: 0.01,
    contracts: 10,
    unrealizedPnlUsd: -5.0,
    usdInrRate: 85,
    totalEquityUsd: 1000,
    candles4h: baseCandles4h,
    candles5m: baseCandles5m,
    camarilla: { l3: 64200, l4: 64000, h3: 65300, h4: 65600 },
    fibonacci: { fib618: 64150 },
    aiMatrixPct: 82,
    optionQuote: {
      symbol: 'C-BTC-65400-191126',
      productId: 901234,
      optionType: 'CALL',
      action: 'SELL',
      strike: 65400,
      expiryCode: '191126',
      settlementTime: '2026-11-19T12:00:00Z',
      markPrice: 280,
      contractValue: 0.001,
      contracts: 10,
      estimatedPremiumCreditUsd: 2.8,
    },
  });
  assert.ok(activeRec);
  assert.equal(activeRec.shouldSurface, true);
  assert.equal(activeRec.isLocked, false);
  assert.equal(activeRec.projectedDeRiskReAnchor.enabled, true);
  assert.equal(activeRec.projectedOptionsHedge.enabled, true);
  assert.equal(activeRec.projectedOptionsHedge.matchedContracts, 10);
  assert.equal(activeRec.projectedTrendFlip.enabled, true);
  assert.equal(activeRec.projectedOptionsHedge.projectedAdjustedBe, 64720);

  // With executedRecord present => Single-Adjustment Lock (1/1 Used), all 3 actions disabled
  const lockedRecord: PerpetualRescueAdjustmentRecord = {
    tradeKey: 'LIVE:BTCUSD:trade-1',
    tradeId: 'trade-1',
    symbol: 'BTCUSD',
    canonicalSymbol: 'BTCUSDT',
    mode: 'LIVE',
    side: 'LONG',
    action: 'OPTIONS_HEDGE_OVERLAY',
    adjustmentCount: 1,
    executedAt: Date.now(),
    triggerRMultiple: -0.5,
    unrealizedPnlAtTrigger: -5.0,
    originalEntryPrice: 65000,
    adjustedBreakEvenPrice: 64720,
    equityRiskPct: 1,
    contractsMatched: 10,
    telegramSent: true,
    details: {
      optionSymbol: 'C-BTC-65400-191126',
      optionSide: 'SELL',
      optionPremiumPerCoin: 280,
      optionCreditUsd: 2.8,
    },
  };

  const lockedRec = buildPerpetualRescueRecommendation({
    mode: 'LIVE',
    tradeId: 'trade-1',
    symbol: 'BTCUSD',
    side: 'LONG',
    entryPrice: 65000,
    markPrice: 64400,
    stopLoss: 64000,
    lotSize: 0.01,
    contracts: 10,
    unrealizedPnlUsd: -6.0,
    usdInrRate: 85,
    totalEquityUsd: 1000,
    candles4h: baseCandles4h,
    candles5m: baseCandles5m,
    camarilla: { l3: 64200, l4: 64000, h3: 65300, h4: 65600 },
    fibonacci: { fib618: 64150 },
    aiMatrixPct: 85,
    executedRecord: lockedRecord,
  });
  assert.ok(lockedRec);
  assert.equal(lockedRec.shouldSurface, true);
  assert.equal(lockedRec.isLocked, true);
  assert.equal(lockedRec.adjustmentCount, 1);
  assert.equal(lockedRec.adjustedBreakEvenPrice, 64720);
  assert.equal(lockedRec.projectedDeRiskReAnchor.enabled, false);
  assert.equal(lockedRec.projectedOptionsHedge.enabled, false);
  assert.equal(lockedRec.projectedTrendFlip.enabled, false);
});

test('Circuit-breaker latches per ${symbol}_${entryPrice}_${side} for 15m on insufficient_margin and unlocks on margin recovery', () => {
  const key = buildRescuePositionCircuitKey('BTCUSDT', 65000.5, 'LONG');
  assert.equal(key, 'BTCUSD_65000.5_LONG');

  const t0 = 1_700_000_000_000;
  const blockedEntry = {
    positionKey: key,
    status: 'BLOCKED' as const,
    action: 'OPTIONS_HEDGE_OVERLAY' as const,
    reason: 'insufficient_margin',
    errorCode: 'insufficient_margin',
    blockedAt: t0,
    cooldownUntil: t0 + RESCUE_BLOCK_COOLDOWN_MS,
    availableBalanceAtBlock: 12.0,
    requiredAdditionalBalance: 25.0,
    targetAvailableBalanceToUnlock: 37.0,
  };

  // Immediately after rejection: blocked
  const stillBlocked = evaluateRescueCircuitBreaker({
    entry: blockedEntry,
    currentAvailableBalance: 12.0,
    now: t0 + 60_000,
  });
  assert.equal(stillBlocked.isBlocked, true);
  assert.equal(stillBlocked.unlockedByMarginRecovery, false);

  // Small balance increase still below required_additional_balance: stays blocked
  const partialIncrease = evaluateRescueCircuitBreaker({
    entry: blockedEntry,
    currentAvailableBalance: 25.0,
    now: t0 + 120_000,
  });
  assert.equal(partialIncrease.isBlocked, true);

  // Wallet balance rises above availableBalanceAtBlock + required_additional_balance ($37): unlocks early
  const marginRecovered = evaluateRescueCircuitBreaker({
    entry: blockedEntry,
    currentAvailableBalance: 40.0,
    now: t0 + 120_000,
  });
  assert.equal(marginRecovered.isBlocked, false);
  assert.equal(marginRecovered.unlockedByMarginRecovery, true);

  // After 15-minute cooldown expires: unlocks even if balance unchanged
  const cooldownExpired = evaluateRescueCircuitBreaker({
    entry: blockedEntry,
    currentAvailableBalance: 12.0,
    now: t0 + RESCUE_BLOCK_COOLDOWN_MS + 1,
  });
  assert.equal(cooldownExpired.isBlocked, false);

  // Executed / Fallback De-Risk entries stay permanently latched even after 15 minutes
  const executedLatch = evaluateRescueCircuitBreaker({
    entry: { ...blockedEntry, status: 'FALLBACK_DERISK_EXECUTED' },
    currentAvailableBalance: 500.0,
    now: t0 + RESCUE_BLOCK_COOLDOWN_MS * 4,
  });
  assert.equal(executedLatch.isBlocked, true);
});

test('Parses Delta Exchange insufficient_margin errors and estimates pre-check margin + reduce_only 50% fallback', () => {
  const parsedFromString = parseInsufficientMarginDetails(
    new Error('insufficient_margin ({"required_additional_balance":"18.75","available_balance":"4.20"})')
  );
  assert.equal(parsedFromString.isInsufficientMargin, true);
  assert.equal(parsedFromString.errorCode, 'insufficient_margin');
  assert.equal(parsedFromString.requiredAdditionalBalance, 18.75);

  const structuredErr: any = new Error('Order rejected');
  structuredErr.code = 'insufficient_margin';
  structuredErr.requiredAdditionalBalance = 32.5;
  const parsedStructured = parseInsufficientMarginDetails(structuredErr);
  assert.equal(parsedStructured.isInsufficientMargin, true);
  assert.equal(parsedStructured.requiredAdditionalBalance, 32.5);

  const recMulti = buildPerpetualRescueRecommendation({
    mode: 'LIVE',
    tradeId: 't-multi',
    symbol: 'BTCUSD',
    side: 'LONG',
    entryPrice: 65000,
    markPrice: 64400,
    stopLoss: 64000,
    lotSize: 0.004,
    contracts: 4,
    unrealizedPnlUsd: -2.4,
    usdInrRate: 85,
    totalEquityUsd: 1000,
    candles4h: [
      { open: 63500, high: 64000, low: 63400, close: 63900 },
      { open: 63900, high: 64500, low: 63800, close: 64400 },
      { open: 64400, high: 64900, low: 64300, close: 64800 },
      { open: 64800, high: 65100, low: 64350, close: 64500 },
    ],
    candles5m: [
      { open: 64600, high: 64650, low: 63900, close: 63950 },
      { open: 63950, high: 64550, low: 63920, close: 64400 },
    ],
    camarilla: { l3: 64200, l4: 64000, h3: 65300, h4: 65600 },
    aiMatrixPct: 82,
  })!;

  const optMargin = estimateRescueActionRequiredMarginUsd({
    actionType: 'OPTIONS_HEDGE_OVERLAY',
    recommendation: recMulti,
    leverage: 20,
  });
  assert.ok(optMargin.netAdditionalMarginNeededUsd > 0);
  assert.equal(optMargin.canFallbackToReduceOnly50, true);
  assert.equal(optMargin.fallbackCloseContracts, 2);

  // Single-contract position cannot split 50% without closing 100%
  const recSingle = { ...recMulti, contracts: 1, lotSize: 0.001 };
  const singleMargin = estimateRescueActionRequiredMarginUsd({
    actionType: 'OPTIONS_HEDGE_OVERLAY',
    recommendation: recSingle,
    leverage: 20,
  });
  assert.equal(singleMargin.canFallbackToReduceOnly50, false);
});

test('Deduplicates consecutive Drawdown Rescue Blocked / insufficient_margin notifications within 5-minute window', () => {
  const recentMap = new Map<string, number>();
  const t0 = 1_700_000_000_000;

  // First alert allowed
  assert.equal(
    shouldSuppressDuplicateNotification({
      recentMap,
      title: 'Drawdown Rescue Blocked',
      message: 'insufficient_margin ({"required_additional_balance":"14.21"})',
      type: 'RISK',
      now: t0,
    }),
    false
  );

  // Identical repeat 5s later suppressed
  assert.equal(
    shouldSuppressDuplicateNotification({
      recentMap,
      title: 'Drawdown Rescue Blocked',
      message: 'insufficient_margin ({"required_additional_balance":"14.21"})',
      type: 'RISK',
      now: t0 + 5_000,
    }),
    true
  );

  // Slight numeric fluctuation on required_additional_balance 60s later STILL suppressed
  assert.equal(
    shouldSuppressDuplicateNotification({
      recentMap,
      title: 'Drawdown Rescue Blocked',
      message: 'insufficient_margin ({"required_additional_balance":"14.38"})',
      type: 'RISK',
      now: t0 + 60_000,
    }),
    true
  );

  // Different alert title is NOT suppressed
  assert.equal(
    shouldSuppressDuplicateNotification({
      recentMap,
      title: 'TP1 Hit · SL Moved to Breakeven',
      message: 'BTCUSD reached TP1',
      type: 'TRADE',
      now: t0 + 65_000,
    }),
    false
  );

  // After 5-minute window elapses, alert is allowed again
  assert.equal(
    shouldSuppressDuplicateNotification({
      recentMap,
      title: 'Drawdown Rescue Blocked',
      message: 'insufficient_margin ({"required_additional_balance":"14.38"})',
      type: 'RISK',
      now: t0 + NOTIFICATION_DEDUP_WINDOW_MS + 1,
    }),
    false
  );
});

console.log(`DRAWDOWN RESCUE TEST SUMMARY: ${passed}/${passed} TESTS PASSED`);
