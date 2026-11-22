import { useCallback, useEffect, useRef } from 'react';
import { usePortfolio } from './PortfolioContext';
import { useCapitalAllocation } from './CapitalAllocationContext';
import {
  DeltaCredentialsInput,
  DeltaOrderDispatchResult,
  ResolvedDeltaOptionContract,
  fetchLivePositions,
  getStoredDeltaCredentials,
  mapToDeltaPerpetualContract,
  resolveDeltaOptionProduct,
  submitDeltaBracketOrder,
  submitDeltaOrder,
} from '../services/deltaExchangeService';
import { MarginMode, Position, SignalFreshnessStatus, TradingMode } from '../types';

export * from './CapitalAllocationContext';
export { useCapitalAllocation as useTradingContext } from './CapitalAllocationContext';
export { CapitalAllocationProvider as TradingProvider } from './CapitalAllocationContext';

export function useTrading() {
  const portfolio = usePortfolio();
  const { globalLeverage, marginMode, clampLeverage } = useCapitalAllocation();

  const executeLiveBracketOrder = useCallback(
    async (
      params: {
        symbol: string;
        side: 'LONG' | 'SHORT' | 'BUY' | 'SELL' | 'buy' | 'sell';
        size: number;
        entryPrice?: number;
        stopLoss?: number;
        takeProfit?: number;
        tp1?: number;
        tp2?: number;
        tp3?: number;
        tp4?: number;
        leverage?: number;
        marginMode?: MarginMode;
        strategy?: string;
        mode?: TradingMode;
      },
      creds?: DeltaCredentialsInput | null,
      sessionToken?: string | null
    ): Promise<DeltaOrderDispatchResult> => {
      const effectiveCreds =
        creds && creds.apiKey && creds.apiSecret ? creds : getStoredDeltaCredentials();
      const result = await submitDeltaBracketOrder(
        {
          ...params,
          leverage: clampLeverage(params.leverage ?? globalLeverage),
          marginMode: params.marginMode ?? marginMode,
        },
        effectiveCreds,
        sessionToken
      );
      if ((params.mode || 'LIVE') === 'LIVE') {
        await Promise.allSettled([
          portfolio.refreshPositions(effectiveCreds),
          portfolio.refreshWallet(effectiveCreds),
        ]);
      }
      return result;
    },
    [portfolio, clampLeverage, globalLeverage, marginMode]
  );

  const executeLiveOptionOrder = useCallback(
    async (
      params: {
        underlying: string;
        optionType: 'CALL' | 'PUT';
        strike: number;
        expiry: string;
        side: 'BUY' | 'SELL' | 'buy' | 'sell';
        size: number;
        entryPremium?: number;
        reduceOnly?: boolean;
        orderType?: 'market_order' | 'limit_order';
        limitPrice?: number;
        mode?: TradingMode;
      },
      creds?: DeltaCredentialsInput | null,
      sessionToken?: string | null
    ): Promise<DeltaOrderDispatchResult & { resolvedContract: ResolvedDeltaOptionContract }> => {
      const effectiveCreds =
        creds && creds.apiKey && creds.apiSecret ? creds : getStoredDeltaCredentials();
      const resolvedContract = await resolveDeltaOptionProduct({
        underlying: params.underlying,
        optionType: params.optionType,
        strike: params.strike,
        expiry: params.expiry,
      });

      const result = await submitDeltaOrder(
        {
          symbol: resolvedContract.symbol,
          product_symbol: resolvedContract.symbol,
          product_id: resolvedContract.product_id,
          underlying: params.underlying,
          optionType: params.optionType,
          strike: resolvedContract.strike || params.strike,
          expiry: params.expiry,
          side: String(params.side).toLowerCase() === 'sell' ? 'sell' : 'buy',
          size: Math.max(1, Math.round(params.size || 1)),
          entryPremium: params.entryPremium,
          reduce_only: Boolean(params.reduceOnly),
          isContracts: true,
          isOption: true,
          order_type: params.orderType || 'market_order',
          limit_price: params.limitPrice,
          mode: params.mode || 'LIVE',
        },
        effectiveCreds,
        sessionToken
      );

      if ((params.mode || 'LIVE') === 'LIVE') {
        await Promise.allSettled([
          portfolio.refreshPositions(effectiveCreds),
          portfolio.refreshWallet(effectiveCreds),
        ]);
      }

      return {
        ...result,
        symbol: result.symbol || resolvedContract.symbol,
        product_id: result.product_id ?? resolvedContract.product_id,
        resolvedContract,
      };
    },
    [portfolio]
  );

  const closeAllLivePositionsReduceOnly = useCallback(
    async (
      positionsToClose: Position[],
      creds?: DeltaCredentialsInput | null,
      sessionToken?: string | null
    ): Promise<DeltaOrderDispatchResult[]> => {
      const effectiveCreds =
        creds && creds.apiKey && creds.apiSecret ? creds : getStoredDeltaCredentials();
      const results: DeltaOrderDispatchResult[] = [];

      for (const pos of positionsToClose) {
        const rawSym = String(pos.rawSymbol || pos.symbol || '').trim().toUpperCase();
        const isOpt = rawSym.startsWith('C-') || rawSym.startsWith('P-');
        const closeSide: 'buy' | 'sell' = pos.side === 'LONG' ? 'sell' : 'buy';
        const contractsCount = Math.max(1, Math.round(pos.contracts || pos.size || 1));

        const res = await submitDeltaOrder(
          {
            symbol: rawSym,
            product_symbol: rawSym,
            product_id: Number.isFinite(Number(pos.id)) ? Number(pos.id) : undefined,
            side: closeSide,
            size: contractsCount,
            isContracts: true,
            isOption: isOpt,
            order_type: 'market_order',
            reduce_only: true,
            mode: 'LIVE',
          },
          effectiveCreds,
          sessionToken
        );
        results.push(res);
      }

      await Promise.allSettled([
        portfolio.refreshPositions(effectiveCreds),
        portfolio.refreshWallet(effectiveCreds),
      ]);

      return results;
    },
    [portfolio]
  );

  return {
    ...portfolio,
    mapToDeltaPerpetualContract,
    resolveDeltaOptionProduct,
    executeLiveBracketOrder,
    executeLiveOptionOrder,
    closeAllLivePositionsReduceOnly,
  };
}

/**
 * Watches `[Auto: ON]` in `LIVE` mode (`liveTradingEnabled === true`) and automatically submits
 * a bracket order (`market_order` + `stop_loss_order` + `take_profit_order`) to `/api/delta/orders`
 * when a `FRESH` Grade A/B signal arrives, strictly enforcing a hard single-position lock (`GET /api/delta/positions`)
 * and requiring an explicit signal direction change + 15-minute cooldown after a full close.
 */
export function useLiveFuturesAutoExecution(params: {
  tradingMode: TradingMode;
  liveTradingEnabled: boolean;
  isAutoEnabled: boolean;
  hasActivePosition: boolean;
  signal: {
    id: string;
    symbol: string;
    direction: 'LONG' | 'SHORT';
    grade: string;
    freshness: SignalFreshnessStatus;
    entryPrice: number;
    stopLoss: number;
    tp1: number;
    tp2?: number;
    tp3?: number;
    tp4?: number;
    size?: number;
    leverage?: number;
    marginMode?: MarginMode;
    exposureMode?: 'MICRO_15' | 'MICRO_50' | 'MACRO';
    isMicro15?: boolean;
    strategyTag?: string;
    marginUtilizationSafe?: boolean;
    microAntiChopPassed?: boolean;
  } | null;
  apiCredentials?: DeltaCredentialsInput | null;
  sessionToken?: string | null;
  onOrderDispatched?: (res: DeltaOrderDispatchResult) => void;
}) {
  const { refreshPositions, refreshWallet } = usePortfolio();
  const { globalLeverage, marginMode, clampLeverage } = useCapitalAllocation();
  const lastDispatchedSignalKeyRef = useRef<string | null>(null);
  const lastDispatchedDirectionRef = useRef<'LONG' | 'SHORT' | null>(null);
  const lastFullCloseTimestampRef = useRef<number>(0);
  const wasActivePositionRef = useRef<boolean>(false);
  const inFlightRef = useRef<boolean>(false);

  // Track when an active position closes to start the mandatory 15-minute post-close cooldown
  useEffect(() => {
    if (wasActivePositionRef.current && !params.hasActivePosition) {
      lastFullCloseTimestampRef.current = Date.now();
    }
    wasActivePositionRef.current = params.hasActivePosition;
  }, [params.hasActivePosition]);

  useEffect(() => {
    const {
      tradingMode,
      liveTradingEnabled,
      isAutoEnabled,
      hasActivePosition,
      signal,
      apiCredentials,
      sessionToken,
      onOrderDispatched,
    } = params;

    if (
      tradingMode !== 'LIVE' ||
      !liveTradingEnabled ||
      !isAutoEnabled ||
      hasActivePosition ||
      !signal ||
      inFlightRef.current
    ) {
      return;
    }

    if (signal.marginUtilizationSafe === false) {
      return;
    }

    const isMicro15Mode = Boolean(signal.isMicro15 || signal.exposureMode === 'MICRO_15');
    if (isMicro15Mode && signal.microAntiChopPassed === false) {
      return;
    }

    // For non-Micro trades, enforce 15-minute cooldown and direction flip after close.
    // Narrow CPR Micro Sniper uses dedicated Anti-Chop rules (3/hr max + 10m post-SL cooldown).
    if (!isMicro15Mode) {
      const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
      if (
        lastFullCloseTimestampRef.current > 0 &&
        Date.now() - lastFullCloseTimestampRef.current < FIFTEEN_MINUTES_MS
      ) {
        return;
      }

      if (
        lastDispatchedDirectionRef.current &&
        lastDispatchedDirectionRef.current === signal.direction
      ) {
        return;
      }
    }

    const gradeUpper = String(signal.grade || '').trim().toUpperCase();
    const isGradeAB = gradeUpper.startsWith('A') || gradeUpper.startsWith('B');
    const isFresh = signal.freshness === 'FRESH';

    if (!isGradeAB || !isFresh || !(signal.entryPrice > 0)) {
      return;
    }

    const sigKey = `${signal.id}-${signal.symbol}-${signal.direction}-${Math.round(signal.entryPrice)}`;
    if (lastDispatchedSignalKeyRef.current === sigKey) {
      return;
    }

    inFlightRef.current = true;

    const effectiveCreds =
      apiCredentials && apiCredentials.apiKey && apiCredentials.apiSecret
        ? apiCredentials
        : getStoredDeltaCredentials();

    // Query live open positions (GET /api/delta/positions) before any Auto-Pilot dispatch.
    // Decoupled Perp Micro Slot: ignore option contracts (C-/P-/call_options/put_options) so Options Lab Iron Condor
    // runs cleanly in parallel with the 1/1 Perp Micro Sniper slot.
    fetchLivePositions(effectiveCreds)
      .then(async (posCheck) => {
        const livePositions = Array.isArray(posCheck.positions) ? posCheck.positions : [];
        const perpPositions = livePositions.filter((p) => {
          const sym = String(p.product_symbol || p.rawSymbol || p.symbol || '').trim().toUpperCase();
          const cType = String(p.contract_type || '').trim().toLowerCase();
          return (
            cType !== 'call_options' &&
            cType !== 'put_options' &&
            !sym.startsWith('C-') &&
            !sym.startsWith('P-')
          );
        });
        if (perpPositions.length > 0) {
          // Strictly block new Perp entries when 1/1 Perp Micro/Futures slot is already occupied
          return;
        }

        lastDispatchedSignalKeyRef.current = sigKey;
        lastDispatchedDirectionRef.current = signal.direction;

        const mapped = mapToDeltaPerpetualContract(signal.symbol);
        const defaultSize = signal.size && signal.size > 0 ? signal.size : mapped.contractValue;

        const res = await submitDeltaBracketOrder(
          {
            symbol: signal.symbol,
            side: signal.direction,
            size: defaultSize,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            takeProfit: isMicro15Mode ? signal.tp1 : (signal.tp4 || signal.tp1),
            tp1: signal.tp1,
            tp2: signal.tp2,
            tp3: signal.tp3,
            tp4: signal.tp4,
            leverage: clampLeverage(signal.leverage ?? globalLeverage),
            marginMode: signal.marginMode ?? marginMode,
            strategy: isMicro15Mode
              ? `Narrow CPR $15 Micro Sniper (${signal.freshness})`
              : `Auto-Pilot Grade ${signal.grade} (${signal.freshness})`,
            strategyTag: isMicro15Mode ? (signal.strategyTag || 'NARROW_CPR_MICRO_15') : signal.strategyTag,
            exposureMode: signal.exposureMode,
            isMicro15: isMicro15Mode,
            microMarginUsd: isMicro15Mode ? 15 : undefined,
            enforcePerpSlot: true,
            mode: 'LIVE',
          },
          effectiveCreds,
          sessionToken
        );

        await Promise.allSettled([
          refreshPositions(effectiveCreds),
          refreshWallet(effectiveCreds),
        ]);
        onOrderDispatched?.(res);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [
    params.tradingMode,
    params.liveTradingEnabled,
    params.isAutoEnabled,
    params.hasActivePosition,
    params.signal?.id,
    params.signal?.symbol,
    params.signal?.direction,
    params.signal?.grade,
    params.signal?.freshness,
    params.signal?.entryPrice,
    params.signal?.stopLoss,
    params.signal?.tp1,
    params.signal?.isMicro15,
    params.signal?.exposureMode,
    params.signal?.marginUtilizationSafe,
    params.signal?.microAntiChopPassed,
    refreshPositions,
    refreshWallet,
  ]);
}
