import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { Position, ClosedTrade, TradeSentimentTag } from '../types';
import {
  AUTHENTIC_DELTA_POSITIONS,
  DeltaWalletDiagnosticError,
  DeltaLiveWalletResponse,
  DeltaLivePositionsResponse,
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
    setSniperUnrealizedUsd(cleanUnrealized);
    if (realizedUsd !== undefined && !isNaN(realizedUsd)) {
      setSniperRealizedUsd(+realizedUsd.toFixed(2));
    }
  }, []);

  const setOptionsPnl = useCallback((unrealizedUsd: number, realizedUsd?: number) => {
    const cleanUnrealized = isNaN(unrealizedUsd) ? 0 : +unrealizedUsd.toFixed(4);
    setOptionsUnrealizedUsd(cleanUnrealized);
    if (realizedUsd !== undefined && !isNaN(realizedUsd)) {
      setOptionsRealizedUsd(+realizedUsd.toFixed(2));
    }
  }, []);

  const setBasePositionsPnl = useCallback((unrealizedUsd: number, realizedUsd?: number) => {
    const cleanUnrealized = isNaN(unrealizedUsd) ? 0 : +unrealizedUsd.toFixed(2);
    setBasePositionsUsd(cleanUnrealized);
    if (realizedUsd !== undefined && !isNaN(realizedUsd)) {
      setBaseRealizedUsd(+realizedUsd.toFixed(2));
    }
  }, []);

  const resetSniperPnl = useCallback(() => {
    setSniperUnrealizedUsd(0);
  }, []);

  const resetOptionsPnl = useCallback(() => {
    setOptionsUnrealizedUsd(0);
  }, []);

  const [positions, setPositionsState] = useState<Position[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('delta_positions_v3');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const valid = parsed.filter(
              (p: any) =>
                p &&
                ![
                  'pos-1',
                  'pos-2',
                  'pos-3',
                  'mock-1',
                  'mock-2',
                  'mock-btc',
                  'mock-eth',
                  'mock-sol',
                  'delta-live-1',
                  'delta-live-2',
                ].includes(p.id) &&
                !isExpiredOptionPosition(p)
            );
            if (valid.length > 0) return valid;
          }
        }
      } catch {
        // Ignore malformed or restricted storage cache
      }
    }
    return [];
  });

  const [openOrders, setOpenOrdersState] = useState<any[]>([]);
  const [history, setHistoryState] = useState<ClosedTrade[]>([]);

  // Persistent Trade Journal metadata mapping (tradeId -> notes, sentiment, tags)
  const [tradeJournalMap, setTradeJournalMap] = useState<Record<string, TradeJournalMetadata>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('delta_trade_journal_metadata_v1');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === 'object') return parsed;
        }
      } catch {
        // Ignore malformed or restricted journal metadata cache
      }
    }
    return {};
  });

  const setHistory = useCallback((updater: ClosedTrade[] | ((prev: ClosedTrade[]) => ClosedTrade[])) => {
    setHistoryState((prev: ClosedTrade[]) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Merge in any existing journal metadata without creating new refs if identical
      let changed = next.length !== prev.length;
      const mapped = next.map((trade: ClosedTrade, idx: number) => {
        const journal = tradeJournalMap[trade.id];
        let resolved = trade;
        if (
          journal &&
          (journal.notes !== undefined && journal.notes !== trade.notes ||
            journal.sentimentTag !== undefined && journal.sentimentTag !== trade.sentimentTag ||
            journal.tags !== undefined && journal.tags !== trade.tags ||
            journal.lessonLearned !== undefined && journal.lessonLearned !== trade.lessonLearned ||
            journal.journalUpdatedAt !== undefined && journal.journalUpdatedAt !== trade.journalUpdatedAt)
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
        const next = { ...prev, [tradeId]: updated };
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('delta_trade_journal_metadata_v1', JSON.stringify(next));
          } catch {}
        }
        return next;
      });

      // Also merge into active history state
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
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('delta_positions_v3', JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, []);

  const setOpenOrders = useCallback((updater: any[] | ((prev: any[]) => any[])) => {
    setOpenOrdersState(updater);
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
          const activeOnly = positionsResponse.positions.filter((p) => !isExpiredOptionPosition(p));
          setPositionsState(activeOnly);
          if (typeof window !== 'undefined') {
            try {
              localStorage.setItem('delta_positions_v3', JSON.stringify(activeOnly));
            } catch {}
          }
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

  // Fast 3-second polling of /api/delta/positions and /api/delta/wallet (supports both local and server-stored credentials)
  useEffect(() => {
    const stored = getStoredDeltaCredentials();
    refreshLiveWalletAndPositions(stored);
    const timer = setInterval(() => {
      const creds = getStoredDeltaCredentials();
      refreshLiveWalletAndPositions(creds);
    }, 3000);
    return () => clearInterval(timer);
  }, [refreshLiveWalletAndPositions]);

  const syncNow = useCallback(async () => {
    const creds = getStoredDeltaCredentials();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-admin-email': 'dhanrajk69@gmail.com',
    };
    if (creds?.apiKey && creds?.apiSecret) {
      headers['x-delta-api-key'] = creds.apiKey;
      headers['x-delta-api-secret'] = creds.apiSecret;
    }

    await Promise.all([
      refreshLiveWalletAndPositions(creds),
      fetch(`/api/delta/sync-full-history?_t=${Date.now()}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ maxFillPages: 25, maxOrderPages: 15 }),
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((payload) => {
          if (payload?.success && Array.isArray(payload.tradeHistory) && typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('delta:full-history-synced', {
                detail: {
                  tradeHistory: payload.tradeHistory,
                  pairedTradesCount: payload.pairedTradesCount || 0,
                  warehouseAddedCount: payload.warehouseAddedCount || 0,
                },
              })
            );
          }
        })
        .catch(() => {}),
    ]);
  }, [refreshLiveWalletAndPositions]);

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
    ]
  );

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
};

export const usePortfolio = (): PortfolioContextType => {
  const context = useContext(PortfolioContext);
  return context || defaultState;
};
