/**
 * Batched & debounced client telemetry publisher for the Cloud Signal & Trade Telemetry Warehouse.
 * Prevents excessive network chatter during polling while guaranteeing critical events flush immediately.
 */

export interface ClientSignalArchivePayload {
  eventId?: string;
  signalId: string;
  timestampMs?: number;
  sourceEngine: string;
  symbol: string;
  timeframe?: string;
  grade?: string;
  aiScore?: number;
  convictionPct?: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  entryPrice: number;
  stopLoss?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  tp4?: number | null;
  cprRegime?: string;
  sentimentScore?: number | null;
  status?: 'GENERATED' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'EXPIRED';
  rejectionReason?: string | null;
  outcomePnl?: number | null;
  hitTarget?: string | null;
  mode?: 'PAPER' | 'LIVE';
}

export interface ClientWarehouseEventPayload {
  kind: 'TRADE_LIFECYCLE' | 'AUDIT_EVENT';
  eventId?: string;
  id?: string;
  fillId?: string | null;
  orderId?: string | null;
  tradeId?: string | null;
  eventType?:
    | 'ORDER_SUBMITTED'
    | 'FILL_CONFIRMED'
    | 'TP1_HIT'
    | 'TP2_HIT'
    | 'TP3_HIT'
    | 'TP4_HIT'
    | 'SL_MOVED_BE'
    | 'RESCUE_ADJUSTMENT'
    | 'SL_HIT'
    | 'POSITION_CLOSED'
    | 'DELTA_EXCHANGE_FILL';
  category?: string;
  type?: string;
  title?: string;
  description?: string;
  timestampMs?: number;
  symbol?: string;
  side?: 'LONG' | 'SHORT';
  size?: number;
  entryPrice?: number;
  exitPrice?: number | null;
  triggerPrice?: number | null;
  fees?: number;
  gst?: number;
  slippage?: number;
  leverage?: number;
  netRealizedPnlUsd?: number;
  netRealizedPnlInr?: number;
  usdInrRate?: number;
  mode?: 'PAPER' | 'LIVE';
  reason?: string;
  details?: Record<string, unknown>;
}

const FLUSH_DEBOUNCE_MS = 1200;
const MAX_BATCH_SIZE = 25;

const pendingSignals: ClientSignalArchivePayload[] = [];
const pendingEvents: ClientWarehouseEventPayload[] = [];
const sentSignalFingerprints = new Set<string>();
const sentEventFingerprints = new Set<string>();

let signalFlushTimer: ReturnType<typeof setTimeout> | null = null;
let eventFlushTimer: ReturnType<typeof setTimeout> | null = null;

function pruneSetIfLarge(set: Set<string>, max = 1500) {
  if (set.size > max) {
    const items = Array.from(set).slice(-Math.floor(max / 2));
    set.clear();
    items.forEach((k) => set.add(k));
  }
}

export function flushQueuedAnalyticsSignals() {
  if (signalFlushTimer) {
    clearTimeout(signalFlushTimer);
    signalFlushTimer = null;
  }
  if (pendingSignals.length === 0) return;
  const batch = pendingSignals.splice(0, MAX_BATCH_SIZE);
  fetch('/api/analytics/record-signal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-email': 'dhanrajk69@gmail.com',
    },
    body: JSON.stringify({ signals: batch }),
    keepalive: true,
  }).catch(() => {});

  if (pendingSignals.length > 0) {
    signalFlushTimer = setTimeout(flushQueuedAnalyticsSignals, 300);
  }
}

export function flushQueuedAnalyticsEvents() {
  if (eventFlushTimer) {
    clearTimeout(eventFlushTimer);
    eventFlushTimer = null;
  }
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents.splice(0, MAX_BATCH_SIZE);
  fetch('/api/analytics/record-event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-email': 'dhanrajk69@gmail.com',
    },
    body: JSON.stringify({ events: batch }),
    keepalive: true,
  }).catch(() => {});

  if (pendingEvents.length > 0) {
    eventFlushTimer = setTimeout(flushQueuedAnalyticsEvents, 300);
  }
}

export function queueAnalyticsSignal(
  payload: ClientSignalArchivePayload,
  immediate = false
) {
  if (!payload || !payload.signalId) return;
  const fp =
    payload.eventId ||
    `${payload.signalId}:${payload.status || 'GENERATED'}:${payload.outcomePnl ?? ''}:${payload.hitTarget ?? ''}`;
  if (sentSignalFingerprints.has(fp)) return;
  sentSignalFingerprints.add(fp);
  pruneSetIfLarge(sentSignalFingerprints);

  pendingSignals.push({
    ...payload,
    timestampMs: payload.timestampMs || Date.now(),
  });

  if (immediate || pendingSignals.length >= MAX_BATCH_SIZE) {
    flushQueuedAnalyticsSignals();
  } else if (!signalFlushTimer) {
    signalFlushTimer = setTimeout(flushQueuedAnalyticsSignals, FLUSH_DEBOUNCE_MS);
  }
}

export function queueAnalyticsEvent(
  payload: ClientWarehouseEventPayload,
  immediate = false
) {
  if (!payload) return;
  const fp =
    payload.eventId ||
    payload.id ||
    `${payload.kind}:${payload.eventType || payload.category || ''}:${payload.tradeId || payload.symbol || ''}:${payload.title || ''}:${payload.timestampMs || ''}`;
  if (sentEventFingerprints.has(fp)) return;
  sentEventFingerprints.add(fp);
  pruneSetIfLarge(sentEventFingerprints);

  pendingEvents.push({
    ...payload,
    timestampMs: payload.timestampMs || Date.now(),
  });

  const isCritical =
    immediate ||
    payload.eventType === 'POSITION_CLOSED' ||
    payload.eventType === 'SL_HIT' ||
    payload.eventType === 'RESCUE_ADJUSTMENT' ||
    payload.category === 'KILL_SWITCH' ||
    payload.category === 'RESCUE';

  if (isCritical || pendingEvents.length >= MAX_BATCH_SIZE) {
    flushQueuedAnalyticsEvents();
  } else if (!eventFlushTimer) {
    eventFlushTimer = setTimeout(flushQueuedAnalyticsEvents, FLUSH_DEBOUNCE_MS);
  }
}

if (typeof window !== 'undefined') {
  const flushAllOnHide = () => {
    flushQueuedAnalyticsSignals();
    flushQueuedAnalyticsEvents();
  };
  window.addEventListener('pagehide', flushAllOnHide);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushAllOnHide();
  });
}
