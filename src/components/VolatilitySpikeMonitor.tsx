import React from 'react';
import {
  Zap,
  Volume2,
  VolumeX,
  AlertTriangle,
  X,
  TrendingUp,
  TrendingDown,
  Sliders,
  BellRing,
  CheckCircle2,
  Trash2,
  ArrowUpRight,
  Activity,
} from 'lucide-react';
import { AssetVolatilityMetric, VolatilitySpikeAlert } from '../hooks/useVolatilitySpikeMonitor';

interface VolatilitySpikeBannerProps {
  alert: VolatilitySpikeAlert | null;
  currencyPrefix: string;
  exchangeRate: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onDismiss: () => void;
  onOpenModal: () => void;
  onSelectSymbol: (symbol: string) => void;
}

export const VolatilitySpikeBanner: React.FC<VolatilitySpikeBannerProps> = ({
  alert,
  currencyPrefix,
  exchangeRate,
  soundEnabled,
  onToggleSound,
  onDismiss,
  onOpenModal,
  onSelectSymbol,
}) => {
  if (!alert) return null;

  const isBull = alert.direction === 'BULL_BREAKOUT';
  const isExtreme = alert.severity === 'EXTREME';
  const excessPct = +(alert.volatility24h - alert.threshold24h).toFixed(2);

  return (
    <div className="bg-gradient-to-r from-amber-950/90 via-[#140d19]/95 to-rose-950/90 border-b border-amber-500/60 px-4 lg:px-6 py-2.5 shadow-lg shadow-amber-950/30 relative z-30">
      <div className="max-w-[1720px] mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        {/* Left: Alert Badge & Live Metrics */}
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
              isExtreme
                ? 'bg-rose-500/20 border-rose-500 text-rose-400 animate-pulse'
                : 'bg-amber-500/20 border-amber-500 text-amber-400'
            }`}
          >
            <Zap className="w-4 h-4" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`badge-delta font-mono-numbers ${
                  isExtreme
                    ? 'badge-delta-danger'
                    : 'badge-delta-paper'
                }`}
              >
                <Zap className="w-3 h-3 fill-current" />
                <span>{alert.severity} 24H VOLATILITY SPIKE</span>
              </span>

              <span className="text-xs font-bold text-white font-mono-numbers">
                {alert.symbol}
              </span>

              <span className="text-xs font-mono-numbers font-bold text-cyan-300">
                {currencyPrefix}
                {(alert.markPrice * exchangeRate).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: alert.markPrice > 10 ? 2 : 4,
                })}
              </span>

              <span
                className={`badge-delta font-mono-numbers ${
                  isBull
                    ? 'badge-delta-live'
                    : 'badge-delta-danger'
                }`}
              >
                {isBull ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                24h Vol: {alert.volatility24h.toFixed(2)}% (Threshold: {alert.threshold24h.toFixed(1)}% · +{excessPct}%)
              </span>
            </div>

            <p className="text-[11px] text-slate-300 mt-0.5">
              {alert.catalyst}{' '}
              <span className="text-slate-400 font-mono-numbers">
                [24h Range: {currencyPrefix}
                {(alert.low24h * exchangeRate).toLocaleString(undefined, { maximumFractionDigits: 2 })} –{' '}
                {currencyPrefix}
                {(alert.high24h * exchangeRate).toLocaleString(undefined, { maximumFractionDigits: 2 })}]
              </span>
            </p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0 self-end md:self-center flex-wrap">
          <button
            onClick={() => onSelectSymbol(alert.symbol)}
            className="btn-delta-sm btn-toggle-active"
          >
            <span>Focus {alert.symbol}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={onToggleSound}
            className={`btn-delta-sm ${soundEnabled ? 'btn-toggle-active' : 'btn-secondary'}`}
            title={soundEnabled ? 'Mute volatility spike alarm' : 'Unmute volatility spike alarm'}
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span className="hidden sm:inline font-mono-numbers">
              {soundEnabled ? 'Alarm ON' : 'Muted'}
            </span>
          </button>

          <button
            onClick={onOpenModal}
            className="btn-delta-sm btn-secondary"
          >
            <Sliders className="w-3 h-3 text-amber-400" />
            <span>Threshold ({alert.threshold24h.toFixed(1)}%)</span>
          </button>

          <button
            onClick={onDismiss}
            className="btn-delta-sm btn-secondary px-2"
            title="Acknowledge and dismiss alert banner"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface VolatilitySpikeModalProps {
  isOpen: boolean;
  onClose: () => void;
  threshold24h: number;
  onChangeThreshold: (val: number) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  autoBannerEnabled: boolean;
  onToggleAutoBanner: () => void;
  assetMetrics: AssetVolatilityMetric[];
  spikeAlerts: VolatilitySpikeAlert[];
  currencyPrefix: string;
  exchangeRate: number;
  onTriggerTestSpike: (symbol: string) => void;
  onClearAlerts: () => void;
  onSelectSymbol: (symbol: string) => void;
}

export const VolatilitySpikeModal: React.FC<VolatilitySpikeModalProps> = ({
  isOpen,
  onClose,
  threshold24h,
  onChangeThreshold,
  soundEnabled,
  onToggleSound,
  autoBannerEnabled,
  onToggleAutoBanner,
  assetMetrics,
  spikeAlerts,
  currencyPrefix,
  exchangeRate,
  onTriggerTestSpike,
  onClearAlerts,
  onSelectSymbol,
}) => {
  if (!isOpen) return null;

  const presets = [
    { label: 'Sensitive (2.0%)', value: 2.0 },
    { label: 'Standard (3.5%)', value: 3.5 },
    { label: 'Elevated (5.0%)', value: 5.0 },
    { label: 'Extreme (7.5%)', value: 7.5 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-4xl panel-delta border-cyan-500/25 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] relative">
        {/* Top subtle highlight */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-cyan-500/15 bg-[#040a20]/90 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="panel-delta-title text-sm text-white">
                  24h Volatility Matrix & Regime Scanner
                </h2>
                <span className="badge-delta badge-delta-live font-mono-numbers">
                  AMBIENT TELEMETRY ACTIVE
                </span>
                <span className="hidden sm:inline-flex badge-delta badge-delta-armed font-mono-numbers">
                  NOTIFICATIONS MUTED
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Silent ambient telemetry monitoring 24h market range expansion, ATR velocity, and asset volatility rankings without intrusive toast popups.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn-delta-sm btn-secondary px-2 shrink-0"
            aria-label="Close volatility matrix"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Ambient Alternative Banner Notice */}
          <div className="bg-cyan-950/40 border border-cyan-800/60 rounded-lg px-4 py-2.5 text-xs text-cyan-200 flex items-start gap-2.5">
            <Zap className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-white">Zero-Notification Ambient Telemetry: </span>
              <span>Intrusive popup toasts and alert sounds for volatility have been permanently removed. Volatility status is now quietly displayed via the Header Regime Pill (CALM / NORMAL / ACTIVE / EXPANDED) and in-line chart badges for zero trading disruption.</span>
            </div>
          </div>

          {/* Threshold & Sound Control Strip */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 bg-slate-900/60 border border-slate-800/90 rounded-lg p-4">
            {/* Threshold Slider & Presets */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>24h Volatility Spike Threshold</span>
                </label>
                <span className="text-sm font-bold font-mono-numbers text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded">
                  {threshold24h.toFixed(1)}%
                </span>
              </div>

              <input
                type="range"
                min={1.0}
                max={12.0}
                step={0.1}
                value={threshold24h}
                onChange={(e) => onChangeThreshold(parseFloat(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-400">Quick Presets:</span>
                {presets.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => onChangeThreshold(p.value)}
                    className={`btn-delta-sm font-mono-numbers ${
                      Math.abs(threshold24h - p.value) < 0.05
                        ? 'btn-toggle-active'
                        : 'btn-secondary'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notification & Acoustic Toggles */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-2.5 border-t lg:border-t-0 lg:border-l border-slate-800 pt-3 lg:pt-0 lg:pl-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Acoustic Siren / Sound Effect</div>
                  <div className="text-[11px] text-slate-400">3-pulse harmonic tone on threshold breach</div>
                </div>
                <button
                  onClick={onToggleSound}
                  className={`btn-delta-sm ${
                    soundEnabled
                      ? 'btn-primary'
                      : 'btn-secondary'
                  }`}
                >
                  {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span>{soundEnabled ? 'Sound ON' : 'Sound OFF'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200">Visual Alert Overlay Banner</div>
                  <div className="text-[11px] text-slate-400">Real-time header banner when spike occurs</div>
                </div>
                <button
                  onClick={onToggleAutoBanner}
                  className={`btn-delta-sm ${
                    autoBannerEnabled
                      ? 'btn-toggle-active'
                      : 'btn-secondary'
                  }`}
                >
                  <BellRing className="w-3.5 h-3.5" />
                  <span>{autoBannerEnabled ? 'Banner ON' : 'Banner OFF'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Live Asset Volatility Matrix */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span>Live Market Feed Volatility vs {threshold24h.toFixed(1)}% Threshold</span>
              </h3>
              <span className="text-[11px] text-slate-400 font-mono-numbers">
                Click any asset row to focus on chart and inspect in-line metrics
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {assetMetrics.map((m) => {
                const fillRatio = Math.min(100, Math.round((m.compositeVolatility24h / Math.max(threshold24h * 1.6, 8)) * 100));
                const thresholdMarkerRatio = Math.min(100, Math.round((threshold24h / Math.max(threshold24h * 1.6, 8)) * 100));

                return (
                  <div
                    key={m.symbol}
                    className={`rounded-lg p-3.5 border transition ${
                      m.exceedsThreshold
                        ? 'bg-amber-950/20 border-amber-500/60 shadow-sm shadow-amber-950/30'
                        : 'bg-slate-900/50 border-slate-800/90'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white font-mono-numbers">{m.symbol}</span>
                        <span
                          className={`badge-delta font-mono-numbers ${
                            m.severity === 'EXTREME'
                              ? 'badge-delta-danger'
                              : m.severity === 'ELEVATED'
                              ? 'badge-delta-paper'
                              : 'badge-delta-standby'
                          }`}
                        >
                          {m.severity}
                        </span>
                      </div>

                      <span className="text-xs font-mono-numbers font-bold text-slate-200">
                        {currencyPrefix}
                        {(m.markPrice * exchangeRate).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: m.markPrice > 10 ? 2 : 4,
                        })}
                      </span>
                    </div>

                    {/* Volatility Progress Bar with Threshold Marker */}
                    <div className="space-y-1 my-2">
                      <div className="flex justify-between text-[11px] font-mono-numbers">
                        <span className="text-slate-400">24h Volatility:</span>
                        <span
                          className={`font-bold ${
                            m.exceedsThreshold ? 'text-amber-400' : 'text-emerald-400'
                          }`}
                        >
                          {m.compositeVolatility24h.toFixed(2)}% / {threshold24h.toFixed(1)}%
                        </span>
                      </div>

                      <div className="relative w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            m.severity === 'EXTREME'
                              ? 'bg-rose-500'
                              : m.exceedsThreshold
                              ? 'bg-amber-400'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${fillRatio}%` }}
                        />
                        <div
                          className="absolute top-0 bottom-0 w-0.5 bg-white/90"
                          style={{ left: `${thresholdMarkerRatio}%` }}
                          title={`Threshold: ${threshold24h.toFixed(1)}%`}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono-numbers text-slate-400 pt-1">
                      <span>24h Range: {m.rangeVolatility24h.toFixed(2)}%</span>
                      <span className={m.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        24h Chg: {m.change24h >= 0 ? '+' : ''}
                        {m.change24h.toFixed(2)}%
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-slate-800/80">
                      <button
                        onClick={() => onTriggerTestSpike(m.symbol)}
                        className="btn-delta-sm btn-toggle-active flex-1"
                      >
                        <Zap className="w-3 h-3" />
                        <span>Simulate Spike</span>
                      </button>
                      <button
                        onClick={() => {
                          onSelectSymbol(m.symbol);
                          onClose();
                        }}
                        className="btn-delta-sm btn-secondary"
                      >
                        Chart
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Historical Spike Alert Log */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Triggered Volatility Spike Log ({spikeAlerts.length})</span>
              </h3>
              {spikeAlerts.length > 0 && (
                <button
                  onClick={onClearAlerts}
                  className="btn-delta-sm btn-danger"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear Log</span>
                </button>
              )}
            </div>

            {spikeAlerts.length === 0 ? (
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-lg p-6 text-center text-xs text-slate-400">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1.5" />
                No assets have breached the {threshold24h.toFixed(1)}% 24h volatility threshold yet. Lower the threshold slider or click "Simulate Spike" above to test.
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {spikeAlerts.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-900/70 border border-slate-800 rounded-lg px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span
                        className={`badge-delta font-mono-numbers ${
                          item.severity === 'EXTREME'
                            ? 'badge-delta-danger'
                            : 'badge-delta-paper'
                        }`}
                      >
                        {item.severity}
                      </span>
                      <span className="font-bold text-white font-mono-numbers">{item.symbol}</span>
                      <span className="text-amber-400 font-mono-numbers font-semibold">
                        Vol: {item.volatility24h.toFixed(2)}% (Threshold: {item.threshold24h.toFixed(1)}%)
                      </span>
                      <span className="text-slate-400 hidden md:inline">•</span>
                      <span className="text-slate-300 text-[11px]">{item.catalyst}</span>
                    </div>

                    <div className="text-[11px] font-mono-numbers text-slate-400 shrink-0">
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
