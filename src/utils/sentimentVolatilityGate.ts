import {
  HistoricalVolatilityValidation,
  MarketSentimentTrendAnalysis,
  NormalizedTelemetryEnvelope,
  PreAlertDecision,
  PreAlertEvaluationResult,
  SentimentHistoryPoint,
  SentimentPolarity,
  SentimentTrendDirection,
  TelemetryHistoricalCandle,
  TelemetryVolatilityRegime,
} from '../types';

export interface MarketSentimentContextInput {
  change24hPct?: number;
  fundingRate?: number;
  openInterestUsd?: number;
  liquidationsLong24h?: number;
  liquidationsShort24h?: number;
  newsAggregateScore?: number; // -100 to +100
  previousHistory?: SentimentHistoryPoint[];
}

export interface VolatilityAlertGateThresholds {
  maxAtrExpansionRatio?: number;
  elevatedAtrExpansionRatio?: number;
  maxHistoricalVolPercentile?: number;
  maxAbsZScore?: number;
  minStopAtrMultiple?: number;
  maxStopAtrMultiple?: number;
  minRiskRewardRatio?: number;
}

const DEFAULT_GATE_THRESHOLDS: Required<VolatilityAlertGateThresholds> = {
  maxAtrExpansionRatio: 2.2,
  elevatedAtrExpansionRatio: 1.45,
  maxHistoricalVolPercentile: 92,
  maxAbsZScore: 3.0,
  minStopAtrMultiple: 0.45,
  maxStopAtrMultiple: 5.5,
  minRiskRewardRatio: 1.15,
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function classifyPolarity(score: number): SentimentPolarity {
  if (score >= 45) return 'STRONGLY_BULLISH';
  if (score >= 15) return 'BULLISH';
  if (score <= -45) return 'STRONGLY_BEARISH';
  if (score <= -15) return 'BEARISH';
  return 'NEUTRAL';
}

export function analyzeMarketSentimentTrend(params: {
  telemetry: NormalizedTelemetryEnvelope;
  candles: TelemetryHistoricalCandle[];
  context?: MarketSentimentContextInput;
}): MarketSentimentTrendAnalysis {
  const { telemetry, candles, context = {} } = params;
  const price = telemetry.marketData.price || telemetry.indicators.latestClose || 0;
  const ind = telemetry.indicators;

  // 1. Price Momentum Component (-100..+100) from 24h change + recent candle return velocity
  const change24h = Number(context.change24hPct ?? telemetry.marketData.change24hPct ?? 0);
  let recentReturnPct = 0;
  if (candles.length >= 6) {
    const startClose = Number(candles[candles.length - 6].close || 0);
    const endClose = Number(candles[candles.length - 1].close || 0);
    if (startClose > 0 && endClose > 0) {
      recentReturnPct = ((endClose - startClose) / startClose) * 100;
    }
  }
  const momentumScore = Math.round(
    clamp(change24h * 14 + recentReturnPct * 42, -100, 100)
  );

  // 2. Moving Average Structure Component (-100..+100)
  let maStructureScore = 0;
  if (price > 0 && ind.ema20 > 0) {
    const emaCrossPct = ((ind.ema9 - ind.ema20) / ind.ema20) * 100;
    const priceVsEma50Pct = ind.ema50 > 0 ? ((price - ind.ema50) / ind.ema50) * 100 : 0;
    const priceVsVwapPct = ind.vwap > 0 ? ((price - ind.vwap) / ind.vwap) * 100 : 0;
    maStructureScore = Math.round(
      clamp(emaCrossPct * 85 + priceVsEma50Pct * 30 + priceVsVwapPct * 35, -100, 100)
    );
  }

  // 3. Derivatives Positioning Component (funding rate & liquidation skew)
  const funding = Number(context.fundingRate ?? telemetry.marketData.fundingRate ?? 0);
  // Moderate positive funding is bullish; extreme positive funding (>0.06%) signals overcrowded longs (contrarian drag)
  let fundingContribution = 0;
  if (Math.abs(funding) <= 0.05) {
    fundingContribution = clamp(funding * 1200, -45, 45);
  } else {
    // Crowded extremes dampen sentiment slightly to warn against squeeze/flush
    fundingContribution = funding > 0 ? 15 - (funding - 0.05) * 400 : -15 - (funding + 0.05) * 400;
  }

  const longLiq = Number(context.liquidationsLong24h ?? 0);
  const shortLiq = Number(context.liquidationsShort24h ?? 0);
  let liqContribution = 0;
  if (longLiq + shortLiq > 0) {
    // More shorts liquidated = upward squeeze bias; more longs liquidated = downward flush pressure
    liqContribution = ((shortLiq - longLiq) / (longLiq + shortLiq)) * 55;
  }
  const derivativesScore = Math.round(clamp(fundingContribution + liqContribution, -100, 100));

  // 4. External News Sentiment Component (if available)
  const hasNews = typeof context.newsAggregateScore === 'number' && Number.isFinite(context.newsAggregateScore);
  const newsScore = hasNews ? Math.round(clamp(context.newsAggregateScore!, -100, 100)) : 0;

  // Weighted Composite Sentiment Score
  const compositeScore = hasNews
    ? Math.round(
        clamp(
          momentumScore * 0.30 +
            maStructureScore * 0.35 +
            derivativesScore * 0.15 +
            newsScore * 0.20,
          -100,
          100
        )
      )
    : Math.round(
        clamp(
          momentumScore * 0.38 + maStructureScore * 0.42 + derivativesScore * 0.20,
          -100,
          100
        )
      );

  const polarity = classifyPolarity(compositeScore);

  // Rolling Sentiment Trend Direction
  const history = Array.isArray(context.previousHistory) ? context.previousHistory : [];
  const recentWindow = history.slice(-10);
  const rollingMeanScore =
    recentWindow.length > 0
      ? Number(
          (
            recentWindow.reduce((sum, pt) => sum + Number(pt.score || 0), 0) / recentWindow.length
          ).toFixed(1)
        )
      : compositeScore;
  const trendDelta = Number((compositeScore - rollingMeanScore).toFixed(1));
  const lastPrevScore = recentWindow.length > 0 ? recentWindow[recentWindow.length - 1].score : compositeScore;

  let trendDirection: SentimentTrendDirection = 'STABLE';
  if (recentWindow.length >= 2) {
    if (lastPrevScore <= -10 && compositeScore >= 10 && trendDelta >= 12) {
      trendDirection = 'REVERSING_UP';
    } else if (lastPrevScore >= 10 && compositeScore <= -10 && trendDelta <= -12) {
      trendDirection = 'REVERSING_DOWN';
    } else if (trendDelta >= 6) {
      trendDirection = 'IMPROVING';
    } else if (trendDelta <= -6) {
      trendDirection = 'DETERIORATING';
    }
  } else {
    // Infer short-term drift from momentum vs MA structure when history is still seeding
    if (momentumScore - maStructureScore >= 15) trendDirection = 'IMPROVING';
    else if (momentumScore - maStructureScore <= -15) trendDirection = 'DETERIORATING';
  }

  // Signal-to-Sentiment Alignment
  const action = telemetry.signal.action;
  let signalAlignment: 'ALIGNED' | 'NEUTRAL' | 'DIVERGENT' = 'NEUTRAL';
  if (action === 'LONG') {
    if (compositeScore >= 12 || (compositeScore >= 0 && (trendDirection === 'IMPROVING' || trendDirection === 'REVERSING_UP'))) {
      signalAlignment = 'ALIGNED';
    } else if (compositeScore <= -20 || (compositeScore < -8 && trendDirection === 'DETERIORATING')) {
      signalAlignment = 'DIVERGENT';
    }
  } else if (action === 'SHORT') {
    if (compositeScore <= -12 || (compositeScore <= 0 && (trendDirection === 'DETERIORATING' || trendDirection === 'REVERSING_DOWN'))) {
      signalAlignment = 'ALIGNED';
    } else if (compositeScore >= 20 || (compositeScore > 8 && trendDirection === 'IMPROVING')) {
      signalAlignment = 'DIVERGENT';
    }
  }

  const summary = `${polarity.replace('_', ' ')} (${compositeScore >= 0 ? '+' : ''}${compositeScore}) · Trend ${trendDirection.replace('_', ' ')} (${trendDelta >= 0 ? '+' : ''}${trendDelta} vs mean ${rollingMeanScore})`;

  return {
    symbol: telemetry.instrument.canonicalSymbol,
    compositeScore,
    polarity,
    trendDirection,
    trendDelta,
    rollingMeanScore,
    sampleCount: recentWindow.length + 1,
    signalAlignment,
    components: {
      momentumScore,
      maStructureScore,
      derivativesScore,
      newsScore,
    },
    summary,
  };
}

export function validateSignalHistoricalVolatility(params: {
  telemetry: NormalizedTelemetryEnvelope;
  candles: TelemetryHistoricalCandle[];
  thresholds?: VolatilityAlertGateThresholds;
}): HistoricalVolatilityValidation {
  const cfg = { ...DEFAULT_GATE_THRESHOLDS, ...(params.thresholds || {}) };
  const { telemetry, candles } = params;
  const reasons: string[] = [];

  const validCandles = (Array.isArray(candles) ? candles : []).filter(
    (c) => Number(c?.high) > 0 && Number(c?.low) > 0 && Number(c?.close) > 0
  );

  // Compute historical per-bar True Range % series for percentile & baseline comparison
  const trPctSeries: number[] = [];
  for (let i = 0; i < validCandles.length; i++) {
    const cur = validCandles[i];
    const h = Number(cur.high);
    const l = Number(cur.low);
    const c = Number(cur.close);
    const prevClose = i > 0 ? Number(validCandles[i - 1].close) : c;
    const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    if (c > 0) trPctSeries.push((tr / c) * 100);
  }

  // Rolling 14-bar ATR% samples across history to measure baseline median volatility & percentile rank
  const rollingAtrPcts: number[] = [];
  const win = 14;
  if (trPctSeries.length >= win) {
    for (let i = win; i <= trPctSeries.length; i++) {
      const slice = trPctSeries.slice(i - win, i);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      rollingAtrPcts.push(avg);
    }
  } else if (trPctSeries.length > 0) {
    rollingAtrPcts.push(trPctSeries.reduce((a, b) => a + b, 0) / trPctSeries.length);
  }

  const currentAtr14 = telemetry.indicators.atr14;
  const currentAtrPct = telemetry.indicators.atrPct;

  // Baseline volatility: median of historical samples excluding the very latest 3 bars when enough history exists
  const baselinePool =
    rollingAtrPcts.length >= 10 ? rollingAtrPcts.slice(0, -3) : rollingAtrPcts;
  const sortedBaseline = [...baselinePool].sort((a, b) => a - b);
  const baselineAtrPct =
    sortedBaseline.length > 0
      ? Number(sortedBaseline[Math.floor(sortedBaseline.length / 2)].toFixed(3))
      : currentAtrPct;

  const atrExpansionRatio =
    baselineAtrPct > 0.0001 ? Number((currentAtrPct / baselineAtrPct).toFixed(2)) : 1;

  // Historical Volatility Percentile: % of historical individual bar TR% readings below current bar/ATR%
  const latestBarTrPct =
    telemetry.marketData.high !== undefined &&
    telemetry.marketData.low !== undefined &&
    telemetry.marketData.price > 0
      ? ((telemetry.marketData.high - telemetry.marketData.low) / telemetry.marketData.price) * 100
      : trPctSeries.length > 0
      ? trPctSeries[trPctSeries.length - 1]
      : currentAtrPct;

  const probeVol = Math.max(currentAtrPct, latestBarTrPct * 0.85);
  let historicalVolPercentile = 50;
  if (trPctSeries.length >= 5) {
    const belowOrEqual = trPctSeries.filter((v) => v <= probeVol).length;
    historicalVolPercentile = Math.round((belowOrEqual / trPctSeries.length) * 100);
  }

  const zScore = telemetry.indicators.zScore;
  const bbWidth = telemetry.indicators.bollingerWidthPct;

  // Determine volatility regime
  let regime: TelemetryVolatilityRegime = telemetry.validation.volatilityCheck.regime;
  if (
    atrExpansionRatio >= cfg.maxAtrExpansionRatio ||
    Math.abs(zScore) >= cfg.maxAbsZScore ||
    telemetry.validation.volatilityCheck.regime === 'EXTREME'
  ) {
    regime = 'EXTREME';
  } else if (
    atrExpansionRatio >= cfg.elevatedAtrExpansionRatio ||
    historicalVolPercentile >= cfg.maxHistoricalVolPercentile
  ) {
    regime = 'ELEVATED';
  }

  let passed = telemetry.validation.volatilityCheck.passed;

  if (regime === 'EXTREME') {
    passed = false;
    reasons.push(
      `Extreme historical volatility expansion: ATR ratio ${atrExpansionRatio}x baseline (${currentAtrPct.toFixed(2)}% vs ${baselineAtrPct.toFixed(2)}%), Vol Percentile P${historicalVolPercentile}, Z-Score ${zScore}.`
    );
  } else if (historicalVolPercentile >= 96 && atrExpansionRatio >= 1.75) {
    passed = false;
    reasons.push(
      `Volatility spike above 96th historical percentile (P${historicalVolPercentile}, ${atrExpansionRatio}x ATR baseline).`
    );
  }

  // Signal risk geometry validation against ATR(14)
  let stopDistanceAtrRatio: number | undefined;
  let riskRewardRatio: number | undefined;
  const entry = telemetry.signal.entryPrice || telemetry.marketData.price;
  const sl = telemetry.signal.stopLoss;
  const tp = telemetry.signal.takeProfit;

  if (telemetry.signal.present && entry > 0 && sl !== undefined && sl > 0 && currentAtr14 > 0) {
    const slDist = Math.abs(entry - sl);
    stopDistanceAtrRatio = Number((slDist / currentAtr14).toFixed(2));
    if (stopDistanceAtrRatio < cfg.minStopAtrMultiple) {
      passed = false;
      reasons.push(
        `Stop-Loss too tight for current volatility (${stopDistanceAtrRatio}x ATR < ${cfg.minStopAtrMultiple}x minimum; high whipsaw risk).`
      );
    } else if (stopDistanceAtrRatio > cfg.maxStopAtrMultiple) {
      reasons.push(
        `Wide Stop-Loss (${stopDistanceAtrRatio}x ATR > ${cfg.maxStopAtrMultiple}x); elevated drawdown exposure.`
      );
    }

    if (tp !== undefined && tp > 0 && slDist > 0) {
      const tpDist = Math.abs(tp - entry);
      riskRewardRatio = Number((tpDist / slDist).toFixed(2));
      if (riskRewardRatio < cfg.minRiskRewardRatio) {
        passed = false;
        reasons.push(
          `Risk-to-Reward ratio ${riskRewardRatio}:1 is below ${cfg.minRiskRewardRatio}:1 minimum threshold.`
        );
      }
    }
  }

  if (reasons.length === 0) {
    reasons.push(
      `Historical volatility healthy (${regime}): ATR ${currentAtrPct.toFixed(2)}% (${atrExpansionRatio}x baseline, P${historicalVolPercentile}).`
    );
  }

  return {
    passed,
    regime,
    currentAtr14,
    currentAtrPct,
    baselineAtrPct,
    atrExpansionRatio,
    historicalVolPercentile,
    bollingerWidthPct: bbWidth,
    zScore,
    stopDistanceAtrRatio,
    riskRewardRatio,
    reasons,
  };
}

export function evaluateSentimentAndVolatilityBeforeAlert(params: {
  telemetry: NormalizedTelemetryEnvelope;
  candles: TelemetryHistoricalCandle[];
  sentimentContext?: MarketSentimentContextInput;
  thresholds?: VolatilityAlertGateThresholds;
  evaluatedAtMs?: number;
}): PreAlertEvaluationResult {
  const evaluatedAtMs = params.evaluatedAtMs ?? Date.now();
  const { telemetry, candles } = params;

  const sentiment = analyzeMarketSentimentTrend({
    telemetry,
    candles,
    context: params.sentimentContext,
  });

  const volatility = validateSignalHistoricalVolatility({
    telemetry,
    candles,
    thresholds: params.thresholds,
  });

  const reasons: string[] = [];
  let decision: PreAlertDecision = 'ALLOW_HIGH_PRIORITY';

  // Hard Pre-Alert Blocks
  if (!telemetry.validation.validForOutput) {
    decision = 'BLOCK_ALERT';
    reasons.push(...telemetry.validation.reasons);
  }
  if (!volatility.passed) {
    decision = 'BLOCK_ALERT';
    reasons.push(...volatility.reasons);
  }
  if (
    telemetry.signal.present &&
    (telemetry.signal.action === 'LONG' || telemetry.signal.action === 'SHORT') &&
    sentiment.signalAlignment === 'DIVERGENT' &&
    Math.abs(sentiment.compositeScore) >= 35
  ) {
    decision = 'BLOCK_ALERT';
    reasons.push(
      `Blocked counter-sentiment ${telemetry.signal.action}: market sentiment is strongly ${sentiment.polarity.replace('_', ' ')} (${sentiment.compositeScore}) and ${sentiment.trendDirection.replace('_', ' ')}.`
    );
  }

  // Caution / Silent Downgrade (if not blocked)
  if (decision !== 'BLOCK_ALERT') {
    const cautionTriggers: string[] = [];
    if (volatility.regime === 'ELEVATED' || volatility.regime === 'COMPRESSED') {
      cautionTriggers.push(`Volatility regime is ${volatility.regime} (ATR ratio ${volatility.atrExpansionRatio}x, P${volatility.historicalVolPercentile}).`);
    }
    if (telemetry.signal.present && sentiment.signalAlignment === 'DIVERGENT') {
      cautionTriggers.push(`Mild sentiment divergence (${sentiment.summary}); downgraded to silent alert.`);
    }
    if (telemetry.validation.status === 'WARN_CAUTION') {
      cautionTriggers.push(...telemetry.validation.reasons);
    }

    if (cautionTriggers.length > 0) {
      decision = 'ALLOW_SILENT_CAUTION';
      reasons.push(...cautionTriggers);
    } else {
      reasons.push(
        `Pre-alert gate passed: ${sentiment.summary}; ${volatility.reasons[0]}`
      );
    }
  }

  const shouldAlert = decision !== 'BLOCK_ALERT';
  const alertPriority: 'high' | 'low' | 'none' =
    decision === 'ALLOW_HIGH_PRIORITY'
      ? 'high'
      : decision === 'ALLOW_SILENT_CAUTION'
      ? 'low'
      : 'none';

  // Compute unified confidence score (0-100)
  let confidenceScore = telemetry.validation.score;
  if (sentiment.signalAlignment === 'ALIGNED') confidenceScore += 6;
  else if (sentiment.signalAlignment === 'DIVERGENT') confidenceScore -= 18;
  if (!volatility.passed) confidenceScore -= 35;
  else if (volatility.regime === 'ELEVATED') confidenceScore -= 8;
  confidenceScore = Math.round(clamp(confidenceScore, 5, 99));

  return {
    evaluationId: `eval_${evaluatedAtMs.toString(36)}_${telemetry.rawPayloadHash.slice(6)}`,
    evaluatedAtIso: new Date(evaluatedAtMs).toISOString(),
    evaluatedAtMs,
    symbol: telemetry.instrument.canonicalSymbol,
    deltaSymbol: telemetry.instrument.deltaSymbol,
    timeframe: telemetry.marketData.timeframe,
    signalAction: telemetry.signal.action,
    price: telemetry.marketData.price,
    decision,
    shouldAlert,
    alertPriority,
    disableNotification: alertPriority !== 'high',
    confidenceScore,
    sentiment,
    volatility,
    reasons: Array.from(new Set(reasons)),
    telemetry,
  };
}
