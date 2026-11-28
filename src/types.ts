import type { UnifiedRegimeRouterResult, Ema921MomentumCrossResult } from './utils/aiMatrixEngine';

export type TradingMode = 'PAPER' | 'LIVE';

export interface DeltaApiCredentials {
  apiKey: string;
  apiSecret: string;
  environment: 'PROD' | 'TESTNET';
  isVerified: boolean;
  verifiedAt?: number;
}

export interface MarketTicker {
  symbol: string;
  name: string;
  markPrice: number;
  indexPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  fundingRate: number;
  nextFundingCountdown: string;
  openInterestContracts: number;
  openInterestUsd: number;
  liquidationsLong24h: number;
  liquidationsShort24h: number;
}

export interface Position {
  id: string;
  symbol: string;
  rawSymbol?: string;
  product_symbol?: string;
  product_id?: number;
  contract_type?: 'perpetual_futures' | 'call_options' | 'put_options' | string;
  side: 'LONG' | 'SHORT';
  size: number;
  signedSize?: number;
  contracts?: number;
  contractValue?: number;
  notionalUsd?: number;
  entryPrice: number;
  entry_price?: number;
  markPrice: number;
  mark_price?: number;
  liquidationPrice: number;
  leverage: number;
  margin: number;
  margin_inr?: number;
  unrealisedPnl: number;
  unrealized_pnl?: number;
  unrealized_pnl_inr?: number;
  unrealisedPnlPercent: number;
  realized_cashflow?: number;
  fees?: number;
  fees_and_cashflows_usd?: number;
  fees_and_cashflows_inr?: number;
  takeProfit?: number;
  stopLoss?: number;
  initialStop?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tp4?: number;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  tp4Hit?: boolean;
  feeBufferBe?: number;
  atr14?: number;
  stage1Executed?: boolean;
  stage2Executed?: boolean;
  stage3Executed?: boolean;
  openedAt: number;
  strategy: string;
  mode: TradingMode;
}

export type TradeSentimentTag =
  | 'DISCIPLINED'
  | 'SYSTEM_PLAY'
  | 'FOMO'
  | 'REVENGE'
  | 'EARLY_EXIT'
  | 'PERFECT_EXECUTION'
  | 'BULLISH'
  | 'BEARISH'
  | 'CHOPPY_EXIT';

export interface ClosedTrade {
  id: string;
  fillId?: string;
  orderId?: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  size: number;
  entryPrice: number;
  exitPrice: number;
  realisedPnl: number;
  pnlPercent: number;
  openedAt: number;
  closedAt: number;
  created_at?: string;
  commission?: number;
  contractType?: string;
  source?: 'DELTA_FILL' | 'LOCAL_EXECUTION' | 'PAPER_SIM';
  reason: string;
  mode?: TradingMode;
  notes?: string;
  sentimentTag?: TradeSentimentTag;
  tags?: string[];
  lessonLearned?: string;
  journalUpdatedAt?: number;
}

export interface RiskEvaluationResult {
  approved: boolean;
  rejectionReason?: string;
  gateFailed?: 'CIRCUIT_BREAKER' | 'REWARD_RISK' | 'CPR_CHOP' | 'INVALIDATION' | 'MARGIN';
  allowedLotSize: number; // strictly derived from 0.50% risk cap, rounded to 0.001 BTC lots
  maxDollarRisk: number; // e.g. $5.00 on $1,000 baseline
  riskRewardRatio: number; // e.g. 2.45
  invalidationDistance: number;
  riskPct: number; // 0.50%
}

export interface PositionAdjustment {
  id?: string;
  positionId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  stage: 1 | 2 | 3;
  type: 'HALF_RISK_CUSHION' | 'PROFIT_LOCK_RATCHET' | 'DYNAMIC_ATR_TRAIL' | 'RATCHET_BE' | 'TRAILING_ATR';
  action?: 'SCALE_PROFIT' | 'TRAIL_ATR';
  recommendedStopLoss: number;
  suggestedStop?: number;
  recommendedScalePct: number;
  currentMarkPrice: number;
  entryPrice: number;
  unrealizedPnlPct: number;
  rMultiple: number;
  reason: string;
  headline?: string;
  detail?: string;
  timestamp: number;
}

export interface MarketTelemetry {
  markPrice: number;
  vwap5m: number;
  ema50_1h: number;
  ema200_1h?: number;
  cprPivot: number;
  camarillaL3: number;
  isBarClosed: boolean;
  atr14?: number;
  cascadePauseActive?: boolean;
  consecutiveConsolidationBars?: number;
}

export interface BtcCorrelationMetric {
  symbol: string;
  coefficient: number; // -1.0 to 1.0
  status: 'COUPLED' | 'MODERATE' | 'DECOUPLED';
  isDecoupled: boolean;
  description: string;
  beta?: number;
}

export interface AiMatrixScore {
  total: number; // 0 - 180
  max: number; // 180
  grade: 'A+' | 'A' | 'B+' | 'B';
  direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  gradeWithDirection?: string; // e.g. "Grade A+ (BULLISH)" or "Grade A (BEARISH)"
  convictionPct: number; // e.g. 89%
  agents: {
    trend: number; // max 45
    smartMoney: number; // max 45
    options: number; // max 45
    risk: number; // max 45
  };
}

export interface MaSlopeData {
  symbol: string;
  slopePct: number; // e.g. +0.14 or -0.22 (% change in 15m MA)
  slopeFormatted: string; // e.g. "+0.14%" or "-0.22%"
  direction: 'UP' | 'DOWN' | 'FLAT';
  angleDeg: number; // e.g. +32 or -28
  confidencePct: number; // 0 - 100 trend certainty derived from slope velocity & consistency
  streakCandles: number; // Consecutive 15m candles the current trend direction has persisted
  maPeriod: number; // e.g. 20 (EMA 20 on 15m)
  currentMa: number;
  prevMa: number;
  timeframe: string; // '15m'
  signalAlignment: 'ALIGNED' | 'DIVERGENT' | 'NEUTRAL';
  contextNote: string;
  isLoading: boolean;
  updatedAt: number;
}

export interface CorrelatedSignal {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  matrixScore: AiMatrixScore;
  allowedLotSize: number;
  maxDollarRisk: number;
  invalidationDistance: number;
  frictionEst: number;
  riskRewardRatio: number;
  cprWidthPct: number;
  isApproved: boolean;
  gateFailed?: 'CIRCUIT_BREAKER' | 'REWARD_RISK' | 'CPR_CHOP' | 'INVALIDATION' | 'MARGIN';
  rejectionReason?: string;
  source: 'AI_MATRIX_CORRELATION';
  timestamp: number;
}

export interface LockedSignalSnapshot {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number; // Frozen at exact signal trigger timestamp
  stopLoss: number;   // Frozen SL
  tp1: number;        // Frozen TP1
  tp2: number;        // Frozen TP2
  tp3: number;        // Frozen TP3
  tp4: number;        // Frozen TP4
  convictionPct: number;
  timestamp: number;
}

export type SignalFreshnessStatus = 'FRESH' | 'AGING' | 'OVERDUE';

export interface SignalValidityState {
  status: SignalFreshnessStatus;
  ageMs: number;
  isExpiredByTime: boolean;
  isMissedEntryDrift: boolean;
  isTargetOrStopBreached: boolean;
  breachType?: 'TP1_COMPLETED' | 'TP4_COMPLETED' | 'SL_INVALIDATED' | null;
  cooldownRemainingSec?: number;
  cooldownReason?: 'SL' | 'TP1' | 'TP4' | null;
  driftPct: number;
  reason: string | null;
}

export interface PortfolioData {
  totalEquity: number;
  walletBalance?: number;
  availableBalance: number;
  availableMargin?: number;
  marginUsed: number;
  openPositionValueUsd?: number;
  initialCapital: number;
  dailyPnl: number;
  dailyPnlPercent: number;
  realisedPnlTotal: number;
  unrealisedPnlTotal: number;
  tradesToday: number;
  winRate: number;
  walletDiagnosticError?: {
    code: string;
    message: string;
    clientIp?: string;
    serverIpv4?: string;
    serverIpv6?: string;
    httpStatus?: number;
    timestamp: number;
  } | null;
}

export interface AiTradeCardData {
  symbol: string;
  action: 'BUY_LONG' | 'SELL_SHORT';
  entryZone: [number, number];
  stopLoss: number;
  tp1: number;
  tp2: number;
  riskRewardRatio: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  recommendedLeverage: number;
  strategy: string;
  lotSize?: number;
}

export interface AiAnalysisResult {
  sentiment: {
    bullishPercent: number;
    bearishPercent: number;
    summary: string;
  };
  confidenceScore: number;
  tradeCard: AiTradeCardData;
  multiAgentConsensus: {
    trendAgent: string;
    scalperAgent: string;
    riskAgent: string;
    sentimentAgent: string;
  };
  technicalHighlights: string[];
  fearGreedScore: number;
  fearGreedLabel: string;
}

export interface NewsHeadlineItem {
  id: string;
  title: string;
  source: string;
  link: string;
  publishedAt: string;
  timestamp: number;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number; // -100 to +100
  aiRationale: string;
}

export interface NewsSentimentRadarData {
  bullishScore: number; // 0 - 100
  bearishScore: number; // 0 - 100
  neutralScore: number; // 0 - 100
  aggregateScore: number; // -100 to +100
  overallSentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number; // 0 - 100
  macroCatalyst: string;
  keyThemes: string[];
  headlines: NewsHeadlineItem[];
  lastUpdated: number;
}

export type MarginMode = 'ISOLATED' | 'CROSS';
export type LotSizingMode = 'FIXED_LOT' | 'RISK_BASED';

export interface RiskSettings {
  maxDailyLossUsd: number;
  maxDailyLossPct?: number;
  maxRiskPerTradePct?: number;
  defaultLotSize?: number;
  defaultLeverage?: number;
  lotSizingMode?: LotSizingMode;
  maxTradesPerDay: number;
  maxPositionSizePercent: number;
  maxLeverage: number;
  globalLeverage?: number;
  maxLeverageCap?: number;
  marginMode?: MarginMode;
  leverageSyncLocked?: boolean;
  maxDrawdownPercent: number;
  killSwitchArmed: boolean;
  autoHedgeEnabled: boolean;
}

export type StrategyAutomationMode = 'MANUAL_ASSIST' | 'SEMI_AUTO' | 'FULLY_AUTO';

export interface StrategyConfig {
  id: string;
  name: string;
  category: 'FUTURES_SCALPING' | 'TREND_FOLLOWING' | 'OPTIONS';
  timeframe: string;
  active: boolean;
  mode: StrategyAutomationMode;
  indicators: string[];
  description: string;
  winRateHistorical: number;
  signalsToday: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema9?: number;
  ema20?: number;
  ema50?: number;
  vwap?: number;
}

export interface AppNotification {
  id: string;
  timestamp: number;
  title: string;
  message: string;
  type: 'INFO' | 'TRADE' | 'RISK' | 'AI';
  read: boolean;
}

// ═══════════════════════════════════════════════════════════
// INTRADAY SNIPER SCALPING ENGINE TYPES
// ═══════════════════════════════════════════════════════════

export type SniperConfidenceStatus = 'Ultra Strong' | 'Strong' | 'Moderate' | 'Weak' | 'No Trade' | 'Confluence Active';

export interface VirginCprZone {
  id: string;
  symbol: string;
  sessionDateUtc: string;
  sessionStartUtcMs: number;
  ageSessions: number;
  pivot: number;
  bc: number;
  tc: number;
  cprLow: number;
  cprHigh: number;
  width: number;
  widthPct: number;
  isVirgin: boolean;
  status: 'UNMITIGATED' | 'MITIGATED';
  mitigatedAtMs?: number;
  relation: 'ABOVE' | 'BELOW' | 'INSIDE';
  distancePct: number;
  distanceUsd: number;
}

export interface VirginCprConfluence {
  hasConfluence: boolean;
  hasWarning: boolean;
  convictionBoostPct: number;
  alignedZone?: VirginCprZone | null;
  blockingZone?: VirginCprZone | null;
  suggestedTpCap?: number;
  summary: string;
  warningMessage?: string;
}

export interface CamarillaLevels {
  pivot: number;
  tc?: number;
  bc?: number;
  cprWidth?: number;
  cprWidthRatio?: number;
  cprRegime?: 'NARROW' | 'AVERAGE' | 'WIDE';
  isWideCpr?: boolean;
  cpr5mWidthPct?: number;
  cpr4hWidthPct?: number;
  cpr5m?: {
    pivot: number;
    tc: number;
    bc: number;
    widthPct: number;
    isNarrow: boolean;
  };
  cpr4h?: {
    pivot: number;
    tc: number;
    bc: number;
    widthPct: number;
    isWide: boolean;
  };
  virginCprZones?: VirginCprZone[];
  nearestVirginCpr?: VirginCprZone | null;
  range: number;
  atr5m: number;
  atr14?: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  h5: number;
  h6: number;
  h7?: number;
  l1: number;
  l2: number;
  l3: number;
  l4: number;
  l5: number;
  l6: number;
  l7?: number;
}

export interface SniperValidationCriteria {
  higherTimeframeTrend: boolean;
  higherTimeframeTrendStatus?: 'PASS' | 'WARNING' | 'FAIL';
  vwapAlignment: boolean;
  vwapAlignmentStatus?: 'PASS' | 'WARNING' | 'FAIL';
  emaStructure: boolean;
  volumeConfirmation: boolean;
  rsiMomentum: boolean;
  marketSentiment: boolean;
  supportResistance: boolean;
  riskRewardThreshold: boolean;
  confidenceAboveMin: boolean;
  candleConfirmed?: boolean;
  cprFilterPassed?: boolean;
  htfDivergenceWarning?: boolean;
  bypassActive?: boolean;
  fibonacciConfluence?: boolean;
  fibonacciConfluenceStatus?: string;
  fibonacciConfluenceDesc?: string;
}

export interface SniperRiskChecks {
  signalValidationPassed: boolean;
  signalValidationStatus?: 'PASS' | 'PASS_OVERRIDE' | 'AWAITING_CANDLE' | 'WARNING' | 'FAIL';
  confidenceThresholdMet: boolean;
  positionSizeReceived: boolean;
  deltaLeverageAvailable: boolean;
  leverageWithinCap?: boolean;
  sufficientMargin: boolean;
  riskLimitsNotBreached: boolean;
  candleConfirmed?: boolean;
  cprFilterPassed?: boolean;
  cooldownPassed?: boolean;
  cprStatus?: string;
  tradeApproved: boolean;
  executionStatus?: 'TRADE APPROVED' | 'ARMED_CONDITIONAL' | 'STANDBY' | 'TRADE BLOCKED';
  bypassActive?: boolean;
  htfDivergenceWarning?: boolean;
  requiredMargin?: number;
  availableBalance?: number;
  marginDeficit?: number;
  autoClampedLot?: number;
  requestedLotSize?: number;
  contractsCount?: number;
  lotSizingMode?: LotSizingMode;
  wasLotClamped?: boolean;
  lotClampReason?: string;
  sizingMode?: string;
  cpr5mWidthPct?: number;
  cpr4hWidthPct?: number;
  isNarrow5mCpr?: boolean;
  isWide4hCpr?: boolean;
  narrowCprOverrideActive?: boolean;
  perpMicroSlotOccupied?: boolean;
  optionsSpreadSlotOccupied?: boolean;
  accountMarginUtilizationPct?: number;
  marginUtilizationSafe?: boolean;
  microTradesLastHour?: number;
  microAntiChopPassed?: boolean;
  microSlCooldownRemainingSec?: number;
  utcDayTradesCount?: number;
  maxUtcDayTrades?: number;
  postSlCooldownBarsRemaining?: number;
  regimeStatusLabel?: string;
}

export type SniperScalpTier = 'TIER_50' | 'TIER_15';
export type SniperExposureMode = 'MACRO' | 'MICRO_50' | 'MICRO_15';
export type SniperExecutionTriggerMode = 'IMMEDIATE_TOUCH' | 'CANDLE_CLOSE';
export type SniperStrategyMode = 'UNIFIED_MTF_PULLBACK' | 'EMA_9_21_MOMENTUM_5M';

export interface SniperFrictionData {
  entryNotional: number;
  exitNotional: number;
  totalRoundtripNotional: number;
  feeRate: number;
  takerFeeRate: number;
  makerFeeRate: number;
  feeRoundtripUsd: number;
  gstUsd: number;
  totalFeeWithGstUsd: number;
  slippageRate: number;
  slippageBps: number;
  slippageUsd: number;
  totalFrictionUsd: number;
  totalFrictionInr: number;
  pointDrag: number;
  netBreakevenPrice: number;
  telemetryChipText: string;
  chipUsdFormatted: string;
  chipInrFormatted: string;
}

export interface SniperLadderPayouts {
  tp1Payout: number;
  tp2Payout: number;
  tp3Payout: number;
  tp4Payout: number;
  tp1Gross?: number;
  tp1Net?: number;
  tp2Gross?: number;
  tp2Net?: number;
  tp3Gross?: number;
  tp3Net?: number;
  tp4Gross?: number;
  tp4Net?: number;
}

export interface SniperSignal {
  id?: string;
  symbol: string;
  signal: 'LONG' | 'SHORT';
  exposureMode?: SniperExposureMode;
  confidence: number;
  confidenceStatus: SniperConfidenceStatus;
  lotSize: number;
  requestedLotSize?: number;
  contractsCount?: number;
  lotSizingMode?: LotSizingMode;
  wasLotClamped?: boolean;
  lotClampReason?: string;
  leverage: number;
  entryPrice: number;
  initialStopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  camarilla: CamarillaLevels;
  isHydrated?: boolean;
  isStandby?: boolean;
  antiChaseBlocked?: boolean;
  l3h3ChopBlocked?: boolean;
  l3h3ChopReason?: string;
  virginCprMagnetBlocked?: boolean;
  validation: SniperValidationCriteria;
  riskChecks: SniperRiskChecks;
  aiVerdict: string;
  timestamp: number;
  signalSource?: 'COMMAND_CENTER' | 'QUANT_ALGO';
  commandCenterAgentConsensus?: {
    trendAgent: string;
    scalperAgent: string;
    riskAgent: string;
    sentimentAgent: string;
  };
  commandCenterCatalyst?: string;
  commandCenterSentiment?: {
    bullishPercent: number;
    bearishPercent: number;
    summary: string;
  };
  commandCenterFearGreed?: {
    score: number;
    label: string;
  };
  riskRewardRatio?: string;
  riskRewardNumeric?: number;
  estimatedMargin?: number;
  pointValue?: number;
  ladderPayouts?: SniperLadderPayouts;
  friction?: SniperFrictionData;
  scalpTier?: SniperScalpTier;
  frictionWarning?: string;
  fibonacci?: any;
  fibConfluence?: any;
  rangeSwingTrigger?: {
    tag: string;
    type: 'PDL_RECLAIM' | 'FIB_BOUNCE' | 'EQ_REJECTION' | 'PDL_BREAKDOWN';
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    description: string;
    isInsideRange: boolean;
  };
  ema9?: number;
  ema20?: number;
  ema21?: number;
  vwap5m?: number;
  virginCpr?: VirginCprConfluence;
  cpr5mWidthPct?: number;
  cpr4hWidthPct?: number;
  isNarrow5mCpr?: boolean;
  isWide4hCpr?: boolean;
  isNarrow5mCprAutoRouted?: boolean;
  regimeRouterMode?: 'DUAL_ACTIVE' | 'SNIPER_MICRO_15' | 'OPTIONS_IRON_CONDOR' | 'CAMARILLA_STANDARD' | 'STANDBY';
  microContractsCount?: number;
  microNotionalUsd?: number;
  microMarginUsd?: number;
  reason?: string;
  regimeRouter?: UnifiedRegimeRouterResult | null;
  regimeStatusLabel?: string;
  entryOrderType?: 'post_only_limit' | 'market';
  manualLotSizeOverride?: number | null;
  utcDayTradesCount?: number;
  postSlCooldownBarsRemaining?: number;
  feeAdjustedBePrice?: number;
  sniperStrategyMode?: SniperStrategyMode;
  ema921Cross?: Ema921MomentumCrossResult | null;
  partialTakeProfitPct?: number;
  trailBasis?: '5M_EMA21' | '15M_EMA20';
  setupScore16?: number;
  setupGrade?: 'A+' | 'A' | 'B' | 'NO_TRADE';
  activeSetupName?: string;
  activeSetupId?: string;
  hardNoTradeReasons?: string[];
  isHardNoTradeBlocked?: boolean;
  btcSniperResult?: any;
}

export type SniperTradeStatus = 
  | 'IDLE' 
  | 'SCANNING' 
  | 'ACTIVE' 
  | 'RISK-FREE' 
  | 'PROFIT_LOCKED' 
  | 'TRAILING_ACTIVE' 
  | 'BLOCKED' 
  | 'COMPLETED' 
  | 'STOPPED_OUT' 
  | 'REVERSED' 
  | 'TIME_EXIT';

export type SniperRiskStatus = 
  | 'INITIAL_RISK' 
  | 'RISK-FREE' 
  | 'PROFIT_LOCKED' 
  | 'TRAILING_ACTIVE' 
  | 'EXITED';

export type PerpetualRescueActionType =
  | 'DE_RISK_REANCHOR'
  | 'OPTIONS_HEDGE_OVERLAY'
  | 'TREND_FLIP_REVERSE';

export interface PerpetualRescueOptionQuote {
  symbol: string;
  productId?: number;
  optionType: 'CALL' | 'PUT';
  action: 'SELL';
  strike: number;
  expiryCode: string;
  settlementTime?: string;
  markPrice: number;
  contractValue: number;
  contracts: number;
  estimatedPremiumCreditUsd: number;
  delta?: number;
}

export interface PerpetualRescueAdjustmentRecord {
  tradeKey: string;
  tradeId: string;
  positionId?: string;
  symbol: string;
  canonicalSymbol: string;
  side: 'LONG' | 'SHORT';
  mode: TradingMode;
  adjustmentCount: number;
  action: PerpetualRescueActionType;
  originalEntryPrice: number;
  adjustedBreakEvenPrice: number;
  triggerRMultiple: number;
  unrealizedPnlAtTrigger: number;
  contractsMatched: number;
  equityRiskPct: number;
  executedAt: number;
  telegramSent: boolean;
  details: {
    reAnchorZoneLabel?: string;
    reAnchorPrice?: number;
    reAnchorOrderId?: string;
    deRiskClosedSize?: number;
    deRiskRealizedPnlUsd?: number;
    optionSymbol?: string;
    optionSide?: 'SELL';
    optionPremiumPerCoin?: number;
    optionCreditUsd?: number;
    optionOrderId?: string;
    flipDirection?: 'LONG' | 'SHORT';
    flipEntryPrice?: number;
    flipStopLoss?: number;
    flipOrderId?: string;
  };
}

export interface PerpetualRescueRecommendation {
  eligible: boolean;
  shouldSurface: boolean;
  isLocked: boolean;
  lockReason?: string;
  tradeKey: string;
  tradeId: string;
  positionId?: string;
  symbol: string;
  deltaSymbol: string;
  canonicalSymbol: string;
  side: 'LONG' | 'SHORT';
  mode: TradingMode;
  entryPrice: number;
  markPrice: number;
  stopLoss: number;
  lotSize: number;
  contracts: number;
  contractValue: number;
  unrealizedPnlUsd: number;
  unrealizedPnlInr: number;
  rMultiple: number;
  drawdownPctFromEntry: number;
  adjustmentCount: number;
  maxAdjustments: 1;
  adjustedBreakEvenPrice: number;
  equityRiskCapPct: 2;
  maxRiskAllowedUsd: number;
  projectedDeRiskReAnchor: {
    enabled: boolean;
    trend4hValid: boolean;
    trend4hReason: string;
    closeFraction: 0.5;
    closeSizeCoin: number;
    closeContracts: number;
    reAnchorContracts: number;
    reAnchorPrice: number;
    reAnchorZoneLabel: string;
    projectedAdjustedBe: number;
    immediatePostCloseBe: number;
    equityRiskPct: number;
    within2PctRisk: boolean;
  };
  projectedOptionsHedge: {
    enabled: boolean;
    optionType: 'CALL' | 'PUT';
    matchedContracts: number;
    matchedCoinSize: number;
    optionQuote: PerpetualRescueOptionQuote | null;
    projectedAdjustedBe: number;
    beImprovementUsdPerCoin: number;
    equityRiskPct: number;
    within2PctRisk: boolean;
    reason?: string;
  };
  projectedTrendFlip: {
    enabled: boolean;
    candleClosedBeyondOpposite: boolean;
    oppositeLevelLabel: 'H4' | 'L4';
    oppositeLevelPrice: number;
    closed5mClose: number;
    aiMatrixPct: number;
    aiMatrixMet: boolean;
    newDirection: 'LONG' | 'SHORT';
    newEntryPrice: number;
    newStopLoss: number;
    flipContracts: number;
    flipCoinSize: number;
    projectedAdjustedBe: number;
    equityRiskPct: number;
    within2PctRisk: boolean;
    reason: string;
  };
  executedRecord?: PerpetualRescueAdjustmentRecord | null;
}

export interface SniperActiveTrade {
  id: string;
  positionId?: string;
  symbol: string;
  signal: 'LONG' | 'SHORT';
  exposureMode?: SniperExposureMode;
  confidence: number;
  confidenceStatus: SniperConfidenceStatus;
  lotSize: number;
  remainingSize: number;
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  initialStopLoss: number;
  currentStopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  tp4: number;
  camarilla?: CamarillaLevels;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  tp4Hit: boolean;
  tradeStatus: SniperTradeStatus;
  riskStatus: SniperRiskStatus;
  trailingStopActive: boolean;
  trailingStopValue: number;
  trailingStage: 0 | 1 | 2 | 3;
  profitLocked: boolean;
  bookedProfitUsd: number;
  unrealisedProfitUsd: number;
  highestPriceReached: number;
  lowestPriceReached: number;
  openedAt: number;
  lastUpdatedAt: number;
  exitReason?: string;
  aiVerdict: string;
  mode?: TradingMode;
  friction?: SniperFrictionData;
  netBreakevenPrice?: number;
  scalpTier?: SniperScalpTier;
  beArmed?: boolean;
  status?: 'OPEN' | 'CLOSED';
  adoptedFromExchange?: boolean;
  unrealizedPnlUsd?: number;
  unrealizedPnlInr?: number;
  bracketWarning?: string;
  productSymbol?: string;
  adjustmentCount?: number;
  adjustedBreakEvenPrice?: number;
  rescueAdjustment?: PerpetualRescueAdjustmentRecord | null;
  entryOrderType?: 'post_only_limit' | 'market';
  isPendingLimit?: boolean;
  limitOrderId?: string | number;
  limitPlacedAtMs?: number;
  limitExpiresAfterBars?: number;
  feeAdjustedBePrice?: number;
  sniperStrategyMode?: SniperStrategyMode;
  partialTakeProfitPct?: number;
  trailBasis?: '5M_EMA21' | '15M_EMA20';
}

export interface SniperLogEntry {
  id: string;
  timestamp: number;
  type: 'ENTRY' | 'TP1' | 'TP2' | 'TP3' | 'TP4' | 'TRAILING' | 'STOP_LOSS' | 'REVERSAL' | 'TIME_EXIT' | 'BLOCKED' | 'EXECUTION' | 'AUTOPILOT' | 'CONDUIT' | 'SIGNAL' | 'HOURLY_GOAL' | 'EXIT_DEFENDED' | 'RESCUE' | 'POSITION_MISMATCH_DETECTED';
  title: string;
  description: string;
}

// ═══════════════════════════════════════════════════════════
// OPTIONS STRATEGY ENGINE TYPES
// ═══════════════════════════════════════════════════════════

export type OptionStrategyName = 
  | 'Long Call'
  | 'Long Put'
  | 'Bull Call Spread'
  | 'Bull Put Spread'
  | 'Bear Put Spread'
  | 'Bear Call Spread'
  | 'Covered Call'
  | 'Covered Put'
  | 'Short Straddle'
  | 'Short Strangle'
  | 'Long Straddle'
  | 'Long Strangle'
  | 'Iron Condor'
  | 'Iron Butterfly';

export type OptionStrategyCategory = 
  | 'DIRECTIONAL' 
  | 'INCOME' 
  | 'VOL_SELLING' 
  | 'VOL_BUYING' 
  | 'ADVANCED';

export interface OptionLeg {
  id: string;
  symbol?: string;
  productId?: number;
  orderId?: string | number | null;
  type: 'CALL' | 'PUT';
  action: 'BUY' | 'SELL';
  strike: number;
  expiry: string;
  dte: number;
  premiumEntry: number;
  premiumCurrent: number;
  takeProfitPremium?: number;
  stopLossPremium?: number;
  tpOrderId?: string | number | null;
  slOrderId?: string | number | null;
  tpSlStatus?: 'ARMED_EXCHANGE' | 'UNIFIED_BASKET' | 'STAGED' | 'TRIGGERED';
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  contracts: number;
  contractValue?: number;
  signedSizeBtc?: number;
  entryPremium?: number;
  markPremium?: number;
  pnlUsd?: number;
  unrealisedPnlUsd?: number;
  unrealisedPnlInr?: number;
  realizedCashflowUsd?: number;
  feesUsd?: number;
  feesAndCashflowsUsd?: number;
  pnlSource?: 'EXCHANGE_LIVE' | 'THEORETICAL';
  marginUsd?: number;
  expiryTimestampUtc?: number;
}

export interface OptionGreeksSummary {
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  averageIv: number;
  thetaStatus: 'Positive' | 'Neutral' | 'Negative';
  vegaStatus: 'Healthy' | 'Elevated' | 'High Risk';
}

export interface OptionStrategyPosition {
  id: string;
  strategyName: OptionStrategyName;
  category: OptionStrategyCategory;
  symbol: string;
  underlyingPrice: number;
  entryUnderlyingPrice: number;
  marketOutlook: string;
  volatilityOutlook: string;
  confidence: number;
  signalStrength: 'Ultra Strong' | 'Strong' | 'Moderate' | 'Weak';
  lotSize: number;
  leverage: number;
  marginMode?: MarginMode;
  maxProfitTargetPercent: number;
  currentProfitPercent: number;
  netPremiumCollectedOrPaid: number;
  unrealisedPnlUsd: number;
  totalFeesAndCashflowsUsd?: number;
  realisedPnlUsd: number;
  maxRiskUsd: number;
  maxProfitUsd: number;
  legs: OptionLeg[];
  greeks: OptionGreeksSummary;
  riskStatus: 'Normal' | 'Elevated' | 'Critical';
  marginStatus: 'Safe' | 'Moderate' | 'Danger';
  rollingRequired: boolean;
  rollingReason?: string;
  expiryStatus: 'Healthy' | 'Expiring Soon' | 'Expired';
  openedAt: number;
  expiryTimestampUtc?: number;
  status: 'ACTIVE' | 'ROLLED' | 'CLOSED_PROFIT' | 'CLOSED_RISK' | 'CLOSED_VOLATILITY' | 'CLOSED_INTELLIGENCE' | 'CLOSED_EXPIRY' | 'EXPIRED_SETTLED' | 'CLOSED_EXCHANGE_SYNC';
  exitMode?: 'UNIFIED_BASKET' | 'SINGLE_LEG_TP_SL';
  exitReason?: string;
  aiVerdict: string;
  netDebitPaidUsd?: number;
  preExpiryCloseHours?: number;
}

export interface OptionStrategyTemplate {
  name: OptionStrategyName;
  category: OptionStrategyCategory;
  marketOutlook: string;
  volatilityOutlook: string;
  profitSource: string;
  maxProfitRule: string;
  profitManagementSummary: string;
  defaultMaxProfitTarget: number;
  description: string;
}

export interface OptionRollingAction {
  type: 'ROLL_FORWARD' | 'ROLL_UP' | 'ROLL_DOWN';
  fromExpiry: string;
  toExpiry: string;
  fromStrikes: number[];
  toStrikes: number[];
  netCreditOrDebit: number;
  reason: string;
}

export interface OptionAuditLog {
  id: string;
  timestamp: number;
  type: 'EXECUTION' | 'GREEKS_ADAPT' | 'PROFIT_LOCK' | 'ROLL' | 'RISK_TRIGGER' | 'EXIT';
  title: string;
  description: string;
}

export interface BacktestTradeOverlay {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  entryTimestamp: number;
  initialStop: number;
  stage1Price?: number;
  cushionStop?: number;
  stage2Price?: number;
  profitStop?: number;
  exitPrice: number;
  exitTimestamp: number;
  exitReason: string;
  realisedPnlUsd: number;
  realisedR: number;
  status: 'WIN' | 'LOSS' | 'SCRATCH_SAVED';
}

// ═══════════════════════════════════════════════════════════
// TELEMETRY STREAM NORMALIZATION & VALIDATION TYPES
// ═══════════════════════════════════════════════════════════

export type TelemetrySourceProvider =
  | 'TRADINGVIEW_WEBHOOK'
  | 'DELTA_EXCHANGE'
  | 'BINANCE_SPOT'
  | 'BINANCE_FUTURES'
  | 'BYBIT'
  | 'CUSTOM_JSON';

export type TelemetryTimeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D';

export type TelemetrySignalAction = 'LONG' | 'SHORT' | 'NEUTRAL' | 'EXIT';

export type TelemetryValidationStatus = 'APPROVED' | 'WARN_CAUTION' | 'REJECTED';

export type TelemetryVolatilityRegime = 'COMPRESSED' | 'NORMAL' | 'ELEVATED' | 'EXTREME';

export interface TelemetryHistoricalCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface NormalizedTelemetryIndicators {
  candleCount: number;
  latestClose: number;
  ema9: number;
  ema20: number;
  ema50: number;
  sma20: number;
  sma50: number;
  vwap: number;
  atr14: number;
  atrPct: number;
  bollingerUpper: number;
  bollingerMid: number;
  bollingerLower: number;
  bollingerWidthPct: number;
  zScore: number;
  realizedVolPct: number;
}

export interface NormalizedTelemetryValidation {
  status: TelemetryValidationStatus;
  validForOutput: boolean;
  score: number;
  maAlignment: {
    aligned: boolean;
    ema9VsEma20: 'BULLISH' | 'BEARISH' | 'FLAT';
    priceVsSma20Pct: number;
    priceVsEma50Pct: number;
    extensionAtrRatio: number;
    reason: string;
  };
  volatilityCheck: {
    passed: boolean;
    regime: TelemetryVolatilityRegime;
    atr14: number;
    atrPct: number;
    bollingerWidthPct: number;
    zScore: number;
    candleRangeToAtrRatio: number;
    spreadBps?: number;
    reason: string;
  };
  priceDeviationCheck: {
    passed: boolean;
    deviationPct: number;
    reason: string;
  };
  reasons: string[];
}

export interface NormalizedTelemetryEnvelope {
  schemaVersion: '1.0';
  telemetryId: string;
  receivedAtIso: string;
  receivedAtMs: number;
  eventTimestampIso: string;
  eventTimestampMs: number;
  source: {
    provider: TelemetrySourceProvider;
    rawSymbol: string;
    assetClass: 'PERPETUAL' | 'SPOT' | 'OPTION' | 'UNKNOWN';
    channel?: string;
    exchangeLabel?: string;
  };
  instrument: {
    canonicalSymbol: string;
    deltaSymbol: string;
    baseAsset: string;
    quoteAsset: string;
  };
  marketData: {
    price: number;
    open?: number;
    high?: number;
    low?: number;
    bid?: number;
    ask?: number;
    spreadBps?: number;
    high24h?: number;
    low24h?: number;
    volume?: number;
    openInterest?: number;
    fundingRate?: number;
    change24hPct?: number;
    timeframe: TelemetryTimeframe;
  };
  signal: {
    present: boolean;
    action: TelemetrySignalAction;
    strategy?: string;
    entryPrice: number;
    stopLoss?: number;
    takeProfit?: number;
    contracts?: number;
    confidenceInput?: number;
  };
  indicators: NormalizedTelemetryIndicators;
  validation: NormalizedTelemetryValidation;
  rawPayloadHash: string;
}

export interface TelemetryIngestionResult {
  accepted: boolean;
  quarantined: boolean;
  telemetry: NormalizedTelemetryEnvelope | null;
  diagnostic: NormalizedTelemetryEnvelope;
}

// ═══════════════════════════════════════════════════════════
// SENTIMENT TREND & PRE-ALERT VOLATILITY VALIDATION TYPES
// ═══════════════════════════════════════════════════════════

export type SentimentPolarity =
  | 'STRONGLY_BULLISH'
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'STRONGLY_BEARISH';

export type SentimentTrendDirection =
  | 'IMPROVING'
  | 'STABLE'
  | 'DETERIORATING'
  | 'REVERSING_UP'
  | 'REVERSING_DOWN';

export type PreAlertDecision =
  | 'ALLOW_HIGH_PRIORITY'
  | 'ALLOW_SILENT_CAUTION'
  | 'BLOCK_ALERT';

export interface SentimentHistoryPoint {
  timestampMs: number;
  score: number;
  price: number;
}

export interface MarketSentimentTrendAnalysis {
  symbol: string;
  compositeScore: number; // -100 to +100
  polarity: SentimentPolarity;
  trendDirection: SentimentTrendDirection;
  trendDelta: number; // change vs rolling mean
  rollingMeanScore: number;
  sampleCount: number;
  signalAlignment: 'ALIGNED' | 'NEUTRAL' | 'DIVERGENT';
  components: {
    momentumScore: number; // -100 to +100
    maStructureScore: number; // -100 to +100
    derivativesScore: number; // -100 to +100 (funding + liquidations)
    newsScore: number; // -100 to +100
  };
  summary: string;
}

export interface HistoricalVolatilityValidation {
  passed: boolean;
  regime: TelemetryVolatilityRegime;
  currentAtr14: number;
  currentAtrPct: number;
  baselineAtrPct: number;
  atrExpansionRatio: number;
  historicalVolPercentile: number; // 0 to 100
  bollingerWidthPct: number;
  zScore: number;
  stopDistanceAtrRatio?: number;
  riskRewardRatio?: number;
  reasons: string[];
}

export interface PreAlertEvaluationResult {
  evaluationId: string;
  evaluatedAtIso: string;
  evaluatedAtMs: number;
  symbol: string;
  deltaSymbol: string;
  timeframe: TelemetryTimeframe;
  signalAction: TelemetrySignalAction;
  price: number;
  decision: PreAlertDecision;
  shouldAlert: boolean;
  alertPriority: 'high' | 'low' | 'none';
  disableNotification: boolean;
  confidenceScore: number;
  sentiment: MarketSentimentTrendAnalysis;
  volatility: HistoricalVolatilityValidation;
  reasons: string[];
  telemetry: NormalizedTelemetryEnvelope;
  alertDispatchResult?: {
    attempted: boolean;
    dispatched: boolean;
    skipped?: boolean;
    reason?: string;
    priority?: string;
  };
}





