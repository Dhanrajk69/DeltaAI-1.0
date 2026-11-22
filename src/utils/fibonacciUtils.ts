import { MarketTicker, CamarillaLevels } from '../types';
import { formatCamarillaPrice } from './camarillaUtils';
import { getDailySessionAnchor, DailySessionAnchor } from './dailyAnchorUtils';

export interface FibonacciLevels {
  swingHigh: number;      // PDH
  swingLow: number;       // PDL
  range: number;          // Delta swing
  fib236: number;         // 23.6%
  fib382: number;         // 38.2%
  fib500: number;         // 50.0% Equilibrium
  fib618: number;         // 61.8% Golden Pocket lower
  fib650: number;         // 65.0% Golden Pocket upper / Macro OTE
  fib786: number;         // 78.6%
  ext127Bull: number;     // 127.2% Bullish Extension
  ext161Bull: number;     // 161.8% Bullish Expansion
  ext127Bear: number;     // 127.2% Bearish Extension
  ext161Bear: number;     // 161.8% Bearish Expansion
  // Dynamic external expansions beyond PDH / PDL:
  ext1236Upside: number;  // +1.236 Ext
  ext1382Upside: number;  // +1.382 Ext
  ext1500Upside: number;  // +1.500 EQ Exp
  ext1618Upside: number;  // +1.618 GP Exp
  ext2000Upside: number;  // +2.000 Target
  ext0236Downside: number;// -0.236 Ext
  ext0382Downside: number;// -0.382 Ext
  ext0500Downside: number;// -0.500 EQ Exp
  ext0618Downside: number;// -0.618 GP Exp
  ext1000Downside: number;// -1.000 Target
  isExpansionMode: boolean;
  expansionDirection: 'UPSIDE' | 'DOWNSIDE' | 'NONE';
  activeZoneLabel: string;
  isBullish: boolean;
  base000: number;        // 0.0 Base (PDH if Bullish, PDL if Bearish)
  base100: number;        // 1.0 (PDL if Bullish, PDH if Bearish)
}

export interface FibCamarillaConfluence {
  hasConfluence: boolean;
  status: 'PASS' | 'ALIGNING' | 'NEUTRAL';
  matchedFibLevel: string;
  matchedFibPrice: number;
  matchedCamarillaLevel: string;
  matchedCamarillaPrice: number;
  deltaPercent: number;
  description: string;
  step3Confluence?: string;
  step4Confluence?: string;
}

/**
 * Computes Daily Prior-Day Fibonacci Swing Levels from yesterday's session High and Low.
 * Dynamically inverts orientation based on the active trend bias (Bullish vs. Bearish).
 */
export function computeDailyFibonacciLevels(
  market: MarketTicker | undefined,
  currentPrice?: number,
  candles?: any[],
  direction?: 'LONG' | 'SHORT',
  providedAnchor?: DailySessionAnchor
): FibonacciLevels {
  const mark = currentPrice || (market?.markPrice && market.markPrice > 0 ? market.markPrice : 81702.5);
  const anchor = providedAnchor || getDailySessionAnchor(market, mark, candles);

  const highPrev = anchor.prevHigh;
  const lowPrev = anchor.prevLow;
  const deltaSwing = anchor.range;

  // Determine active regime orientation:
  const isBull = direction ? direction === 'LONG' : (market?.change24h ?? 0) >= 0;

  let fib000: number;
  let fib236: number;
  let fib382: number;
  let fib500: number;
  let fib618: number;
  let fib650: number;
  let fib786: number;
  let fib100: number;

  if (isBull) {
    // Bullish Regime: Swing Low -> Swing High (Retracements project DOWNWARD from PDH 0.0 Base)
    fib000 = formatCamarillaPrice(highPrev, mark);                          // 0.0 Base (PDH)
    fib236 = formatCamarillaPrice(highPrev - 0.236 * deltaSwing, mark);     // 23.6%
    fib382 = formatCamarillaPrice(highPrev - 0.382 * deltaSwing, mark);     // 38.2%
    fib500 = formatCamarillaPrice(highPrev - 0.500 * deltaSwing, mark);     // 50.0% Equilibrium
    fib618 = formatCamarillaPrice(highPrev - 0.618 * deltaSwing, mark);     // 61.8% Golden Pocket Lower
    fib650 = formatCamarillaPrice(highPrev - 0.650 * deltaSwing, mark);     // 65.0% Golden Pocket Upper
    fib786 = formatCamarillaPrice(highPrev - 0.786 * deltaSwing, mark);     // 78.6%
    fib100 = formatCamarillaPrice(lowPrev, mark);                           // 1.000 / PDL Floor
  } else {
    // Bearish Regime: Swing High -> Swing Low (Retracements project UPWARD from PDL 0.0 Base)
    fib000 = formatCamarillaPrice(lowPrev, mark);                           // 0.0 Base (PDL)
    fib236 = formatCamarillaPrice(lowPrev + 0.236 * deltaSwing, mark);      // 23.6%
    fib382 = formatCamarillaPrice(lowPrev + 0.382 * deltaSwing, mark);      // 38.2%
    fib500 = formatCamarillaPrice(lowPrev + 0.500 * deltaSwing, mark);      // 50.0% Equilibrium
    fib618 = formatCamarillaPrice(lowPrev + 0.618 * deltaSwing, mark);      // 61.8% Golden Pocket Lower
    fib650 = formatCamarillaPrice(lowPrev + 0.650 * deltaSwing, mark);      // 65.0% Golden Pocket Upper
    fib786 = formatCamarillaPrice(lowPrev + 0.786 * deltaSwing, mark);      // 78.6%
    fib100 = formatCamarillaPrice(highPrev, mark);                          // 1.000 / PDH Ceiling
  }

  // Impulse Extension Levels (Breakout targets):
  const ext127Bull = formatCamarillaPrice(highPrev + 0.272 * deltaSwing, mark); // 127.2% Bullish Ext
  const ext161Bull = formatCamarillaPrice(highPrev + 0.618 * deltaSwing, mark); // 161.8% Bullish Exp
  const ext127Bear = formatCamarillaPrice(lowPrev - 0.272 * deltaSwing, mark);  // 127.2% Bearish Ext
  const ext161Bear = formatCamarillaPrice(lowPrev - 0.618 * deltaSwing, mark);  // 161.8% Bearish Exp

  // Dynamic External Expansion Levels (P > PDH or P < PDL):
  const ext1236Upside = formatCamarillaPrice(highPrev + 0.236 * deltaSwing, mark);
  const ext1382Upside = formatCamarillaPrice(highPrev + 0.382 * deltaSwing, mark);
  const ext1500Upside = formatCamarillaPrice(highPrev + 0.500 * deltaSwing, mark);
  const ext1618Upside = formatCamarillaPrice(highPrev + 0.618 * deltaSwing, mark);
  const ext2000Upside = formatCamarillaPrice(highPrev + 1.000 * deltaSwing, mark);

  const ext0236Downside = formatCamarillaPrice(lowPrev - 0.236 * deltaSwing, mark);
  const ext0382Downside = formatCamarillaPrice(lowPrev - 0.382 * deltaSwing, mark);
  const ext0500Downside = formatCamarillaPrice(lowPrev - 0.500 * deltaSwing, mark);
  const ext0618Downside = formatCamarillaPrice(lowPrev - 0.618 * deltaSwing, mark);
  const ext1000Downside = formatCamarillaPrice(lowPrev - 1.000 * deltaSwing, mark);

  const isExpansionMode = mark > highPrev || mark < lowPrev;
  const expansionDirection: 'UPSIDE' | 'DOWNSIDE' | 'NONE' = mark > highPrev
    ? 'UPSIDE'
    : mark < lowPrev
    ? 'DOWNSIDE'
    : 'NONE';

  // Active Zone detection relative to current price & expansion targets:
  let activeZoneLabel = 'FIB STATUS: Equilibrium Zone';
  if (mark > highPrev) {
    if (mark >= ext1618Upside) {
      activeZoneLabel = `⚡ DISCOVERY REGIME: +1.618 GP EXPANSION ($${ext1618Upside.toLocaleString(undefined, { minimumFractionDigits: 2 })})`;
    } else if (mark >= ext1500Upside) {
      activeZoneLabel = `⚡ DISCOVERY REGIME: +1.500 EQ EXPANSION ($${ext1500Upside.toLocaleString(undefined, { minimumFractionDigits: 2 })})`;
    } else if (mark >= ext1382Upside) {
      activeZoneLabel = `⚡ DISCOVERY REGIME: +1.382 UPSIDE EXTENSION ($${ext1382Upside.toLocaleString(undefined, { minimumFractionDigits: 2 })})`;
    } else {
      activeZoneLabel = `⚡ DISCOVERY REGIME: +1.236 UPSIDE EXTENSION ($${ext1236Upside.toLocaleString(undefined, { minimumFractionDigits: 2 })})`;
    }
  } else if (mark < lowPrev) {
    if (mark <= ext0618Downside) {
      activeZoneLabel = `⚡ CASCADE REGIME: -0.618 GP EXPANSION ($${ext0618Downside.toLocaleString(undefined, { minimumFractionDigits: 2 })})`;
    } else if (mark <= ext0500Downside) {
      activeZoneLabel = `⚡ CASCADE REGIME: -0.500 DOWNSIDE EXTENSION ($${ext0500Downside.toLocaleString(undefined, { minimumFractionDigits: 2 })})`;
    } else if (mark <= ext0382Downside) {
      activeZoneLabel = `⚡ CASCADE REGIME: -0.382 DOWNSIDE EXTENSION ($${ext0382Downside.toLocaleString(undefined, { minimumFractionDigits: 2 })})`;
    } else {
      activeZoneLabel = `⚡ CASCADE REGIME: -0.236 DOWNSIDE EXTENSION ($${ext0236Downside.toLocaleString(undefined, { minimumFractionDigits: 2 })})`;
    }
  } else if (isBull) {
    if (mark >= fib236) activeZoneLabel = 'FIB STATUS: Bullish Shallow Pullback (0.0 PDH → 23.6%)';
    else if (mark >= fib382) activeZoneLabel = 'FIB STATUS: Bullish Dip Buying Zone (23.6% → 38.2%)';
    else if (mark >= fib500) activeZoneLabel = 'FIB STATUS: Equilibrium Discount Zone (38.2% → 50.0% EQ)';
    else if (mark >= fib650) activeZoneLabel = 'FIB STATUS: ACCUMULATION ZONE (61.8% - 65.0% Golden Pocket OTE)';
    else if (mark >= fib786) activeZoneLabel = 'FIB STATUS: Deep Discount Zone (65.0% → 78.6%)';
    else activeZoneLabel = 'FIB STATUS: Key Support Floor Test (78.6% → 1.0 PDL)';
  } else {
    if (mark <= fib236) activeZoneLabel = 'FIB STATUS: Bearish Shallow Bounce (0.0 PDL → 23.6%)';
    else if (mark <= fib382) activeZoneLabel = 'FIB STATUS: Bearish Relief Rally (23.6% → 38.2%)';
    else if (mark <= fib500) activeZoneLabel = 'FIB STATUS: Equilibrium Premium Zone (38.2% → 50.0% EQ)';
    else if (mark <= fib650) activeZoneLabel = 'FIB STATUS: DISTRIBUTION ZONE (61.8% - 65.0% Golden Pocket OTE)';
    else if (mark <= fib786) activeZoneLabel = 'FIB STATUS: Deep Premium Zone (65.0% → 78.6%)';
    else activeZoneLabel = 'FIB STATUS: Overhead Resistance Test (78.6% → 1.0 PDH)';
  }

  return {
    swingHigh: formatCamarillaPrice(highPrev, mark),
    swingLow: formatCamarillaPrice(lowPrev, mark),
    range: formatCamarillaPrice(deltaSwing, mark),
    fib236,
    fib382,
    fib500,
    fib618,
    fib650,
    fib786,
    ext127Bull,
    ext161Bull,
    ext127Bear,
    ext161Bear,
    ext1236Upside,
    ext1382Upside,
    ext1500Upside,
    ext1618Upside,
    ext2000Upside,
    ext0236Downside,
    ext0382Downside,
    ext0500Downside,
    ext0618Downside,
    ext1000Downside,
    isExpansionMode,
    expansionDirection,
    activeZoneLabel,
    isBullish: isBull,
    base000: fib000,
    base100: fib100,
  };
}

/**
 * Detects Confluence between Camarilla Pivot Levels and Fibonacci Swing Levels.
 */
export function detectFibCamarillaConfluence(
  fib: FibonacciLevels,
  camarilla: CamarillaLevels,
  direction: 'LONG' | 'SHORT',
  currentPrice: number
): FibCamarillaConfluence {
  const isShort = direction === 'SHORT';

  // Format price helper
  const fmt = (p: number) =>
    p.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: p > 10 ? 2 : 4,
    });

  if (isShort) {
    // Short Trap / L4 Alignment:
    // Check if L4 or L3 aligns with 61.8% GP, 65.0% OTE, 50% EQ, 38.2%, or swing low
    const candidates = [
      { name: 'Golden Pocket 61.8%', price: fib.fib618, camName: 'L4', camPrice: camarilla.l4 },
      { name: 'Golden Pocket 65.0%', price: fib.fib650, camName: 'L4', camPrice: camarilla.l4 },
      { name: '38.2% Retracement', price: fib.fib382, camName: 'L4', camPrice: camarilla.l4 },
      { name: '50% Equilibrium', price: fib.fib500, camName: 'L3', camPrice: camarilla.l3 },
      { name: 'Golden Pocket 61.8%', price: fib.fib618, camName: 'L3', camPrice: camarilla.l3 },
      { name: 'Swing Low 0.0%', price: fib.swingLow, camName: 'L5', camPrice: camarilla.l5 },
    ];

    let bestMatch = candidates[0];
    let minDelta = Infinity;

    for (const c of candidates) {
      if (c.price > 0 && c.camPrice > 0) {
        const delta = Math.abs(c.price - c.camPrice) / c.price;
        if (delta < minDelta) {
          minDelta = delta;
          bestMatch = c;
        }
      }
    }

    const hasConfluence = minDelta <= 0.0015; // within 0.15% threshold
    const deltaPct = +(minDelta * 100).toFixed(2);

    return {
      hasConfluence,
      status: hasConfluence ? 'PASS' : minDelta <= 0.004 ? 'ALIGNING' : 'NEUTRAL',
      matchedFibLevel: bestMatch.name,
      matchedFibPrice: bestMatch.price,
      matchedCamarillaLevel: bestMatch.camName,
      matchedCamarillaPrice: bestMatch.camPrice,
      deltaPercent: deltaPct,
      description: hasConfluence
        ? `PASS · ${bestMatch.name} @ $${fmt(bestMatch.price)} ~ ${bestMatch.camName} ($${fmt(bestMatch.camPrice)})`
        : minDelta <= 0.004
        ? `ALIGNING · ${bestMatch.name} @ $${fmt(bestMatch.price)} ~ ${bestMatch.camName} (${deltaPct}% spread)`
        : `NEUTRAL (${bestMatch.name} @ $${fmt(bestMatch.price)})`,
      step3Confluence: `127.2% Ext: $${fmt(fib.ext127Bear)}`,
      step4Confluence: `161.8% Exp: $${fmt(fib.ext161Bear)}`,
    };
  } else {
    // Long Breakout / H4 Alignment:
    // Check if H4 aligns with 61.8% / 65.0% Golden Pocket, 50% EQ, 78.6%, or 127.2% extension
    const candidates = [
      { name: 'Golden Pocket 61.8%', price: fib.fib618, camName: 'H4', camPrice: camarilla.h4 },
      { name: 'Golden Pocket 65.0%', price: fib.fib650, camName: 'H4', camPrice: camarilla.h4 },
      { name: '78.6% Retracement', price: fib.fib786, camName: 'H4', camPrice: camarilla.h4 },
      { name: '50% Equilibrium', price: fib.fib500, camName: 'H3', camPrice: camarilla.h3 },
      { name: 'Golden Pocket 61.8%', price: fib.fib618, camName: 'H3', camPrice: camarilla.h3 },
      { name: '127.2% Extension', price: fib.ext127Bull, camName: 'H5', camPrice: camarilla.h5 },
      { name: '161.8% Expansion', price: fib.ext161Bull, camName: 'H6', camPrice: camarilla.h6 },
    ];

    let bestMatch = candidates[0];
    let minDelta = Infinity;

    for (const c of candidates) {
      if (c.price > 0 && c.camPrice > 0) {
        const delta = Math.abs(c.price - c.camPrice) / c.price;
        if (delta < minDelta) {
          minDelta = delta;
          bestMatch = c;
        }
      }
    }

    const hasConfluence = minDelta <= 0.0015; // within 0.15% threshold
    const deltaPct = +(minDelta * 100).toFixed(2);

    return {
      hasConfluence,
      status: hasConfluence ? 'PASS' : minDelta <= 0.004 ? 'ALIGNING' : 'NEUTRAL',
      matchedFibLevel: bestMatch.name,
      matchedFibPrice: bestMatch.price,
      matchedCamarillaLevel: bestMatch.camName,
      matchedCamarillaPrice: bestMatch.camPrice,
      deltaPercent: deltaPct,
      description: hasConfluence
        ? `PASS · ${bestMatch.name} @ $${fmt(bestMatch.price)} ~ ${bestMatch.camName} ($${fmt(bestMatch.camPrice)})`
        : minDelta <= 0.004
        ? `ALIGNING · ${bestMatch.name} @ $${fmt(bestMatch.price)} ~ ${bestMatch.camName} (${deltaPct}% spread)`
        : `NEUTRAL (${bestMatch.name} @ $${fmt(bestMatch.price)})`,
      step3Confluence: `127.2% Ext: $${fmt(fib.ext127Bull)}`,
      step4Confluence: `161.8% Exp: $${fmt(fib.ext161Bull)}`,
    };
  }
}
