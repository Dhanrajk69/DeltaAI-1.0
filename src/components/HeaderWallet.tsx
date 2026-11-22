import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Wallet,
  RefreshCw,
  Settings,
  ArrowUpRight,
  AlertTriangle,
  Key,
  ChevronDown,
  ShieldAlert,
  Layers,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { PortfolioData, Position, TradingMode } from '../types';
import { usePortfolio } from '../context/PortfolioContext';
import { formatDiagnosticBadgeAndMessage } from '../services/deltaExchangeService';

interface HeaderWalletProps {
  tradingMode: TradingMode;
  isLiveApiAuthenticated: boolean;
  isCheckingAuth?: boolean;
  portfolio?: PortfolioData;
  positions?: Position[];
  currency?: 'USD' | 'INR';
  toggleCurrency?: () => void;
  onChangeCurrency?: (next: 'USD' | 'INR') => void;
  currencyPrefix?: string;
  exchangeRate?: number;
  openSettings: () => void;
  onNavigatePositions?: () => void;
  onRefreshWallet?: () => Promise<any> | void;
  onTopUpPaperWallet?: (amountUsd: number, mode?: 'ADD' | 'RESET') => void;
}

export const HeaderWallet: React.FC<HeaderWalletProps> = React.memo(({
  tradingMode,
  isLiveApiAuthenticated,
  isCheckingAuth = false,
  portfolio,
  positions,
  currency: propCurrency,
  toggleCurrency,
  onChangeCurrency,
  openSettings,
  onNavigatePositions,
  onRefreshWallet,
  onTopUpPaperWallet,
}) => {
  const portfolioCtx = usePortfolio();
  const [localCurrency, setLocalCurrency] = useState<'USD' | 'INR'>(propCurrency || 'USD');
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; right: number }>({
    top: 58,
    right: 16,
  });

  useEffect(() => {
    if (propCurrency) {
      setLocalCurrency(propCurrency);
    }
  }, [propCurrency]);

  const activeCurrency: 'USD' | 'INR' = propCurrency || localCurrency;
  const usdInrRate = portfolioCtx.usdInrRate || 85;
  const activePrefix = activeCurrency === 'INR' ? '₹' : '$';
  const activeRate = activeCurrency === 'INR' ? usdInrRate : 1;

  const setWalletCurrency = useCallback(
    (next: 'USD' | 'INR') => {
      setLocalCurrency(next);
      if (onChangeCurrency) {
        onChangeCurrency(next);
      } else if (toggleCurrency && next !== propCurrency) {
        toggleCurrency();
      }
    },
    [onChangeCurrency, toggleCurrency, propCurrency]
  );

  const handleToggleCurrency = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const next: 'USD' | 'INR' = activeCurrency === 'USD' ? 'INR' : 'USD';
      setWalletCurrency(next);
    },
    [activeCurrency, setWalletCurrency]
  );

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const isLiveUnverified = tradingMode === 'LIVE' && !isCheckingAuth && !isLiveApiAuthenticated;

  const effectivePositions: Position[] = isLiveUnverified
    ? []
    : positions ?? portfolioCtx.positions ?? [];

  const computedOpenPositionValueUsd = effectivePositions.reduce(
    (acc, p) =>
      acc +
      (Number.isFinite(p.notionalUsd) && (p.notionalUsd || 0) > 0
        ? (p.notionalUsd as number)
        : Math.abs((p.size || 0) * (p.markPrice || p.entryPrice || 0))),
    0
  );

  const computedPositionsMarginUsd = effectivePositions.reduce(
    (acc, p) => acc + (p.margin || 0),
    0
  );

  const computedPositionsUpnlUsd = effectivePositions.reduce(
    (acc, p) => acc + (p.unrealized_pnl ?? p.unrealisedPnl ?? 0),
    0
  );

  const totalEquityUsd = isLiveUnverified
    ? 0
    : portfolio?.totalEquity ?? portfolioCtx.totalEquity ?? 0;
  const availableMarginUsd = isLiveUnverified
    ? 0
    : portfolio?.availableMargin ??
      portfolio?.availableBalance ??
      portfolioCtx.availableMargin ??
      portfolioCtx.availableBalance ??
      0;
  const marginUsedUsd = isLiveUnverified
    ? 0
    : Math.max(
        portfolio?.marginUsed ?? portfolioCtx.marginUsed ?? 0,
        +computedPositionsMarginUsd.toFixed(2)
      );
  const unrealisedPnlUsd = isLiveUnverified
    ? 0
    : effectivePositions.length > 0
    ? +computedPositionsUpnlUsd.toFixed(4)
    : portfolio?.unrealisedPnlTotal ?? portfolioCtx.totalPortfolioUnrealizedPnlUsd ?? 0;

  const openPositionValueUsd = isLiveUnverified
    ? 0
    : effectivePositions.length > 0
    ? +computedOpenPositionValueUsd.toFixed(2)
    : portfolio?.openPositionValueUsd ?? portfolioCtx.openPositionValueUsd ?? 0;

  const walletCashBalanceUsd = isLiveUnverified
    ? 0
    : portfolio?.walletBalance ??
      portfolioCtx.walletBalance ??
      +(totalEquityUsd - unrealisedPnlUsd).toFixed(2);

  const activePositionsCount = effectivePositions.length;
  const walletBalances = tradingMode === 'LIVE' ? portfolioCtx.walletBalances : [];
  const rawDiagnosticError =
    tradingMode === 'LIVE' && !isCheckingAuth && isLiveApiAuthenticated
      ? portfolio?.walletDiagnosticError ?? portfolioCtx.walletDiagnosticError ?? null
      : null;
  const diagnosticError =
    rawDiagnosticError &&
    rawDiagnosticError.code === 'MISSING_API_CREDENTIALS' &&
    isLiveApiAuthenticated
      ? null
      : rawDiagnosticError;
  const formattedDiag = diagnosticError
    ? formatDiagnosticBadgeAndMessage(diagnosticError.code, diagnosticError.message)
    : null;

  const marginUtilizationPct =
    totalEquityUsd > 0 ? Math.min(100, Math.max(0, (marginUsedUsd / totalEquityUsd) * 100)) : 0;

  const updatePopoverPosition = useCallback(() => {
    if (!buttonRef.current || typeof window === 'undefined') return;
    const rect = buttonRef.current.getBoundingClientRect();
    const right = Math.max(12, window.innerWidth - rect.right);
    const top = rect.bottom + 8;
    setPopoverCoords({ top, right });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePopoverPosition();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    const handleReposition = () => updatePopoverPosition();

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, updatePopoverPosition]);

  const handleManualRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRefreshing || portfolioCtx.isSyncingLive) return;
    setIsRefreshing(true);
    try {
      if (portfolioCtx.syncNow) {
        await portfolioCtx.syncNow();
      } else if (onRefreshWallet) {
        await onRefreshWallet();
      } else if (tradingMode === 'LIVE') {
        await portfolioCtx.refreshLiveWalletAndPositions();
      }
    } finally {
      setTimeout(() => setIsRefreshing(false), 350);
    }
  };

  const formattedPrimaryEquity = `${activePrefix}${(totalEquityUsd * activeRate).toLocaleString(
    undefined,
    {
      minimumFractionDigits: activeCurrency === 'INR' ? 0 : 2,
      maximumFractionDigits: 2,
    }
  )}`;

  const formattedSecondaryEquity =
    activeCurrency === 'INR'
      ? `$${totalEquityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
      : `₹${(totalEquityUsd * usdInrRate).toLocaleString(undefined, { maximumFractionDigits: 0 })} INR`;

  const formattedPrimaryAvail = `${activePrefix}${(availableMarginUsd * activeRate).toLocaleString(
    undefined,
    {
      minimumFractionDigits: activeCurrency === 'INR' ? 0 : 2,
      maximumFractionDigits: 2,
    }
  )}`;

  const formattedSecondaryAvail =
    activeCurrency === 'INR'
      ? `$${availableMarginUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `₹${(availableMarginUsd * usdInrRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const formattedPositionValue = `${activePrefix}${(openPositionValueUsd * activeRate).toLocaleString(
    undefined,
    {
      minimumFractionDigits: activeCurrency === 'INR' ? 0 : 2,
      maximumFractionDigits: 2,
    }
  )}`;

  return (
    <>
      <div
        className={`h-9 pl-2.5 pr-1.5 rounded-lg border transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 select-none ${
          isLiveUnverified
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
            : diagnosticError
            ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
            : tradingMode === 'LIVE'
            ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
            : 'bg-slate-800/80 border-slate-700/70 text-white'
        }`}
      >
        {/* Main Wallet Popover Trigger */}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title={
            isLiveUnverified
              ? 'Live Wallet Inactive — Connect your Delta Exchange API Key & Secret in Settings.'
              : formattedDiag
              ? `Wallet Sync Diagnostic (${formattedDiag.label}) — Click for details`
              : `Wallet (${activeCurrency}) · Equity: ${formattedPrimaryEquity} · Position Value: ${formattedPositionValue} · Avail Margin: ${formattedPrimaryAvail}`
          }
          className="flex items-center gap-1.5 cursor-pointer py-0.5 pr-1 focus:outline-none"
        >
          <Wallet
            className={`w-3.5 h-3.5 shrink-0 ${
              isLiveUnverified
                ? 'text-amber-400'
                : diagnosticError
                ? 'text-rose-400'
                : tradingMode === 'LIVE'
                ? 'text-emerald-300'
                : 'text-cyan-300'
            }`}
          />
          <div className="flex items-center gap-1.5 font-mono tabular-nums text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 hidden sm:inline">
              Wallet
            </span>
            <span className="text-slate-500 hidden sm:inline">·</span>
            <span className="font-bold text-white">{formattedPrimaryEquity}</span>
            {activePositionsCount > 0 && (
              <span
                className={`badge-delta hidden md:inline-flex ${
                  unrealisedPnlUsd >= 0 ? 'badge-delta-live' : 'badge-delta-danger'
                }`}
              >
                <span>{activePositionsCount}P</span>
                <span>
                  {unrealisedPnlUsd >= 0 ? '+' : '-'}
                  {activePrefix}
                  {Math.abs(unrealisedPnlUsd * activeRate).toLocaleString(undefined, {
                    minimumFractionDigits: activeCurrency === 'INR' ? 0 : 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-3 h-3 text-slate-300 transition-transform duration-150 shrink-0 ${
              isOpen ? 'rotate-180 text-cyan-300' : ''
            }`}
          />
        </button>

        {/* Inline 1-Click USD / INR Toggle Switch inside Header Wallet */}
        <div
          onClick={handleToggleCurrency}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleToggleCurrency(e as any);
            }
          }}
          title={`Toggle Wallet Currency: Currently ${activeCurrency} (1 USD = ₹${usdInrRate})`}
          className="flex items-center p-0.5 rounded-lg bg-[#050918]/90 border border-slate-700/80 text-[10px] font-mono font-bold cursor-pointer shrink-0"
        >
          <span
            className={`px-1.5 py-0.5 rounded-md transition-colors ${
              activeCurrency === 'USD'
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            $ USD
          </span>
          <span
            className={`px-1.5 py-0.5 rounded-md transition-colors ${
              activeCurrency === 'INR'
                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ₹ INR
          </span>
        </div>

        {/* Manual [Sync Now] Button in Top Wallet Bar */}
        {tradingMode === 'LIVE' && isLiveApiAuthenticated && (
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing || portfolioCtx.isSyncingLive}
            title="Sync Live Delta Exchange India Wallet & Positions Now (3s Auto-Poll Active)"
            className="btn-delta-sm btn-secondary font-mono"
          >
            <RefreshCw
              className={`w-3 h-3 ${
                isRefreshing || portfolioCtx.isSyncingLive ? 'animate-spin text-emerald-400' : 'text-cyan-400'
              }`}
            />
            <span className="hidden lg:inline">Sync Now</span>
          </button>
        )}
      </div>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Account Wallet Overview"
            style={{ top: `${popoverCoords.top}px`, right: `${popoverCoords.right}px` }}
            className="fixed z-[100] w-[370px] max-w-[calc(100vw-24px)] panel-delta panel-delta-body text-slate-100"
          >
          {/* Header Row with Segmented USD / INR Toggle */}
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${
                  tradingMode === 'LIVE'
                    ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                    : 'bg-cyan-950/70 border-cyan-500/40 text-cyan-300'
                }`}
              >
                <Wallet className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white tracking-tight truncate">
                  {tradingMode === 'LIVE' ? 'Delta India Live Wallet' : 'Paper Trading Wallet'}
                </div>
                <div className="text-[10.5px] text-slate-400 font-mono truncate">
                  1 USD = ₹{usdInrRate.toFixed(2)} INR · Synced with Open Positions
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Segmented USD / INR Toggle in Popover */}
              <div className="flex items-center p-0.5 rounded-lg bg-[#060A17] border border-slate-700/90 text-[10.5px] font-mono font-bold">
                <button
                  type="button"
                  onClick={() => setWalletCurrency('USD')}
                  className={`px-2 py-1 rounded-md transition cursor-pointer ${
                    activeCurrency === 'USD'
                      ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/50'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  $ USD
                </button>
                <button
                  type="button"
                  onClick={() => setWalletCurrency('INR')}
                  className={`px-2 py-1 rounded-md transition cursor-pointer ${
                    activeCurrency === 'INR'
                      ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/50'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ₹ INR
                </button>
              </div>

              {tradingMode === 'LIVE' && isLiveApiAuthenticated && (
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing || portfolioCtx.isSyncingLive}
                  title="Sync Now: Refresh Delta India Wallet & Positions"
                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-cyan-500/40 text-[10.5px] font-mono font-bold text-cyan-300 hover:text-cyan-200 flex items-center gap-1 transition cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshing || portfolioCtx.isSyncingLive ? 'animate-spin' : ''}`} />
                  <span>Sync Now</span>
                </button>
              )}
            </div>
          </div>

          {/* Primary Balance Card */}
          <div className="mt-3 bg-[#10162B] border border-slate-800/90 rounded-xl p-3 space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-medium">
                  Total Equity ({activeCurrency})
                </div>
                <div className="text-xl font-extrabold font-mono tabular-nums text-white mt-0.5">
                  {formattedPrimaryEquity}
                </div>
                <div className="text-[10.5px] font-mono tabular-nums text-slate-400">
                  ≈ {formattedSecondaryEquity}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10.5px] uppercase tracking-wider text-slate-400 font-medium">
                  Avail. Margin
                </div>
                <div className="text-sm font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
                  {formattedPrimaryAvail}
                </div>
                <div className="text-[10px] font-mono tabular-nums text-slate-400">
                  ≈ {formattedSecondaryAvail}
                </div>
              </div>
            </div>

            {/* Cash Balance & Open Position Notional Value Sync Row */}
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[10.5px] font-mono tabular-nums">
              <div className="bg-[#0B1020]/90 border border-slate-800/80 rounded-lg px-2.5 py-1.5">
                <div className="text-[9.5px] uppercase tracking-wider text-slate-400">
                  Wallet Cash
                </div>
                <div className="font-bold text-slate-200 mt-0.5">
                  {activePrefix}
                  {(walletCashBalanceUsd * activeRate).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div className="bg-[#0B1020]/90 border border-slate-800/80 rounded-lg px-2.5 py-1.5 text-right">
                <div className="text-[9.5px] uppercase tracking-wider text-cyan-300/90">
                  Open Pos. Value ({activePositionsCount})
                </div>
                <div className="font-bold text-cyan-300 mt-0.5">{formattedPositionValue}</div>
              </div>
            </div>

            {/* Margin Utilization Bar */}
            <div className="pt-2 border-t border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[10.5px] font-mono tabular-nums">
                <span className="text-slate-400">
                  Margin Used:{' '}
                  <strong className="text-slate-200">
                    {activePrefix}
                    {(marginUsedUsd * activeRate).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </span>
                <span
                  className={
                    unrealisedPnlUsd >= 0
                      ? 'text-emerald-400 font-semibold'
                      : 'text-rose-400 font-semibold'
                  }
                >
                  UPNL: {unrealisedPnlUsd >= 0 ? '+' : '-'}
                  {activePrefix}
                  {Math.abs(unrealisedPnlUsd * activeRate).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-200"
                  style={{ width: `${marginUtilizationPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Live Open Positions Breakdown Synced with Wallet */}
          {effectivePositions.length > 0 && (
            <div className="mt-2.5 bg-[#0F1426] border border-cyan-500/30 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">
                <span>Open Positions Sync ({effectivePositions.length})</span>
                <span className="font-mono text-slate-400">
                  Val: {formattedPositionValue}
                </span>
              </div>
              <div className="divide-y divide-slate-800/60 max-h-36 overflow-y-auto pr-0.5">
                {effectivePositions.slice(0, 4).map((pos) => {
                  const posNotionalUsd =
                    Number.isFinite(pos.notionalUsd) && (pos.notionalUsd || 0) > 0
                      ? (pos.notionalUsd as number)
                      : Math.abs((pos.size || 0) * (pos.markPrice || pos.entryPrice || 0));
                  const posUpnl = pos.unrealisedPnl || 0;
                  return (
                    <div
                      key={pos.id}
                      className="py-1.5 flex items-center justify-between text-[11px] font-mono tabular-nums gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white">{pos.symbol}</span>
                          <span
                            className={`text-[9.5px] font-bold px-1 py-0.2 rounded ${
                              pos.side === 'LONG'
                                ? 'bg-emerald-950/80 text-emerald-400'
                                : 'bg-rose-950/80 text-rose-400'
                            }`}
                          >
                            {pos.side} {pos.leverage}x
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          Size: {pos.size}
                          {pos.contracts ? ` (${pos.contracts} cont)` : ''} · Val:{' '}
                          {activePrefix}
                          {(posNotionalUsd * activeRate).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`font-bold ${
                            posUpnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {posUpnl >= 0 ? '+' : '-'}
                          {activePrefix}
                          {Math.abs(posUpnl * activeRate).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <div className="text-[9.5px] text-slate-400">
                          Mgn: {activePrefix}
                          {((pos.margin || 0) * activeRate).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Paper Mode Quick Top-Up / Reset Controls */}
          {tradingMode === 'PAPER' && onTopUpPaperWallet && (
            <div className="mt-2.5 bg-[#0F1426] border border-slate-800/80 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                <span>Paper Capital Controls</span>
                <span className="font-mono text-cyan-400">Instant Demo Top-Up</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => onTopUpPaperWallet(500, 'ADD')}
                  className="btn-delta-sm btn-toggle-active font-mono"
                >
                  <Plus className="w-3 h-3" />
                  <span>{activeCurrency === 'INR' ? '₹42,500' : '$500'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onTopUpPaperWallet(1000, 'ADD')}
                  className="btn-delta-sm btn-toggle-active font-mono"
                >
                  <Plus className="w-3 h-3" />
                  <span>{activeCurrency === 'INR' ? '₹85,000' : '$1,000'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onTopUpPaperWallet(1000, 'RESET')}
                  title="Reset Paper Equity to $1,000.00 (₹85,000)"
                  className="btn-delta-sm btn-secondary font-mono"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>
            </div>
          )}

          {/* Live Asset Breakdown */}
          {tradingMode === 'LIVE' && isLiveApiAuthenticated && walletBalances.length > 0 && (
            <div className="mt-2.5 bg-[#0F1426] border border-slate-800/80 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                <span>Exchange Asset Breakdown</span>
                <span className="font-mono text-slate-500">1 USD = ₹{usdInrRate}</span>
              </div>
              <div className="divide-y divide-slate-800/60">
                {walletBalances.slice(0, 4).map((row) => (
                  <div
                    key={row.assetSymbol}
                    className="py-1 flex items-center justify-between text-[11px] font-mono tabular-nums"
                  >
                    <span className="font-bold text-slate-200">{row.assetSymbol}</span>
                    <div className="text-right">
                      <span className="text-slate-100 font-semibold">
                        {row.assetSymbol === 'INR'
                          ? `₹${row.availableBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                          : row.availableBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                      <span className="text-slate-500 ml-1.5 text-[10px]">
                        ({activeCurrency === 'INR'
                          ? `₹${(row.availableMarginUsd * usdInrRate).toFixed(0)}`
                          : `$${row.availableMarginUsd.toFixed(2)}`})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unverified Keys or Upstream Diagnostic Alert */}
          {isLiveUnverified ? (
            <div className="mt-2.5 p-2.5 rounded-xl bg-amber-950/60 border border-amber-700/70 text-[11px] text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-amber-300">API KEY REQUIRED</div>
                <p className="text-amber-200/85 text-[10.5px] leading-snug mt-0.5">
                  Connect your Delta Exchange API Key &amp; Secret in Settings.
                </p>
              </div>
            </div>
          ) : formattedDiag ? (
            <div className="mt-2.5 p-2.5 rounded-xl bg-rose-950/70 border border-rose-700/70 text-[11px] text-rose-200 flex items-start gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-rose-200">{formattedDiag.label}</div>
                <p className="text-rose-200/85 text-[10.5px] leading-snug mt-0.5 break-words">
                  {formattedDiag.message}
                </p>
              </div>
            </div>
          ) : null}

          {/* Footer Quick Actions */}
          <div className="mt-3 pt-2.5 border-t border-slate-800/80 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                if (onNavigatePositions) onNavigatePositions();
              }}
              className="btn-delta btn-secondary"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>Positions ({activePositionsCount})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                openSettings();
              }}
              className="btn-delta btn-toggle-active"
            >
              {isLiveUnverified ? (
                <>
                  <Key className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>Connect Keys</span>
                </>
              ) : (
                <>
                  <Settings className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                  <span>API & Keys</span>
                  <ArrowUpRight className="w-3 h-3 text-cyan-300 shrink-0" />
                </>
              )}
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
});
