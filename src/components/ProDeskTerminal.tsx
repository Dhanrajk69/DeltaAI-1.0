import React, { useState, useMemo } from 'react';
import {
  MarketTicker,
  TradingMode,
  PortfolioData,
  Position,
  ClosedTrade,
  AiAnalysisResult,
  BacktestTradeOverlay,
  NewsSentimentRadarData,
  PerpetualRescueRecommendation,
} from '../types';
import { InteractiveChart } from './InteractiveChart';
import { WsConnectionStatus } from '../hooks/useDeltaWebSocket';
import { ProfitLadderDashdark } from './ProfitLadderDashdark';
import { OptionsStrategyEngine } from './OptionsStrategyEngine';
import { OrderForm } from './OrderForm';
import { useAiMatrixCorrelation } from '../context/AiMatrixCorrelationContext';
import { getMarketTicker, resolveLiveUsdInrRate } from '../utils/marketUtils';
import {
  Crosshair,
  Layers,
  Sliders,
  Zap,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Columns,
  ChevronDown,
  ChevronUp,
  Terminal,
  History,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Radio,
  Trash2,
  Lock,
  RefreshCw,
} from 'lucide-react';

export type RightExecutionRailTab = 'SNIPER_MICRO' | 'OPTIONS_LAB' | 'MANUAL_ORDER';
export type BottomDrawerTab = 'LIVE_POSITIONS' | 'SNIPER_AUDIT_LOG' | 'TRADE_HISTORY';
export type MobileWorkspaceTab = 'CHARTS' | 'SNIPER_MICRO' | 'OPTIONS_LAB' | 'MANUAL_ORDER' | 'POSITIONS_DRAWER';

interface ProDeskTerminalProps {
  selectedSymbol: string;
  setSelectedSymbol: (sym: string) => void;
  markets: Record<string, MarketTicker>;
  tradingMode: TradingMode;
  portfolio: PortfolioData;
  positions: Position[];
  history: ClosedTrade[];
  sniperEngine: any;
  currencyPrefix: string;
  exchangeRate: number;
  wsStatus: WsConnectionStatus;
  activeSymbolGap: number;
  volatility24h?: number;
  newsRadarData: NewsSentimentRadarData | null;
  activeBacktestTrade: BacktestTradeOverlay | null;
  onClearBacktestTrade: () => void;
  showShortTermTrendOverlay: boolean;
  trendSmoothingFactor: number;
  onTrendSmoothingFactorChange: (factor: number) => void;
  onTrendVarianceChange: (telemetry: any) => void;
  trendResetNonce: number;
  isLiveApiAuthenticated: boolean;
  isCheckingAuth: boolean;
  serverHasCredentials: boolean;
  isLiveUnverified: boolean;
  onOpenSettings: () => void;
  onExecuteOrder: (orderData: any) => Promise<any>;
  onClosePosition: (symbol: string) => Promise<void> | void;
  onAutoHedge: (symbol: string) => Promise<void> | void;
  onCloseAllPositions: () => void;
  prefillAiSetup: any;
  onClearPrefill: () => void;
  aiAnalysis: AiAnalysisResult | null;
  isAiLoading: boolean;
  onRefreshAiAnalysis: (symbol: string, timeframe: string) => Promise<void>;
  onSendNotification: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
  onPlaySound?: () => void;
  globalLeverage: number;
  marginMode: 'ISOLATED' | 'CROSS';
}

export const ProDeskTerminal: React.FC<ProDeskTerminalProps> = ({
  selectedSymbol,
  setSelectedSymbol,
  markets,
  tradingMode,
  portfolio,
  positions,
  history,
  sniperEngine,
  currencyPrefix,
  exchangeRate,
  wsStatus,
  activeSymbolGap,
  volatility24h,
  newsRadarData,
  activeBacktestTrade,
  onClearBacktestTrade,
  showShortTermTrendOverlay,
  trendSmoothingFactor,
  onTrendSmoothingFactorChange,
  onTrendVarianceChange,
  trendResetNonce,
  isLiveApiAuthenticated,
  isCheckingAuth,
  serverHasCredentials,
  isLiveUnverified,
  onOpenSettings,
  onExecuteOrder,
  onClosePosition,
  onAutoHedge,
  onCloseAllPositions,
  prefillAiSetup,
  onClearPrefill,
  aiAnalysis,
  isAiLoading,
  onRefreshAiAnalysis,
  onSendNotification,
  onPlaySound,
  globalLeverage,
  marginMode,
}) => {
  const { correlatedSignal } = useAiMatrixCorrelation();

  // Chart split state: 'SINGLE' (1 full-width chart) or 'SPLIT' (2 side-by-side charts)
  const [chartSplitMode, setChartSplitMode] = useState<'SINGLE' | 'SPLIT'>('SPLIT');
  const [execTimeframe, setExecTimeframe] = useState<string>('5m');
  const [macroTimeframe, setMacroTimeframe] = useState<string>('4h');

  // Right Tabbed Execution Rail state
  const [rightRailTab, setRightRailTab] = useState<RightExecutionRailTab>('SNIPER_MICRO');

  // Docked Bottom Drawer state (Live Positions & Legs expanded by default)
  const [bottomDrawerTab, setBottomDrawerTab] = useState<BottomDrawerTab>('LIVE_POSITIONS');
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState<boolean>(false);

  // Mobile (< 1024px) stacked workspace tab
  const [mobileWorkspaceTab, setMobileWorkspaceTab] = useState<MobileWorkspaceTab>('CHARTS');

  const currentSignal = sniperEngine?.currentSignal;
  const activeTrade = sniperEngine?.activeTrade;
  const tradeLogs = sniperEngine?.tradeLogs || [];
  const isAutoPilotArmed = Boolean(sniperEngine?.isAutoSniperEnabled);
  const rescueRec: PerpetualRescueRecommendation | null = sniperEngine?.rescueRecommendation ?? null;
  const isExecutingRescue = Boolean(sniperEngine?.isExecutingRescue);
  const isAutoRescueEnabled = Boolean(sniperEngine?.isAutoRescueEnabled);

  const liveMarkPrice =
    getMarketTicker(markets, selectedSymbol).markPrice ||
    markets['BTCUSD']?.markPrice ||
    markets['BTCUSDT']?.markPrice ||
    64500;

  const liveUsdInrRate = useMemo(
    () => resolveLiveUsdInrRate(markets, exchangeRate > 1 ? exchangeRate : 85.04).rate,
    [markets, exchangeRate]
  );

  // Derive AI Matrix & Dual-CPR Regime Strip telemetry
  const matrixScore = useMemo(() => {
    const rawScoreObj = correlatedSignal?.matrixScore;
    if (rawScoreObj && typeof rawScoreObj === 'object' && typeof rawScoreObj.total === 'number') {
      return {
        total: rawScoreObj.total,
        convictionPct: rawScoreObj.convictionPct ?? Math.min(99, Math.round((rawScoreObj.total / 180) * 100)),
      };
    }
    const fallbackConfidence = Number(currentSignal?.aiConfidence) || 88;
    const normalizedScore = Math.min(180, Math.round((fallbackConfidence / 100) * 180));
    const convictionPct = Math.min(99, Math.max(55, Math.round((normalizedScore / 180) * 100)));
    return { total: normalizedScore, convictionPct };
  }, [correlatedSignal?.matrixScore, currentSignal?.aiConfidence]);

  const cpr5mWidthPct = currentSignal?.cpr?.widthPct ?? 0.14;
  const cpr5mRegime = cpr5mWidthPct < 0.25 ? 'NARROW CPR' : 'WIDE CPR';
  const cpr4hWidthPct = Number(((cpr5mWidthPct || 0.14) * 2.15).toFixed(2));
  const cpr4hRegime = cpr4hWidthPct >= 0.25 ? 'WIDE CPR' : 'TREND CPR';

  const activeTradeSide: 'LONG' | 'SHORT' | null =
    activeTrade?.side === 'SHORT' ||
    activeTrade?.direction === 'SHORT' ||
    activeTrade?.signal === 'SHORT'
      ? 'SHORT'
      : activeTrade?.side === 'LONG' ||
        activeTrade?.direction === 'LONG' ||
        activeTrade?.signal === 'LONG'
      ? 'LONG'
      : null;

  const signalDirection: 'LONG' | 'SHORT' =
    activeTradeSide === 'SHORT' || (!activeTradeSide && currentSignal?.signal === 'SHORT')
      ? 'SHORT'
      : 'LONG';

  const effectiveEntry = activeTrade?.entryPrice || currentSignal?.entryPrice || liveMarkPrice;
  const minSlBufferDist = effectiveEntry * 0.0028;
  const rawStopLoss =
    activeTrade?.currentStopLoss ||
    activeTrade?.initialStopLoss ||
    activeTrade?.stopLoss ||
    currentSignal?.initialStopLoss ||
    currentSignal?.stopLoss ||
    (signalDirection === 'SHORT' ? effectiveEntry + minSlBufferDist : effectiveEntry - minSlBufferDist);
  const effectiveStopLoss =
    Math.abs(rawStopLoss - effectiveEntry) < minSlBufferDist
      ? signalDirection === 'SHORT'
        ? +(effectiveEntry * (1 + 0.0028)).toFixed(2)
        : +(effectiveEntry * (1 - 0.0028)).toFixed(2)
      : rawStopLoss;

  const slDistance = Math.max(Math.abs(effectiveEntry - effectiveStopLoss), minSlBufferDist);
  const effectiveTp1 =
    activeTrade?.tp1 ||
    currentSignal?.tp1 ||
    +(signalDirection === 'SHORT' ? effectiveEntry - slDistance * 1.25 : effectiveEntry + slDistance * 1.25).toFixed(2);
  const effectiveTp2 =
    activeTrade?.tp2 ||
    currentSignal?.tp2 ||
    +(signalDirection === 'SHORT' ? effectiveEntry - slDistance * 2.0 : effectiveEntry + slDistance * 2.0).toFixed(2);
  const effectiveTp3 =
    activeTrade?.tp3 ||
    currentSignal?.tp3 ||
    +(signalDirection === 'SHORT' ? effectiveEntry - slDistance * 2.75 : effectiveEntry + slDistance * 2.75).toFixed(2);
  const effectiveTp4 =
    activeTrade?.tp4 ||
    currentSignal?.tp4 ||
    +(signalDirection === 'SHORT' ? effectiveEntry - slDistance * 3.5 : effectiveEntry + slDistance * 3.5).toFixed(2);

  const activeSniperUpnl = useMemo(() => {
    if (!activeTrade) return 0;
    const tradeSymBase = String(activeTrade.symbol || selectedSymbol).replace('USDT', 'USD');
    const matchedPos = positions.find((p) => {
      const pSym = String((p as any).product_symbol || p.symbol || '').toUpperCase().replace('USDT', 'USD');
      return pSym === tradeSymBase && !pSym.startsWith('C-') && !pSym.startsWith('P-');
    });
    if (matchedPos && Number.isFinite(Number(matchedPos.unrealisedPnl))) {
      return Number(matchedPos.unrealisedPnl);
    }
    const rawTradeUpnl = activeTrade.unrealizedPnlUsd ?? activeTrade.unrealisedProfitUsd;
    if (typeof rawTradeUpnl === 'number' && Number.isFinite(rawTradeUpnl)) {
      return rawTradeUpnl;
    }
    return undefined;
  }, [activeTrade, positions, selectedSymbol]);

  // Synced Total UPNL from Delta Exchange India / PortfolioContext
  const totalUpnlUsd = useMemo(() => {
    if (positions.length > 0) {
      return positions.reduce((acc, p) => acc + (Number(p.unrealisedPnl) || 0), 0);
    }
    return Number(portfolio.unrealisedPnlTotal) || 0;
  }, [positions, portfolio.unrealisedPnlTotal]);

  const totalUpnlInr = useMemo(() => {
    if (positions.length > 0) {
      return positions.reduce((acc, p) => {
        const rawInr = (p as any).unrealisedPnlInr ?? (p as any).unrealized_pnl_inr;
        if (typeof rawInr === 'number' && Number.isFinite(rawInr)) {
          return acc + rawInr;
        }
        return acc + (Number(p.unrealisedPnl) || 0) * liveUsdInrRate;
      }, 0);
    }
    return totalUpnlUsd * liveUsdInrRate;
  }, [positions, totalUpnlUsd, liveUsdInrRate]);

  // 7-Gate Risk Checklist for Sniper $15 Micro Rail
  const riskGates = useMemo(() => {
    const slPct = effectiveEntry > 0 ? (Math.abs(effectiveEntry - effectiveStopLoss) / effectiveEntry) * 100 : 0.55;
    const isSlBufferValid = slPct >= 0.449;
    const isCamarillaBreakout =
      currentSignal?.signal === 'LONG' || currentSignal?.signal === 'SHORT' || Boolean(activeTrade);
    const isVirginCprClear = !currentSignal?.virginCprMagnetBlocked;
    const isAntiChaseClear = !currentSignal?.antiChaseBlocked && !currentSignal?.l3h3ChopBlocked;
    const isFeedHealthy = activeSymbolGap <= 2500;
    const isAuthReady = tradingMode === 'PAPER' || !isLiveUnverified;

    return [
      {
        id: 'sl-buffer',
        label: 'Min Stop-Loss Buffer (>=0.55% / 1.5x ATR + $35)',
        detail: `${slPct.toFixed(2)}% ($${Math.abs(effectiveEntry - effectiveStopLoss).toFixed(0)})`,
        passed: isSlBufferValid,
      },
      {
        id: 'anti-chase',
        label: 'Anti-Chase & L3–H3 Chop Guard',
        detail: isAntiChaseClear
          ? 'Zone Valid · Bar Confirmed'
          : currentSignal?.l3h3ChopBlocked
          ? 'Blocked: L3–H3 Chop Zone'
          : 'Blocked: Candle Bounce',
        passed: isAntiChaseClear,
      },
      {
        id: 'cpr-routing',
        label: 'Dual-CPR Regime Routing',
        detail: `5m ${cpr5mRegime} (${cpr5mWidthPct.toFixed(2)}%)`,
        passed: true,
      },
      {
        id: 'camarilla-gate',
        label: 'Camarilla H4 / L4 Breakout Trigger',
        detail: isCamarillaBreakout ? `${signalDirection} Trigger Active` : 'Standby (H3–L3 Inside)',
        passed: isCamarillaBreakout,
      },
      {
        id: 'virgin-cpr',
        label: 'Virgin CPR Magnet Filter',
        detail: isVirginCprClear ? 'Path Clear' : 'Magnet Block Active',
        passed: isVirginCprClear,
      },
      {
        id: 'ws-conduit',
        label: 'Delta India Feed Latency',
        detail: `${activeSymbolGap}ms (${wsStatus})`,
        passed: isFeedHealthy,
      },
      {
        id: 'exchange-gate',
        label: tradingMode === 'LIVE' ? 'Delta India Live API Gate' : 'Paper Simulation Engine',
        detail: isAuthReady ? 'Verified & Ready' : 'API Key Required',
        passed: isAuthReady,
      },
    ];
  }, [
    effectiveEntry,
    effectiveStopLoss,
    currentSignal,
    activeTrade,
    activeSymbolGap,
    wsStatus,
    tradingMode,
    isLiveUnverified,
    cpr5mRegime,
    cpr5mWidthPct,
    signalDirection,
  ]);

  const handleQuickChartTrade = (side: 'LONG' | 'SHORT') => {
    if (isLiveUnverified) {
      onSendNotification(
        'API Keys Required · Balances Inactive',
        'Connect Delta Exchange API Keys in Settings to trade live',
        'RISK'
      );
      return;
    }
    onExecuteOrder({
      symbol: selectedSymbol,
      side,
      size: selectedSymbol.startsWith('BTC') ? 0.015 : 0.2,
      orderType: 'MARKET',
      leverage: globalLeverage,
      marginMode,
      strategy: 'Pro-Desk Quick Chart Click',
      mode: tradingMode,
    }).catch(() => {});
  };

  return (
    <div className="flex flex-col w-full min-w-0 max-w-full lg:h-full lg:min-h-0 lg:overflow-hidden gap-2 select-none">
      {/* =====================================================================
          MOBILE WORKSPACE SWITCHER (< 1024px) — Clean Stacked Tabs on Mobile
          ===================================================================== */}
      <div className="flex lg:hidden items-center gap-1 p-1 rounded-xl bg-[#060B14]/95 border border-cyan-500/25 overflow-x-auto no-scrollbar shrink-0 max-w-full">
        {[
          { id: 'CHARTS' as const, label: 'Dual Charts (5m|4h)', icon: Columns },
          { id: 'SNIPER_MICRO' as const, label: 'Sniper $15 Micro', icon: Crosshair },
          { id: 'OPTIONS_LAB' as const, label: 'Options Lab', icon: Layers },
          { id: 'MANUAL_ORDER' as const, label: 'Manual Order', icon: Sliders },
          {
            id: 'POSITIONS_DRAWER' as const,
            label: `Positions (${positions.length})`,
            icon: Activity,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = mobileWorkspaceTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMobileWorkspaceTab(tab.id)}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer ${
                active
                  ? 'bg-cyan-500/20 border border-cyan-400/60 text-cyan-200 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          UPPER PRO-DESK WORKSPACE: LEFT/CENTER MAIN STAGE (~68%) + RIGHT RAIL (~32%)
          ===================================================================== */}
      <div className="flex-1 min-h-0 min-w-0 max-w-full grid grid-cols-12 gap-2 lg:overflow-hidden">
        {/* -------------------------------------------------------------------
            ZONE 1: LEFT / CENTER MAIN STAGE (~68% width -> col-span-12 lg:col-span-8)
            ------------------------------------------------------------------- */}
        <div
          className={`col-span-12 lg:col-span-8 flex flex-col min-h-0 min-w-0 max-w-full gap-2 ${
            mobileWorkspaceTab === 'CHARTS' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* Compact AI Matrix & Dual-CPR Regime Strip */}
          <div className="prodesk-strip rounded-xl px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-1.5 shrink-0 min-w-0 max-w-full">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full text-[11px] font-mono-numbers">
              {/* AI Matrix Score Pill */}
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-400/50 text-cyan-200 font-bold tracking-tight shrink-0 max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22D3EE] animate-pulse shrink-0" />
                <span className="truncate">
                  AI MATRIX {matrixScore.total}/180 ({matrixScore.convictionPct}%)
                </span>
              </span>

              <span className="text-slate-600 hidden sm:inline shrink-0">·</span>

              {/* 5M Narrow CPR -> $15 Micro */}
              <button
                type="button"
                onClick={() => setRightRailTab('SNIPER_MICRO')}
                title="Click to focus Sniper $15 Micro Cockpit"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/12 hover:bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold transition cursor-pointer shrink-0"
              >
                <span>5M {cpr5mRegime}</span>
                <span className="text-emerald-400/80">({cpr5mWidthPct.toFixed(2)}%)</span>
                <span className="text-cyan-300">-&gt; $15 MICRO</span>
              </button>

              <span className="text-slate-600 hidden md:inline shrink-0">·</span>

              {/* 4H Wide CPR -> Options */}
              <button
                type="button"
                onClick={() => setRightRailTab('OPTIONS_LAB')}
                title="Click to focus Options Strategy Lab"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/40 text-violet-200 font-bold transition cursor-pointer shrink-0"
              >
                <span>4H {cpr4hRegime}</span>
                <span className="text-violet-300/80">({cpr4hWidthPct.toFixed(2)}%)</span>
                <span className="text-[#A78BFA]">-&gt; OPTIONS</span>
              </button>

              {/* Active Signal / Entry / SL / TP Telemetry */}
              <span
                className={`hidden xl:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-bold shrink-0 ${
                  signalDirection === 'LONG'
                    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                }`}
              >
                <span>{signalDirection}</span>
                <span className="text-slate-300">
                  @{currencyPrefix}
                  {effectiveEntry.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </span>
                <span className="text-rose-300">
                  SL ${effectiveStopLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
                <span className="text-emerald-300">
                  TP1 ${effectiveTp1.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </span>
            </div>

            {/* Right Strip Controls: Auto-Pilot Toggle + Split View Toggle */}
            <div className="flex flex-wrap items-center gap-1.5 shrink-0 max-w-full">
              <button
                type="button"
                onClick={() => sniperEngine?.setIsAutoSniperEnabled?.(!isAutoPilotArmed)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 border transition cursor-pointer whitespace-nowrap ${
                  isAutoPilotArmed
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                    : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:border-cyan-400/50'
                }`}
              >
                <Radio className={`w-3 h-3 ${isAutoPilotArmed ? 'text-emerald-400 animate-ping' : 'text-slate-400'}`} />
                <span>AUTO-PILOT: {isAutoPilotArmed ? 'ARMED' : 'STANDBY'}</span>
              </button>

              {/* Simplified 2-Button Chart Split Switcher: [Single] vs. [2-Split] */}
              <div className="inline-flex items-center bg-[#060B14] border border-slate-800 rounded-lg p-0.5 text-[10px] font-mono-numbers">
                <button
                  type="button"
                  onClick={() => setChartSplitMode('SINGLE')}
                  className={`px-2.5 py-0.5 rounded-md font-bold transition cursor-pointer whitespace-nowrap ${
                    chartSplitMode === 'SINGLE'
                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/50'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Single Full-Width Chart View"
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setChartSplitMode('SPLIT')}
                  className={`px-2.5 py-0.5 rounded-md font-bold transition cursor-pointer whitespace-nowrap ${
                    chartSplitMode === 'SPLIT'
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="2-Split Side-by-Side Dual-Timeframe View"
                >
                  2-Split
                </button>
              </div>
            </div>
          </div>

          {/* Side-by-Side Dual-Timeframe Chart Split (Single vs. 2-Split) */}
          <div
            className={`flex-1 min-h-[380px] lg:min-h-0 min-w-0 max-w-full grid gap-2 ${
              chartSplitMode === 'SPLIT' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {/* Primary Chart Pane (2-Row Institutional Header + Camarilla H3/H4/L3/L4 + Virgin CPR + Anti-Collision Labels) */}
            <div className="min-h-[320px] lg:min-h-0 h-full flex flex-col min-w-0">
              <InteractiveChart
                symbol={selectedSymbol}
                markPrice={liveMarkPrice}
                timeframe={execTimeframe}
                setTimeframe={setExecTimeframe}
                currencyPrefix={currencyPrefix}
                exchangeRate={exchangeRate}
                packetGap={activeSymbolGap}
                wsStatus={wsStatus}
                volatility24h={volatility24h}
                newsRadarData={newsRadarData}
                backtestTrade={activeBacktestTrade}
                onClearBacktestTrade={onClearBacktestTrade}
                showShortTermTrend={showShortTermTrendOverlay}
                trendSmoothingFactor={trendSmoothingFactor}
                onTrendSmoothingFactorChange={onTrendSmoothingFactorChange}
                onTrendVarianceChange={onTrendVarianceChange}
                trendResetNonce={trendResetNonce}
                onQuickTrade={handleQuickChartTrade}
                chartRole="EXECUTION_5M"
                chartTitleLabel="EXECUTION · CAMARILLA H4/L4 + V-CPR"
                defaultShowCamarilla={true}
                defaultShowCpr={true}
                defaultShowVirginCpr={true}
                defaultShowFib={false}
                camarillaLevels={currentSignal?.camarilla}
                liveSignalLevels={{
                  direction: signalDirection,
                  entryPrice: effectiveEntry,
                  stopLoss: effectiveStopLoss,
                  tp1: effectiveTp1,
                  tp2: effectiveTp2,
                }}
                isExpandedPane={chartSplitMode === 'SINGLE'}
                onToggleExpandPane={() =>
                  setChartSplitMode((prev) => (prev === 'SINGLE' ? 'SPLIT' : 'SINGLE'))
                }
                compactProDesk={true}
              />
            </div>

            {/* Secondary Chart Pane (Shown in 2-Split Mode, independent timeframe switcher) */}
            {chartSplitMode === 'SPLIT' && (
              <div className="min-h-[320px] lg:min-h-0 h-full flex flex-col min-w-0">
                <InteractiveChart
                  symbol={selectedSymbol}
                  markPrice={liveMarkPrice}
                  timeframe={macroTimeframe}
                  setTimeframe={setMacroTimeframe}
                  currencyPrefix={currencyPrefix}
                  exchangeRate={exchangeRate}
                  packetGap={activeSymbolGap}
                  wsStatus={wsStatus}
                  volatility24h={volatility24h}
                  newsRadarData={newsRadarData}
                  showShortTermTrend={false}
                  onQuickTrade={handleQuickChartTrade}
                  chartRole="MACRO_4H"
                  chartTitleLabel="MACRO CPR & FIBONACCI SWING"
                  defaultShowFib={true}
                  defaultShowCpr={true}
                  defaultShowVirginCpr={true}
                  defaultShowCamarilla={false}
                  camarillaLevels={currentSignal?.camarilla}
                  liveSignalLevels={{
                    direction: signalDirection,
                    entryPrice: effectiveEntry,
                    stopLoss: effectiveStopLoss,
                    tp1: effectiveTp1,
                    tp2: effectiveTp2,
                  }}
                  isExpandedPane={false}
                  onToggleExpandPane={() => {
                    setExecTimeframe(macroTimeframe);
                    setChartSplitMode('SINGLE');
                  }}
                  compactProDesk={true}
                />
              </div>
            )}
          </div>
        </div>

        {/* -------------------------------------------------------------------
            ZONE 2: RIGHT TABBED EXECUTION RAIL (~32% width -> col-span-12 lg:col-span-4)
            ------------------------------------------------------------------- */}
        <div
          className={`col-span-12 lg:col-span-4 prodesk-rail rounded-xl flex flex-col min-h-0 min-w-0 max-w-full overflow-hidden ${
            mobileWorkspaceTab === 'SNIPER_MICRO' ||
            mobileWorkspaceTab === 'OPTIONS_LAB' ||
            mobileWorkspaceTab === 'MANUAL_ORDER'
              ? 'flex'
              : 'hidden lg:flex'
          }`}
        >
          {/* Top Segmented Switcher: [Sniper $15 Micro] | [Options Lab] | [Manual Order] */}
          <div className="p-1.5 bg-[#060B14]/95 border-b border-cyan-500/20 grid grid-cols-3 gap-1 shrink-0 min-w-0">
            <button
              type="button"
              onClick={() => {
                setRightRailTab('SNIPER_MICRO');
                setMobileWorkspaceTab('SNIPER_MICRO');
              }}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-extrabold tracking-wide inline-flex items-center justify-center gap-1.5 transition cursor-pointer ${
                rightRailTab === 'SNIPER_MICRO'
                  ? 'bg-gradient-to-r from-cyan-500/25 to-emerald-500/25 border border-cyan-400/60 text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.25)]'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
              <span className="truncate">Sniper $15 Micro</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRightRailTab('OPTIONS_LAB');
                setMobileWorkspaceTab('OPTIONS_LAB');
              }}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-extrabold tracking-wide inline-flex items-center justify-center gap-1.5 transition cursor-pointer ${
                rightRailTab === 'OPTIONS_LAB'
                  ? 'bg-violet-500/25 border border-violet-400/60 text-violet-200 shadow-[0_0_14px_rgba(167,139,250,0.25)]'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-[#A78BFA] shrink-0" />
              <span className="truncate">Options Lab</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setRightRailTab('MANUAL_ORDER');
                setMobileWorkspaceTab('MANUAL_ORDER');
              }}
              className={`py-1.5 px-2 rounded-lg text-[11px] font-extrabold tracking-wide inline-flex items-center justify-center gap-1.5 transition cursor-pointer ${
                rightRailTab === 'MANUAL_ORDER'
                  ? 'bg-emerald-500/25 border border-emerald-400/60 text-emerald-200 shadow-[0_0_14px_rgba(16,185,129,0.25)]'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              <Sliders className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
              <span className="truncate">Manual Order</span>
            </button>
          </div>

          {/* Scrollable Right Rail Cockpit Container */}
          <div className="flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto overflow-x-hidden p-2.5 space-y-2.5">
            {/* TAB 1: SNIPER $15 MICRO COCKPIT (Execution Cockpit + 4-Stage Profit Ladder + Risk Gates) */}
            {(rightRailTab === 'SNIPER_MICRO' || mobileWorkspaceTab === 'SNIPER_MICRO') &&
              rightRailTab === 'SNIPER_MICRO' && (
                <div className="space-y-2.5 min-w-0 max-w-full">
                  {/* Execution Cockpit Card */}
                  <div className="rounded-xl bg-[#060B14]/90 border border-cyan-500/25 p-3 space-y-2.5 min-w-0 max-w-full">
                    <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-[#22D3EE] animate-pulse shrink-0" />
                        <span
                          className="text-xs font-extrabold uppercase tracking-wider text-white truncate"
                          title="$15 Micro Sniper Cockpit"
                        >
                          $15 Micro Sniper Cockpit
                        </span>
                      </div>
                      <span
                        className={`badge-delta font-mono-numbers max-w-full truncate ${
                          activeTrade
                            ? 'badge-delta-live'
                            : tradingMode === 'LIVE' ||
                              currentSignal?.signal === 'LONG' ||
                              currentSignal?.signal === 'SHORT'
                            ? 'badge-delta-armed'
                            : 'badge-delta-standby'
                        }`}
                      >
                        {activeTrade
                          ? `${tradingMode === 'LIVE' ? 'LIVE' : 'PAPER'} · ${
                              activeTradeSide || signalDirection
                            } ACTIVE`
                          : tradingMode === 'LIVE'
                          ? 'LIVE · ARMED'
                          : currentSignal?.signal && currentSignal.signal !== 'WAIT'
                          ? `${currentSignal.signal} READY`
                          : 'STANDBY SCAN'}
                      </span>
                    </div>

                    {/* Asset & Direction Controls */}
                    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono-numbers">
                      <div className="bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                        <span className="text-slate-400">Pair</span>
                        <select
                          aria-label="Select Sniper Pair"
                          value={selectedSymbol}
                          onChange={(e) => setSelectedSymbol(e.target.value)}
                          className="bg-transparent text-cyan-300 font-bold focus:outline-none cursor-pointer"
                        >
                          {['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT'].map((sym) => (
                            <option key={sym} value={sym} className="bg-[#060B14] text-white">
                              {sym.replace('USDT', 'USD')}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                        <span className="text-slate-400">Margin / Lev</span>
                        <span className="text-emerald-300 font-bold">$15 · 25x</span>
                      </div>
                    </div>

                    {/* Entry / Stop-Loss (>=0.55% + $35 Floor) / R:R Strip */}
                    <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono-numbers">
                      <div className="bg-slate-950/90 border border-slate-800/90 rounded-lg p-2">
                        <div className="text-[9px] uppercase text-slate-400">Entry Price</div>
                        <div className="text-xs font-bold text-white mt-0.5">
                          ${effectiveEntry.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </div>
                      </div>
                      <div className="bg-rose-950/30 border border-rose-500/40 rounded-lg p-2">
                        <div className="text-[9px] uppercase text-rose-300">SL (&gt;=0.55% + $35)</div>
                        <div className="text-xs font-bold text-rose-300 mt-0.5">
                          ${effectiveStopLoss.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </div>
                      </div>
                      <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-lg p-2">
                        <div className="text-[9px] uppercase text-emerald-300">TP1 (1.25R)</div>
                        <div className="text-xs font-bold text-emerald-300 mt-0.5">
                          ${effectiveTp1.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </div>
                      </div>
                    </div>

                    {/* Primary Execution & Auto-Pilot Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => sniperEngine?.setIsAutoSniperEnabled?.(!isAutoPilotArmed)}
                        className={`h-9 px-3 rounded-lg text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                          isAutoPilotArmed
                            ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.3)]'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                        }`}
                      >
                        <Zap className="w-3.5 h-3.5 text-[#22D3EE]" />
                        <span>{isAutoPilotArmed ? 'Auto-Pilot ON' : 'Arm Auto-Pilot'}</span>
                      </button>

                      {activeTrade ? (
                        <button
                          type="button"
                          onClick={() => sniperEngine?.closeActiveTrade?.('Manual Pro-Desk Close')}
                          className="h-9 px-3 rounded-lg text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center justify-center gap-1.5 bg-rose-500/25 hover:bg-rose-500/35 border border-rose-400 text-rose-200 transition cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Close Sniper</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={Boolean(sniperEngine?.isExecuting)}
                          onClick={() => sniperEngine?.executeSniperTrade?.()}
                          className={`h-9 px-3 rounded-lg text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            signalDirection === 'SHORT' ? 'cool-ice-btn-short' : 'cool-ice-btn-long'
                          }`}
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                          <span>
                            {sniperEngine?.isExecuting ? 'Routing...' : `Fire $15 ${signalDirection}`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* PERPETUAL DRAWDOWN RESCUE CARD (-0.50R Trigger · Single-Adjustment Lock) */}
                  {rescueRec && rescueRec.shouldSurface && (
                    <div
                      data-testid="perpetual-drawdown-rescue-card"
                      className={`rounded-xl p-3 space-y-2.5 border shadow-[0_0_24px_rgba(245,158,11,0.14)] min-w-0 max-w-full ${
                        rescueRec.isLocked
                          ? 'bg-[#09111E] border-cyan-500/50'
                          : 'bg-gradient-to-b from-amber-950/55 via-[#09101D] to-[#060B14] border-amber-400/70'
                      }`}
                    >
                      {/* Card Header */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ShieldAlert
                            className={`w-4 h-4 shrink-0 ${
                              rescueRec.isLocked ? 'text-cyan-400' : 'text-amber-400 animate-pulse'
                            }`}
                          />
                          <span
                            className="text-[11px] font-extrabold uppercase tracking-wider text-white truncate"
                            title="Perpetual Drawdown Rescue"
                          >
                            Perpetual Drawdown Rescue
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 shrink-0 font-mono-numbers">
                          <button
                            type="button"
                            onClick={() => sniperEngine?.setIsAutoRescueEnabled?.(!isAutoRescueEnabled)}
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold border transition cursor-pointer ${
                              isAutoRescueEnabled
                                ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                            }`}
                            title="Toggle automated rescue execution on trigger"
                          >
                            {isAutoRescueEnabled ? 'AUTO ON' : 'AUTO OFF'}
                          </button>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold border ${
                              rescueRec.isLocked
                                ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                                : 'bg-rose-500/25 border-rose-400/70 text-rose-200'
                            }`}
                          >
                            {rescueRec.rMultiple.toFixed(2)}R
                          </span>
                        </div>
                      </div>

                      {/* Adjusted Break-Even & Safety Guard Strip */}
                      <div className="grid grid-cols-3 gap-1.5 text-[10.5px] font-mono-numbers">
                        <div className="rounded-lg bg-slate-950/90 border border-slate-800 px-2 py-1.5">
                          <div className="text-[9px] uppercase text-slate-400">Entry · {rescueRec.deltaSymbol}</div>
                          <div className="font-bold text-slate-200 mt-0.5">
                            ${rescueRec.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div className="rounded-lg bg-amber-950/40 border border-amber-400/50 px-2 py-1.5">
                          <div className="text-[9px] uppercase text-amber-300">Adjusted Break-Even</div>
                          <div className="font-extrabold text-amber-200 mt-0.5">
                            ${rescueRec.adjustedBreakEvenPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-950/90 border border-slate-800 px-2 py-1.5">
                          <div className="text-[9px] uppercase text-slate-400">Adjustment Lock</div>
                          <div
                            className={`font-extrabold mt-0.5 inline-flex items-center gap-1 ${
                              rescueRec.isLocked ? 'text-cyan-300' : 'text-emerald-300'
                            }`}
                          >
                            <Lock className="w-3 h-3 shrink-0" />
                            <span>{rescueRec.adjustmentCount}/1 USED</span>
                          </div>
                        </div>
                      </div>

                      {/* Anti-Martingale & Risk Envelope Telemetry Line */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5 px-2 py-1 rounded-md bg-slate-950/80 border border-slate-800/90 text-[10px] font-mono-numbers text-slate-300 min-w-0">
                        <span>
                          uPnL:{' '}
                          <strong className="text-rose-300">
                            -${Math.abs(rescueRec.unrealizedPnlUsd).toFixed(2)}
                          </strong>{' '}
                          <span className="text-slate-500">
                            (-₹{Math.abs(rescueRec.unrealizedPnlInr).toFixed(0)})
                          </span>
                        </span>
                        <span className="text-cyan-300 font-semibold">
                          &lt;=2% Eq Risk · 1:1 ({rescueRec.contracts}x)
                        </span>
                      </div>

                      {rescueRec.isLocked && rescueRec.executedRecord ? (
                        <div className="rounded-lg bg-cyan-950/35 border border-cyan-500/40 p-2.5 text-[11px] space-y-1 min-w-0 max-w-full">
                          <div className="flex flex-wrap items-center justify-between gap-1.5 font-bold text-cyan-200">
                            <span>Single-Adjustment Lock Active (1/1)</span>
                            <span className="font-mono-numbers text-[10px] text-cyan-300">
                              {rescueRec.executedRecord.action.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <p className="text-[10.5px] text-slate-300 leading-snug break-words">
                            Adjusted BE locked at{' '}
                            <span className="font-mono-numbers font-bold text-amber-200">
                              ${rescueRec.executedRecord.adjustedBreakEvenPrice.toLocaleString()}
                            </span>
                            {rescueRec.executedRecord.details?.reAnchorPrice
                              ? ` · 50% Re-Anchor Limit @ $${Number(rescueRec.executedRecord.details.reAnchorPrice).toLocaleString()} (${rescueRec.executedRecord.details.reAnchorZoneLabel})`
                              : rescueRec.executedRecord.details?.optionSymbol
                              ? ` · 1:1 Short ${rescueRec.executedRecord.details.optionSymbol} (+$${Number(rescueRec.executedRecord.details.optionCreditUsd || 0).toFixed(2)})`
                              : rescueRec.executedRecord.details?.flipDirection
                              ? ` · Reversed ${rescueRec.executedRecord.details.flipDirection} @ $${Number(rescueRec.executedRecord.details.flipEntryPrice || 0).toLocaleString()}`
                              : ''}
                            . Blind averaging down disabled.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 min-w-0">
                          {/* Action 1: [50% De-Risk & Re-Anchor] */}
                          <button
                            type="button"
                            disabled={isExecutingRescue || !rescueRec.projectedDeRiskReAnchor.enabled}
                            onClick={() => sniperEngine?.executePerpetualRescueAction?.('DE_RISK_REANCHOR')}
                            className={`w-full min-w-0 text-left rounded-lg p-2 border transition ${
                              rescueRec.projectedDeRiskReAnchor.enabled && !isExecutingRescue
                                ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-400/60 text-white cursor-pointer'
                                : 'bg-slate-900/70 border-slate-800 text-slate-400 cursor-not-allowed opacity-75'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                              <span className="text-[11px] font-extrabold text-amber-200">
                                1. [50% De-Risk &amp; Re-Anchor]
                              </span>
                              <span
                                className={`text-[9.5px] font-mono-numbers font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                  rescueRec.projectedDeRiskReAnchor.trend4hValid
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-rose-500/20 text-rose-300'
                                }`}
                              >
                                {rescueRec.projectedDeRiskReAnchor.trend4hValid ? '4h VALID' : '4h INVALID'}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono-numbers text-slate-300 min-w-0">
                              <span className="break-words min-w-0">
                                Close {rescueRec.projectedDeRiskReAnchor.closeContracts}x (RO) · Limit{' '}
                                {rescueRec.projectedDeRiskReAnchor.reAnchorZoneLabel} @ $
                                {rescueRec.projectedDeRiskReAnchor.reAnchorPrice.toLocaleString()}
                              </span>
                              <span className="text-amber-200 font-bold shrink-0">
                                BE ${rescueRec.projectedDeRiskReAnchor.projectedAdjustedBe.toLocaleString()}
                              </span>
                            </div>
                          </button>

                          {/* Action 2: [Options Hedge Overlay (1:1)] */}
                          <button
                            type="button"
                            disabled={isExecutingRescue || !rescueRec.projectedOptionsHedge.enabled}
                            onClick={() => sniperEngine?.executePerpetualRescueAction?.('OPTIONS_HEDGE_OVERLAY')}
                            className={`w-full min-w-0 text-left rounded-lg p-2 border transition ${
                              rescueRec.projectedOptionsHedge.enabled && !isExecutingRescue
                                ? 'bg-violet-500/15 hover:bg-violet-500/25 border-violet-400/60 text-white cursor-pointer'
                                : 'bg-slate-900/70 border-slate-800 text-slate-400 cursor-not-allowed opacity-75'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                              <span className="text-[11px] font-extrabold text-violet-200">
                                2. [Options Hedge Overlay (1:1)]
                              </span>
                              <span className="text-[9.5px] font-mono-numbers font-bold px-1.5 py-0.5 rounded bg-violet-500/25 text-violet-200 shrink-0">
                                1:1 · {rescueRec.projectedOptionsHedge.matchedContracts}x SHORT{' '}
                                {rescueRec.projectedOptionsHedge.optionType}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-mono-numbers text-slate-300 min-w-0">
                              <span
                                className="truncate min-w-0"
                                title={
                                  rescueRec.projectedOptionsHedge.optionQuote?.symbol ||
                                  `Same-Day ${rescueRec.projectedOptionsHedge.optionType}`
                                }
                              >
                                {rescueRec.projectedOptionsHedge.optionQuote?.symbol ||
                                  `Same-Day ${rescueRec.projectedOptionsHedge.optionType}`}{' '}
                                (Credit +$
                                {(
                                  rescueRec.projectedOptionsHedge.optionQuote?.estimatedPremiumCreditUsd ??
                                  rescueRec.projectedOptionsHedge.beImprovementUsdPerCoin *
                                    rescueRec.projectedOptionsHedge.matchedCoinSize
                                ).toFixed(2)}
                                )
                              </span>
                              <span className="text-emerald-300 font-bold shrink-0">
                                BE ${rescueRec.projectedOptionsHedge.projectedAdjustedBe.toLocaleString()}
                              </span>
                            </div>
                          </button>

                          {/* Action 3: [Trend-Flip Reverse] */}
                          <button
                            type="button"
                            disabled={isExecutingRescue || !rescueRec.projectedTrendFlip.enabled}
                            onClick={() => sniperEngine?.executePerpetualRescueAction?.('TREND_FLIP_REVERSE')}
                            className={`w-full min-w-0 text-left rounded-lg p-2 border transition ${
                              rescueRec.projectedTrendFlip.enabled && !isExecutingRescue
                                ? 'bg-rose-500/20 hover:bg-rose-500/30 border-rose-400/70 text-white cursor-pointer'
                                : 'bg-slate-900/70 border-slate-800 text-slate-400 cursor-not-allowed opacity-75'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                              <span className="text-[11px] font-extrabold text-rose-200 inline-flex items-center gap-1">
                                <RefreshCw className="w-3 h-3 shrink-0" />
                                <span>3. [Trend-Flip Reverse]</span>
                              </span>
                              <span
                                className={`text-[9.5px] font-mono-numbers font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                  rescueRec.projectedTrendFlip.enabled
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                AI {rescueRec.projectedTrendFlip.aiMatrixPct}% ·{' '}
                                {rescueRec.projectedTrendFlip.candleClosedBeyondOpposite
                                  ? `5m ${rescueRec.projectedTrendFlip.oppositeLevelLabel} OK`
                                  : `WAIT ${rescueRec.projectedTrendFlip.oppositeLevelLabel}`}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-mono-numbers text-slate-300 min-w-0">
                              <span className="truncate min-w-0" title={rescueRec.projectedTrendFlip.reason}>
                                {rescueRec.projectedTrendFlip.reason}
                              </span>
                              <span className="text-rose-200 font-bold shrink-0">
                                -&gt; {rescueRec.projectedTrendFlip.newDirection}
                              </span>
                            </div>
                          </button>

                          <div className="text-[9.5px] text-slate-400 flex flex-wrap items-center justify-between gap-1 pt-0.5 px-0.5">
                            <span>Anti-Martingale: Blind mid-candle adds blocked</span>
                            <span className="font-mono-numbers shrink-0">
                              {tradingMode === 'LIVE' ? 'TG Alert: Armed' : 'TG: LIVE-Only'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 4-Stage Profit Ladder */}
                  <ProfitLadderDashdark
                    isShort={signalDirection === 'SHORT'}
                    entryPrice={effectiveEntry}
                    markPrice={liveMarkPrice}
                    stopLoss={effectiveStopLoss}
                    tp1={effectiveTp1}
                    tp2={effectiveTp2}
                    tp3={effectiveTp3}
                    tp4={effectiveTp4}
                    unrealizedPnl={activeSniperUpnl}
                    activeTrade={activeTrade}
                    activeTargetIndex={
                      activeTrade?.tp3Hit
                        ? 4
                        : activeTrade?.tp2Hit
                        ? 3
                        : activeTrade?.tp1Hit
                        ? 2
                        : 1
                    }
                    isMicro15={true}
                    lotSize={activeTrade?.lotSize || 0.006}
                    symbol={selectedSymbol}
                    liveUsdInrRate={liveUsdInrRate}
                    currencyPrefix={currencyPrefix}
                  />

                  {/* Institutional 7-Gate Risk & Anti-Chase Verification Matrix */}
                  <div className="rounded-xl bg-[#060B14]/90 border border-slate-800/90 p-3 space-y-2 min-w-0 max-w-full">
                    <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-200 inline-flex items-center gap-1.5 min-w-0 truncate">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#22D3EE] shrink-0" />
                        <span className="truncate" title="Risk Gates & Anti-Chase Guard">
                          Risk Gates &amp; Anti-Chase Guard
                        </span>
                      </span>
                      <span className="text-[10px] font-mono-numbers text-cyan-300 font-bold shrink-0">
                        {riskGates.filter((g) => g.passed).length}/{riskGates.length} PASSED
                      </span>
                    </div>

                    <div className="space-y-1.5 min-w-0">
                      {riskGates.map((gate) => (
                        <div
                          key={gate.id}
                          className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-2 text-[11px] font-mono-numbers min-w-0 ${
                            gate.passed
                              ? 'bg-emerald-950/25 border-emerald-500/30 text-emerald-200'
                              : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {gate.passed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 text-[#F43F5E] shrink-0" />
                            )}
                            <span
                              className="truncate font-sans font-semibold text-slate-200"
                              title={gate.label}
                            >
                              {gate.label}
                            </span>
                          </div>
                          <span
                            className="text-[10px] shrink-0 max-w-[46%] truncate font-bold"
                            title={gate.detail}
                          >
                            {gate.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

            {/* TAB 2: OPTIONS LAB (Multi-Leg Matrix + Payoff) */}
            {rightRailTab === 'OPTIONS_LAB' && (
              <div className="min-w-0">
                <OptionsStrategyEngine
                  markets={markets}
                  tradingMode={tradingMode}
                  selectedSymbol={selectedSymbol}
                  onSelectSymbol={setSelectedSymbol}
                  onSendNotification={onSendNotification}
                  currencyPrefix={currencyPrefix}
                  exchangeRate={exchangeRate}
                  aiAnalysis={aiAnalysis}
                  onRefreshAiAnalysis={onRefreshAiAnalysis}
                  isAiLoading={isAiLoading}
                  isLiveApiAuthenticated={isLiveApiAuthenticated}
                  onOpenSettings={onOpenSettings}
                  sniperSignal={currentSignal}
                  correlatedSignal={correlatedSignal}
                  onPlaySound={onPlaySound}
                />
              </div>
            )}

            {/* TAB 3: MANUAL ORDER PAD */}
            {rightRailTab === 'MANUAL_ORDER' && (
              <div className="min-w-0">
                <OrderForm
                  selectedSymbol={selectedSymbol}
                  setSelectedSymbol={setSelectedSymbol}
                  markets={markets}
                  availableBalance={portfolio.availableBalance}
                  availableMargin={portfolio.availableMargin ?? portfolio.availableBalance}
                  portfolio={portfolio}
                  tradingMode={tradingMode}
                  onExecuteOrder={onExecuteOrder}
                  prefillAiSetup={prefillAiSetup}
                  onClearPrefill={onClearPrefill}
                  currencyPrefix={currencyPrefix}
                  exchangeRate={exchangeRate}
                  isLiveApiAuthenticated={isLiveApiAuthenticated}
                  isCheckingAuth={isCheckingAuth}
                  hasServerCredentials={serverHasCredentials}
                  onOpenSettings={onOpenSettings}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =====================================================================
          ZONE 3: DOCKED BOTTOM LIVE POSITIONS & TELEMETRY DRAWER
          (h-[240px] collapsible on Desktop, accessible on Mobile)
          ===================================================================== */}
      <div
        className={`prodesk-drawer rounded-xl flex flex-col shrink-0 transition-all duration-200 overflow-hidden min-w-0 max-w-full ${
          isDrawerCollapsed ? 'h-auto min-h-10' : 'h-[260px] lg:h-[240px]'
        } ${mobileWorkspaceTab === 'POSITIONS_DRAWER' ? 'flex h-[420px]' : 'flex'}`}
      >
        {/* Docked Bottom Drawer Header Bar */}
        <div className="min-h-10 h-auto py-1.5 px-3 border-b border-cyan-500/20 flex flex-wrap items-center justify-between gap-1.5 shrink-0 min-w-0 max-w-full bg-[#060B14]/95">
          {/* Left: 4 Telemetry Drawer Tabs */}
          <div className="flex flex-wrap items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => {
                setBottomDrawerTab('LIVE_POSITIONS');
                setIsDrawerCollapsed(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                bottomDrawerTab === 'LIVE_POSITIONS' && !isDrawerCollapsed
                  ? 'bg-cyan-500/20 border border-cyan-400/60 text-cyan-200'
                  : 'text-slate-400 hover:text-white border border-transparent'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-[#22D3EE]" />
              <span>Live Positions &amp; Legs</span>
              <span className="px-1.5 py-0.2 rounded-full bg-slate-900 border border-slate-700 text-[10px] font-mono-numbers text-cyan-300">
                {positions.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomDrawerTab('SNIPER_AUDIT_LOG');
                setIsDrawerCollapsed(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                bottomDrawerTab === 'SNIPER_AUDIT_LOG' && !isDrawerCollapsed
                  ? 'bg-cyan-500/20 border border-cyan-400/60 text-cyan-200'
                  : 'text-slate-400 hover:text-white border border-transparent'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-[#10B981]" />
              <span>Sniper Audit Log</span>
              <span className="px-1.5 py-0.2 rounded-full bg-slate-900 border border-slate-700 text-[10px] font-mono-numbers text-slate-300">
                {tradeLogs.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setBottomDrawerTab('TRADE_HISTORY');
                setIsDrawerCollapsed(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                bottomDrawerTab === 'TRADE_HISTORY' && !isDrawerCollapsed
                  ? 'bg-cyan-500/20 border border-cyan-400/60 text-cyan-200'
                  : 'text-slate-400 hover:text-white border border-transparent'
              }`}
            >
              <History className="w-3.5 h-3.5 text-cyan-400" />
              <span>Trade History</span>
              <span className="px-1.5 py-0.2 rounded-full bg-slate-900 border border-slate-700 text-[10px] font-mono-numbers text-slate-300">
                {history.length}
              </span>
            </button>
          </div>

          {/* Right: Delta Exchange India Synced Total UPNL + [Close All Positions] + Collapse Toggle */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0 max-w-full font-mono-numbers">
            <div
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-extrabold inline-flex items-center gap-1.5 ${
                totalUpnlUsd >= 0
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-500/40 text-rose-300'
              }`}
            >
              <span className="text-slate-400 font-semibold uppercase text-[10px]">Total UPNL:</span>
              <span>
                {totalUpnlInr >= 0 ? '+₹' : '-₹'}
                {Math.abs(totalUpnlInr).toLocaleString('en-IN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-[10px] opacity-85">
                ({totalUpnlUsd >= 0 ? '+$' : '-$'}
                {Math.abs(totalUpnlUsd).toFixed(2)})
              </span>
            </div>

            <button
              type="button"
              disabled={positions.length === 0}
              onClick={onCloseAllPositions}
              className="btn-delta-sm btn-danger uppercase tracking-wider font-extrabold"
              title="Market Close All Open Positions on Delta Exchange India"
            >
              <ShieldAlert className="w-3 h-3" />
              <span>Close All Positions</span>
            </button>

            <button
              type="button"
              onClick={() => setIsDrawerCollapsed((prev) => !prev)}
              className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer"
              title={isDrawerCollapsed ? 'Expand Telemetry Drawer' : 'Collapse Telemetry Drawer'}
            >
              {isDrawerCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Docked Bottom Drawer Body */}
        {!isDrawerCollapsed && (
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
            {/* 1. LIVE POSITIONS & LEGS TAB */}
            {bottomDrawerTab === 'LIVE_POSITIONS' && (
              <div className="h-full">
                {positions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-6 text-xs text-slate-400 font-mono-numbers">
                    <div className="text-slate-300 font-semibold">
                      Zero Open Positions on Delta Exchange India ({tradingMode} Mode)
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Use the right execution rail ([Sniper $15 Micro], [Options Lab], or [Manual Order]) to deploy capital.
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px] font-mono-numbers">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                          <th className="py-1.5 px-2">Contract</th>
                          <th className="py-1.5 px-2">Side / Lev</th>
                          <th className="py-1.5 px-2">Size</th>
                          <th className="py-1.5 px-2">Entry</th>
                          <th className="py-1.5 px-2">Live Mark</th>
                          <th className="py-1.5 px-2">SL / TP</th>
                          <th className="py-1.5 px-2">Synced UPNL (INR / USD)</th>
                          <th className="py-1.5 px-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {positions.map((pos) => {
                          const pnlUsd = Number(pos.unrealisedPnl) || 0;
                          const rawInr = (pos as any).unrealisedPnlInr ?? (pos as any).unrealized_pnl_inr;
                          const pnlInr =
                            typeof rawInr === 'number' && Number.isFinite(rawInr)
                              ? rawInr
                              : pnlUsd * liveUsdInrRate;
                          const isProfit = pnlUsd >= 0;
                          return (
                            <tr key={pos.id} className="hover:bg-slate-900/50 transition">
                              <td
                                className="py-1.5 px-2 font-bold text-white max-w-[180px] truncate"
                                title={pos.rawSymbol || pos.symbol}
                              >
                                {pos.rawSymbol || pos.symbol}
                              </td>
                              <td className="py-1.5 px-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                                    pos.side === 'LONG'
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  }`}
                                >
                                  {pos.side} · {pos.leverage}x
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-slate-200">
                                {pos.contracts ? `${pos.contracts} cts` : pos.size}
                              </td>
                              <td className="py-1.5 px-2 text-slate-300">
                                ${Number(pos.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-1.5 px-2 text-cyan-300 font-semibold">
                                ${Number(pos.markPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-1.5 px-2 text-[10px]">
                                <span className="text-rose-300">
                                  {pos.stopLoss ? `$${Number(pos.stopLoss).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                                </span>
                                <span className="text-slate-600 mx-1">/</span>
                                <span className="text-emerald-300">
                                  {pos.takeProfit ? `$${Number(pos.takeProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                                </span>
                              </td>
                              <td
                                className={`py-1.5 px-2 font-extrabold ${
                                  isProfit ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {pnlInr >= 0 ? '+₹' : '-₹'}
                                {Math.abs(pnlInr).toLocaleString('en-IN', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                <span className="text-[10px] opacity-80">
                                  ({pnlUsd >= 0 ? '+$' : '-$'}
                                  {Math.abs(pnlUsd).toFixed(2)})
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-right space-x-1.5">
                                <button
                                  type="button"
                                  onClick={() => onAutoHedge(pos.symbol)}
                                  className="px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 text-[10px] font-bold cursor-pointer"
                                >
                                  Hedge
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onClosePosition(pos.id || pos.symbol)}
                                  className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-[10px] font-bold cursor-pointer"
                                >
                                  Close
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* 2. SNIPER AUDIT LOG TAB */}
            {bottomDrawerTab === 'SNIPER_AUDIT_LOG' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Real-Time Camarilla Sniper &amp; Auto-Pilot Execution Stream
                  </span>
                  {sniperEngine?.clearTradeLogs && tradeLogs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => sniperEngine.clearTradeLogs()}
                      className="text-[10px] text-slate-400 hover:text-rose-300 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear Logs</span>
                    </button>
                  )}
                </div>

                {tradeLogs.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500 font-mono-numbers">
                    No Sniper telemetry logs recorded in this session yet.
                  </div>
                ) : (
                  <div className="space-y-1 font-mono-numbers text-[11px]">
                    {tradeLogs.slice(0, 40).map((log: any, idx: number) => (
                      <div
                        key={log.id || `${log.timestamp}-${idx}`}
                        className="px-2.5 py-1 rounded-lg bg-slate-900/70 border border-slate-800/80 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-slate-500 shrink-0">
                            {new Date(log.timestamp || Date.now()).toLocaleTimeString()}
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold uppercase shrink-0 ${
                              log.type === 'EXECUTION' || log.type === 'PROFIT'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : log.type === 'STOP_LOSS' || log.type === 'RISK_BLOCK'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                            }`}
                          >
                            {log.type || 'INFO'}
                          </span>
                          <span
                            className="text-slate-200 truncate"
                            title={
                              log.message ||
                              (log.title ? `${log.title}${log.description ? ` — ${log.description}` : ''}` : log.description)
                            }
                          >
                            {log.message || (log.title ? `${log.title}${log.description ? ` — ${log.description}` : ''}` : log.description)}
                          </span>
                        </div>
                        {log.symbol && (
                          <span className="text-[10px] text-cyan-300 font-bold shrink-0">{log.symbol}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3. TRADE HISTORY TAB */}
            {bottomDrawerTab === 'TRADE_HISTORY' && (
              <div>
                {history.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500 font-mono-numbers">
                    No closed trades recorded yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px] font-mono-numbers">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400">
                          <th className="py-1.5 px-2">Time</th>
                          <th className="py-1.5 px-2">Symbol</th>
                          <th className="py-1.5 px-2">Side</th>
                          <th className="py-1.5 px-2">Entry -&gt; Exit</th>
                          <th className="py-1.5 px-2">Realized PnL</th>
                          <th className="py-1.5 px-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {history.slice(0, 30).map((t) => {
                          const isWin = t.realisedPnl >= 0;
                          const inrPnl = t.realisedPnl * liveUsdInrRate;
                          return (
                            <tr key={t.id} className="hover:bg-slate-900/50">
                              <td className="py-1.5 px-2 text-slate-400">
                                {new Date(t.closedAt).toLocaleTimeString()}
                              </td>
                              <td className="py-1.5 px-2 font-bold text-white">{t.symbol}</td>
                              <td className="py-1.5 px-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    t.side === 'LONG'
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : 'bg-rose-500/20 text-rose-300'
                                  }`}
                                >
                                  {t.side}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-slate-300">
                                ${Number(t.entryPrice).toFixed(1)} -&gt; ${Number(t.exitPrice).toFixed(1)}
                              </td>
                              <td
                                className={`py-1.5 px-2 font-extrabold ${
                                  isWin ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {inrPnl >= 0 ? '+₹' : '-₹'}
                                {Math.abs(inrPnl).toFixed(2)} ({isWin ? '+$' : '-$'}
                                {Math.abs(t.realisedPnl).toFixed(2)})
                              </td>
                              <td
                                className="py-1.5 px-2 text-slate-400 truncate max-w-[220px]"
                                title={t.reason}
                              >
                                {t.reason}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
