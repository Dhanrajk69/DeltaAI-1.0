import { MarketTelemetry } from '../types';

export interface AutoPilotValidationResult {
  canExecute: boolean;
  reason: string;
  safeguardActive?: boolean;
  isAdvisoryWarning?: boolean;
  isBypassActive?: boolean;
  requiredMargin?: number;
  availableBalance?: number;
  marginDeficit?: number;
}

export function validateAutoPilotDispatch(
  direction: 'LONG' | 'SHORT',
  telemetry: MarketTelemetry,
  options?: {
    bypassHtfFilter?: boolean;
    confidence?: number;
    lotSize?: number;
    leverage?: number;
    availableBalance?: number;
  }
): AutoPilotValidationResult {
  const bypassHtfFilter = options?.bypassHtfFilter ?? false;
  const confidence = options?.confidence ?? 0;
  const isHighConfidence = confidence >= 75;
  const lotSize = options?.lotSize;
  const leverage = options?.leverage || 10;
  const availableBalance = options?.availableBalance;

  // Margin Requirement Check
  if (lotSize && lotSize > 0 && availableBalance !== undefined && availableBalance >= 0) {
    const mark = telemetry.markPrice > 0 ? telemetry.markPrice : 81702.50;
    const requiredMargin = (lotSize * mark) / leverage;
    if (requiredMargin > availableBalance && !bypassHtfFilter) {
      const marginDeficit = requiredMargin - availableBalance;
      return {
        canExecute: false,
        reason: `MARGIN DEFICIT: Required margin ($${requiredMargin.toFixed(2)}) exceeds available balance ($${availableBalance.toFixed(2)}). Use 'Auto-fit Lot to Max Margin' to safely size lot.`,
        safeguardActive: true,
        requiredMargin,
        availableBalance,
        marginDeficit,
      };
    }
  }

  // Guard 0: Downtrend Volatility Adaptation (Cascade Pause)
  if (telemetry.cascadePauseActive && !bypassHtfFilter) {
    return {
      canExecute: false,
      reason: 'CASCADE PAUSE: Market dropped > 1.0% in 15m. All auto-pilot entries gated until 3-bar consolidation.',
      safeguardActive: true,
    };
  }

  // Guard 1: Bar Close Execution Only
  if (!telemetry.isBarClosed && !bypassHtfFilter) {
    return {
      canExecute: false,
      reason: 'INTRA-CANDLE GATED: Must wait for confirmed 5m bar close to prevent knife-catching.',
      safeguardActive: false,
    };
  }

  // Guard 2: Down-Market Trend Lock (Catching Falling Knives)
  if (direction === 'LONG') {
    if (bypassHtfFilter) {
      return {
        canExecute: true,
        reason: 'PASS (OVERRIDE): HTF / VWAP Guard bypassed for Paper Demo.',
        safeguardActive: false,
        isBypassActive: true,
      };
    }

    if (telemetry.markPrice < telemetry.ema50_1h || telemetry.markPrice < telemetry.camarillaL3) {
      if (isHighConfidence) {
        return {
          canExecute: true,
          reason: 'ADVISORY WARNING: Price below 1H EMA50. High AI confidence (>=75%) allows conditional execution.',
          safeguardActive: false,
          isAdvisoryWarning: true,
        };
      }
      return {
        canExecute: false,
        reason: 'HTF TREND VETO: Downtrend active, long entries suppressed',
        safeguardActive: true,
      };
    }

    if (telemetry.markPrice < telemetry.vwap5m) {
      if (isHighConfidence) {
        return {
          canExecute: true,
          reason: 'ADVISORY WARNING: Sub-VWAP drift under high AI conviction. Execution conditional.',
          safeguardActive: false,
          isAdvisoryWarning: true,
        };
      }
      return {
        canExecute: false,
        reason: 'VWAP VETO: Price trading below Session VWAP. Sellers in control of volume.',
        safeguardActive: true,
      };
    }
  }

  // Guard 3: Up-Market Trend Lock (Shorting Bull Parabolic Moves)
  if (direction === 'SHORT') {
    if (bypassHtfFilter) {
      return {
        canExecute: true,
        reason: 'PASS (OVERRIDE): HTF / VWAP Guard bypassed for Paper Demo.',
        safeguardActive: false,
        isBypassActive: true,
      };
    }

    if (telemetry.markPrice > telemetry.ema50_1h || telemetry.markPrice > telemetry.vwap5m) {
      if (isHighConfidence) {
        return {
          canExecute: true,
          reason: 'ADVISORY WARNING: Price above 1H EMA50 / VWAP. High AI confidence (>=75%) allows conditional execution.',
          safeguardActive: false,
          isAdvisoryWarning: true,
        };
      }
      return {
        canExecute: false,
        reason: 'HTF TREND VETO: Price above 1H EMA50 and VWAP. Short entries prohibited.',
        safeguardActive: false,
      };
    }
  }

  return {
    canExecute: true,
    reason: 'REGIME VERIFIED: Signal aligns with macro trend, VWAP, and confirmed candle close.',
    safeguardActive: false,
  };
}
