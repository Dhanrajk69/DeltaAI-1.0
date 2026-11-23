import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Database, 
  FileText, 
  Key, 
  User, 
  Server, 
  Activity,
  DollarSign
} from 'lucide-react';

interface HistoricalSyncReport {
  connectedAccountId: string;
  accountEmail: string;
  lastSuccessfulSyncTime: number | null;
  tradesRetrievedCount: number;
  ordersRetrievedCount: number;
  positionsRetrievedCount: number;
  transactionsRetrievedCount: number;
  netDepositedCapitalUsd: number;
  missingRecordsCount: number;
  apiErrorsEncountered: string[];
  upstreamConnected: boolean;
  syncStatus: 'SUCCESS' | 'SYNCING' | 'ERROR' | 'UNAUTHENTICATED';
  permissionsVerified: boolean;
}

interface LiveAccountSyncDiagnosticsPanelProps {
  onSyncComplete?: () => void;
}

export const LiveAccountSyncDiagnosticsPanel: React.FC<LiveAccountSyncDiagnosticsPanelProps> = ({ onSyncComplete }) => {
  const [report, setReport] = useState<HistoricalSyncReport | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchReport = useCallback(async (force = false) => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const endpoint = force ? '/api/delta/sync-full-history' : '/api/delta/sync-diagnostics';
      const method = force ? 'POST' : 'GET';
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success && data.report) {
        setReport(data.report);
        setAuthenticated(Boolean(data.authenticated));
        if (onSyncComplete) onSyncComplete();
      } else {
        setErrorMessage(data.error || 'Failed to retrieve historical sync diagnostic report.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Network error fetching historical sync report.');
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  }, [onSyncComplete]);

  useEffect(() => {
    fetchReport(false);
    const interval = setInterval(() => {
      fetchReport(false);
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchReport]);

  const handleForceSync = async () => {
    setIsSyncing(true);
    await fetchReport(true);
  };

  const lastSyncMs = report?.lastSuccessfulSyncTime || 0;
  const utcFormatted = lastSyncMs > 0 ? new Date(lastSyncMs).toUTCString() : 'Never / Pending';
  const istFormatted = lastSyncMs > 0 ? new Date(lastSyncMs + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' IST' : 'Never / Pending';

  const hasErrors = report?.apiErrorsEncountered && report.apiErrorsEncountered.length > 0;
  const isErrorStatus = report?.syncStatus === 'ERROR' || !report?.upstreamConnected;

  return (
    <div className="panel-delta p-4 space-y-4 font-mono text-slate-100 border border-slate-800/90 shadow-xl rounded-xl bg-slate-950/90">
      {/* Header & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-inner ${
            isErrorStatus
              ? 'bg-rose-950/60 border-rose-500/50 text-rose-400'
              : 'bg-emerald-950/60 border-emerald-500/50 text-emerald-400'
          }`}>
            {isErrorStatus ? <ShieldAlert className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-extrabold tracking-wide text-white uppercase">
                Live Delta Exchange Sync &amp; Diagnostics Report
              </h2>
              <span className={`badge-delta text-[10px] font-bold ${
                report?.syncStatus === 'SUCCESS'
                  ? 'badge-delta-armed'
                  : report?.syncStatus === 'SYNCING'
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-600/60'
                  : 'badge-delta-danger'
              }`}>
                {report?.syncStatus || 'UNKNOWN'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 font-sans">
              Full cursor-paginated synchronization of orders, fills, positions, and net deposits directly from Delta Exchange India.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isSyncing || isLoading}
            onClick={handleForceSync}
            className="btn-delta btn-primary text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all duration-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        </div>
      </div>

      {/* Prominent Sync Warning Banner when live sync fails or permissions are missing */}
      {(isErrorStatus || errorMessage || hasErrors) && (
        <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-500/60 text-rose-300 text-xs flex items-start gap-3 shadow-lg">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5 animate-pulse" />
          <div className="space-y-1.5 flex-1">
            <div className="font-extrabold uppercase tracking-wider text-rose-200">
              Live Historical Synchronization Warning
            </div>
            <p className="text-[11px] text-rose-300/95 font-sans leading-relaxed">
              {errorMessage || 'Unable to fully synchronize live records from Delta Exchange India. Please verify API key permissions (read & trade scopes), account status, or IPv4 server whitelist.'}
            </p>
            {report?.apiErrorsEncountered && report.apiErrorsEncountered.length > 0 && (
              <div className="mt-1 pt-1.5 border-t border-rose-900/80 text-[10px] text-rose-400 space-y-1">
                {report.apiErrorsEncountered.map((err, idx) => (
                  <div key={idx} className="truncate font-mono">• {err}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Diagnostic Report Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <User className="w-3.5 h-3.5 text-cyan-400" />
            <span>Connected Account ID</span>
          </div>
          <div className="text-xs font-bold text-white mt-1.5 truncate" title={report?.connectedAccountId}>
            {report?.connectedAccountId || 'Not Connected'}
          </div>
          <div className="text-[9px] text-slate-500 truncate mt-0.5">
            {report?.accountEmail || 'Unauthenticated'}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Last Successful Sync Time</span>
          </div>
          <div className="text-[11px] font-bold text-emerald-400 mt-1 truncate" title={utcFormatted}>
            UTC: {utcFormatted}
          </div>
          <div className="text-[10px] text-cyan-300 truncate mt-0.5" title={istFormatted}>
            IST: {istFormatted}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Trades (Fills) Retrieved</span>
          </div>
          <div className="text-sm font-bold text-cyan-300 mt-1.5">
            {report?.tradesRetrievedCount ?? 0}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            Paginated /v2/fills
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <span>Orders Retrieved</span>
          </div>
          <div className="text-sm font-bold text-cyan-300 mt-1.5">
            {report?.ordersRetrievedCount ?? 0}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            Paginated /v2/orders/history
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            <span>Net Capital Synced</span>
          </div>
          <div className="text-sm font-bold text-emerald-400 mt-1.5">
            ${(report?.netDepositedCapitalUsd ?? 0).toLocaleString()}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            Deposits minus Withdrawals
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span>Missing Records</span>
          </div>
          <div className={`text-sm font-bold mt-1.5 ${
            (report?.missingRecordsCount ?? 0) === 0 ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {report?.missingRecordsCount ?? 0}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            Discrepancy count
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <Key className="w-3.5 h-3.5 text-cyan-400" />
            <span>API Permissions</span>
          </div>
          <div className={`text-xs font-bold mt-1.5 ${
            report?.permissionsVerified ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {report?.permissionsVerified ? 'Verified Active' : 'Unverified'}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            HMAC-SHA256 Signed
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="text-[10px] text-slate-400 uppercase flex items-center gap-1">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span>Active Positions</span>
          </div>
          <div className="text-sm font-bold text-cyan-300 mt-1.5">
            {report?.positionsRetrievedCount ?? 0}
          </div>
          <div className="text-[9px] text-slate-500 mt-0.5">
            /v2/positions/margined
          </div>
        </div>
      </div>
    </div>
  );
};
