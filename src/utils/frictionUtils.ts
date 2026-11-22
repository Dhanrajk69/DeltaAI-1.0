/**
 * Institutional Sniper Friction & Cost Drag Model (Delta Exchange India)
 *
 * Implements high-fidelity transaction cost analysis (TCA) for crypto futures:
 * 1. Maker / Taker Exchange Fees:
 *    - Maker: 0.02% (passive limit order)
 *    - Taker: 0.05% (aggressive breakout market fill)
 *    - Two-way Round-trip Fee: (Entry Notional + Exit Notional) * FeeRate
 * 2. 18% Statutory GST:
 *    - Fee_net = Fee_roundtrip * 1.18
 * 3. Execution Slippage Buffer:
 *    - Default: 0.03% (3 bps) on notional
 * 4. Total Friction Dollar:
 *    - Total_Friction = Fee_net + Slippage_Dollar
 * 5. Net Point Drag:
 *    - Point Drag = Total_Friction / Lot_Size
 * 6. Net Break-Even Lock:
 *    - LONG:  BE_Net = Entry Price + Point Drag
 *    - SHORT: BE_Net = Entry Price - Point Drag
 * 7. Net PnL on Profit Targets (TP1 - TP4) and True Net R:R.
 */

export const MAKER_FEE_RATE = 0.0002; // 0.02%
export const TAKER_FEE_RATE = 0.0005; // 0.05%
export const GST_RATE = 0.18; // 18%
export const DEFAULT_SLIPPAGE_RATE = 0.0003; // 0.03% (3 bps)
export const DEFAULT_USD_INR_RATE = 85.0; // Standard INR/USD conversion rate

export interface CalculateFrictionOptions {
  entryPrice: number;
  direction: 'LONG' | 'SHORT';
  lotSize: number;
  exitPrice?: number;
  isTaker?: boolean;
  slippageRate?: number;
  usdToInrRate?: number;
}

export interface SniperFrictionBreakdown {
  entryNotional: number;
  exitNotional: number;
  totalRoundtripNotional: number;
  feeRate: number;
  takerFeeRate: number;
  makerFeeRate: number;
  feeRoundtripUsd: number;
  gstUsd: number;
  totalFeeWithGstUsd: number;
  slippageRate: number;
  slippageBps: number;
  slippageUsd: number;
  totalFrictionUsd: number;
  totalFrictionInr: number;
  pointDrag: number;
  netBreakevenPrice: number;
  telemetryChipText: string;
  chipUsdFormatted: string;
  chipInrFormatted: string;
}

/**
 * Calculates two-way round-trip trading friction, GST, slippage, and net break-even price.
 */
export function calculateSniperFriction({
  entryPrice,
  direction,
  lotSize,
  exitPrice,
  isTaker = true,
  slippageRate = DEFAULT_SLIPPAGE_RATE,
  usdToInrRate = DEFAULT_USD_INR_RATE,
}: CalculateFrictionOptions): SniperFrictionBreakdown {
  const safeEntry = entryPrice > 0 ? entryPrice : 81702.50;
  const safeLot = lotSize > 0 ? lotSize : 0.05;
  const safeExit = exitPrice && exitPrice > 0 ? exitPrice : safeEntry;

  const entryNotional = safeEntry * safeLot;
  const exitNotional = safeExit * safeLot;
  const totalRoundtripNotional = entryNotional + exitNotional;

  const feeRate = isTaker ? TAKER_FEE_RATE : MAKER_FEE_RATE;
  const feeRoundtripUsd = +(totalRoundtripNotional * feeRate).toFixed(4);
  const gstUsd = +(feeRoundtripUsd * GST_RATE).toFixed(4);
  const totalFeeWithGstUsd = +(feeRoundtripUsd + gstUsd).toFixed(4);

  // Slippage is applied to entry (and exit on market orders)
  const slippageUsd = +(totalRoundtripNotional * (slippageRate / 2)).toFixed(4);

  const totalFrictionUsd = +(totalFeeWithGstUsd + slippageUsd).toFixed(2);
  const totalFrictionInr = +(totalFrictionUsd * usdToInrRate).toFixed(2);

  // Point Drag (ΔP_friction) = Total Net Friction Dollar / Lot Size
  const pointDrag = +(totalFrictionUsd / safeLot).toFixed(2);

  // Net Break-Even Lock:
  // Long Breakout:  BE_Net = Entry Price + Point Drag
  // Short Breakdown: BE_Net = Entry Price - Point Drag
  const isLong = direction === 'LONG';
  const rawBe = isLong ? safeEntry + pointDrag : safeEntry - pointDrag;
  const decimals = safeEntry < 1 ? 4 : safeEntry < 10 ? 3 : 2;
  const netBreakevenPrice = +rawBe.toFixed(decimals);

  const feePctFormatted = isTaker ? '0.05%' : '0.02%';
  const slippageBps = Math.round(slippageRate * 10000);
  const telemetryChipText = `Friction Drag: $${totalFrictionUsd.toFixed(2)} (₹${totalFrictionInr.toFixed(2)}) · Roundtrip ${isTaker ? 'Taker' : 'Maker'} (${feePctFormatted}) + 18% GST + ${slippageBps} bps Slip`;

  return {
    entryNotional,
    exitNotional,
    totalRoundtripNotional,
    feeRate,
    takerFeeRate: TAKER_FEE_RATE,
    makerFeeRate: MAKER_FEE_RATE,
    feeRoundtripUsd,
    gstUsd,
    totalFeeWithGstUsd,
    slippageRate,
    slippageBps,
    slippageUsd,
    totalFrictionUsd,
    totalFrictionInr,
    pointDrag,
    netBreakevenPrice,
    telemetryChipText,
    chipUsdFormatted: `$${totalFrictionUsd.toFixed(2)}`,
    chipInrFormatted: `₹${totalFrictionInr.toFixed(2)}`,
  };
}

/**
 * Computes net payouts for the 4-stage profit ladder deducting round-trip fees, GST, and slippage.
 */
export function calculateNetLadderPayouts(
  entryPrice: number,
  targets: { tp1: number; tp2: number; tp3: number; tp4: number },
  lotSize: number,
  isShort: boolean = false,
  isTaker: boolean = true,
  slippageRate: number = DEFAULT_SLIPPAGE_RATE
): {
  tp1Gross: number;
  tp1Net: number;
  tp2Gross: number;
  tp2Net: number;
  tp3Gross: number;
  tp3Net: number;
  tp4Gross: number;
  tp4Net: number;
} {
  const safeEntry = entryPrice > 0 ? entryPrice : 81702.50;
  const safeLot = lotSize > 0 ? lotSize : 0.05;

  const computeLevelNet = (tp: number) => {
    if (!tp || tp <= 0) return { gross: 0, net: 0 };
    const pointDiff = isShort ? safeEntry - tp : tp - safeEntry;
    const gross = Math.max(0, +(pointDiff * safeLot).toFixed(2));
    if (gross <= 0) return { gross: 0, net: 0 };

    const friction = calculateSniperFriction({
      entryPrice: safeEntry,
      direction: isShort ? 'SHORT' : 'LONG',
      lotSize: safeLot,
      exitPrice: tp,
      isTaker,
      slippageRate,
    });

    const net = Math.max(0, +(gross - friction.totalFrictionUsd).toFixed(2));
    return { gross, net };
  };

  const l1 = computeLevelNet(targets.tp1);
  const l2 = computeLevelNet(targets.tp2);
  const l3 = computeLevelNet(targets.tp3);
  const l4 = computeLevelNet(targets.tp4);

  return {
    tp1Gross: l1.gross,
    tp1Net: l1.net,
    tp2Gross: l2.gross,
    tp2Net: l2.net,
    tp3Gross: l3.gross,
    tp3Net: l3.net,
    tp4Gross: l4.gross,
    tp4Net: l4.net,
  };
}

/**
 * Computes dynamic true net Risk-to-Reward ratio after deducting friction drag.
 */
export function calculateNetRiskReward(
  entryPrice: number,
  stopLoss: number,
  tp4: number,
  lotSize: number = 0.05,
  direction: 'LONG' | 'SHORT' = 'LONG'
): {
  grossReward: number;
  netReward: number;
  grossRisk: number;
  netRisk: number;
  netRrRatio: string;
  netRrNumeric: number;
} {
  const safeEntry = entryPrice > 0 ? entryPrice : 81702.50;
  const safeLot = lotSize > 0 ? lotSize : 0.05;

  const grossReward = Math.max(0, +(Math.abs(tp4 - safeEntry) * safeLot).toFixed(2));
  const grossRisk = Math.max(0.01, +(Math.abs(safeEntry - stopLoss) * safeLot).toFixed(2));

  const frictionAtTarget = calculateSniperFriction({
    entryPrice: safeEntry,
    direction,
    lotSize: safeLot,
    exitPrice: tp4,
    isTaker: true,
  });

  const netReward = Math.max(0, +(grossReward - frictionAtTarget.totalFrictionUsd).toFixed(2));
  const netRisk = +(grossRisk + frictionAtTarget.totalFrictionUsd).toFixed(2);

  const netRrNumeric = netRisk > 0 ? +(netReward / netRisk).toFixed(1) : 3.8;
  const netRrRatio = `1 : ${netRrNumeric}`;

  return {
    grossReward,
    netReward,
    grossRisk,
    netRisk,
    netRrRatio,
    netRrNumeric,
  };
}
