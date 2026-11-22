import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ClosedTrade } from '../types.ts';

export type WarehouseSignalStatus = 'GENERATED' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'EXPIRED';

export type WarehouseTradeEventType =
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
  | 'DELTA_EXCHANGE_FILL'
  | 'TP_FILLED'
  | 'TP4_EXCHANGE_FILLED'
  | 'SL_FILLED'
  | 'LIQUIDATION_CLOSE'
  | 'EXCHANGE_MANUAL_CLOSE'
  | 'EXCHANGE_CLOSED';

export interface WarehouseSignalRecord {
  eventId: string;
  signalId: string;
  timestamp_utc: string;
  timestamp_ist: string;
  timestampMs: number;
  sourceEngine: string;
  symbol: string;
  timeframe: string;
  grade: string;
  aiScore: number;
  convictionPct: number;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  entryPrice: number;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  tp4: number | null;
  cprRegime: string;
  sentimentScore: number | null;
  status: WarehouseSignalStatus;
  rejectionReason: string | null;
  outcomePnl: number | null;
  hitTarget: string | null;
  mode: 'PAPER' | 'LIVE';
}

export interface WarehouseTradeLifecycleRecord {
  eventId: string;
  fillId: string | null;
  orderId: string | null;
  tradeId: string | null;
  eventType: WarehouseTradeEventType;
  timestamp_utc: string;
  timestamp_ist: string;
  timestampMs: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  exitPrice: number | null;
  triggerPrice: number | null;
  fees: number;
  gst: number;
  slippage: number;
  leverage: number;
  netRealizedPnlUsd: number;
  netRealizedPnlInr: number;
  usdInrRate: number;
  mode: 'PAPER' | 'LIVE';
  reason: string;
  details?: Record<string, unknown>;
}

export interface WarehouseAuditEventRecord {
  eventId: string;
  id: string;
  timestamp_utc: string;
  timestamp_ist: string;
  timestampMs: number;
  category: string;
  type: string;
  title: string;
  description: string;
  symbol: string | null;
  mode: 'PAPER' | 'LIVE';
  details?: Record<string, unknown>;
}

export interface WarehouseSummary {
  dataDir: string;
  analyticsDir: string;
  files: {
    signalsArchive: { path: string; records: number; uniqueSignals: number; bytes: number };
    tradesArchive: { path: string; records: number; bytes: number };
    auditEvents: { path: string; records: number; bytes: number };
    tradesJson: { path: string; bytes: number };
  };
  totals: {
    signals: number;
    uniqueSignals: number;
    tradeEvents: number;
    auditEvents: number;
    totalBytes: number;
  };
  latestSignals: WarehouseSignalRecord[];
  latestTradeEvents: WarehouseTradeLifecycleRecord[];
  latestAuditEvents: WarehouseAuditEventRecord[];
  updatedAt: number;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function formatUtcIso(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : Date.now();
  return new Date(safeMs).toISOString();
}

export function formatIstIso(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : Date.now();
  const shifted = new Date(safeMs + IST_OFFSET_MS);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const min = String(shifted.getUTCMinutes()).padStart(2, '0');
  const ss = String(shifted.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`;
}

function parseTimestampMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    if (raw > 1e14) return Math.floor(raw / 1000);
    if (raw < 1e12) return Math.floor(raw * 1000);
    return Math.floor(raw);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const num = Number(raw.trim());
    if (Number.isFinite(num) && num > 0) return parseTimestampMs(num);
    const parsed = Date.parse(raw.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Date.now();
}

function toOptionalNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toFiniteNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(escapeCsvCell).join(',');
  const lines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col])).join(','));
  return [header, ...lines].join('\n');
}

function readJsonlFile<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) return [];
    const results: T[] = [];
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          results.push(parsed as T);
        }
      } catch {
        // Ignore malformed partial lines safely
      }
    }
    return results;
  } catch {
    return [];
  }
}

function safeFileSize(filePath: string): number {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

function normalizeAuditCategory(rawType?: string, title?: string): string {
  const upper = String(rawType || '').trim().toUpperCase();
  const titleUpper = String(title || '').toUpperCase();
  if (upper === 'HOURLY_GOAL' || titleUpper.includes('HOURLY') || titleUpper.includes('30M CANDLE')) return 'HOURLY_GOAL';
  if (upper === 'RESCUE' || titleUpper.includes('RESCUE')) return 'RESCUE';
  if (upper === 'CONDUIT' || upper === 'AUTO_CONDUIT' || titleUpper.includes('CONDUIT')) return 'CONDUIT';
  if (upper === 'KILL_SWITCH' || titleUpper.includes('KILL SWITCH') || titleUpper.includes('EMERGENCY')) return 'KILL_SWITCH';
  return upper || 'INFO';
}

export function createAnalyticsWarehouse(baseDataDir?: string) {
  const dataDir = baseDataDir || process.env.DELTAAI_DATA_DIR || path.join(os.homedir(), '.deltaai-data');
  const analyticsDir = path.join(dataDir, 'analytics');
  const signalsArchivePath = path.join(analyticsDir, 'signals_archive.jsonl');
  const tradesArchivePath = path.join(analyticsDir, 'trades_archive.jsonl');
  const auditEventsPath = path.join(analyticsDir, 'audit_events.jsonl');
  const tradesJsonPath = path.join(dataDir, 'trades.json');

  try {
    fs.mkdirSync(analyticsDir, { recursive: true });
  } catch (err) {
    console.warn('[AnalyticsWarehouse] Failed to create analytics dir:', err);
  }

  // Hydrate deduplication sets once from disk so polling & restarts never duplicate rows
  const seenSignalKeys = new Set<string>();
  const seenTradeEventKeys = new Set<string>();
  const seenAuditEventKeys = new Set<string>();

  const existingSignals = readJsonlFile<WarehouseSignalRecord>(signalsArchivePath);
  for (const s of existingSignals) {
    if (s.eventId) seenSignalKeys.add(`eid:${s.eventId}`);
    if (s.signalId) {
      seenSignalKeys.add(`sig:${s.signalId}:${s.status}:${s.outcomePnl ?? ''}:${s.hitTarget ?? ''}`);
      if (s.status === 'GENERATED' && s.outcomePnl === null && s.hitTarget === null) {
        seenSignalKeys.add(`sig-base:${s.signalId}`);
      }
    }
  }

  const existingTrades = readJsonlFile<WarehouseTradeLifecycleRecord>(tradesArchivePath);
  for (const t of existingTrades) {
    if (t.eventId) seenTradeEventKeys.add(`eid:${t.eventId}`);
    if (t.fillId) {
      seenTradeEventKeys.add(`fill:${t.fillId}`);
    }
    if (t.orderId && (t.eventType === 'DELTA_EXCHANGE_FILL' || t.eventType === 'TP_FILLED' || t.eventType === 'TP4_EXCHANGE_FILLED' || t.eventType === 'SL_FILLED' || t.eventType === 'LIQUIDATION_CLOSE' || t.eventType === 'EXCHANGE_MANUAL_CLOSE')) {
      seenTradeEventKeys.add(`ord:${t.orderId}:${t.fillId || ''}`);
    }
  }

  const existingAudit = readJsonlFile<WarehouseAuditEventRecord>(auditEventsPath);
  for (const a of existingAudit) {
    if (a.eventId) seenAuditEventKeys.add(`eid:${a.eventId}`);
    if (a.id) seenAuditEventKeys.add(`id:${a.id}`);
  }

  function appendLine(filePath: string, obj: object) {
    try {
      fs.mkdirSync(analyticsDir, { recursive: true });
      fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, 'utf8');
    } catch (err) {
      console.warn(`[AnalyticsWarehouse] Failed to append to ${path.basename(filePath)}:`, err);
    }
  }

  function recordSignal(input: Partial<WarehouseSignalRecord> & Record<string, any>): {
    appended: boolean;
    record: WarehouseSignalRecord;
  } {
    const timestampMs = parseTimestampMs(input.timestampMs ?? input.timestamp ?? input.timestamp_utc);
    const symbol = String(input.symbol || 'BTCUSDT').trim().toUpperCase();
    const rawDir = String(input.direction || input.side || 'LONG').trim().toUpperCase();
    const direction: 'LONG' | 'SHORT' | 'NEUTRAL' =
      rawDir === 'SHORT' || rawDir === 'SELL'
        ? 'SHORT'
        : rawDir === 'NEUTRAL'
        ? 'NEUTRAL'
        : 'LONG';
    const statusRaw = String(input.status || 'GENERATED').trim().toUpperCase();
    const status: WarehouseSignalStatus = (
      ['GENERATED', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED'].includes(statusRaw)
        ? statusRaw
        : 'GENERATED'
    ) as WarehouseSignalStatus;

    const entryPrice = toFiniteNum(input.entryPrice ?? input.entry, 0);
    const signalId = String(
      input.signalId || input.id || `sig-${symbol}-${direction}-${Math.round(entryPrice * 100)}-${Math.floor(timestampMs / 60000)}`
    ).trim();
    const outcomePnl = toOptionalNum(input.outcomePnl);
    const hitTarget = input.hitTarget ? String(input.hitTarget).trim() : null;
    const eventId = String(
      input.eventId ||
        (status === 'GENERATED' && outcomePnl === null && !hitTarget
          ? `sig:${signalId}`
          : `sig:${signalId}:${status}:${outcomePnl ?? ''}:${hitTarget ?? ''}`)
    ).trim();

    const record: WarehouseSignalRecord = {
      eventId,
      signalId,
      timestamp_utc: formatUtcIso(timestampMs),
      timestamp_ist: formatIstIso(timestampMs),
      timestampMs,
      sourceEngine: String(input.sourceEngine || input.sourceLabel || input.source || 'AI_COMMAND').trim(),
      symbol,
      timeframe: String(input.timeframe || '5m').trim(),
      grade: String(input.grade || 'A').trim(),
      aiScore: toFiniteNum(input.aiScore ?? input.convictionScore, 0),
      convictionPct: toFiniteNum(input.convictionPct ?? input.confidencePct ?? input.confidence, 0),
      direction,
      entryPrice,
      stopLoss: toOptionalNum(input.stopLoss ?? input.sl),
      tp1: toOptionalNum(input.tp1),
      tp2: toOptionalNum(input.tp2),
      tp3: toOptionalNum(input.tp3),
      tp4: toOptionalNum(input.tp4),
      cprRegime: String(input.cprRegime || 'STANDARD').trim(),
      sentimentScore: toOptionalNum(input.sentimentScore),
      status,
      rejectionReason: input.rejectionReason ? String(input.rejectionReason).trim() : null,
      outcomePnl,
      hitTarget,
      mode: String(input.mode || 'LIVE').toUpperCase() === 'PAPER' ? 'PAPER' : 'LIVE',
    };

    const sigStateKey = `sig:${record.signalId}:${record.status}:${record.outcomePnl ?? ''}:${record.hitTarget ?? ''}`;
    const isBaseGen = record.status === 'GENERATED' && record.outcomePnl === null && record.hitTarget === null;

    if (
      seenSignalKeys.has(`eid:${record.eventId}`) ||
      seenSignalKeys.has(sigStateKey) ||
      (isBaseGen && seenSignalKeys.has(`sig-base:${record.signalId}`))
    ) {
      return { appended: false, record };
    }

    seenSignalKeys.add(`eid:${record.eventId}`);
    seenSignalKeys.add(sigStateKey);
    if (isBaseGen) seenSignalKeys.add(`sig-base:${record.signalId}`);
    appendLine(signalsArchivePath, record);
    return { appended: true, record };
  }

  function recordTradeLifecycleEvent(
    input: Partial<WarehouseTradeLifecycleRecord> & Record<string, any>
  ): { appended: boolean; record: WarehouseTradeLifecycleRecord } {
    const timestampMs = parseTimestampMs(
      input.timestampMs ?? input.created_at ?? input.closedAt ?? input.timestamp ?? input.timestamp_utc
    );
    const symbol = String(input.symbol || 'BTCUSD').trim().toUpperCase();
    const rawSide = String(input.side || 'LONG').trim().toUpperCase();
    const side: 'LONG' | 'SHORT' = rawSide === 'SHORT' || rawSide === 'SELL' ? 'SHORT' : 'LONG';

    const validTypes: WarehouseTradeEventType[] = [
      'ORDER_SUBMITTED',
      'FILL_CONFIRMED',
      'TP1_HIT',
      'TP2_HIT',
      'TP3_HIT',
      'TP4_HIT',
      'SL_MOVED_BE',
      'RESCUE_ADJUSTMENT',
      'SL_HIT',
      'POSITION_CLOSED',
      'DELTA_EXCHANGE_FILL',
      'TP_FILLED',
      'TP4_EXCHANGE_FILLED',
      'SL_FILLED',
      'LIQUIDATION_CLOSE',
      'EXCHANGE_MANUAL_CLOSE',
      'EXCHANGE_CLOSED',
    ];
    const rawType = String(input.eventType || 'POSITION_CLOSED').trim().toUpperCase();
    const eventType: WarehouseTradeEventType = (
      validTypes.includes(rawType as WarehouseTradeEventType) ? rawType : 'POSITION_CLOSED'
    ) as WarehouseTradeEventType;

    const fillId = input.fillId ? String(input.fillId).trim() : null;
    const orderId = input.orderId ? String(input.orderId).trim() : null;
    const tradeId = input.tradeId || input.id ? String(input.tradeId || input.id).trim() : null;
    const usdInrRate = toFiniteNum(input.usdInrRate, 85);
    const fees = Math.abs(toFiniteNum(input.fees ?? input.commission, 0));
    // Delta Exchange India charges 18% GST on trading fees
    const gst =
      input.gst !== undefined && input.gst !== null
        ? Math.abs(toFiniteNum(input.gst, 0))
        : Number((fees * 0.18).toFixed(4));
    const slippage = toFiniteNum(input.slippage, 0);
    const leverage = Math.max(1, toFiniteNum(input.leverage, 10));
    const netRealizedPnlUsd = Number(toFiniteNum(input.netRealizedPnlUsd ?? input.realisedPnl, 0).toFixed(4));
    const netRealizedPnlInr =
      input.netRealizedPnlInr !== undefined && input.netRealizedPnlInr !== null
        ? Number(toFiniteNum(input.netRealizedPnlInr, 0).toFixed(2))
        : Number((netRealizedPnlUsd * usdInrRate).toFixed(2));

    const eventId = String(
      input.eventId ||
        (fillId && eventType === 'DELTA_EXCHANGE_FILL'
          ? `delta-fill-${fillId}`
          : `${eventType}:${tradeId || orderId || symbol}:${timestampMs}`)
    ).trim();

    const record: WarehouseTradeLifecycleRecord = {
      eventId,
      fillId,
      orderId,
      tradeId,
      eventType,
      timestamp_utc: formatUtcIso(timestampMs),
      timestamp_ist: formatIstIso(timestampMs),
      timestampMs,
      symbol,
      side,
      size: Math.abs(toFiniteNum(input.size, 0)),
      entryPrice: toFiniteNum(input.entryPrice, 0),
      exitPrice: toOptionalNum(input.exitPrice),
      triggerPrice: toOptionalNum(input.triggerPrice),
      fees: Number(fees.toFixed(4)),
      gst: Number(gst.toFixed(4)),
      slippage: Number(slippage.toFixed(4)),
      leverage,
      netRealizedPnlUsd,
      netRealizedPnlInr,
      usdInrRate: Number(usdInrRate.toFixed(2)),
      mode: String(input.mode || 'LIVE').toUpperCase() === 'PAPER' ? 'PAPER' : 'LIVE',
      reason: String(input.reason || eventType).trim(),
      ...(input.details && typeof input.details === 'object' ? { details: input.details } : {}),
    };

    const isFillBacked = Boolean(
      record.fillId &&
        (record.eventType === 'DELTA_EXCHANGE_FILL' ||
          record.eventType === 'TP_FILLED' ||
          record.eventType === 'TP4_EXCHANGE_FILLED' ||
          record.eventType === 'SL_FILLED' ||
          record.eventType === 'LIQUIDATION_CLOSE' ||
          record.eventType === 'EXCHANGE_MANUAL_CLOSE' ||
          record.eventType === 'EXCHANGE_CLOSED')
    );

    if (
      seenTradeEventKeys.has(`eid:${record.eventId}`) ||
      (isFillBacked && record.fillId && seenTradeEventKeys.has(`fill:${record.fillId}`))
    ) {
      return { appended: false, record };
    }

    seenTradeEventKeys.add(`eid:${record.eventId}`);
    if (isFillBacked && record.fillId) {
      seenTradeEventKeys.add(`fill:${record.fillId}`);
    }
    appendLine(tradesArchivePath, record);
    return { appended: true, record };
  }

  function recordClosedTradeAsLifecycle(trade: ClosedTrade, usdInrRate = 85): boolean {
    if (!trade || typeof trade !== 'object') return false;
    const isDeltaFill = trade.source === 'DELTA_FILL' || Boolean(trade.fillId);
    const reasonUpper = String(trade.reason || '').toUpperCase();
    const inferredEventType: WarehouseTradeEventType = reasonUpper.includes('LIQUIDATION')
      ? 'LIQUIDATION_CLOSE'
      : reasonUpper.includes('TP4_EXCHANGE_FILLED')
      ? 'TP4_EXCHANGE_FILLED'
      : reasonUpper.includes('TP_FILLED') || reasonUpper.includes('TAKE PROFIT')
      ? 'TP_FILLED'
      : reasonUpper.includes('SL_FILLED') || reasonUpper.includes('STOP LOSS')
      ? 'SL_FILLED'
      : reasonUpper.includes('EXCHANGE_MANUAL_CLOSE')
      ? 'EXCHANGE_MANUAL_CLOSE'
      : reasonUpper.includes('EXCHANGE_CLOSED')
      ? 'EXCHANGE_CLOSED'
      : isDeltaFill
      ? 'DELTA_EXCHANGE_FILL'
      : 'POSITION_CLOSED';

    const feesVal = Math.abs(Number((trade as any).fees ?? trade.commission ?? 0)) || 0;
    const gstVal =
      typeof (trade as any).gst === 'number' && Number.isFinite((trade as any).gst)
        ? Math.abs(Number((trade as any).gst))
        : Number((feesVal * 0.18).toFixed(4));
    const effectiveRate = Number.isFinite(usdInrRate) && usdInrRate > 0 ? usdInrRate : 85;

    const res = recordTradeLifecycleEvent({
      eventId: trade.fillId ? `delta-fill-${trade.fillId}` : `closed-${trade.id}`,
      fillId: trade.fillId || null,
      orderId: trade.orderId || null,
      tradeId: trade.id,
      eventType: inferredEventType,
      timestampMs: parseTimestampMs(trade.created_at || trade.closedAt),
      symbol: trade.symbol,
      side: trade.side,
      size: trade.size,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      fees: feesVal,
      gst: gstVal,
      netRealizedPnlUsd: trade.realisedPnl,
      netRealizedPnlInr: Number(((Number(trade.realisedPnl) || 0) * effectiveRate).toFixed(2)),
      usdInrRate: effectiveRate,
      mode: trade.mode || 'LIVE',
      reason: trade.reason || (isDeltaFill ? 'Delta Exchange Close Fill' : 'Position Closed'),
    });
    return res.appended;
  }

  function recordRoundTripTrades(
    trades: ClosedTrade[],
    usdInrRate = 85
  ): { addedCount: number; skippedCount: number } {
    let addedCount = 0;
    let skippedCount = 0;
    const effectiveRate = Number.isFinite(usdInrRate) && usdInrRate > 0 ? usdInrRate : 85;
    for (const trade of trades) {
      if (recordClosedTradeAsLifecycle(trade, effectiveRate)) {
        addedCount += 1;
      } else {
        skippedCount += 1;
      }
    }
    return { addedCount, skippedCount };
  }

  function recordAuditEvent(
    input: Partial<WarehouseAuditEventRecord> & Record<string, any>
  ): { appended: boolean; record: WarehouseAuditEventRecord } {
    const timestampMs = parseTimestampMs(input.timestampMs ?? input.timestamp ?? input.timestamp_utc);
    const title = String(input.title || 'Audit Event').trim();
    const description = String(input.description || input.message || '').trim();
    const rawType = String(input.type || input.category || 'INFO').trim().toUpperCase();
    const category = normalizeAuditCategory(input.category || rawType, title);
    const id = String(
      input.id || input.eventId || `audit-${category}-${timestampMs}-${title.slice(0, 18).replace(/\s+/g, '_')}`
    ).trim();
    const eventId = String(input.eventId || id).trim();

    const record: WarehouseAuditEventRecord = {
      eventId,
      id,
      timestamp_utc: formatUtcIso(timestampMs),
      timestamp_ist: formatIstIso(timestampMs),
      timestampMs,
      category,
      type: rawType || category,
      title,
      description,
      symbol: input.symbol ? String(input.symbol).trim().toUpperCase() : null,
      mode: String(input.mode || 'LIVE').toUpperCase() === 'PAPER' ? 'PAPER' : 'LIVE',
      ...(input.details && typeof input.details === 'object' ? { details: input.details } : {}),
    };

    if (seenAuditEventKeys.has(`eid:${record.eventId}`) || seenAuditEventKeys.has(`id:${record.id}`)) {
      return { appended: false, record };
    }

    seenAuditEventKeys.add(`eid:${record.eventId}`);
    seenAuditEventKeys.add(`id:${record.id}`);
    appendLine(auditEventsPath, record);
    return { appended: true, record };
  }

  function loadSignalsArchive(): WarehouseSignalRecord[] {
    return readJsonlFile<WarehouseSignalRecord>(signalsArchivePath).sort(
      (a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0)
    );
  }

  /**
   * Returns one consolidated latest record per unique `signalId` for startup UI hydration.
   */
  function loadLatestUniqueSignals(limit = 50): WarehouseSignalRecord[] {
    const rows = readJsonlFile<WarehouseSignalRecord>(signalsArchivePath);
    const bySignalId = new Map<string, WarehouseSignalRecord>();
    for (const row of rows) {
      if (!row?.signalId) continue;
      const prev = bySignalId.get(row.signalId);
      if (!prev) {
        bySignalId.set(row.signalId, row);
      } else {
        bySignalId.set(row.signalId, {
          ...prev,
          ...row,
          outcomePnl: row.outcomePnl ?? prev.outcomePnl,
          hitTarget: row.hitTarget ?? prev.hitTarget,
          rejectionReason: row.rejectionReason ?? prev.rejectionReason,
        });
      }
    }
    return Array.from(bySignalId.values())
      .sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0))
      .slice(0, limit);
  }

  function loadTradesArchive(): WarehouseTradeLifecycleRecord[] {
    return readJsonlFile<WarehouseTradeLifecycleRecord>(tradesArchivePath).sort(
      (a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0)
    );
  }

  function loadAuditEventsArchive(limit = 500): WarehouseAuditEventRecord[] {
    return readJsonlFile<WarehouseAuditEventRecord>(auditEventsPath)
      .sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0))
      .slice(0, limit);
  }

  function getSummary(): WarehouseSummary {
    const signals = loadSignalsArchive();
    const uniqueSignals = loadLatestUniqueSignals(50);
    const trades = loadTradesArchive();
    const audits = loadAuditEventsArchive(500);

    const sigBytes = safeFileSize(signalsArchivePath);
    const trdBytes = safeFileSize(tradesArchivePath);
    const audBytes = safeFileSize(auditEventsPath);
    const tradesJsonBytes = safeFileSize(tradesJsonPath);

    return {
      dataDir,
      analyticsDir,
      files: {
        signalsArchive: {
          path: signalsArchivePath,
          records: signals.length,
          uniqueSignals: uniqueSignals.length,
          bytes: sigBytes,
        },
        tradesArchive: {
          path: tradesArchivePath,
          records: trades.length,
          bytes: trdBytes,
        },
        auditEvents: {
          path: auditEventsPath,
          records: audits.length,
          bytes: audBytes,
        },
        tradesJson: {
          path: tradesJsonPath,
          bytes: tradesJsonBytes,
        },
      },
      totals: {
        signals: signals.length,
        uniqueSignals: uniqueSignals.length,
        tradeEvents: trades.length,
        auditEvents: audits.length,
        totalBytes: sigBytes + trdBytes + audBytes + tradesJsonBytes,
      },
      latestSignals: uniqueSignals.slice(0, 25),
      latestTradeEvents: trades.slice(0, 25),
      latestAuditEvents: audits.slice(0, 25),
      updatedAt: Date.now(),
    };
  }

  function exportDataset(
    type: 'signals' | 'trades' | 'audit' | 'all',
    format: 'json' | 'csv'
  ): { contentType: string; filename: string; body: string; count: number } {
    const dateStamp = formatUtcIso(Date.now()).slice(0, 10);
    const signals = type === 'signals' || type === 'all' ? loadSignalsArchive() : [];
    const trades = type === 'trades' || type === 'all' ? loadTradesArchive() : [];
    const audits = type === 'audit' || type === 'all' ? loadAuditEventsArchive(5000) : [];

    if (format === 'json') {
      const payload =
        type === 'signals'
          ? { exportedAtUtc: formatUtcIso(Date.now()), type, count: signals.length, signals }
          : type === 'trades'
          ? { exportedAtUtc: formatUtcIso(Date.now()), type, count: trades.length, trades }
          : type === 'audit'
          ? { exportedAtUtc: formatUtcIso(Date.now()), type, count: audits.length, auditEvents: audits }
          : {
              exportedAtUtc: formatUtcIso(Date.now()),
              type: 'all',
              counts: {
                signals: signals.length,
                trades: trades.length,
                auditEvents: audits.length,
              },
              signals,
              trades,
              auditEvents: audits,
            };

      const totalCount = signals.length + trades.length + audits.length;
      return {
        contentType: 'application/json; charset=utf-8',
        filename: `deltaai-warehouse-${type}-${dateStamp}.json`,
        body: JSON.stringify(payload, null, 2),
        count: totalCount,
      };
    }

    // CSV format
    if (type === 'signals') {
      const cols = [
        'eventId',
        'signalId',
        'timestamp_utc',
        'timestamp_ist',
        'sourceEngine',
        'symbol',
        'timeframe',
        'grade',
        'aiScore',
        'convictionPct',
        'direction',
        'entryPrice',
        'stopLoss',
        'tp1',
        'tp2',
        'tp3',
        'tp4',
        'cprRegime',
        'sentimentScore',
        'status',
        'rejectionReason',
        'outcomePnl',
        'hitTarget',
        'mode',
      ];
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `deltaai-signals-archive-${dateStamp}.csv`,
        body: rowsToCsv(signals as unknown as Record<string, unknown>[], cols),
        count: signals.length,
      };
    }

    if (type === 'trades') {
      const cols = [
        'eventId',
        'fillId',
        'orderId',
        'tradeId',
        'eventType',
        'timestamp_utc',
        'timestamp_ist',
        'symbol',
        'side',
        'size',
        'entryPrice',
        'exitPrice',
        'triggerPrice',
        'fees',
        'gst',
        'slippage',
        'leverage',
        'netRealizedPnlUsd',
        'netRealizedPnlInr',
        'usdInrRate',
        'mode',
        'reason',
      ];
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `deltaai-trades-archive-${dateStamp}.csv`,
        body: rowsToCsv(trades as unknown as Record<string, unknown>[], cols),
        count: trades.length,
      };
    }

    if (type === 'audit') {
      const cols = [
        'eventId',
        'id',
        'timestamp_utc',
        'timestamp_ist',
        'category',
        'type',
        'symbol',
        'mode',
        'title',
        'description',
      ];
      return {
        contentType: 'text/csv; charset=utf-8',
        filename: `deltaai-audit-events-${dateStamp}.csv`,
        body: rowsToCsv(audits as unknown as Record<string, unknown>[], cols),
        count: audits.length,
      };
    }

    // Unified `all` CSV combining signals, trade lifecycle events, and audit events chronologically
    const unified = [
      ...signals.map((s) => ({
        recordKind: 'SIGNAL',
        eventId: s.eventId,
        refId: s.signalId,
        timestamp_utc: s.timestamp_utc,
        timestamp_ist: s.timestamp_ist,
        timestampMs: s.timestampMs,
        symbol: s.symbol,
        mode: s.mode,
        categoryOrType: `${s.sourceEngine}:${s.status}`,
        directionOrSide: s.direction,
        price: s.entryPrice,
        netPnlUsd: s.outcomePnl ?? '',
        summary: `Grade ${s.grade} (${s.convictionPct}%) ${s.cprRegime}${s.rejectionReason ? ` · ${s.rejectionReason}` : ''}`,
      })),
      ...trades.map((t) => ({
        recordKind: 'TRADE_LIFECYCLE',
        eventId: t.eventId,
        refId: t.fillId || t.tradeId || t.orderId || '',
        timestamp_utc: t.timestamp_utc,
        timestamp_ist: t.timestamp_ist,
        timestampMs: t.timestampMs,
        symbol: t.symbol,
        mode: t.mode,
        categoryOrType: t.eventType,
        directionOrSide: t.side,
        price: t.exitPrice ?? t.triggerPrice ?? t.entryPrice,
        netPnlUsd: t.netRealizedPnlUsd,
        summary: `${t.reason} (size ${t.size}, fee $${t.fees}, gst $${t.gst})`,
      })),
      ...audits.map((a) => ({
        recordKind: 'AUDIT_EVENT',
        eventId: a.eventId,
        refId: a.id,
        timestamp_utc: a.timestamp_utc,
        timestamp_ist: a.timestamp_ist,
        timestampMs: a.timestampMs,
        symbol: a.symbol || '',
        mode: a.mode,
        categoryOrType: a.category,
        directionOrSide: '',
        price: '',
        netPnlUsd: '',
        summary: `${a.title}: ${a.description}`,
      })),
    ].sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0));

    const cols = [
      'recordKind',
      'eventId',
      'refId',
      'timestamp_utc',
      'timestamp_ist',
      'symbol',
      'mode',
      'categoryOrType',
      'directionOrSide',
      'price',
      'netPnlUsd',
      'summary',
    ];
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `deltaai-warehouse-all-${dateStamp}.csv`,
      body: rowsToCsv(unified as unknown as Record<string, unknown>[], cols),
      count: unified.length,
    };
  }

  return {
    dataDir,
    analyticsDir,
    paths: {
      signalsArchivePath,
      tradesArchivePath,
      auditEventsPath,
      tradesJsonPath,
    },
    recordSignal,
    recordTradeLifecycleEvent,
    recordClosedTradeAsLifecycle,
    recordRoundTripTrades,
    recordAuditEvent,
    loadSignalsArchive,
    loadLatestUniqueSignals,
    loadTradesArchive,
    loadAuditEventsArchive,
    getSummary,
    exportDataset,
  };
}

export const analyticsWarehouse = createAnalyticsWarehouse();
