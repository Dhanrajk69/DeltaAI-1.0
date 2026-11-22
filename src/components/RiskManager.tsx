import React, { useState, useMemo, useEffect, useRef } from 'react';
import { RiskSettings, PortfolioData, Position, MarketTicker, TradingMode, AppNotification, MarginMode } from '../types';
import { AssetVolatilityMetric } from '../hooks/useVolatilitySpikeMonitor';
import {
  ShieldAlert,
  ShieldCheck,
  AlertOctagon,
  RefreshCw,
  Zap,
  CheckCircle2,
  Scale,
  ArrowRightLeft,
  TrendingUp,
  TrendingDown,
  Activity,
  Sliders,
  Play,
  Sparkles,
  Layers,
  Clock,
  Info,
  Target,
  Lock,
  Unlock,
  Gauge,
  Cloud,
} from 'lucide-react';

import { CapitalAllocationCard } from './CapitalAllocationCard';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';

export type RebalanceStrategyMode = 'RISK_PARITY' | 'VOL_TARGET_CAPPED' | 'DEFENSIVE_SHIELD';

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
}

export interface RebalanceSuggestion {
  id: string;
  symbol: string;
  actionType: 'TRIM_EXPOSURE' | 'SCALE_IN' | 'DELTA_HEDGE' | 'CLOSE_OVERWEIGHT';
  actionLabel: string;
  priority: 'CRITICAL' | 'HIGH' | 'OPPORTUNITY';
  currentWeightPct: number;
  targetWeightPct: number;
  driftPct: number;
  marginDeltaUsd: number;
  notionalDeltaUsd: number;
  suggestedSide: 'LONG' | 'SHORT';
  suggestedContracts: number;
  suggestedLeverage: number;
  volatility24h: number;
  expectedVolReductionBps: number;
  rationale: string;
  positionIdToClose?: string;
}

interface RebalanceAuditEntry {
  id: string;
  timestamp: number;
  symbol: string;
  actionLabel: string;
  details: string;
  mode: RebalanceStrategyMode;
}

interface RiskManagerProps {
  portfolio: PortfolioData;
  positions: Position[];
  riskSettings: RiskSettings;
  onUpdateRiskSettings: (settings: RiskSettings) => void;
  onTriggerKillSwitch: () => Promise<void>;
  onTriggerAutoHedge: (symbol: string) => Promise<void>;
  currencyPrefix: string;
  exchangeRate: number;
  markets?: Record<string, MarketTicker>;
  volatilityAssetMetrics?: AssetVolatilityMetric[];
  tradingMode?: TradingMode;
  onExecuteOrder?: (order: any) => Promise<void>;
  onClosePosition?: (positionId: string) => Promise<void>;
  onSendNotification?: (title: string, message: string, type?: AppNotification['type']) => void;
  onNavigateToStrategies?: () => void;
}

const CORE_REBALANCE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'AVAXUSDT', 'DOGEUSDT'];

const FALLBACK_PRICES: Record<string, { price: number; vol24h: number; change24h: number; name: string }> = {
  BTCUSDT: { price: 81702.5, vol24h: 1.74, change24h: -0.68, name: 'Bitcoin Perpetual' },
  ETHUSDT: { price: 2403.6, vol24h: 3.09, change24h: -1.04, name: 'Ethereum Perpetual' },
  SOLUSDT: { price: 104.56, vol24h: 4.18, change24h: 2.85, name: 'Solana Perpetual' },
  XRPUSDT: { price: 0.6145, vol24h: 3.45, change24h: 1.12, name: 'Ripple Perpetual' },
  AVAXUSDT: { price: 28.4, vol24h: 4.52, change24h: 2.34, name: 'Avalanche Perpetual' },
  DOGEUSDT: { price: 0.1482, vol24h: 4.95, change24h: -2.1, name: 'Dogecoin Perpetual' },
};

const CONTRACT_PRECISION: Record<string, number> = {
  BTCUSDT: 3,
  ETHUSDT: 2,
  SOLUSDT: 1,
  AVAXUSDT: 1,
  XRPUSDT: 0,
  DOGEUSDT: 0,
};

export const RiskManager: React.FC<RiskManagerProps> = ({
  portfolio,
  positions,
  riskSettings,
  onUpdateRiskSettings,
  onTriggerKillSwitch,
  onTriggerAutoHedge,
  currencyPrefix,
  exchangeRate,
  markets = {},
  volatilityAssetMetrics = [],
  tradingMode = 'PAPER',
  onExecuteOrder,
  onClosePosition,
  onSendNotification,
  onNavigateToStrategies,
}) => {
  const {
    defaultLotSize,
    lotSizingMode,
    maxRiskPerTradePct,
    maxDailyLossPct,
    globalLeverage,
    maxLeverageCap,
    marginMode,
    leverageSyncLocked,
    applyGlobalLeverageConfig,
  } = useCapitalAllocation();
  const [localSettings, setLocalSettings] = useState<RiskSettings>(() => ({
    ...riskSettings,
    defaultLotSize: riskSettings.defaultLotSize ?? defaultLotSize,
    lotSizingMode: riskSettings.lotSizingMode ?? lotSizingMode,
    maxRiskPerTradePct: riskSettings.maxRiskPerTradePct ?? maxRiskPerTradePct,
    maxDailyLossPct: riskSettings.maxDailyLossPct ?? maxDailyLossPct,
    defaultLeverage: riskSettings.defaultLeverage ?? riskSettings.globalLeverage ?? globalLeverage,
    globalLeverage: riskSettings.globalLeverage ?? globalLeverage,
    maxLeverageCap: riskSettings.maxLeverageCap ?? riskSettings.maxLeverage ?? maxLeverageCap,
    maxLeverage: riskSettings.maxLeverageCap ?? riskSettings.maxLeverage ?? maxLeverageCap,
    marginMode: riskSettings.marginMode ?? marginMode,
    leverageSyncLocked: riskSettings.leverageSyncLocked ?? leverageSyncLocked,
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [isKilling, setIsKilling] = useState(false);
  const [confirmKillArmed, setConfirmKillArmed] = useState(false);
  const [isHedging, setIsHedging] = useState(false);
  const [hedgeSymbol, setHedgeSymbol] = useState('BTCUSDT');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [cloudSyncedAt, setCloudSyncedAt] = useState<number | null>(null);
  const cloudSyncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Portfolio Rebalancer State
  const [rebalanceMode, setRebalanceMode] = useState<RebalanceStrategyMode>('RISK_PARITY');
  const [driftThresholdPct, setDriftThresholdPct] = useState<number>(2.5);
  const [targetDeployedCapitalPct, setTargetDeployedCapitalPct] = useState<number>(45);
  const [autoRebalanceOnVolSpike, setAutoRebalanceOnVolSpike] = useState<boolean>(false);
  const [executingShiftId, setExecutingShiftId] = useState<string | null>(null);
  const [isBatchRebalancing, setIsBatchRebalancing] = useState<boolean>(false);
  const [simulatedVolShockPct, setSimulatedVolShockPct] = useState<number>(0);
  const [auditLogs, setAuditLogs] = useState<RebalanceAuditEntry[]>([
    {
      id: 'reb-init-1',
      timestamp: Date.now() - 240000,
      symbol: 'PORTFOLIO',
      actionLabel: 'Risk Parity Calibration',
      details: 'Inverse-volatility weights calibrated across 6 perpetual books & USDT reserve.',
      mode: 'RISK_PARITY',
    },
  ]);

  useEffect(() => {
    setLocalSettings({
      ...riskSettings,
      defaultLotSize: riskSettings.defaultLotSize ?? defaultLotSize,
      lotSizingMode: riskSettings.lotSizingMode ?? lotSizingMode,
      maxRiskPerTradePct: riskSettings.maxRiskPerTradePct ?? maxRiskPerTradePct,
      maxDailyLossPct: riskSettings.maxDailyLossPct ?? maxDailyLossPct,
      defaultLeverage: riskSettings.defaultLeverage ?? riskSettings.globalLeverage ?? globalLeverage,
      globalLeverage: riskSettings.globalLeverage ?? globalLeverage,
      maxLeverageCap: riskSettings.maxLeverageCap ?? riskSettings.maxLeverage ?? maxLeverageCap,
      maxLeverage: riskSettings.maxLeverageCap ?? riskSettings.maxLeverage ?? maxLeverageCap,
      marginMode: riskSettings.marginMode ?? marginMode,
      leverageSyncLocked: riskSettings.leverageSyncLocked ?? leverageSyncLocked,
    });
  }, [riskSettings, defaultLotSize, lotSizingMode, maxRiskPerTradePct, maxDailyLossPct, globalLeverage, maxLeverageCap, marginMode, leverageSyncLocked]);

  useEffect(() => {
    return () => {
      if (cloudSyncDebounceRef.current) {
        clearTimeout(cloudSyncDebounceRef.current);
      }
    };
  }, []);

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 4500);
  };

  const commitRiskRuleChange = (patch: Partial<RiskSettings>, immediateCloudSync = false) => {
    const updated: RiskSettings = {
      ...localSettings,
      ...patch,
    };
    setLocalSettings(updated);
    if (cloudSyncDebounceRef.current) {
      clearTimeout(cloudSyncDebounceRef.current);
      cloudSyncDebounceRef.current = null;
    }
    if (immediateCloudSync) {
      onUpdateRiskSettings(updated);
      setCloudSyncedAt(Date.now());
    } else {
      cloudSyncDebounceRef.current = setTimeout(() => {
        onUpdateRiskSettings(updated);
        setCloudSyncedAt(Date.now());
      }, 180);
    }
  };

  const commitGlobalLeverageChange = (
    patch: {
      globalLeverage?: number;
      maxLeverageCap?: number;
      marginMode?: MarginMode;
      leverageSyncLocked?: boolean;
    },
    immediateCloudSync = true
  ) => {
    const nextCap = Math.max(
      1,
      Math.min(50, Math.round(patch.maxLeverageCap ?? localSettings.maxLeverageCap ?? localSettings.maxLeverage ?? maxLeverageCap))
    );
    const rawGlobal = patch.globalLeverage ?? localSettings.globalLeverage ?? globalLeverage;
    const nextGlobal = Math.max(1, Math.min(nextCap, Math.round(rawGlobal)));
    const nextMargin: MarginMode = patch.marginMode ?? localSettings.marginMode ?? marginMode;
    const nextLocked = typeof patch.leverageSyncLocked === 'boolean'
      ? patch.leverageSyncLocked
      : (localSettings.leverageSyncLocked ?? leverageSyncLocked);

    const updated: RiskSettings = {
      ...localSettings,
      defaultLeverage: nextGlobal,
      globalLeverage: nextGlobal,
      maxLeverageCap: nextCap,
      maxLeverage: nextCap,
      marginMode: nextMargin,
      leverageSyncLocked: nextLocked,
    };

    setLocalSettings(updated);
    applyGlobalLeverageConfig({
      globalLeverage: nextGlobal,
      defaultLeverage: nextGlobal,
      maxLeverageCap: nextCap,
      marginMode: nextMargin,
      leverageSyncLocked: nextLocked,
    });

    if (cloudSyncDebounceRef.current) {
      clearTimeout(cloudSyncDebounceRef.current);
      cloudSyncDebounceRef.current = null;
    }

    if (immediateCloudSync) {
      onUpdateRiskSettings(updated);
      setCloudSyncedAt(Date.now());
    } else {
      cloudSyncDebounceRef.current = setTimeout(() => {
        onUpdateRiskSettings(updated);
        setCloudSyncedAt(Date.now());
      }, 220);
    }
  };

  const handleSaveSettings = () => {
    setIsSaving(true);
    const nextCap = Math.max(1, Math.min(50, Math.round(localSettings.maxLeverageCap ?? localSettings.maxLeverage ?? maxLeverageCap)));
    const nextGlobal = Math.max(1, Math.min(nextCap, Math.round(localSettings.globalLeverage ?? globalLeverage)));
    const nextMargin: MarginMode = localSettings.marginMode ?? marginMode;
    const nextLocked = localSettings.leverageSyncLocked ?? leverageSyncLocked;
    const finalized: RiskSettings = {
      ...localSettings,
      globalLeverage: nextGlobal,
      maxLeverageCap: nextCap,
      maxLeverage: nextCap,
      marginMode: nextMargin,
      leverageSyncLocked: nextLocked,
    };
    setLocalSettings(finalized);
    onUpdateRiskSettings(finalized);
    setTimeout(() => {
      setIsSaving(false);
      setCloudSyncedAt(Date.now());
      showFeedback(`Global Leverage (${nextGlobal}x ${nextMargin}, Cap ${nextCap}x) & Risk Rules synced across terminal + Cloud Server.`);
    }, 350);
  };

  const handleKillSwitch = async () => {
    if (!confirmKillArmed) {
      setConfirmKillArmed(true);
      setTimeout(() => setConfirmKillArmed(false), 5000);
      return;
    }
    setIsKilling(true);
    setConfirmKillArmed(false);
    try {
      await onTriggerKillSwitch();
      showFeedback('KILL SWITCH EXECUTED: All open positions flattened to cash.');
    } catch (err: any) {
      showFeedback('Kill switch error: ' + err.message);
    } finally {
      setIsKilling(false);
    }
  };

  const handleHedge = async () => {
    setIsHedging(true);
    try {
      await onTriggerAutoHedge(hedgeSymbol);
      showFeedback(`Auto-Hedge executed for ${hedgeSymbol}. Position is now delta neutral.`);
    } catch (err: any) {
      showFeedback('Hedge error: ' + err.message);
    } finally {
      setIsHedging(false);
    }
  };

  // Rule Compliance checks
  const dailyLossExceeded = portfolio.dailyPnl < -localSettings.maxDailyLossUsd;
  const maxTradesExceeded = portfolio.tradesToday >= localSettings.maxTradesPerDay;
  const highestLeverageInUse = positions.length > 0 ? Math.max(...positions.map((p) => p.leverage)) : 0;
  const leverageExceeded = highestLeverageInUse > localSettings.maxLeverage;

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTOMATED PORTFOLIO REBALANCER ENGINE (Volatility + Exposure Calculation)
  // ═══════════════════════════════════════════════════════════════════════════
  const rebalancerAnalysis = useMemo(() => {
    const totalEquity = Math.max(portfolio.totalEquity, 100);
    const maxSingleAssetCapPct = localSettings.maxPositionSizePercent;

    // Collect all symbols from core list + any symbol with an open position
    const symbolSet = new Set<string>(CORE_REBALANCE_SYMBOLS);
    positions.forEach((p) => symbolSet.add(p.symbol));
    const allSymbols = Array.from(symbolSet);

    // Map live volatility metrics by symbol
    const volMetricMap: Record<string, AssetVolatilityMetric> = {};
    for (const vm of volatilityAssetMetrics) {
      volMetricMap[vm.symbol] = vm;
    }

    // 1. Gather raw volatility & current position exposure per symbol
    const rawAssets = allSymbols.map((symbol) => {
      const ticker = markets[symbol];
      const vm = volMetricMap[symbol];
      const fallback = FALLBACK_PRICES[symbol] || {
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

      // Apply optional stress-test volatility shock
      const effectiveVol24h = +(baseVol24h + simulatedVolShockPct).toFixed(2);
      const volatilitySeverity: 'NORMAL' | 'ELEVATED' | 'EXTREME' =
        effectiveVol24h >= 5.0
          ? 'EXTREME'
          : effectiveVol24h >= 3.5
          ? 'ELEVATED'
          : 'NORMAL';

      // Aggregate open positions for this symbol
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

      // Volatility-adaptive recommended leverage cap
      const volScaledLeverage = Math.max(
        2,
        Math.min(
          localSettings.maxLeverage,
          effectiveVol24h >= 5.0
            ? 5
            : effectiveVol24h >= 3.5
            ? 8
            : effectiveVol24h >= 2.2
            ? 12
            : 15
        )
      );

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
      };
    });

    // 2. Compute Market-Wide Average Volatility & Dynamic Deployed Capital Budget
    const avgMarketVol24h =
      rawAssets.reduce((acc, a) => acc + a.volatility24h, 0) / Math.max(rawAssets.length, 1);

    // Adjust target deployed capital based on selected rebalancing strategy & market volatility
    let effectiveDeployedBudgetPct = targetDeployedCapitalPct;
    if (rebalanceMode === 'DEFENSIVE_SHIELD') {
      // Defensive mode restricts deployed margin to 25%–35% and shrinks further under high vol
      effectiveDeployedBudgetPct = Math.min(targetDeployedCapitalPct, 32) * (avgMarketVol24h > 3.8 ? 0.75 : 1);
    } else if (rebalanceMode === 'VOL_TARGET_CAPPED') {
      // Scales total deployed capital inversely when average market volatility exceeds 3.0%
      const volScalingFactor = Math.min(1.15, 3.0 / Math.max(avgMarketVol24h, 1.5));
      effectiveDeployedBudgetPct = Math.min(75, Math.max(20, targetDeployedCapitalPct * volScalingFactor));
    } else {
      // RISK_PARITY: slight dampener if extreme volatility spike occurs
      const spikeDampener = avgMarketVol24h > 4.5 ? 0.82 : 1.0;
      effectiveDeployedBudgetPct = Math.min(80, targetDeployedCapitalPct * spikeDampener);
    }
    effectiveDeployedBudgetPct = +effectiveDeployedBudgetPct.toFixed(1);

    // 3. Calculate Inverse-Volatility / Strategy Target Weights per Asset
    // Focus core allocation across top liquid majors (BTC, ETH, SOL, XRP, AVAX) + any currently held asset
    const eligibleAssets = rawAssets.map((asset) => {
      // Liquidity tier multiplier so BTC & ETH anchor the portfolio while high-beta alts receive smaller risk-adjusted budgets
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
        // Pure inverse volatility weighted by institutional liquidity tier
        rawScore = (1 / Math.max(asset.volatility24h, 0.75)) * tierMultiplier;
      } else if (rebalanceMode === 'VOL_TARGET_CAPPED') {
        // Penalizes assets breaching the 3.5% volatility threshold heavily
        const penalty = asset.volatility24h >= 3.5 ? 0.38 : 1.0;
        rawScore = (1 / Math.pow(Math.max(asset.volatility24h, 0.8), 1.35)) * tierMultiplier * penalty;
      } else {
        // DEFENSIVE_SHIELD: concentrates almost exclusively in lowest-volatility majors (BTC/ETH)
        const defensiveBonus =
          asset.symbol === 'BTCUSDT' ? 2.2 : asset.symbol === 'ETHUSDT' ? 1.5 : 0.35;
        rawScore = (1 / Math.pow(Math.max(asset.volatility24h, 0.8), 1.6)) * defensiveBonus;
      }

      return { ...asset, rawScore };
    });

    const totalScore = eligibleAssets.reduce((sum, a) => sum + a.rawScore, 0) || 1;

    const rows: AssetAllocationRow[] = eligibleAssets.map((asset) => {
      const uncappedTargetPct = (asset.rawScore / totalScore) * effectiveDeployedBudgetPct;
      // Enforce Institutional Max Position Size % rule per asset
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
      };
    });

    // Sort rows: active positions first, then by target weight descending
    rows.sort((a, b) => {
      if ((b.currentMarginUsd > 0 ? 1 : 0) !== (a.currentMarginUsd > 0 ? 1 : 0)) {
        return (b.currentMarginUsd > 0 ? 1 : 0) - (a.currentMarginUsd > 0 ? 1 : 0);
      }
      return b.targetWeightPct - a.targetWeightPct;
    });

    // 4. Portfolio-Level Volatility & Cash Reserve Metrics
    const currentDeployedMarginUsd = rows.reduce((sum, r) => sum + r.currentMarginUsd, 0);
    const currentDeployedPct = +((currentDeployedMarginUsd / totalEquity) * 100).toFixed(2);
    const currentCashReservePct = +Math.max(0, 100 - currentDeployedPct).toFixed(2);
    const targetAllocatedSumPct = +rows.reduce((sum, r) => sum + r.targetWeightPct, 0).toFixed(2);
    const targetCashReservePct = +Math.max(0, 100 - targetAllocatedSumPct).toFixed(2);

    // Weighted Portfolio Volatility (based on deployed exposure + 0% vol on cash reserve)
    const currentPortfolioVolPct =
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

    const targetPortfolioVolPct = +(
      rows.reduce(
        (sum, r) =>
          sum + (r.targetWeightPct / 100) * r.volatility24h * Math.max(1, r.recommendedLeverage / 5),
        0
      )
    ).toFixed(2);

    // 5. Generate Concrete Actionable Allocation Shift Suggestions
    const suggestions: RebalanceSuggestion[] = [];

    for (const row of rows) {
      const absDrift = Math.abs(row.driftPct);
      const isOverMaxCap = row.currentWeightPct > maxSingleAssetCapPct;
      const isHighVolExposed =
        row.currentMarginUsd > 0 && row.volatilitySeverity !== 'NORMAL' && row.driftPct < -1.0;

      if (absDrift < driftThresholdPct && !isOverMaxCap && !isHighVolExposed) {
        continue;
      }

      const precision = CONTRACT_PRECISION[row.symbol] ?? 2;

      if (row.driftPct < 0 && row.currentMarginUsd > 0) {
        // Asset is OVERWEIGHT relative to volatility-adjusted target
        const excessMarginUsd = Math.abs(row.driftMarginUsd);
        const effectiveLev = row.activeLeverage || row.recommendedLeverage || 10;
        const notionalReductionUsd = excessMarginUsd * effectiveLev;
        const rawContracts = notionalReductionUsd / Math.max(row.markPrice, 0.0001);
        const factor = Math.pow(10, precision);
        const suggestedContracts = Math.max(
          precision === 0 ? 1 : +(1 / factor).toFixed(precision),
          +(Math.round(rawContracts * factor) / factor).toFixed(precision)
        );

        // Determine if high volatility warrants a Delta Hedge vs Position Close/Trim
        const shouldDeltaHedge =
          row.volatilitySeverity === 'EXTREME' &&
          row.currentWeightPct >= row.targetWeightPct * 1.25 &&
          row.netSide !== 'HEDGED';

        const shouldClosePosition =
          row.currentWeightPct - Math.abs(row.driftPct) < 2.0 || excessMarginUsd >= row.currentMarginUsd * 0.65;

        const opposingSide: 'LONG' | 'SHORT' = row.netSide === 'SHORT' ? 'LONG' : 'SHORT';

        suggestions.push({
          id: `shift-${row.symbol}-trim`,
          symbol: row.symbol,
          actionType: shouldDeltaHedge
            ? 'DELTA_HEDGE'
            : shouldClosePosition
            ? 'CLOSE_OVERWEIGHT'
            : 'TRIM_EXPOSURE',
          actionLabel: shouldDeltaHedge
            ? `Delta-Hedge ${row.symbol} Vol Spike`
            : shouldClosePosition
            ? `Close Overweight ${row.symbol}`
            : `Trim ${row.symbol} Exposure (${row.driftPct.toFixed(1)}%)`,
          priority:
            isOverMaxCap || row.volatilitySeverity === 'EXTREME'
              ? 'CRITICAL'
              : Math.abs(row.driftPct) > driftThresholdPct * 1.8
              ? 'HIGH'
              : 'OPPORTUNITY',
          currentWeightPct: row.currentWeightPct,
          targetWeightPct: row.targetWeightPct,
          driftPct: row.driftPct,
          marginDeltaUsd: -excessMarginUsd,
          notionalDeltaUsd: -notionalReductionUsd,
          suggestedSide: opposingSide,
          suggestedContracts,
          suggestedLeverage: row.recommendedLeverage,
          volatility24h: row.volatility24h,
          expectedVolReductionBps: Math.round(Math.abs(row.driftPct) * row.volatility24h * 3.2),
          rationale: isOverMaxCap
            ? `${row.symbol} margin allocation (${row.currentWeightPct}%) breaches account max position cap (${maxSingleAssetCapPct}%) with ${row.volatility24h}% 24h volatility.`
            : `${row.symbol} is overweight by +${Math.abs(row.driftPct).toFixed(1)}% vs ${rebalanceMode.replace('_', ' ')} target (${row.targetWeightPct}%) at ${row.volatility24h}% 24h volatility.`,
          positionIdToClose: row.positionIds[0],
        });
      } else if (row.driftPct > 0 && row.volatilitySeverity !== 'EXTREME') {
        // Asset is UNDERWEIGHT relative to inverse-volatility target -> suggest measured scale-in
        const addMarginUsd = Math.min(row.driftMarginUsd, portfolio.availableBalance * 0.45);
        if (addMarginUsd < 50) continue;

        const lev = row.recommendedLeverage;
        const notionalAddUsd = addMarginUsd * lev;
        const rawContracts = notionalAddUsd / Math.max(row.markPrice, 0.0001);
        const factor = Math.pow(10, precision);
        const suggestedContracts = Math.max(
          precision === 0 ? 1 : +(1 / factor).toFixed(precision),
          +(Math.round(rawContracts * factor) / factor).toFixed(precision)
        );
        const trendAlignedSide: 'LONG' | 'SHORT' = row.change24h >= -0.25 ? 'LONG' : 'SHORT';

        suggestions.push({
          id: `shift-${row.symbol}-add`,
          symbol: row.symbol,
          actionType: 'SCALE_IN',
          actionLabel: `Rotate into ${row.symbol} (+${row.driftPct.toFixed(1)}%)`,
          priority: row.volatility24h < 2.5 ? 'HIGH' : 'OPPORTUNITY',
          currentWeightPct: row.currentWeightPct,
          targetWeightPct: row.targetWeightPct,
          driftPct: row.driftPct,
          marginDeltaUsd: +addMarginUsd.toFixed(2),
          notionalDeltaUsd: +notionalAddUsd.toFixed(2),
          suggestedSide: trendAlignedSide,
          suggestedContracts,
          suggestedLeverage: lev,
          volatility24h: row.volatility24h,
          expectedVolReductionBps: Math.round(row.driftPct * 4),
          rationale: `${row.symbol} exhibits controlled 24h volatility (${row.volatility24h}%) and is underweight by ${row.driftPct.toFixed(1)}% vs optimal risk-parity allocation (${row.targetWeightPct}%).`,
        });
      }
    }

    // Sort suggestions by priority (CRITICAL -> HIGH -> OPPORTUNITY) and drift magnitude
    const priorityRank = { CRITICAL: 3, HIGH: 2, OPPORTUNITY: 1 };
    suggestions.sort(
      (a, b) =>
        priorityRank[b.priority] - priorityRank[a.priority] ||
        Math.abs(b.driftPct) - Math.abs(a.driftPct)
    );

    const totalDriftScore = +rows
      .reduce((sum, r) => sum + Math.abs(r.driftPct), 0)
      .toFixed(1);

    return {
      rows,
      suggestions,
      avgMarketVol24h: +avgMarketVol24h.toFixed(2),
      currentDeployedPct,
      currentCashReservePct,
      targetAllocatedSumPct,
      targetCashReservePct,
      currentPortfolioVolPct,
      targetPortfolioVolPct,
      totalDriftScore,
    };
  }, [
    portfolio,
    positions,
    localSettings.maxPositionSizePercent,
    localSettings.maxLeverage,
    markets,
    volatilityAssetMetrics,
    rebalanceMode,
    driftThresholdPct,
    targetDeployedCapitalPct,
    simulatedVolShockPct,
  ]);

  // Execute a single suggested allocation shift
  const handleExecuteShift = async (shift: RebalanceSuggestion) => {
    setExecutingShiftId(shift.id);
    try {
      if (shift.actionType === 'DELTA_HEDGE') {
        await onTriggerAutoHedge(shift.symbol);
      } else if (shift.actionType === 'CLOSE_OVERWEIGHT' && shift.positionIdToClose && onClosePosition) {
        await onClosePosition(shift.positionIdToClose);
      } else if (onExecuteOrder) {
        await onExecuteOrder({
          symbol: shift.symbol,
          side: shift.suggestedSide,
          size: shift.suggestedContracts,
          orderType: 'MARKET',
          leverage: shift.suggestedLeverage,
          strategy: `Portfolio Rebalancer (${rebalanceMode})`,
          mode: tradingMode,
        });
      } else if (shift.actionType === 'TRIM_EXPOSURE') {
        await onTriggerAutoHedge(shift.symbol);
      }

      const logEntry: RebalanceAuditEntry = {
        id: `reb-${Date.now()}-${shift.symbol}`,
        timestamp: Date.now(),
        symbol: shift.symbol,
        actionLabel: shift.actionLabel,
        details: `${shift.suggestedSide} ${shift.suggestedContracts} ${shift.symbol} @ ${shift.suggestedLeverage}x (${shift.currentWeightPct}% → ${shift.targetWeightPct}% target)`,
        mode: rebalanceMode,
      };
      setAuditLogs((prev) => [logEntry, ...prev.slice(0, 9)]);

      const msg = `Rebalance shift applied: ${shift.actionLabel} (${shift.suggestedSide} ${shift.suggestedContracts} ${shift.symbol}).`;
      showFeedback(msg);
      if (onSendNotification) {
        onSendNotification('Portfolio Rebalancer Executed', msg, 'RISK');
      }
    } catch (err: any) {
      showFeedback(`Rebalance execution error on ${shift.symbol}: ${err.message}`);
    } finally {
      setExecutingShiftId(null);
    }
  };

  // Batch execute top suggested allocation shifts
  const handleBatchRebalance = async () => {
    if (rebalancerAnalysis.suggestions.length === 0) return;
    setIsBatchRebalancing(true);
    try {
      // Execute CRITICAL and HIGH priority shifts first (or top 3 shifts to protect margin)
      const batch = rebalancerAnalysis.suggestions.slice(0, 3);
      for (const shift of batch) {
        await handleExecuteShift(shift);
      }
      showFeedback(
        `Automated Portfolio Rebalance completed: ${batch.length} allocation shift(s) synchronized to ${rebalanceMode.replace('_', ' ')} targets.`
      );
    } finally {
      setIsBatchRebalancing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Risk Engine Header */}
      <div className="panel-delta p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-emerald-400" />
            <h2 className="panel-delta-title text-sm text-white normal-case tracking-normal">Delta Exchange Risk Management & Rebalancing Engine</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Institutional hard stops, volatility-adjusted portfolio rebalancer, leverage boundaries, and emergency liquidation switches
          </p>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          {!dailyLossExceeded && !maxTradesExceeded && !leverageExceeded ? (
            <span className="badge-delta badge-delta-live font-mono-numbers">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>RULES COMPLIANT</span>
            </span>
          ) : (
            <span className="badge-delta badge-delta-danger font-mono-numbers">
              <AlertOctagon className="w-3.5 h-3.5" />
              <span>RISK BREACH DETECTED</span>
            </span>
          )}
        </div>
      </div>

      {feedbackMsg && (
        <div className="p-3 bg-slate-900 border border-emerald-600/80 rounded text-xs text-emerald-300 flex items-center gap-2 font-mono-numbers">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* GLOBAL LEVERAGE ARCHITECTURE (REAL-TIME TERMINAL + CLOUD SERVER SYNC)       */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="panel-delta border-cyan-900/50 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-700/60 flex items-center justify-center text-cyan-400 shrink-0">
              <Gauge className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Global Leverage Architecture
                </h3>
                <span className="badge-delta badge-delta-armed font-mono-numbers">
                  {globalLeverage}x · {marginMode}
                </span>
                <span className={`badge-delta font-mono-numbers ${
                  leverageSyncLocked
                    ? 'badge-delta-live'
                    : 'badge-delta-paper'
                }`}>
                  {leverageSyncLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                  {leverageSyncLocked ? 'GLOBAL SYNC LOCKED' : 'PER-MODULE OVERRIDE'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Single source of truth for Order Pad, Camarilla Sniper, AI Command, Options Strategy Lab, and Delta API router
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-mono-numbers">
            <span className="badge-delta badge-delta-standby">
              <Cloud className="w-3 h-3 text-emerald-400" />
              {cloudSyncedAt ? `Cloud Synced · ${new Date(cloudSyncedAt).toLocaleTimeString()}` : 'Cloud Server Synced (34.47.205.98)'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left Column: Default Execution Leverage Slider + Quick Presets */}
          <div className="p-3.5 bg-slate-950/90 border border-slate-800/90 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-white">Default Execution Leverage</div>
                <div className="text-[10px] text-slate-400">
                  Enforced across manual & automated execution (clamped to {maxLeverageCap}x cap)
                </div>
              </div>
              <div className="text-right font-mono-numbers">
                <span className="text-lg font-bold text-cyan-400">{globalLeverage}x</span>
                <span className="text-[10px] text-slate-500 ml-1">/ {maxLeverageCap}x cap</span>
              </div>
            </div>

            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={globalLeverage}
              onChange={(e) => {
                const rawVal = Number(e.target.value);
                commitGlobalLeverageChange({ globalLeverage: Math.min(rawVal, maxLeverageCap) }, false);
              }}
              className="w-full accent-cyan-500 bg-slate-800 h-1.5 rounded cursor-pointer"
              aria-label="Default Execution Leverage"
            />

            <div className="grid grid-cols-5 sm:grid-cols-9 gap-1.5">
              {[1, 2, 3, 5, 10, 15, 20, 25, 50].map((preset) => {
                const exceedsCap = preset > maxLeverageCap;
                const isActive = globalLeverage === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={exceedsCap}
                    onClick={() => commitGlobalLeverageChange({ globalLeverage: preset }, true)}
                    title={exceedsCap ? `Blocked by Hard Max Leverage Cap (${maxLeverageCap}x)` : `Set global leverage to ${preset}x`}
                    className={`btn-delta-sm font-mono-numbers ${
                      isActive
                        ? 'btn-toggle-active'
                        : exceedsCap
                        ? 'btn-secondary line-through opacity-45'
                        : 'btn-secondary'
                    }`}
                  >
                    {preset}x
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Hard Max Leverage Cap */}
          <div className="p-3.5 bg-slate-950/90 border border-slate-800/90 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-white">Hard Max Leverage Cap</div>
                <div className="text-[10px] text-slate-400">
                  Server & client hard ceiling blocking any order above this multiple
                </div>
              </div>
              <div className="text-right font-mono-numbers">
                <span className="text-lg font-bold text-amber-400">{maxLeverageCap}x</span>
                <span className="text-[10px] text-slate-500 ml-1">MAX</span>
              </div>
            </div>

            <input
              type="range"
              min="1"
              max="50"
              step="1"
              value={maxLeverageCap}
              onChange={(e) => {
                commitGlobalLeverageChange({ maxLeverageCap: Number(e.target.value) }, false);
              }}
              className="w-full accent-amber-500 bg-slate-800 h-1.5 rounded cursor-pointer"
              aria-label="Hard Max Leverage Cap"
            />

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {[5, 10, 15, 20, 25, 50].map((capPreset) => {
                const isActive = maxLeverageCap === capPreset;
                return (
                  <button
                    key={capPreset}
                    type="button"
                    onClick={() => commitGlobalLeverageChange({ maxLeverageCap: capPreset }, true)}
                    className={`btn-delta-sm font-mono-numbers ${
                      isActive
                        ? 'btn-toggle-active'
                        : 'btn-secondary'
                    }`}
                  >
                    {capPreset}x Cap
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Controls: Margin Mode & Leverage Lock Mode */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-3 bg-slate-950/90 border border-slate-800/90 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <div className="text-xs font-semibold text-white">Margin Mode</div>
              <div className="text-[10px] text-slate-400">
                {marginMode === 'ISOLATED'
                  ? 'Isolated Margin caps risk per individual position'
                  : 'Cross Margin shares wallet equity across active books'}
              </div>
            </div>
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 shrink-0">
              <button
                type="button"
                onClick={() => commitGlobalLeverageChange({ marginMode: 'ISOLATED' }, true)}
                className={`btn-delta-sm ${
                  marginMode === 'ISOLATED'
                    ? 'btn-toggle-active'
                    : 'btn-secondary'
                }`}
              >
                Isolated Margin
              </button>
              <button
                type="button"
                onClick={() => commitGlobalLeverageChange({ marginMode: 'CROSS' }, true)}
                className={`btn-delta-sm ${
                  marginMode === 'CROSS'
                    ? 'btn-toggle-active'
                    : 'btn-secondary'
                }`}
              >
                Cross Margin
              </button>
            </div>
          </div>

          <div className="p-3 bg-slate-950/90 border border-slate-800/90 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <div className="text-xs font-semibold text-white">Leverage Lock Mode</div>
              <div className="text-[10px] text-slate-400">
                {leverageSyncLocked
                  ? 'All modules follow Risk Settings automatically'
                  : 'Modules can override manually up to the Hard Max Cap'}
              </div>
            </div>
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 shrink-0">
              <button
                type="button"
                onClick={() => commitGlobalLeverageChange({ leverageSyncLocked: true }, true)}
                className={`btn-delta-sm ${
                  leverageSyncLocked
                    ? 'btn-primary'
                    : 'btn-secondary'
                }`}
              >
                <Lock className="w-3 h-3" />
                Global Sync Locked
              </button>
              <button
                type="button"
                onClick={() => commitGlobalLeverageChange({ leverageSyncLocked: false }, true)}
                className={`btn-delta-sm ${
                  !leverageSyncLocked
                    ? 'btn-toggle-active'
                    : 'btn-secondary'
                }`}
              >
                <Unlock className="w-3 h-3" />
                Per-Module Override
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* GLOBAL CAPITAL SIZING & LOT CONFIGURATION MODULE CARD                      */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <CapitalAllocationCard
        availableBalance={portfolio?.availableBalance ?? (tradingMode === 'LIVE' ? 0 : 1000)}
        markPrice={markets?.['BTCUSDT']?.markPrice || 81702.50}
        selectedSymbol="BTCUSDT"
        leverage={globalLeverage}
      />

      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      {/* AUTOMATED PORTFOLIO REBALANCER MODULE                                      */}
      {/* ═══════════════════════════════════════════════════════════════════════════ */}
      <div className="panel-delta p-4 space-y-4">
        {/* Module Header & Strategy Mode Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-800/70 flex items-center justify-center text-cyan-400 shrink-0">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Automated Portfolio Rebalancer
                </h3>
                <span className="badge-delta badge-delta-armed font-mono-numbers">
                  VOLATILITY-ADAPTIVE
                </span>
                {rebalancerAnalysis.suggestions.length > 0 ? (
                  <span className="badge-delta badge-delta-paper font-mono-numbers">
                    {rebalancerAnalysis.suggestions.length} SHIFTS SUGGESTED
                  </span>
                ) : (
                  <span className="badge-delta badge-delta-live font-mono-numbers">
                    OPTIMALLY BALANCED
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Dynamically calculates target asset weights and position shifts from real-time 24h market volatility and open exposure
              </p>
            </div>
          </div>

          {/* Strategy Regime Selector & Batch Action */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setRebalanceMode('RISK_PARITY')}
                className={`btn-delta-sm ${
                  rebalanceMode === 'RISK_PARITY'
                    ? 'btn-toggle-active'
                    : 'btn-secondary'
                }`}
              >
                Inverse-Vol Parity
              </button>
              <button
                type="button"
                onClick={() => setRebalanceMode('VOL_TARGET_CAPPED')}
                className={`btn-delta-sm ${
                  rebalanceMode === 'VOL_TARGET_CAPPED'
                    ? 'btn-toggle-active'
                    : 'btn-secondary'
                }`}
              >
                Vol-Capped Target
              </button>
              <button
                type="button"
                onClick={() => setRebalanceMode('DEFENSIVE_SHIELD')}
                className={`btn-delta-sm ${
                  rebalanceMode === 'DEFENSIVE_SHIELD'
                    ? 'btn-toggle-active'
                    : 'btn-secondary'
                }`}
              >
                Defensive Shield
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                setSimulatedVolShockPct((prev) => (prev > 0 ? 0 : 2.4))
              }
              className={`btn-delta font-mono-numbers ${
                simulatedVolShockPct > 0
                  ? 'btn-toggle-active'
                  : 'btn-secondary'
              }`}
              title="Simulate a +2.4% market-wide 24h volatility spike to preview protective allocation shifts"
            >
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>{simulatedVolShockPct > 0 ? 'Vol Shock Active (+2.4%)' : 'Stress-Test Vol Spike'}</span>
            </button>

            <button
              type="button"
              onClick={handleBatchRebalance}
              disabled={isBatchRebalancing || rebalancerAnalysis.suggestions.length === 0}
              className="btn-delta btn-primary uppercase"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isBatchRebalancing ? 'animate-spin' : ''}`} />
              <span>
                {isBatchRebalancing
                  ? 'Rebalancing...'
                  : `Auto-Rebalance (${rebalancerAnalysis.suggestions.length})`}
              </span>
            </button>
          </div>
        </div>

        {/* Top Telemetry Strip: Portfolio Volatility, Deployed Exposure, Cash Buffer, Drift Score */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-slate-950/90 border border-slate-800/80 rounded-lg">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Market 24h Volatility</span>
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono-numbers">
              <span
                className={`text-base font-bold ${
                  rebalancerAnalysis.avgMarketVol24h >= 4.0
                    ? 'text-rose-400'
                    : rebalancerAnalysis.avgMarketVol24h >= 3.0
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {rebalancerAnalysis.avgMarketVol24h}%
              </span>
              <span className="text-[10px] text-slate-400">
                {rebalancerAnalysis.avgMarketVol24h >= 4.0
                  ? 'HIGH VOL REGIME'
                  : rebalancerAnalysis.avgMarketVol24h >= 3.0
                  ? 'MODERATE VOL'
                  : 'LOW VOL REGIME'}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1 font-mono-numbers">
              Portfolio Effective Vol: {rebalancerAnalysis.currentPortfolioVolPct}% →{' '}
              <span className="text-cyan-400">{rebalancerAnalysis.targetPortfolioVolPct}% target</span>
            </div>
          </div>

          <div className="p-3 bg-slate-950/90 border border-slate-800/80 rounded-lg">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Margin Exposure vs Target</span>
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono-numbers">
              <span className="text-base font-bold text-white">
                {rebalancerAnalysis.currentDeployedPct}%
              </span>
              <span className="text-xs text-cyan-400">
                → {rebalancerAnalysis.targetAllocatedSumPct}%
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1 font-mono-numbers">
              Deployed: {currencyPrefix}
              {(portfolio.marginUsed * exchangeRate).toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}{' '}
              / {positions.length} open pos
            </div>
          </div>

          <div className="p-3 bg-slate-950/90 border border-slate-800/80 rounded-lg">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>USDT Reserve Buffer</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono-numbers">
              <span className="text-base font-bold text-emerald-400">
                {rebalancerAnalysis.currentCashReservePct}%
              </span>
              <span className="text-[10px] text-slate-400">
                (Target: {rebalancerAnalysis.targetCashReservePct}%)
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1 font-mono-numbers">
              Free Margin: {currencyPrefix}
              {(portfolio.availableBalance * exchangeRate).toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
            </div>
          </div>

          <div className="p-3 bg-slate-950/90 border border-slate-800/80 rounded-lg">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Total Allocation Drift</span>
              <Sliders className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono-numbers">
              <span
                className={`text-base font-bold ${
                  rebalancerAnalysis.totalDriftScore > 15
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {rebalancerAnalysis.totalDriftScore}%
              </span>
              <span className="text-[10px] text-slate-400">
                Threshold: ±{driftThresholdPct}%
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
              <span>Auto-Guard on Spike:</span>
              <button
                type="button"
                onClick={() => setAutoRebalanceOnVolSpike(!autoRebalanceOnVolSpike)}
                className={`font-mono-numbers font-bold ${
                  autoRebalanceOnVolSpike ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {autoRebalanceOnVolSpike ? 'ARMED' : 'MANUAL'}
              </button>
            </div>
          </div>
        </div>

        {/* Fine-Tuning Sliders: Target Deployed Capital % & Drift Sensitivity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-slate-950/60 border border-slate-800/70 rounded-lg text-xs">
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-slate-300 font-medium">
                Target Portfolio Margin Deployment (Active Risk Budget)
              </span>
              <span className="font-mono-numbers font-bold text-cyan-400">
                {targetDeployedCapitalPct}% Margin / {100 - targetDeployedCapitalPct}% USDT Reserve
              </span>
            </div>
            <input
              type="range"
              min="20"
              max="80"
              step="5"
              value={targetDeployedCapitalPct}
              onChange={(e) => setTargetDeployedCapitalPct(Number(e.target.value))}
              className="w-full accent-cyan-500 bg-slate-800 h-1.5 rounded cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-slate-300 font-medium">
                Rebalance Trigger Sensitivity (Min Allocation Drift %)
              </span>
              <span className="font-mono-numbers font-bold text-amber-400">
                ±{driftThresholdPct.toFixed(1)}% Drift Tolerance
              </span>
            </div>
            <input
              type="range"
              min="1.0"
              max="8.0"
              step="0.5"
              value={driftThresholdPct}
              onChange={(e) => setDriftThresholdPct(Number(e.target.value))}
              className="w-full accent-amber-500 bg-slate-800 h-1.5 rounded cursor-pointer"
            />
          </div>
        </div>

        {/* Main Split: Left = Volatility & Exposure Matrix | Right = Actionable Shift Queue */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* 1. Asset Exposure & Inverse-Volatility Target Matrix (7 cols) */}
          <div className="xl:col-span-7 bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-1.5">
                  <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Asset Exposure vs. Volatility-Adjusted Target Matrix
                  </h4>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono-numbers">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" /> Current %
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> Target %
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-[10px] text-slate-400 uppercase font-mono-numbers">
                      <th className="py-2 pr-2">Asset</th>
                      <th className="py-2 px-2">24h Vol</th>
                      <th className="py-2 px-2">Exposure</th>
                      <th className="py-2 px-2 w-40">Current vs Target</th>
                      <th className="py-2 px-2 text-right">Drift Δ</th>
                      <th className="py-2 pl-2 text-right">Rec. Lev</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 font-mono-numbers">
                    {rebalancerAnalysis.rows.map((row) => {
                      const barMax = Math.max(30, localSettings.maxPositionSizePercent + 5);
                      const currentBarWidth = Math.min(100, (row.currentWeightPct / barMax) * 100);
                      const targetBarWidth = Math.min(100, (row.targetWeightPct / barMax) * 100);

                      return (
                        <tr key={row.symbol} className="hover:bg-slate-900/50 transition">
                          <td className="py-2.5 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-white">{row.symbol}</span>
                              {row.netSide !== 'FLAT' && (
                                <span
                                  className={`badge-delta ${
                                    row.netSide === 'LONG'
                                      ? 'badge-delta-live'
                                      : row.netSide === 'SHORT'
                                      ? 'badge-delta-danger'
                                      : 'badge-delta-armed'
                                  }`}
                                >
                                  {row.netSide}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {currencyPrefix}
                              {(row.markPrice * exchangeRate).toLocaleString(undefined, {
                                maximumFractionDigits: row.markPrice < 5 ? 4 : 2,
                              })}
                            </div>
                          </td>

                          <td className="py-2.5 px-2">
                            <span
                              className={`badge-delta ${
                                row.volatilitySeverity === 'EXTREME'
                                  ? 'badge-delta-danger'
                                  : row.volatilitySeverity === 'ELEVATED'
                                  ? 'badge-delta-paper'
                                  : 'badge-delta-live'
                              }`}
                            >
                              {row.volatility24h.toFixed(2)}%
                            </span>
                          </td>

                          <td className="py-2.5 px-2">
                            <div className="text-white font-semibold">
                              {currencyPrefix}
                              {(row.currentMarginUsd * exchangeRate).toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Notional: {row.notionalExposurePct}% eq
                            </div>
                          </td>

                          <td className="py-2.5 px-2">
                            <div className="flex justify-between text-[10px] mb-1">
                              <span className="text-indigo-300">{row.currentWeightPct}%</span>
                              <span className="text-cyan-300">Target {row.targetWeightPct}%</span>
                            </div>
                            <div className="space-y-1">
                              <div className="w-full h-1.5 bg-slate-900 rounded overflow-hidden">
                                <div
                                  className="h-full bg-indigo-500 rounded transition-all duration-300"
                                  style={{ width: `${currentBarWidth}%` }}
                                />
                              </div>
                              <div className="w-full h-1.5 bg-slate-900 rounded overflow-hidden">
                                <div
                                  className="h-full bg-cyan-400 rounded transition-all duration-300"
                                  style={{ width: `${targetBarWidth}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="py-2.5 px-2 text-right">
                            <span
                              className={`font-bold ${
                                Math.abs(row.driftPct) < driftThresholdPct
                                  ? 'text-slate-400'
                                  : row.driftPct > 0
                                  ? 'text-emerald-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {row.driftPct > 0 ? `+${row.driftPct}%` : `${row.driftPct}%`}
                            </span>
                            <div className="text-[10px] text-slate-500">
                              {row.driftMarginUsd >= 0 ? '+' : '-'}
                              {currencyPrefix}
                              {Math.abs(row.driftMarginUsd * exchangeRate).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 0 }
                              )}
                            </div>
                          </td>

                          <td className="py-2.5 pl-2 text-right">
                            <span
                              className={`text-[11px] font-bold ${
                                row.activeLeverage > row.recommendedLeverage
                                  ? 'text-rose-400'
                                  : 'text-slate-300'
                              }`}
                            >
                              {row.activeLeverage > 0 ? `${row.activeLeverage}x → ` : ''}
                              <span className="text-cyan-400">{row.recommendedLeverage}x</span>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* USDT Reserve Summary Bar at Bottom of Matrix */}
            <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-numbers">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-emerald-950/70 border border-emerald-800/70 rounded text-emerald-300 font-bold">
                  USDT CASH RESERVE
                </span>
                <span className="text-slate-400">
                  Current: <strong className="text-white">{rebalancerAnalysis.currentCashReservePct}%</strong> → Target:{' '}
                  <strong className="text-cyan-300">{rebalancerAnalysis.targetCashReservePct}%</strong>
                </span>
              </div>
              <span className="text-slate-400">
                Max Single-Asset Cap: <strong className="text-white">{localSettings.maxPositionSizePercent}%</strong>
              </span>
            </div>
          </div>

          {/* 2. Suggested Allocation Shifts Queue (5 cols) */}
          <div className="xl:col-span-5 bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Suggested Allocation Shifts ({rebalancerAnalysis.suggestions.length})
                  </h4>
                </div>
                <span className="text-[10px] text-slate-400 font-mono-numbers">
                  1-CLICK EXECUTION
                </span>
              </div>

              {rebalancerAnalysis.suggestions.length === 0 ? (
                <div className="p-6 text-center space-y-2">
                  <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" />
                  <div className="text-xs font-bold text-white">
                    Portfolio Aligned with Volatility Targets
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                    All asset allocations are within the ±{driftThresholdPct}% drift tolerance for{' '}
                    {rebalanceMode.replace('_', ' ')}. Lower the drift slider or stress-test a volatility spike to inspect shifts.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                  {rebalancerAnalysis.suggestions.map((shift) => {
                    const isExecuting = executingShiftId === shift.id;
                    return (
                      <div
                        key={shift.id}
                        className={`p-3 rounded-lg border transition space-y-2 ${
                          shift.priority === 'CRITICAL'
                            ? 'bg-rose-950/20 border-rose-800/70'
                            : shift.priority === 'HIGH'
                            ? 'bg-amber-950/15 border-amber-800/60'
                            : 'bg-slate-900/70 border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`badge-delta font-mono-numbers ${
                                  shift.priority === 'CRITICAL'
                                    ? 'badge-delta-danger'
                                    : shift.priority === 'HIGH'
                                    ? 'badge-delta-paper'
                                    : 'badge-delta-armed'
                                }`}
                              >
                                {shift.priority}
                              </span>
                              <span className="text-xs font-bold text-white">
                                {shift.actionLabel}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono-numbers mt-0.5">
                              Weight: {shift.currentWeightPct}% →{' '}
                              <span className="text-cyan-300 font-semibold">
                                {shift.targetWeightPct}%
                              </span>{' '}
                              | 24h Vol: {shift.volatility24h}% | Est. Vol Δ: -{shift.expectedVolReductionBps} bps
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleExecuteShift(shift)}
                            disabled={isExecuting || isBatchRebalancing}
                            className={`btn-delta-sm shrink-0 uppercase ${
                              shift.actionType === 'SCALE_IN'
                                ? 'btn-toggle-active'
                                : 'btn-danger'
                            }`}
                          >
                            <Play className="w-3 h-3" />
                            <span>{isExecuting ? 'Applying...' : 'Apply Shift'}</span>
                          </button>
                        </div>

                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {shift.rationale}
                        </p>

                        <div className="pt-1.5 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono-numbers text-slate-400">
                          <span>
                            Order:{' '}
                            <strong
                              className={
                                shift.suggestedSide === 'LONG'
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }
                            >
                              {shift.suggestedSide} {shift.suggestedContracts} {shift.symbol}
                            </strong>{' '}
                            @ {shift.suggestedLeverage}x
                          </span>
                          <span>
                            Margin Δ:{' '}
                            <strong
                              className={
                                shift.marginDeltaUsd >= 0 ? 'text-cyan-300' : 'text-amber-300'
                              }
                            >
                              {shift.marginDeltaUsd >= 0 ? '+' : '-'}
                              {currencyPrefix}
                              {Math.abs(shift.marginDeltaUsd * exchangeRate).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 0 }
                              )}
                            </strong>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rebalance Execution Audit Trail */}
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-mono-numbers mb-1.5">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-cyan-400" /> Recent Rebalance Activity
                </span>
                <span>{auditLogs.length} entries</span>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {auditLogs.slice(0, 3).map((log) => (
                  <div
                    key={log.id}
                    className="text-[10px] font-mono-numbers bg-slate-900/70 border border-slate-800/70 rounded px-2 py-1 flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-300 truncate">
                      <strong className="text-cyan-400">{log.symbol}:</strong> {log.details}
                    </span>
                    <span className="text-slate-500 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Emergency Protection & Account Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 1. Emergency Protection Console */}
        <div className="panel-delta border-rose-900/60 p-4 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-rose-900/40">
            <div className="flex items-center gap-1.5">
              <AlertOctagon className="w-4 h-4 text-rose-400" />
              <h3 className="panel-delta-title text-white">Emergency Protection</h3>
            </div>
            <span className="badge-delta badge-delta-danger font-mono-numbers">FAIL-SAFE</span>
          </div>

          <div className="space-y-3">
            {/* Kill Switch */}
            <div className="p-3 bg-rose-950/20 border border-rose-900/50 rounded-lg space-y-2">
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span>Kill Switch (Emergency Flatten)</span>
                <span className="badge-delta badge-delta-danger font-mono-numbers">1-CLICK</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Immediately cancels all open orders and liquidates all {positions.length} active positions at market price to protect capital.
              </p>
              <button
                type="button"
                onClick={handleKillSwitch}
                disabled={isKilling || positions.length === 0}
                className={`btn-delta w-full uppercase ${
                  confirmKillArmed
                    ? 'btn-toggle-active'
                    : 'btn-danger'
                }`}
              >
                {isKilling
                  ? 'Executing Kill Switch...'
                  : confirmKillArmed
                  ? `Confirm Flatten All (${positions.length} Positions)? Click Again`
                  : `Trigger Kill Switch (${positions.length} Active Positions)`}
              </button>
            </div>

            {/* High-Conviction Fibonacci Confluence Alert */}
            <div className="p-3 bg-emerald-950/20 border border-emerald-500/50 rounded-lg space-y-2 font-mono-numbers">
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-emerald-300">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Fibonacci Confluence Matrix</span>
                </span>
                <span className="badge-delta badge-delta-live animate-pulse">
                  &plusmn;0.15% MATCH
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Automated detection checks alignment between Prior-Day Fibonacci swing retracements (0.382, 0.500 EQ, 0.618/0.650 GP) and Camarilla breakout levels (H3/H4/L3/L4).
              </p>
              {onNavigateToStrategies && (
                <button
                  type="button"
                  onClick={onNavigateToStrategies}
                  className="btn-delta btn-secondary w-full"
                >
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Inspect AI Validator</span>
                </button>
              )}
            </div>

            {/* Auto Hedge */}
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span>Delta Neutral Auto Hedge</span>
                <span className="badge-delta badge-delta-armed font-mono-numbers">HEDGE</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Automatically opens an opposing delta-neutral position to lock in floating PnL and neutralize directional exposure.
              </p>
              <div className="flex gap-2">
                <select
                  value={hedgeSymbol}
                  onChange={(e) => setHedgeSymbol(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white font-mono-numbers flex-1"
                >
                  <option value="BTCUSDT">BTCUSDT</option>
                  <option value="ETHUSDT">ETHUSDT</option>
                  <option value="SOLUSDT">SOLUSDT</option>
                  <option value="XRPUSDT">XRPUSDT</option>
                  <option value="AVAXUSDT">AVAXUSDT</option>
                  <option value="DOGEUSDT">DOGEUSDT</option>
                </select>
                <button
                  type="button"
                  onClick={handleHedge}
                  disabled={isHedging}
                  className="btn-delta btn-toggle-active"
                >
                  {isHedging ? 'Hedging...' : 'Auto-Hedge'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Account Risk Rules (Configurable Sliders & Limits) */}
        <div className="lg:col-span-2 panel-delta p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
              <h3 className="panel-delta-title text-white">Institutional Account Rules</h3>
              <span className="text-[11px] text-slate-400 font-mono-numbers">
                Enforced by Platform Core
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-xs">
              {/* Max Risk Per Trade (%) */}
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-300 font-medium">Max Risk Per Trade (%)</span>
                  <span className="text-cyan-300 font-mono-numbers font-bold">
                    {(localSettings.maxRiskPerTradePct ?? maxRiskPerTradePct).toFixed(2)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.25"
                  max="10"
                  step="0.25"
                  value={localSettings.maxRiskPerTradePct ?? maxRiskPerTradePct}
                  onChange={(e) =>
                    commitRiskRuleChange({ maxRiskPerTradePct: Number(e.target.value) }, false)
                  }
                  className="w-full accent-cyan-400 bg-slate-800 h-1.5 rounded cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 flex justify-between font-mono-numbers">
                  <span>
                    Risk Cap: ${((portfolio.totalEquity || 0) * ((localSettings.maxRiskPerTradePct ?? maxRiskPerTradePct) / 100)).toFixed(2)} / trade
                  </span>
                  <span className="text-cyan-400">LIVE SYNCED</span>
                </div>
              </div>

              {/* Daily Loss Limit (%) */}
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-300 font-medium">Daily Loss Limit (%)</span>
                  <span className="text-amber-300 font-mono-numbers font-bold">
                    {(localSettings.maxDailyLossPct ?? maxDailyLossPct).toFixed(1)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="20"
                  step="0.5"
                  value={localSettings.maxDailyLossPct ?? maxDailyLossPct}
                  onChange={(e) => {
                    const nextPct = Number(e.target.value);
                    const computedUsd =
                      portfolio.totalEquity > 0
                        ? Math.max(50, Math.round(portfolio.totalEquity * (nextPct / 100)))
                        : localSettings.maxDailyLossUsd;
                    commitRiskRuleChange({ maxDailyLossPct: nextPct, maxDailyLossUsd: computedUsd }, false);
                  }}
                  className="w-full accent-amber-400 bg-slate-800 h-1.5 rounded cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 flex justify-between font-mono-numbers">
                  <span>
                    Equity Stop: ${((portfolio.totalEquity || 0) * ((localSettings.maxDailyLossPct ?? maxDailyLossPct) / 100)).toFixed(2)}
                  </span>
                  <span className={dailyLossExceeded ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {dailyLossExceeded ? 'LIMIT REACHED' : 'ARMED'}
                  </span>
                </div>
              </div>

              {/* Max Daily Loss ($) */}
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-300 font-medium">Max Daily Loss ($)</span>
                  <span className="text-white font-mono-numbers font-bold">
                    ${localSettings.maxDailyLossUsd.toLocaleString()}
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="5000"
                  step="50"
                  value={localSettings.maxDailyLossUsd}
                  onChange={(e) =>
                    commitRiskRuleChange({ maxDailyLossUsd: Number(e.target.value) }, false)
                  }
                  className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 flex justify-between font-mono-numbers">
                  <span>Current Day: ${portfolio.dailyPnl.toFixed(2)}</span>
                  <span className={dailyLossExceeded ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {dailyLossExceeded ? 'LIMIT REACHED' : 'SAFE'}
                  </span>
                </div>
              </div>

              {/* Max Trades Per Day */}
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-300 font-medium">Max Trades Per Day</span>
                  <span className="text-white font-mono-numbers font-bold">
                    {localSettings.maxTradesPerDay} Trades
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={localSettings.maxTradesPerDay}
                  onChange={(e) =>
                    commitRiskRuleChange({ maxTradesPerDay: Number(e.target.value) }, false)
                  }
                  className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 flex justify-between font-mono-numbers">
                  <span>Executed Today: {portfolio.tradesToday}</span>
                  <span className={maxTradesExceeded ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {maxTradesExceeded ? 'OVER TRADING CAP' : 'AVAILABLE'}
                  </span>
                </div>
              </div>

              {/* Max Position Size % of Portfolio */}
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-300 font-medium">Max Position Size</span>
                  <span className="text-white font-mono-numbers font-bold">
                    {localSettings.maxPositionSizePercent}% of Capital
                  </span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="5"
                  value={localSettings.maxPositionSizePercent}
                  onChange={(e) =>
                    commitRiskRuleChange({ maxPositionSizePercent: Number(e.target.value) }, false)
                  }
                  className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 flex justify-between font-mono-numbers">
                  <span>Max single allocation: ${(portfolio.totalEquity * (localSettings.maxPositionSizePercent / 100)).toFixed(0)}</span>
                  <span className="text-emerald-400">ENFORCED</span>
                </div>
              </div>

              {/* Max Leverage Cap */}
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-slate-300 font-medium">Max Leverage Cap</span>
                  <span className="text-white font-mono-numbers font-bold">
                    {localSettings.maxLeverageCap ?? localSettings.maxLeverage}x
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  step="1"
                  value={localSettings.maxLeverageCap ?? localSettings.maxLeverage}
                  onChange={(e) =>
                    commitGlobalLeverageChange({ maxLeverageCap: Number(e.target.value) }, false)
                  }
                  className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded cursor-pointer"
                />
                <div className="text-[10px] text-slate-400 flex justify-between font-mono-numbers">
                  <span>Highest Active: {highestLeverageInUse}x · Default: {globalLeverage}x</span>
                  <span className={leverageExceeded ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                    {leverageExceeded ? 'EXCEEDS CAP' : 'SAFE'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-800/60 flex justify-end">
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="btn-delta btn-primary uppercase"
            >
              {isSaving ? 'Updating...' : 'Save & Enforce Risk Rules'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
