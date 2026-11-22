import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Download,
  RefreshCw,
  FileJson,
  FileSpreadsheet,
  Activity,
  Radio,
  ShieldCheck,
} from 'lucide-react';

interface WarehouseSignalRow {
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
  cprRegime: string;
  sentimentScore: number | null;
  status: string;
  rejectionReason: string | null;
  outcomePnl: number | null;
  hitTarget: string | null;
  mode: 'PAPER' | 'LIVE';
}

interface WarehouseTradeRow {
  eventId: string;
  fillId: string | null;
  orderId: string | null;
  tradeId: string | null;
  eventType: string;
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
  leverage: number;
  netRealizedPnlUsd: number;
  netRealizedPnlInr: number;
  mode: 'PAPER' | 'LIVE';
  reason: string;
}

interface WarehouseAuditRow {
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
}

interface WarehouseSummaryData {
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
  latestSignals: WarehouseSignalRow[];
  latestTradeEvents: WarehouseTradeRow[];
  latestAuditEvents: WarehouseAuditRow[];
  updatedAt: number;
}

interface TelemetryWarehousePanelProps {
  currencyPrefix: string;
  exchangeRate: number;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCompactIst(istIso: string): string {
  if (!istIso) return '-';
  // 2026-11-19T16:32:04+05:30 -> 11-19 16:32:04 IST
  const match = istIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (!match) return istIso;
  return `${match[2]}-${match[3]} ${match[4]} IST`;
}

export const TelemetryWarehousePanel: React.FC<TelemetryWarehousePanelProps> = ({
  currencyPrefix,
  exchangeRate,
}) => {
  const [summary, setSummary] = useState<WarehouseSummaryData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'SIGNALS' | 'TRADES' | 'AUDIT'>('SIGNALS');
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const isInr = currencyPrefix === '₹';

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/summary?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'x-admin-email': 'dhanrajk69@gmail.com' },
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.success && json.summary) {
          setSummary(json.summary);
        }
      }
    } catch {
      // Keep previous summary safely on transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const handleExport = async (
    type: 'signals' | 'trades' | 'audit' | 'all',
    format: 'json' | 'csv'
  ) => {
    const key = `${type}-${format}`;
    setDownloadingKey(key);
    try {
      const url = `/api/analytics/export?type=${type}&format=${format}&download=true`;
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'x-admin-email': 'dhanrajk69@gmail.com' },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const fnMatch = cd.match(/filename="([^"]+)"/i);
      const filename =
        fnMatch?.[1] ||
        `deltaai-warehouse-${type}-${new Date().toISOString().slice(0, 10)}.${format}`;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloadingKey(null);
    }
  };

  const totals = summary?.totals || {
    signals: 0,
    uniqueSignals: 0,
    tradeEvents: 0,
    auditEvents: 0,
    totalBytes: 0,
  };

  return (
    <div className="panel-delta p-3 sm:p-4 min-w-0 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800 min-w-0">
        <div className="flex items-center gap-2 min-w-[260px] max-w-full flex-1">
          <Database className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="panel-delta-title" title="Cloud Signal & Trade Telemetry Warehouse">
              Cloud Signal &amp; Trade Telemetry Warehouse
            </h2>
            <p className="text-[11px] text-slate-400 font-mono-numbers break-words">
              Permanent Append-Only JSONL Archive ·{' '}
              <span className="text-slate-300 break-all">
                {summary?.analyticsDir || '~/.deltaai-data/analytics'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void fetchSummary()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-200 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void handleExport('signals', 'csv')}
            disabled={downloadingKey !== null}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/40 text-[11px] font-semibold text-cyan-200 transition disabled:opacity-50"
            title="Download full signals_archive.jsonl as CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Signals CSV
          </button>

          <button
            type="button"
            onClick={() => void handleExport('trades', 'csv')}
            disabled={downloadingKey !== null}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 text-[11px] font-semibold text-emerald-200 transition disabled:opacity-50"
            title="Download full trades_archive.jsonl as CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Trades CSV
          </button>

          <button
            type="button"
            onClick={() => void handleExport('all', 'json')}
            disabled={downloadingKey !== null}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-white transition disabled:opacity-50"
            title="Download complete warehouse (signals + trades + audit events) as JSON"
          >
            <FileJson className="w-3.5 h-3.5 text-amber-400" />
            Export All JSON
          </button>

          <button
            type="button"
            onClick={() => void handleExport('all', 'csv')}
            disabled={downloadingKey !== null}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-200 transition disabled:opacity-50"
            title="Download unified timeline CSV of all warehouse records"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            All CSV
          </button>
        </div>
      </div>

      {/* Compact Storage Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400">
            <span>signals_archive.jsonl</span>
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-base font-extrabold text-white font-mono-numbers mt-0.5">
            {totals.signals.toLocaleString()}{' '}
            <span className="text-[11px] font-normal text-slate-400">
              ({totals.uniqueSignals} unique)
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono-numbers">
            {formatBytes(summary?.files.signalsArchive.bytes || 0)}
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400">
            <span>trades_archive.jsonl</span>
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-base font-extrabold text-white font-mono-numbers mt-0.5">
            {totals.tradeEvents.toLocaleString()}{' '}
            <span className="text-[11px] font-normal text-slate-400">events</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono-numbers">
            {formatBytes(summary?.files.tradesArchive.bytes || 0)}
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400">
            <span>audit_events.jsonl</span>
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-base font-extrabold text-white font-mono-numbers mt-0.5">
            {totals.auditEvents.toLocaleString()}{' '}
            <span className="text-[11px] font-normal text-slate-400">logs</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono-numbers">
            {formatBytes(summary?.files.auditEvents.bytes || 0)}
          </div>
        </div>

        <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400">
            <span>Total Persistent Storage</span>
            <Database className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-base font-extrabold text-cyan-300 font-mono-numbers mt-0.5">
            {formatBytes(totals.totalBytes)}
          </div>
          <div className="text-[10px] text-slate-500 font-mono-numbers">
            Deduplicated · Crash &amp; Redeploy Safe
          </div>
        </div>
      </div>

      {/* Preview Tabs */}
      <div className="flex items-center gap-1.5 mb-2.5 border-b border-slate-800/80 pb-2">
        {(
          [
            { id: 'SIGNALS', label: `Signals Archive (${summary?.latestSignals.length || 0})` },
            { id: 'TRADES', label: `Trade Lifecycle (${summary?.latestTradeEvents.length || 0})` },
            { id: 'AUDIT', label: `Audit & Rescue (${summary?.latestAuditEvents.length || 0})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
              activeTab === tab.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'bg-slate-900/70 text-slate-400 border border-slate-800 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content Tables */}
      {activeTab === 'SIGNALS' && (
        <div className="overflow-x-auto">
          {!summary || summary.latestSignals.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 font-mono-numbers">
              No archived signals yet. New AI Command, Camarilla Sniper, and Options Lab signals append automatically.
            </div>
          ) : (
            <table className="w-full text-left text-[11px] font-mono-numbers">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                  <th className="py-1.5 px-2">Time (IST)</th>
                  <th className="py-1.5 px-2">Engine</th>
                  <th className="py-1.5 px-2">Symbol / TF</th>
                  <th className="py-1.5 px-2">Dir</th>
                  <th className="py-1.5 px-2">Grade / AI</th>
                  <th className="py-1.5 px-2">Entry / SL / TP1</th>
                  <th className="py-1.5 px-2">Status</th>
                  <th className="py-1.5 px-2 text-right">Outcome PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {summary.latestSignals.slice(0, 12).map((sig) => (
                  <tr key={sig.eventId} className="hover:bg-slate-900/40">
                    <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">
                      {formatCompactIst(sig.timestamp_ist)}
                    </td>
                    <td className="py-1.5 px-2 text-slate-300 truncate max-w-[140px]" title={sig.sourceEngine}>
                      {sig.sourceEngine}
                    </td>
                    <td className="py-1.5 px-2 font-bold text-white whitespace-nowrap">
                      {sig.symbol}{' '}
                      <span className="text-slate-400 font-normal">{sig.timeframe}</span>
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`font-bold ${
                          sig.direction === 'LONG'
                            ? 'text-emerald-400'
                            : sig.direction === 'SHORT'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {sig.direction}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-cyan-300">
                      {sig.grade} · {Math.round(sig.convictionPct || sig.aiScore)}%
                    </td>
                    <td className="py-1.5 px-2 text-slate-300 whitespace-nowrap">
                      ${sig.entryPrice.toLocaleString()}
                      {sig.stopLoss ? ` / SL $${sig.stopLoss.toLocaleString()}` : ''}
                      {sig.tp1 ? ` / TP1 $${sig.tp1.toLocaleString()}` : ''}
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          sig.status === 'EXECUTED'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : sig.status === 'REJECTED'
                            ? 'bg-rose-500/20 text-rose-300'
                            : sig.status === 'APPROVED'
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {sig.status}
                      </span>
                    </td>
                    <td
                      className={`py-1.5 px-2 text-right font-bold ${
                        sig.outcomePnl === null
                          ? 'text-slate-500'
                          : sig.outcomePnl > 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {sig.outcomePnl === null
                        ? '—'
                        : `${sig.outcomePnl >= 0 ? '+' : '-'}${currencyPrefix}${Math.abs(
                            isInr ? sig.outcomePnl * exchangeRate : sig.outcomePnl
                          ).toFixed(2)}${sig.hitTarget ? ` (${sig.hitTarget})` : ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'TRADES' && (
        <div className="overflow-x-auto">
          {!summary || summary.latestTradeEvents.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 font-mono-numbers">
              No trade lifecycle events archived yet. Orders, TP1–TP4 scale-outs, SL-to-BE moves, rescues, and Delta Exchange fills record here automatically.
            </div>
          ) : (
            <table className="w-full text-left text-[11px] font-mono-numbers">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                  <th className="py-1.5 px-2">Time (IST)</th>
                  <th className="py-1.5 px-2">Event</th>
                  <th className="py-1.5 px-2">Symbol</th>
                  <th className="py-1.5 px-2">Side / Qty</th>
                  <th className="py-1.5 px-2">Entry / Exit</th>
                  <th className="py-1.5 px-2">Fees + GST</th>
                  <th className="py-1.5 px-2 text-right">Net PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {summary.latestTradeEvents.slice(0, 12).map((evt) => {
                  const displayPnl = isInr ? evt.netRealizedPnlInr : evt.netRealizedPnlUsd;
                  return (
                    <tr key={evt.eventId} className="hover:bg-slate-900/40">
                      <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">
                        {formatCompactIst(evt.timestamp_ist)}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-cyan-300 whitespace-nowrap">
                        {evt.eventType}
                      </td>
                      <td className="py-1.5 px-2 font-bold text-white">{evt.symbol}</td>
                      <td className="py-1.5 px-2">
                        <span
                          className={
                            evt.side === 'LONG' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                          }
                        >
                          {evt.side}
                        </span>{' '}
                        <span className="text-slate-300">
                          {evt.size} ({evt.leverage}x)
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-slate-300 whitespace-nowrap">
                        ${evt.entryPrice.toLocaleString()}
                        {evt.exitPrice ? ` → $${evt.exitPrice.toLocaleString()}` : ''}
                      </td>
                      <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">
                        ${evt.fees.toFixed(3)} + ${evt.gst.toFixed(3)}
                      </td>
                      <td
                        className={`py-1.5 px-2 text-right font-bold whitespace-nowrap ${
                          displayPnl > 0
                            ? 'text-emerald-400'
                            : displayPnl < 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {displayPnl === 0
                          ? '—'
                          : `${displayPnl > 0 ? '+' : '-'}${currencyPrefix}${Math.abs(displayPnl).toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'AUDIT' && (
        <div className="overflow-x-auto">
          {!summary || summary.latestAuditEvents.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 font-mono-numbers">
              No audit or drawdown rescue events archived yet.
            </div>
          ) : (
            <table className="w-full text-left text-[11px] font-mono-numbers">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase">
                  <th className="py-1.5 px-2">Time (IST)</th>
                  <th className="py-1.5 px-2">Category</th>
                  <th className="py-1.5 px-2">Mode</th>
                  <th className="py-1.5 px-2">Title</th>
                  <th className="py-1.5 px-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {summary.latestAuditEvents.slice(0, 12).map((aud) => (
                  <tr key={aud.eventId} className="hover:bg-slate-900/40">
                    <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">
                      {formatCompactIst(aud.timestamp_ist)}
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          aud.category === 'KILL_SWITCH' || aud.category === 'RESCUE'
                            ? 'bg-rose-500/20 text-rose-300'
                            : aud.category === 'HOURLY_GOAL'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-slate-800 text-cyan-300'
                        }`}
                      >
                        {aud.category}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-slate-400">{aud.mode}</td>
                    <td className="py-1.5 px-2 font-semibold text-white">{aud.title}</td>
                    <td className="py-1.5 px-2 text-slate-400 max-w-[360px] truncate" title={aud.description}>
                      {aud.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};
