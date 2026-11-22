import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { SniperLogEntry } from '../types';

export interface DispatchedAiSignal {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  action: 'BUY_LONG' | 'SELL_SHORT';
  convictionScore: number;
  totalMaxScore: number;
  confidencePct: number;
  grade: string;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  targetVehicle: 'Perpetual Futures' | 'Bull Call Spread' | 'Bear Put Spread';
  strategy: string;
  timestamp: number;
  source: 'AUTO_SCAN' | 'MANUAL_DISPATCH';
  riskGatesPassed: boolean;
  candleBucket: number;
  notes?: string;
}

export type DispatchedAiSignalPayload = Omit<DispatchedAiSignal, 'id' | 'timestamp' | 'candleBucket'>;

export interface DispatchResult {
  success: boolean;
  reason?: 'SUPPRESSED_COOLDOWN' | 'UNQUALIFIED' | 'DISPATCHED';
  remainingCooldownSec?: number;
  signal?: DispatchedAiSignal;
}

export interface TradingIntelligenceContextType {
  latestDispatchedSignal: DispatchedAiSignal | null;
  dispatchedHistory: DispatchedAiSignal[];
  isAutoDispatchEnabled: boolean;
  setIsAutoDispatchEnabled: (enabled: boolean) => void;
  dispatchSignal: (
    payload: DispatchedAiSignalPayload,
    onLogAudit?: (type: SniperLogEntry['type'], title: string, description: string) => void,
    onSendNotification?: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void
  ) => DispatchResult;
  getCooldownRemaining: (symbol: string, direction: 'LONG' | 'SHORT') => number;
  clearLatestDispatchedSignal: () => void;
  clearHistory: () => void;
}

const TradingIntelligenceContext = createContext<TradingIntelligenceContextType | null>(null);

const DUPLICATE_COOLDOWN_MS = 90 * 1000; // 90-second duplicate suppression cooldown

export const TradingIntelligenceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [latestDispatchedSignal, setLatestDispatchedSignal] = useState<DispatchedAiSignal | null>(null);
  const [dispatchedHistory, setDispatchedHistory] = useState<DispatchedAiSignal[]>([]);
  const [isAutoDispatchEnabled, setIsAutoDispatchEnabled] = useState<boolean>(false);

  // Tracks timestamp of last dispatched signal per symbol & direction
  const lastDispatchedMapRef = useRef<Record<string, number>>({});

  const getCooldownRemaining = useCallback((symbol: string, direction: 'LONG' | 'SHORT'): number => {
    const key = `${symbol}_${direction}`;
    const lastTs = lastDispatchedMapRef.current[key] || 0;
    const elapsed = Date.now() - lastTs;
    if (elapsed < DUPLICATE_COOLDOWN_MS) {
      return Math.max(0, Math.ceil((DUPLICATE_COOLDOWN_MS - elapsed) / 1000));
    }
    return 0;
  }, []);

  const dispatchSignal = useCallback(
    (
      payload: DispatchedAiSignalPayload,
      onLogAudit?: (type: SniperLogEntry['type'], title: string, description: string) => void,
      onSendNotification?: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void
    ): DispatchResult => {
      const now = Date.now();
      const key = `${payload.symbol}_${payload.direction}`;
      const lastTs = lastDispatchedMapRef.current[key] || 0;
      const elapsed = now - lastTs;

      // 90-second duplicate suppression cooldown check
      if (elapsed < DUPLICATE_COOLDOWN_MS) {
        const remainingSec = Math.ceil((DUPLICATE_COOLDOWN_MS - elapsed) / 1000);
        return {
          success: false,
          reason: 'SUPPRESSED_COOLDOWN',
          remainingCooldownSec: remainingSec,
        };
      }

      // Record dispatch timestamp
      lastDispatchedMapRef.current[key] = now;

      const candleBucket = Math.floor(now / (5 * 60 * 1000));
      const newSignal: DispatchedAiSignal = {
        ...payload,
        id: `dispatched-${payload.symbol}-${payload.direction}-${now}`,
        timestamp: now,
        candleBucket,
      };

      setLatestDispatchedSignal(newSignal);
      setDispatchedHistory((prev) => [newSignal, ...prev.slice(0, 49)]);

      // Real-Time Audit Log Entry
      const auditLogText = `AI CONDUIT: Automated signal dispatch to Trading Intelligence (Conviction: ${payload.confidencePct}%)`;
      if (onLogAudit) {
        onLogAudit(
          'CONDUIT',
          auditLogText,
          `${payload.direction} ${payload.symbol} | Vehicle: ${payload.targetVehicle} | Entry: $${payload.entryPrice.toLocaleString()} | SL: $${payload.stopLoss.toLocaleString()} | TP1: $${payload.tp1.toLocaleString()} | TP4: $${payload.tp4.toLocaleString()}`
        );
      }

      // Notification
      if (onSendNotification) {
        onSendNotification(
          'AI Conduit Signal Dispatched',
          `${payload.symbol} ${payload.direction} (Score: ${payload.convictionScore}/${payload.totalMaxScore} · ${payload.confidencePct}% · Grade ${payload.grade} ${payload.direction}). Target Vehicle: ${payload.targetVehicle}. Primed on Trading Intelligence Engine.`,
          'AI'
        );
      }

      return {
        success: true,
        reason: 'DISPATCHED',
        signal: newSignal,
      };
    },
    []
  );

  const clearLatestDispatchedSignal = useCallback(() => {
    setLatestDispatchedSignal(null);
  }, []);

  const clearHistory = useCallback(() => {
    setDispatchedHistory([]);
  }, []);

  return (
    <TradingIntelligenceContext.Provider
      value={{
        latestDispatchedSignal,
        dispatchedHistory,
        isAutoDispatchEnabled,
        setIsAutoDispatchEnabled,
        dispatchSignal,
        getCooldownRemaining,
        clearLatestDispatchedSignal,
        clearHistory,
      }}
    >
      {children}
    </TradingIntelligenceContext.Provider>
  );
};

export const useTradingIntelligence = (): TradingIntelligenceContextType => {
  const context = useContext(TradingIntelligenceContext);
  if (!context) {
    throw new Error('useTradingIntelligence must be used within a TradingIntelligenceProvider');
  }
  return context;
};
