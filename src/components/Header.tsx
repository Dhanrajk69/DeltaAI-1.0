import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { TradingMode, NewsSentimentRadarData, Position, PortfolioData, AiTradeCardData } from '../types';
import { NewsSentimentRadarPill } from './NewsSentimentRadarPill';
import { HeaderWallet } from './HeaderWallet';
import { 
  Bell, 
  Flame, 
  Zap, 
  Lock, 
  AlertTriangle, 
  Menu,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Smartphone,
  ExternalLink,
  X,
  RefreshCw,
  Wallet,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { WsConnectionStatus } from '../hooks/useDeltaWebSocket';
import { usePortfolio } from '../context/PortfolioContext';
import { useLayoutPriority } from '../context/LayoutPriorityContext';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface HeaderProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleCollapseSidebar?: () => void;
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
  unreadNotifications: number;
  openNotifications: () => void;
  openSettings: () => void;
  openKillSwitchModal: () => void;
  soundMuted: boolean;
  toggleSound: () => void;
  currency: 'USD' | 'INR';
  toggleCurrency?: () => void;
  onChangeCurrency?: (next: 'USD' | 'INR') => void;
  wsStatus: WsConnectionStatus;
  wsLatency: number;
  packetGap?: number;
  openWsModal: () => void;
  selectedSymbol?: string;
  setSelectedSymbol?: (sym: string) => void;
  markets?: Record<string, any>;
  currencyPrefix?: string;
  exchangeRate?: number;
  newsRadarData?: NewsSentimentRadarData | null;
  isNewsRadarLoading?: boolean;
  openNewsRadarModal?: () => void;
  volatilityThreshold24h?: number;
  breachingAssetsCount?: number;
  maxVolatilityPct?: number;
  openVolatilityModal?: () => void;
  isLiveApiAuthenticated?: boolean;
  isCheckingAuth?: boolean;
  lastTickTimestamp?: number;
  lastCandleTimestamp?: number;
  isServerLiveUnlocked?: boolean;
  positions?: Position[];
  portfolio?: PortfolioData;
  onRefreshWallet?: () => Promise<any> | void;
  onTopUpPaperWallet?: (amountUsd: number, mode?: 'ADD' | 'RESET') => void;
  onSelectBulletin?: (tradeSetup: AiTradeCardData, levelType?: string) => void;
}

export const Header: React.FC<HeaderProps> = React.memo(({
  currentTab,
  setCurrentTab,
  onToggleSidebar,
  isSidebarCollapsed = false,
  onToggleCollapseSidebar,
  tradingMode,
  setTradingMode,
  unreadNotifications,
  openNotifications,
  openSettings,
  currency,
  toggleCurrency,
  onChangeCurrency,
  wsStatus,
  wsLatency,
  openWsModal,
  selectedSymbol = 'BTCUSDT',
  setSelectedSymbol,
  markets = {},
  currencyPrefix = '$',
  exchangeRate = 1,
  newsRadarData,
  isNewsRadarLoading = false,
  openNewsRadarModal,
  maxVolatilityPct = 0,
  openVolatilityModal,
  isLiveApiAuthenticated = false,
  isCheckingAuth = false,
  lastTickTimestamp,
  isServerLiveUnlocked = false,
  positions,
  portfolio,
  onRefreshWallet,
  onTopUpPaperWallet,
}) => {
  const [showLiveLockedTooltip, setShowLiveLockedTooltip] = useState<boolean>(false);
  const [liveLockedCoords, setLiveLockedCoords] = useState<{ top: number; right: number }>({ top: 58, right: 16 });
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isPwaInstalled, setIsPwaInstalled] = useState<boolean>(false);
  const [showInstallPopover, setShowInstallPopover] = useState<boolean>(false);
  const [installPopoverCoords, setInstallPopoverCoords] = useState<{ top: number; right: number }>({
    top: 58,
    right: 16,
  });
  const installButtonRef = useRef<HTMLButtonElement | null>(null);
  const {
    layoutMode,
    effectiveCompact,
    hasActiveLivePosition,
    toggleCompactExpanded,
  } = useLayoutPriority();
  const installPopoverRef = useRef<HTMLDivElement | null>(null);
  const liveModeButtonRef = useRef<HTMLButtonElement | null>(null);
  const liveTooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMobileSyncing, setIsMobileSyncing] = useState<boolean>(false);

  const updateInstallPopoverCoords = useCallback(() => {
    if (!installButtonRef.current || typeof window === 'undefined') return;
    const rect = installButtonRef.current.getBoundingClientRect();
    const top = rect.bottom + 8;
    const right = Math.max(12, window.innerWidth - rect.right);
    setInstallPopoverCoords({ top, right });
  }, []);

  const updateLiveLockedCoords = useCallback(() => {
    if (!liveModeButtonRef.current || typeof window === 'undefined') return;
    const rect = liveModeButtonRef.current.getBoundingClientRect();
    const top = rect.bottom + 8;
    const right = Math.max(12, window.innerWidth - rect.right);
    setLiveLockedCoords({ top, right });
  }, []);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsPwaInstalled(isStandalone);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsPwaInstalled(true);
      setDeferredPrompt(null);
      setShowInstallPopover(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      if (liveTooltipTimeoutRef.current) clearTimeout(liveTooltipTimeoutRef.current);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!showInstallPopover) return;
    updateInstallPopoverCoords();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        installPopoverRef.current &&
        !installPopoverRef.current.contains(target) &&
        installButtonRef.current &&
        !installButtonRef.current.contains(target)
      ) {
        setShowInstallPopover(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowInstallPopover(false);
    };
    const handleReposition = () => updateInstallPopoverCoords();

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [showInstallPopover, updateInstallPopoverCoords]);

  const handleInstallAppClick = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setIsPwaInstalled(true);
          setDeferredPrompt(null);
          setShowInstallPopover(false);
        }
        return;
      } catch {
        // Fall back to popover if prompt cannot run in iframe
      }
    }
    updateInstallPopoverCoords();
    setShowInstallPopover((prev) => !prev);
  };

  const {
    totalPortfolioNetPnlInr,
    totalPortfolioNetPnlUsd,
    totalEquity: ctxTotalEquity,
    syncNow: ctxSyncNow,
    isSyncingLive: ctxIsSyncingLive,
  } = usePortfolio();

  const isLiveUnverified = tradingMode === 'LIVE' && !isCheckingAuth && !isLiveApiAuthenticated;
  const mobileEquityUsd = isLiveUnverified ? 0 : (portfolio?.totalEquity ?? ctxTotalEquity ?? 0);
  const mobileWalletFormatted = `${currencyPrefix}${(mobileEquityUsd * exchangeRate).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const handleMobileSyncClick = async () => {
    if (isMobileSyncing || ctxIsSyncingLive) return;
    setIsMobileSyncing(true);
    try {
      if (onRefreshWallet) {
        await onRefreshWallet();
      } else if (ctxSyncNow) {
        await ctxSyncNow();
      }
    } finally {
      setTimeout(() => setIsMobileSyncing(false), 450);
    }
  };

  // Ambient Volatility Regime
  const volRegime = useMemo(() => {
    const v = maxVolatilityPct || 0;
    if (v <= 2.2) return { label: 'CALM', color: 'text-emerald-400', border: 'border-emerald-800/60', bg: 'bg-emerald-950/40' };
    if (v <= 3.8) return { label: 'NORMAL', color: 'text-cyan-300', border: 'border-cyan-800/60', bg: 'bg-cyan-950/40' };
    if (v <= 5.5) return { label: 'ACTIVE', color: 'text-amber-300', border: 'border-amber-800/60', bg: 'bg-amber-950/40' };
    return { label: 'EXPANDED', color: 'text-rose-300', border: 'border-rose-800/60', bg: 'bg-rose-950/40' };
  }, [maxVolatilityPct]);

  const curMarket = markets[selectedSymbol] || markets['BTCUSD'] || markets['BTCUSDT'] || {
    symbol: selectedSymbol,
    markPrice: 81702.50,
    change24h: -0.68,
  };

  const livePrice = curMarket.markPrice || 81702.50;
  const change24h = curMarket.change24h ?? 0;

  // Breadcrumb mapping
  const breadcrumbLabels: Record<string, { module: string; sub: string }> = {
    dashboard: { module: 'Trading Desk', sub: 'Terminal' },
    terminal: { module: 'Trading Desk', sub: 'Terminal' },
    strategies: { module: 'Camarilla Sniper', sub: 'L4/H4 Engine' },
    'ai-centre': { module: 'AI Command', sub: '23-AI Consensus' },
    markets: { module: 'Markets & Risk', sub: 'Real-Time Feeds' },
    performance: { module: 'Analytics & PnL', sub: 'Performance' },
    positions: { module: 'Positions & Fills', sub: 'Active Fills' },
    risk: { module: 'Risk Settings', sub: 'Drawdown Gates' },
  };

  const currentCrumb = breadcrumbLabels[currentTab] || { module: 'Trading Desk', sub: 'Overview' };

  return (
    <>
      {/* Compact Android-Style Top App Bar (< 768px only) */}
      <header className="flex md:hidden sticky top-0 z-[60] w-full h-[56px] min-h-[56px] bg-[#0D111D]/95 backdrop-blur-md border-b border-slate-800/80 shadow-[0_4px_20px_rgba(0,0,0,0.55)] px-3 items-center justify-between gap-2 select-none">
        {/* Left: Hamburger + Compact DeltaAI Logo + Live/Paper Status Dot */}
        <div className="flex items-center gap-2 min-w-0">
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label="Open Navigation Drawer"
              className="btn-delta btn-secondary !w-9 !px-0 shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCurrentTab('dashboard')}
            className="flex items-center gap-1.5 min-w-0 cursor-pointer"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-blue-600 via-cyan-500 to-teal-400 p-[1.5px] shadow-[0_0_12px_rgba(6,182,212,0.35)] shrink-0">
              <div className="w-full h-full bg-[#080B17] rounded-[5.5px] flex items-center justify-center">
                <span className="text-cyan-400 font-black text-xs font-mono">Δ</span>
              </div>
            </div>
            <span className="font-extrabold text-sm tracking-tight text-white truncate">DeltaAI</span>
          </button>
          <span
            title={
              tradingMode === 'LIVE'
                ? isLiveApiAuthenticated
                  ? 'Live API Authenticated'
                  : isCheckingAuth
                  ? 'Verifying API Credentials'
                  : 'API Key Required'
                : 'Paper Simulation Mode'
            }
            className={`badge-delta font-mono ${
              tradingMode === 'LIVE'
                ? isLiveApiAuthenticated || isCheckingAuth
                  ? 'badge-delta-live'
                  : 'badge-delta-warning'
                : 'badge-delta-paper'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                tradingMode === 'LIVE'
                  ? isLiveApiAuthenticated || isCheckingAuth
                    ? 'bg-emerald-400 animate-pulse'
                    : 'bg-orange-400'
                  : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span>{tradingMode === 'LIVE' ? 'LIVE' : 'PAPER'}</span>
          </span>
        </div>

        {/* Right: Compact WALLET · $XXX.XX Pill + 1-Tap [Sync] Icon Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => (isLiveUnverified ? openSettings() : setCurrentTab('positions'))}
            className={`btn-delta !px-2.5 font-mono text-[11px] ${
              isLiveUnverified
                ? 'btn-danger border-orange-500/40 bg-orange-500/15 text-orange-200'
                : tradingMode === 'LIVE'
                ? 'btn-toggle-active border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                : 'btn-secondary'
            }`}
            title={isLiveUnverified ? 'Connect API Keys in Settings' : 'Wallet Equity · Tap for Positions'}
          >
            <Wallet className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
            <span className="text-[10px] text-slate-400 font-semibold">WALLET</span>
            <span className="text-slate-600">·</span>
            <span className="tabular-nums text-white">{mobileWalletFormatted}</span>
          </button>
          <button
            type="button"
            onClick={handleMobileSyncClick}
            disabled={isMobileSyncing || ctxIsSyncingLive}
            aria-label="Sync Live Wallet"
            title="Sync Wallet Balances"
            className="btn-delta btn-secondary !w-9 !px-0 shrink-0"
          >
            <RefreshCw
              className={`w-4 h-4 ${isMobileSyncing || ctxIsSyncingLive ? 'animate-spin text-emerald-300' : 'text-cyan-300'}`}
            />
          </button>
        </div>
      </header>

      {/* Desktop Header (>= 768px, locked & unchanged) */}
      <header className="hidden md:flex sticky top-0 relative z-[60] w-full h-[54px] min-h-[54px] bg-[#0D111D]/95 backdrop-blur-md border-b border-slate-800/80 shadow-[0_4px_24px_rgba(0,0,0,0.6)] px-2 sm:px-3 lg:px-4 items-center justify-between gap-2 overflow-visible select-none">
      {/* Left Cluster: Sidebar Toggle + Breadcrumb + Asset Ticker & Quote */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* Mobile Sidebar Toggle Button */}
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 text-slate-300 hover:text-cyan-300 rounded-md bg-[#0F152B] border border-[#1E294B] lg:hidden cursor-pointer"
            title="Toggle Sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        {/* Desktop Sidebar Toggle Button */}
        {onToggleCollapseSidebar && (
          <button
            onClick={onToggleCollapseSidebar}
            className="hidden lg:flex p-1.5 text-slate-400 hover:text-cyan-300 rounded-md bg-[#0F152B]/80 hover:bg-[#141C38] border border-[#1E294B] transition-colors cursor-pointer"
            title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <PanelLeftClose className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
        )}

        {/* Sub-Navigation Breadcrumb */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-slate-400">
          <span className="font-semibold text-slate-300">{currentCrumb.module}</span>
          <ChevronRight className="w-3 h-3 text-slate-600" />
          <span className="text-cyan-400 font-bold">{currentCrumb.sub}</span>
        </div>

        <div className="h-4 w-[1px] bg-[#1E294B] hidden sm:block" />

        {/* Global Asset Ticker & Live Quote */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 py-1 bg-[#040A20]/80 border border-cyan-500/25 rounded-md font-mono text-xs shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee] shrink-0" />
          {setSelectedSymbol ? (
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              aria-label="Select trading instrument"
              className="bg-transparent text-xs font-bold text-white focus:outline-none cursor-pointer tracking-tight"
            >
              <option value="BTCUSDT" className="bg-[#080B17] text-white">BTC/USDT</option>
              <option value="ETHUSDT" className="bg-[#080B17] text-white">ETH/USDT</option>
              <option value="SOLUSDT" className="bg-[#080B17] text-white">SOL/USDT</option>
              <option value="XRPUSDT" className="bg-[#080B17] text-white">XRP/USDT</option>
              <option value="DOGEUSDT" className="bg-[#080B17] text-white">DOGE/USDT</option>
              <option value="AVAXUSDT" className="bg-[#080B17] text-white">AVAX/USDT</option>
            </select>
          ) : (
            <span className="text-xs font-bold text-white tracking-tight">{selectedSymbol}</span>
          )}

          <span className="text-slate-600">·</span>

          <span className="text-xs font-bold text-emerald-400 tracking-tight whitespace-nowrap">
            {currencyPrefix}{(livePrice * exchangeRate).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: livePrice > 10 ? 2 : 4,
            })}
          </span>

          <span
            className={`text-[10px] sm:text-[11px] font-semibold whitespace-nowrap px-1 py-0.2 rounded ${
              change24h >= 0 ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
            }`}
          >
            {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
          </span>
        </div>

        {/* Live News Sentiment Radar Pill */}
        <NewsSentimentRadarPill
          radarData={newsRadarData || null}
          isLoading={isNewsRadarLoading}
          onOpenModal={openNewsRadarModal || (() => {})}
        />
      </div>

      {/* Center / Telemetry Pills (Hidden on very narrow mobile, visible on md+) */}
      <div className="hidden xl:flex items-center gap-2">
        {/* Volatility Regime Monitor */}
        {openVolatilityModal && (
          <button
            type="button"
            onClick={openVolatilityModal}
            className="badge-delta badge-delta-standby cursor-pointer transition hover:brightness-125"
            title={`Market Volatility Regime: ${volRegime.label} (${(maxVolatilityPct || 0).toFixed(1)}%)`}
          >
            <Zap className={`w-3 h-3 shrink-0 ${volRegime.color}`} />
            <span className="text-slate-400">VOL</span>
            <span className={volRegime.color}>
              {(maxVolatilityPct || 0).toFixed(1)}%
            </span>
          </button>
        )}

        {/* Net PnL Pill */}
        <div
          className={`badge-delta font-mono ${
            totalPortfolioNetPnlInr >= 0 ? 'badge-delta-live' : 'badge-delta-danger'
          }`}
          title="Consolidated Net PnL across all strategies"
        >
          <span className="text-slate-400">NET P&L:</span>
          <span>
            {currency === 'INR' ? (
              <>
                <span>{totalPortfolioNetPnlInr >= 0 ? '+ ▲' : '- ▼'}</span>
                <span>₹{Math.abs(totalPortfolioNetPnlInr).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </>
            ) : (
              <>
                <span>{totalPortfolioNetPnlUsd >= 0 ? '+ ▲' : '- ▼'}</span>
                <span>${Math.abs(totalPortfolioNetPnlUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Right Cluster: Segmented Tool Dock */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">

        {/* Global Tier-3 Layout Density Toggle (Compact / Expanded View) */}
        <button
          type="button"
          onClick={toggleCompactExpanded}
          className={`btn-delta-sm font-mono flex items-center gap-1.5 shrink-0 border transition-all ${
            effectiveCompact
              ? 'bg-amber-500/15 border-amber-500/45 text-amber-200 hover:bg-amber-500/25'
              : 'bg-slate-900/80 border-slate-700/80 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200'
          }`}
          title={
            effectiveCompact
              ? hasActiveLivePosition && layoutMode === 'AUTO'
                ? 'Compact View (Auto-Active due to open live position — Tier 3 diagnostic panels collapsed). Click to switch to Expanded View.'
                : 'Compact View Active (Tier 3 setup & diagnostic panels collapsed across all tabs). Click to switch to Expanded View.'
              : 'Expanded View Active (All Tier 3 panels visible). Click to switch to Compact View.'
          }
        >
          {effectiveCompact ? (
            <Maximize2 className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          ) : (
            <Minimize2 className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
          )}
          <span className="hidden sm:inline">
            {effectiveCompact ? 'Compact View' : 'Expanded View'}
          </span>
          {effectiveCompact && hasActiveLivePosition && layoutMode === 'AUTO' && (
            <span className="hidden md:inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
        </button>

        {/* Paper / Live Trading Selector */}
        <div className="flex items-center p-1 bg-slate-900/70 border border-slate-800/80 rounded-lg gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setTradingMode('PAPER')}
            className={`btn-delta-sm ${
              tradingMode === 'PAPER'
                ? 'btn-toggle-active'
                : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
            }`}
            title="Paper Demo Mode (Simulated Execution)"
          >
            Paper
          </button>
          <div className="relative inline-block">
            <button
              ref={liveModeButtonRef}
              type="button"
              onClick={() => {
                if (!isServerLiveUnlocked) {
                  updateLiveLockedCoords();
                  setShowLiveLockedTooltip(true);
                  if (liveTooltipTimeoutRef.current) clearTimeout(liveTooltipTimeoutRef.current);
                  liveTooltipTimeoutRef.current = setTimeout(() => setShowLiveLockedTooltip(false), 3500);
                  return;
                }
                setTradingMode('LIVE');
              }}
              className={`btn-delta-sm ${
                !isServerLiveUnlocked
                  ? 'btn-secondary !bg-transparent !border-transparent text-slate-500 !cursor-not-allowed opacity-80'
                  : tradingMode === 'LIVE'
                  ? isLiveApiAuthenticated || isCheckingAuth
                    ? 'btn-primary'
                    : 'btn-secondary border-amber-400/60 bg-amber-500/20 text-amber-200'
                  : 'btn-secondary !bg-transparent !border-transparent text-slate-400'
              }`}
              title="Live India Mode (Delta Exchange India API)"
            >
              {!isServerLiveUnlocked ? (
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              ) : (
                <Flame
                  className={`w-3.5 h-3.5 shrink-0 ${
                    tradingMode === 'LIVE' && !isLiveApiAuthenticated && !isCheckingAuth
                      ? 'text-amber-300'
                      : tradingMode === 'LIVE'
                      ? 'text-slate-950'
                      : 'text-emerald-300'
                  }`}
                />
              )}
              <span>Live</span>
            </button>

            {showLiveLockedTooltip &&
              typeof document !== 'undefined' &&
              createPortal(
                <div
                  style={{ top: `${liveLockedCoords.top}px`, right: `${liveLockedCoords.right}px` }}
                  className="fixed z-[100] panel-delta p-2.5 border-amber-500/70 text-[11px] text-amber-200 whitespace-nowrap flex items-center gap-1.5"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Server Live Gate Locked (Set DELTA_LIVE_TRADING_ENABLED=true in server .env)</span>
                </div>,
                document.body
              )}
          </div>
        </div>

        {/* Header Wallet Widget with USD / INR Toggle */}
        <HeaderWallet
          tradingMode={tradingMode}
          isLiveApiAuthenticated={isLiveApiAuthenticated}
          isCheckingAuth={isCheckingAuth}
          portfolio={portfolio}
          positions={positions}
          currency={currency}
          toggleCurrency={toggleCurrency}
          onChangeCurrency={onChangeCurrency}
          currencyPrefix={currencyPrefix}
          exchangeRate={exchangeRate}
          openSettings={openSettings}
          onNavigatePositions={() => setCurrentTab('positions')}
          onRefreshWallet={onRefreshWallet}
          onTopUpPaperWallet={onTopUpPaperWallet}
        />

        {/* Always-Visible [Install App] PWA Button right beside $ USD | ₹ INR */}
        <div className="relative inline-block shrink-0">
          <button
            ref={installButtonRef}
            type="button"
            onClick={handleInstallAppClick}
            aria-expanded={showInstallPopover}
            aria-haspopup="dialog"
            className="btn-delta btn-toggle-active font-mono"
            title={
              deferredPrompt
                ? '1-Click Install DeltaAI Desktop/Web App'
                : 'Install DeltaAI Progressive Web App (Chrome / Edge)'
            }
          >
            <Smartphone className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span>{isPwaInstalled ? 'App Installed' : 'Install App'}</span>
          </button>

          {showInstallPopover &&
            typeof document !== 'undefined' &&
            createPortal(
              <div
                ref={installPopoverRef}
                role="dialog"
                aria-label="Install DeltaAI Web App"
                style={{
                  top: `${installPopoverCoords.top}px`,
                  right: `${installPopoverCoords.right}px`,
                }}
                className="fixed z-[100] w-80 sm:w-96 max-w-[calc(100vw-24px)] panel-delta border-cyan-400/50 text-left overflow-hidden"
              >
                <div className="panel-delta-header">
                  <div className="panel-delta-title">
                    <Smartphone className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Install DeltaAI Web App (PWA)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowInstallPopover(false)}
                    className="btn-delta-sm btn-secondary !px-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="panel-delta-body space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      window.open(window.location.origin, '_blank');
                      setShowInstallPopover(false);
                    }}
                    className="w-full btn-delta btn-primary font-mono"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span>Open Standalone Tab to Install</span>
                  </button>

                  <div className="p-3 rounded-lg bg-[#060A15] border border-slate-800/80 text-[11px] leading-relaxed text-slate-300">
                    <p className="italic text-slate-200">
                      In Chrome, click the Install icon (<code className="px-1 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono not-italic">⊕</code>) in the address bar or <code className="px-1 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono not-italic">⋮ → Cast, save, and share → Install page as app...</code>
                    </p>
                  </div>
                </div>
              </div>,
              document.body
            )}
        </div>

        {/* Alerts Badge */}
        <button
          type="button"
          onClick={openNotifications}
          className="btn-delta btn-secondary font-mono"
          title="Trading Alerts & Notifications"
        >
          <Bell className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-cyan-300">
            {unreadNotifications > 0 ? unreadNotifications : 4}
          </span>
        </button>
      </div>
    </header>
    </>
  );
});
