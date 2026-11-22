import { GoogleGenAI, Type, type Schema } from '@google/genai';
import {
  processTelemetryStreamItem,
  type TelemetryProcessorThresholds,
} from '../utils/telemetryProcessor.ts';
import {
  evaluateSentimentAndVolatilityBeforeAlert,
  type MarketSentimentContextInput,
  type VolatilityAlertGateThresholds,
} from '../utils/sentimentVolatilityGate.ts';
import type {
  NormalizedTelemetryEnvelope,
  PreAlertEvaluationResult,
  TelemetryHistoricalCandle,
  TelemetrySourceProvider,
} from '../types.ts';

export const AI_DATA_PROCESSOR_PRIMARY_MODEL = 'gemini-4-hydrogen';
export const AI_DATA_PROCESSOR_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

/**
 * Canonical System Instruction defining the AI's role as an institutional
 * structured-JSON data processor and quantitative signal validator.
 */
export const AI_DATA_PROCESSOR_SYSTEM_INSTRUCTION = `You are an institutional quantitative market data processor and trading signal validator.

ROLE & OUTPUT CONTRACT:
- Output STRICT, valid JSON conforming exclusively to the provided responseSchema.
- Never emit markdown fences, prose outside JSON fields, commentary, or speculative prices.
- Keep every reasoning string concise, factual, and anchored to numerical telemetry.

MANDATORY PROCESSING PIPELINE BEFORE OUTPUTTING:
1. NORMALIZE INCOMING DATA STREAMS:
   - Parse raw payloads from TradingView webhooks (JSON or plain-text alerts), Delta Exchange India, Binance, Bybit, or custom feeds.
   - Standardize ticker symbols into canonical USDT perpetual format (e.g., BTCUSDT) and Delta Exchange format (e.g., BTCUSD), preserving option legs (C-/P-) unchanged.
   - Standardize timeframes to 1m, 3m, 5m, 15m, 30m, 1h, 4h, or 1D, timestamps to ISO-8601 UTC, numeric strings to clean floats, and directional intents to LONG, SHORT, EXIT, or NEUTRAL.

2. VALIDATE AGAINST HISTORICAL MOVING AVERAGES:
   - Evaluate every directional signal against historical EMA9, EMA20, EMA50, SMA20, SMA50, and VWAP.
   - Reject counter-trend LONG signals when price is below EMA50 with bearish EMA9 < EMA20 structure, and reject counter-trend SHORT signals when price is above EMA50 with bullish EMA9 > EMA20 structure.
   - Flag overextended chase entries exceeding 2.35x ATR distance from EMA20 as WARN_CAUTION or REJECTED.
   - Verify Stop-Loss and Take-Profit geometry sits on the mathematically valid side of entry price.

3. VALIDATE AGAINST HISTORICAL VOLATILITY INDICATORS:
   - Evaluate ATR(14), ATR%, historical baseline ATR expansion ratio, historical volatility percentile rank, 20-period Bollinger Band width %, Z-Score, and bid-ask spread (bps).
   - Reject signals during EXTREME volatility regimes (ATR expansion >= 2.2x baseline, |Z-Score| >= 3.0, extreme candle range spikes, or outlier price deviations).
   - Reject signals with dangerously tight Stop-Loss distances (< 0.45x ATR) or insufficient Risk-to-Reward (< 1.15:1).
   - Downgrade ELEVATED or COMPRESSED volatility regimes to ALLOW_SILENT_CAUTION (low priority) instead of high-priority alerts.

4. PRE-OUTPUT GATE:
   - Set outputApproved = true ONLY when moving average, price sanity, and volatility validations pass (APPROVED or WARN_CAUTION).
   - If any hard risk, moving average, or extreme volatility rule fails, set outputApproved = false, validationStatus = "REJECTED", and alertDecision = "BLOCK_ALERT".`;

/**
 * Strict @google/genai Type responseSchema enforcing structured JSON output
 * for normalized market telemetry and MA/volatility signal validation.
 */
export const AI_STRUCTURED_TELEMETRY_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    'schemaVersion',
    'outputApproved',
    'validationStatus',
    'alertDecision',
    'confidenceScore',
    'normalizedStream',
    'movingAverageValidation',
    'volatilityValidation',
    'sentimentAssessment',
    'auditReasons',
  ],
  properties: {
    schemaVersion: {
      type: Type.STRING,
      description: 'Fixed schema version identifier, must be "1.0".',
    },
    outputApproved: {
      type: Type.BOOLEAN,
      description: 'True only if the normalized stream passes moving average and volatility validation gates.',
    },
    validationStatus: {
      type: Type.STRING,
      enum: ['APPROVED', 'WARN_CAUTION', 'REJECTED'],
      description: 'Final validation verdict after checking historical moving averages and volatility indicators.',
    },
    alertDecision: {
      type: Type.STRING,
      enum: ['ALLOW_HIGH_PRIORITY', 'ALLOW_SILENT_CAUTION', 'BLOCK_ALERT'],
      description: 'Pre-alert routing decision for downstream alerting channels.',
    },
    confidenceScore: {
      type: Type.INTEGER,
      description: 'Calibrated integer confidence score between 0 and 100.',
    },
    normalizedStream: {
      type: Type.OBJECT,
      required: [
        'provider',
        'canonicalSymbol',
        'deltaSymbol',
        'timeframe',
        'eventTimestampIso',
        'price',
        'signalPresent',
        'signalAction',
      ],
      properties: {
        provider: {
          type: Type.STRING,
          enum: [
            'TRADINGVIEW_WEBHOOK',
            'DELTA_EXCHANGE',
            'BINANCE_SPOT',
            'BINANCE_FUTURES',
            'BYBIT',
            'CUSTOM_JSON',
          ],
          description: 'Detected source feed provider.',
        },
        canonicalSymbol: {
          type: Type.STRING,
          description: 'Standardized perpetual symbol such as BTCUSDT, ETHUSDT, SOLUSDT.',
        },
        deltaSymbol: {
          type: Type.STRING,
          description: 'Delta Exchange India contract symbol such as BTCUSD, ETHUSD, SOLUSD.',
        },
        timeframe: {
          type: Type.STRING,
          enum: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D'],
          description: 'Normalized candle interval.',
        },
        eventTimestampIso: {
          type: Type.STRING,
          description: 'Normalized ISO-8601 UTC timestamp string.',
        },
        price: {
          type: Type.NUMBER,
          description: 'Normalized market or signal reference price.',
        },
        signalPresent: {
          type: Type.BOOLEAN,
          description: 'Whether an explicit trading signal action was present in the payload.',
        },
        signalAction: {
          type: Type.STRING,
          enum: ['LONG', 'SHORT', 'EXIT', 'NEUTRAL'],
          description: 'Standardized signal direction.',
        },
        entryPrice: {
          type: Type.NUMBER,
          description: 'Normalized signal entry price.',
        },
        stopLoss: {
          type: Type.NUMBER,
          description: 'Normalized stop-loss price if supplied, or 0 if omitted.',
        },
        takeProfit: {
          type: Type.NUMBER,
          description: 'Normalized take-profit price if supplied, or 0 if omitted.',
        },
      },
    },
    movingAverageValidation: {
      type: Type.OBJECT,
      required: ['aligned', 'maTrendBias', 'ema9', 'ema20', 'ema50', 'sma20', 'vwap', 'summary'],
      properties: {
        aligned: {
          type: Type.BOOLEAN,
          description: 'Whether the signal aligns with historical moving average structure.',
        },
        maTrendBias: {
          type: Type.STRING,
          enum: ['BULLISH', 'BEARISH', 'FLAT'],
          description: 'EMA9 vs EMA20 moving average trend bias.',
        },
        ema9: { type: Type.NUMBER, description: 'Historical EMA9 value.' },
        ema20: { type: Type.NUMBER, description: 'Historical EMA20 value.' },
        ema50: { type: Type.NUMBER, description: 'Historical EMA50 value.' },
        sma20: { type: Type.NUMBER, description: 'Historical SMA20 value.' },
        vwap: { type: Type.NUMBER, description: 'Historical session VWAP value.' },
        summary: {
          type: Type.STRING,
          description: 'Single-sentence moving average alignment assessment.',
        },
      },
    },
    volatilityValidation: {
      type: Type.OBJECT,
      required: [
        'passed',
        'regime',
        'atr14',
        'atrPct',
        'atrExpansionRatio',
        'historicalVolPercentile',
        'bollingerWidthPct',
        'zScore',
        'summary',
      ],
      properties: {
        passed: {
          type: Type.BOOLEAN,
          description: 'Whether historical volatility bounds and stop-ATR checks passed.',
        },
        regime: {
          type: Type.STRING,
          enum: ['COMPRESSED', 'NORMAL', 'ELEVATED', 'EXTREME'],
          description: 'Classified volatility regime.',
        },
        atr14: { type: Type.NUMBER, description: '14-period Average True Range in price units.' },
        atrPct: { type: Type.NUMBER, description: 'ATR(14) as a percentage of price.' },
        atrExpansionRatio: {
          type: Type.NUMBER,
          description: 'Current ATR% divided by historical median baseline ATR%.',
        },
        historicalVolPercentile: {
          type: Type.INTEGER,
          description: 'Percentile rank (0-100) of current volatility vs historical bars.',
        },
        bollingerWidthPct: {
          type: Type.NUMBER,
          description: '20-period Bollinger Band bandwidth percentage.',
        },
        zScore: {
          type: Type.NUMBER,
          description: 'Price Z-Score relative to 20-period mean.',
        },
        summary: {
          type: Type.STRING,
          description: 'Single-sentence historical volatility validation assessment.',
        },
      },
    },
    sentimentAssessment: {
      type: Type.OBJECT,
      required: ['compositeScore', 'polarity', 'trendDirection', 'signalAlignment'],
      properties: {
        compositeScore: {
          type: Type.INTEGER,
          description: 'Composite market sentiment score from -100 to +100.',
        },
        polarity: {
          type: Type.STRING,
          enum: ['STRONGLY_BULLISH', 'BULLISH', 'NEUTRAL', 'BEARISH', 'STRONGLY_BEARISH'],
          description: 'Classified sentiment polarity.',
        },
        trendDirection: {
          type: Type.STRING,
          enum: ['IMPROVING', 'STABLE', 'DETERIORATING', 'REVERSING_UP', 'REVERSING_DOWN'],
          description: 'Sentiment trend trajectory.',
        },
        signalAlignment: {
          type: Type.STRING,
          enum: ['ALIGNED', 'NEUTRAL', 'DIVERGENT'],
          description: 'Alignment between signal direction and market sentiment.',
        },
      },
    },
    auditReasons: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Concise list of validation checks and gating reasons.',
    },
  },
};

export interface AiStructuredTelemetryOutput {
  schemaVersion: '1.0';
  processorEngine: 'GEMINI_STRUCTURED_JSON' | 'DETERMINISTIC_FALLBACK';
  modelUsed: string;
  systemInstructionVersion: string;
  outputApproved: boolean;
  validationStatus: 'APPROVED' | 'WARN_CAUTION' | 'REJECTED';
  alertDecision: 'ALLOW_HIGH_PRIORITY' | 'ALLOW_SILENT_CAUTION' | 'BLOCK_ALERT';
  confidenceScore: number;
  normalizedStream: {
    provider: TelemetrySourceProvider;
    canonicalSymbol: string;
    deltaSymbol: string;
    timeframe: NormalizedTelemetryEnvelope['marketData']['timeframe'];
    eventTimestampIso: string;
    price: number;
    signalPresent: boolean;
    signalAction: NormalizedTelemetryEnvelope['signal']['action'];
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
  };
  movingAverageValidation: {
    aligned: boolean;
    maTrendBias: 'BULLISH' | 'BEARISH' | 'FLAT';
    ema9: number;
    ema20: number;
    ema50: number;
    sma20: number;
    vwap: number;
    summary: string;
  };
  volatilityValidation: {
    passed: boolean;
    regime: 'COMPRESSED' | 'NORMAL' | 'ELEVATED' | 'EXTREME';
    atr14: number;
    atrPct: number;
    atrExpansionRatio: number;
    historicalVolPercentile: number;
    bollingerWidthPct: number;
    zScore: number;
    summary: string;
  };
  sentimentAssessment: {
    compositeScore: number;
    polarity: PreAlertEvaluationResult['sentiment']['polarity'];
    trendDirection: PreAlertEvaluationResult['sentiment']['trendDirection'];
    signalAlignment: PreAlertEvaluationResult['sentiment']['signalAlignment'];
  };
  auditReasons: string[];
  deterministicEnvelope: NormalizedTelemetryEnvelope;
  preAlertEvaluation: PreAlertEvaluationResult;
}

export interface MinimalGenAiClient {
  models: {
    generateContent: (params: any) => Promise<{ text?: string }>;
  };
}

function buildBaselineOutput(
  envelope: NormalizedTelemetryEnvelope,
  evaluation: PreAlertEvaluationResult,
  engine: 'GEMINI_STRUCTURED_JSON' | 'DETERMINISTIC_FALLBACK',
  modelUsed: string
): AiStructuredTelemetryOutput {
  const outputApproved = evaluation.shouldAlert && envelope.validation.validForOutput;
  const validationStatus: 'APPROVED' | 'WARN_CAUTION' | 'REJECTED' = !outputApproved
    ? 'REJECTED'
    : evaluation.decision === 'ALLOW_SILENT_CAUTION' || envelope.validation.status === 'WARN_CAUTION'
    ? 'WARN_CAUTION'
    : 'APPROVED';

  return {
    schemaVersion: '1.0',
    processorEngine: engine,
    modelUsed,
    systemInstructionVersion: 'deltaai-data-processor-v1',
    outputApproved,
    validationStatus,
    alertDecision: evaluation.decision,
    confidenceScore: evaluation.confidenceScore,
    normalizedStream: {
      provider: envelope.source.provider,
      canonicalSymbol: envelope.instrument.canonicalSymbol,
      deltaSymbol: envelope.instrument.deltaSymbol,
      timeframe: envelope.marketData.timeframe,
      eventTimestampIso: envelope.eventTimestampIso,
      price: envelope.marketData.price,
      signalPresent: envelope.signal.present,
      signalAction: envelope.signal.action,
      entryPrice: envelope.signal.entryPrice,
      stopLoss: envelope.signal.stopLoss ?? 0,
      takeProfit: envelope.signal.takeProfit ?? 0,
    },
    movingAverageValidation: {
      aligned: envelope.validation.maAlignment.aligned,
      maTrendBias: envelope.validation.maAlignment.ema9VsEma20,
      ema9: envelope.indicators.ema9,
      ema20: envelope.indicators.ema20,
      ema50: envelope.indicators.ema50,
      sma20: envelope.indicators.sma20,
      vwap: envelope.indicators.vwap,
      summary: envelope.validation.maAlignment.reason,
    },
    volatilityValidation: {
      passed: evaluation.volatility.passed && envelope.validation.volatilityCheck.passed,
      regime: evaluation.volatility.regime,
      atr14: evaluation.volatility.currentAtr14,
      atrPct: evaluation.volatility.currentAtrPct,
      atrExpansionRatio: evaluation.volatility.atrExpansionRatio,
      historicalVolPercentile: evaluation.volatility.historicalVolPercentile,
      bollingerWidthPct: evaluation.volatility.bollingerWidthPct,
      zScore: evaluation.volatility.zScore,
      summary: evaluation.volatility.reasons[0] || envelope.validation.volatilityCheck.reason,
    },
    sentimentAssessment: {
      compositeScore: evaluation.sentiment.compositeScore,
      polarity: evaluation.sentiment.polarity,
      trendDirection: evaluation.sentiment.trendDirection,
      signalAlignment: evaluation.sentiment.signalAlignment,
    },
    auditReasons: evaluation.reasons,
    deterministicEnvelope: envelope,
    preAlertEvaluation: evaluation,
  };
}

/**
 * Executes the AI Structured JSON Data Processor using Google GenAI (`gemini-4-hydrogen`),
 * instructing the model via `systemInstruction` and enforcing strict `responseSchema`,
 * anchored by verified historical moving averages and volatility metrics.
 */
export async function runAiStructuredTelemetryProcessor(params: {
  rawPayload: unknown;
  candles: TelemetryHistoricalCandle[];
  aiClient?: MinimalGenAiClient | null;
  source?: TelemetrySourceProvider;
  sentimentContext?: MarketSentimentContextInput;
  telemetryThresholds?: TelemetryProcessorThresholds;
  gateThresholds?: VolatilityAlertGateThresholds;
  timeoutMs?: number;
}): Promise<AiStructuredTelemetryOutput> {
  const {
    rawPayload,
    candles,
    aiClient,
    source,
    sentimentContext,
    telemetryThresholds,
    gateThresholds,
    timeoutMs = 15000,
  } = params;

  // Step 1: Compute verified quantitative historical moving averages & volatility metrics
  const ingestion = processTelemetryStreamItem(rawPayload, candles, {
    source,
    thresholds: telemetryThresholds,
  });
  const envelope = ingestion.diagnostic;
  const evaluation = evaluateSentimentAndVolatilityBeforeAlert({
    telemetry: envelope,
    candles,
    sentimentContext,
    thresholds: gateThresholds,
  });

  const baseline = buildBaselineOutput(envelope, evaluation, 'DETERMINISTIC_FALLBACK', 'deterministic-quant-engine');

  if (!aiClient) {
    return baseline;
  }

  const promptPayload = {
    rawIncomingStream: rawPayload,
    verifiedHistoricalIndicators: {
      candleCount: envelope.indicators.candleCount,
      latestClose: envelope.indicators.latestClose,
      movingAverages: {
        ema9: envelope.indicators.ema9,
        ema20: envelope.indicators.ema20,
        ema50: envelope.indicators.ema50,
        sma20: envelope.indicators.sma20,
        sma50: envelope.indicators.sma50,
        vwap: envelope.indicators.vwap,
        ema9VsEma20: envelope.validation.maAlignment.ema9VsEma20,
        priceVsSma20Pct: envelope.validation.maAlignment.priceVsSma20Pct,
        extensionAtrRatio: envelope.validation.maAlignment.extensionAtrRatio,
      },
      volatilityIndicators: {
        atr14: evaluation.volatility.currentAtr14,
        atrPct: evaluation.volatility.currentAtrPct,
        baselineAtrPct: evaluation.volatility.baselineAtrPct,
        atrExpansionRatio: evaluation.volatility.atrExpansionRatio,
        historicalVolPercentile: evaluation.volatility.historicalVolPercentile,
        bollingerUpper: envelope.indicators.bollingerUpper,
        bollingerMid: envelope.indicators.bollingerMid,
        bollingerLower: envelope.indicators.bollingerLower,
        bollingerWidthPct: envelope.indicators.bollingerWidthPct,
        zScore: envelope.indicators.zScore,
        realizedVolPct: envelope.indicators.realizedVolPct,
        stopDistanceAtrRatio: evaluation.volatility.stopDistanceAtrRatio ?? null,
        riskRewardRatio: evaluation.volatility.riskRewardRatio ?? null,
      },
      sentimentTrend: evaluation.sentiment,
      quantitativePreChecks: {
        telemetryStatus: envelope.validation.status,
        preAlertDecision: evaluation.decision,
        reasons: evaluation.reasons,
      },
    },
  };

  const modelsToTry = [AI_DATA_PROCESSOR_PRIMARY_MODEL, AI_DATA_PROCESSOR_FALLBACK_MODEL];

  for (const modelName of modelsToTry) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI_PROCESSOR_TIMEOUT')), timeoutMs)
      );

      // Note: Do NOT pass deprecated sampling parameters (temperature, topP, topK) to gemini-4-hydrogen
      const generatePromise = aiClient.models.generateContent({
        model: modelName,
        contents: `Normalize the incoming telemetry stream and validate all trading signals against the verified historical moving averages and volatility indicators below. Return strict JSON matching the schema.\n\n${JSON.stringify(promptPayload)}`,
        config: {
          systemInstruction: AI_DATA_PROCESSOR_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: AI_STRUCTURED_TELEMETRY_RESPONSE_SCHEMA,
        },
      });

      const response = await Promise.race([generatePromise, timeoutPromise]);
      const rawText = (response?.text || '').trim();
      if (!rawText) continue;

      const parsed = JSON.parse(rawText);

      // Hard Quantitative Safety Floor: AI cannot override hard mathematical MA/volatility/outlier rejections
      const hardBlocked = !baseline.outputApproved;
      const finalApproved = hardBlocked ? false : Boolean(parsed.outputApproved);
      const finalStatus: 'APPROVED' | 'WARN_CAUTION' | 'REJECTED' = hardBlocked
        ? 'REJECTED'
        : parsed.validationStatus === 'APPROVED' ||
          parsed.validationStatus === 'WARN_CAUTION' ||
          parsed.validationStatus === 'REJECTED'
        ? parsed.validationStatus
        : baseline.validationStatus;
      const finalDecision: 'ALLOW_HIGH_PRIORITY' | 'ALLOW_SILENT_CAUTION' | 'BLOCK_ALERT' =
        hardBlocked || !finalApproved
          ? 'BLOCK_ALERT'
          : parsed.alertDecision === 'ALLOW_HIGH_PRIORITY' ||
            parsed.alertDecision === 'ALLOW_SILENT_CAUTION' ||
            parsed.alertDecision === 'BLOCK_ALERT'
          ? parsed.alertDecision
          : baseline.alertDecision;

      const aiReasons: string[] = Array.isArray(parsed.auditReasons)
        ? parsed.auditReasons.map((r: unknown) => String(r)).filter(Boolean)
        : [];
      const mergedReasons = Array.from(
        new Set([...(hardBlocked ? baseline.auditReasons : []), ...aiReasons, ...baseline.auditReasons])
      ).slice(0, 6);

      return {
        ...baseline,
        processorEngine: 'GEMINI_STRUCTURED_JSON',
        modelUsed: modelName,
        outputApproved: finalApproved,
        validationStatus: finalStatus,
        alertDecision: finalDecision,
        confidenceScore: Number.isFinite(Number(parsed.confidenceScore))
          ? Math.max(0, Math.min(100, Math.round(Number(parsed.confidenceScore))))
          : baseline.confidenceScore,
        normalizedStream: {
          ...baseline.normalizedStream,
          ...(parsed.normalizedStream && typeof parsed.normalizedStream === 'object'
            ? {
                canonicalSymbol: parsed.normalizedStream.canonicalSymbol || baseline.normalizedStream.canonicalSymbol,
                deltaSymbol: parsed.normalizedStream.deltaSymbol || baseline.normalizedStream.deltaSymbol,
                timeframe: parsed.normalizedStream.timeframe || baseline.normalizedStream.timeframe,
                signalAction: parsed.normalizedStream.signalAction || baseline.normalizedStream.signalAction,
              }
            : {}),
        },
        movingAverageValidation: {
          ...baseline.movingAverageValidation,
          summary:
            parsed.movingAverageValidation?.summary || baseline.movingAverageValidation.summary,
          aligned: hardBlocked ? baseline.movingAverageValidation.aligned : Boolean(parsed.movingAverageValidation?.aligned ?? baseline.movingAverageValidation.aligned),
        },
        volatilityValidation: {
          ...baseline.volatilityValidation,
          summary:
            parsed.volatilityValidation?.summary || baseline.volatilityValidation.summary,
          passed: hardBlocked ? baseline.volatilityValidation.passed : Boolean(parsed.volatilityValidation?.passed ?? baseline.volatilityValidation.passed),
        },
        auditReasons: mergedReasons,
      };
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
      if (isQuota) continue;
      break;
    }
  }

  return baseline;
}

export function createServerGenAiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}
