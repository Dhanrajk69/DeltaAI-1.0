import type { ClosedTrade } from '../types.ts';

export interface RawDeltaFill {
  id?: string | number;
  order_id?: string | number;
  product_id?: number;
  product_symbol?: string;
  symbol?: string;
  product?: {
    id?: number;
    symbol?: string;
    contract_type?: string;
    contract_value?: string | number;
  };
  side?: string;
  size?: string | number;
  price?: string | number;
  commission?: string | number;
  realized_pnl?: string | number | null;
  settled_pnl?: string | number | null;
  fill_type?: string;
  role?: string;
  created_at?: string | number;
  timestamp?: string | number;
  meta_data?: {
    pnl?: string | number | null;
    realized_pnl?: string | number | null;
    entry_price?: string | number | null;
    avg_entry_price?: string | number | null;
    position_side?: string;
    reduce_only?: boolean;
    is_closing?: boolean;
    source?: string;
    cashflow?: string | number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Parses an exchange timestamp (ISO-8601 string, epoch seconds, ms, or microseconds)
 * into { ms, iso }. Returns null if invalid or absent so timestamp-less records
 * are never fabricated as "now".
 */
export function parseExchangeTimestamp(raw: unknown): { ms: number; iso: string } | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    let ms = raw;
    if (raw > 1e14) {
      // Microseconds (Delta Exchange often returns µs in `timestamp`)
      ms = Math.floor(raw / 1000);
    } else if (raw < 1e12) {
      // Seconds
      ms = Math.floor(raw * 1000);
    }
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return null;
    return { ms: d.getTime(), iso: d.toISOString() };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return parseExchangeTimestamp(Number(trimmed));
    }
    const parsedMs = Date.parse(trimmed);
    if (!Number.isFinite(parsedMs) || parsedMs <= 0) return null;
    return { ms: parsedMs, iso: new Date(parsedMs).toISOString() };
  }

  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function detectContractType(symbol: string, rawType?: string): string {
  const upperType = String(rawType || '').toLowerCase();
  if (upperType.includes('call')) return 'call_options';
  if (upperType.includes('put')) return 'put_options';
  if (upperType.includes('perpetual') || upperType.includes('future')) return 'perpetual_futures';

  const upperSym = symbol.toUpperCase();
  if (/^C-[A-Z0-9]+-\d+-\d+/.test(upperSym)) return 'call_options';
  if (/^P-[A-Z0-9]+-\d+-\d+/.test(upperSym)) return 'put_options';
  return 'perpetual_futures';
}

function normalizeInstrumentSymbol(rawSymbol: string): string {
  return String(rawSymbol || '')
    .trim()
    .toUpperCase();
}

function inferClosedPositionSide(fill: RawDeltaFill): 'LONG' | 'SHORT' {
  const explicitPosSide = String(fill.meta_data?.position_side || '').toUpperCase();
  if (explicitPosSide === 'LONG' || explicitPosSide === 'BUY') return 'LONG';
  if (explicitPosSide === 'SHORT' || explicitPosSide === 'SELL') return 'SHORT';

  // On Delta Exchange, closing a LONG position is a 'sell' fill, closing a SHORT is a 'buy' fill.
  const fillSide = String(fill.side || '').toLowerCase();
  return fillSide === 'buy' ? 'SHORT' : 'LONG';
}

/**
 * Normalizes raw Delta Exchange India `/v2/fills` records into canonical `ClosedTrade` records
 * with guaranteed full ISO-8601 `created_at` timestamps and deterministic `fillId`/`orderId` keys.
 *
 * Captures every closed BTCUSD, ETHUSD, SOLUSD, other perpetual, and Option fill.
 */
export function normalizeDeltaExchangeFills(rawFills: RawDeltaFill[]): ClosedTrade[] {
  if (!Array.isArray(rawFills) || rawFills.length === 0) return [];

  const normalized: ClosedTrade[] = [];

  for (const fill of rawFills) {
    if (!fill || typeof fill !== 'object') continue;

    const rawSymbol = String(fill.product_symbol || fill.product?.symbol || fill.symbol || '').trim();
    if (!rawSymbol) continue;
    const symbol = normalizeInstrumentSymbol(rawSymbol);

    const ts =
      parseExchangeTimestamp(fill.created_at) ||
      parseExchangeTimestamp(fill.timestamp);
    if (!ts) continue;

    const rawRealizedPnl =
      toFiniteNumber(fill.realized_pnl) ??
      toFiniteNumber(fill.meta_data?.realized_pnl) ??
      toFiniteNumber(fill.meta_data?.pnl) ??
      toFiniteNumber(fill.settled_pnl);

    const fillType = String(fill.fill_type || 'normal').toLowerCase();
    const hasExplicitCloseSignal =
      fillType === 'settlement' ||
      fillType === 'liquidation' ||
      fillType === 'adl' ||
      fillType === 'close' ||
      fill.meta_data?.reduce_only === true ||
      fill.meta_data?.is_closing === true ||
      toFiniteNumber(fill.meta_data?.entry_price) !== null ||
      toFiniteNumber(fill.meta_data?.avg_entry_price) !== null;

    // Exclude pure opening fills that carry no realized PnL and no closing metadata
    const hasNonZeroRealizedPnl = rawRealizedPnl !== null && Math.abs(rawRealizedPnl) > 1e-8;
    if (!hasNonZeroRealizedPnl && !hasExplicitCloseSignal) {
      continue;
    }

    const exitPrice = toFiniteNumber(fill.price) ?? 0;
    const entryPrice =
      toFiniteNumber(fill.meta_data?.entry_price) ??
      toFiniteNumber(fill.meta_data?.avg_entry_price) ??
      exitPrice;
    const size = Math.abs(toFiniteNumber(fill.size) ?? 0);
    const commission = Math.abs(toFiniteNumber(fill.commission) ?? 0);
    const realisedPnl = Number((rawRealizedPnl ?? 0).toFixed(4));
    const side = inferClosedPositionSide(fill);
    const contractType = detectContractType(symbol, fill.product?.contract_type);

    const contractValue =
      toFiniteNumber(fill.product?.contract_value) ??
      (symbol.startsWith('BTC') ? 0.001 : symbol.startsWith('ETH') ? 0.01 : 1);
    const notionalUsd = Math.max(1, entryPrice * Math.max(1, size) * contractValue);
    const pnlPercent = Number(((realisedPnl / notionalUsd) * 100).toFixed(2));

    const fillId = fill.id !== undefined && fill.id !== null ? String(fill.id).trim() : undefined;
    const orderId =
      fill.order_id !== undefined && fill.order_id !== null ? String(fill.order_id).trim() : undefined;
    const id = fillId
      ? `delta-fill-${fillId}`
      : orderId
      ? `delta-order-${orderId}`
      : `delta-fill-${symbol}-${ts.ms}-${size}`;

    const isOption = contractType === 'call_options' || contractType === 'put_options';
    const reasonLabel =
      fillType === 'liquidation'
        ? 'Delta Exchange Liquidation Fill'
        : fillType === 'settlement'
        ? 'Delta Exchange Option Settlement'
        : isOption
        ? 'Delta Exchange Option Close Fill'
        : 'Delta Exchange Perpetual Close Fill';

    normalized.push({
      id,
      fillId,
      orderId,
      symbol,
      side,
      size,
      entryPrice,
      exitPrice,
      realisedPnl: Number(realisedPnl.toFixed(2)),
      pnlPercent,
      openedAt: ts.ms,
      closedAt: ts.ms,
      created_at: ts.iso,
      commission: Number(commission.toFixed(4)),
      contractType,
      source: 'DELTA_FILL',
      reason: reasonLabel,
      mode: 'LIVE',
    });
  }

  return normalized.sort((a, b) => b.closedAt - a.closedAt);
}

/**
 * Normalizes a persisted trade record so `created_at` (ISO-8601) and `closedAt` (epoch ms)
 * are always synchronized when a valid timestamp exists.
 */
export function ensureTradeTimestampFields(trade: any): ClosedTrade | null {
  if (!trade || typeof trade !== 'object') return null;
  const ts =
    parseExchangeTimestamp(trade.created_at) ||
    parseExchangeTimestamp(trade.closedAt) ||
    parseExchangeTimestamp(trade.timestamp);

  const normalized: any = {
    ...trade,
  };

  if (ts) {
    normalized.closedAt = ts.ms;
    normalized.created_at = ts.iso;
    if (!normalized.openedAt || !Number.isFinite(Number(normalized.openedAt))) {
      normalized.openedAt = ts.ms;
    }
  }

  if (normalized.fill_id && !normalized.fillId) {
    normalized.fillId = String(normalized.fill_id);
  }
  if (normalized.order_id && !normalized.orderId) {
    normalized.orderId = String(normalized.order_id);
  }
  if (!normalized.id) {
    normalized.id = normalized.fillId
      ? `delta-fill-${normalized.fillId}`
      : normalized.orderId
      ? `delta-order-${normalized.orderId}`
      : `th-${normalized.closedAt || 0}-${normalized.symbol || 'UNKNOWN'}`;
  }

  return normalized as ClosedTrade;
}

/**
 * Merges incoming Delta Exchange fills with persisted trades from `~/.deltaai-data/trades.json`,
 * deduplicating by `fillId` (`fill.id`), `orderId` (`order_id`), and `id`, while preserving
 * user journal metadata (`notes`, `sentimentTag`, `tags`, `lessonLearned`).
 */
export function mergeTradesDeduplicated(
  existingTrades: any[],
  incomingFills: ClosedTrade[],
  maxRecords = 2000
): ClosedTrade[] {
  const byCanonicalKey = new Map<string, ClosedTrade>();
  const fillIdToKey = new Map<string, string>();
  const orderIdToKey = new Map<string, string>();

  const registerRecord = (raw: any, preferIncomingFinancials: boolean) => {
    const rec = ensureTradeTimestampFields(raw);
    if (!rec) return;

    const fillId = rec.fillId ? String(rec.fillId).trim() : '';
    const orderId = rec.orderId ? String(rec.orderId).trim() : '';
    const id = String(rec.id || '').trim();

    let existingKey: string | undefined;
    if (fillId && fillIdToKey.has(fillId)) {
      existingKey = fillIdToKey.get(fillId);
    } else if (orderId && orderIdToKey.has(orderId)) {
      // Only match by orderId if fillIds don't explicitly conflict (a single order can have multiple partial fills)
      const candidateKey = orderIdToKey.get(orderId)!;
      const candidate = byCanonicalKey.get(candidateKey);
      if (!candidate?.fillId || !fillId || candidate.fillId === fillId) {
        existingKey = candidateKey;
      }
    } else if (id && byCanonicalKey.has(id)) {
      existingKey = id;
    }

    if (existingKey && byCanonicalKey.has(existingKey)) {
      const prev = byCanonicalKey.get(existingKey)!;
      const merged: ClosedTrade = preferIncomingFinancials
        ? {
            ...prev,
            ...rec,
            id: prev.id || rec.id,
            fillId: rec.fillId || prev.fillId,
            orderId: rec.orderId || prev.orderId,
            // Always preserve user journal fields from local record
            notes: prev.notes ?? rec.notes,
            sentimentTag: prev.sentimentTag ?? rec.sentimentTag,
            tags: prev.tags ?? rec.tags,
            lessonLearned: prev.lessonLearned ?? rec.lessonLearned,
            journalUpdatedAt: prev.journalUpdatedAt ?? rec.journalUpdatedAt,
            created_at: rec.created_at || prev.created_at,
            closedAt: rec.closedAt || prev.closedAt,
          }
        : {
            ...rec,
            ...prev,
            fillId: prev.fillId || rec.fillId,
            orderId: prev.orderId || rec.orderId,
            created_at: prev.created_at || rec.created_at,
            closedAt: prev.closedAt || rec.closedAt,
          };

      byCanonicalKey.set(existingKey, merged);
      if (merged.fillId) fillIdToKey.set(String(merged.fillId), existingKey);
      if (merged.orderId && !orderIdToKey.has(String(merged.orderId))) {
        orderIdToKey.set(String(merged.orderId), existingKey);
      }
    } else {
      const key = fillId ? `delta-fill-${fillId}` : id || `delta-order-${orderId}`;
      const stored: ClosedTrade = { ...rec, id: rec.id || key };
      byCanonicalKey.set(key, stored);
      if (fillId) fillIdToKey.set(fillId, key);
      if (orderId && !orderIdToKey.has(orderId)) orderIdToKey.set(orderId, key);
    }
  };

  for (const item of Array.isArray(existingTrades) ? existingTrades : []) {
    registerRecord(item, false);
  }
  for (const fill of Array.isArray(incomingFills) ? incomingFills : []) {
    registerRecord(fill, true);
  }

  return Array.from(byCanonicalKey.values())
    .sort((a, b) => Number(b.closedAt || 0) - Number(a.closedAt || 0))
    .slice(0, maxRecords);
}
