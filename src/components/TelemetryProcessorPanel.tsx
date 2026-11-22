import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Terminal,
  XCircle,
  AlertTriangle,
  Play,
} from 'lucide-react';
import {
  MarketTicker,
  NormalizedTelemetryEnvelope,
  TelemetryTimeframe,
} from '../types';
import { copyToClipboard } from '../utils/clipboardUtils';

interface TelemetryProcessorPanelProps {
  markets: Record<string, MarketTicker>;
  selectedSymbol: string;
}

interface TelemetryMetrics {
  totalProcessed: number;
  validatedCount: number;
  approvedCount: number;
  cautionCount: number;
  rejectedCount: number;
  approvalRatePct: number;
  avgAtrPct: number;
}

type PresetKind =
  | 'TV_JSON_LONG'
  | 'TV_TEXT_ALERT'
  | 'DELTA_V2_TICKER'
  | 'BINANCE_FUTURES'
  | 'REJECT_OUTLIER';

export const TelemetryProcessorPanel: React.FC<TelemetryProcessorPanelProps> = ({
  markets,
  selectedSymbol,
}) => {
  const activeMarket = markets[selectedSymbol] || markets['BTCUSDT'] || Object.values(markets)[0];
  const livePrice = activeMarket?.markPrice || 81702.5;
  const basePair = (activeMarket?.symbol || 'BTCUSDT').toUpperCase();
  const deltaPair = basePair.endsWith('USDT') ? basePair.replace('USDT', 'USD') : basePair;

  const buildPresetPayload = useCallback(
    (preset: PresetKind): string => {
      const px = livePrice;
      const nowSec = Math.floor(Date.now() / 1000);
      if (preset === 'TV_JSON_LONG') {
        return JSON.stringify(
          {
            source: 'tradingview',
            ticker: `BINANCE:${basePair}.P`,
            exchange: 'BINANCE',
            interval: '5',
            time: new Date().toISOString(),
            action: 'buy',
            strategy: {
              name: 'Camarilla EMA Confluence v3',
              order_action: 'buy',
              order_contracts: 5,
            },
            close: px,
            open: +(px * 0.9985).toFixed(2),
            high: +(px * 1.0018).toFixed(2),
            low: +(px * 0.9978).toFixed(2),
            volume: 428.5,
            sl: +(px * 0.994).toFixed(2),
            tp: +(px * 1.012).toFixed(2),
          },
          null,
          2
        );
      }
      if (preset === 'TV_TEXT_ALERT') {
        return `BUY ${deltaPair} @ ${px.toFixed(2)} SL ${(px * 0.995).toFixed(2)} TP ${(
          px * 1.011
        ).toFixed(2)} TF 5m`;
      }
      if (preset === 'DELTA_V2_TICKER') {
        return JSON.stringify(
          {
            type: 'v2/ticker',
            channel: 'v2/ticker',
            exchange: 'Delta Exchange India',
            product_symbol: deltaPair,
            mark_price: px,
            spot_price: activeMarket?.indexPrice || px,
            quotes: {
              best_bid: +(px * 0.9999).toFixed(2),
              best_ask: +(px * 1.0001).toFixed(2),
            },
            high: activeMarket?.high24h || +(px * 1.015).toFixed(2),
            low: activeMarket?.low24h || +(px * 0.985).toFixed(2),
            turnover_usd: activeMarket?.volume24hUsd || 14500000,
            oi_value_usd: activeMarket?.openInterestUsd || 92000000,
            funding_rate: activeMarket?.fundingRate || 0.01,
            mark_change_24h: activeMarket?.change24h || 1.25,
            timestamp: nowSec,
          },
          null,
          2
        );
      }
      if (preset === 'BINANCE_FUTURES') {
        return JSON.stringify(
          {
            e: '24hrTicker',
            E: Date.now(),
            s: basePair,
            ps: basePair,
            c: String(px),
            h: String(activeMarket?.high24h || +(px * 1.02).toFixed(2)),
            l: String(activeMarket?.low24h || +(px * 0.98).toFixed(2)),
            q: String(activeMarket?.volume24hUsd || 54000000),
            P: String(activeMarket?.change24h || 0.85),
            b: String(+(px * 0.9998).toFixed(2)),
            a: String(+(px * 1.0002).toFixed(2)),
            timeframe: '15m',
          },
          null,
          2
        );
      }
      // REJECT_OUTLIER
      const spikePx = +(px * 1.14).toFixed(2);
      return JSON.stringify(
        {
          source: 'tradingview',
          ticker: `BINANCE:${basePair}.P`,
          interval: '5',
          action: 'buy',
          close: spikePx,
          sl: +(spikePx * 1.02).toFixed(2),
          tp: +(spikePx * 0.98).toFixed(2),
          time: nowSec,
        },
        null,
        2
      );
    },
    [activeMarket, basePair, deltaPair, livePrice]
  );

  const [rawInput, setRawInput] = useState<string>(() => buildPresetPayload('TV_JSON_LONG'));
  const [timeframeOverride, setTimeframeOverride] = useState<TelemetryTimeframe>('5m');
  const [strictMode, setStrictMode] = useState<boolean>(false);
  const [useAiStructuredMode, setUseAiStructuredMode] = useState<boolean>(true);
  const [showAiSpec, setShowAiSpec] = useState<boolean>(false);
  const [aiSpec, setAiSpec] = useState<{
    model: string;
    responseMimeType: string;
    systemInstruction: string;
    responseSchema: any;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSyncingLive, setIsSyncingLive] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    accepted: boolean;
    quarantined: boolean;
    telemetry: NormalizedTelemetryEnvelope | null;
    diagnostic: NormalizedTelemetryEnvelope;
    aiStructuredOutput?: any;
  } | null>(null);
  const [validatedStream, setValidatedStream] = useState<NormalizedTelemetryEnvelope[]>([]);
  const [quarantinedStream, setQuarantinedStream] = useState<NormalizedTelemetryEnvelope[]>([]);
  const [metrics, setMetrics] = useState<TelemetryMetrics>({
    totalProcessed: 0,
    validatedCount: 0,
    approvedCount: 0,
    cautionCount: 0,
    rejectedCount: 0,
    approvalRatePct: 100,
    avgAtrPct: 0,
  });
  const [streamTab, setStreamTab] = useState<'VALIDATED' | 'QUARANTINED'>('VALIDATED');
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/telemetry/feed');
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) {
        setValidatedStream(json.validatedStream || []);
        setQuarantinedStream(json.quarantinedStream || []);
        if (json.metrics) setMetrics(json.metrics);
        if (!lastResult && Array.isArray(json.validatedStream) && json.validatedStream[0]) {
          setLastResult({
            accepted: true,
            quarantined: false,
            telemetry: json.validatedStream[0],
            diagnostic: json.validatedStream[0],
          });
        }
      }
    } catch {}
  }, [lastResult]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const handleToggleAiSpec = async () => {
    const next = !showAiSpec;
    setShowAiSpec(next);
    if (next && !aiSpec) {
      try {
        const res = await fetch('/api/ai/telemetry-processor/spec');
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setAiSpec({
              model: json.model,
              responseMimeType: json.responseMimeType,
              systemInstruction: json.systemInstruction,
              responseSchema: json.responseSchema,
            });
          }
        }
      } catch {}
    }
  };

  const handleNormalize = async () => {
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      let payloadToSend: any = rawInput.trim();
      if (payloadToSend.startsWith('{') || payloadToSend.startsWith('[')) {
        try {
          payloadToSend = JSON.parse(payloadToSend);
          if (payloadToSend && typeof payloadToSend === 'object' && !Array.isArray(payloadToSend)) {
            if (!payloadToSend.timeframe && !payloadToSend.interval) {
              payloadToSend.timeframe = timeframeOverride;
            }
          }
        } catch {
          // Leave as string for plain-text parser
        }
      }

      const endpoint = useAiStructuredMode
        ? '/api/ai/telemetry-processor'
        : '/api/telemetry/normalize';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: payloadToSend,
          thresholds: { strictMode },
        }),
      });
      const json = await res.json();
      if (!res.ok && json.error) {
        setErrorMsg(json.error);
        return;
      }

      if (useAiStructuredMode && json.data) {
        setLastResult({
          accepted: Boolean(json.data.outputApproved),
          quarantined: !json.data.outputApproved,
          telemetry: json.telemetry ?? null,
          diagnostic: json.diagnostic,
          aiStructuredOutput: json.data,
        });
      } else {
        setLastResult({
          accepted: Boolean(json.accepted),
          quarantined: Boolean(json.quarantined),
          telemetry: json.telemetry ?? null,
          diagnostic: json.diagnostic,
        });
      }
      if (json.metrics) setMetrics(json.metrics);
      await fetchFeed();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to normalize telemetry payload.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleValidateLiveFeeds = async () => {
    setIsSyncingLive(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/telemetry/validate-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
          timeframe: timeframeOverride,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Live telemetry validation failed.');
        return;
      }
      if (Array.isArray(json.validatedStream)) {
        setValidatedStream(json.validatedStream);
      }
      if (json.metrics) setMetrics(json.metrics);
      const firstValid = json.outputStream?.[0] || null;
      const firstDiag = firstValid || json.quarantinedStream?.[0];
      if (firstDiag) {
        setLastResult({
          accepted: Boolean(firstValid),
          quarantined: !firstValid,
          telemetry: firstValid,
          diagnostic: firstDiag,
        });
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to sync live exchange telemetry.');
    } finally {
      setIsSyncingLive(false);
    }
  };

  const activeDiagnostic = lastResult?.diagnostic || null;
  const outputJsonText = useMemo(() => {
    if (!lastResult) return '// Submit a telemetry payload or sync live feeds to inspect standardized JSON output.';
    if (lastResult.aiStructuredOutput) {
      return JSON.stringify(lastResult.aiStructuredOutput, null, 2);
    }
    if (!lastResult.accepted || !lastResult.telemetry) {
      return JSON.stringify(
        {
          outputEmitted: false,
          quarantined: true,
          telemetry: null,
          validation: lastResult.diagnostic.validation,
        },
        null,
        2
      );
    }
    return JSON.stringify(lastResult.telemetry, null, 2);
  }, [lastResult]);

  const handleCopyJson = async () => {
    await copyToClipboard(outputJsonText);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 1600);
  };

  const displayedStream = streamTab === 'VALIDATED' ? validatedStream : quarantinedStream;

  return (
    <div className="space-y-4">
      {/* Top Pipeline Overview Strip */}
      <div className="panel-delta p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white tracking-tight">
            Telemetry Stream Normalizer &amp; Quantitative Gate
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Standardizes TradingView webhooks and exchange feeds into Schema v1.0 JSON after historical EMA/SMA and ATR/Bollinger validation.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-xs text-slate-400 font-mono-numbers mr-2">
            Processed {metrics.totalProcessed} <span aria-hidden="true">·</span> Approved {metrics.validatedCount}{' '}
            <span aria-hidden="true">·</span> Quarantined {metrics.rejectedCount}{' '}
            <span aria-hidden="true">·</span> Avg ATR {metrics.avgAtrPct.toFixed(2)}%
          </div>
          <button
            type="button"
            onClick={handleToggleAiSpec}
            className="btn-delta-sm btn-secondary text-xs"
          >
            {showAiSpec ? 'Hide AI Role & Schema' : 'AI Role & Schema'}
          </button>
          <button
            type="button"
            onClick={handleValidateLiveFeeds}
            disabled={isSyncingLive}
            className="btn-delta-sm btn-primary inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingLive ? 'animate-spin' : ''}`} />
            <span>{isSyncingLive ? 'Validating...' : 'Sync & Validate Live Feeds'}</span>
          </button>
        </div>
      </div>

      {showAiSpec && aiSpec && (
        <div className="panel-delta p-4 space-y-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
            <span className="font-semibold text-white">AI Structured Data Processor Contract</span>
            <span className="text-slate-400 font-mono-numbers">
              Model: {aiSpec.model} · MIME: {aiSpec.responseMimeType}
            </span>
          </div>
          <pre className="w-full max-h-48 overflow-auto bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] leading-relaxed text-slate-300 font-mono-numbers whitespace-pre-wrap">
            {aiSpec.systemInstruction}
          </pre>
        </div>
      )}

      {/* Main Split Workspace: Ingestion Left | Standardized Output & Gate Diagnostics Right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left: Raw Stream Ingestion */}
        <div className="xl:col-span-5 panel-delta p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-white">Incoming Stream Payload</span>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={strictMode}
                  onChange={(e) => setStrictMode(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span>Strict Chase Gate</span>
              </label>
              <select
                value={timeframeOverride}
                onChange={(e) => setTimeframeOverride(e.target.value as TelemetryTimeframe)}
                className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 font-mono-numbers focus:outline-none focus:border-cyan-500"
              >
                {(['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D'] as TelemetryTimeframe[]).map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Preset Payload Selector */}
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'TV_JSON_LONG', label: 'TradingView JSON' },
                { id: 'TV_TEXT_ALERT', label: 'TradingView Text' },
                { id: 'DELTA_V2_TICKER', label: 'Delta v2/ticker' },
                { id: 'BINANCE_FUTURES', label: 'Binance Ticker' },
                { id: 'REJECT_OUTLIER', label: 'Outlier Spike Test' },
              ] as Array<{ id: PresetKind; label: string }>
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setRawInput(buildPresetPayload(preset.id))}
                className="btn-delta-sm btn-secondary text-[11px]"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            rows={13}
            spellCheck={false}
            placeholder="Paste TradingView webhook JSON, alert string, or exchange ticker JSON..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-cyan-100 font-mono-numbers focus:outline-none focus:border-cyan-500 resize-y"
          />

          {errorMsg && (
            <div className="text-xs text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-lg px-3 py-2">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useAiStructuredMode}
                  onChange={(e) => setUseAiStructuredMode(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span>AI Structured JSON Mode</span>
              </label>
              <span className="text-[11px] text-slate-500 font-mono-numbers">
                {useAiStructuredMode ? 'POST /api/ai/telemetry-processor' : 'POST /api/telemetry/normalize'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleNormalize}
              disabled={isProcessing || !rawInput.trim()}
              className="btn-delta-sm btn-primary inline-flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{isProcessing ? 'Processing...' : 'Normalize & Validate'}</span>
            </button>
          </div>
        </div>

        {/* Right: Validation Gate Breakdown & Standardized JSON Output */}
        <div className="xl:col-span-7 panel-delta p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-semibold text-white">
                Validation Gate &amp; Standardized Output (Schema v1.0)
              </span>
            </div>
            {activeDiagnostic && (
              <div className="flex items-center gap-2 text-xs font-mono-numbers">
                {activeDiagnostic.validation.status === 'APPROVED' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    APPROVED · Score {activeDiagnostic.validation.score}/100
                  </span>
                ) : activeDiagnostic.validation.status === 'WARN_CAUTION' ? (
                  <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    CAUTION · Score {activeDiagnostic.validation.score}/100
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-400 font-semibold">
                    <XCircle className="w-3.5 h-3.5" />
                    QUARANTINED · Output Blocked
                  </span>
                )}
              </div>
            )}
          </div>

          {activeDiagnostic && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono-numbers border-y border-slate-800/80 py-2.5">
              <div>
                <div className="text-[10px] text-slate-400">Instrument / TF</div>
                <div className="font-bold text-white mt-0.5">
                  {activeDiagnostic.instrument.canonicalSymbol} · {activeDiagnostic.marketData.timeframe}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">MA Alignment</div>
                <div
                  className={`font-bold mt-0.5 ${
                    activeDiagnostic.validation.maAlignment.aligned ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {activeDiagnostic.validation.maAlignment.ema9VsEma20} · {activeDiagnostic.validation.maAlignment.priceVsSma20Pct >= 0 ? '+' : ''}
                  {activeDiagnostic.validation.maAlignment.priceVsSma20Pct.toFixed(2)}% SMA20
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Volatility / ATR(14)</div>
                <div
                  className={`font-bold mt-0.5 ${
                    activeDiagnostic.validation.volatilityCheck.passed ? 'text-cyan-300' : 'text-rose-400'
                  }`}
                >
                  {activeDiagnostic.validation.volatilityCheck.regime} · {activeDiagnostic.indicators.atrPct.toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">BB Width / Z-Score</div>
                <div className="font-bold text-slate-200 mt-0.5">
                  {activeDiagnostic.indicators.bollingerWidthPct.toFixed(2)}% · Z {activeDiagnostic.indicators.zScore}
                </div>
              </div>
            </div>
          )}

          {activeDiagnostic && activeDiagnostic.validation.reasons.length > 0 && (
            <div className="text-xs text-slate-300 space-y-1">
              {activeDiagnostic.validation.reasons.map((reason, idx) => (
                <div key={idx} className="flex items-start gap-1.5">
                  {activeDiagnostic.validation.validForOutput ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          )}

          <div className="relative flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span>Standardized Telemetry JSON</span>
              </span>
              <button
                type="button"
                onClick={handleCopyJson}
                className="btn-delta-sm btn-secondary inline-flex items-center gap-1 text-[11px]"
              >
                {copiedJson ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedJson ? 'Copied' : 'Copy JSON'}</span>
              </button>
            </div>
            <pre className="w-full max-h-64 overflow-auto bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] leading-relaxed text-emerald-200/90 font-mono-numbers">
              {outputJsonText}
            </pre>
          </div>
        </div>
      </div>

      {/* Validated Stream vs Quarantined Log Table */}
      <div className="panel-delta overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg">
            <button
              type="button"
              onClick={() => setStreamTab('VALIDATED')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                streamTab === 'VALIDATED' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Validated Output Stream ({validatedStream.length})
            </button>
            <button
              type="button"
              onClick={() => setStreamTab('QUARANTINED')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                streamTab === 'QUARANTINED' ? 'bg-slate-800 text-rose-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              Quarantined / Blocked ({quarantinedStream.length})
            </button>
          </div>
          <span className="text-[11px] text-slate-500 font-mono-numbers">
            Persisted to ~/.deltaai-data/telemetry-stream.json
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800/80">
              <tr>
                <th className="py-2 px-4 font-medium">Time</th>
                <th className="py-2 px-4 font-medium">Source</th>
                <th className="py-2 px-4 font-medium">Instrument</th>
                <th className="py-2 px-4 font-medium text-right">Price</th>
                <th className="py-2 px-4 font-medium text-center">Signal</th>
                <th className="py-2 px-4 font-medium text-right">EMA9 / SMA20</th>
                <th className="py-2 px-4 font-medium text-right">ATR% / Vol</th>
                <th className="py-2 px-4 font-medium text-right">Validation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono-numbers">
              {displayedStream.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500 font-sans">
                    {streamTab === 'VALIDATED'
                      ? 'No validated telemetry records yet. Click "Normalize & Validate" or "Sync & Validate Live Feeds".'
                      : 'No rejected signals quarantined yet.'}
                  </td>
                </tr>
              ) : (
                displayedStream.slice(0, 25).map((item) => (
                  <tr
                    key={item.telemetryId}
                    onClick={() =>
                      setLastResult({
                        accepted: item.validation.validForOutput,
                        quarantined: !item.validation.validForOutput,
                        telemetry: item.validation.validForOutput ? item : null,
                        diagnostic: item,
                      })
                    }
                    className="hover:bg-slate-900/60 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-4 text-slate-400 whitespace-nowrap">
                      {new Date(item.receivedAtMs).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-4 text-slate-300 font-sans">{item.source.provider}</td>
                    <td className="py-2.5 px-4 font-bold text-white">
                      {item.instrument.canonicalSymbol} · {item.marketData.timeframe}
                    </td>
                    <td className="py-2.5 px-4 text-right text-white">
                      ${item.marketData.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </td>
                    <td className="py-2.5 px-4 text-center font-semibold">
                      <span
                        className={
                          item.signal.action === 'LONG'
                            ? 'text-emerald-400'
                            : item.signal.action === 'SHORT'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }
                      >
                        {item.signal.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-300">
                      ${item.indicators.ema9} / ${item.indicators.sma20}
                    </td>
                    <td className="py-2.5 px-4 text-right text-cyan-300">
                      {item.indicators.atrPct.toFixed(2)}% · {item.validation.volatilityCheck.regime}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold">
                      <span
                        className={
                          item.validation.status === 'APPROVED'
                            ? 'text-emerald-400'
                            : item.validation.status === 'WARN_CAUTION'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }
                      >
                        {item.validation.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
