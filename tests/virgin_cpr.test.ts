import assert from 'node:assert/strict';
import {
  computeVirginCprZones,
  findNearestVirginCprMagnet,
  findInsideVirginCprZone,
  evaluateVirginCprConfluence,
} from '../src/utils/camarillaUtils';

const DAY_MS = 24 * 60 * 60 * 1000;
const todayUtcStart = Math.floor(Date.now() / DAY_MS) * DAY_MS;

function makeDailyCandle(daysAgo: number, high: number, low: number, close: number) {
  return {
    time: todayUtcStart - daysAgo * DAY_MS,
    high,
    low,
    close,
  };
}

// 1. Untouched session detection (session.low > cprHigh) & 3-session window
{
  // Day -4 settles CPR around ~68,000 -> P=(68200+67800+68000)/3=68000, BC=68000, TC=68000
  // Day -3 gaps up: low=68500 > 68000 -> VIRGIN CPR! (ageSessions=3 if settled=[D-4, D-3, D-2, D-1])
  // Day -2 stays even higher: low=69200..high=69800 -> never touches Day -3 CPR [68000] OR wait Day -3 high=69000, low=68500, close=68900 => P=68800, BC=68750, TC=68850
  // Day -2: low=69100 > 68850 => untouched! CPR for Day -2 also virgin!
  const daily = [
    makeDailyCandle(4, 68200, 67800, 68000),
    makeDailyCandle(3, 69000, 68500, 68900),
    makeDailyCandle(2, 69800, 69100, 69600),
    makeDailyCandle(1, 70300, 69700, 70100),
  ];

  // Mark price at 70,150 -> well above both Virgin CPRs
  const zones = computeVirginCprZones(daily, 70150, 'BTCUSDT', 3);
  assert.ok(zones.length >= 2, `Expected at least 2 unmitigated Virgin CPR zones, got ${zones.length}`);
  assert.equal(zones[0].status, 'UNMITIGATED');
  assert.equal(zones[0].isVirgin, true);

  const nearestBelow = findNearestVirginCprMagnet(zones, 'BELOW');
  assert.ok(nearestBelow, 'Expected nearest Virgin CPR support floor below live spot');
  assert.equal(nearestBelow!.relation, 'BELOW');
}

// 2. Bearish gap-down Virgin CPR (session.high < cprLow) acting as overhead resistance
{
  const daily = [
    makeDailyCandle(3, 72200, 71600, 72000), // P=71933.33, BC=71900, TC=71966.67 -> [71900, 71966.67]
    makeDailyCandle(2, 71200, 70500, 70700), // high=71200 < 71900 -> VIRGIN!
    makeDailyCandle(1, 70600, 69900, 70200), // stays below [71900, 71966.67] -> still UNMITIGATED
  ];

  const zones = computeVirginCprZones(daily, 70300, 'BTCUSDT', 3);
  const resZone = zones.find((z) => z.cprLow >= 71850);
  assert.ok(resZone, 'Expected bearish overhead Virgin CPR zone');
  assert.equal(resZone!.status, 'UNMITIGATED');
  assert.equal(resZone!.relation, 'ABOVE');
}

// 3. Mitigation lifecycle: subsequent candle closes across [cprLow, cprHigh] -> MITIGATED
{
  const daily = [
    makeDailyCandle(3, 72200, 71600, 72000), // CPR [71900, 71966.67]
    makeDailyCandle(2, 71200, 70500, 70700), // untouched -> Virgin
    makeDailyCandle(1, 72100, 70800, 71940), // enters and closes inside [71900, 71966.67] -> MITIGATED
  ];

  const zones = computeVirginCprZones(daily, 71400, 'BTCUSDT', 3);
  const mitigated = zones.find((z) => z.cprLow >= 71850);
  assert.ok(mitigated, 'Expected Virgin CPR zone record to track mitigation state');
  assert.equal(mitigated!.status, 'MITIGATED');
  assert.equal(findNearestVirginCprMagnet(zones, 'ABOVE')?.cprLow === mitigated!.cprLow, false);
}

// 4. Live price inside Virgin CPR immediately transitions it to MITIGATED
{
  const daily = [
    makeDailyCandle(3, 70200, 69800, 70000), // CPR ~70000
    makeDailyCandle(2, 71200, 70500, 71000), // Virgin below
    makeDailyCandle(1, 71800, 71100, 71500),
  ];
  const zones = computeVirginCprZones(daily, 70000, 'BTCUSDT', 3);
  const target = zones.find((z) => Math.abs(z.pivot - 70000) < 5);
  assert.ok(target);
  assert.equal(target!.status, 'MITIGATED');
}

// 5. Sniper Confluence: +8% conviction boost & TP front-run cap warning
{
  // Build one support floor near spot (0.4% below) and one overhead resistance ceiling in LONG TP path
  const daily = [
    makeDailyCandle(3, 70600, 70200, 70400), // CPR [70400]
    makeDailyCandle(2, 69600, 69100, 69300), // untouched (<70400) => P=69333.33, BC=69350, TC=69316.67 => [69316.67, 69350]
    makeDailyCandle(1, 69950, 69450, 69750), // untouched above 69350, below 70400
  ];
  const markPrice = 69700;
  const zones = computeVirginCprZones(daily, markPrice, 'BTCUSDT', 3);

  // LONG with support floor ~0.5% below AND overhead Virgin CPR ~70,400 directly before TP2 (70,600)
  const conf = evaluateVirginCprConfluence(zones, 'LONG', 69700, 69400, 70100, 70600, markPrice);
  assert.equal(conf.hasConfluence, true, 'Expected +8% Virgin CPR support floor confluence');
  assert.equal(conf.convictionBoostPct, 8);
  assert.equal(conf.hasWarning, true, 'Expected warning for blocking Virgin CPR at 70,400 before TP2=70,600');
  assert.ok(conf.suggestedTpCap && conf.suggestedTpCap < 70400 && conf.suggestedTpCap > 69700);
}

// 6. Inside Virgin CPR detection (handles today's live MITIGATED flip, entryPrice match, prior-day exclusion, and zero-width CPRs)
{
  const daily = [
    makeDailyCandle(3, 70200, 69800, 70000), // Zero-width CPR at 70000 (P=70000, BC=70000, TC=70000)
    makeDailyCandle(2, 71200, 70500, 71000), // Virgin below (low 70500 > 70000)
    makeDailyCandle(1, 71800, 71100, 71500),
  ];

  // 6a. Live mark price enters Virgin CPR today -> flagged even though live status transitions to MITIGATED today
  const liveZones = computeVirginCprZones(daily, 70000, 'BTCUSDT', 3);
  const insideLive = findInsideVirginCprZone(liveZones, 71300, 70000, todayUtcStart + 1000);
  assert.ok(insideLive, 'Expected inside match when live mark price enters today-unmitigated Virgin CPR');
  assert.ok(Math.abs(insideLive!.pivot - 70000) < 5);

  // 6b. Signal setup entryPrice inside Virgin CPR (within 2.5 bps tolerance for zero-width CPR = ±17.5 around 70000)
  const unmitigatedZones = computeVirginCprZones(daily, 71400, 'BTCUSDT', 3);
  const insideEntry = findInsideVirginCprZone(unmitigatedZones, 70010, 71400, todayUtcStart + 1000);
  assert.ok(insideEntry, 'Expected inside match when setup entryPrice falls within zero-width Virgin CPR tolerance');

  // 6c. Outside both entry and mark -> null
  const outside = findInsideVirginCprZone(unmitigatedZones, 71350, 71400, todayUtcStart + 1000);
  assert.equal(outside, null, 'Expected null when entryPrice and markPrice are outside all Virgin CPR zones');

  // 6d. Zone mitigated on a prior closed UTC day (mitigatedAtMs < todayUtcStart) -> excluded
  const priorMitigatedDaily = [
    makeDailyCandle(3, 72200, 71600, 72000), // CPR [71900, 71966.67]
    makeDailyCandle(2, 71200, 70500, 70700), // untouched -> Virgin
    makeDailyCandle(1, 72100, 70800, 71940), // mitigated yesterday
  ];
  const priorZones = computeVirginCprZones(priorMitigatedDaily, 71930, 'BTCUSDT', 3);
  const excludedPrior = findInsideVirginCprZone(priorZones, 71930, 71930, todayUtcStart + 1000);
  assert.equal(excludedPrior, null, 'Expected null when Virgin CPR was already mitigated on a prior closed day');
}

console.log('ALL_VIRGIN_CPR_TESTS_PASSED');
