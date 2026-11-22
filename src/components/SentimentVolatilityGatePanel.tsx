import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellOff,
  CheckCircle2,
  MoveRight,
  Play,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import {
  MarketTicker,
  PreAlertEvaluationResult,
  TelemetryTimeframe,
} from '../types';

interface SentimentVolatilityGatePanelProps {
  markets: Record<string, MarketTicker>;
  selectedSymbol: string;
}

interface GateSummaryMetrics {
  totalEvaluated: number;
  allowedCount: number;
  highPriorityCount: number;
  silentCautionCount: number;
  blockedCount: number;
  blockRatePct: number;
  avgSentimentScore: number;
}

type SignalPresetId =
  | 'ALIGNED_SIGNAL'
  | 'TIGHT_STOP_WHIPSAW'
  | 'COUNTER_SENTIMENT'
  | 'VOLATILITY_SPIKE';

export const SentimentVolatilityGatePanel: React.FC<SentimentVolatilityGatePanelProps> = ({
  markets,
  selectedSymbol,
}) => {
  const activeMarket = markets[selectedSymbol] || markets['BTCUSDT'] || Object.values(markets)[0];
  const livePrice = activeMarket?.markPrice || 81702.5;
  const basePair = (activeMarket?.symbol || 'BTCUSDT').toUpperCase();
  const deltaPair = basePair.endsWith('USDT') ? basePair.replace('USDT', 'USD') : basePair;

  const buildSignalPreset = useCallback(
    (preset: SignalPresetId): string => {
      const px = livePrice;
      const isBull = (activeMarket?.change24h ?? 0) >= 0;
      if (preset === 'ALIGNED_SIGNAL') {
        const action = isBull ? 'buy' : 'sell';
        const sl = isBull ? +(px * 0.992).toFixed(2) : +(px * 1.008).toFixed(2);
        const tp = isBull ? +(px * 1.016).toFixed(2) : +(px * 0.984).toFixed(2);
        return JSON.stringify(
          {
            source: 'tradingview',
            ticker: `BINANCE:${basePair}.P`,
            interval: '5',
            action,
            close: px,
            sl,
            tp,
            strategy: { name: 'Institutional Momentum Flow', order_contracts: 4 },
            time: new Date().toISOString(),
          },
          null,
          2
        );
      }
      if (preset === 'TIGHT_STOP_WHIPSAW') {
        return JSON.stringify(
          {
            source: 'tradingview',
            ticker: deltaPair,
            interval: '5',
            action: 'buy',
            close: px,
            sl: +(px * 0.9998).toFixed(2),
            tp: +(px * 1.004).toFixed(2),
            strategy: 'Tight Stop Scalp',
            time: new Date().toISOString(),
          },
          null,
          2
        );
      }
      if (preset === 'COUNTER_SENTIMENT') {
        const counterAction = isBull ? 'sell' : 'buy';
        const sl = counterAction === 'sell' ? +(px * 1.008).toFixed(2) : +(px * 0.992).toFixed(2);
        const tp = counterAction === 'sell' ? +(px * 0.984).toFixed(2) : +(px * 1.016).toFixed(2);
        return JSON.stringify(
          {
            source: 'tradingview',
            ticker: deltaPair,
            interval: '5',
            action: counterAction,
            close: px,
            sl,
            tp,
            funding_rate: isBull ? 0.035 : -0.035,
            change24h: isBull ? 4.2 : -4.2,
            strategy: 'Counter-Trend Fade',
            time: new Date().toISOString(),
          },
          null,
          2
        );
      }
      // VOLATILITY_SPIKE
      return JSON.stringify(
        {
          source: 'tradingview',
          ticker: `BINANCE:${basePair}.P`,
          interval: '5',
          action: 'buy',
          close: +(px * 1.095).toFixed(2),
          high: +(px * 1.12).toFixed(2),
          low: +(px * 1.04).toFixed(2),
          sl: +(px * 1.085).toFixed(2),
          tp: +(px * 1.125).toFixed(2),
          strategy: 'News Spike Breakout',
          time: new Date().toISOString(),
        },
        null,
        2
      );
    },
    [activeMarket, basePair, deltaPair, livePrice]
  );

  const [payloadText, setPayloadText] = useState<string>(() => buildSignalPreset('ALIGNED_SIGNAL'));
  const [timeframe, setTimeframe] = useState<TelemetryTimeframe>('5m');
  const [dispatchAlert, setDispatchAlert] = useState<boolean>(true);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isScanningLive, setIsScanningLive] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeEval, setActiveEval] = useState<PreAlertEvaluationResult | null>(null);
  const [latestBySymbol, setLatestBySymbol] = useState<Record<string, PreAlertEvaluationResult>>({});
  const [evaluations, setEvaluations] = useState<PreAlertEvaluationResult[]>([]);
  const [filterMode, setFilterMode] = useState<'ALL' | 'ALLOWED' | 'BLOCKED'>('ALL');
  const [metrics, setMetrics] = useState<GateSummaryMetrics>({
    totalEvaluated: 0,
    allowedCount: 0,
    highPriorityCount: 0,
    silentCautionCount: 0,
    blockedCount: 0,
    blockRatePct: 0,
    avgSentimentScore: 0,
  });

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/signals/sentiment-alerts');
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) {
        setLatestBySymbol(json.latestBySymbol || {});
        setEvaluations(json.evaluations || []);
        if (json.metrics) setMetrics(json.metrics);
        if (!activeEval && Array.isArray(json.evaluations) && json.evaluations[0]) {
          setActiveEval(json.evaluations[0]);
        }
      }
    } catch {}
  }, [activeEval]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleScanLiveMarkets = async () => {
    setIsScanningLive(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/signals/scan-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
          timeframe,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Failed to scan live sentiment trends.');
        return;
      }
      setLatestBySymbol(json.latestBySymbol || {});
      setEvaluations(json.evaluations || []);
      if (json.metrics) setMetrics(json.metrics);
      if (Array.isArray(json.scanned) && json.scanned[0]) {
        setActiveEval(json.scanned[0]);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to scan live market data.');
    } finally {
      setIsScanningLive(false);
    }
  };

  const handleAnalyzeAndValidate = async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      let parsedPayload: any = payloadText.trim();
      if (parsedPayload.startsWith('{') || parsedPayload.startsWith('[')) {
        try {
          parsedPayload = JSON.parse(parsedPayload);
          if (parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)) {
            if (!parsedPayload.timeframe && !parsedPayload.interval) {
              parsedPayload.timeframe = timeframe;
            }
          }
        } catch {
          // keep as string for TradingView text alert parser
        }
      }

      const res = await fetch('/api/signals/analyze-and-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: parsedPayload,
          dispatchAlert,
          mode: 'PAPER',
        }),
      });
      const json = await res.json();
      if (!res.ok && json.error) {
        setErrorMsg(json.error);
        return;
      }
      if (json.evaluation) setActiveEval(json.evaluation);
      if (json.metrics) setMetrics(json.metrics);
      await loadHistory();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Signal analysis failed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const trackedSnapshots = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
    .map((sym) => latestBySymbol[sym])
    .filter((item): item is PreAlertEvaluationResult => Boolean(item));

  const filteredEvaluations = evaluations.filter((item) => {
    if (filterMode === 'ALLOWED') return item.shouldAlert;
    if (filterMode === 'BLOCKED') return !item.shouldAlert;
    return true;
  });

  const renderTrendIcon = (dir: string) => {
    if (dir === 'IMPROVING' || dir === 'REVERSING_UP') {
      return <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />;
    }
    if (dir === 'DETERIORATING' || dir === 'REVERSING_DOWN') {
      return <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />;
    }
    return <MoveRight className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <div className="space-y-4">
      {/* Header Summary Bar */}
      <div className="panel-delta p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white tracking-tight">
            Sentiment Trend Analyzer &amp; Pre-Alert Volatility Gate
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Tracks rolling multi-factor market sentiment and validates incoming trading signals against historical ATR percentiles before alerting.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs text-slate-400 font-mono-numbers">
            Evaluated {metrics.totalEvaluated} <span aria-hidden="true">·</span> Allowed {metrics.allowedCount}{' '}
            <span aria-hidden="true">·</span> Blocked {metrics.blockedCount} ({metrics.blockRatePct}%){' '}
            <span aria-hidden="true">·</span> Avg Sentiment {metrics.avgSentimentScore >= 0 ? '+' : ''}
            {metrics.avgSentimentScore}
          </div>
          <button
            type="button"
            onClick={handleScanLiveMarkets}
            disabled={isScanningLive}
            className="btn-delta-sm btn-primary inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanningLive ? 'animate-spin' : ''}`} />
            <span>{isScanningLive ? 'Scanning...' : 'Scan Live Sentiment'}</span>
          </button>
        </div>
      </div>

      {/* Live Per-Symbol Sentiment Trend Strip */}
      {trackedSnapshots.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {trackedSnapshots.map((snap) => {
            const score = snap.sentiment.compositeScore;
            const scoreColor =
              score >= 15 ? 'text-emerald-400' : score <= -15 ? 'text-rose-400' : 'text-slate-200';
            return (
              <div
                key={snap.symbol}
                onClick={() => setActiveEval(snap)}
                className="panel-delta p-3.5 cursor-pointer hover:border-cyan-500/40 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white font-mono-numbers">
                    {snap.symbol} · {snap.timeframe}
                  </span>
                  <span className="text-xs text-slate-400 font-mono-numbers">
                    ${snap.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between font-mono-numbers">
                  <div className={`text-lg font-bold ${scoreColor}`}>
                    {score >= 0 ? '+' : ''}
                    {score}
                    <span className="text-[11px] font-normal text-slate-400 ml-1.5">
                      {snap.sentiment.polarity.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                    {renderTrendIcon(snap.sentiment.trendDirection)}
                    <span>{snap.sentiment.trendDirection.replace('_', ' ')}</span>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono-numbers">
                  <span>
                    Vol {snap.volatility.regime} · P{snap.volatility.historicalVolPercentile}
                  </span>
                  <span>
                    ATR {snap.volatility.currentAtrPct.toFixed(2)}% ({snap.volatility.atrExpansionRatio}x)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Workbench: Signal Input Left | Pre-Alert Sentiment + Volatility Gate Right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5 panel-delta p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-white">Incoming Signal &amp; Market Data</span>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dispatchAlert}
                  onChange={(e) => setDispatchAlert(e.target.checked)}
                  className="accent-cyan-400"
                />
                <span>Route to Alert Relay</span>
              </label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as TelemetryTimeframe)}
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

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'ALIGNED_SIGNAL', label: 'Aligned Trend Signal' },
                { id: 'TIGHT_STOP_WHIPSAW', label: 'Tight Stop Whipsaw' },
                { id: 'COUNTER_SENTIMENT', label: 'Counter-Sentiment Fade' },
                { id: 'VOLATILITY_SPIKE', label: 'Volatility Spike' },
              ] as Array<{ id: SignalPresetId; label: string }>
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setPayloadText(buildSignalPreset(preset.id))}
                className="btn-delta-sm btn-secondary text-[11px]"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <textarea
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            rows={12}
            spellCheck={false}
            placeholder="Paste TradingView alert JSON/text or market data payload..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-cyan-100 font-mono-numbers focus:outline-none focus:border-cyan-500 resize-y"
          />

          {errorMsg && (
            <div className="text-xs text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-lg px-3 py-2">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-500 font-mono-numbers">
              POST /api/signals/analyze-and-alert
            </span>
            <button
              type="button"
              onClick={handleAnalyzeAndValidate}
              disabled={isAnalyzing || !payloadText.trim()}
              className="btn-delta-sm btn-primary inline-flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{isAnalyzing ? 'Validating...' : 'Analyze & Gate Alert'}</span>
            </button>
          </div>
        </div>

        <div className="xl:col-span-7 panel-delta p-4 flex flex-col gap-3.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold text-white">
              Pre-Alert Sentiment &amp; Historical Volatility Verdict
            </span>
            {activeEval && (
              <div className="inline-flex items-center gap-1.5 text-xs font-mono-numbers font-semibold">
                {activeEval.decision === 'ALLOW_HIGH_PRIORITY' ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <Bell className="w-3.5 h-3.5" />
                    ALLOW HIGH PRIORITY · Score {activeEval.confidenceScore}/100
                  </span>
                ) : activeEval.decision === 'ALLOW_SILENT_CAUTION' ? (
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    ALLOW SILENT (LOW PRIORITY) · Score {activeEval.confidenceScore}/100
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-400">
                    <BellOff className="w-3.5 h-3.5" />
                    ALERT BLOCKED · Suppressed Before Dispatch
                  </span>
                )}
              </div>
            )}
          </div>

          {!activeEval ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500 py-12">
              Click &quot;Analyze &amp; Gate Alert&quot; or &quot;Scan Live Sentiment&quot; to inspect sentiment trends and volatility validation.
            </div>
          ) : (
            <>
              {/* Sentiment Components Breakdown */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 border-y border-slate-800/80 font-mono-numbers text-xs">
                <div>
                  <div className="text-[10px] text-slate-400">Composite Sentiment</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      activeEval.sentiment.compositeScore >= 15
                        ? 'text-emerald-400'
                        : activeEval.sentiment.compositeScore <= -15
                        ? 'text-rose-400'
                        : 'text-slate-200'
                    }`}
                  >
                    {activeEval.sentiment.compositeScore >= 0 ? '+' : ''}
                    {activeEval.sentiment.compositeScore} · {activeEval.sentiment.trendDirection.replace('_', ' ')}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Signal Alignment</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      activeEval.sentiment.signalAlignment === 'ALIGNED'
                        ? 'text-emerald-400'
                        : activeEval.sentiment.signalAlignment === 'DIVERGENT'
                        ? 'text-rose-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {activeEval.signalAction} · {activeEval.sentiment.signalAlignment}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">ATR Expansion / Pct</div>
                  <div
                    className={`font-bold mt-0.5 ${
                      activeEval.volatility.passed ? 'text-cyan-300' : 'text-rose-400'
                    }`}
                  >
                    {activeEval.volatility.atrExpansionRatio}x Baseline · P{activeEval.volatility.historicalVolPercentile}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">Stop / ATR · R:R</div>
                  <div className="font-bold text-slate-200 mt-0.5">
                    {activeEval.volatility.stopDistanceAtrRatio !== undefined
                      ? `${activeEval.volatility.stopDistanceAtrRatio}x ATR`
                      : 'N/A'}{' '}
                    ·{' '}
                    {activeEval.volatility.riskRewardRatio !== undefined
                      ? `${activeEval.volatility.riskRewardRatio}:1`
                      : 'N/A'}
                  </div>
                </div>
              </div>

              {/* 4 Sentiment Factor Scores */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono-numbers">
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">Momentum</div>
                  <div className="font-bold text-white mt-0.5">
                    {activeEval.sentiment.components.momentumScore >= 0 ? '+' : ''}
                    {activeEval.sentiment.components.momentumScore}
                  </div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">MA Structure</div>
                  <div className="font-bold text-white mt-0.5">
                    {activeEval.sentiment.components.maStructureScore >= 0 ? '+' : ''}
                    {activeEval.sentiment.components.maStructureScore}
                  </div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">Funding &amp; Liq</div>
                  <div className="font-bold text-white mt-0.5">
                    {activeEval.sentiment.components.derivativesScore >= 0 ? '+' : ''}
                    {activeEval.sentiment.components.derivativesScore}
                  </div>
                </div>
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400">News Overlay</div>
                  <div className="font-bold text-white mt-0.5">
                    {activeEval.sentiment.components.newsScore >= 0 ? '+' : ''}
                    {activeEval.sentiment.components.newsScore}
                  </div>
                </div>
              </div>

              {/* Gate Reasons */}
              <div className="space-y-1.5 text-xs text-slate-300">
                {activeEval.reasons.map((reason, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    {activeEval.shouldAlert ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <span>{reason}</span>
                  </div>
                ))}
              </div>

              {/* Alert Dispatch Outcome */}
              {activeEval.alertDispatchResult && (
                <div className="pt-2.5 border-t border-slate-800/80 text-xs text-slate-400 font-mono-numbers flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Alert Routing: Priority <strong className="text-white">{activeEval.alertPriority.toUpperCase()}</strong>
                    {' · '}
                    disable_notification={String(activeEval.disableNotification)}
                  </span>
                  <span className="text-slate-300">{activeEval.alertDispatchResult.reason}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Audit Table */}
      <div className="panel-delta overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg">
            {(
              [
                { id: 'ALL', label: `All Evaluations (${evaluations.length})` },
                { id: 'ALLOWED', label: `Allowed (${metrics.allowedCount})` },
                { id: 'BLOCKED', label: `Blocked (${metrics.blockedCount})` },
              ] as Array<{ id: 'ALL' | 'ALLOWED' | 'BLOCKED'; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  filterMode === tab.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-slate-500 font-mono-numbers">
            Persisted to ~/.deltaai-data/sentiment-alerts.json
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800/80">
              <tr>
                <th className="py-2 px-4 font-medium">Time</th>
                <th className="py-2 px-4 font-medium">Instrument</th>
                <th className="py-2 px-4 font-medium text-center">Signal</th>
                <th className="py-2 px-4 font-medium text-right">Sentiment Trend</th>
                <th className="py-2 px-4 font-medium text-right">Historical Volatility</th>
                <th className="py-2 px-4 font-medium text-right">Pre-Alert Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono-numbers">
              {filteredEvaluations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500 font-sans">
                    No evaluations recorded in this view yet.
                  </td>
                </tr>
              ) : (
                filteredEvaluations.slice(0, 25).map((item) => (
                  <tr
                    key={item.evaluationId}
                    onClick={() => setActiveEval(item)}
                    className="hover:bg-slate-900/60 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-4 text-slate-400 whitespace-nowrap">
                      {new Date(item.evaluatedAtMs).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-4 font-bold text-white">
                      {item.symbol} · {item.timeframe}
                    </td>
                    <td className="py-2.5 px-4 text-center font-semibold">
                      <span
                        className={
                          item.signalAction === 'LONG'
                            ? 'text-emerald-400'
                            : item.signalAction === 'SHORT'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }
                      >
                        {item.signalAction}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-200">
                      {item.sentiment.compositeScore >= 0 ? '+' : ''}
                      {item.sentiment.compositeScore} · {item.sentiment.trendDirection.replace('_', ' ')}
                    </td>
                    <td className="py-2.5 px-4 text-right text-cyan-300">
                      {item.volatility.regime} · {item.volatility.atrExpansionRatio}x · P{item.volatility.historicalVolPercentile}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold">
                      {item.decision === 'ALLOW_HIGH_PRIORITY' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          HIGH ALERT
                        </span>
                      ) : item.decision === 'ALLOW_SILENT_CAUTION' ? (
                        <span className="inline-flex items-center gap-1 text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          SILENT LOW
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400">
                          <XCircle className="w-3.5 h-3.5" />
                          BLOCKED
                        </span>
                      )}
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
