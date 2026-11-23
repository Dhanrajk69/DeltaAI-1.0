import React from 'react';
import {
  MarketTicker,
  TradingMode,
  SniperSignal,
  SniperActiveTrade,
  SniperLogEntry,
  SniperExposureMode,
  SniperScalpTier,
  AiAnalysisResult,
  SniperExecutionTriggerMode,
  SniperStrategyMode,
} from '../types';
import { IntradaySniperEngine } from './IntradaySniperEngine';

export interface PendingLimitOrderDisplay {
  orderId?: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  limitPrice: number;
  lotSize: number;
  contracts: number;
  placedAtMs: number;
  expiresAtMs: number;
  mode: TradingMode;
}

export interface CamarillaSniperHubProps {
  markets: Record<string, MarketTicker>;
  selectedSymbol: string;
  setSelectedSymbol: (sym: string) => void;
  tradingMode: TradingMode;
  currentSignal: SniperSignal;
  activeTrade: SniperActiveTrade | null;
  isAutoSniperEnabled: boolean;
  setIsAutoSniperEnabled: (val: boolean) => void;
  isExecuting: boolean;
  tradeLogs: SniperLogEntry[];
  onExecuteSniperTrade: () => void;
  onCloseSniperTrade: (reason?: string) => void;
  onClearTradeLogs?: () => void;
  currencyPrefix?: string;
  exchangeRate?: number;
  packetGap?: number;
  directionMode?: 'AUTO' | 'LONG' | 'SHORT';
  setDirectionMode?: (mode: 'AUTO' | 'LONG' | 'SHORT') => void;
  exposureMode?: SniperExposureMode;
  setExposureMode?: (mode: SniperExposureMode) => void;
  scalpTier?: SniperScalpTier;
  setScalpTier?: (tier: SniperScalpTier) => void;
  aiAnalysis?: AiAnalysisResult | null;
  isAiLoading?: boolean;
  onRefreshAiAnalysis?: (symbol: string, timeframe: string) => Promise<void>;
  signalSource?: 'COMMAND_CENTER' | 'QUANT_ALGO';
  setSignalSource?: (source: 'COMMAND_CENTER' | 'QUANT_ALGO') => void;
  isLiveApiAuthenticated?: boolean;
  onOpenSettings?: () => void;
  isSignalStandby?: boolean;
  onConfirmSignal?: () => void;
  onRefreshSignal?: () => void;
  pairCooldowns?: Record<string, number>;
  consecutiveStopsCount?: number;
  simulate5mCandleClose?: (symbol: string, forcedClose?: number) => void;
  clearPairCooldown?: (symbol: string) => void;
  bypassHtfFilter?: boolean;
  setBypassHtfFilter?: (val: boolean) => void;
  executionTriggerMode?: SniperExecutionTriggerMode;
  setExecutionTriggerMode?: (mode: SniperExecutionTriggerMode) => void;
  cycleRealizedPnL?: number;
  harvestTargetHit?: boolean;
  cycleWindowRemaining?: string;
  isTransitionWindow?: boolean;
  manualLotSize?: number | null;
  setManualLotSize?: (lot: number | null) => void;
  pendingLimitOrder?: PendingLimitOrderDisplay | null;
  onCancelPendingLimitOrder?: () => void;
  sniperStrategyMode?: SniperStrategyMode;
  setSniperStrategyMode?: (mode: SniperStrategyMode) => void;
}

export const CamarillaSniperHub: React.FC<CamarillaSniperHubProps> = React.memo((props) => {
  return <IntradaySniperEngine {...props} />;
});

export default CamarillaSniperHub;
