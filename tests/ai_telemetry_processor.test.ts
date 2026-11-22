import assert from 'node:assert/strict';
import { Type, type Schema } from '@google/genai';
import {
  AI_DATA_PROCESSOR_PRIMARY_MODEL,
  AI_DATA_PROCESSOR_FALLBACK_MODEL,
  AI_DATA_PROCESSOR_SYSTEM_INSTRUCTION,
  AI_STRUCTURED_TELEMETRY_RESPONSE_SCHEMA,
  runAiStructuredTelemetryProcessor,
  type MinimalGenAiClient,
} from '../src/server/aiTelemetryProcessor.ts';
import type { TelemetryHistoricalCandle } from '../src/types.ts';

function buildUptrendCandles(count = 75, startPrice = 67000, step = 18): TelemetryHistoricalCandle[] {
  const candles: TelemetryHistoricalCandle[] = [];
  const startTime = 1710000000;
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = Number((open + step + Math.sin(i * 0.4) * 4).toFixed(2));
    const high = Number((Math.max(open, close) + 45).toFixed(2));
    const low = Number((Math.min(open, close) - 35).toFixed(2));
    candles.push({
      time: startTime + i * 300,
      open,
      high,
      low,
      close,
      volume: 120 + (i % 7) * 15,
    });
    price = close;
  }
  return candles;
}

function assertNoEmptyObjectSchemas(schema: Schema, path = 'root') {
  if (schema.type === Type.OBJECT) {
    assert.ok(
      schema.properties && Object.keys(schema.properties).length > 0,
      `Schema at ${path} must not be an empty Type.OBJECT`
    );
    for (const [key, child] of Object.entries(schema.properties)) {
      assertNoEmptyObjectSchemas(child, `${path}.${key}`);
    }
  } else if (schema.type === Type.ARRAY && schema.items) {
    assertNoEmptyObjectSchemas(schema.items, `${path}[]`);
  }
}

async function runTests() {
  // 1. System instruction contract check
  assert.ok(
    AI_DATA_PROCESSOR_SYSTEM_INSTRUCTION.includes('STRICT, valid JSON'),
    'System instruction must mandate strict structured JSON output'
  );
  assert.ok(
    AI_DATA_PROCESSOR_SYSTEM_INSTRUCTION.includes('NORMALIZE INCOMING DATA STREAMS'),
    'System instruction must require stream normalization'
  );
  for (const ma of ['EMA9', 'EMA20', 'EMA50', 'SMA20', 'VWAP']) {
    assert.ok(
      AI_DATA_PROCESSOR_SYSTEM_INSTRUCTION.includes(ma),
      `System instruction must reference historical moving average ${ma}`
    );
  }
  for (const vol of ['ATR(14)', 'Bollinger', 'Z-Score']) {
    assert.ok(
      AI_DATA_PROCESSOR_SYSTEM_INSTRUCTION.includes(vol),
      `System instruction must reference historical volatility indicator ${vol}`
    );
  }

  // 2. Response schema structure check
  assert.equal(AI_STRUCTURED_TELEMETRY_RESPONSE_SCHEMA.type, Type.OBJECT);
  assertNoEmptyObjectSchemas(AI_STRUCTURED_TELEMETRY_RESPONSE_SCHEMA);
  const topRequired = AI_STRUCTURED_TELEMETRY_RESPONSE_SCHEMA.required || [];
  for (const field of [
    'outputApproved',
    'validationStatus',
    'alertDecision',
    'normalizedStream',
    'movingAverageValidation',
    'volatilityValidation',
    'sentimentAssessment',
  ]) {
    assert.ok(topRequired.includes(field), `responseSchema must require '${field}'`);
  }

  const candles = buildUptrendCandles();
  const latestClose = candles[candles.length - 1].close;

  // 3. Mocked Gemini structured JSON processor happy path & API call contract
  const recordedCalls: any[] = [];
  const mockSuccessClient: MinimalGenAiClient = {
    models: {
      generateContent: async (params: any) => {
        recordedCalls.push(params);
        return {
          text: JSON.stringify({
            schemaVersion: '1.0',
            outputApproved: true,
            validationStatus: 'APPROVED',
            alertDecision: 'ALLOW_HIGH_PRIORITY',
            confidenceScore: 86,
            normalizedStream: {
              provider: 'TRADINGVIEW_WEBHOOK',
              canonicalSymbol: 'BTCUSDT',
              deltaSymbol: 'BTCUSD',
              timeframe: '5m',
              eventTimestampIso: new Date().toISOString(),
              price: latestClose,
              signalPresent: true,
              signalAction: 'LONG',
              entryPrice: latestClose,
              stopLoss: Number((latestClose - 120).toFixed(2)),
              takeProfit: Number((latestClose + 260).toFixed(2)),
            },
            movingAverageValidation: {
              aligned: true,
              maTrendBias: 'BULLISH',
              ema9: latestClose - 20,
              ema20: latestClose - 60,
              ema50: latestClose - 200,
              sma20: latestClose - 65,
              vwap: latestClose - 150,
              summary: 'Price holds above EMA9/EMA20/EMA50 with bullish slope alignment.',
            },
            volatilityValidation: {
              passed: true,
              regime: 'NORMAL',
              atr14: 82,
              atrPct: 0.12,
              atrExpansionRatio: 1.01,
              historicalVolPercentile: 48,
              bollingerWidthPct: 0.6,
              zScore: 1.2,
              summary: 'ATR(14) expansion and Z-Score sit well within normal historical bounds.',
            },
            sentimentAssessment: {
              compositeScore: 42,
              polarity: 'BULLISH',
              trendDirection: 'IMPROVING',
              signalAlignment: 'ALIGNED',
            },
            auditReasons: ['MA alignment verified above EMA9/EMA20/EMA50', 'Volatility within normal regime'],
          }),
        };
      },
    },
  };

  const validRes = await runAiStructuredTelemetryProcessor({
    rawPayload: {
      ticker: 'BINANCE:BTCUSDT.P',
      interval: '5',
      action: 'buy',
      price: latestClose,
      sl: Number((latestClose - 120).toFixed(2)),
      tp: Number((latestClose + 260).toFixed(2)),
      time: new Date().toISOString(),
    },
    candles,
    aiClient: mockSuccessClient,
  });

  assert.equal(recordedCalls.length, 1);
  assert.equal(recordedCalls[0].model, AI_DATA_PROCESSOR_PRIMARY_MODEL);
  assert.equal(recordedCalls[0].config.systemInstruction, AI_DATA_PROCESSOR_SYSTEM_INSTRUCTION);
  assert.equal(recordedCalls[0].config.responseMimeType, 'application/json');
  assert.equal(recordedCalls[0].config.responseSchema, AI_STRUCTURED_TELEMETRY_RESPONSE_SCHEMA);
  assert.equal(recordedCalls[0].config.temperature, undefined, 'Must not pass deprecated temperature to gemini-4-hydrogen');
  assert.equal(recordedCalls[0].config.topP, undefined, 'Must not pass deprecated topP to gemini-4-hydrogen');
  assert.equal(recordedCalls[0].config.topK, undefined, 'Must not pass deprecated topK to gemini-4-hydrogen');

  assert.equal(validRes.processorEngine, 'GEMINI_STRUCTURED_JSON');
  assert.equal(validRes.modelUsed, AI_DATA_PROCESSOR_PRIMARY_MODEL);
  assert.equal(validRes.outputApproved, true);
  assert.equal(validRes.validationStatus, 'APPROVED');
  assert.equal(validRes.alertDecision, 'ALLOW_HIGH_PRIORITY');
  assert.equal(validRes.normalizedStream.canonicalSymbol, 'BTCUSDT');
  assert.equal(validRes.normalizedStream.deltaSymbol, 'BTCUSD');
  assert.equal(validRes.movingAverageValidation.aligned, true);
  assert.equal(validRes.volatilityValidation.passed, true);

  // 4. Quantitative safety floor: AI cannot approve a bad outlier / rejected signal
  const overlyOptimisticClient: MinimalGenAiClient = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          schemaVersion: '1.0',
          outputApproved: true,
          validationStatus: 'APPROVED',
          alertDecision: 'ALLOW_HIGH_PRIORITY',
          confidenceScore: 95,
          normalizedStream: {
            provider: 'TRADINGVIEW_WEBHOOK',
            canonicalSymbol: 'BTCUSDT',
            deltaSymbol: 'BTCUSD',
            timeframe: '5m',
            eventTimestampIso: new Date().toISOString(),
            price: 95000,
            signalPresent: true,
            signalAction: 'LONG',
            entryPrice: 95000,
            stopLoss: 94990,
            takeProfit: 96000,
          },
          movingAverageValidation: {
            aligned: true,
            maTrendBias: 'BULLISH',
            ema9: latestClose,
            ema20: latestClose,
            ema50: latestClose,
            sma20: latestClose,
            vwap: latestClose,
            summary: 'Optimistic AI override attempt',
          },
          volatilityValidation: {
            passed: true,
            regime: 'NORMAL',
            atr14: 80,
            atrPct: 0.12,
            atrExpansionRatio: 1.0,
            historicalVolPercentile: 50,
            bollingerWidthPct: 0.5,
            zScore: 0.5,
            summary: 'Optimistic AI override attempt',
          },
          sentimentAssessment: {
            compositeScore: 50,
            polarity: 'BULLISH',
            trendDirection: 'STABLE',
            signalAlignment: 'ALIGNED',
          },
          auditReasons: ['Attempted AI approval'],
        }),
      }),
    },
  };

  const blockedRes = await runAiStructuredTelemetryProcessor({
    rawPayload: {
      ticker: 'BTCUSDT',
      timeframe: '5m',
      side: 'LONG',
      price: 95000, // Huge outlier vs ~68,300 historical candles
      stopLoss: 94990,
      takeProfit: 96000,
    },
    candles,
    aiClient: overlyOptimisticClient,
  });

  assert.equal(blockedRes.processorEngine, 'GEMINI_STRUCTURED_JSON');
  assert.equal(blockedRes.outputApproved, false, 'Safety floor must block outlier price even if AI approves');
  assert.equal(blockedRes.validationStatus, 'REJECTED');
  assert.equal(blockedRes.alertDecision, 'BLOCK_ALERT');

  // 5. Quota fallback to gemini-3.1-flash-lite
  const fallbackModelsCalled: string[] = [];
  const quotaFallbackClient: MinimalGenAiClient = {
    models: {
      generateContent: async (params: any) => {
        fallbackModelsCalled.push(params.model);
        if (params.model === AI_DATA_PROCESSOR_PRIMARY_MODEL) {
          throw new Error('429 RESOURCE_EXHAUSTED quota exceeded');
        }
        return mockSuccessClient.models.generateContent(params);
      },
    },
  };

  const quotaRes = await runAiStructuredTelemetryProcessor({
    rawPayload: {
      ticker: 'BTCUSDT',
      interval: '5m',
      action: 'buy',
      price: latestClose,
      sl: Number((latestClose - 120).toFixed(2)),
      tp: Number((latestClose + 260).toFixed(2)),
    },
    candles,
    aiClient: quotaFallbackClient,
  });

  assert.deepEqual(fallbackModelsCalled, [
    AI_DATA_PROCESSOR_PRIMARY_MODEL,
    AI_DATA_PROCESSOR_FALLBACK_MODEL,
  ]);
  assert.equal(quotaRes.processorEngine, 'GEMINI_STRUCTURED_JSON');
  assert.equal(quotaRes.modelUsed, AI_DATA_PROCESSOR_FALLBACK_MODEL);

  // 6. Deterministic fallback when aiClient is null
  const deterministicRes = await runAiStructuredTelemetryProcessor({
    rawPayload: {
      ticker: 'BTCUSDT',
      interval: '5m',
      action: 'buy',
      price: latestClose,
      sl: Number((latestClose - 120).toFixed(2)),
      tp: Number((latestClose + 260).toFixed(2)),
    },
    candles,
    aiClient: null,
  });

  assert.equal(deterministicRes.processorEngine, 'DETERMINISTIC_FALLBACK');
  assert.equal(deterministicRes.outputApproved, true);
  assert.equal(deterministicRes.normalizedStream.canonicalSymbol, 'BTCUSDT');

  console.log('ALL AI TELEMETRY PROCESSOR TESTS PASSED (6/6)');
}

runTests().catch((err) => {
  console.error('AI TELEMETRY PROCESSOR TEST FAILED:', err);
  process.exit(1);
});
