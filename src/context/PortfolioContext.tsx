import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Position, ClosedTrade, TradeSentimentTag } from '../types';
import {
  AUTHENTIC_DELTA_POSITIONS,
  DeltaWalletDiagnosticError,
  DeltaLiveWalletResponse,
  DeltaLivePositionsResponse,
  fetchDeltaAuthoritativeResync,
  fetchDeltaLiveWalletAndPositions,
  getStoredDeltaCredentials,
} from '../services/deltaExchangeService';
import { parseOptionSymbolExpiryUtcMs } from '../utils/optionsExpiryUtils';

function isExpiredOptionPosition(p: any): boolean {
  if (!p) return false;
  const sym = String(p.product_symbol || p.rawSymbol || p.symbol || '').toUpperCase();
  const ctype = String(p.contract_type || '').toLowerCase();
  const isOpt = ctype === 'call_options' || ctype === 'put_options' || sym.startsWith('C-') || sym.startsWith('P-');
  if (!isOpt) return false;
  const expiryMs =
    typeof p.expiryTimestampUtc === 'number'
      ? p.expiryTimestampUtc
      : parseOptionSymbolExpiryUtcMs(sym);
  return expiryMs !== null && Date.now() >= expiryMs;
}

export interface WalletAssetBalanceRow {
  assetSymbol: string;
  balance: number;
  availableBalance: number;
  balanceUsd: number;
  availableMarginUsd: number;
  marginUsedUsd: number;
}

export interface TradeJournalMetadata {
  notes?: string;
  sentimentTag?: TradeSentimentTag;
  tags?: string[];
  lessonLearned?: string;
  journalUpdatedAt?: number;
}

export interface PortfolioTelemetryState {
  // Sniper Scalping Engine PnL
  sniperUnrealizedPnlUsd: number;
  sniperUnrealizedPnlInr: number;
  sniperRealizedPnlUsd: number;
  sniperRealizedPnlInr: number;

  // Options Strategy Lab PnL
  optionsUnrealizedPnlUsd: number;
  optionsUnrealizedPnlInr: number;
  optionsRealizedPnlUsd: number;
  optionsRealizedPnlInr: number;

  // Base Positions PnL (from perpetual positions table & base balance)
  basePositionsPnlUsd: number;
  basePositionsPnlInr: number;
  baseRealizedPnlUsd: number;
  baseRealizedPnlInr: number;

  // Unified Computed Totals
  totalPortfolioUnrealizedPnlUsd: number;
  totalPortfolioUnrealizedPnlInr: number;
  totalFeesAndCashflowsUsd: number;
  totalFeesAndCashflowsInr: number;
  totalPortfolioRealizedPnlUsd: number;
  totalPortfolioRealizedPnlInr: number;
  totalPortfolioNetPnlUsd: number;
  totalPortfolioNetPnlInr: number;

  // Synchronized Margin & Equity Balances
  totalEquity: number;
  walletBalance: number;
  availableMargin: number;
  availableBalance: number;
  marginUsed: number;
  openPositionValueUsd: number;
  walletBalances: WalletAssetBalanceRow[];
  walletLastUpdated: number | null;
  walletDiagnosticError: DeltaWalletDiagnosticError | null;

  // Active Positions & Orders State (Strict clean empty default, no mock phantom positions)
  positions: Position[];
  openOrders: any[];
  activeOpenPositionsCount: number;
  totalUnrealizedPnl: number;

  // Closed Trade History with Journal Metadata
  history: ClosedTrade[];
  tradeJournalMap: Record<string, TradeJournalMetadata>;

  // Active Delta India USD/INR Exchange Rate (defaults to ₹85)
  usdInrRate: number;
}

export interface PortfolioContextType extends PortfolioTelemetryState {
  setSniperPnl: (unrealizedUsd: number, realizedUsd?: number) => void;
  setOptionsPnl: (unrealizedUsd: number, realizedUsd?: number) => void;
  setBasePositionsPnl: (unrealizedUsd: number, realizedUsd?: number) => void;
  setPositions: (positions: Position[] | ((prev: Position[]) => Position[])) => void;
  setOpenOrders: (orders: any[] | ((prev: any[]) => any[])) => void;
  setHistory: (history: ClosedTrade[] | ((prev: ClosedTrade[]) => ClosedTrade[])) => void;
  setPortfolioBalances: (balances: {
    totalEquity: number;
    walletBalance?: number;
    availableMargin: number;
    availableBalance?: number;
    marginUsed?: number;
    openPositionValueUsd?: number;
    diagnosticError?: DeltaWalletDiagnosticError | null;
  }) => void;
  refreshLiveWalletAndPositions: (
    creds?: { apiKey?: string; apiSecret?: string; environment?: 'PROD' | 'TESTNET' } | null
  ) => Promise<{
    walletResponse: DeltaLiveWalletResponse;
    positionsResponse: DeltaLivePositionsResponse;
  } | null>;
  refreshPositions: (
    creds?: { apiKey?: string; apiSecret?: string; environment?: 'PROD' | 'TESTNET' } | null
  ) => Promise<Position[]>;
  refreshWallet: (
    creds?: { apiKey?: string; apiSecret?: string; environment?: 'PROD' | 'TESTNET' } | null
  ) => Promise<DeltaLiveWalletResponse | null>;
  syncNow: () => Promise<void>;
  isSyncingLive: boolean;
  updateTradeJournal: (
    tradeId: string,
    metadata: {
      notes?: string;
      sentimentTag?: TradeSentimentTag;
      tags?: string[];
      lessonLearned?: string;
    }
  ) => void;
  getTradeJournal: (tradeId: string) => TradeJournalMetadata | undefined;
  resetSniperPnl: () => void;
  resetOptionsPnl: () => void;
  setUsdInrRate: (rate: number) => void;
  updatePositionStopLoss: (posIdOrSymbol: string, newStopLoss: number) => void;
  positionMismatchWarning: string | null;
  clearPositionMismatchWarning: () => void;
}

const DEFAULT_USD_INR_RATE = 85.0;

const defaultState: PortfolioContextType = {
  sniperUnrealizedPnlUsd: 0,
  sniperUnrealizedPnlInr: 0,
  sniperRealizedPnlUsd: 0,
  sniperRealizedPnlInr: 0,

  optionsUnrealizedPnlUsd: 0,
  optionsUnrealizedPnlInr: 0,
  optionsRealizedPnlUsd: 0,
  optionsRealizedPnlInr: 0,

  basePositionsPnlUsd: 0,
  basePositionsPnlInr: 0,
  baseRealizedPnlUsd: 0,
  baseRealizedPnlInr: 0,

  totalPortfolioUnrealizedPnlUsd: 0,
  totalPortfolioUnrealizedPnlInr: 0,
  totalFeesAndCashflowsUsd: 0,
  totalFeesAndCashflowsInr: 0,
  totalPortfolioRealizedPnlUsd: 0,
  totalPortfolioRealizedPnlInr: 0,
  totalPortfolioNetPnlUsd: 0,
  totalPortfolioNetPnlInr: 0,

  totalEquity: 1000.0,
  walletBalance: 1000.0,
  availableMargin: 1000.0,
  availableBalance: 1000.0,
  marginUsed: 0.0,
  openPositionValueUsd: 0.0,
  walletBalances: [],
  walletLastUpdated: null,
  walletDiagnosticError: null,

  positions: [],
  openOrders: [],
  activeOpenPositionsCount: 0,
  totalUnrealizedPnl: 0.00,

  history: [],
  tradeJournalMap: {},

  usdInrRate: DEFAULT_USD_INR_RATE,

  setSniperPnl: () => {},
  setOptionsPnl: () => {},
  setBasePositionsPnl: () => {},
  setPositions: () => {},
  setOpenOrders: () => {},
  setHistory: () => {},
  setPortfolioBalances: () => {},
  refreshLiveWalletAndPositions: async () => null,
  refreshPositions: async () => [],
  refreshWallet: async () => null,
  syncNow: async () => {},
  isSyncingLive: false,
  updateTradeJournal: () => {},
  getTradeJournal: () => undefined,
  resetSniperPnl: () => {},
  resetOptionsPnl: () => {},
  setUsdInrRate: () => {},
  updatePositionStopLoss: () => {},
  positionMismatchWarning: null,
  clearPositionMismatchWarning: () => {},
};

export const PortfolioContext = createContext<PortfolioContextType>(defaultState);

export const PortfolioProvider: React.FC<{ children: React.ReactNode; initialRate?: number }> = ({
  children,
  initialRate = DEFAULT_USD_INR_RATE,
}) => {
  const [usdInrRate, setUsdInrRateState] = useState<number>(initialRate);

  // Raw USD values
  const [sniperUnrealizedPnlUsd, setSniperUnrealizedUsd] = useState<number>(0);
  const [sniperRealizedPnlUsd, setSniperRealizedUsd] = useState<number>(0);

  const [optionsUnrealizedPnlUsd, setOptionsUnrealizedUsd] = useState<number>(0);
  const [optionsRealizedPnlUsd, setOptionsRealizedUsd] = useState<number>(0);

  const [basePositionsPnlUsd, setBasePositionsUsd] = useState<number>(0);
  const [baseRealizedPnlUsd, setBaseRealizedUsd] = useState<number>(0);

  // Synchronized Margin & Equity Balances
  const [totalEquity, setTotalEquity] = useState<number>(1000.0);
  const [walletBalance, setWalletBalance] = useState<number>(1000.0);
  const [availableMargin, setAvailableMargin] = useState<number>(1000.0);
  const [availableBalance, setAvailableBalance] = useState<number>(1000.0);
  const [marginUsed, setMarginUsed] = useState<number>(0.0);
  const [openPositionValueUsd, setOpenPositionValueUsd] = useState<number>(0.0);
  const [walletBalances, setWalletBalances] = useState<WalletAssetBalanceRow[]>([]);
  const [walletLastUpdated, setWalletLastUpdated] = useState<number | null>(null);
  const [walletDiagnosticError, setWalletDiagnosticError] = useState<DeltaWalletDiagnosticError | null>(null);

  const setUsdInrRate = useCallback((rate: number) => {
    if (rate > 0 && !isNaN(rate)) {
      setUsdInrRateState(rate);
    }
  }, []);

  const setPortfolioBalances = useCallback(
    (balances: {
      totalEquity: number;
      walletBalance?: number;
      availableMargin: number;
      availableBalance?: number;
      marginUsed?: number;
      openPositionValueUsd?: number;
      diagnosticError?: DeltaWalletDiagnosticError | null;
    }) => {
      const nextAvail = Number.isFinite(balances.availableMargin)
        ? +balances.availableMargin.toFixed(2)
        : Number.isFinite(balances.availableBalance)
        ? +(balances.availableBalance as number).toFixed(2)
        : 0;
      const nextBal = Number.isFinite(balances.availableBalance)
        ? +(balances.availableBalance as number).toFixed(2)
        : nextAvail;
      const nextEq = Number.isFinite(balances.totalEquity) ? +balances.totalEquity.toFixed(2) : nextAvail;
      const nextWalletBal = Number.isFinite(balances.walletBalance)
        ? +(balances.walletBalance as number).toFixed(2)
        : nextEq;
      const nextMargin = Number.isFinite(balances.marginUsed) ? +(balances.marginUsed as number).toFixed(2) : 0;
      const nextPosVal = Number.isFinite(balances.openPositionValueUsd)
        ? +(balances.openPositionValueUsd as number).toFixed(2)
        : 0;

      setAvailableMargin(nextAvail);
      setAvailableBalance(nextBal);
      setTotalEquity(nextEq);
      setWalletBalance(nextWalletBal);
      setMarginUsed(nextMargin);
      setOpenPositionValueUsd(nextPosVal);
      if (balances.diagnosticError !== undefined) {
        setWalletDiagnosticError(balances.diagnosticError);
      }
    },
    []
  );

  const setSniperPnl = useCallback((unrealizedUsd: number, realizedUsd?: number) => {
    const cleanUnrealized = isNaN(unrealizedUsd) ? 0 : +unrealizedUsd.toFixed(2);
    setSniperUnrealizedUsd((prev) => (Math.abs(prev - cleanUnrealized) < 0.0001 ? prev : cleanUnrealized));
    if (realizedUsd !== undefined && !isNaN(realizedUsd)) {
      const cleanRealized = +realizedUsd.toFixed(2);
      setSniperRealizedUsd((prev) => (Math.abs(prev - cleanRealized) < 0.0001 ? prev : cleanRealized));
    }
  }, []);

  const setOptionsPnl = useCallback((unrealizedUsd: number, realizedUsd?: number) => {
    const cleanUnrealized = isNaN(unrealizedUsd) ? 0 : +unrealizedUsd.toFixed(4);
    setOptionsUnrealizedUsd((prev) => (Math.abs(prev - cleanUnrealized) < 0.0001 ? prev : cleanUnrealized));
    if (realizedUsd !== undefined && !isNaN(realizedUsd)) {
      const cleanRealized = +realizedUsd.toFixed(2);
      setOptionsRealizedUsd((prev) => (Math.abs(prev - cleanRealized) < 0.0001 ? prev : cleanRealized));
    }
  }, []);

  const setBasePositionsPnl = useCallback((unrealizedUsd: number, realizedUsd?: number) => {
    const cleanUnrealized = isNaN(unrealizedUsd) ? 0 : +unrealizedUsd.toFixed(2);
    setBasePositionsUsd((prev) => (Math.abs(prev - cleanUnrealized) < 0.0001 ? prev : cleanUnrealized));
    if (realizedUsd !== undefined && !isNaN(realizedUsd)) {
      const cleanRealized = +realizedUsd.toFixed(2);
      setBaseRealizedUsd((prev) => (Math.abs(prev - cleanRealized) < 0.0001 ? prev : cleanRealized));
    }
  }, []);

  const resetSniperPnl = useCallback(() => {
    setSniperUnrealizedUsd((prev) => (prev === 0 ? prev : 0));
  }, []);

  const resetOptionsPnl = useCallback(() => {
    setOptionsUnrealizedUsd((prev) => (prev === 0 ? prev : 0));
  }, []);

  // Strict rule: NEVER hydrate active positions from cache or localStorage without live exchange validation
  const [positions, setPositionsState] = useState<Position[]>([]);
  const [positionMismatchWarning, setPositionMismatchWarning] = useState<string | null>(null);
  const mismatchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearPositionMismatchWarning = useCallback(() => {
    if (mismatchTimerRef.current) clearTimeout(mismatchTimerRef.current);
    setPositionMismatchWarning(null);
  }, []);

  const [openOrders, setOpenOrdersState] = useState<any[]>([]);
  const [history, setHistoryState] = useState<ClosedTrade[]>([]);

  // In-memory Trade Journal metadata mapping (never persisted to localStorage)
  const [tradeJournalMap, setTradeJournalMap] = useState<Record<string, TradeJournalMetadata>>({});

  // Strict boot purge: remove any legacy trading, position, order, fill, or PnL keys from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const legacyTradingKeys = [
        'delta_positions_v3',
        'delta_positions_v3_migrated',
        'delta_trade_journal_metadata_v1',
        'delta_sniper_active_trade_v1',
        'delta_active_sniper_trade',
        'delta_options_active_position_v1',
        'delta_active_options_strategy',
        'delta_sniper_closed_ex_sigs_v1',
        'delta_reconciled_closed_orders_v1',
        'delta_options_closed_ex_sigs_v1',
        'delta_rescue_circuit_breaker_v1',
        'delta_signal_history_v1',
        'delta_volatility_breach_history_v1',
      ];
      legacyTradingKeys.forEach((k) => window.localStorage.removeItem(k));
    } catch {}
  }, []);

  const setHistory = useCallback((updater: ClosedTrade[] | ((prev: ClosedTrade[]) => ClosedTrade[])) => {
    setHistoryState((prev: ClosedTrade[]) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      let changed = next.length !== prev.length;
      const mapped = next.map((trade: ClosedTrade, idx: number) => {
        const journal = tradeJournalMap[trade.id];
        let resolved = trade;
        if (
          journal &&
          ((journal.notes !== undefined && journal.notes !== trade.notes) ||
            (journal.sentimentTag !== undefined && journal.sentimentTag !== trade.sentimentTag) ||
            (journal.tags !== undefined && journal.tags !== trade.tags) ||
            (journal.lessonLearned !== undefined && journal.lessonLearned !== trade.lessonLearned) ||
            (journal.journalUpdatedAt !== undefined && journal.journalUpdatedAt !== trade.journalUpdatedAt))
        ) {
          resolved = {
            ...trade,
            notes: journal.notes ?? trade.notes,
            sentimentTag: journal.sentimentTag ?? trade.sentimentTag,
            tags: journal.tags ?? trade.tags,
            lessonLearned: journal.lessonLearned ?? trade.lessonLearned,
            journalUpdatedAt: journal.journalUpdatedAt ?? trade.journalUpdatedAt,
          };
        }
        if (!changed && prev[idx] !== resolved) {
          changed = true;
        }
        return resolved;
      });
      return changed ? mapped : prev;
    });
  }, [tradeJournalMap]);

  const updateTradeJournal = useCallback(
    (
      tradeId: string,
      metadata: {
        notes?: string;
        sentimentTag?: TradeSentimentTag;
        tags?: string[];
        lessonLearned?: string;
      }
    ) => {
      setTradeJournalMap((prev: Record<string, TradeJournalMetadata>) => {
        const existing = prev[tradeId] || {};
        const updated: TradeJournalMetadata = {
          ...existing,
          ...metadata,
          journalUpdatedAt: Date.now(),
        };
        return { ...prev, [tradeId]: updated };
      });

      setHistoryState((prev: ClosedTrade[]) =>
        prev.map((trade: ClosedTrade) => {
          if (trade.id === tradeId) {
            return {
              ...trade,
              ...metadata,
              journalUpdatedAt: Date.now(),
            };
          }
          return trade;
        })
      );
    },
    []
  );

  const getTradeJournal = useCallback(
    (tradeId: string): TradeJournalMetadata | undefined => {
      return tradeJournalMap[tradeId];
    },
    [tradeJournalMap]
  );

  const setPositions = useCallback((updater: Position[] | ((prev: Position[]) => Position[])) => {
    setPositionsState((prev: Position[]) => {
      const rawNext = typeof updater === 'function' ? updater(prev) : updater;
      const next = Array.isArray(rawNext) ? rawNext.filter((p) => !isExpiredOptionPosition(p)) : [];
      if (
        prev.length === next.length &&
        prev.every((item, idx) => item === next[idx])
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const setOpenOrders = useCallback((updater: any[] | ((prev: any[]) => any[])) => {
    setOpenOrdersState(updater);
  }, []);

  const updatePositionStopLoss = useCallback((posIdOrSymbol: string, newStopLoss: number) => {
    const cleanSym = String(posIdOrSymbol || '').trim().toUpperCase();
    setPositionsState((prev) =>
      prev.map((p) => {
        const matches =
          p.id === posIdOrSymbol ||
          p.symbol?.toUpperCase() === cleanSym ||
          p.rawSymbol?.toUpperCase() === cleanSym ||
          (p.product_id && String(p.product_id) === posIdOrSymbol);
        return matches ? { ...p, stopLoss: newStopLoss } : p;
      })
    );
  }, []);

  const [isSyncingLive, setIsSyncingLive] = useState<boolean>(false);

  const refreshLiveWalletAndPositions = useCallback(
    async (
      creds?: { apiKey?: string; apiSecret?: string; environment?: 'PROD' | 'TESTNET' } | null
    ): Promise<{
      walletResponse: DeltaLiveWalletResponse;
      positionsResponse: DeltaLivePositionsResponse;
    } | null> => {
      const effectiveCreds =
        creds && creds.apiKey && creds.apiSecret ? creds : getStoredDeltaCredentials();

      setIsSyncingLive(true);
      try {
        const result = await fetchDeltaLiveWalletAndPositions(effectiveCreds);
        const { walletResponse, positionsResponse } = result;

        if (walletResponse.status === 'success' && walletResponse.wallet) {
          const w = walletResponse.wallet as any;
          setAvailableMargin(w.availableMarginUsd ?? w.availableMargin);
          setAvailableBalance(w.availableBalance ?? w.availableMargin);
          setTotalEquity(w.netEquityUsd ?? w.totalEquity);
          setWalletBalance(w.walletBalanceUsd ?? w.walletBalance ?? w.totalEquity);
          setMarginUsed(w.marginUsed);
          setOpenPositionValueUsd(w.openPositionValueUsd ?? 0);
          setWalletBalances(Array.isArray(w.balances) ? w.balances : []);
          setWalletLastUpdated(w.timestamp || Date.now());
          setWalletDiagnosticError(null);
          if (typeof w.usdInrRate === 'number' && w.usdInrRate > 0) {
            setUsdInrRateState(w.usdInrRate);
          }
        } else if (walletResponse.diagnosticError && walletResponse.diagnosticError.code !== 'MISSING_API_CREDENTIALS') {
          setWalletDiagnosticError(walletResponse.diagnosticError);
        }

        if (positionsResponse.status === 'success' && Array.isArray(positionsResponse.positions)) {
          const activeOnly = positionsResponse.positions.filter(
            (p) => !isExpiredOptionPosition(p) && Math.abs(Number(p.size || (p as any).contracts || 0)) > 0
          );

          setPositionsState((prevPositions) => {
            const normSym = (s?: string) => String(s || '').toUpperCase().trim();
            const closedPositions = prevPositions.filter((prevPos) => {
              const prevSym = normSym(prevPos.product_symbol || prevPos.rawSymbol || prevPos.symbol);
              const match = activeOnly.find((active) => {
                const activeSym = normSym(active.product_symbol || active.rawSymbol || active.symbol);
                return (
                  (active.id && prevPos.id && active.id === prevPos.id) ||
                  (activeSym && prevSym && activeSym === prevSym)
                );
              });
              return !match || Math.abs(Number(match.size || (match as any).contracts || 0)) === 0;
            });

            if (closedPositions.length > 0) {
              const closedSyms = closedPositions.map((p) => p.rawSymbol || p.symbol).join(', ');
              const mismatchAlertText =
                `Position mismatch resolved: Delta Exchange India reported [${closedSyms}] closed (size === 0). Purged from in-memory state.`;
              console.warn(`[Delta Reconciliation Mismatch] ${mismatchAlertText}`);
              setPositionMismatchWarning(mismatchAlertText);
              if (mismatchTimerRef.current) clearTimeout(mismatchTimerRef.current);
              mismatchTimerRef.current = setTimeout(() => {
                setPositionMismatchWarning(null);
              }, 10000);

              if (activeOnly.length === 0) {
                setSniperUnrealizedUsd(0);
                setOptionsUnrealizedUsd(0);
              }

              closedPositions.forEach((pos) => {
                const sym = pos.rawSymbol || pos.symbol;
                fetch('/api/delta/purge-stale-positions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ symbol: sym }),
                }).catch(() => {});
              });

              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('delta:position-mismatch-detected', {
                    detail: {
                      closedPositions,
                      message: mismatchAlertText,
                    },
                  })
                );
              }

              // Reconcile each closed position via /api/delta/reconcile-closed-position to cancel lingering brackets & fetch exact /v2/fills PnL
              closedPositions.forEach((pos) => {
                const reqHeaders: Record<string, string> = {
                  'Content-Type': 'application/json',
                  'x-admin-email': 'dhanrajk69@gmail.com',
                };
                if (effectiveCreds?.apiKey && effectiveCreds?.apiSecret) {
                  reqHeaders['x-delta-api-key'] = effectiveCreds.apiKey;
                  reqHeaders['x-delta-api-secret'] = effectiveCreds.apiSecret;
                }
                fetch('/api/delta/reconcile-closed-position', {
                  method: 'POST',
                  headers: reqHeaders,
                  body: JSON.stringify({
                    symbol: pos.rawSymbol || pos.symbol,
                    productId: pos.product_id,
                    entryPrice: pos.entryPrice,
                    openedAt: pos.openedAt,
                    fallbackPnlUsd: pos.unrealisedPnl || 0,
                    side: pos.side,
                    size: pos.size,
                    cancelOpenBrackets: true,
                  }),
                  cache: 'no-store',
                })
                  .then((r) => (r.ok ? r.json() : null))
                  .then((rec) => {
                    if (rec?.success && rec?.closedTrade) {
                      setHistoryState((prev) => {
                        const targetId = rec.closedTrade.id;
                        const without = prev.filter((t) => t.id !== targetId);
                        const nextList = [rec.closedTrade, ...without];
                        const realizedSum = +nextList.reduce((s, item) => s + Number(item.realisedPnl || 0), 0).toFixed(2);
                        setBaseRealizedUsd(realizedSum);
                        return nextList;
                      });
                    }
                  })
                  .catch(() => {});
              });
            }

            if (typeof window !== 'undefined') {
              try {
                window.dispatchEvent(
                  new CustomEvent('delta:positions-reconciled', {
                    detail: {
                      activePositions: activeOnly,
                      closedPositions,
                    },
                  })
                );
              } catch {}
            }
            return activeOnly;
          });
        }

        return result;
      } catch (err: any) {
        const diag: DeltaWalletDiagnosticError = {
          code: 'NETWORK_ERROR',
          message: err?.message || 'Failed to reach /api/delta/wallet',
          timestamp: Date.now(),
        };
        setWalletDiagnosticError(diag);
        return null;
      } finally {
        setIsSyncingLive(false);
      }
    },
    []
  );

  // Full Authoritative REST Resync (/v2/positions/margined, /v2/orders?state=open, /v2/fills, /v2/wallet/balances)
  // Overwrites in-memory positions, openOrders, fills history, realized PnL, and wallet cleanly on mount & WS reconnect
  const resyncAuthoritativeState = useCallback(async () => {
    const creds = getStoredDeltaCredentials();
    setIsSyncingLive(true);
    try {
      const snapshot = await fetchDeltaAuthoritativeResync(creds);
      if (!snapshot || !snapshot.authenticated) {
        // Fall back to standard wallet+positions check if unauthenticated
        await refreshLiveWalletAndPositions(creds);
        return;
      }

      if (snapshot.wallet) {
        const w = snapshot.wallet;
        setAvailableMargin(w.availableMarginUsd ?? w.availableMargin ?? 0);
        setAvailableBalance(w.availableBalance ?? w.availableMargin ?? 0);
        setTotalEquity(w.netEquityUsd ?? w.totalEquity ?? 0);
        setWalletBalance(w.walletBalanceUsd ?? w.walletBalance ?? w.totalEquity ?? 0);
        setMarginUsed(w.marginUsed ?? 0);
        setOpenPositionValueUsd(w.openPositionValueUsd ?? 0);
        setWalletBalances(Array.isArray(w.balances) ? w.balances : []);
        setWalletLastUpdated(Date.now());
        setWalletDiagnosticError(null);
      } else if (snapshot.diagnosticError && snapshot.diagnosticError.code !== 'MISSING_API_CREDENTIALS') {
        setWalletDiagnosticError(snapshot.diagnosticError);
      }

      if (typeof snapshot.usdInrRate === 'number' && snapshot.usdInrRate > 0) {
        setUsdInrRateState(snapshot.usdInrRate);
      }

      const activeOnly = (Array.isArray(snapshot.positions) ? snapshot.positions : []).filter(
        (p) => !isExpiredOptionPosition(p) && Math.abs(Number(p.size || (p as any).contracts || 0)) > 0
      );

      // Overwrite open orders cleanly and log if stale orders were purged
      const freshOpenOrders = Array.isArray(snapshot.openOrders) ? snapshot.openOrders : [];
      setOpenOrdersState((prevOrders) => {
        if (prevOrders.length > 0) {
          const freshIds = new Set(freshOpenOrders.map((o: any) => String(o.id ?? o.order_id)));
          const purgedOrders = prevOrders.filter((o: any) => !freshIds.has(String(o.id ?? o.order_id)));
          if (purgedOrders.length > 0) {
            console.warn(
              `[Delta Order Mismatch] Purged ${purgedOrders.length} omitted/closed order(s) during authoritative resync.`
            );
          }
        }
        return freshOpenOrders;
      });

      // Overwrite fills & Booked Profit (Realized P&L) cleanly from Delta Exchange /v2/fills
      if (Array.isArray(snapshot.fills)) {
        const mappedFills = snapshot.fills as ClosedTrade[];
        setHistoryState(mappedFills);
        const totalBookedUsd = +mappedFills
          .reduce((sum, f) => sum + Number(f.realisedPnl || 0), 0)
          .toFixed(2);
        setBaseRealizedUsd(totalBookedUsd);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('delta:full-history-synced', {
              detail: {
                tradeHistory: mappedFills,
                pairedTradesCount: mappedFills.length,
                warehouseAddedCount: 0,
              },
            })
          );
        }
      }

      // Reconcile & overwrite open positions cleanly
      setPositionsState((prevPositions) => {
        const normSym = (s?: string) => String(s || '').toUpperCase().trim();
        const closedPositions = prevPositions.filter((prevPos) => {
          const prevSym = normSym(prevPos.product_symbol || prevPos.rawSymbol || prevPos.symbol);
          const match = activeOnly.find((active) => {
            const activeSym = normSym(active.product_symbol || active.rawSymbol || active.symbol);
            return (
              (active.id && prevPos.id && active.id === prevPos.id) ||
              (activeSym && prevSym && activeSym === prevSym)
            );
          });
          return !match || Math.abs(Number(match.size || (match as any).contracts || 0)) === 0;
        });

        if (closedPositions.length > 0) {
          const closedSyms = closedPositions.map((p) => p.rawSymbol || p.symbol).join(', ');
          const mismatchMsg = `Position mismatch resolved: Delta Exchange India reported [${closedSyms}] closed/omitted. Purged immediately.`;
          console.warn(`[Delta Reconciliation Mismatch] ${mismatchMsg}`);
          setPositionMismatchWarning(mismatchMsg);
          if (mismatchTimerRef.current) clearTimeout(mismatchTimerRef.current);
          mismatchTimerRef.current = setTimeout(() => setPositionMismatchWarning(null), 10000);

          if (activeOnly.length === 0) {
            setSniperUnrealizedUsd(0);
            setOptionsUnrealizedUsd(0);
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('delta:position-mismatch-detected', {
                detail: { closedPositions, message: mismatchMsg },
              })
            );
          }
        } else if (activeOnly.length === 0) {
          setSniperUnrealizedUsd(0);
          setOptionsUnrealizedUsd(0);
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('delta:positions-reconciled', {
              detail: { activePositions: activeOnly, closedPositions },
            })
          );
        }
        return activeOnly;
      });
    } finally {
      setIsSyncingLive(false);
    }
  }, [refreshLiveWalletAndPositions]);

  // Lightweight 5-second REST reconciliation check alongside WebSocket feed
  useEffect(() => {
    void resyncAuthoritativeState();
    const timer = setInterval(() => {
      void resyncAuthoritativeState();
    }, 5000);
    return () => clearInterval(timer);
  }, [resyncAuthoritativeState]);

  // Real-time WebSocket stream handlers (wss://socket.india.delta.exchange) + full REST resync on WS reconnect
  useEffect(() => {
    const handleWsReconnectResync = () => {
      void resyncAuthoritativeState();
    };

    const handleWsPositions = (e: any) => {
      const payload = e?.detail;
      if (!payload) return;
      const items = Array.isArray(payload.result)
        ? payload.result
        : Array.isArray(payload.positions)
        ? payload.positions
        : payload.symbol || payload.product_symbol || payload.product_id
        ? [payload]
        : [];

      if (items.length === 0) return;

      setPositionsState((prev) => {
        let next = [...prev];
        const newlyClosed: Position[] = [];
        const norm = (s?: string) => String(s || '').toUpperCase().trim();

        for (const raw of items) {
          const rawSym = norm(raw.product_symbol || raw.symbol);
          const prodId = raw.product_id ? Number(raw.product_id) : undefined;
          const signedContracts = Number(raw.size ?? 0);

          const matchIdx = next.findIndex((p) => {
            const pSym = norm(p.product_symbol || p.rawSymbol || p.symbol);
            return (prodId && p.product_id === prodId) || (rawSym && (pSym === rawSym || pSym === `${rawSym}T`));
          });

          if (!Number.isFinite(signedContracts) || Math.abs(signedContracts) === 0 || raw.action === 'delete') {
            if (matchIdx !== -1) {
              const removed = next[matchIdx];
              newlyClosed.push(removed);
              next.splice(matchIdx, 1);
              console.warn(
                `[Delta WS Position Closed] ${rawSym || removed.symbol} reported size === 0 on WebSocket. Purged immediately.`
              );
            }
          } else {
            const isOpt = rawSym.startsWith('C-') || rawSym.startsWith('P-');
            const cVal = Number(
              raw.contract_value ||
                (rawSym.includes('BTC') ? 0.001 : rawSym.includes('ETH') ? 0.01 : rawSym.includes('DOGE') ? 100 : 1)
            );
            const absContracts = Math.abs(signedContracts);
            const coinSize = isOpt ? absContracts : +(absContracts * cVal).toFixed(6);
            const side: 'LONG' | 'SHORT' = signedContracts < 0 ? 'SHORT' : 'LONG';
            const entryPx = Number(raw.entry_price ?? (matchIdx !== -1 ? next[matchIdx].entryPrice : 0));
            const markPx = Number(raw.mark_price ?? (matchIdx !== -1 ? next[matchIdx].markPrice : entryPx));
            const signedCoin = isOpt ? signedContracts * cVal : side === 'SHORT' ? -coinSize : coinSize;
            const uPnl =
              raw.unrealized_pnl !== undefined && Number.isFinite(Number(raw.unrealized_pnl))
                ? Number(raw.unrealized_pnl)
                : entryPx > 0 && markPx > 0
                ? +((markPx - entryPx) * signedCoin).toFixed(4)
                : 0;

            const updatedPos: Position = {
              ...(matchIdx !== -1 ? next[matchIdx] : ({} as Position)),
              id: prodId ? String(prodId) : rawSym,
              product_id: prodId,
              symbol: isOpt ? rawSym : rawSym.endsWith('USD') ? `${rawSym}T` : rawSym,
              rawSymbol: rawSym,
              product_symbol: rawSym,
              contract_type: isOpt
                ? rawSym.startsWith('C-')
                  ? 'call_options'
                  : 'put_options'
                : 'perpetual_futures',
              side,
              size: coinSize,
              signedSize: signedContracts,
              contracts: absContracts,
              contractValue: cVal,
              entryPrice: entryPx,
              entry_price: entryPx,
              markPrice: markPx,
              mark_price: markPx,
              liquidationPrice: Number(raw.liquidation_price ?? (matchIdx !== -1 ? next[matchIdx].liquidationPrice : 0)),
              leverage: Number(raw.leverage ?? (matchIdx !== -1 ? next[matchIdx].leverage : 10)),
              margin: Number(raw.margin ?? (matchIdx !== -1 ? next[matchIdx].margin : 0)),
              unrealisedPnl: +uPnl.toFixed(4),
              unrealized_pnl: +uPnl.toFixed(4),
              unrealisedPnlPercent:
                Number(raw.margin || 0) > 0 ? +((uPnl / Number(raw.margin)) * 100).toFixed(2) : 0,
              openedAt: matchIdx !== -1 ? next[matchIdx].openedAt : Date.now(),
              strategy: matchIdx !== -1 ? next[matchIdx].strategy : 'Delta Exchange Live',
              mode: 'LIVE',
            };

            if (matchIdx !== -1) {
              next[matchIdx] = updatedPos;
            } else {
              next.push(updatedPos);
            }
          }
        }

        if (newlyClosed.length > 0) {
          if (next.length === 0) {
            setSniperUnrealizedUsd(0);
            setOptionsUnrealizedUsd(0);
          }
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('delta:position-mismatch-detected', {
                detail: {
                  closedPositions: newlyClosed,
                  message: 'Position closed on Delta Exchange India (WebSocket size === 0).',
                },
              })
            );
            window.dispatchEvent(
              new CustomEvent('delta:positions-reconciled', {
                detail: { activePositions: next, closedPositions: newlyClosed },
              })
            );
          }
          void resyncAuthoritativeState();
        }
        return next;
      });
    };

    const handleWsOrders = (e: any) => {
      const payload = e?.detail;
      if (!payload) return;
      const items = Array.isArray(payload.result)
        ? payload.result
        : payload.id || payload.order_id
        ? [payload]
        : [];
      if (items.length === 0) return;

      setOpenOrdersState((prev) => {
        let next = [...prev];
        for (const ord of items) {
          const idStr = String(ord.id ?? ord.order_id ?? '');
          if (!idStr) continue;
          const st = String(ord.state || '').toLowerCase();
          const isOpen = st === 'open' || st === 'pending';
          const idx = next.findIndex((o) => String(o.id ?? o.order_id) === idStr);
          if (!isOpen || ord.action === 'delete') {
            if (idx !== -1) next.splice(idx, 1);
          } else if (idx !== -1) {
            next[idx] = { ...next[idx], ...ord };
          } else {
            next.unshift(ord);
          }
        }
        return next;
      });
    };

    const handleWsUserTrades = () => {
      // Immediately resync fills, realized P&L, and positions on any live execution fill
      void resyncAuthoritativeState();
    };

    const handleWsMargins = (e: any) => {
      const m = e?.detail;
      if (!m) return;
      const avail = Number(m.available_balance ?? m.availableMarginUsd);
      const bal = Number(m.balance ?? m.walletBalanceUsd);
      const posMargin = Number(m.position_margin ?? m.order_margin);
      if (Number.isFinite(avail) && avail >= 0) {
        setAvailableMargin(+avail.toFixed(2));
        setAvailableBalance(+avail.toFixed(2));
      }
      if (Number.isFinite(bal) && bal >= 0) {
        setWalletBalance(+bal.toFixed(2));
      }
      if (Number.isFinite(posMargin) && posMargin >= 0) {
        setMarginUsed(+posMargin.toFixed(2));
      }
    };

    // Live tick-by-tick mark-to-market unrealized P&L recalculation across open perp & option legs
    const handleLiveTickMarkUpdate = (e: any) => {
      const d = e?.detail;
      if (!d || !d.symbol || !(Number(d.markPrice) > 0)) return;
      const tickSym = String(d.symbol).toUpperCase().trim();
      const tickMark = Number(d.markPrice);

      setPositionsState((prev) => {
        if (prev.length === 0) return prev;
        let mutated = false;
        const updated = prev.map((p) => {
          const pSym = String(p.product_symbol || p.rawSymbol || p.symbol || '').toUpperCase().trim();
          const canonicalPSym = pSym.endsWith('USD') ? `${pSym}T` : pSym;
          if (pSym !== tickSym && canonicalPSym !== tickSym && p.symbol?.toUpperCase() !== tickSym) {
            return p;
          }
          if (Math.abs((p.markPrice || 0) - tickMark) < 0.0001) return p;
          mutated = true;
          const isOpt =
            p.contract_type === 'call_options' ||
            p.contract_type === 'put_options' ||
            pSym.startsWith('C-') ||
            pSym.startsWith('P-');
          const entryPx = Number(p.entry_price ?? p.entryPrice ?? 0);
          const cVal = Number(p.contractValue || (pSym.includes('BTC') ? 0.001 : pSym.includes('ETH') ? 0.01 : 1));
          let nextUpnl = p.unrealisedPnl || 0;
          if (entryPx > 0) {
            if (isOpt) {
              const contractsCount = Math.abs(Number(p.contracts || p.size || 0));
              const signedCoin = (p.side === 'SHORT' ? -contractsCount : contractsCount) * cVal;
              nextUpnl = +((tickMark - entryPx) * signedCoin).toFixed(4);
            } else {
              const absCoinSize = Math.abs(Number(p.size || 0));
              nextUpnl =
                p.side === 'LONG'
                  ? +((tickMark - entryPx) * absCoinSize).toFixed(4)
                  : +((entryPx - tickMark) * absCoinSize).toFixed(4);
            }
          }
          const nextUpnlPct = p.margin > 0 ? +((nextUpnl / p.margin) * 100).toFixed(2) : p.unrealisedPnlPercent;
          return {
            ...p,
            markPrice: tickMark,
            mark_price: tickMark,
            unrealisedPnl: nextUpnl,
            unrealized_pnl: nextUpnl,
            unrealisedPnlPercent: nextUpnlPct,
          };
        });
        return mutated ? updated : prev;
      });
    };

    window.addEventListener('delta:ws-reconnected-resync', handleWsReconnectResync);
    window.addEventListener('delta:ws-positions', handleWsPositions);
    window.addEventListener('delta:ws-orders', handleWsOrders);
    window.addEventListener('delta:ws-user-trades', handleWsUserTrades);
    window.addEventListener('delta:ws-margins', handleWsMargins);
    window.addEventListener('delta:ws-ticker', handleLiveTickMarkUpdate);
    window.addEventListener('delta:ws-option-ticker', handleLiveTickMarkUpdate);

    return () => {
      window.removeEventListener('delta:ws-reconnected-resync', handleWsReconnectResync);
      window.removeEventListener('delta:ws-positions', handleWsPositions);
      window.removeEventListener('delta:ws-orders', handleWsOrders);
      window.removeEventListener('delta:ws-user-trades', handleWsUserTrades);
      window.removeEventListener('delta:ws-margins', handleWsMargins);
      window.removeEventListener('delta:ws-ticker', handleLiveTickMarkUpdate);
      window.removeEventListener('delta:ws-option-ticker', handleLiveTickMarkUpdate);
    };
  }, [resyncAuthoritativeState]);

  // Immediate Ratchet Breakeven Stop-Loss update listener
  useEffect(() => {
    const handleSlUpdate = (e: any) => {
      const sym = e?.detail?.symbol;
      const newSl = e?.detail?.newStopLoss;
      if (sym && typeof newSl === 'number' && Number.isFinite(newSl) && newSl > 0) {
        updatePositionStopLoss(sym, newSl);
      }
    };
    window.addEventListener('delta:update-position-sl', handleSlUpdate);
    return () => window.removeEventListener('delta:update-position-sl', handleSlUpdate);
  }, [updatePositionStopLoss]);

  const syncNow = useCallback(async () => {
    await resyncAuthoritativeState();
  }, [resyncAuthoritativeState]);

  const refreshPositions = useCallback(
    async (
      creds?: { apiKey?: string; apiSecret?: string; environment?: 'PROD' | 'TESTNET' } | null
    ): Promise<Position[]> => {
      const res = await refreshLiveWalletAndPositions(creds);
      return res?.positionsResponse?.positions || [];
    },
    [refreshLiveWalletAndPositions]
  );

  const refreshWallet = useCallback(
    async (
      creds?: { apiKey?: string; apiSecret?: string; environment?: 'PROD' | 'TESTNET' } | null
    ): Promise<DeltaLiveWalletResponse | null> => {
      const res = await refreshLiveWalletAndPositions(creds);
      return res?.walletResponse || null;
    },
    [refreshLiveWalletAndPositions]
  );

  // Separate live option contracts (call_options / put_options) from futures positions
  const liveOptionPositions = useMemo(
    () =>
      positions.filter((p) => {
        const sym = String(p.rawSymbol || p.symbol || '').toUpperCase();
        return (
          p.contract_type === 'call_options' ||
          p.contract_type === 'put_options' ||
          sym.startsWith('C-') ||
          sym.startsWith('P-')
        );
      }),
    [positions]
  );

  const liveFuturesPositions = useMemo(
    () =>
      positions.filter((p) => {
        const sym = String(p.rawSymbol || p.symbol || '').toUpperCase();
        return !(
          p.contract_type === 'call_options' ||
          p.contract_type === 'put_options' ||
          sym.startsWith('C-') ||
          sym.startsWith('P-')
        );
      }),
    [positions]
  );

  const liveOptionsUpnlFromExchangeUsd = useMemo(
    () => +liveOptionPositions.reduce((acc, p) => acc + (p.unrealisedPnl ?? p.unrealized_pnl ?? 0), 0).toFixed(4),
    [liveOptionPositions]
  );

  const effectiveOptionsUnrealizedUsd =
    liveOptionPositions.length > 0 ? liveOptionsUpnlFromExchangeUsd : optionsUnrealizedPnlUsd;

  // INR values computed dynamically from USD values using current rate
  const sniperUnrealizedPnlInr = +(sniperUnrealizedPnlUsd * usdInrRate).toFixed(2);
  const sniperRealizedPnlInr = +(sniperRealizedPnlUsd * usdInrRate).toFixed(2);

  const optionsUnrealizedPnlInr = +(effectiveOptionsUnrealizedUsd * usdInrRate).toFixed(2);
  const optionsRealizedPnlInr = +(optionsRealizedPnlUsd * usdInrRate).toFixed(2);

  const basePositionsPnlInr = +(basePositionsPnlUsd * usdInrRate).toFixed(2);
  const baseRealizedPnlInr = +(baseRealizedPnlUsd * usdInrRate).toFixed(2);

  // Live mark-to-market UPNL across open positions without double-counting
  const rawPositionsUpnlUsd = +positions
    .reduce((acc, p) => acc + (p.unrealisedPnl ?? p.unrealized_pnl ?? 0), 0)
    .toFixed(4);
  const rawPositionsUpnlInr = +(rawPositionsUpnlUsd * usdInrRate).toFixed(2);

  const rawFuturesUpnlUsd = +liveFuturesPositions
    .reduce((acc, p) => acc + (p.unrealisedPnl ?? p.unrealized_pnl ?? 0), 0)
    .toFixed(4);
  const rawFuturesUpnlInr = +(rawFuturesUpnlUsd * usdInrRate).toFixed(2);

  const computedOpenPosValueUsd = useMemo(() => {
    if (positions.length === 0) return 0;
    return +positions
      .reduce(
        (acc, p) =>
          acc +
          (Number.isFinite(p.notionalUsd) && (p.notionalUsd || 0) > 0
            ? (p.notionalUsd as number)
            : Math.abs(p.size || 0) * (p.contractValue || 1) * (p.markPrice || p.entryPrice || 0)),
        0
      )
      .toFixed(2);
  }, [positions]);

  const effectiveOpenPositionValueUsd =
    positions.length > 0 ? computedOpenPosValueUsd : openPositionValueUsd;

  const effectiveBaseUpnlUsd =
    liveFuturesPositions.length > 0 ? rawFuturesUpnlUsd : positions.length > 0 ? rawPositionsUpnlUsd : basePositionsPnlUsd;
  const effectiveBaseUpnlInr =
    liveFuturesPositions.length > 0 ? rawFuturesUpnlInr : positions.length > 0 ? rawPositionsUpnlInr : basePositionsPnlInr;

  // Unified Computed Totals (never double-count live option positions already inside `positions`)
  const totalPortfolioUnrealizedPnlUsd =
    positions.length > 0
      ? +(rawPositionsUpnlUsd + (liveOptionPositions.length === 0 ? optionsUnrealizedPnlUsd : 0)).toFixed(4)
      : +optionsUnrealizedPnlUsd.toFixed(4);

  const totalPortfolioUnrealizedPnlInr = +(totalPortfolioUnrealizedPnlUsd * usdInrRate).toFixed(2);

  const totalFeesAndCashflowsUsd = +positions
    .reduce(
      (acc, p) =>
        acc +
        (p.fees_and_cashflows_usd ??
          ((p.realized_cashflow ?? 0) + ((p.fees ?? 0) > 0 ? -(p.fees ?? 0) : (p.fees ?? 0)))),
      0
    )
    .toFixed(6);
  const totalFeesAndCashflowsInr = +(totalFeesAndCashflowsUsd * usdInrRate).toFixed(2);

  const totalPortfolioRealizedPnlUsd = +(
    baseRealizedPnlUsd +
    sniperRealizedPnlUsd +
    optionsRealizedPnlUsd
  ).toFixed(2);

  const totalPortfolioRealizedPnlInr = +(
    baseRealizedPnlInr +
    sniperRealizedPnlInr +
    optionsRealizedPnlInr
  ).toFixed(2);

  const totalPortfolioNetPnlUsd = +(
    totalPortfolioUnrealizedPnlUsd + totalPortfolioRealizedPnlUsd
  ).toFixed(2);

  const totalPortfolioNetPnlInr = +(
    totalPortfolioUnrealizedPnlInr + totalPortfolioRealizedPnlInr
  ).toFixed(2);

  const value = useMemo<PortfolioContextType>(
    () => ({
      sniperUnrealizedPnlUsd,
      sniperUnrealizedPnlInr,
      sniperRealizedPnlUsd,
      sniperRealizedPnlInr,

      optionsUnrealizedPnlUsd: effectiveOptionsUnrealizedUsd,
      optionsUnrealizedPnlInr,
      optionsRealizedPnlUsd,
      optionsRealizedPnlInr,

      basePositionsPnlUsd: effectiveBaseUpnlUsd,
      basePositionsPnlInr: effectiveBaseUpnlInr,
      baseRealizedPnlUsd,
      baseRealizedPnlInr,

      totalPortfolioUnrealizedPnlUsd,
      totalPortfolioUnrealizedPnlInr,
      totalFeesAndCashflowsUsd,
      totalFeesAndCashflowsInr,
      totalPortfolioRealizedPnlUsd,
      totalPortfolioRealizedPnlInr,
      totalPortfolioNetPnlUsd,
      totalPortfolioNetPnlInr,

      totalEquity,
      walletBalance,
      availableMargin,
      availableBalance,
      marginUsed,
      openPositionValueUsd: effectiveOpenPositionValueUsd,
      walletBalances,
      walletLastUpdated,
      walletDiagnosticError,

      positions,
      openOrders,
      activeOpenPositionsCount: positions.length,
      totalUnrealizedPnl: positions.length === 0 && effectiveOptionsUnrealizedUsd === 0 ? 0.00 : totalPortfolioUnrealizedPnlUsd,

      history,
      tradeJournalMap,

      usdInrRate,

      setSniperPnl,
      setOptionsPnl,
      setBasePositionsPnl,
      setPositions,
      setOpenOrders,
      setHistory,
      setPortfolioBalances,
      refreshLiveWalletAndPositions,
      refreshPositions,
      refreshWallet,
      syncNow,
      isSyncingLive,
      updateTradeJournal,
      getTradeJournal,
      resetSniperPnl,
      resetOptionsPnl,
      setUsdInrRate,
      updatePositionStopLoss,
      positionMismatchWarning,
      clearPositionMismatchWarning,
    }),
    [
      sniperUnrealizedPnlUsd,
      sniperUnrealizedPnlInr,
      sniperRealizedPnlUsd,
      sniperRealizedPnlInr,
      effectiveOptionsUnrealizedUsd,
      optionsUnrealizedPnlInr,
      optionsRealizedPnlUsd,
      optionsRealizedPnlInr,
      effectiveBaseUpnlUsd,
      effectiveBaseUpnlInr,
      baseRealizedPnlUsd,
      baseRealizedPnlInr,
      totalPortfolioUnrealizedPnlUsd,
      totalPortfolioUnrealizedPnlInr,
      totalFeesAndCashflowsUsd,
      totalFeesAndCashflowsInr,
      totalPortfolioRealizedPnlUsd,
      totalPortfolioRealizedPnlInr,
      totalPortfolioNetPnlUsd,
      totalPortfolioNetPnlInr,
      totalEquity,
      walletBalance,
      availableMargin,
      availableBalance,
      marginUsed,
      effectiveOpenPositionValueUsd,
      walletBalances,
      walletLastUpdated,
      walletDiagnosticError,
      positions,
      openOrders,
      history,
      tradeJournalMap,
      usdInrRate,
      setSniperPnl,
      setOptionsPnl,
      setBasePositionsPnl,
      setPositions,
      setOpenOrders,
      setHistory,
      setPortfolioBalances,
      refreshLiveWalletAndPositions,
      refreshPositions,
      refreshWallet,
      syncNow,
      isSyncingLive,
      updateTradeJournal,
      getTradeJournal,
      resetSniperPnl,
      resetOptionsPnl,
      setUsdInrRate,
      updatePositionStopLoss,
      positionMismatchWarning,
      clearPositionMismatchWarning,
    ]
  );

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
};

export const usePortfolio = (): PortfolioContextType => {
  const context = useContext(PortfolioContext);
  return context || defaultState;
};
