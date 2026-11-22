import fs from 'fs';
import path from 'path';

export interface RecordedPositionStop {
  symbol: string; // e.g. BTCUSD
  canonicalSymbol: string; // e.g. BTCUSDT
  productId?: number;
  side: 'LONG' | 'SHORT';
  contracts: number;
  entryPrice: number;
  stopLossPrice: number;
  initialRiskPerUnit: number;
  slOrderId?: string | number | null;
  updatedAt: number;
  mode: 'LIVE';
}

export interface WatchdogEvaluationPosition {
  symbol: string;
  rawSymbol?: string;
  productId?: number;
  side: 'LONG' | 'SHORT';
  contracts: number;
  entryPrice: number;
  markPrice: number;
  stopLoss?: number;
  unrealisedPnl?: number;
}

export interface HardDrawdownBreachEvaluation {
  shouldTrigger: boolean;
  reason: string | null;
  breachType: 'NONE' | 'SL_BREACH_0_15_PCT' | 'MAX_R_LOSS_1_5R' | 'BOTH';
  breachPctBeyondSl: number;
  rMultiple: number;
  effectiveStopLoss: number;
  markPrice: number;
}

export interface WatchdogExecutionRecord {
  id: string;
  timestamp: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  contracts: number;
  entryPrice: number;
  stopLossPrice: number;
  markPrice: number;
  breachPctBeyondSl: number;
  rMultiple: number;
  reason: string;
  closeOrderId?: string | number | null;
  ok: boolean;
  error?: string;
}

export const HARD_STOP_SL_BREACH_TOLERANCE_PCT = 0.0015; // 0.15% beyond recorded stop-loss
export const HARD_STOP_MAX_NEGATIVE_R = -1.5; // -1.5R hard loss cap
export const DEFAULT_MANDATORY_SL_DISTANCE_PCT = 0.012; // 1.2% fallback SL if omitted on entry

function normalizePerpSymbolKey(symbol: string): string {
  const s = String(symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}USD`;
  return s;
}

/**
 * Pure deterministic evaluator for the 10-second Hard Drawdown Watchdog.
 * Triggers when live mark price breaches recorded stopLoss by > 0.15% OR loss exceeds -1.5R.
 */
export function evaluateHardDrawdownBreach(
  pos: WatchdogEvaluationPosition,
  recordedStop?: RecordedPositionStop | null
): HardDrawdownBreachEvaluation {
  const markPrice = Number(pos.markPrice || 0);
  const entryPrice = Number(pos.entryPrice || recordedStop?.entryPrice || 0);
  const rawSl = Number(recordedStop?.stopLossPrice || pos.stopLoss || 0);

  if (!Number.isFinite(markPrice) || markPrice <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return {
      shouldTrigger: false,
      reason: null,
      breachType: 'NONE',
      breachPctBeyondSl: 0,
      rMultiple: 0,
      effectiveStopLoss: rawSl,
      markPrice,
    };
  }

  const effectiveStopLoss = rawSl > 0 ? rawSl : 0;
  const riskPerUnit =
    recordedStop?.initialRiskPerUnit && recordedStop.initialRiskPerUnit > 0
      ? recordedStop.initialRiskPerUnit
      : effectiveStopLoss > 0
      ? Math.abs(entryPrice - effectiveStopLoss)
      : entryPrice * DEFAULT_MANDATORY_SL_DISTANCE_PCT;

  const adverseDelta = pos.side === 'LONG' ? entryPrice - markPrice : markPrice - entryPrice;
  const rMultiple = riskPerUnit > 0 ? +(-(adverseDelta / riskPerUnit)).toFixed(3) : 0;

  let breachPctBeyondSl = 0;
  let slBreached = false;
  if (effectiveStopLoss > 0) {
    if (pos.side === 'LONG') {
      const diffBelowSl = effectiveStopLoss - markPrice;
      breachPctBeyondSl = diffBelowSl > 0 ? +((diffBelowSl / effectiveStopLoss) * 100).toFixed(4) : 0;
      slBreached = markPrice <= effectiveStopLoss * (1 - HARD_STOP_SL_BREACH_TOLERANCE_PCT);
    } else {
      const diffAboveSl = markPrice - effectiveStopLoss;
      breachPctBeyondSl = diffAboveSl > 0 ? +((diffAboveSl / effectiveStopLoss) * 100).toFixed(4) : 0;
      slBreached = markPrice >= effectiveStopLoss * (1 + HARD_STOP_SL_BREACH_TOLERANCE_PCT);
    }
  }

  const rBreached = rMultiple <= HARD_STOP_MAX_NEGATIVE_R;

  if (!slBreached && !rBreached) {
    return {
      shouldTrigger: false,
      reason: null,
      breachType: 'NONE',
      breachPctBeyondSl,
      rMultiple,
      effectiveStopLoss,
      markPrice,
    };
  }

  const breachType: HardDrawdownBreachEvaluation['breachType'] =
    slBreached && rBreached ? 'BOTH' : slBreached ? 'SL_BREACH_0_15_PCT' : 'MAX_R_LOSS_1_5R';

  const parts: string[] = [];
  if (slBreached) {
    parts.push(
      `Mark $${markPrice.toFixed(2)} breached SL $${effectiveStopLoss.toFixed(2)} by ${breachPctBeyondSl.toFixed(2)}% (> 0.15%)`
    );
  }
  if (rBreached) {
    parts.push(`Loss reached ${rMultiple.toFixed(2)}R (exceeds -1.50R hard limit)`);
  }

  return {
    shouldTrigger: true,
    reason: parts.join(' & '),
    breachType,
    breachPctBeyondSl,
    rMultiple,
    effectiveStopLoss,
    markPrice,
  };
}

/**
 * Computes a mandatory safe Stop-Loss price if an order fill didn't specify one explicitly.
 */
export function resolveMandatoryStopLossPrice(params: {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  requestedStopLoss?: number | null;
  fallbackPct?: number;
}): number {
  const entry = Number(params.entryPrice || 0);
  const reqSl = Number(params.requestedStopLoss || 0);
  const pct = params.fallbackPct ?? DEFAULT_MANDATORY_SL_DISTANCE_PCT;
  if (!Number.isFinite(entry) || entry <= 0) return 0;

  if (Number.isFinite(reqSl) && reqSl > 0) {
    const validDirection = params.side === 'LONG' ? reqSl < entry : reqSl > entry;
    if (validDirection) {
      return Number(reqSl.toFixed(entry >= 100 ? 2 : 4));
    }
  }

  const derived = params.side === 'LONG' ? entry * (1 - pct) : entry * (1 + pct);
  return Number(derived.toFixed(entry >= 100 ? 2 : 4));
}

export class StopLossWatchdogStore {
  private filePath: string;
  private records: Map<string, RecordedPositionStop> = new Map();
  private recentExecutions: WatchdogExecutionRecord[] = [];
  private triggerCooldownMap: Map<string, number> = new Map();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'position-stops.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const list: RecordedPositionStop[] = Array.isArray(parsed.stops) ? parsed.stops : [];
        for (const item of list) {
          if (item && item.symbol && item.stopLossPrice > 0) {
            this.records.set(normalizePerpSymbolKey(item.symbol), item);
          }
        }
        if (Array.isArray(parsed.recentExecutions)) {
          this.recentExecutions = parsed.recentExecutions.slice(0, 50);
        }
      }
    } catch {
      // Non-fatal startup fallback
    }
  }

  private persistToDisk(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(
          {
            stops: Array.from(this.records.values()),
            recentExecutions: this.recentExecutions.slice(0, 50),
            updatedAt: Date.now(),
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      // Non-fatal persistence fallback
    }
  }

  upsertStop(stop: RecordedPositionStop): RecordedPositionStop {
    const key = normalizePerpSymbolKey(stop.symbol);
    const existing = this.records.get(key);
    const initialRiskPerUnit =
      stop.initialRiskPerUnit > 0
        ? stop.initialRiskPerUnit
        : existing && existing.side === stop.side && Math.abs(existing.entryPrice - stop.entryPrice) / Math.max(1, stop.entryPrice) < 0.005
        ? existing.initialRiskPerUnit
        : Math.max(Math.abs(stop.entryPrice - stop.stopLossPrice), stop.entryPrice * 0.004);

    const merged: RecordedPositionStop = {
      ...stop,
      symbol: key,
      initialRiskPerUnit,
      updatedAt: Date.now(),
    };
    this.records.set(key, merged);
    this.persistToDisk();
    return merged;
  }

  getStop(symbol: string): RecordedPositionStop | undefined {
    return this.records.get(normalizePerpSymbolKey(symbol));
  }

  removeStop(symbol: string): void {
    const key = normalizePerpSymbolKey(symbol);
    if (this.records.delete(key)) {
      this.persistToDisk();
    }
  }

  listStops(): RecordedPositionStop[] {
    return Array.from(this.records.values());
  }

  reconcileOpenSymbols(openSymbols: string[]): void {
    const openSet = new Set(openSymbols.map(normalizePerpSymbolKey));
    let mutated = false;
    for (const key of Array.from(this.records.keys())) {
      if (!openSet.has(key)) {
        this.records.delete(key);
        mutated = true;
      }
    }
    if (mutated) this.persistToDisk();
  }

  canExecuteWatchdogFor(symbol: string, cooldownMs = 60_000): boolean {
    const key = normalizePerpSymbolKey(symbol);
    const until = this.triggerCooldownMap.get(key) || 0;
    return Date.now() >= until;
  }

  markWatchdogExecuted(record: WatchdogExecutionRecord, cooldownMs = 60_000): void {
    const key = normalizePerpSymbolKey(record.symbol);
    this.triggerCooldownMap.set(key, Date.now() + cooldownMs);
    this.recentExecutions = [record, ...this.recentExecutions].slice(0, 50);
    if (record.ok) {
      this.records.delete(key);
    }
    this.persistToDisk();
  }

  getRecentExecutions(): WatchdogExecutionRecord[] {
    return this.recentExecutions;
  }
}

export interface SyncNativeStopLossDeps {
  apiKey: string;
  apiSecret: string;
  environment: 'PROD' | 'TESTNET';
  productId?: number;
  productSymbol: string;
  canonicalSymbol: string;
  positionSide: 'LONG' | 'SHORT';
  remainingContracts: number;
  stopLossPrice: number;
  entryPrice: number;
  store: StopLossWatchdogStore;
  fetchSignedGet: (
    apiKey: string,
    apiSecret: string,
    requestPath: string
  ) => Promise<{ ok: boolean; status: number; json: any }>;
  dispatchOrder: (params: {
    apiKey: string;
    apiSecret: string;
    environment: 'PROD' | 'TESTNET';
    orderPayload: Record<string, any>;
  }) => Promise<{
    ok: boolean;
    orderId?: string | number | null;
    state?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
  cancelOrder: (params: {
    apiKey: string;
    apiSecret: string;
    environment: 'PROD' | 'TESTNET';
    orderId: number | string;
    productId: number;
  }) => Promise<{ ok: boolean; status: number; message?: string }>;
}

export interface SyncNativeStopLossResult {
  ok: boolean;
  action: 'CREATED' | 'REUSED' | 'CANCELLED_ALL' | 'FAILED';
  orderId?: string | number | null;
  stopLossPrice: number;
  remainingContracts: number;
  cancelledCount: number;
  warning?: string;
}

/**
 * Ensures a single native Delta Exchange India `stop_loss_order` (`reduce_only: true`) exists
 * matching the exact remaining contract size and `stopLossPrice`.
 * Cancels stale/oversized stop-loss orders first (e.g., after a 50% partial close or rescue adjustment).
 */
export async function syncNativeExchangeStopLoss(
  deps: SyncNativeStopLossDeps
): Promise<SyncNativeStopLossResult> {
  const normSym = normalizePerpSymbolKey(deps.productSymbol);
  const remainingContracts = Math.max(0, Math.floor(Number(deps.remainingContracts || 0)));
  const safeStopPrice =
    remainingContracts > 0
      ? resolveMandatoryStopLossPrice({
          side: deps.positionSide,
          entryPrice: deps.entryPrice,
          requestedStopLoss: deps.stopLossPrice,
        })
      : 0;

  // 1. Inspect open orders to find existing stop_loss_order legs for this symbol/product
  let existingSlOrders: any[] = [];
  try {
    const openOrdersRes = await deps.fetchSignedGet(
      deps.apiKey,
      deps.apiSecret,
      '/v2/orders?state=open'
    );
    if (openOrdersRes.ok && Array.isArray(openOrdersRes.json?.result)) {
      existingSlOrders = openOrdersRes.json.result.filter((ord: any) => {
        const stopType = String(ord?.stop_order_type || '').toLowerCase();
        if (!stopType.includes('stop_loss')) return false;
        const ordSym = normalizePerpSymbolKey(String(ord?.product_symbol || ''));
        const pidMatch =
          deps.productId && Number(ord?.product_id) === Number(deps.productId);
        return Boolean(pidMatch || (ordSym && ordSym === normSym));
      });
    }
  } catch {
    // Non-fatal: continue to place fresh SL if open orders lookup fails
  }

  // If position is fully closed, cancel any lingering stop_loss_order legs and clear registry
  if (remainingContracts <= 0) {
    let cancelledCount = 0;
    for (const ord of existingSlOrders) {
      const ordId = ord?.id || ord?.order_id;
      const ordPid = Number(ord?.product_id || deps.productId || 0);
      if (ordId && ordPid > 0) {
        const cRes = await deps.cancelOrder({
          apiKey: deps.apiKey,
          apiSecret: deps.apiSecret,
          environment: deps.environment,
          orderId: ordId,
          productId: ordPid,
        });
        if (cRes.ok) cancelledCount += 1;
      }
    }
    deps.store.removeStop(normSym);
    return {
      ok: true,
      action: 'CANCELLED_ALL',
      orderId: null,
      stopLossPrice: 0,
      remainingContracts: 0,
      cancelledCount,
    };
  }

  // Check if an exact matching stop_loss_order already exists (same size & within 0.05% stop price)
  const exactMatch = existingSlOrders.find((ord: any) => {
    const ordSize = Math.floor(Number(ord?.unfilled_size ?? ord?.size ?? 0));
    const ordStopPx = Number(ord?.stop_price || 0);
    const priceMatches =
      ordStopPx > 0 && Math.abs(ordStopPx - safeStopPrice) / safeStopPrice <= 0.0005;
    return ordSize === remainingContracts && priceMatches && Boolean(ord?.reduce_only);
  });

  let cancelledCount = 0;
  for (const ord of existingSlOrders) {
    if (exactMatch && (ord.id || ord.order_id) === (exactMatch.id || exactMatch.order_id)) {
      continue;
    }
    const ordId = ord?.id || ord?.order_id;
    const ordPid = Number(ord?.product_id || deps.productId || 0);
    if (ordId && ordPid > 0) {
      const cRes = await deps.cancelOrder({
        apiKey: deps.apiKey,
        apiSecret: deps.apiSecret,
        environment: deps.environment,
        orderId: ordId,
        productId: ordPid,
      });
      if (cRes.ok) cancelledCount += 1;
    }
  }

  if (exactMatch) {
    const reusedOrderId = exactMatch.id || exactMatch.order_id || null;
    deps.store.upsertStop({
      symbol: normSym,
      canonicalSymbol: deps.canonicalSymbol,
      productId: deps.productId || Number(exactMatch.product_id) || undefined,
      side: deps.positionSide,
      contracts: remainingContracts,
      entryPrice: deps.entryPrice,
      stopLossPrice: safeStopPrice,
      initialRiskPerUnit: Math.abs(deps.entryPrice - safeStopPrice),
      slOrderId: reusedOrderId,
      updatedAt: Date.now(),
      mode: 'LIVE',
    });
    return {
      ok: true,
      action: 'REUSED',
      orderId: reusedOrderId,
      stopLossPrice: safeStopPrice,
      remainingContracts,
      cancelledCount,
    };
  }

  // Submit fresh native stop_loss_order (reduce_only: true)
  const exitSide = deps.positionSide === 'LONG' ? 'sell' : 'buy';
  const slPayload: Record<string, any> = {
    product_symbol: deps.productSymbol,
    size: remainingContracts,
    side: exitSide,
    order_type: 'market_order',
    stop_order_type: 'stop_loss_order',
    stop_price: String(safeStopPrice),
    stop_trigger_method: 'mark_price',
    reduce_only: true,
  };
  if (deps.productId && deps.productId > 0) {
    slPayload.product_id = deps.productId;
  }

  const slRes = await deps.dispatchOrder({
    apiKey: deps.apiKey,
    apiSecret: deps.apiSecret,
    environment: deps.environment,
    orderPayload: slPayload,
  });

  // Always persist the recorded stop-loss so the 10s Hard Drawdown Watchdog guards it even if exchange SL rejects
  deps.store.upsertStop({
    symbol: normSym,
    canonicalSymbol: deps.canonicalSymbol,
    productId: deps.productId,
    side: deps.positionSide,
    contracts: remainingContracts,
    entryPrice: deps.entryPrice,
    stopLossPrice: safeStopPrice,
    initialRiskPerUnit: Math.abs(deps.entryPrice - safeStopPrice),
    slOrderId: slRes.ok ? slRes.orderId || null : null,
    updatedAt: Date.now(),
    mode: 'LIVE',
  });

  if (!slRes.ok) {
    return {
      ok: false,
      action: 'FAILED',
      orderId: null,
      stopLossPrice: safeStopPrice,
      remainingContracts,
      cancelledCount,
      warning: slRes.errorMessage || slRes.errorCode || 'Native stop_loss_order rejected by exchange',
    };
  }

  return {
    ok: true,
    action: 'CREATED',
    orderId: slRes.orderId || null,
    stopLossPrice: safeStopPrice,
    remainingContracts,
    cancelledCount,
  };
}
