import { Position, MarketTicker, PortfolioData, RiskSettings } from '../types';
import { AssetVolatilityMetric } from '../hooks/useVolatilitySpikeMonitor';

export type RebalanceActionType = 'trim' | 'add' | 'hedge';
export type RebalanceStrategyMode = 'RISK_PARITY' | 'VOL_TARGET_CAPPED' | 'DEFENSIVE_SHIELD';

export interface DeltaExposureSummary {
  netDeltaUsd: number; // Net Delta in USD Notional (+ for Net Long, - for Net Short)
  netDeltaInr: number; // Net Delta in INR Notional
  grossDeltaUsd: number; // Total gross notional exposure
  longDeltaUsd: number; // Total long notional
  shortDeltaUsd: number; // Total short notional
  deltaRatio: number; // Normalized delta skew: -1 (100% short) to +1 (100% long)
  deltaImbalancePct: number; // Net Delta as % of Total Equity
  deltaStatus: 'DELTA_NEUTRAL' | 'NET_LONG_LEAN' | 'NET_SHORT_LEAN' | 'CRITICAL_DELTA_IMBALANCE';
  statusDescription: string;
  recommendedDeltaAction: 'TRIM_LONGS' | 'TRIM_SHORTS' | 'ADD_LONGS' | 'ADD_SHORTS' | 'DELTA_HEDGE' | 'HOLD_BALANCED';
}

export interface AssetAllocationRow {
  symbol: string;
  displayName: string;
  markPrice: number;
  volatility24h: number;
  volatilitySeverity: 'NORMAL' | 'ELEVATED' | 'EXTREME';
  change24h: number;
  currentMarginUsd: number;
  currentNotionalUsd: number;
  currentWeightPct: number; // % of totalEquity in margin
  notionalExposurePct: number; // % of totalEquity in notional
  targetWeightPct: number;
  targetMarginUsd: number;
  driftPct: number; // targetWeightPct - currentWeightPct
  driftMarginUsd: number;
  netSide: 'LONG' | 'SHORT' | 'FLAT' | 'HEDGED';
  activeLeverage: number;
  recommendedLeverage: number;
  positionIds: string[];
  totalContracts: number;
  netDeltaUsd: number;
}

export interface RebalanceActionSuggestion {
  id: string;
  symbol: string;
  displayName: string;
  action: RebalanceActionType; // 'trim' | 'add' | 'hedge'
  actionTitle: string;
  priority: 'CRITICAL' | 'HIGH' | 'OPPORTUNITY';
  orderSide: 'LONG' | 'SHORT';
  contracts: number;
  markPrice: number;
  leverage: number;
  currentMarginUsd: number;
  marginDeltaUsd: number; // Negative for trim, positive for add
  notionalDeltaUsd: number;
  currentWeightPct: number;
  targetWeightPct: number;
  driftPct: number;
  volatility24h: number;
  volatilitySeverity: 'NORMAL' | 'ELEVATED' | 'EXTREME';
  deltaImpactUsd: number; // Impact shifting net delta toward zero
  resultingNetDeltaUsd: number; // Estimated portfolio net delta after this action
  rationale: string;
  positionIdToClose?: string;
}

export interface PortfolioRebalanceResult {
  deltaExposure: DeltaExposureSummary;
  suggestions: RebalanceActionSuggestion[];
  actionCounts: {
    trim: number;
    add: number;
    hedge: number;
    total: number;
  };
  portfolioVol24h: number;
  targetPortfolioVol24h: number;
  avgMarketVol24h: number;
  currentDeployedPct: number;
  currentCashReservePct: number;
  targetAllocatedSumPct: number;
  targetCashReservePct: number;
  totalDriftScore: number;
  rows: AssetAllocationRow[];
}

export interface AnalyzePortfolioParams {
  portfolio: PortfolioData;
  positions: Position[];
  riskSettings: RiskSettings;
  markets?: Record<string, MarketTicker>;
  volatilityAssetMetrics?: AssetVolatilityMetric[];
  rebalanceMode?: RebalanceStrategyMode;
  targetDeployedCapitalPct?: number;
  driftThresholdPct?: number;
  simulatedVolShockPct?: number;
  exchangeRate?: number;
}

export const CORE_REBALANCE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'AVAXUSDT', 'DOGEUSDT'];

export const FALLBACK_ASSET_PRICES: Record<string, { price: number; vol24h: number; change24h: number; name: string }> = {
  BTCUSDT: { price: 81702.5, vol24h: 1.74, change24h: -0.68, name: 'Bitcoin Perpetual' },
  ETHUSDT: { price: 2403.6, vol24h: 3.09, change24h: -1.04, name: 'Ethereum Perpetual' },
  SOLUSDT: { price: 104.56, vol24h: 4.18, change24h: 2.85, name: 'Solana Perpetual' },
  XRPUSDT: { price: 0.6145, vol24h: 3.45, change24h: 1.12, name: 'Ripple Perpetual' },
  AVAXUSDT: { price: 28.4, vol24h: 4.52, change24h: 2.34, name: 'Avalanche Perpetual' },
  DOGEUSDT: { price: 0.1482, vol24h: 4.95, change24h: -2.1, name: 'Dogecoin Perpetual' },
};

export const ASSET_CONTRACT_PRECISION: Record<string, number> = {
  BTCUSDT: 3,
  ETHUSDT: 2,
  SOLUSDT: 1,
  AVAXUSDT: 1,
  XRPUSDT: 0,
  DOGEUSDT: 0,
};

/**
 * PortfolioRebalancer Utility
 * 
 * Analyzes existing positions versus real-time market volatility and generates
 * concrete 'trim', 'add', and 'hedge' actions to maintain a balanced delta exposure.
 */
export class PortfolioRebalancer {
  /**
   * Main analysis pipeline computing net delta, volatility budgets, and actionable shifts
   */
  public static analyze({
    portfolio,
    positions,
    riskSettings,
    markets = {},
    volatilityAssetMetrics = [],
    rebalanceMode = 'RISK_PARITY',
    targetDeployedCapitalPct = 45,
    driftThresholdPct = 2.5,
    simulatedVolShockPct = 0,
    exchangeRate = 85.0,
  }: AnalyzePortfolioParams): PortfolioRebalanceResult {
    const totalEquity = Math.max(portfolio.totalEquity, 100);
    const maxSingleAssetCapPct = riskSettings.maxPositionSizePercent || 25;
    const maxLeverage = riskSettings.maxLeverage || 25;

    // 1. Calculate Portfolio Net & Gross Delta Exposure
    let longDeltaUsd = 0;
    let shortDeltaUsd = 0;

    for (const p of positions) {
      const ticker = markets[p.symbol];
      const markPrice = p.markPrice || ticker?.markPrice || (FALLBACK_ASSET_PRICES[p.symbol]?.price ?? 100);
      const notional = p.size * markPrice;
      if (p.side === 'LONG') {
        longDeltaUsd += notional;
      } else {
        shortDeltaUsd += notional;
      }
    }

    const netDeltaUsd = +(longDeltaUsd - shortDeltaUsd).toFixed(2);
    const grossDeltaUsd = +(longDeltaUsd + shortDeltaUsd).toFixed(2);
    const netDeltaInr = +(netDeltaUsd * exchangeRate).toFixed(2);
    const deltaRatio = grossDeltaUsd > 0 ? +(netDeltaUsd / grossDeltaUsd).toFixed(3) : 0;
    const deltaImbalancePct = +((netDeltaUsd / totalEquity) * 100).toFixed(1);

    // Evaluate Delta Status
    let deltaStatus: DeltaExposureSummary['deltaStatus'] = 'DELTA_NEUTRAL';
    let statusDescription = 'Portfolio delta exposure is balanced and near neutral.';
    let recommendedDeltaAction: DeltaExposureSummary['recommendedDeltaAction'] = 'HOLD_BALANCED';

    const absImbalance = Math.abs(deltaImbalancePct);
    const absRatio = Math.abs(deltaRatio);

    if (absImbalance > 35 || absRatio > 0.6) {
      deltaStatus = 'CRITICAL_DELTA_IMBALANCE';
      if (netDeltaUsd > 0) {
        statusDescription = `Heavy long delta skew (+${deltaImbalancePct}% of equity). Immediate hedge or trim recommended.`;
        recommendedDeltaAction = 'DELTA_HEDGE';
      } else {
        statusDescription = `Heavy short delta skew (${deltaImbalancePct}% of equity). Immediate hedge or trim recommended.`;
        recommendedDeltaAction = 'DELTA_HEDGE';
      }
    } else if (netDeltaUsd > totalEquity * 0.12 || deltaRatio > 0.25) {
      deltaStatus = 'NET_LONG_LEAN';
      statusDescription = `Net long delta exposure (+${deltaImbalancePct}%). Consider trimming long beta or adding defensive hedge.`;
      recommendedDeltaAction = 'TRIM_LONGS';
    } else if (netDeltaUsd < -totalEquity * 0.12 || deltaRatio < -0.25) {
      deltaStatus = 'NET_SHORT_LEAN';
      statusDescription = `Net short delta exposure (${deltaImbalancePct}%). Consider trimming short bias or rotating into spot-equivalent delta.`;
      recommendedDeltaAction = 'TRIM_SHORTS';
    }

    const deltaExposure: DeltaExposureSummary = {
      netDeltaUsd,
      netDeltaInr,
      grossDeltaUsd,
      longDeltaUsd: +longDeltaUsd.toFixed(2),
      shortDeltaUsd: +shortDeltaUsd.toFixed(2),
      deltaRatio,
      deltaImbalancePct,
      deltaStatus,
      statusDescription,
      recommendedDeltaAction,
    };

    // 2. Gather Volatility Metrics & Asset Rows
    const symbolSet = new Set<string>(CORE_REBALANCE_SYMBOLS);
    positions.forEach((p) => symbolSet.add(p.symbol));
    const allSymbols = Array.from(symbolSet);

    const volMetricMap: Record<string, AssetVolatilityMetric> = {};
    for (const vm of volatilityAssetMetrics) {
      volMetricMap[vm.symbol] = vm;
    }

    const rawAssets = allSymbols.map((symbol) => {
      const ticker = markets[symbol];
      const vm = volMetricMap[symbol];
      const fallback = FALLBACK_ASSET_PRICES[symbol] || {
        price: 100,
        vol24h: 3.2,
        change24h: 0,
        name: `${symbol} Perpetual`,
      };

      const markPrice = ticker?.markPrice || vm?.markPrice || fallback.price;
      const change24h = ticker?.change24h ?? vm?.change24h ?? fallback.change24h;

      let baseVol24h = vm?.compositeVolatility24h;
      if (baseVol24h === undefined || baseVol24h <= 0) {
        if (ticker && ticker.low24h > 0 && ticker.high24h >= ticker.low24h) {
          const rangeVol = ((ticker.high24h - ticker.low24h) / ticker.low24h) * 100;
          baseVol24h = Math.max(rangeVol, Math.abs(change24h) * 1.15, 0.8);
        } else {
          baseVol24h = fallback.vol24h;
        }
      }

      const effectiveVol24h = +(baseVol24h + simulatedVolShockPct).toFixed(2);
      const volatilitySeverity: 'NORMAL' | 'ELEVATED' | 'EXTREME' =
        effectiveVol24h >= 5.0
          ? 'EXTREME'
          : effectiveVol24h >= 3.5
          ? 'ELEVATED'
          : 'NORMAL';

      const assetPositions = positions.filter((p) => p.symbol === symbol);
      const currentMarginUsd = assetPositions.reduce((sum, p) => sum + p.margin, 0);
      const currentNotionalUsd = assetPositions.reduce((sum, p) => sum + p.size * markPrice, 0);

      let netContracts = 0;
      let hasLong = false;
      let hasShort = false;
      for (const p of assetPositions) {
        if (p.side === 'LONG') {
          netContracts += p.size;
          hasLong = true;
        } else {
          netContracts -= p.size;
          hasShort = true;
        }
      }

      const netSide: 'LONG' | 'SHORT' | 'FLAT' | 'HEDGED' =
        assetPositions.length === 0
          ? 'FLAT'
          : hasLong && hasShort && Math.abs(netContracts) < 0.0001
          ? 'HEDGED'
          : netContracts >= 0
          ? 'LONG'
          : 'SHORT';

      const activeLeverage =
        assetPositions.length > 0
          ? Math.round(
              assetPositions.reduce((sum, p) => sum + p.leverage * p.margin, 0) /
                Math.max(currentMarginUsd, 1)
            )
          : 0;

      const volScaledLeverage = Math.max(
        2,
        Math.min(
          maxLeverage,
          effectiveVol24h >= 5.0
            ? 5
            : effectiveVol24h >= 3.5
            ? 8
            : effectiveVol24h >= 2.2
            ? 12
            : 15
        )
      );

      const assetNetDelta = netSide === 'LONG' ? currentNotionalUsd : netSide === 'SHORT' ? -currentNotionalUsd : 0;

      return {
        symbol,
        displayName: ticker?.name?.replace(' (Delta India)', '') || fallback.name,
        markPrice,
        volatility24h: effectiveVol24h,
        volatilitySeverity,
        change24h,
        currentMarginUsd,
        currentNotionalUsd,
        currentWeightPct: +((currentMarginUsd / totalEquity) * 100).toFixed(2),
        notionalExposurePct: +((currentNotionalUsd / totalEquity) * 100).toFixed(1),
        netSide,
        activeLeverage,
        recommendedLeverage: volScaledLeverage,
        positionIds: assetPositions.map((p) => p.id),
        totalContracts: +Math.abs(netContracts).toFixed(4),
        netDeltaUsd: +assetNetDelta.toFixed(2),
      };
    });

    // 3. Compute Market Volatility & Effective Target Deployed Capital
    const avgMarketVol24h = +(
      rawAssets.reduce((acc, a) => acc + a.volatility24h, 0) / Math.max(rawAssets.length, 1)
    ).toFixed(2);

    let effectiveDeployedBudgetPct = targetDeployedCapitalPct;
    if (rebalanceMode === 'DEFENSIVE_SHIELD') {
      effectiveDeployedBudgetPct = Math.min(targetDeployedCapitalPct, 32) * (avgMarketVol24h > 3.8 ? 0.75 : 1);
    } else if (rebalanceMode === 'VOL_TARGET_CAPPED') {
      const volScalingFactor = Math.min(1.15, 3.0 / Math.max(avgMarketVol24h, 1.5));
      effectiveDeployedBudgetPct = Math.min(75, Math.max(20, targetDeployedCapitalPct * volScalingFactor));
    } else {
      const spikeDampener = avgMarketVol24h > 4.5 ? 0.82 : 1.0;
      effectiveDeployedBudgetPct = Math.min(80, targetDeployedCapitalPct * spikeDampener);
    }
    effectiveDeployedBudgetPct = +effectiveDeployedBudgetPct.toFixed(1);

    // 4. Score Inverse-Volatility & Target Weights
    const eligibleAssets = rawAssets.map((asset) => {
      const tierMultiplier =
        asset.symbol === 'BTCUSDT'
          ? 1.55
          : asset.symbol === 'ETHUSDT'
          ? 1.25
          : asset.symbol === 'SOLUSDT'
          ? 1.0
          : 0.65;

      let rawScore = 0;
      if (rebalanceMode === 'RISK_PARITY') {
        rawScore = (1 / Math.max(asset.volatility24h, 0.75)) * tierMultiplier;
      } else if (rebalanceMode === 'VOL_TARGET_CAPPED') {
        const penalty = asset.volatility24h >= 3.5 ? 0.38 : 1.0;
        rawScore = (1 / Math.pow(Math.max(asset.volatility24h, 0.8), 1.35)) * tierMultiplier * penalty;
      } else {
        const defensiveBonus =
          asset.symbol === 'BTCUSDT' ? 2.2 : asset.symbol === 'ETHUSDT' ? 1.5 : 0.35;
        rawScore = (1 / Math.pow(Math.max(asset.volatility24h, 0.8), 1.6)) * defensiveBonus;
      }

      return { ...asset, rawScore };
    });

    const totalScore = eligibleAssets.reduce((sum, a) => sum + a.rawScore, 0) || 1;

    const rows: AssetAllocationRow[] = eligibleAssets.map((asset) => {
      const uncappedTargetPct = (asset.rawScore / totalScore) * effectiveDeployedBudgetPct;
      const targetWeightPct = +Math.min(uncappedTargetPct, maxSingleAssetCapPct).toFixed(2);
      const targetMarginUsd = +((targetWeightPct / 100) * totalEquity).toFixed(2);
      const driftPct = +(targetWeightPct - asset.currentWeightPct).toFixed(2);
      const driftMarginUsd = +(targetMarginUsd - asset.currentMarginUsd).toFixed(2);

      return {
        symbol: asset.symbol,
        displayName: asset.displayName,
        markPrice: asset.markPrice,
        volatility24h: asset.volatility24h,
        volatilitySeverity: asset.volatilitySeverity,
        change24h: asset.change24h,
        currentMarginUsd: +asset.currentMarginUsd.toFixed(2),
        currentNotionalUsd: +asset.currentNotionalUsd.toFixed(2),
        currentWeightPct: asset.currentWeightPct,
        notionalExposurePct: asset.notionalExposurePct,
        targetWeightPct,
        targetMarginUsd,
        driftPct,
        driftMarginUsd,
        netSide: asset.netSide,
        activeLeverage: asset.activeLeverage,
        recommendedLeverage: asset.recommendedLeverage,
        positionIds: asset.positionIds,
        totalContracts: asset.totalContracts,
        netDeltaUsd: asset.netDeltaUsd,
      };
    });

    // 5. Portfolio Summary Metrics
    const currentDeployedMarginUsd = rows.reduce((sum, r) => sum + r.currentMarginUsd, 0);
    const currentDeployedPct = +((currentDeployedMarginUsd / totalEquity) * 100).toFixed(2);
    const currentCashReservePct = +Math.max(0, 100 - currentDeployedPct).toFixed(2);
    const targetAllocatedSumPct = +rows.reduce((sum, r) => sum + r.targetWeightPct, 0).toFixed(2);
    const targetCashReservePct = +Math.max(0, 100 - targetAllocatedSumPct).toFixed(2);

    const portfolioVol24h =
      totalEquity > 0
        ? +(
            rows.reduce(
              (sum, r) =>
                sum +
                (r.currentWeightPct / 100) *
                  r.volatility24h *
                  Math.max(1, (r.activeLeverage || 1) / 5),
              0
            )
          ).toFixed(2)
        : 0;

    const targetPortfolioVol24h = +(
      rows.reduce(
        (sum, r) =>
          sum + (r.targetWeightPct / 100) * r.volatility24h * Math.max(1, r.recommendedLeverage / 5),
        0
      )
    ).toFixed(2);

    const totalDriftScore = +rows
      .reduce((sum, r) => sum + Math.abs(r.driftPct), 0)
      .toFixed(1);

    // 6. Actionable Suggestions Engine: Specifically 'trim', 'add', or 'hedge'
    const suggestions: RebalanceActionSuggestion[] = [];

    // Check for Portfolio-Level Delta Hedge first if extreme delta imbalance exists
    if (Math.abs(deltaRatio) >= 0.40 && Math.abs(netDeltaUsd) >= totalEquity * 0.18) {
      const hedgeSymbol = rows.find((r) => r.symbol === 'BTCUSDT') ? 'BTCUSDT' : 'ETHUSDT';
      const hedgeRow = rows.find((r) => r.symbol === hedgeSymbol) || rows[0];
      const hedgePrecision = ASSET_CONTRACT_PRECISION[hedgeSymbol] ?? 3;
      const hedgeFactor = Math.pow(10, hedgePrecision);

      // We want to neutralize at least 65% of the net delta imbalance
      const targetDeltaOffset = Math.abs(netDeltaUsd) * 0.70;
      const hedgeSide: 'LONG' | 'SHORT' = netDeltaUsd > 0 ? 'SHORT' : 'LONG';
      const hedgeContracts = Math.max(
        hedgePrecision === 0 ? 1 : +(1 / hedgeFactor).toFixed(hedgePrecision),
        +(Math.round((targetDeltaOffset / hedgeRow.markPrice) * hedgeFactor) / hedgeFactor).toFixed(hedgePrecision)
      );
      const hedgeLev = Math.min(hedgeRow.recommendedLeverage, 10);
      const hedgeMarginUsd = +((hedgeContracts * hedgeRow.markPrice) / hedgeLev).toFixed(2);
      const deltaImpact = hedgeSide === 'SHORT' ? -targetDeltaOffset : targetDeltaOffset;
      const resultingNetDelta = +(netDeltaUsd + deltaImpact).toFixed(2);

      suggestions.push({
        id: `hedge-portfolio-delta-${hedgeSymbol}`,
        symbol: hedgeSymbol,
        displayName: hedgeRow.displayName,
        action: 'hedge',
        actionTitle: `Hedge Net ${netDeltaUsd > 0 ? 'Long' : 'Short'} Delta with ${hedgeSymbol}`,
        priority: 'CRITICAL',
        orderSide: hedgeSide,
        contracts: hedgeContracts,
        markPrice: hedgeRow.markPrice,
        leverage: hedgeLev,
        currentMarginUsd: hedgeRow.currentMarginUsd,
        marginDeltaUsd: hedgeMarginUsd,
        notionalDeltaUsd: +(hedgeContracts * hedgeRow.markPrice).toFixed(2),
        currentWeightPct: hedgeRow.currentWeightPct,
        targetWeightPct: hedgeRow.targetWeightPct,
        driftPct: hedgeRow.driftPct,
        volatility24h: hedgeRow.volatility24h,
        volatilitySeverity: hedgeRow.volatilitySeverity,
        deltaImpactUsd: Math.round(targetDeltaOffset),
        resultingNetDeltaUsd: resultingNetDelta,
        rationale: `Portfolio net delta is skewed ${netDeltaUsd > 0 ? 'LONG' : 'SHORT'} by $${Math.abs(netDeltaUsd).toLocaleString()} (${deltaImbalancePct}% of equity). Opening ${hedgeSide} ${hedgeContracts} ${hedgeSymbol} delta hedge brings net delta to ~$${resultingNetDelta.toLocaleString()}, protecting against market-wide volatility.`,
      });
    }

    // Asset-specific evaluations for 'trim', 'add', and asset-level 'hedge'
    for (const row of rows) {
      const precision = ASSET_CONTRACT_PRECISION[row.symbol] ?? 2;
      const factor = Math.pow(10, precision);
      const absDrift = Math.abs(row.driftPct);
      const isOverMaxCap = row.currentWeightPct > maxSingleAssetCapPct;
      const isExtremeVolSpike = row.volatilitySeverity === 'EXTREME' && row.currentMarginUsd > 0;

      // ─────────────────────────────────────────────────────────────
      // A. 'hedge' Action (Specific asset volatility spike hedge)
      // ─────────────────────────────────────────────────────────────
      if (isExtremeVolSpike && row.netSide !== 'HEDGED' && row.currentMarginUsd > 50) {
        const opposingSide: 'LONG' | 'SHORT' = row.netSide === 'LONG' ? 'SHORT' : 'LONG';
        const hedgeContracts = Math.max(
          precision === 0 ? 1 : +(1 / factor).toFixed(precision),
          +(row.totalContracts * 0.75).toFixed(precision)
        );
        const notionalHedge = +(hedgeContracts * row.markPrice).toFixed(2);
        const marginHedge = +(notionalHedge / row.recommendedLeverage).toFixed(2);
        const deltaImpact = opposingSide === 'SHORT' ? -notionalHedge : notionalHedge;
        const resultingNetDelta = +(netDeltaUsd + deltaImpact).toFixed(2);

        suggestions.push({
          id: `hedge-spike-${row.symbol}`,
          symbol: row.symbol,
          displayName: row.displayName,
          action: 'hedge',
          actionTitle: `Delta-Hedge ${row.symbol} Volatility Shock`,
          priority: 'CRITICAL',
          orderSide: opposingSide,
          contracts: hedgeContracts,
          markPrice: row.markPrice,
          leverage: row.recommendedLeverage,
          currentMarginUsd: row.currentMarginUsd,
          marginDeltaUsd: marginHedge,
          notionalDeltaUsd: notionalHedge,
          currentWeightPct: row.currentWeightPct,
          targetWeightPct: row.targetWeightPct,
          driftPct: row.driftPct,
          volatility24h: row.volatility24h,
          volatilitySeverity: row.volatilitySeverity,
          deltaImpactUsd: Math.round(notionalHedge),
          resultingNetDeltaUsd: resultingNetDelta,
          rationale: `${row.symbol} 24h volatility surged to ${row.volatility24h}% (EXTREME). Open ${row.netSide} exposure ($${row.currentNotionalUsd.toLocaleString()}) poses directional gamma risk. An opposing ${opposingSide} hedge locks in margin without forcing an immediate market close.`,
        });
      }

      // ─────────────────────────────────────────────────────────────
      // B. 'trim' Action (Overweight or high-volatility exposure trim)
      // ─────────────────────────────────────────────────────────────
      if (row.currentMarginUsd > 0 && (row.driftPct < -driftThresholdPct || isOverMaxCap)) {
        const excessMarginUsd = Math.abs(row.driftMarginUsd);
        const effectiveLev = row.activeLeverage || row.recommendedLeverage || 10;
        const notionalReductionUsd = excessMarginUsd * effectiveLev;
        const rawContracts = notionalReductionUsd / Math.max(row.markPrice, 0.0001);
        const trimContracts = Math.min(
          row.totalContracts,
          Math.max(
            precision === 0 ? 1 : +(1 / factor).toFixed(precision),
            +(Math.round(rawContracts * factor) / factor).toFixed(precision)
          )
        );
        const trimSide: 'LONG' | 'SHORT' = row.netSide === 'LONG' ? 'SHORT' : 'LONG';
        const deltaImpact = row.netSide === 'LONG' ? -notionalReductionUsd : notionalReductionUsd;
        const resultingNetDelta = +(netDeltaUsd + deltaImpact).toFixed(2);

        suggestions.push({
          id: `trim-${row.symbol}`,
          symbol: row.symbol,
          displayName: row.displayName,
          action: 'trim',
          actionTitle: `Trim ${row.symbol} ${row.netSide} Exposure`,
          priority: isOverMaxCap || row.volatilitySeverity === 'EXTREME' ? 'CRITICAL' : 'HIGH',
          orderSide: trimSide,
          contracts: trimContracts,
          markPrice: row.markPrice,
          leverage: effectiveLev,
          currentMarginUsd: row.currentMarginUsd,
          marginDeltaUsd: -excessMarginUsd,
          notionalDeltaUsd: -notionalReductionUsd,
          currentWeightPct: row.currentWeightPct,
          targetWeightPct: row.targetWeightPct,
          driftPct: row.driftPct,
          volatility24h: row.volatility24h,
          volatilitySeverity: row.volatilitySeverity,
          deltaImpactUsd: Math.round(notionalReductionUsd),
          resultingNetDeltaUsd: resultingNetDelta,
          rationale: isOverMaxCap
            ? `${row.symbol} margin allocation (${row.currentWeightPct}%) breaches the ${maxSingleAssetCapPct}% single-asset cap with ${row.volatility24h}% volatility. Trimming ${trimContracts} contracts frees up $${excessMarginUsd.toFixed(0)} margin and re-balances directional delta.`
            : `${row.symbol} is overweight by ${Math.abs(row.driftPct).toFixed(1)}% vs the ${rebalanceMode.replace('_', ' ')} target (${row.targetWeightPct}%). Trimming ${trimContracts} contracts reduces risk-weighted volatility and protects free cash reserve.`,
          positionIdToClose: row.positionIds[0],
        });
      }

      // ─────────────────────────────────────────────────────────────
      // C. 'add' Action (Controlled scale-in to underweight low-vol asset)
      // ─────────────────────────────────────────────────────────────
      if (row.driftPct > driftThresholdPct && row.volatilitySeverity !== 'EXTREME' && portfolio.availableBalance >= 50) {
        const addMarginUsd = Math.min(row.driftMarginUsd, portfolio.availableBalance * 0.40);
        if (addMarginUsd >= 50) {
          const lev = row.recommendedLeverage;
          const notionalAddUsd = addMarginUsd * lev;
          const rawContracts = notionalAddUsd / Math.max(row.markPrice, 0.0001);
          const addContracts = Math.max(
            precision === 0 ? 1 : +(1 / factor).toFixed(precision),
            +(Math.round(rawContracts * factor) / factor).toFixed(precision)
          );

          // Choose direction that stabilizes net delta: if portfolio is heavy long, prefer SHORT or neutral; otherwise trend-aligned
          let addSide: 'LONG' | 'SHORT' = row.change24h >= 0 ? 'LONG' : 'SHORT';
          if (deltaStatus === 'NET_LONG_LEAN' && row.change24h < 1.0) {
            addSide = 'SHORT';
          } else if (deltaStatus === 'NET_SHORT_LEAN' && row.change24h > -1.0) {
            addSide = 'LONG';
          }

          const deltaImpact = addSide === 'LONG' ? notionalAddUsd : -notionalAddUsd;
          const resultingNetDelta = +(netDeltaUsd + deltaImpact).toFixed(2);

          suggestions.push({
            id: `add-${row.symbol}`,
            symbol: row.symbol,
            displayName: row.displayName,
            action: 'add',
            actionTitle: `Add ${row.symbol} Position (+${row.driftPct.toFixed(1)}%)`,
            priority: row.volatility24h < 2.5 ? 'HIGH' : 'OPPORTUNITY',
            orderSide: addSide,
            contracts: addContracts,
            markPrice: row.markPrice,
            leverage: lev,
            currentMarginUsd: row.currentMarginUsd,
            marginDeltaUsd: +addMarginUsd.toFixed(2),
            notionalDeltaUsd: +notionalAddUsd.toFixed(2),
            currentWeightPct: row.currentWeightPct,
            targetWeightPct: row.targetWeightPct,
            driftPct: row.driftPct,
            volatility24h: row.volatility24h,
            volatilitySeverity: row.volatilitySeverity,
            deltaImpactUsd: Math.round(notionalAddUsd),
            resultingNetDeltaUsd: resultingNetDelta,
            rationale: `${row.symbol} displays low 24h volatility (${row.volatility24h}%) and is underweight by ${row.driftPct.toFixed(1)}% vs optimal risk-parity budget (${row.targetWeightPct}%). Adding ${addContracts} contracts (${addSide}) utilizes available margin to maintain a diversified, balanced delta profile.`,
          });
        }
      }
    }

    // Sort suggestions: CRITICAL -> HIGH -> OPPORTUNITY, then by impact
    const priorityRank = { CRITICAL: 3, HIGH: 2, OPPORTUNITY: 1 };
    suggestions.sort(
      (a, b) =>
        priorityRank[b.priority] - priorityRank[a.priority] ||
        b.deltaImpactUsd - a.deltaImpactUsd
    );

    const actionCounts = {
      trim: suggestions.filter((s) => s.action === 'trim').length,
      add: suggestions.filter((s) => s.action === 'add').length,
      hedge: suggestions.filter((s) => s.action === 'hedge').length,
      total: suggestions.length,
    };

    return {
      deltaExposure,
      suggestions,
      actionCounts,
      portfolioVol24h,
      targetPortfolioVol24h,
      avgMarketVol24h,
      currentDeployedPct,
      currentCashReservePct,
      targetAllocatedSumPct,
      targetCashReservePct,
      totalDriftScore,
      rows,
    };
  }
}
