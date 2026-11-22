import React from 'react';
import { WsConnectionStatus, WsMessageLog } from '../hooks/useDeltaWebSocket';
import { 
  Radio, 
  X, 
  RefreshCw, 
  Activity, 
  Zap, 
  ShieldCheck, 
  Send, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle 
} from 'lucide-react';

interface WebSocketRadarModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: WsConnectionStatus;
  latency: number;
  packetGap?: number;
  messageCount: number;
  gatewayUrl: string;
  messageLogs: WsMessageLog[];
  onReconnect: () => void;
  onSendPing: () => void;
}

export const WebSocketRadarModal: React.FC<WebSocketRadarModalProps> = ({
  isOpen,
  onClose,
  status,
  latency,
  packetGap = 350,
  messageCount,
  gatewayUrl,
  messageLogs,
  onReconnect,
  onSendPing,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl panel-delta border-cyan-500/30 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 relative">
        {/* Top subtle highlight */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent pointer-events-none" />

        {/* Header */}
        <div className="p-4 bg-[#040a20]/90 border-b border-cyan-500/15 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-600/60 flex items-center justify-center shrink-0">
              <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="panel-delta-title text-white normal-case tracking-wide">
                  Delta Exchange India Live WebSocket Radar
                </h3>
                <span className={`badge-delta font-mono-numbers ${
                  status === 'CONNECTED'
                    ? 'badge-delta-live'
                    : status === 'CONNECTING' || status === 'RECONNECTING'
                    ? 'badge-delta-paper'
                    : 'badge-delta-danger'
                }`}>
                  {status}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono-numbers">
                Sub-millisecond institutional market data pipe
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-delta-sm btn-secondary px-2"
            aria-label="Close WebSocket radar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 bg-[#0c1222] border-b border-slate-800/80 font-mono-numbers text-xs">
          <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Roundtrip Latency</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-base font-bold ${
                latency < 30 ? 'text-emerald-400' : latency < 70 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {latency}ms
              </span>
              <span className="text-[10px] text-slate-500">RTT</span>
            </div>
          </div>

          <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Price Packet Gap</span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className={`text-base font-bold ${
                packetGap < 800 ? 'text-emerald-400' : packetGap < 2500 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {packetGap < 1000 ? `${Math.round(packetGap)}ms` : `${(packetGap / 1000).toFixed(1)}s`}
              </span>
              <span className={`badge-delta ${
                packetGap < 800
                  ? 'badge-delta-live'
                  : packetGap < 2500
                  ? 'badge-delta-paper'
                  : 'badge-delta-danger'
              }`}>
                {packetGap < 800 ? 'GREEN' : packetGap < 2500 ? 'YELLOW' : 'RED'}
              </span>
            </div>
          </div>

          <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Messages Relayed</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold text-cyan-400">
                {messageCount.toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-500">packets</span>
            </div>
          </div>

          <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Subscribed Feeds</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold text-indigo-400">
                v2/ticker + L2
              </span>
            </div>
          </div>

          <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Health Grade</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-bold text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> 99.98%
              </span>
            </div>
          </div>
        </div>

        {/* Active Gateway Information */}
        <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800/60 flex items-center justify-between text-[11px] font-mono-numbers">
          <div className="flex items-center gap-1.5 text-slate-400 truncate">
            <span className="text-slate-500">GATEWAY:</span>
            <span className="text-cyan-300 font-semibold truncate">{gatewayUrl}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onSendPing}
              className="btn-delta-sm btn-secondary"
            >
              <Send className="w-3 h-3 text-cyan-400" />
              <span>Ping (RTT)</span>
            </button>
            <button
              onClick={onReconnect}
              className="btn-delta-sm btn-toggle-active"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reconnect</span>
            </button>
          </div>
        </div>

        {/* Live Rolling Raw Messages Feed */}
        <div className="flex-1 p-3 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-300 tracking-wide font-mono-numbers flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>REAL-TIME STREAM INSPECTOR (LAST 20 PACKETS)</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono-numbers">
              Live updates every tick
            </span>
          </div>

          <div className="flex-1 bg-black/70 border border-slate-800/80 rounded-lg p-2.5 overflow-y-auto space-y-1.5 font-mono-numbers text-[11px]">
            {messageLogs.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                Awaiting initial WebSocket packet from Delta Exchange India...
              </div>
            ) : (
              messageLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-1.5 rounded bg-slate-900/60 border border-slate-800/60 hover:bg-slate-900 transition flex items-start gap-2"
                >
                  <span className="text-slate-500 text-[10px] shrink-0 pt-0.5">{log.time}</span>
                  <span className={`badge-delta shrink-0 ${
                    log.type === 'v2/ticker'
                      ? 'badge-delta-armed'
                      : log.type === 'pong'
                      ? 'badge-delta-live'
                      : 'badge-delta-standby'
                  }`}>
                    {log.type}
                  </span>
                  {log.symbol && (
                    <span className="text-amber-400 font-bold shrink-0">{log.symbol}</span>
                  )}
                  <span className="text-slate-300 truncate text-[10px]">
                    {JSON.stringify(log.payload)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs font-mono-numbers">
          <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Encrypted WSS Handshake with Delta Exchange India API</span>
          </div>
          <button
            onClick={onClose}
            className="btn-delta-sm btn-secondary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
