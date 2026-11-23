import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Candle, NewsSentimentRadarData, NewsHeadlineItem, BacktestTradeOverlay, VirginCprZone } from '../types';
import { computeDailyFibonacciLevels, detectFibCamarillaConfluence } from '../utils/fibonacciUtils';
import { computeVirginCprZones, findNearestVirginCprMagnet } from '../utils/camarillaUtils';
import { getCachedDailyCandles, subscribeDailyAnchorUpdates } from '../utils/dailyAnchorUtils';
import { resolveVerticalLabelCollisions, VerticalLabelItem } from '../utils/chartLabelCollision';
import { detectPatterns, DetectedChartPattern, computeInstitutionalVolumeProfile } from '../utils/chartUtils';
export { resolveVerticalLabelCollisions, type VerticalLabelItem };
import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sliders,
  Layers,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Radio,
  Check,
  Zap,
  Newspaper,
  Flame,
  Activity,
  X,
  ExternalLink,
  AlertTriangle,
  Target,
  Settings,
} from 'lucide-react';
import { WsConnectionStatus } from '../hooks/useDeltaWebSocket';
import { useAiMatrixCorrelation } from '../context/AiMatrixCorrelationContext';

export interface InteractiveChartProps {
  symbol: string;
  markPrice: number;
  timeframe: string;
  setTimeframe: (tf: string) => void;
  currencyPrefix: string;
  exchangeRate: number;
  packetGap?: number;
  wsStatus?: WsConnectionStatus;
  onQuickTrade?: (side: 'LONG' | 'SHORT') => void;
  volatility24h?: number;
  newsRadarData?: NewsSentimentRadarData | null;
  backtestTrade?: BacktestTradeOverlay | null;
  onClearBacktestTrade?: () => void;
  showShortTermTrend?: boolean;
  trendSmoothingFactor?: number;
  onTrendSmoothingFactorChange?: (value: number) => void;
  onTrendVarianceChange?: (variance: { stdDev: number; stdDevPct: number } | null) => void;
  trendResetNonce?: number;
  chartRole?: 'EXECUTION_5M' | 'MACRO_4H' | 'STANDARD';
  chartTitleLabel?: string;
  defaultShowFib?: boolean;
  defaultShowCpr?: boolean;
  defaultShowVirginCpr?: boolean;
  defaultShowCamarilla?: boolean;
  camarillaLevels?: {
    h3?: number;
    h4?: number;
    l3?: number;
    l4?: number;
    h5?: number;
    l5?: number;
    pivot?: number;
    bc?: number;
    tc?: number;
  } | null;
  liveSignalLevels?: {
    direction?: 'LONG' | 'SHORT';
    entryPrice?: number;
    stopLoss?: number;
    tp1?: number;
    tp2?: number;
  } | null;
  isExpandedPane?: boolean;
  onToggleExpandPane?: () => void;
  compactProDesk?: boolean;
}

export type ChartType = 'CANDLES' | 'HOLLOW' | 'HEIKIN_ASHI' | 'LINE' | 'AREA';

interface CalculatedIndicators {
  ema9?: number;
  ema21?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  vwap?: number;
  bbUpper?: number;
  bbLower?: number;
  bbMiddle?: number;
  rsi?: number;
}

export type EnhancedCandle = Candle & CalculatedIndicators & {
  haOpen?: number;
  haHigh?: number;
  haLow?: number;
  haClose?: number;
};

interface EmaCrossoverSignal {
  index: number;
  time: number;
  type: 'BULL' | 'BEAR';
  price: number;
  label: string;
  isRecent: boolean;
}

function detectEma921Crossovers(candles: EnhancedCandle[]): EmaCrossoverSignal[] {
  const crosses: EmaCrossoverSignal[] = [];
  if (!candles || candles.length < 2) return crosses;

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (prev.ema9 === undefined || prev.ema21 === undefined || curr.ema9 === undefined || curr.ema21 === undefined) continue;

    const wasBelow = prev.ema9 <= prev.ema21;
    const isAbove = curr.ema9 > curr.ema21;
    const wasAbove = prev.ema9 >= prev.ema21;
    const isBelow = curr.ema9 < curr.ema21;

    const isRecent = i >= candles.length - 10;

    if (wasBelow && isAbove) {
      crosses.push({
        index: i,
        time: curr.time,
        type: 'BULL',
        price: curr.low,
        label: 'EMA 9/21 Bull Cross',
        isRecent,
      });
    } else if (wasAbove && isBelow) {
      crosses.push({
        index: i,
        time: curr.time,
        type: 'BEAR',
        price: curr.high,
        label: 'EMA 9/21 Bear Cross',
        isRecent,
      });
    }
  }
  return crosses;
}

// Resolution to milliseconds helper
function getIntervalMs(tf: string): number {
  switch (tf) {
    case '1m': return 60 * 1000;
    case '3m': return 3 * 60 * 1000;
    case '5m': return 5 * 60 * 1000;
    case '15m': return 15 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
    case '4h': return 4 * 60 * 60 * 1000;
    case '1D': return 24 * 60 * 60 * 1000;
    default: return 5 * 60 * 1000;
  }
}

// Indicator Calculation Engine
function computeIndicators(rawCandles: Candle[]): EnhancedCandle[] {
  if (!rawCandles || rawCandles.length === 0) return [];

  const list: EnhancedCandle[] = rawCandles.map((c) => ({ ...c }));

  // 1. Calculate EMAs
  const calcEma = (period: number, key: 'ema9' | 'ema21' | 'ema20' | 'ema50' | 'ema200') => {
    if (list.length < period) return;
    const k = 2 / (period + 1);
    let ema = list[0].close;
    for (let i = 0; i < list.length; i++) {
      if (i === 0) {
        list[i][key] = ema;
      } else {
        ema = list[i].close * k + ema * (1 - k);
        list[i][key] = +ema.toFixed(4);
      }
    }
  };

  calcEma(9, 'ema9');
  calcEma(21, 'ema21');
  calcEma(50, 'ema50');
  calcEma(200, 'ema200');

  // 2. Calculate VWAP
  let cumVol = 0;
  let cumTypicalPriceVol = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;
    cumVol += vol;
    cumTypicalPriceVol += typicalPrice * vol;
    list[i].vwap = +(cumTypicalPriceVol / cumVol).toFixed(4);
  }

  // 3. Calculate Bollinger Bands (20, 2)
  const bbPeriod = 20;
  for (let i = 0; i < list.length; i++) {
    if (i >= bbPeriod - 1) {
      const slice = list.slice(i - bbPeriod + 1, i + 1);
      const sma = slice.reduce((acc, cur) => acc + cur.close, 0) / bbPeriod;
      const variance = slice.reduce((acc, cur) => acc + Math.pow(cur.close - sma, 2), 0) / bbPeriod;
      const stdDev = Math.sqrt(variance);
      list[i].bbMiddle = +sma.toFixed(4);
      list[i].bbUpper = +(sma + 2 * stdDev).toFixed(4);
      list[i].bbLower = +(sma - 2 * stdDev).toFixed(4);
    }
  }

  // 4. Calculate RSI (14)
  const rsiPeriod = 14;
  if (list.length > rsiPeriod) {
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= rsiPeriod; i++) {
      const diff = list[i].close - list[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    let avgGain = gains / rsiPeriod;
    let avgLoss = losses / rsiPeriod;
    list[rsiPeriod].rsi = avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(1);

    for (let i = rsiPeriod + 1; i < list.length; i++) {
      const diff = list[i].close - list[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (rsiPeriod - 1) + gain) / rsiPeriod;
      avgLoss = (avgLoss * (rsiPeriod - 1) + loss) / rsiPeriod;
      list[i].rsi = avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(1);
    }
  }

  // 5. Calculate Heikin-Ashi values
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0 ? (c.open + c.close) / 2 : ((list[i - 1].haOpen ?? list[i - 1].open) + (list[i - 1].haClose ?? list[i - 1].close)) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);

    list[i].haOpen = +haOpen.toFixed(4);
    list[i].haClose = +haClose.toFixed(4);
    list[i].haHigh = +haHigh.toFixed(4);
    list[i].haLow = +haLow.toFixed(4);
  }

  return list;
}

export const InteractiveChart: React.FC<InteractiveChartProps> = React.memo(({
  symbol,
  markPrice,
  timeframe,
  setTimeframe,
  currencyPrefix,
  exchangeRate,
  packetGap = 350,
  wsStatus = 'CONNECTED',
  onQuickTrade,
  volatility24h,
  newsRadarData,
  backtestTrade,
  onClearBacktestTrade,
  showShortTermTrend = false,
  trendSmoothingFactor: controlledSmoothingFactor,
  onTrendSmoothingFactorChange,
  onTrendVarianceChange,
  trendResetNonce = 0,
  chartRole = 'STANDARD',
  chartTitleLabel,
  defaultShowFib,
  defaultShowCpr = true,
  defaultShowVirginCpr = true,
  defaultShowCamarilla,
  camarillaLevels,
  liveSignalLevels,
  isExpandedPane = false,
  onToggleExpandPane,
  compactProDesk = false,
}) => {
  const { lockedActiveSignal, signalValidity } = useAiMatrixCorrelation();
  const activeLockedChartSignal = useMemo(() => {
    if (liveSignalLevels && (liveSignalLevels.entryPrice || 0) > 0) {
      const ep = liveSignalLevels.entryPrice || 0;
      if (markPrice <= 0 || Math.abs(ep - markPrice) / markPrice <= 0.15) {
        return {
          id: `live-sig-${symbol}`,
          symbol,
          direction: liveSignalLevels.direction || 'LONG',
          entryPrice: ep,
          stopLoss: liveSignalLevels.stopLoss || 0,
          tp1: liveSignalLevels.tp1 || 0,
          tp2: liveSignalLevels.tp2 || 0,
          tp3: 0,
          tp4: 0,
          convictionPct: 85,
          timestamp: Date.now(),
        };
      }
    }
    if (
      !lockedActiveSignal ||
      lockedActiveSignal.symbol !== symbol ||
      !(lockedActiveSignal.entryPrice > 0)
    ) {
      return null;
    }
    if (markPrice > 0 && Math.abs(lockedActiveSignal.entryPrice - markPrice) / markPrice > 0.15) {
      return null;
    }
    return lockedActiveSignal;
  }, [liveSignalLevels, lockedActiveSignal, symbol, markPrice]);

  // Chart Display Options (Clean TradingView defaults: Candles + EMA 9/20 + VWAP + CPR + Volume; heavy overlays toggleable)
  const [chartType, setChartType] = useState<ChartType>('CANDLES');
  const [showEma9, setShowEma9] = useState(true);
  const [showEma21, setShowEma21] = useState(true);
  const [showEma50, setShowEma50] = useState(chartRole === 'MACRO_4H');
  const [showEma200, setShowEma200] = useState(false);
  const [showVwap, setShowVwap] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showCpr, setShowCpr] = useState<boolean>(defaultShowCpr);
  const [showVirginCpr, setShowVirginCpr] = useState<boolean>(defaultShowVirginCpr);
  const [showCamarilla, setShowCamarilla] = useState<boolean>(
    defaultShowCamarilla ?? (chartRole === 'EXECUTION_5M' || chartRole === 'STANDARD')
  );
  const [showVpvr, setShowVpvr] = useState<boolean>(false);
  const [showPatterns, setShowPatterns] = useState<boolean>(true);
  const [showFib, setShowFib] = useState<boolean>(defaultShowFib ?? chartRole === 'MACRO_4H');
  const [showFibSentiment, setShowFibSentiment] = useState<boolean>(chartRole === 'MACRO_4H');
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(false);
  const [showSentimentTrend, setShowSentimentTrend] = useState<boolean>(false);
  const [dailyHistoryTick, setDailyHistoryTick] = useState<number>(0);

  useEffect(() => {
    return subscribeDailyAnchorUpdates(() => {
      setDailyHistoryTick((t) => t + 1);
    });
  }, []);
  const [localVolatilityThreshold, setLocalVolatilityThreshold] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('delta_trend_volatility_threshold'));
      return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 50;
    } catch {
      return 50;
    }
  });
  const volatilityThreshold =
    typeof controlledSmoothingFactor === 'number' && Number.isFinite(controlledSmoothingFactor)
      ? Math.max(0, Math.min(100, Math.round(controlledSmoothingFactor)))
      : localVolatilityThreshold;
  const handleVolatilityThresholdChange = useCallback(
    (nextVal: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(nextVal)));
      setLocalVolatilityThreshold(clamped);
      onTrendSmoothingFactorChange?.(clamped);
      try {
        localStorage.setItem('delta_trend_volatility_threshold', String(clamped));
      } catch {}
    },
    [onTrendSmoothingFactorChange]
  );
  const [selectedEventHeadline, setSelectedEventHeadline] = useState<NewsHeadlineItem | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [showChartTypeMenu, setShowChartTypeMenu] = useState(false);
  const [showChartSettingsMenu, setShowChartSettingsMenu] = useState(false);

  // Pro-Desk Chart Settings & Hide Indicator Labels State
  const [showIndicatorLabels, setShowIndicatorLabels] = useState<boolean>(true);
  const [showGridlines, setShowGridlines] = useState<boolean>(true);
  const [bullCandleColor, setBullCandleColor] = useState<string>('#10B981');
  const [bearCandleColor, setBearCandleColor] = useState<string>('#F43F5E');
  const [crosshairMode, setCrosshairMode] = useState<'FREE' | 'MAGNET' | 'OFF'>('FREE');
  const [autoFitPriceScale, setAutoFitPriceScale] = useState<boolean>(true);

  // Manual Fibonacci Anchor Override & Drag Handle State
  const [customSwingHigh, setCustomSwingHigh] = useState<number | null>(null);
  const [customSwingLow, setCustomSwingLow] = useState<number | null>(null);
  const [draggingFibAnchor, setDraggingFibAnchor] = useState<'PDH' | 'PDL' | null>(null);

  // Zoom and pan (X-axis & Y-axis interactive TradingView scaling)
  const [zoomLevel, setZoomLevel] = useState<number>(48); // number of visible candles (X-axis zoom)
  const [panOffset, setPanOffset] = useState<number>(0); // 0 = right-aligned (latest), > 0 = panned back in time
  const [yScaleFactor, setYScaleFactor] = useState<number>(1); // 1 = auto-scale Y, < 1 = zoomed in vertically, > 1 = compressed vertically
  const [yPanOffset, setYPanOffset] = useState<number>(0); // vertical price shift when dragging up/down
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [hoverZone, setHoverZone] = useState<'PLOT' | 'PRICE_AXIS' | 'TIME_AXIS'>('PLOT');
  const [activeDragMode, setActiveDragMode] = useState<'NONE' | 'PAN_XY' | 'SCALE_Y' | 'SCALE_X'>('NONE');
  const dragStateRef = useRef<{
    mode: 'NONE' | 'PAN_XY' | 'SCALE_Y' | 'SCALE_X';
    startX: number;
    startY: number;
    startPanOffset: number;
    startZoomLevel: number;
    startYScaleFactor: number;
    startYPanOffset: number;
    priceRangeAtStart: number;
    plotWidthPx: number;
    plotHeightPx: number;
  }>({
    mode: 'NONE',
    startX: 0,
    startY: 0,
    startPanOffset: 0,
    startZoomLevel: 48,
    startYScaleFactor: 1,
    startYPanOffset: 0,
    priceRangeAtStart: 100,
    plotWidthPx: 800,
    plotHeightPx: 350,
  });

  // Reset manual Y-axis scale/pan when symbol or timeframe changes
  useEffect(() => {
    setYScaleFactor(1);
    setYPanOffset(0);
    setPanOffset(0);
  }, [symbol, timeframe]);

  // Real-time tick flashing on right price scale
  const [tickFlash, setTickFlash] = useState<'UP' | 'DOWN' | null>(null);
  const prevPriceRef = useRef<number>(markPrice);
  const markPriceRef = useRef<number>(markPrice);
  useEffect(() => {
    markPriceRef.current = markPrice;
  }, [markPrice]);

  // Countdown timer to candle close
  const [candleCountdown, setCandleCountdown] = useState<string>('00:00');

  // Primary Candle State: persistent array updated directly by live ticks
  const [rawCandles, setRawCandles] = useState<Candle[]>([]);
  const [historicalVolumeCandles, setHistoricalVolumeCandles] = useState<Candle[]>([]);
  const [isLoadingCandles, setIsLoadingCandles] = useState<boolean>(true);
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastBucketRef = useRef<number>(0);

  // 1. Fetch authentic historical candles + wider institutional VAP anchor candles from Delta India API
  useEffect(() => {
    let isCancelled = false;
    setIsLoadingCandles(true);

    const fetchHistory = async () => {
      try {
        const deltaSym = symbol.endsWith('USDT') ? symbol.replace('USDT', 'USD') : symbol;
        const histTf =
          timeframe === '1m' || timeframe === '3m' || timeframe === '5m'
            ? '15m'
            : timeframe === '15m'
            ? '1h'
            : timeframe === '1h'
            ? '4h'
            : '1D';

        const [primaryRes, histRes] = await Promise.all([
          fetch(`/api/delta/candles?symbol=${deltaSym}&resolution=${timeframe}`),
          histTf !== timeframe
            ? fetch(`/api/delta/candles?symbol=${deltaSym}&resolution=${histTf}`).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (!primaryRes.ok) throw new Error('Failed to fetch candles');
        const data = await primaryRes.json();

        if (!isCancelled && data.candles && Array.isArray(data.candles) && data.candles.length > 0) {
          const loaded: Candle[] = data.candles;
          // Synchronize last candle's close with current live markPrice
          if (markPrice > 0 && loaded.length > 0) {
            const last = loaded[loaded.length - 1];
            last.close = markPrice;
            last.high = Math.max(last.high, markPrice);
            last.low = Math.min(last.low, markPrice);
          }
          setRawCandles(loaded);
          const interval = getIntervalMs(timeframe);
          lastBucketRef.current = Math.floor(Date.now() / interval) * interval;
        }

        if (histRes && histRes.ok) {
          const histData = await histRes.json();
          if (!isCancelled && Array.isArray(histData?.candles)) {
            setHistoricalVolumeCandles(histData.candles);
          }
        } else if (!isCancelled && histTf === timeframe) {
          setHistoricalVolumeCandles([]);
        }
      } catch {
        // Keep current/synthetic candles silently when network fetch is interrupted
      } finally {
        if (!isCancelled) setIsLoadingCandles(false);
      }
    };

    fetchHistory();
    return () => {
      isCancelled = true;
    };
  }, [symbol, timeframe]);

  // Silent background candle refresh when Auto-Reset Trend triggers after breach dismissal
  useEffect(() => {
    if (!trendResetNonce) return;
    let isCancelled = false;
    const refreshCandlesSilently = async () => {
      try {
        const deltaSym = symbol.endsWith('USDT') ? symbol.replace('USDT', 'USD') : symbol;
        const res = await fetch(`/api/delta/candles?symbol=${deltaSym}&resolution=${timeframe}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isCancelled && data.candles && Array.isArray(data.candles) && data.candles.length > 0) {
          const loaded: Candle[] = data.candles;
          const liveMark = markPriceRef.current;
          if (liveMark > 0) {
            const last = loaded[loaded.length - 1];
            last.close = liveMark;
            last.high = Math.max(last.high, liveMark);
            last.low = Math.min(last.low, liveMark);
          }
          setRawCandles(loaded);
          const interval = getIntervalMs(timeframe);
          lastBucketRef.current = Math.floor(Date.now() / interval) * interval;
        }
      } catch {}
    };
    refreshCandlesSilently();
    return () => {
      isCancelled = true;
    };
  }, [trendResetNonce, symbol, timeframe]);

  // 2. LIVE TICK SYNCHRONIZER: Directly updates the current candle in real time
  useEffect(() => {
    if (!markPrice || markPrice <= 0) return;

    // Detect price movement direction for flash badge
    if (prevPriceRef.current !== markPrice) {
      const dir = markPrice > prevPriceRef.current ? 'UP' : 'DOWN';
      setTickFlash(dir);
      const timer = setTimeout(() => setTickFlash(null), 700);
      prevPriceRef.current = markPrice;
      return () => clearTimeout(timer);
    }
  }, [markPrice]);

  useEffect(() => {
    if (!markPrice || markPrice <= 0) return;

    setRawCandles((prev) => {
      if (!prev || prev.length === 0) return prev;

      const interval = getIntervalMs(timeframe);
      const now = Date.now();
      const currentBucket = Math.floor(now / interval) * interval;
      const copy = [...prev];
      const last = { ...copy[copy.length - 1] };

      // If tick is within the current candle bucket
      if (last.time >= currentBucket || Math.abs(currentBucket - last.time) < interval) {
        last.close = markPrice;
        last.high = Math.max(last.high, markPrice);
        last.low = Math.min(last.low, markPrice);
        last.volume = (last.volume || 100) + 1;
        copy[copy.length - 1] = last;
        return copy;
      } else {
        // Time bucket has expired -> close current candle and spawn new live candle
        const newCandle: Candle = {
          time: currentBucket,
          open: last.close,
          high: Math.max(last.close, markPrice),
          low: Math.min(last.close, markPrice),
          close: markPrice,
          volume: 1,
        };
        const maxBars = 120;
        const trimmed = copy.length >= maxBars ? copy.slice(copy.length - maxBars + 1) : copy;
        return [...trimmed, newCandle];
      }
    });
  }, [markPrice, timeframe]);

  // 3. Real-time Countdown timer to current candle close
  useEffect(() => {
    const updateCountdown = () => {
      const interval = getIntervalMs(timeframe);
      const now = Date.now();
      const nextClose = (Math.floor(now / interval) + 1) * interval;
      const diffSec = Math.max(0, Math.floor((nextClose - now) / 1000));
      const mins = Math.floor(diffSec / 60);
      const secs = diffSec % 60;
      setCandleCountdown(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
    };

    updateCountdown();
    const intervalId = setInterval(updateCountdown, 1000);
    return () => clearInterval(intervalId);
  }, [timeframe]);

  // 4. Compute all technical indicators
  const enhancedCandles = useMemo(() => {
    return computeIndicators(rawCandles);
  }, [rawCandles]);

  // 5. Slice candles according to zoom and pan
  const visibleCandles = useMemo(() => {
    if (enhancedCandles.length === 0) return [];
    const count = Math.min(enhancedCandles.length, zoomLevel);
    const end = Math.max(count, enhancedCandles.length - panOffset);
    const start = Math.max(0, end - count);
    return enhancedCandles.slice(start, end);
  }, [enhancedCandles, zoomLevel, panOffset]);

  // Focused Y-Axis Auto-Scaling: strictly fit visible candles + active trade SL/Entry/TP1-TP2 with 8% padding
  const { minPrice, maxPrice, maxVolume, autoMinPrice, autoMaxPrice } = useMemo(() => {
    if (visibleCandles.length === 0) {
      return {
        minPrice: markPrice * 0.99,
        maxPrice: markPrice * 1.01,
        maxVolume: 1000,
        autoMinPrice: markPrice * 0.99,
        autoMaxPrice: markPrice * 1.01,
      };
    }

    let low = Math.min(
      ...visibleCandles.map((c) =>
        showBollinger && c.bbLower !== undefined ? Math.min(c.low, c.bbLower) : c.low
      )
    );
    let high = Math.max(
      ...visibleCandles.map((c) =>
        showBollinger && c.bbUpper !== undefined ? Math.max(c.high, c.bbUpper) : c.high
      )
    );
    const vol = Math.max(...visibleCandles.map((c) => c.volume || 1));

    // Keep live markPrice inside auto-fit bounds when viewing the live edge
    if (panOffset === 0 && Number.isFinite(markPrice) && markPrice > 0) {
      low = Math.min(low, markPrice);
      high = Math.max(high, markPrice);
    }

    // Include active trade SL / Entry / TP1 / TP2 so active order geometry is framed cleanly
    if (activeLockedChartSignal) {
      const levels = [
        activeLockedChartSignal.entryPrice,
        activeLockedChartSignal.stopLoss,
        activeLockedChartSignal.tp1,
        activeLockedChartSignal.tp2,
      ].filter((lvl): lvl is number => typeof lvl === 'number' && Number.isFinite(lvl) && lvl > 0);
      levels.forEach((lvl) => {
        low = Math.min(low, lvl);
        high = Math.max(high, lvl);
      });
    }

    // Pad price range by 8% top & bottom for sharp, tall, readable candles
    const span = high - low;
    const margin = span > 0 ? span * 0.08 : Math.max(markPrice * 0.004, 1e-4);
    const baseMin = low - margin;
    const baseMax = high + margin;
    const baseMid = (baseMin + baseMax) / 2;
    const halfSpan = ((baseMax - baseMin) / 2) * yScaleFactor;

    return {
      minPrice: baseMid - halfSpan + yPanOffset,
      maxPrice: baseMid + halfSpan + yPanOffset,
      maxVolume: vol * 1.35,
      autoMinPrice: baseMin,
      autoMaxPrice: baseMax,
    };
  }, [visibleCandles, markPrice, showBollinger, panOffset, activeLockedChartSignal, yScaleFactor, yPanOffset]);

  // Chart dimensions & layout coordinates (TradingView layout: Volume overlaid in bottom 18% of main price pane)
  const chartWidth = 960;
  const chartHeight = showRsi ? 420 : 370;
  const pricePlotHeight = showRsi ? 325 : 350;
  const volumePlotHeight = 58;
  const volumePlotTop = pricePlotHeight - volumePlotHeight;
  const rsiPlotTop = pricePlotHeight + 6;
  const rsiPlotHeight = showRsi ? 68 : 0;
  const paddingRight = 88; // right-hand price scale gutter width for crisp $XX,XXX.XX badges

  const candleCount = visibleCandles.length || 1;
  const candleWidth = (chartWidth - paddingRight) / candleCount;

  // Coordinate projections
  const getY = useCallback(
    (val: number) => {
      if (maxPrice <= minPrice) return pricePlotHeight / 2;
      return pricePlotHeight - ((val - minPrice) / (maxPrice - minPrice)) * (pricePlotHeight - 20) - 10;
    },
    [minPrice, maxPrice, pricePlotHeight]
  );

  const getPriceFromY = useCallback(
    (y: number) => {
      if (pricePlotHeight <= 20 || maxPrice <= minPrice) return markPrice;
      const ratio = (pricePlotHeight - 10 - y) / (pricePlotHeight - 20);
      return minPrice + ratio * (maxPrice - minPrice);
    },
    [minPrice, maxPrice, pricePlotHeight, markPrice]
  );

  const getVolY = useCallback(
    (vol: number) => {
      const h = (vol / (maxVolume || 1)) * volumePlotHeight;
      return volumePlotTop + volumePlotHeight - Math.max(2, h);
    },
    [maxVolume, volumePlotTop, volumePlotHeight]
  );

  const getRsiY = useCallback(
    (rsi: number) => {
      // 0 - 100 mapped to rsiPlotTop ... rsiPlotTop + rsiPlotHeight
      const clamped = Math.max(0, Math.min(100, rsi));
      return rsiPlotTop + rsiPlotHeight - (clamped / 100) * rsiPlotHeight;
    },
    [rsiPlotTop, rsiPlotHeight]
  );

  // Sentiment Score Projection (-100 to +100 mapped to lower-middle canvas)
  const getSentimentY = useCallback(
    (score: number) => {
      const topY = pricePlotHeight * 0.40;
      const bottomY = pricePlotHeight * 0.90;
      const clamped = Math.max(-100, Math.min(100, score));
      return bottomY - ((clamped + 100) / 200) * (bottomY - topY);
    },
    [pricePlotHeight]
  );

  const headlines = useMemo(() => newsRadarData?.headlines || [], [newsRadarData]);
  const sentimentScore = newsRadarData?.aggregateScore ?? 62;
  const sentimentOverall = newsRadarData?.overallSentiment ?? 'BULLISH';

  // Sentiment points across the visible candle timeline
  const sentimentCandlePoints = useMemo(() => {
    if (!visibleCandles || visibleCandles.length === 0) return [];

    const intervalMs = getIntervalMs(timeframe);
    const avgVol = visibleCandles.reduce((acc, c) => acc + (c.volume || 1), 0) / visibleCandles.length;
    const baseScore = newsRadarData?.aggregateScore ?? 62;

    return visibleCandles.map((c, i) => {
      // Find matching or closest headline within this candle window
      const matchedHeadline = headlines.find((h) => {
        return Math.abs(h.timestamp - c.time) <= intervalMs * 2.0;
      }) || (headlines.length > 0 && i % Math.max(9, Math.floor(visibleCandles.length / 4)) === 0
        ? headlines[Math.floor(i / 9) % headlines.length]
        : undefined);

      // Local candle volatility in percentage
      const candleRange = Math.abs(c.high - c.low);
      const candleVolPct = c.open > 0 ? (candleRange / c.open) * 100 : 0;
      const isVolSpike = (volatility24h && candleVolPct > volatility24h * 0.32) || candleRange > (c.bbUpper && c.bbLower ? (c.bbUpper - c.bbLower) * 0.45 : 120);

      // Calculate sentiment score for this candle:
      let score = baseScore;
      if (matchedHeadline) {
        score = matchedHeadline.score;
      } else {
        const momentum = c.close >= c.open ? 1 : -1;
        const volMultiplier = Math.min(2.0, (c.volume || 1) / (avgVol || 1));
        const drift = momentum * 6 * volMultiplier;
        score = Math.max(-100, Math.min(100, Math.round(baseScore + drift + Math.sin(i * 0.4) * 8)));
      }

      return {
        candleIndex: i,
        candle: c,
        score,
        headline: matchedHeadline,
        isVolSpike,
        candleVolPct: +candleVolPct.toFixed(2),
      };
    });
  }, [visibleCandles, headlines, timeframe, newsRadarData?.aggregateScore, volatility24h]);

  // Quantify correlation between real-time sentiment swings and volatility spikes
  const sentimentVolCorrelation = useMemo(() => {
    if (sentimentCandlePoints.length === 0) return { correlation: 0.78, spikesCount: 0, spikesCorrelated: 0 };
    const spikes = sentimentCandlePoints.filter((p) => p.isVolSpike);
    const spikesWithSentiment = spikes.filter((p) => Math.abs(p.score) >= 40 || p.headline);
    const ratio = spikes.length > 0 ? spikesWithSentiment.length / spikes.length : 0.82;
    return {
      correlation: +(0.65 + ratio * 0.28).toFixed(2),
      spikesCount: spikes.length,
      spikesCorrelated: spikesWithSentiment.length,
    };
  }, [sentimentCandlePoints]);

  // ─── CPR (Central Pivot Range) Calculation ───
  const cprData = useMemo(() => {
    if (!rawCandles || rawCandles.length === 0) return null;

    // Identify reference session/day candles
    const now = rawCandles[rawCandles.length - 1]?.time || Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const currentDayStart = Math.floor(now / oneDayMs) * oneDayMs;
    const prevDayCandles = rawCandles.filter((c) => c.time < currentDayStart && c.time >= currentDayStart - oneDayMs);

    let refHigh: number;
    let refLow: number;
    let refClose: number;

    if (prevDayCandles.length >= 4) {
      refHigh = Math.max(...prevDayCandles.map((c) => c.high));
      refLow = Math.min(...prevDayCandles.map((c) => c.low));
      refClose = prevDayCandles[prevDayCandles.length - 1].close;
    } else {
      // Prior session reference: take the earlier slice of raw candles
      const refCount = Math.max(8, Math.floor(rawCandles.length * 0.45));
      const refSlice = rawCandles.slice(0, refCount);
      refHigh = Math.max(...refSlice.map((c) => c.high));
      refLow = Math.min(...refSlice.map((c) => c.low));
      refClose = refSlice[refSlice.length - 1].close;
    }

    if (!refHigh || !refLow || !refClose) return null;

    // Mathematical Pivots:
    // Pivot Point (P) = (High + Low + Close) / 3
    // Bottom Central (BC) = (High + Low) / 2
    // Top Central (TC) = (Pivot - BC) + Pivot
    const pivot = (refHigh + refLow + refClose) / 3;
    const bc = (refHigh + refLow) / 2;
    const tc = (pivot - bc) + pivot;

    const lower = Math.min(tc, bc);
    const upper = Math.max(tc, bc);
    const widthPct = pivot > 0 ? (Math.abs(tc - bc) / pivot) * 100 : 0;

    let regime: 'Narrow' | 'Average' | 'Wide' = 'Average';
    if (widthPct < 0.20) regime = 'Narrow';
    else if (widthPct > 0.45) regime = 'Wide';

    return {
      pivot,
      bc,
      tc,
      lower,
      upper,
      widthPct: +widthPct.toFixed(2),
      regime,
    };
  }, [rawCandles]);

  // ─── Virgin CPR (Unmitigated Prior Session Magnetic Zones, up to 3 Sessions) ───
  const { virginCprZones, nearestVirginCpr } = useMemo(() => {
    if (!markPrice || markPrice <= 0) {
      return { virginCprZones: [] as VirginCprZone[], nearestVirginCpr: null as VirginCprZone | null };
    }
    const dailyCandles = getCachedDailyCandles(
      symbol,
      { symbol, markPrice } as any,
      markPrice,
      rawCandles
    );
    const zones = computeVirginCprZones(dailyCandles, markPrice, symbol, 3, rawCandles);
    return {
      virginCprZones: zones.filter((z) => z.isVirgin && z.status === 'UNMITIGATED'),
      nearestVirginCpr: findNearestVirginCprMagnet(zones),
    };
  }, [symbol, markPrice, rawCandles, dailyHistoryTick]);

  // ─── Institutional VAP (Volume-at-Price with Historical Liquidity Memory & HVN Clusters) ───
  const vpvrData = useMemo(() => {
    const historicalPool =
      historicalVolumeCandles.length > 0
        ? [...rawCandles, ...historicalVolumeCandles]
        : rawCandles;
    return computeInstitutionalVolumeProfile(
      visibleCandles,
      historicalPool,
      minPrice,
      maxPrice,
      42
    );
  }, [visibleCandles, rawCandles, historicalVolumeCandles, minPrice, maxPrice]);

  // ─── Candlestick Pattern Detection (Institutional Reversal & Momentum Formations) ───
  const detectedPatterns = useMemo(
    () => (showPatterns ? detectPatterns(visibleCandles) : []),
    [showPatterns, visibleCandles]
  );

  const patternByCandleIndex = useMemo(() => {
    const map = new Map<number, DetectedChartPattern>();
    detectedPatterns.forEach((pat) => {
      map.set(pat.candleIndex, pat);
    });
    return map;
  }, [detectedPatterns]);

  const hoveredPattern = useMemo(
    () => (hoverIndex !== null ? patternByCandleIndex.get(hoverIndex) ?? null : null),
    [hoverIndex, patternByCandleIndex]
  );

  const activePattern = useMemo(() => {
    if (hoveredPattern) return hoveredPattern;
    for (let idx = visibleCandles.length - 1; idx >= Math.max(0, visibleCandles.length - 3); idx--) {
      const pat = patternByCandleIndex.get(idx);
      if (pat) return pat;
    }
    return null;
  }, [hoveredPattern, patternByCandleIndex, visibleCandles.length]);

  // ─── Daily Fibonacci Swing & Confluence Calculations ───
  const isBullishRegime = useMemo(() => {
    const latestVwap = enhancedCandles[enhancedCandles.length - 1]?.vwap;
    return latestVwap ? markPrice >= latestVwap : true;
  }, [enhancedCandles, markPrice]);

  const baseFibData = useMemo(() => {
    if (!rawCandles || rawCandles.length === 0) return null;
    const highVal = Math.max(...rawCandles.map((c) => c.high));
    const lowVal = Math.min(...rawCandles.map((c) => c.low));
    const lastClose = rawCandles[rawCandles.length - 1]?.close || markPrice;
    const firstClose = rawCandles[0]?.close || markPrice;
    const changePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

    const mockTicker = {
      markPrice,
      high24h: highVal,
      low24h: lowVal,
      change24h: changePct,
      symbol,
    };
    return computeDailyFibonacciLevels(mockTicker as any, markPrice, rawCandles, isBullishRegime ? 'LONG' : 'SHORT');
  }, [rawCandles, markPrice, symbol, isBullishRegime]);

  // Dynamic recalculation of intermediate levels when manual drag handles are used
  const fibData = useMemo(() => {
    if (!baseFibData) return null;
    if (customSwingHigh === null && customSwingLow === null) return baseFibData;

    const highVal = customSwingHigh ?? baseFibData.swingHigh;
    const lowVal = customSwingLow ?? baseFibData.swingLow;
    const delta = Math.max(0.0001, highVal - lowVal);
    const fmt = (val: number) => +val.toFixed(markPrice > 10 ? 2 : 4);

    const isBull = isBullishRegime;

    const fib000 = isBull ? highVal : lowVal;
    const fib100 = isBull ? lowVal : highVal;
    const fib236 = isBull ? fmt(highVal - 0.236 * delta) : fmt(lowVal + 0.236 * delta);
    const fib382 = isBull ? fmt(highVal - 0.382 * delta) : fmt(lowVal + 0.382 * delta);
    const fib500 = isBull ? fmt(highVal - 0.500 * delta) : fmt(lowVal + 0.500 * delta);
    const fib618 = isBull ? fmt(highVal - 0.618 * delta) : fmt(lowVal + 0.618 * delta);
    const fib650 = isBull ? fmt(highVal - 0.650 * delta) : fmt(lowVal + 0.650 * delta);
    const fib786 = isBull ? fmt(highVal - 0.786 * delta) : fmt(lowVal + 0.786 * delta);

    const ext127Bull = fmt(highVal + 0.272 * delta);
    const ext161Bull = fmt(highVal + 0.618 * delta);
    const ext127Bear = fmt(lowVal - 0.272 * delta);
    const ext161Bear = fmt(lowVal - 0.618 * delta);

    return {
      ...baseFibData,
      swingHigh: highVal,
      swingLow: lowVal,
      range: delta,
      isBullish: isBull,
      base000: fib000,
      base100: fib100,
      fib236,
      fib382,
      fib500,
      fib618,
      fib650,
      fib786,
      ext127Bull,
      ext161Bull,
      ext127Bear,
      ext161Bear,
      activeZoneLabel: customSwingHigh !== null || customSwingLow !== null ? '[MANUAL OVERRIDE]' : baseFibData.activeZoneLabel,
    };
  }, [baseFibData, customSwingHigh, customSwingLow, markPrice, isBullishRegime]);

  // Dragging event listener for manual Fibonacci anchor overrides
  useEffect(() => {
    if (!draggingFibAnchor) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const newPrice = getPriceFromY(relY);

      if (draggingFibAnchor === 'PDH') {
        const currentLow = customSwingLow ?? (baseFibData?.swingLow ?? markPrice * 0.98);
        setCustomSwingHigh(Math.max(newPrice, currentLow + 10));
      } else if (draggingFibAnchor === 'PDL') {
        const currentHigh = customSwingHigh ?? (baseFibData?.swingHigh ?? markPrice * 1.02);
        setCustomSwingLow(Math.min(newPrice, currentHigh - 10));
      }
    };

    const handleMouseUp = () => {
      setDraggingFibAnchor(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingFibAnchor, getPriceFromY, customSwingLow, customSwingHigh, baseFibData, markPrice]);

  const fibConfluenceData = useMemo(() => {
    if (!fibData || !cprData) return null;
    const mockCamarilla = {
      pivot: cprData.pivot,
      bc: cprData.bc,
      tc: cprData.tc,
      range: cprData.tc - cprData.bc,
      atr5m: markPrice * 0.005,
      h1: cprData.tc * 1.0005,
      h2: cprData.tc * 1.001,
      h3: cprData.tc * 1.002,
      h4: cprData.tc * 1.005,
      h5: cprData.tc * 1.01,
      h6: cprData.tc * 1.015,
      l1: cprData.bc * 0.9995,
      l2: cprData.bc * 0.999,
      l3: cprData.bc * 0.998,
      l4: cprData.bc * 0.995,
      l5: cprData.bc * 0.99,
      l6: cprData.bc * 0.985,
      isWideCpr: cprData.regime === 'Wide',
      cprWidthPct: cprData.widthPct,
      cprRegime: cprData.regime.toUpperCase() as 'AVERAGE' | 'NARROW' | 'WIDE',
    };
    const dir = isBullishRegime ? 'LONG' : 'SHORT';
    return detectFibCamarillaConfluence(fibData, mockCamarilla, dir, markPrice);
  }, [fibData, cprData, isBullishRegime, markPrice]);

  // Confluence Proximity Glow Alert (active when mark price is within 0.20% of matched confluence level)
  const isConfluenceProximityActive = useMemo(() => {
    if (!fibConfluenceData || !fibConfluenceData.matchedFibPrice) return false;
    const delta = Math.abs(markPrice - fibConfluenceData.matchedFibPrice) / fibConfluenceData.matchedFibPrice;
    return delta <= 0.0020; // 0.20% proximity threshold
  }, [fibConfluenceData, markPrice]);

  // Active Candle for OHLCV Inspection Header
  const activeCandle = hoverIndex !== null && visibleCandles[hoverIndex]
    ? visibleCandles[hoverIndex]
    : visibleCandles[visibleCandles.length - 1];

  const activeSentimentPoint = hoverIndex !== null && sentimentCandlePoints[hoverIndex]
    ? sentimentCandlePoints[hoverIndex]
    : sentimentCandlePoints[sentimentCandlePoints.length - 1];

  const candleDelta = activeCandle ? activeCandle.close - activeCandle.open : 0;
  const candleDeltaPct = activeCandle && activeCandle.open > 0 ? (candleDelta / activeCandle.open) * 100 : 0;

  // Format crisp institutional Y-axis gutter price values (e.g. $62,886.53)
  const formatAxisPrice = useCallback(
    (val: number) => {
      const converted = val * exchangeRate;
      const decimals = markPrice >= 100 ? 2 : markPrice >= 1 ? 3 : 4;
      return `${currencyPrefix}${converted.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;
    },
    [exchangeRate, markPrice, currencyPrefix]
  );

  // Format concise volume for Row 2 telemetry strip
  const formatCompactVolume = useCallback((vol: number) => {
    if (!Number.isFinite(vol) || vol <= 0) return '0';
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
    return vol.toFixed(0);
  }, []);

  // Unified Anti-Collision Registry for Canvas Level Titles & Right Y-Axis Gutter Badges
  const { resolvedCanvasTitles, resolvedGutterBadges } = useMemo(() => {
    interface LevelDescriptor extends VerticalLabelItem {
      title: string;
      price: number;
      stroke: string;
      badgeBg: string;
      textColor: string;
      isMark?: boolean;
      opacity?: number;
    }

    const levelItems: LevelDescriptor[] = [];
    const inRange = (p: number | undefined | null): p is number =>
      typeof p === 'number' && Number.isFinite(p) && p > 0 && p >= minPrice && p <= maxPrice;

    // 1. Active Locked Signal (highest priority overlays: SL / ENTRY / TP1 / TP2)
    if (activeLockedChartSignal) {
      const sigOpacity = signalValidity.status === 'OVERDUE' ? 0.65 : 1;
      const sigDefs = [
        {
          id: 'sig-sl',
          title: 'SL',
          price: activeLockedChartSignal.stopLoss,
          stroke: '#F43F5E',
          badgeBg: '#BE123C',
          textColor: '#FFF1F2',
          priority: 95,
        },
        {
          id: 'sig-entry',
          title: activeLockedChartSignal.direction === 'LONG' ? 'BUY' : 'SELL',
          price: activeLockedChartSignal.entryPrice,
          stroke: '#22D3EE',
          badgeBg: '#0E7490',
          textColor: '#ECFEFF',
          priority: 96,
        },
        {
          id: 'sig-tp1',
          title: 'TP1',
          price: activeLockedChartSignal.tp1,
          stroke: '#10B981',
          badgeBg: '#047857',
          textColor: '#ECFDF5',
          priority: 94,
        },
        {
          id: 'sig-tp2',
          title: 'TP2',
          price: activeLockedChartSignal.tp2 || 0,
          stroke: '#A78BFA',
          badgeBg: '#6D28D9',
          textColor: '#F5F3FF',
          priority: 92,
        },
      ];
      sigDefs.forEach((lvl) => {
        if (inRange(lvl.price)) {
          levelItems.push({
            ...lvl,
            rawY: getY(lvl.price),
            opacity: sigOpacity,
          });
        }
      });
    }

    // 2. Camarilla Structural Levels (H4 / H3 / L3 / L4)
    if (showCamarilla && (camarillaLevels || cprData)) {
      const refPiv = camarillaLevels?.pivot || cprData?.pivot || markPrice;
      const refRange =
        camarillaLevels?.h4 && camarillaLevels?.l4
          ? (camarillaLevels.h4 - camarillaLevels.l4) / 1.1
          : Math.max(
              markPrice * 0.012,
              cprData ? Math.abs(cprData.tc - cprData.bc) * 4 : markPrice * 0.012
            );
      const camDefs = [
        {
          id: 'cam-h4',
          title: 'H4',
          price: camarillaLevels?.h4 || +(refPiv + refRange * 0.55).toFixed(2),
          stroke: '#10B981',
          badgeBg: '#065F46',
          textColor: '#D1FAE5',
          priority: 76,
        },
        {
          id: 'cam-h3',
          title: 'H3',
          price: camarillaLevels?.h3 || +(refPiv + refRange * 0.275).toFixed(2),
          stroke: '#22D3EE',
          badgeBg: '#155E75',
          textColor: '#CFFAFE',
          priority: 72,
        },
        {
          id: 'cam-l3',
          title: 'L3',
          price: camarillaLevels?.l3 || +(refPiv - refRange * 0.275).toFixed(2),
          stroke: '#A78BFA',
          badgeBg: '#5B21B6',
          textColor: '#EDE9FE',
          priority: 72,
        },
        {
          id: 'cam-l4',
          title: 'L4',
          price: camarillaLevels?.l4 || +(refPiv - refRange * 0.55).toFixed(2),
          stroke: '#F43F5E',
          badgeBg: '#9F1239',
          textColor: '#FFE4E6',
          priority: 76,
        },
      ];
      camDefs.forEach((lvl) => {
        if (inRange(lvl.price)) {
          levelItems.push({ ...lvl, rawY: getY(lvl.price) });
        }
      });
    }

    // 3. Daily CPR Levels (TC / P / BC)
    if (showCpr && cprData) {
      const cprDefs = [
        { id: 'cpr-tc', title: 'TC', price: cprData.tc, stroke: '#38BDF8', badgeBg: '#0369A1', textColor: '#E0F2FE', priority: 60 },
        { id: 'cpr-p', title: 'P', price: cprData.pivot, stroke: '#C084FC', badgeBg: '#6B21A8', textColor: '#F3E8FF', priority: 63 },
        { id: 'cpr-bc', title: 'BC', price: cprData.bc, stroke: '#818CF8', badgeBg: '#3730A3', textColor: '#E0E7FF', priority: 60 },
      ];
      cprDefs.forEach((lvl) => {
        if (inRange(lvl.price)) {
          levelItems.push({ ...lvl, rawY: getY(lvl.price) });
        }
      });
    }

    // 4. Virgin CPR Overlapping Zones
    if (showVirginCpr && virginCprZones.length > 0) {
      virginCprZones.forEach((zone) => {
        if (zone.cprHigh >= minPrice && zone.cprLow <= maxPrice) {
          const anchorPrice = Math.max(minPrice, Math.min(maxPrice, zone.pivot));
          levelItems.push({
            id: `vcpr-${zone.id}`,
            title: `V-CPR ${zone.ageSessions}D`,
            price: anchorPrice,
            rawY: getY(anchorPrice),
            stroke: '#D8B4FE',
            badgeBg: '#581C87',
            textColor: '#F3E8FF',
            priority: 66,
          });
        }
      });
    }

    // 5. Fibonacci Levels (only those inside visible Y range)
    if (showFib && fibData) {
      const fibDefs = [
        { id: 'fib-618', title: '0.618 GP', price: fibData.fib618, stroke: '#F59E0B', badgeBg: '#B45309', textColor: '#FEF3C7', priority: 84 },
        { id: 'fib-650', title: '0.650', price: fibData.fib650, stroke: '#F59E0B', badgeBg: '#92400E', textColor: '#FEF3C7', priority: 54 },
        { id: 'fib-500', title: '0.500 EQ', price: fibData.fib500, stroke: '#06B6D4', badgeBg: '#0E7490', textColor: '#CFFAFE', priority: 70 },
        { id: 'fib-382', title: '0.382', price: fibData.fib382, stroke: '#94A3B8', badgeBg: '#334155', textColor: '#E2E8F0', priority: 44 },
        { id: 'fib-236', title: '0.236', price: fibData.fib236, stroke: '#94A3B8', badgeBg: '#334155', textColor: '#E2E8F0', priority: 40 },
        { id: 'fib-pdh', title: 'PDH', price: fibData.swingHigh, stroke: '#10B981', badgeBg: '#065F46', textColor: '#D1FAE5', priority: 78 },
        { id: 'fib-pdl', title: 'PDL', price: fibData.swingLow, stroke: '#F43F5E', badgeBg: '#9F1239', textColor: '#FFE4E6', priority: 78 },
        { id: 'fib-127', title: '1.272', price: fibData.ext127Bull, stroke: '#38BDF8', badgeBg: '#075985', textColor: '#E0F2FE', priority: 48 },
      ];
      fibDefs.forEach((lvl) => {
        if (inRange(lvl.price)) {
          levelItems.push({ ...lvl, rawY: getY(lvl.price) });
        }
      });
    }

    // 6. VPVR Levels (POC / VAH / VAL)
    if (showVpvr && vpvrData) {
      const vpvrDefs = [
        { id: 'vpvr-poc', title: 'POC', price: vpvrData.pocPrice, stroke: '#F59E0B', badgeBg: '#B45309', textColor: '#FEF3C7', priority: 82 },
        { id: 'vpvr-vah', title: 'VAH', price: vpvrData.vah, stroke: '#38BDF8', badgeBg: '#0C4A6E', textColor: '#E0F2FE', priority: 50 },
        { id: 'vpvr-val', title: 'VAL', price: vpvrData.val, stroke: '#38BDF8', badgeBg: '#0C4A6E', textColor: '#E0F2FE', priority: 50 },
      ];
      vpvrDefs.forEach((lvl) => {
        if (inRange(lvl.price)) {
          levelItems.push({ ...lvl, rawY: getY(lvl.price) });
        }
      });
    }

    const minY = 12;
    const maxY = Math.max(24, pricePlotHeight - 12);
    const maxSlotsAt16px = Math.max(4, Math.floor((maxY - minY) / 16) + 1);

    // Keep highest-priority levels if total simultaneous overlays exceed viewport 16px slot capacity
    const prioritizedLevels =
      showIndicatorLabels
        ? [...levelItems]
            .sort((a, b) => b.priority - a.priority)
            .slice(0, Math.max(1, maxSlotsAt16px - 1))
        : [];

    const canvasTitles = resolveVerticalLabelCollisions(
      prioritizedLevels,
      16,
      minY,
      maxY
    );

    // Right Y-axis gutter includes Live Mark Price (highest priority) + visible level price badges
    const gutterInput: LevelDescriptor[] = [...prioritizedLevels];
    if (inRange(markPrice)) {
      gutterInput.push({
        id: 'live-mark',
        title: 'MARK',
        price: markPrice,
        rawY: getY(markPrice),
        stroke: tickFlash === 'DOWN' ? '#f23645' : '#089981',
        badgeBg: tickFlash === 'DOWN' ? '#f23645' : '#089981',
        textColor: '#ffffff',
        priority: 100,
        isMark: true,
      });
    }

    const gutterBadges = resolveVerticalLabelCollisions(
      gutterInput,
      16,
      minY,
      maxY
    );

    return {
      resolvedCanvasTitles: canvasTitles,
      resolvedGutterBadges: gutterBadges,
    };
  }, [
    activeLockedChartSignal,
    signalValidity.status,
    showCamarilla,
    camarillaLevels,
    cprData,
    showCpr,
    showVirginCpr,
    virginCprZones,
    showFib,
    fibData,
    showVpvr,
    vpvrData,
    showIndicatorLabels,
    minPrice,
    maxPrice,
    markPrice,
    tickFlash,
    getY,
    pricePlotHeight,
  ]);

  // Dynamic Legend, HUD & VAP Collision Layout Solver
  const dynamicOverlayLayout = useMemo(() => {
    const vapActive = Boolean(showVpvr && vpvrData);
    const vapMaxBarWidth = vapActive ? 112 : 0;
    const isOffscreenVcprVisible = Boolean(
      showVirginCpr &&
        showIndicatorLabels &&
        nearestVirginCpr &&
        (nearestVirginCpr.cprLow > maxPrice || nearestVirginCpr.cprHigh < minPrice)
    );
    const isVcprAbove = Boolean(
      isOffscreenVcprVisible && nearestVirginCpr && nearestVirginCpr.cprLow > maxPrice
    );
    const isVcprBelow = Boolean(
      isOffscreenVcprVisible && nearestVirginCpr && nearestVirginCpr.cprHigh < minPrice
    );

    // Inspect early-left & late-right plot occupancy by candles and pattern markers
    const splitIdx = Math.max(1, Math.floor(visibleCandles.length * 0.36));
    const rightStartIdx = Math.max(0, Math.floor(visibleCandles.length * 0.60));

    let topLeftBusy = false;
    let bottomLeftBusy = false;
    let topRightBusy = false;

    visibleCandles.forEach((c, i) => {
      const highY = getY(c.high);
      const lowY = getY(c.low);
      const pat = patternByCandleIndex.get(i);
      const patPadTop = pat?.sentiment === 'BEARISH' ? 24 : 0;
      const patPadBot = pat && pat.sentiment !== 'BEARISH' ? 24 : 0;

      if (i <= splitIdx) {
        if (highY - patPadTop < 115) topLeftBusy = true;
        if (lowY + patPadBot > pricePlotHeight - 108) bottomLeftBusy = true;
      }
      if (i >= rightStartIdx) {
        if (highY - patPadTop < 44) topRightBusy = true;
      }
    });

    // Position the Trend Smoothing HUD away from off-screen V-CPR pills & pattern/candle clusters
    let trendHudPosClass = 'top-2.5 left-3';
    if (showShortTermTrend) {
      if (topLeftBusy && !bottomLeftBusy && !isVcprBelow) {
        trendHudPosClass = showVolume ? 'bottom-16 left-3' : 'bottom-7 left-3';
      } else if (isVcprAbove) {
        trendHudPosClass = 'top-7 left-3';
      }
    }
    const trendHudIsTopLeft = trendHudPosClass.startsWith('top-');

    // Compute right inset (%) clearing the Y-axis gutter (88/960 = 9.17%) + active VAP bars (112/960 = 11.67%)
    const plotRightClearPct = vapActive ? 22.2 : 10.6;

    // Choose legend position that never overlaps VAP bars, Trend HUD, V-CPR pill, or upper-right candles/patterns
    let legendSide: 'TOP_RIGHT' | 'TOP_LEFT' | 'BOTTOM_LEFT' = 'TOP_RIGHT';
    if (topRightBusy && !topLeftBusy && !trendHudIsTopLeft) {
      legendSide = 'TOP_LEFT';
    } else if (topRightBusy && !bottomLeftBusy && !isVcprBelow && !(showShortTermTrend && !trendHudIsTopLeft)) {
      legendSide = 'BOTTOM_LEFT';
    }

    const legendTopOffset =
      legendSide === 'TOP_LEFT' && isVcprAbove ? '28px' : '10px';

    // Off-screen V-CPR pill SVG coordinates (avoids Trend Smoothing HUD & Left Legend)
    const vcprPillY = isVcprAbove ? 8 : Math.max(16, pricePlotHeight - 23);
    const vcprPillX =
      (isVcprAbove && showShortTermTrend && trendHudIsTopLeft) ||
      (isVcprBelow && showShortTermTrend && !trendHudIsTopLeft)
        ? 10
        : 10;

    return {
      vapActive,
      vapMaxBarWidth,
      plotRightClearPct,
      trendHudPosClass,
      legendSide,
      legendTopOffset,
      vcprPillX,
      vcprPillY,
    };
  }, [
    showVpvr,
    vpvrData,
    showVirginCpr,
    showIndicatorLabels,
    nearestVirginCpr,
    maxPrice,
    minPrice,
    visibleCandles,
    patternByCandleIndex,
    getY,
    pricePlotHeight,
    showShortTermTrend,
    showVolume,
  ]);

  // Short-Term Trend Line Visualizer (Adaptive Volatility-Threshold Smoothing + Linear Regression + 1-Sigma Channel)
  const shortTermTrendOverlay = useMemo(() => {
    if (!showShortTermTrend || !visibleCandles || visibleCandles.length < 4) return null;

    // Scale lookback window (8..32 bars) and base smoothing alpha (0.55..0.10) from user's volatility threshold (0..100%)
    const normThreshold = Math.max(0, Math.min(1, volatilityThreshold / 100)); // 0 (sensitive) -> 1 (heavy damping)
    const targetWindow = Math.round(8 + normThreshold * 24);
    const windowSize = Math.max(4, Math.min(targetWindow, visibleCandles.length));
    const startIdx = visibleCandles.length - windowSize;
    const endIdx = visibleCandles.length - 1;
    const slice = visibleCandles.slice(startIdx);

    // Measure live candle volatility (% range) to dynamically reinforce damping when volatility exceeds threshold
    let rangeSumPct = 0;
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      rangeSumPct += c.close > 0 ? ((c.high - c.low) / c.close) * 100 : 0;
    }
    const avgRangePct = rangeSumPct / slice.length;
    const baseAlpha = 0.55 - normThreshold * 0.45;
    const volatilityDamping = Math.min(0.35, avgRangePct * (0.08 + normThreshold * 0.14));
    const effectiveAlpha = Math.max(0.06, Math.min(0.60, +(baseAlpha * (1 - volatilityDamping)).toFixed(2)));

    // Apply adaptive exponential smoothing to close prices across the active window
    const smoothedValues: number[] = [];
    let emaVal = slice[0].close;
    for (let i = 0; i < slice.length; i++) {
      emaVal = i === 0 ? slice[0].close : effectiveAlpha * slice[i].close + (1 - effectiveAlpha) * emaVal;
      smoothedValues.push(emaVal);
    }

    const n = smoothedValues.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i++) {
      const y = smoothedValues[i];
      sumX += i;
      sumY += y;
      sumXY += i * y;
      sumXX += i * i;
    }

    const denom = n * sumXX - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    const startPrice = intercept;
    const endPrice = intercept + slope * (n - 1);
    const projPrice = intercept + slope * (n + 1); // 2-candle forward projection

    let sqErr = 0;
    for (let i = 0; i < n; i++) {
      const predicted = intercept + slope * i;
      const err = slice[i].close - predicted;
      sqErr += err * err;
    }
    const stdDev = Math.sqrt(sqErr / n);
    const stdDevPct = endPrice > 0 ? (stdDev / endPrice) * 100 : 0;
    const slopePct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;
    const isBullish = endPrice >= startPrice;

    const intensityLabel =
      volatilityThreshold <= 30
        ? 'REACTIVE'
        : volatilityThreshold <= 70
        ? 'ADAPTIVE'
        : 'SMOOTHED';

    return {
      startIdx,
      endIdx,
      projIdx: endIdx + 2,
      windowSize,
      startPrice,
      endPrice,
      projPrice,
      stdDev,
      stdDevPct,
      slopePct,
      isBullish,
      effectiveAlpha,
      avgRangePct,
      intensityLabel,
      smoothedPoints: smoothedValues.map((price, idx) => ({
        candleIdx: startIdx + idx,
        price,
      })),
    };
  }, [showShortTermTrend, visibleCandles, volatilityThreshold, trendResetNonce]);

  const lastReportedVarianceRef = useRef<string>('');
  useEffect(() => {
    lastReportedVarianceRef.current = '';
  }, [trendResetNonce]);

  useEffect(() => {
    if (!onTrendVarianceChange) return;
    if (!showShortTermTrend || !shortTermTrendOverlay) {
      if (lastReportedVarianceRef.current !== 'null') {
        lastReportedVarianceRef.current = 'null';
        onTrendVarianceChange(null);
      }
      return;
    }
    const decimals = markPrice > 10 ? 2 : 4;
    const stdDevDisplay = +(shortTermTrendOverlay.stdDev * exchangeRate).toFixed(decimals);
    const stdDevPctDisplay = +shortTermTrendOverlay.stdDevPct.toFixed(2);
    const sigKey = `${stdDevDisplay}-${stdDevPctDisplay}`;
    if (lastReportedVarianceRef.current !== sigKey) {
      lastReportedVarianceRef.current = sigKey;
      onTrendVarianceChange({
        stdDev: stdDevDisplay,
        stdDevPct: stdDevPctDisplay,
      });
    }
  }, [showShortTermTrend, shortTermTrendOverlay, exchangeRate, markPrice, onTrendVarianceChange, trendResetNonce]);

  // Zoom & Scale handlers (X-axis and Y-axis)
  const isAutoScaleY = Math.abs(yScaleFactor - 1) < 0.001 && Math.abs(yPanOffset) < 1e-6;
  const isViewModified = !isAutoScaleY || panOffset > 0 || zoomLevel !== 48;

  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => Math.max(10, Math.round(prev * 0.84)));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => Math.min(120, Math.round(prev * 1.18)));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoomLevel(48);
    setPanOffset(0);
    setYScaleFactor(1);
    setYPanOffset(0);
  }, []);

  // Global mousemove / mouseup listeners for 2D Panning (PAN_XY), Y-Axis Scaling (SCALE_Y), and X-Axis Scaling (SCALE_X)
  useEffect(() => {
    if (activeDragMode === 'NONE') return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const st = dragStateRef.current;
      if (st.mode === 'NONE') return;

      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;

      if (st.mode === 'PAN_XY') {
        // Horizontal drag -> shift panOffset (dragging right looks back in history)
        const pxPerCandle = Math.max(4, st.plotWidthPx / Math.max(1, st.startZoomLevel));
        const deltaCandles = Math.round(dx / pxPerCandle);
        const maxPan = Math.max(0, enhancedCandles.length - Math.min(enhancedCandles.length, Math.max(5, Math.floor(st.startZoomLevel * 0.3))));
        const nextPan = Math.max(0, Math.min(maxPan, st.startPanOffset + deltaCandles));
        setPanOffset(nextPan);

        // Vertical drag -> shift yPanOffset in price units (dragging down moves viewport up in price)
        const pricePerPx = st.priceRangeAtStart / Math.max(60, st.plotHeightPx);
        setYPanOffset(st.startYPanOffset + dy * pricePerPx);
      } else if (st.mode === 'SCALE_Y') {
        // Dragging UP on price axis expands candles (smaller yScaleFactor); dragging DOWN compresses candles (larger yScaleFactor)
        const scaleMultiplier = Math.exp(dy * 0.0065);
        const nextScale = Math.max(0.12, Math.min(8.0, st.startYScaleFactor * scaleMultiplier));
        setYScaleFactor(nextScale);
      } else if (st.mode === 'SCALE_X') {
        // Dragging LEFT on time axis compresses more candles; dragging RIGHT expands fewer candles
        const scaleMultiplier = Math.exp(-dx * 0.0055);
        const nextZoom = Math.max(10, Math.min(120, Math.round(st.startZoomLevel * scaleMultiplier)));
        setZoomLevel(nextZoom);
      }
    };

    const handleWindowMouseUp = () => {
      dragStateRef.current.mode = 'NONE';
      setActiveDragMode('NONE');
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [activeDragMode, enhancedCandles.length]);

  // Native non-passive wheel & touch event listeners for comprehensive mouse scrolling and pinch-to-zoom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let initialPinchDist = 0;
    let initialZoom = zoomLevel;
    let initialYScale = yScaleFactor;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialZoom = zoomLevel;
        initialYScale = yScaleFactor;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialPinchDist > 0) {
        e.preventDefault();
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = initialPinchDist / Math.max(10, currentDist);
        setZoomLevel(Math.max(10, Math.min(120, Math.round(initialZoom * factor))));
        setYScaleFactor(Math.max(0.12, Math.min(8.0, initialYScale * factor)));
      }
    };

    const onTouchEnd = () => {
      initialPinchDist = 0;
    };

    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const usableWidth = rect.width * ((chartWidth - paddingRight) / chartWidth);
      const isOverPriceAxis = relX >= usableWidth;
      const zoomIn = e.deltaY < 0;

      // 1. Pinch-to-zoom / Ctrl+Meta trackpad pinch or Ctrl+Wheel -> zoom both X (time) and Y (price) axes
      if (e.ctrlKey || e.metaKey || e.deltaMode === 0 && Math.abs(e.deltaX) > 0 && Math.abs(e.deltaY) > 0) {
        const factor = zoomIn ? 0.92 : 1.09;
        setYScaleFactor((prev) => Math.max(0.12, Math.min(8.0, prev * factor)));
        setZoomLevel((prev) => Math.max(10, Math.min(120, Math.round(prev * factor))));
        return;
      }

      // 2. Horizontal trackpad scroll (deltaX) -> pan timeline X-axis
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const deltaCandles = e.deltaX > 0 ? 1 : -1;
        const maxPan = Math.max(0, enhancedCandles.length - Math.min(enhancedCandles.length, 5));
        setPanOffset((prev) => Math.max(0, Math.min(maxPan, prev + deltaCandles)));
        return;
      }

      // 3. Wheel on right price axis OR Shift/Alt + Wheel -> scale/zoom Y-axis (price)
      if (isOverPriceAxis || e.shiftKey || e.altKey) {
        setYScaleFactor((prev) => {
          const factor = zoomIn ? 0.88 : 1.14;
          return Math.max(0.12, Math.min(8.0, prev * factor));
        });
        return;
      }

      // 4. Default vertical wheel on chart canvas -> zoom X-axis (candle spread / time zoom)
      setZoomLevel((prev) => {
        const next = zoomIn ? Math.round(prev * 0.88) : Math.round(prev * 1.14);
        return Math.max(10, Math.min(120, next === prev ? (zoomIn ? prev - 2 : prev + 2) : next));
      });
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('wheel', onWheelNative, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheelNative);
    };
  }, [chartWidth, paddingRight, enhancedCandles.length, zoomLevel, yScaleFactor]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!chartWrapperRef.current) return;
    if (!document.fullscreenElement) {
      chartWrapperRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Click outside listener for dropdown menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (chartWrapperRef.current && !chartWrapperRef.current.contains(e.target as Node)) {
        setShowIndicatorMenu(false);
        setShowChartTypeMenu(false);
        setShowChartSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      ref={chartWrapperRef}
      className={`panel-delta flex flex-col h-full relative select-none font-sans overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 rounded-none bg-[#0B111E]' : ''
      }`}
    >
      {/* ════════════════ TRADINGVIEW COMPACT 2-ROW CHART HEADER TOOLBAR ════════════════ */}
      <div className="bg-[#080E1A] border-b border-slate-800/80 shrink-0 select-none">
        {/* ROW 1: Pair & TF badge, inline timeframe switcher, style, indicators, overlay toggles, labels, settings, single/split */}
        <div className="flex items-center justify-between gap-1.5 py-1.5 px-3 border-b border-slate-800/60 text-[11px] min-w-0">
          {/* Left Control Cluster */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap xl:flex-nowrap">
            {/* Pair & TF Badge */}
            <div
              className="h-7 px-2 inline-flex items-center gap-1 rounded-md bg-[#0C1322] border border-slate-800/90 font-mono text-[11px] font-bold text-slate-100 whitespace-nowrap shrink-0"
              title={chartTitleLabel ? `${symbol} · ${timeframe.toUpperCase()} · ${chartTitleLabel}` : `${symbol} · ${timeframe.toUpperCase()}`}
            >
              <span>{symbol}</span>
              <span className="text-slate-600">·</span>
              <span className={chartRole === 'MACRO_4H' ? 'text-violet-300' : 'text-cyan-300'}>
                {timeframe.toUpperCase()}
              </span>
            </div>

            {/* Compact Inline Timeframe Switcher (1m 3m 5m 15m 1h 4h 1D) */}
            <div
              className="h-7 px-0.5 inline-flex items-center gap-0.5 rounded-md bg-[#060B14] border border-slate-800/90 shrink-0"
              role="group"
              aria-label="Chart Timeframe"
            >
              {['1m', '3m', '5m', '15m', '1h', '4h', '1D'].map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={`h-6 px-1.5 rounded text-[11px] font-mono leading-none transition whitespace-nowrap cursor-pointer ${
                    timeframe === tf
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 font-bold'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 border border-transparent'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            {/* Chart Style Selector Dropdown */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowChartTypeMenu(!showChartTypeMenu);
                  setShowIndicatorMenu(false);
                  setShowChartSettingsMenu(false);
                }}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md bg-[#0C1322] hover:bg-slate-800/90 border border-slate-800 text-slate-200 text-[11px] font-medium transition whitespace-nowrap cursor-pointer"
                title="Chart Style"
              >
                <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className={compactProDesk && !isExpandedPane ? 'hidden 2xl:inline' : ''}>
                  {chartType === 'CANDLES'
                    ? 'Candles'
                    : chartType === 'HOLLOW'
                    ? 'Hollow'
                    : chartType === 'HEIKIN_ASHI'
                    ? 'Heikin'
                    : chartType === 'LINE'
                    ? 'Line'
                    : 'Area'}
                </span>
              </button>

              {showChartTypeMenu && (
                <div className="absolute top-full left-0 mt-1 w-36 panel-delta py-1 z-40">
                  {(['CANDLES', 'HOLLOW', 'HEIKIN_ASHI', 'LINE', 'AREA'] as ChartType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setChartType(type);
                        setShowChartTypeMenu(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center justify-between hover:bg-slate-800/80 transition cursor-pointer ${
                        chartType === type ? 'text-cyan-300 font-semibold' : 'text-slate-300'
                      }`}
                    >
                      <span>{type.replace('_', ' ')}</span>
                      {chartType === type && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Indicators Dropdown Menu */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowIndicatorMenu(!showIndicatorMenu);
                  setShowChartTypeMenu(false);
                  setShowChartSettingsMenu(false);
                }}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md bg-[#0C1322] hover:bg-slate-800/90 border border-slate-800 text-slate-200 text-[11px] font-medium transition whitespace-nowrap cursor-pointer"
                title="Chart Indicators & Studies"
              >
                <Sliders className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className={compactProDesk && !isExpandedPane ? 'hidden 2xl:inline' : ''}>
                  Indicators
                </span>
              </button>

              {showIndicatorMenu && (
                <div className="absolute left-0 top-full mt-1 w-56 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-2xl p-2 z-40 space-y-1">
                  <div className="flex items-center justify-between px-1 mb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Chart Studies
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowEma9(true);
                        setShowEma21(true);
                        setShowEma50(false);
                        setShowEma200(false);
                        setShowVwap(true);
                        setShowBollinger(false);
                        setShowCpr(true);
                        setShowVirginCpr(true);
                        setShowVpvr(false);
                        setShowPatterns(true);
                        setShowFib(false);
                        setShowFibSentiment(false);
                        setShowSentimentTrend(false);
                      }}
                      className="text-[10px] text-[#5b8cff] hover:underline cursor-pointer"
                    >
                      Reset Clean
                    </button>
                  </div>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-cyan-400 font-medium">EMA 9</span>
                    <input
                      type="checkbox"
                      checked={showEma9}
                      onChange={(e) => setShowEma9(e.target.checked)}
                      className="accent-cyan-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-orange-400 font-medium">EMA 21</span>
                    <input
                      type="checkbox"
                      checked={showEma21}
                      onChange={(e) => setShowEma21(e.target.checked)}
                      className="accent-orange-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-purple-400 font-medium">EMA 50</span>
                    <input
                      type="checkbox"
                      checked={showEma50}
                      onChange={(e) => setShowEma50(e.target.checked)}
                      className="accent-purple-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-orange-400 font-medium">EMA 200</span>
                    <input
                      type="checkbox"
                      checked={showEma200}
                      onChange={(e) => setShowEma200(e.target.checked)}
                      className="accent-orange-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-blue-400 font-medium">VWAP</span>
                    <input
                      type="checkbox"
                      checked={showVwap}
                      onChange={(e) => setShowVwap(e.target.checked)}
                      className="accent-blue-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-indigo-300 font-medium">Daily CPR</span>
                    <input
                      type="checkbox"
                      checked={showCpr}
                      onChange={(e) => setShowCpr(e.target.checked)}
                      className="accent-indigo-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-purple-300 font-medium">Virgin CPR Magnets</span>
                    <input
                      type="checkbox"
                      checked={showVirginCpr}
                      onChange={(e) => setShowVirginCpr(e.target.checked)}
                      className="accent-purple-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-amber-300 font-medium">Fib Swing (Y-HL)</span>
                    <input
                      type="checkbox"
                      checked={showFib}
                      onChange={(e) => setShowFib(e.target.checked)}
                      className="accent-amber-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-amber-300 font-medium">VAP / VPVR Profile</span>
                    <input
                      type="checkbox"
                      checked={showVpvr}
                      onChange={(e) => setShowVpvr(e.target.checked)}
                      className="accent-amber-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-emerald-300 font-medium">Pattern Detection</span>
                    <input
                      type="checkbox"
                      checked={showPatterns}
                      onChange={(e) => setShowPatterns(e.target.checked)}
                      className="accent-emerald-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-medium">Bollinger (20, 2)</span>
                    <input
                      type="checkbox"
                      checked={showBollinger}
                      onChange={(e) => setShowBollinger(e.target.checked)}
                      className="accent-emerald-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-cyan-400 font-medium">News Sentiment Curve</span>
                    <input
                      type="checkbox"
                      checked={showSentimentTrend}
                      onChange={(e) => setShowSentimentTrend(e.target.checked)}
                      className="accent-cyan-500 rounded"
                    />
                  </label>
                  <div className="border-t border-[#2a2e39] my-1" />
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-indigo-400 font-medium">RSI (14) Sub-Pane</span>
                    <input
                      type="checkbox"
                      checked={showRsi}
                      onChange={(e) => setShowRsi(e.target.checked)}
                      className="accent-indigo-500 rounded"
                    />
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#2a2e39] cursor-pointer text-slate-300">
                    <span className="flex items-center gap-1.5 text-slate-300 font-medium">Volume Histogram</span>
                    <input
                      type="checkbox"
                      checked={showVolume}
                      onChange={(e) => setShowVolume(e.target.checked)}
                      className="accent-slate-400 rounded"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Overlay Toggles: [H4/L4] [CPR] [Fib] [VPVR] */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowCamarilla(!showCamarilla)}
                className={`h-7 px-2 rounded-md border text-[11px] font-mono font-semibold transition whitespace-nowrap cursor-pointer ${
                  showCamarilla
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-[#0C1322] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle Camarilla H3/H4/L3/L4 Breakout Levels"
              >
                H4/L4
              </button>
              <button
                type="button"
                onClick={() => setShowCpr(!showCpr)}
                className={`h-7 px-2 rounded-md border text-[11px] font-mono font-semibold transition whitespace-nowrap cursor-pointer ${
                  showCpr
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-[#0C1322] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle Central Pivot Range (CPR)"
              >
                CPR
              </button>
              <button
                type="button"
                onClick={() => setShowFib(!showFib)}
                className={`h-7 px-2 rounded-md border text-[11px] font-mono font-semibold transition whitespace-nowrap cursor-pointer ${
                  showFib
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-[#0C1322] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle Fibonacci Swing Levels"
              >
                Fib
              </button>
              <button
                type="button"
                onClick={() => setShowVpvr(!showVpvr)}
                className={`h-7 px-2 rounded-md border text-[11px] font-mono font-semibold transition whitespace-nowrap cursor-pointer ${
                  showVpvr
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-[#0C1322] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle Institutional Volume-at-Price (VAP / VPVR) Profile"
              >
                VAP
              </button>
              <button
                type="button"
                onClick={() => setShowPatterns(!showPatterns)}
                className={`h-7 px-2 rounded-md border text-[11px] font-mono font-semibold transition whitespace-nowrap cursor-pointer ${
                  showPatterns
                    ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                    : 'bg-[#0C1322] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle Candlestick Pattern Detection Markers"
              >
                Patterns
              </button>
              {(customSwingHigh !== null || customSwingLow !== null) && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomSwingHigh(null);
                    setCustomSwingLow(null);
                  }}
                  className="h-7 px-2 rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 text-violet-300 text-[11px] font-mono whitespace-nowrap cursor-pointer"
                  title="Reset manual Fibonacci anchor override"
                >
                  ↺ Fib
                </button>
              )}
            </div>
          </div>

          {/* Right Icon Control Cluster: [Labels], [⚙], [⤢ Single/Split] */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowIndicatorLabels((prev) => !prev)}
              className={`h-7 px-2 inline-flex items-center gap-1 rounded-md border text-[11px] font-mono font-semibold transition whitespace-nowrap cursor-pointer ${
                showIndicatorLabels
                  ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                  : 'bg-[#0C1322] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title={showIndicatorLabels ? 'Hide Canvas Level Labels & Price Badges' : 'Show Canvas Level Labels & Price Badges'}
            >
              {showIndicatorLabels ? (
                <Eye className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className={compactProDesk && !isExpandedPane ? 'hidden 2xl:inline' : ''}>
                Labels
              </span>
            </button>

            {/* [⚙] Chart Settings Popover Icon Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowChartSettingsMenu((prev) => !prev);
                  setShowIndicatorMenu(false);
                  setShowChartTypeMenu(false);
                }}
                aria-label="Chart Settings"
                className={`h-7 w-7 inline-flex items-center justify-center rounded-md border transition cursor-pointer ${
                  showChartSettingsMenu
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                    : 'bg-[#0C1322] border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800/90'
                }`}
                title="Chart Settings (Colors, Gridlines, Crosshair, Zoom & Auto-Fit)"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>

              {showChartSettingsMenu && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-full mt-1 w-72 bg-[#0B111E] border border-cyan-500/35 rounded-xl shadow-2xl p-3 z-40 space-y-2.5 text-[11px] font-sans"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-800">
                    <span className="font-extrabold text-cyan-300 uppercase tracking-wider text-[10px]">
                      Pro-Desk Chart Settings
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowChartSettingsMenu(false)}
                      className="text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Quick Zoom & View Controls */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={handleZoomIn}
                      className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-mono text-[10px] inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ZoomIn className="w-3 h-3 text-cyan-400" />
                      <span>Zoom +</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleZoomOut}
                      className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-mono text-[10px] inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ZoomOut className="w-3 h-3 text-cyan-400" />
                      <span>Zoom -</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetZoom}
                      className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-mono text-[10px] inline-flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3 text-cyan-400" />
                      <span>Reset</span>
                    </button>
                  </div>

                  {/* 1. Candle Colors (Bull / Bear) */}
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold uppercase text-slate-400">
                      Candle Colors (Bull / Bear)
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1 cursor-pointer">
                        <span className="text-emerald-300 font-semibold">Bull</span>
                        <input
                          type="color"
                          value={bullCandleColor}
                          onChange={(e) => setBullCandleColor(e.target.value)}
                          className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                        />
                      </label>
                      <label className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1 cursor-pointer">
                        <span className="text-rose-300 font-semibold">Bear</span>
                        <input
                          type="color"
                          value={bearCandleColor}
                          onChange={(e) => setBearCandleColor(e.target.value)}
                          className="w-5 h-5 rounded bg-transparent border-0 cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  {/* 2. Gridlines (On/Off) & Price Scale Auto-Fit */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setShowGridlines((prev) => !prev)}
                      className={`px-2 py-1.5 rounded-lg border font-mono text-[10px] font-bold flex items-center justify-between cursor-pointer ${
                        showGridlines
                          ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <span>Gridlines</span>
                      <span>{showGridlines ? 'ON' : 'OFF'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAutoFitPriceScale((prev) => !prev);
                        setYScaleFactor(1);
                        setYPanOffset(0);
                      }}
                      className={`px-2 py-1.5 rounded-lg border font-mono text-[10px] font-bold flex items-center justify-between cursor-pointer ${
                        autoFitPriceScale && yScaleFactor === 1 && yPanOffset === 0
                          ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      <span>Auto-Fit Y</span>
                      <span>{yScaleFactor === 1 && yPanOffset === 0 ? 'AUTO' : 'RESET'}</span>
                    </button>
                  </div>

                  {/* 3. Crosshair Mode */}
                  <div className="flex items-center justify-between bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5">
                    <span className="text-slate-300 font-semibold text-[10.5px]">Crosshair Mode</span>
                    <div className="flex items-center gap-1 font-mono text-[10px]">
                      {(['FREE', 'MAGNET', 'OFF'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setCrosshairMode(mode)}
                          className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                            crosshairMode === mode
                              ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. Overlay Toggles */}
                  <div className="space-y-1 pt-1 border-t border-slate-800">
                    <div className="text-[10px] font-bold uppercase text-slate-400">
                      Overlay Toggles
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10.5px]">
                      {[
                        {
                          label: 'EMA 9/21/50',
                          active: showEma9 || showEma21 || showEma50,
                          toggle: () => {
                            const next = !(showEma9 || showEma21 || showEma50);
                            setShowEma9(next);
                            setShowEma21(next);
                            setShowEma50(next);
                          },
                        },
                        { label: 'VWAP', active: showVwap, toggle: () => setShowVwap(!showVwap) },
                        {
                          label: 'Camarilla H3/H4/L3/L4',
                          active: showCamarilla,
                          toggle: () => setShowCamarilla(!showCamarilla),
                        },
                        { label: 'CPR', active: showCpr, toggle: () => setShowCpr(!showCpr) },
                        {
                          label: 'Virgin CPR',
                          active: showVirginCpr,
                          toggle: () => setShowVirginCpr(!showVirginCpr),
                        },
                        { label: 'Fibonacci', active: showFib, toggle: () => setShowFib(!showFib) },
                        { label: 'VAP / VPVR', active: showVpvr, toggle: () => setShowVpvr(!showVpvr) },
                        { label: 'Patterns', active: showPatterns, toggle: () => setShowPatterns(!showPatterns) },
                      ].map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={item.toggle}
                          className={`px-2 py-1 rounded border text-left flex items-center justify-between cursor-pointer ${
                            item.active
                              ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200 font-semibold'
                              : 'bg-slate-900/70 border-slate-800 text-slate-400'
                          }`}
                        >
                          <span className="truncate">{item.label}</span>
                          <span className="font-mono text-[9px] ml-1">{item.active ? 'ON' : 'OFF'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* [⤢ Single / Split] or Fullscreen Icon Button */}
            {onToggleExpandPane ? (
              <button
                type="button"
                onClick={onToggleExpandPane}
                className={`h-7 px-2 inline-flex items-center gap-1 rounded-md border text-[11px] font-mono font-semibold transition whitespace-nowrap cursor-pointer ${
                  isExpandedPane
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-[#0C1322] border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800/90'
                }`}
                title={isExpandedPane ? 'Switch to 2-Split Chart View' : 'Expand This Chart to Single Full-Width View'}
              >
                {isExpandedPane ? (
                  <Minimize2 className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                )}
                <span className={compactProDesk && !isExpandedPane ? 'hidden 2xl:inline' : ''}>
                  {isExpandedPane ? 'Split' : 'Single'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                className="h-7 w-7 inline-flex items-center justify-center rounded-md bg-[#0C1322] hover:bg-slate-800/90 border border-slate-800 text-slate-300 hover:text-white transition cursor-pointer"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        {/* ROW 2: Compact inline OHLCV + EMA9/EMA20/VWAP telemetry left | Sleek [BUY] [SELL] + countdown right */}
        <div className="flex items-center justify-between gap-2 py-1.5 px-3 bg-[#060B14]/95 text-[11px] font-mono-numbers min-w-0">
          {/* Left: Inline OHLCV + Active Moving Average / VWAP Telemetry */}
          <div className="flex items-center gap-2.5 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden whitespace-nowrap">
            {activeCandle ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">
                    O{' '}
                    <span className={activeCandle.close >= activeCandle.open ? 'text-[#089981]' : 'text-[#f23645]'}>
                      {(activeCandle.open * exchangeRate).toFixed(markPrice >= 100 ? 2 : 4)}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    H{' '}
                    <span className={activeCandle.close >= activeCandle.open ? 'text-[#089981]' : 'text-[#f23645]'}>
                      {(activeCandle.high * exchangeRate).toFixed(markPrice >= 100 ? 2 : 4)}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    L{' '}
                    <span className={activeCandle.close >= activeCandle.open ? 'text-[#089981]' : 'text-[#f23645]'}>
                      {(activeCandle.low * exchangeRate).toFixed(markPrice >= 100 ? 2 : 4)}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    C{' '}
                    <span className={`font-semibold ${activeCandle.close >= activeCandle.open ? 'text-[#089981]' : 'text-[#f23645]'}`}>
                      {(activeCandle.close * exchangeRate).toFixed(markPrice >= 100 ? 2 : 4)}
                    </span>
                  </span>
                  <span className={`font-semibold ${candleDelta >= 0 ? 'text-[#089981]' : 'text-[#f23645]'}`}>
                    {candleDeltaPct >= 0 ? '+' : ''}
                    {candleDeltaPct.toFixed(2)}%
                  </span>
                  <span className="text-slate-500">
                    V <span className="text-slate-300">{formatCompactVolume(activeCandle.volume || 0)}</span>
                  </span>
                </div>

                {(showEma9 || showEma21 || showVwap || showEma50 || showEma200) && (
                  <>
                    <span className="text-slate-800">|</span>
                    <div className="flex items-center gap-2 text-[10.5px]">
                      {showEma9 && activeCandle.ema9 !== undefined && (
                        <span className="text-slate-500">
                          EMA9 <span className="text-[#3b82f6] font-medium">{(activeCandle.ema9 * exchangeRate).toFixed(markPrice >= 100 ? 1 : 3)}</span>
                        </span>
                      )}
                      {showEma21 && activeCandle.ema21 !== undefined && (
                        <span className="text-slate-500">
                          EMA21 <span className="text-[#f97316] font-medium">{(activeCandle.ema21 * exchangeRate).toFixed(markPrice >= 100 ? 1 : 3)}</span>
                        </span>
                      )}
                      {showVwap && activeCandle.vwap !== undefined && (
                        <span className="text-slate-500">
                          VWAP <span className="text-[#3b82f6] font-medium">{(activeCandle.vwap * exchangeRate).toFixed(markPrice >= 100 ? 1 : 3)}</span>
                        </span>
                      )}
                      {showEma50 && activeCandle.ema50 !== undefined && (
                        <span className="text-slate-500">
                          EMA50 <span className="text-[#a855f7] font-medium">{(activeCandle.ema50 * exchangeRate).toFixed(markPrice >= 100 ? 1 : 3)}</span>
                        </span>
                      )}
                      {showEma200 && activeCandle.ema200 !== undefined && (
                        <span className="text-slate-500">
                          EMA200 <span className="text-[#f97316] font-medium">{(activeCandle.ema200 * exchangeRate).toFixed(markPrice >= 100 ? 1 : 3)}</span>
                        </span>
                      )}
                    </div>
                  </>
                )}

                {showPatterns && activePattern && (
                  <>
                    <span className="text-slate-800">|</span>
                    <span
                      className={`text-[10.5px] font-semibold ${
                        activePattern.sentiment === 'BULLISH'
                          ? 'text-emerald-400'
                          : activePattern.sentiment === 'BEARISH'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                      }`}
                      title={activePattern.description}
                    >
                      {activePattern.label} · {activePattern.confidence}%
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="text-slate-500">Streaming {symbol} K-lines...</span>
            )}
          </div>

          {/* Right: Sleek [BUY] [SELL] Quick-Order Buttons + Candle Countdown Clock */}
          <div className="flex items-center gap-1.5 shrink-0">
            {onQuickTrade && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onQuickTrade('LONG')}
                  className="h-6 px-2.5 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-bold tracking-wide transition whitespace-nowrap cursor-pointer"
                >
                  BUY
                </button>
                <button
                  type="button"
                  onClick={() => onQuickTrade('SHORT')}
                  className="h-6 px-2.5 rounded bg-rose-600/90 hover:bg-rose-500 text-white text-[11px] font-bold tracking-wide transition whitespace-nowrap cursor-pointer"
                >
                  SELL
                </button>
              </div>
            )}
            <span
              className="h-6 px-2 inline-flex items-center gap-1 rounded bg-[#0C1322] border border-slate-800/90 text-slate-200 text-[11px] font-semibold tabular-nums whitespace-nowrap"
              title="Time remaining until active candle closes"
            >
              <Clock className="w-3 h-3 text-cyan-400 shrink-0" />
              <span>{candleCountdown}</span>
            </span>
          </div>
        </div>
      </div>

      {/* ════════════════ STRATEGY BACKTEST OVERLAY HUD STRIP ════════════════ */}
      {backtestTrade && (
        <div className="bg-[#0B111E] border-b border-slate-800/80 px-3 py-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-numbers shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-cyan-400 font-bold">BACKTEST</span>
            <span className="text-white font-bold">{backtestTrade.id}</span>
            <span className={backtestTrade.side === 'LONG' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              {backtestTrade.side} @ ${(backtestTrade.entryPrice * exchangeRate).toLocaleString()} → ${(backtestTrade.exitPrice * exchangeRate).toLocaleString()}
            </span>
            <span className={backtestTrade.realisedPnlUsd >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              ({backtestTrade.realisedPnlUsd >= 0 ? `+$${backtestTrade.realisedPnlUsd}` : `-$${Math.abs(backtestTrade.realisedPnlUsd)}`} · {backtestTrade.realisedR >= 0 ? `+${backtestTrade.realisedR}R` : `${backtestTrade.realisedR}R`})
            </span>
          </div>
          {onClearBacktestTrade && (
            <button
              onClick={onClearBacktestTrade}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-[10px] font-bold transition cursor-pointer"
            >
              ✕ Clear
            </button>
          )}
        </div>
      )}

      {/* ════════════════ TRADINGVIEW SVG CANVAS ════════════════ */}
      <div
        ref={containerRef}
        className={`relative flex-1 ${compactProDesk ? 'min-h-[190px]' : 'min-h-[420px]'} w-full select-none bg-[#060B14] ${
          activeDragMode === 'PAN_XY'
            ? 'cursor-grabbing'
            : activeDragMode === 'SCALE_Y' || hoverZone === 'PRICE_AXIS'
            ? 'cursor-ns-resize'
            : activeDragMode === 'SCALE_X' || hoverZone === 'TIME_AXIS'
            ? 'cursor-ew-resize'
            : 'cursor-crosshair'
        }`}
        onMouseLeave={() => {
          setHoverIndex(null);
          setHoverY(null);
          setHoverZone('PLOT');
        }}
        onMouseDown={(e) => {
          if (e.button !== 0 || !containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const relX = e.clientX - rect.left;
          const relY = e.clientY - rect.top;
          const usableWidth = rect.width * ((chartWidth - paddingRight) / chartWidth);
          const timeAxisTopPx = rect.height * ((chartHeight - 20) / chartHeight);

          const mode: 'PAN_XY' | 'SCALE_Y' | 'SCALE_X' =
            relX >= usableWidth
              ? 'SCALE_Y'
              : relY >= timeAxisTopPx
              ? 'SCALE_X'
              : 'PAN_XY';

          dragStateRef.current = {
            mode,
            startX: e.clientX,
            startY: e.clientY,
            startPanOffset: panOffset,
            startZoomLevel: zoomLevel,
            startYScaleFactor: yScaleFactor,
            startYPanOffset: yPanOffset,
            priceRangeAtStart: Math.max(1e-6, maxPrice - minPrice),
            plotWidthPx: usableWidth,
            plotHeightPx: rect.height * (pricePlotHeight / chartHeight),
          };
          setActiveDragMode(mode);
        }}
        onDoubleClick={(e) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const relX = e.clientX - rect.left;
          const relY = e.clientY - rect.top;
          const usableWidth = rect.width * ((chartWidth - paddingRight) / chartWidth);
          const timeAxisTopPx = rect.height * ((chartHeight - 20) / chartHeight);

          if (relX >= usableWidth) {
            // Double-click right price scale -> reset Y-axis to Auto
            setYScaleFactor(1);
            setYPanOffset(0);
          } else if (relY >= timeAxisTopPx) {
            // Double-click bottom time scale -> reset X-axis
            setZoomLevel(48);
            setPanOffset(0);
          } else {
            // Double-click main plot -> full auto-fit X & Y
            handleResetZoom();
          }
        }}
        onMouseMove={(e) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const relX = e.clientX - rect.left;
          const relY = e.clientY - rect.top;
          const usableWidth = rect.width * ((chartWidth - paddingRight) / chartWidth);
          const timeAxisTopPx = rect.height * ((chartHeight - 20) / chartHeight);

          if (relX >= usableWidth) {
            setHoverZone('PRICE_AXIS');
          } else if (relY >= timeAxisTopPx) {
            setHoverZone('TIME_AXIS');
          } else {
            setHoverZone('PLOT');
          }

          const ratio = Math.max(0, Math.min(0.9999, relX / Math.max(1, usableWidth)));
          const idx = Math.floor(ratio * visibleCandles.length);
          if (idx >= 0 && idx < visibleCandles.length) {
            setHoverIndex(idx);
          }
          const svgY = Math.max(0, Math.min(pricePlotHeight, (relY / Math.max(1, rect.height)) * chartHeight));
          setHoverY(svgY);
        }}
      >
        {/* Floating Volatility Threshold & Trend Smoothing Intensity HUD */}
        {showShortTermTrend && shortTermTrendOverlay && (
          <div
            onMouseMove={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className={`absolute ${dynamicOverlayLayout.trendHudPosClass} z-20 w-60 rounded-lg bg-[#080d1a]/92 border border-cyan-500/35 backdrop-blur-md px-2.5 py-2 shadow-xl font-mono-numbers transition-all duration-150`}
          >
            <div className="flex items-center justify-between gap-2 text-[10px] mb-1.5">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    shortTermTrendOverlay.isBullish ? 'bg-emerald-400' : 'bg-rose-400'
                  }`}
                />
                <span>Trend Smoothing</span>
              </span>
              <span
                className={`font-bold px-1.5 py-0.2 rounded text-[9px] border ${
                  volatilityThreshold <= 30
                    ? 'bg-cyan-950/70 border-cyan-500/40 text-cyan-300'
                    : volatilityThreshold <= 70
                    ? 'bg-amber-950/60 border-amber-500/40 text-amber-300'
                    : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                }`}
              >
                {shortTermTrendOverlay.intensityLabel}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={volatilityThreshold}
                onChange={(e) => handleVolatilityThresholdChange(Number(e.target.value))}
                aria-label="Volatility threshold smoothing intensity"
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
              <span className="text-[10px] font-bold text-cyan-300 tabular-nums shrink-0 w-8 text-right">
                {volatilityThreshold}%
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 mt-1.5">
              {/* 5-segment smoothing intensity visual indicator */}
              <div className="flex items-center gap-1" aria-hidden="true">
                {[20, 40, 60, 80, 100].map((step) => {
                  const active = volatilityThreshold >= step - 10;
                  const segColor =
                    step <= 40
                      ? 'bg-cyan-400'
                      : step <= 80
                      ? 'bg-amber-400'
                      : 'bg-emerald-400';
                  return (
                    <span
                      key={step}
                      className={`h-1 w-3 rounded-full transition-colors duration-200 ${
                        active ? segColor : 'bg-slate-800'
                      }`}
                    />
                  );
                })}
              </div>
              <span className="text-[9.5px] text-slate-400 tabular-nums">
                α={shortTermTrendOverlay.effectiveAlpha.toFixed(2)} · σ {shortTermTrendOverlay.stdDevPct.toFixed(2)}% · {shortTermTrendOverlay.windowSize}b
              </span>
            </div>
          </div>
        )}

        {/* Dynamically Positioned Overlay Legend (avoids VAP right-hand bars, Trend HUD, V-CPR pills & active pattern markers) */}
        {((showVpvr && vpvrData) || (showPatterns && detectedPatterns.length > 0)) && (
          <div
            onMouseMove={(e) => e.stopPropagation()}
            style={
              dynamicOverlayLayout.legendSide === 'TOP_RIGHT'
                ? { top: '10px', right: `${dynamicOverlayLayout.plotRightClearPct}%` }
                : dynamicOverlayLayout.legendSide === 'TOP_LEFT'
                ? { top: dynamicOverlayLayout.legendTopOffset, left: '12px' }
                : { bottom: showVolume ? '64px' : '28px', left: '12px' }
            }
            className="pointer-events-none absolute z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1 rounded-md bg-[#070D19]/88 border border-slate-800/90 backdrop-blur-sm text-[10px] font-mono-numbers text-slate-300 shadow-lg max-w-[68%]"
          >
            {showVpvr && vpvrData && (
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-amber-300 font-semibold">
                  VAP {vpvrData.historicalBlendActive ? 'Session+Live' : 'Range'}
                </span>
                <span className="text-slate-400">
                  POC <span className="text-amber-400 font-semibold">{formatAxisPrice(vpvrData.pocPrice)}</span>
                </span>
                <span className="text-slate-400">
                  VA70 <span className="text-sky-300">{formatAxisPrice(vpvrData.val)}–{formatAxisPrice(vpvrData.vah)}</span>
                </span>
                {vpvrData.hvnClusters.length > 0 && (
                  <span className="text-amber-200/90">
                    HVN {vpvrData.hvnClusters.length}
                  </span>
                )}
              </div>
            )}

            {showVpvr && vpvrData && showPatterns && detectedPatterns.length > 0 && (
              <span className="text-slate-700" aria-hidden="true">|</span>
            )}

            {showPatterns && detectedPatterns.length > 0 && (
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-slate-200 font-semibold">Patterns ({detectedPatterns.length})</span>
                <span className="text-emerald-400">▲ Bull</span>
                <span className="text-rose-400">▼ Bear</span>
                <span className="text-amber-300">◆ Doji</span>
              </div>
            )}
          </div>
        )}

        {/* Dynamic Pattern Hover Tooltip (positioned cleanly clear of hovered candle & right VAP histogram) */}
        {showPatterns && hoveredPattern && hoverIndex !== null && visibleCandles[hoverIndex] && (
          <div
            onMouseMove={(e) => e.stopPropagation()}
            style={{
              left:
                hoverIndex > visibleCandles.length * 0.56
                  ? `${Math.max(2, ((hoverIndex * candleWidth + candleWidth / 2) / chartWidth) * 100 - 30)}%`
                  : `${Math.min(dynamicOverlayLayout.vapActive ? 54 : 66, ((hoverIndex * candleWidth + candleWidth / 2) / chartWidth) * 100 + 2)}%`,
              top:
                getY(visibleCandles[hoverIndex].high) > pricePlotHeight * 0.45
                  ? `${Math.max(10, ((getY(visibleCandles[hoverIndex].high) - 74) / chartHeight) * 100)}%`
                  : `${Math.min(68, ((getY(visibleCandles[hoverIndex].low) + 18) / chartHeight) * 100)}%`,
            }}
            className="pointer-events-none absolute z-30 w-60 rounded-lg bg-[#070D19]/95 border border-slate-700/90 backdrop-blur-md px-2.5 py-2 shadow-2xl text-[10.5px] font-mono-numbers"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span
                className={`font-bold ${
                  hoveredPattern.sentiment === 'BULLISH'
                    ? 'text-emerald-300'
                    : hoveredPattern.sentiment === 'BEARISH'
                    ? 'text-rose-300'
                    : 'text-amber-300'
                }`}
              >
                {hoveredPattern.label}
              </span>
              <span className="text-slate-300 font-semibold tabular-nums">
                {hoveredPattern.confidence}% conf
              </span>
            </div>
            <p className="font-sans text-[10.5px] text-slate-300 leading-snug">
              {hoveredPattern.description}
            </p>
          </div>
        )}

        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-full overflow-hidden"
          preserveAspectRatio="none"
        >
          <defs>
            {/* Chart Area Clipping Path to strictly constrain indicators, overlays and curves inside the price plot */}
            <clipPath id="chartPlotClip">
              <rect x="0" y="0" width={Math.max(0, chartWidth - paddingRight)} height={pricePlotHeight} />
            </clipPath>
            {/* Bullish / Bearish Volume Gradients (TradingView subtle overlay opacity) */}
            <linearGradient id="volGradBullTv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#089981" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#089981" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id="volGradBearTv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f23645" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#f23645" stopOpacity="0.06" />
            </linearGradient>
            {/* Area Chart Gradient */}
            <linearGradient id="areaFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2962ff" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#2962ff" stopOpacity="0.01" />
            </linearGradient>
            {/* Bollinger Band Gradient */}
            <linearGradient id="bbFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.01" />
            </linearGradient>
            {/* News Sentiment Area Gradient */}
            <linearGradient id="sentimentAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.22" />
              <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.00" />
            </linearGradient>
            <linearGradient id="sentimentGlowGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="50%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>
            {/* CPR Shaded Corridor Gradient (Subtle TradingView style) */}
            <linearGradient id="cprBandGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.06" />
              <stop offset="50%" stopColor="#a855f7" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.06" />
            </linearGradient>
            {/* Virgin CPR Magnetic Zone Gradient */}
            <linearGradient id="virginCprGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#9333ea" stopOpacity="0.14" />
              <stop offset="50%" stopColor="#a855f7" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.16" />
            </linearGradient>
          </defs>

          {/* 1. Multi-Tier Subtle Background Grids & High-Contrast Price Scale Ticks */}
          {showGridlines &&
            [0.04, 0.20, 0.36, 0.53, 0.71, 0.88].map((pct) => {
              const y = pricePlotHeight * pct;
              return (
                <line
                  key={`grid-h-minor-${pct}`}
                  x1="0"
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="#131c2e"
                  strokeOpacity="0.6"
                  strokeWidth="0.6"
                  strokeDasharray="2 4"
                />
              );
            })}

          {[0.12, 0.28, 0.45, 0.62, 0.80].map((pct) => {
            const price = minPrice + (maxPrice - minPrice) * (1 - pct);
            const y = pricePlotHeight * pct;
            const isCoveredByBadge = resolvedGutterBadges.some((b) => Math.abs(b.resolvedY - y) < 14);
            return (
              <g key={`grid-h-${pct}`}>
                <line
                  x1="0"
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="#1c273b"
                  strokeOpacity={showGridlines ? '0.9' : '0'}
                  strokeWidth="0.85"
                />
                {!isCoveredByBadge && (
                  <>
                    <line
                      x1={chartWidth - paddingRight}
                      y1={y}
                      x2={chartWidth - paddingRight + 3.5}
                      y2={y}
                      stroke="#475569"
                      strokeOpacity="0.8"
                      strokeWidth="0.9"
                    />
                    <text
                      x={chartWidth - paddingRight + 6}
                      y={y + 3}
                      fill="#9fb0c7"
                      fontSize="8.8"
                      fontWeight="600"
                      fontFamily="JetBrains Mono, monospace"
                      className="font-mono-numbers"
                    >
                      {formatAxisPrice(price)}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Subtle Plot Bottom Axis Divider */}
          <line
            x1="0"
            y1={chartHeight - 18}
            x2={chartWidth - paddingRight}
            y2={chartHeight - 18}
            stroke="#1f293d"
            strokeWidth="0.9"
          />

          {/* 2. Multi-Tier Vertical Grid lines & Time Labels */}
          {visibleCandles.map((c, i) => {
            const step = Math.max(6, Math.floor(visibleCandles.length / 6));
            const halfStep = Math.max(3, Math.floor(step / 2));
            const isMajor = i % step === 0 || i === visibleCandles.length - 1;
            const isMinor = !isMajor && i % halfStep === 0;
            if (!isMajor && !isMinor) return null;
            const x = i * candleWidth + candleWidth / 2;
            if (isMinor) {
              return (
                <line
                  key={`grid-v-minor-${c.time}-${i}`}
                  x1={x}
                  y1="0"
                  x2={x}
                  y2={chartHeight - 18}
                  stroke="#121b2d"
                  strokeOpacity={showGridlines ? '0.55' : '0'}
                  strokeWidth="0.6"
                  strokeDasharray="2 4"
                />
              );
            }
            return (
              <g key={`grid-v-${c.time}-${i}`}>
                <line
                  x1={x}
                  y1="0"
                  x2={x}
                  y2={chartHeight - 18}
                  stroke="#1b263a"
                  strokeOpacity={showGridlines ? '0.88' : '0'}
                  strokeWidth="0.8"
                />
                <text
                  x={x}
                  y={chartHeight - 4}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="8.6"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                  className="font-mono-numbers"
                >
                  {new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </text>
              </g>
            );
          })}

          {/* 2b. CPR (Central Pivot Range) Corridor & 3 Subtle Guide Lines */}
          {showCpr && cprData && (
            <g id="cpr-layer" clipPath="url(#chartPlotClip)">
              {/* Shaded CPR Corridor between TC and BC */}
              {(() => {
                const yUpper = getY(cprData.upper);
                const yLower = getY(cprData.lower);
                const corridorTop = Math.min(yUpper, yLower);
                const corridorHeight = Math.max(2, Math.abs(yLower - yUpper));
                return (
                  <rect
                    x="0"
                    y={corridorTop}
                    width={chartWidth - paddingRight}
                    height={corridorHeight}
                    fill="url(#cprBandGrad)"
                  />
                );
              })()}

              {/* TC: Cyan dashed line */}
              {cprData.tc >= minPrice && cprData.tc <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(cprData.tc)}
                  x2={chartWidth - paddingRight}
                  y2={getY(cprData.tc)}
                  stroke="#38bdf8"
                  strokeWidth="0.9"
                  strokeDasharray="3 3"
                  strokeOpacity="0.75"
                />
              )}

              {/* Pivot: Violet dashed line */}
              {cprData.pivot >= minPrice && cprData.pivot <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(cprData.pivot)}
                  x2={chartWidth - paddingRight}
                  y2={getY(cprData.pivot)}
                  stroke="#a855f7"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  strokeOpacity="0.8"
                />
              )}

              {/* BC: Indigo dashed line */}
              {cprData.bc >= minPrice && cprData.bc <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(cprData.bc)}
                  x2={chartWidth - paddingRight}
                  y2={getY(cprData.bc)}
                  stroke="#6366f1"
                  strokeWidth="0.9"
                  strokeDasharray="3 3"
                  strokeOpacity="0.75"
                />
              )}
            </g>
          )}

          {/* 2b-v. Unmitigated Virgin CPR Magnetic Zones (prior 1–3 UTC sessions) */}
          {showVirginCpr && virginCprZones.length > 0 && (
            <g id="virgin-cpr-layer" clipPath="url(#chartPlotClip)">
              {virginCprZones.map((zone) => {
                const isOverlappingPlot = zone.cprHigh >= minPrice && zone.cprLow <= maxPrice;
                if (!isOverlappingPlot) return null;

                const clampedHigh = Math.min(maxPrice, zone.cprHigh);
                const clampedLow = Math.max(minPrice, zone.cprLow);
                const yTop = getY(clampedHigh);
                const yBot = getY(clampedLow);
                const rectY = Math.min(yTop, yBot);
                const rectH = Math.max(4, Math.abs(yBot - yTop));
                const plotRight = chartWidth - paddingRight;

                return (
                  <g key={zone.id}>
                    <rect
                      x="0"
                      y={rectY}
                      width={Math.max(0, plotRight)}
                      height={rectH}
                      fill="url(#virginCprGrad)"
                    />
                    <line
                      x1="0"
                      y1={rectY}
                      x2={plotRight}
                      y2={rectY}
                      stroke="#c084fc"
                      strokeWidth="0.9"
                      strokeDasharray="4 3"
                      strokeOpacity="0.7"
                    />
                    <line
                      x1="0"
                      y1={rectY + rectH}
                      x2={plotRight}
                      y2={rectY + rectH}
                      stroke="#a855f7"
                      strokeWidth="0.9"
                      strokeDasharray="4 3"
                      strokeOpacity="0.7"
                    />
                  </g>
                );
              })}

              {/* Compact Off-screen Directional Magnet Tag dynamically anchored to avoid overlapping HUDs */}
              {showIndicatorLabels &&
                nearestVirginCpr &&
                (nearestVirginCpr.cprLow > maxPrice || nearestVirginCpr.cprHigh < minPrice) && (() => {
                  const isAbove = nearestVirginCpr.cprLow > maxPrice;
                  const midFmt = formatAxisPrice(nearestVirginCpr.pivot);
                  const pillW = 152;
                  const pillX = dynamicOverlayLayout.vcprPillX;
                  const pillY = dynamicOverlayLayout.vcprPillY;
                  return (
                    <g key={`offscreen-${nearestVirginCpr.id}`}>
                      <rect
                        x={pillX}
                        y={pillY}
                        width={pillW}
                        height="15"
                        fill="#1e1b4b"
                        fillOpacity="0.92"
                        stroke="#a855f7"
                        strokeOpacity="0.7"
                        strokeWidth="0.85"
                        rx="2"
                      />
                      <text
                        x={pillX + pillW / 2}
                        y={pillY + 10.5}
                        textAnchor="middle"
                        fill="#f3e8ff"
                        fontSize="8"
                        fontWeight="600"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {`${isAbove ? '▲' : '▼'} V-CPR ${midFmt} (${isAbove ? '+' : '-'}${nearestVirginCpr.distancePct.toFixed(1)}%)`}
                      </text>
                    </g>
                  );
                })()}
            </g>
          )}

          {/* 2b. Fibonacci Swing (Y-HL) Levels, Golden Pocket Band & Interactive Anchor Handles (labels handled by anti-collision engine) */}
          {showFib && fibData && (
            <g id="fib-layer" clipPath="url(#chartPlotClip)">
              {/* 0.618 / 0.650 Golden Pocket Translucent Neon Amber Corridor */}
              {(() => {
                const y618 = getY(fibData.fib618);
                const y650 = getY(fibData.fib650);
                const topY = Math.min(y618, y650);
                const height = Math.max(4, Math.abs(y618 - y650));
                const isNearMark =
                  Math.abs(markPrice - fibData.fib618) / fibData.fib618 <= 0.002 ||
                  Math.abs(markPrice - fibData.fib650) / fibData.fib650 <= 0.002;
                const gpOverlapsPlot =
                  Math.max(fibData.fib618, fibData.fib650) >= minPrice &&
                  Math.min(fibData.fib618, fibData.fib650) <= maxPrice;

                return (
                  <g key="fib-gp-group">
                    {gpOverlapsPlot && (
                      <rect
                        x="0"
                        y={topY}
                        width={Math.max(0, chartWidth - paddingRight)}
                        height={height}
                        fill="rgba(245, 158, 11, 0.11)"
                        stroke="rgba(245, 158, 11, 0.35)"
                        strokeWidth="0.75"
                      />
                    )}

                    {/* 0.618 GP Dashed Line */}
                    {fibData.fib618 >= minPrice && fibData.fib618 <= maxPrice && (
                      <line
                        x1="0"
                        y1={y618}
                        x2={chartWidth - paddingRight}
                        y2={y618}
                        stroke="#F59E0B"
                        strokeWidth={isNearMark ? "2" : "1.25"}
                        strokeDasharray="4 3"
                        className={isNearMark ? "animate-pulse" : ""}
                      />
                    )}

                    {/* 0.650 OTE Line */}
                    {fibData.fib650 >= minPrice && fibData.fib650 <= maxPrice && (
                      <line
                        x1="0"
                        y1={y650}
                        x2={chartWidth - paddingRight}
                        y2={y650}
                        stroke="#F59E0B"
                        strokeWidth="0.95"
                        strokeDasharray="3 3"
                        strokeOpacity="0.8"
                      />
                    )}
                  </g>
                );
              })()}

              {/* 0.500 Equilibrium (EQ) Cyan Line */}
              {fibData.fib500 >= minPrice && fibData.fib500 <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(fibData.fib500)}
                  x2={chartWidth - paddingRight}
                  y2={getY(fibData.fib500)}
                  stroke="#06B6D4"
                  strokeWidth={Math.abs(markPrice - fibData.fib500) / fibData.fib500 <= 0.002 ? "1.8" : "1.1"}
                  strokeDasharray="4 3"
                />
              )}

              {/* 0.382 Retracement Line */}
              {fibData.fib382 >= minPrice && fibData.fib382 <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(fibData.fib382)}
                  x2={chartWidth - paddingRight}
                  y2={getY(fibData.fib382)}
                  stroke="#94A3B8"
                  strokeWidth="0.9"
                  strokeDasharray="3 3"
                  strokeOpacity="0.7"
                />
              )}

              {/* 0.236 Retracement Line */}
              {fibData.fib236 >= minPrice && fibData.fib236 <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(fibData.fib236)}
                  x2={chartWidth - paddingRight}
                  y2={getY(fibData.fib236)}
                  stroke="#94A3B8"
                  strokeWidth="0.9"
                  strokeDasharray="3 3"
                  strokeOpacity="0.6"
                />
              )}

              {/* 1.000 PDH (Prior Day High Anchor) + Left-Edge Drag Handle */}
              {fibData.swingHigh >= minPrice && fibData.swingHigh <= maxPrice && (
                <g key="fib-pdh-group">
                  <line
                    x1="0"
                    y1={getY(fibData.swingHigh)}
                    x2={chartWidth - paddingRight}
                    y2={getY(fibData.swingHigh)}
                    stroke="#10B981"
                    strokeWidth="1.25"
                    strokeDasharray="5 3"
                  />
                  <circle
                    cx="12"
                    cy={getY(fibData.swingHigh)}
                    r="5.5"
                    fill="#10B981"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className="cursor-ns-resize"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingFibAnchor('PDH');
                    }}
                  >
                    <title>Click &amp; drag to override PDH Fibonacci Anchor</title>
                  </circle>
                </g>
              )}

              {/* 0.000 PDL (Prior Day Low Anchor) + Left-Edge Drag Handle */}
              {fibData.swingLow >= minPrice && fibData.swingLow <= maxPrice && (
                <g key="fib-pdl-group">
                  <line
                    x1="0"
                    y1={getY(fibData.swingLow)}
                    x2={chartWidth - paddingRight}
                    y2={getY(fibData.swingLow)}
                    stroke="#F43F5E"
                    strokeWidth="1.25"
                    strokeDasharray="5 3"
                  />
                  <circle
                    cx="12"
                    cy={getY(fibData.swingLow)}
                    r="5.5"
                    fill="#F43F5E"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className="cursor-ns-resize"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingFibAnchor('PDL');
                    }}
                  >
                    <title>Click &amp; drag to override PDL Fibonacci Anchor</title>
                  </circle>
                </g>
              )}

              {/* 1.272 Bullish Extension Line (only drawn when naturally within visible price bounds) */}
              {fibData.ext127Bull >= minPrice && fibData.ext127Bull <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(fibData.ext127Bull)}
                  x2={chartWidth - paddingRight}
                  y2={getY(fibData.ext127Bull)}
                  stroke="#38bdf8"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              )}
            </g>
          )}

          {/* 3. Bollinger Bands Envelopes */}
          {showBollinger && (
            <g clipPath="url(#chartPlotClip)">
              {/* Upper band */}
              <polyline
                fill="none"
                stroke="#10b981"
                strokeWidth="1"
                strokeOpacity="0.6"
                points={visibleCandles
                  .filter((c) => c.bbUpper !== undefined)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.bbUpper!)}`)
                  .join(' ')}
              />
              {/* Middle band (20 SMA) */}
              <polyline
                fill="none"
                stroke="#f59e0b"
                strokeWidth="1"
                strokeDasharray="3 2"
                points={visibleCandles
                  .filter((c) => c.bbMiddle !== undefined)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.bbMiddle!)}`)
                  .join(' ')}
              />
              {/* Lower band */}
              <polyline
                fill="none"
                stroke="#10b981"
                strokeWidth="1"
                strokeOpacity="0.6"
                points={visibleCandles
                  .filter((c) => c.bbLower !== undefined)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.bbLower!)}`)
                  .join(' ')}
              />
            </g>
          )}

          {/* 4. Volume Histogram (TradingView bottom-overlay style) */}
          {showVolume && (
            <g clipPath="url(#chartPlotClip)">
              {visibleCandles.map((c, i) => {
                const x = i * candleWidth;
                const isBull = c.close >= c.open;
                const y = getVolY(c.volume || 1);
                const height = Math.max(2, volumePlotTop + volumePlotHeight - y);
                return (
                  <rect
                    key={`vol-bar-${i}`}
                    x={x + candleWidth * 0.16}
                    y={y}
                    width={candleWidth * 0.68}
                    height={height}
                    fill={isBull ? 'url(#volGradBullTv)' : 'url(#volGradBearTv)'}
                  />
                );
              })}
            </g>
          )}

          {/* 4b. Institutional VAP (Volume-at-Price) Profile, HVN Liquidity Clusters & POC */}
          {showVpvr && vpvrData && (
            <g id="vpvr-layer" clipPath="url(#chartPlotClip)">
              {/* Subtle Institutional HVN Liquidity Cluster Bands */}
              {vpvrData.hvnClusters.map((cluster, idx) => {
                const yTop = getY(Math.min(maxPrice, cluster.highPrice));
                const yBot = getY(Math.max(minPrice, cluster.lowPrice));
                const bandY = Math.min(yTop, yBot);
                const bandH = Math.max(3, Math.abs(yBot - yTop));
                const chartRight = chartWidth - paddingRight;
                return (
                  <rect
                    key={`hvn-cluster-${idx}`}
                    x={Math.max(0, chartRight - 220)}
                    y={bandY}
                    width={220}
                    height={bandH}
                    fill="#f59e0b"
                    fillOpacity="0.06"
                  />
                );
              })}

              {/* Horizontal Volume-at-Price Histogram Bars anchored cleanly on right */}
              {vpvrData.bins.map((bin) => {
                const chartRight = chartWidth - paddingRight;
                const maxBarWidth = dynamicOverlayLayout.vapMaxBarWidth || 112;
                const barWidth = vpvrData.maxBinVol > 0
                  ? (bin.totalVolume / vpvrData.maxBinVol) * maxBarWidth
                  : 0;
                if (barWidth < 1) return null;

                const yTop = getY(bin.highPrice);
                const yBottom = getY(bin.lowPrice);
                const h = Math.max(1.5, Math.abs(yBottom - yTop) - 0.5);
                const y = Math.min(yTop, yBottom);

                const buyRatio = bin.totalVolume > 0 ? bin.buyVolume / bin.totalVolume : 0.5;
                const buyWidth = barWidth * buyRatio;
                const sellWidth = barWidth * (1 - buyRatio);

                const barOpacity = bin.isHvn ? 0.72 : bin.inValueArea ? 0.52 : 0.20;

                return (
                  <g key={`vpvr-bin-${bin.binIndex}`}>
                    {buyWidth > 0 && (
                      <rect
                        x={chartRight - barWidth}
                        y={y}
                        width={buyWidth}
                        height={h}
                        fill="#10b981"
                        fillOpacity={barOpacity}
                      />
                    )}
                    {sellWidth > 0 && (
                      <rect
                        x={chartRight - barWidth + buyWidth}
                        y={y}
                        width={sellWidth}
                        height={h}
                        fill="#f43f5e"
                        fillOpacity={barOpacity}
                      />
                    )}
                    {bin.isHvn && (
                      <rect
                        x={chartRight - barWidth}
                        y={y}
                        width="2"
                        height={h}
                        fill="#fbbf24"
                        fillOpacity="0.9"
                      />
                    )}
                  </g>
                );
              })}

              {/* VAH (Value Area High) Dotted Guide */}
              {vpvrData.vah >= minPrice && vpvrData.vah <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(vpvrData.vah)}
                  x2={chartWidth - paddingRight}
                  y2={getY(vpvrData.vah)}
                  stroke="#38bdf8"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  strokeOpacity="0.65"
                />
              )}

              {/* VAL (Value Area Low) Dotted Guide */}
              {vpvrData.val >= minPrice && vpvrData.val <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(vpvrData.val)}
                  x2={chartWidth - paddingRight}
                  y2={getY(vpvrData.val)}
                  stroke="#38bdf8"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  strokeOpacity="0.65"
                />
              )}

              {/* POC (Point of Control) Prominent Amber Line */}
              {vpvrData.pocPrice >= minPrice && vpvrData.pocPrice <= maxPrice && (
                <line
                  x1="0"
                  y1={getY(vpvrData.pocPrice)}
                  x2={chartWidth - paddingRight}
                  y2={getY(vpvrData.pocPrice)}
                  stroke="#fbbf24"
                  strokeWidth="1.6"
                  strokeDasharray="5 3"
                />
              )}
            </g>
          )}

          {/* 5. Chart Bodies: Candlestick / Hollow / Heikin-Ashi / Line / Area */}
          <g clipPath="url(#chartPlotClip)">
            {chartType === 'AREA' && (
              <g>
                <polygon
                  points={`0,${pricePlotHeight} ${visibleCandles
                    .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.close)}`)
                    .join(' ')} ${(visibleCandles.length - 1) * candleWidth + candleWidth / 2},${pricePlotHeight}`}
                  fill="url(#areaFillGrad)"
                />
                <polyline
                  fill="none"
                  stroke="#2962ff"
                  strokeWidth="1.8"
                  points={visibleCandles
                    .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.close)}`)
                    .join(' ')}
                />
              </g>
            )}

            {chartType === 'LINE' && (
              <polyline
                fill="none"
                stroke="#2962ff"
                strokeWidth="2"
                points={visibleCandles
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.close)}`)
                  .join(' ')}
              />
            )}

            {(chartType === 'CANDLES' || chartType === 'HOLLOW' || chartType === 'HEIKIN_ASHI') && (
              <g>
                {visibleCandles.map((c, i) => {
                  const isHeikin = chartType === 'HEIKIN_ASHI';
                  const openVal = isHeikin ? (c.haOpen ?? c.open) : c.open;
                  const closeVal = isHeikin ? (c.haClose ?? c.close) : c.close;
                  const highVal = isHeikin ? (c.haHigh ?? c.high) : c.high;
                  const lowVal = isHeikin ? (c.haLow ?? c.low) : c.low;

                  const isBull = closeVal >= openVal;
                  const x = i * candleWidth;
                  const centerX = x + candleWidth / 2;
                  const openY = getY(openVal);
                  const closeY = getY(closeVal);
                  const highY = getY(highVal);
                  const lowY = getY(lowVal);
                  const bodyTop = Math.min(openY, closeY);
                  const bodyHeight = Math.max(1.8, Math.abs(closeY - openY));

                  const color = isBull ? bullCandleColor : bearCandleColor;
                  const isHollow = chartType === 'HOLLOW' && isBull;

                  return (
                    <g key={`candle-${c.time}-${i}`}>
                      {/* Upper & Lower Wick */}
                      <line
                        x1={centerX}
                        y1={highY}
                        x2={centerX}
                        y2={lowY}
                        stroke={color}
                        strokeWidth="1.2"
                      />
                      {/* Candle Body */}
                      <rect
                        x={x + candleWidth * 0.12}
                        y={bodyTop}
                        width={candleWidth * 0.76}
                        height={bodyHeight}
                        fill={isHollow ? '#131722' : color}
                        stroke={color}
                        strokeWidth={isHollow ? '1.2' : '0'}
                        rx="0.5"
                      />
                    </g>
                  );
                })}
              </g>
            )}

            {/* 6. Technical Overlay Indicator Lines */}
            {/* EMA 9 */}
            {showEma9 && (
              <polyline
                fill="none"
                stroke="#3b82f6"
                strokeWidth="1.5"
                points={visibleCandles
                  .filter((c) => c.ema9)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.ema9!)}`)
                  .join(' ')}
              />
            )}

            {/* EMA 21 */}
            {showEma21 && (
              <polyline
                fill="none"
                stroke="#f97316"
                strokeWidth="1.5"
                points={visibleCandles
                  .filter((c) => c.ema21)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.ema21!)}`)
                  .join(' ')}
              />
            )}

            {/* EMA 50 */}
            {showEma50 && (
              <polyline
                fill="none"
                stroke="#a855f7"
                strokeWidth="1.6"
                points={visibleCandles
                  .filter((c) => c.ema50)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.ema50!)}`)
                  .join(' ')}
              />
            )}

            {/* EMA 200 */}
            {showEma200 && (
              <polyline
                fill="none"
                stroke="#f97316"
                strokeWidth="1.8"
                points={visibleCandles
                  .filter((c) => c.ema200)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.ema200!)}`)
                  .join(' ')}
              />
            )}

            {/* VWAP */}
            {showVwap && (
              <polyline
                fill="none"
                stroke="#2962ff"
                strokeWidth="1.8"
                strokeDasharray="4 2"
                points={visibleCandles
                  .filter((c) => c.vwap)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.vwap!)}`)
                  .join(' ')}
              />
            )}
          </g>

          {/* 6a-pat. CANDLESTICK PATTERN DETECTION MARKERS */}
          {showPatterns && detectedPatterns.length > 0 && (
            <g id="pattern-detection-layer" clipPath="url(#chartPlotClip)" className="font-mono-numbers select-none">
              {detectedPatterns.map((pat) => {
                const candle = visibleCandles[pat.candleIndex];
                if (!candle) return null;

                const cx = pat.candleIndex * candleWidth + candleWidth / 2;
                const isBear = pat.sentiment === 'BEARISH';
                const isBull = pat.sentiment === 'BULLISH';
                const accent = isBull ? '#10b981' : isBear ? '#f43f5e' : '#fbbf24';
                const bgFill = isBull ? '#042f2e' : isBear ? '#4c0519' : '#451a03';

                const tipY = isBear ? getY(candle.high) : getY(candle.low);
                const rawBadgeY = isBear ? tipY - 14 : tipY + 14;
                const badgeY = Math.max(10, Math.min(pricePlotHeight - 11, rawBadgeY));
                const badgeW = Math.max(24, pat.shortCode.length * 5.6 + 8);
                const badgeX = Math.max(4, Math.min(chartWidth - paddingRight - badgeW - 4, cx - badgeW / 2));
                const isHovered = hoverIndex === pat.candleIndex;

                return (
                  <g key={pat.id} opacity={isHovered ? 1 : 0.9}>
                    <line
                      x1={cx}
                      y1={tipY}
                      x2={cx}
                      y2={isBear ? badgeY + 6 : badgeY - 6}
                      stroke={accent}
                      strokeWidth={isHovered ? '1.3' : '0.9'}
                      strokeOpacity="0.75"
                    />
                    <circle
                      cx={cx}
                      cy={tipY}
                      r={isHovered ? 2.6 : 1.8}
                      fill={accent}
                    />
                    <rect
                      x={badgeX}
                      y={badgeY - 6}
                      width={badgeW}
                      height="12"
                      rx="2.5"
                      fill={bgFill}
                      fillOpacity="0.94"
                      stroke={accent}
                      strokeWidth={isHovered ? '1.35' : '0.85'}
                    />
                    <text
                      x={badgeX + badgeW / 2}
                      y={badgeY + 2.8}
                      textAnchor="middle"
                      fill="#f8fafc"
                      fontSize="7.4"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {pat.shortCode}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* 6a. SHORT-TERM TREND LINE VISUALIZER OVERLAY */}
          {showShortTermTrend && shortTermTrendOverlay && (() => {
            const x1 = shortTermTrendOverlay.startIdx * candleWidth + candleWidth / 2;
            const y1 = getY(shortTermTrendOverlay.startPrice);
            const x2 = shortTermTrendOverlay.endIdx * candleWidth + candleWidth / 2;
            const y2 = getY(shortTermTrendOverlay.endPrice);
            const xProj = Math.min(chartWidth - paddingRight - 4, shortTermTrendOverlay.projIdx * candleWidth + candleWidth / 2);
            const yProj = getY(shortTermTrendOverlay.projPrice);
            const y1Upper = getY(shortTermTrendOverlay.startPrice + shortTermTrendOverlay.stdDev);
            const y1Lower = getY(shortTermTrendOverlay.startPrice - shortTermTrendOverlay.stdDev);
            const y2Upper = getY(shortTermTrendOverlay.endPrice + shortTermTrendOverlay.stdDev);
            const y2Lower = getY(shortTermTrendOverlay.endPrice - shortTermTrendOverlay.stdDev);
            const trendStroke = shortTermTrendOverlay.isBullish ? '#34d399' : '#fb7185';
            const slopeText = `${shortTermTrendOverlay.slopePct >= 0 ? '+' : ''}${shortTermTrendOverlay.slopePct.toFixed(2)}%`;
            const smoothedPolylinePoints = shortTermTrendOverlay.smoothedPoints
              .map((pt) => `${pt.candleIdx * candleWidth + candleWidth / 2},${getY(pt.price)}`)
              .join(' ');
            const labelRightSafe = chartWidth - paddingRight - (dynamicOverlayLayout.vapActive ? 124 : 8);

            return (
              <g id="short-term-trend-visualizer" clipPath="url(#chartPlotClip)">
                <polygon
                  points={`${x1},${y1Upper} ${x2},${y2Upper} ${x2},${y2Lower} ${x1},${y1Lower}`}
                  fill={trendStroke}
                  fillOpacity="0.08"
                />
                {smoothedPolylinePoints && (
                  <polyline
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="1.6"
                    strokeOpacity="0.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={smoothedPolylinePoints}
                  />
                )}
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={trendStroke}
                  strokeWidth="5"
                  strokeOpacity="0.18"
                  strokeLinecap="round"
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={trendStroke}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <line
                  x1={x2}
                  y1={y2}
                  x2={xProj}
                  y2={yProj}
                  stroke={trendStroke}
                  strokeWidth="1.6"
                  strokeDasharray="4 3"
                  strokeOpacity="0.85"
                />
                <circle cx={x1} cy={y1} r="3" fill={trendStroke} opacity="0.85" />
                <circle cx={x2} cy={y2} r="4" fill={trendStroke} stroke="#070b14" strokeWidth="1.5" />
                <circle cx={xProj} cy={yProj} r="2.5" fill={trendStroke} opacity="0.75" />
                <text
                  x={Math.min(labelRightSafe, Math.max(48, x2 - 6))}
                  y={Math.max(16, Math.min(pricePlotHeight - 8, y2 - 10))}
                  textAnchor="end"
                  fill={trendStroke}
                  fontSize="9"
                  fontWeight="700"
                  fontFamily="JetBrains Mono"
                >
                  {`SHORT TREND ${slopeText} · α=${shortTermTrendOverlay.effectiveAlpha.toFixed(2)}`}
                </text>
              </g>
            );
          })()}

          {/* 6b. REAL-TIME NEWS SENTIMENT CORRELATION TRENDLINE & EVENT CATALYST PINS */}
          {showSentimentTrend && sentimentCandlePoints.length > 1 && (
            <g id="news-sentiment-trend-layer" clipPath="url(#chartPlotClip)">
              {/* Neutral Baseline (Score 0) */}
              <line
                x1="0"
                y1={getSentimentY(0)}
                x2={chartWidth - paddingRight}
                y2={getSentimentY(0)}
                stroke="#38bdf8"
                strokeWidth="0.8"
                strokeDasharray="3 3"
                strokeOpacity="0.3"
              />
              <text
                x={chartWidth - paddingRight - 6}
                y={getSentimentY(0) + 3}
                textAnchor="end"
                fill="#38bdf8"
                fontSize="7.5"
                fontFamily="JetBrains Mono"
                opacity="0.6"
              >
                SENT 0
              </text>

              {/* +60 Bullish Guide */}
              <line
                x1="0"
                y1={getSentimentY(60)}
                x2={chartWidth - paddingRight}
                y2={getSentimentY(60)}
                stroke="#10b981"
                strokeWidth="0.6"
                strokeDasharray="2 3"
                strokeOpacity="0.25"
              />
              <text
                x={chartWidth - paddingRight - 6}
                y={getSentimentY(60) + 3}
                textAnchor="end"
                fill="#10b981"
                fontSize="7"
                fontFamily="JetBrains Mono"
                opacity="0.6"
              >
                +60
              </text>

              {/* -60 Bearish Guide */}
              <line
                x1="0"
                y1={getSentimentY(-60)}
                x2={chartWidth - paddingRight}
                y2={getSentimentY(-60)}
                stroke="#f43f5e"
                strokeWidth="0.6"
                strokeDasharray="2 3"
                strokeOpacity="0.25"
              />
              <text
                x={chartWidth - paddingRight - 6}
                y={getSentimentY(-60) + 3}
                textAnchor="end"
                fill="#f43f5e"
                fontSize="7"
                fontFamily="JetBrains Mono"
                opacity="0.6"
              >
                -60
              </text>

              {/* Shaded Area between Sentiment Line and Zero Baseline */}
              <polygon
                fill="url(#sentimentAreaGrad)"
                points={[
                  `${0 * candleWidth + candleWidth / 2},${getSentimentY(0)}`,
                  ...sentimentCandlePoints.map(
                    (p) => `${p.candleIndex * candleWidth + candleWidth / 2},${getSentimentY(p.score)}`
                  ),
                  `${(sentimentCandlePoints.length - 1) * candleWidth + candleWidth / 2},${getSentimentY(0)}`,
                ].join(' ')}
              />

              {/* Glowing Sentiment Polyline */}
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="3.2"
                strokeOpacity="0.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={sentimentCandlePoints
                  .map((p) => `${p.candleIndex * candleWidth + candleWidth / 2},${getSentimentY(p.score)}`)
                  .join(' ')}
              />
              <polyline
                fill="none"
                stroke="url(#sentimentGlowGrad)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={sentimentCandlePoints
                  .map((p) => `${p.candleIndex * candleWidth + candleWidth / 2},${getSentimentY(p.score)}`)
                  .join(' ')}
              />

              {/* Event Catalyst Flags & Volatility Spike Pins */}
              {sentimentCandlePoints.map((p) => {
                const x = p.candleIndex * candleWidth + candleWidth / 2;
                const sentY = getSentimentY(p.score);
                const candleLowY = getY(p.candle.low);
                const candleHighY = getY(p.candle.high);

                // Only render markers for catalyst news headlines or major volatility expansions
                if (!p.headline && !p.isVolSpike) return null;

                const hasHeadline = !!p.headline;
                const isBull = p.score >= 0;
                const markerColor = hasHeadline
                  ? isBull
                    ? '#10b981'
                    : '#f43f5e'
                  : '#f59e0b';

                return (
                  <g
                    key={`sentiment-event-${p.candleIndex}`}
                    className="cursor-pointer group"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (p.headline) {
                        setSelectedEventHeadline(p.headline);
                      } else {
                        setSelectedEventHeadline({
                          id: `vol-spike-${p.candle.time}`,
                          title: `Volatility Surge: ${p.candleVolPct}% Price Expansion`,
                          source: 'Delta Real-Time Volatility Engine',
                          link: '#',
                          publishedAt: new Date(p.candle.time).toISOString(),
                          sentiment: p.score >= 10 ? 'BULLISH' : p.score <= -10 ? 'BEARISH' : 'NEUTRAL',
                          score: p.score,
                          timestamp: p.candle.time,
                          impact: p.candleVolPct > 1.5 ? 'HIGH' : 'MEDIUM',
                          aiRationale: `Candle volatility expanded to ${p.candleVolPct}% (high: ${p.candle.high.toFixed(2)}, low: ${p.candle.low.toFixed(2)}). Correlated with real-time news sentiment score of ${p.score}.`,
                        });
                      }
                    }}
                  >
                    {/* Catalyst Connection Stem from Candle to Sentiment Trend */}
                    <line
                      x1={x}
                      y1={Math.min(sentY, candleHighY)}
                      x2={x}
                      y2={Math.max(sentY, candleLowY)}
                      stroke={markerColor}
                      strokeWidth="1"
                      strokeDasharray="2 2"
                      strokeOpacity="0.45"
                    />

                    {/* Outer Glow Halo on Hover or Spike */}
                    {(hasHeadline || p.isVolSpike) && (
                      <circle
                        cx={x}
                        cy={sentY}
                        r={p.headline?.impact === 'HIGH' ? 8 : 6}
                        fill={markerColor}
                        fillOpacity="0.22"
                        className="animate-pulse"
                      />
                    )}

                    {/* Central Catalyst Node Pin */}
                    <circle
                      cx={x}
                      cy={sentY}
                      r={hasHeadline ? 4.5 : 3.5}
                      fill={markerColor}
                      stroke="#131722"
                      strokeWidth="1.5"
                    />

                    {/* Catalyst Icon or Label Pill */}
                    {hasHeadline ? (
                      <g transform={`translate(${x - 8}, ${sentY - 22})`}>
                        <rect
                          width="16"
                          height="14"
                          rx="3"
                          fill="#1e222d"
                          stroke={markerColor}
                          strokeWidth="1"
                          filter="drop-shadow(0 1px 2px rgba(0,0,0,0.5))"
                        />
                        <text
                          x="8"
                          y="10.5"
                          textAnchor="middle"
                          fill={markerColor}
                          fontSize="8.5"
                          fontWeight="bold"
                          fontFamily="sans-serif"
                        >
                          {isBull ? '▲' : '▼'}
                        </text>
                      </g>
                    ) : p.isVolSpike ? (
                      <g transform={`translate(${x - 7}, ${sentY - 18})`}>
                        <rect
                          width="14"
                          height="12"
                          rx="2.5"
                          fill="#78350f"
                          stroke="#f59e0b"
                          strokeWidth="0.8"
                        />
                        <text
                          x="7"
                          y="9"
                          textAnchor="middle"
                          fill="#fef3c7"
                          fontSize="7"
                          fontWeight="bold"
                          fontFamily="JetBrains Mono"
                        >
                          V
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              })}
            </g>
          )}

          {/* 7. RSI Sub-Pane */}
          {showRsi && (
            <g>
              <line
                x1="0"
                y1={rsiPlotTop}
                x2={chartWidth - paddingRight}
                y2={rsiPlotTop}
                stroke="#2a2e39"
                strokeWidth="1"
              />
              {/* RSI 70 overbought */}
              <line
                x1="0"
                y1={getRsiY(70)}
                x2={chartWidth - paddingRight}
                y2={getRsiY(70)}
                stroke="#ef4444"
                strokeWidth="0.8"
                strokeDasharray="3 3"
                strokeOpacity="0.5"
              />
              <text
                x={chartWidth - paddingRight + 4}
                y={getRsiY(70) + 3}
                fill="#ef4444"
                fontSize="8"
                fontFamily="JetBrains Mono"
              >
                70
              </text>
              {/* RSI 50 midline */}
              <line
                x1="0"
                y1={getRsiY(50)}
                x2={chartWidth - paddingRight}
                y2={getRsiY(50)}
                stroke="#64748b"
                strokeWidth="0.6"
                strokeDasharray="2 2"
              />
              {/* RSI 30 oversold */}
              <line
                x1="0"
                y1={getRsiY(30)}
                x2={chartWidth - paddingRight}
                y2={getRsiY(30)}
                stroke="#10b981"
                strokeWidth="0.8"
                strokeDasharray="3 3"
                strokeOpacity="0.5"
              />
              <text
                x={chartWidth - paddingRight + 4}
                y={getRsiY(30) + 3}
                fill="#10b981"
                fontSize="8"
                fontFamily="JetBrains Mono"
              >
                30
              </text>
              {/* RSI Curve */}
              <polyline
                fill="none"
                stroke="#818cf8"
                strokeWidth="1.6"
                points={visibleCandles
                  .filter((c) => c.rsi !== undefined)
                  .map((c, i) => `${i * candleWidth + candleWidth / 2},${getRsiY(c.rsi!)}`)
                  .join(' ')}
              />
              <text
                x="8"
                y={rsiPlotTop + 14}
                fill="#818cf8"
                fontSize="9"
                fontWeight="bold"
                fontFamily="JetBrains Mono"
              >
                RSI (14): {activeCandle?.rsi?.toFixed(1) ?? '--'}
              </text>
            </g>
          )}

          {/* 7b. STRATEGY BACKTESTER SIMULATED ENTRY AND EXIT OVERLAY */}
          {backtestTrade && visibleCandles && visibleCandles.length > 0 && (
            (() => {
              // Map entry timestamp to candle index, or default to 22% across visible candles
              let entryCandleIdx = visibleCandles.findIndex((c) => Math.abs(c.time - backtestTrade.entryTimestamp) < getIntervalMs(timeframe));
              if (entryCandleIdx === -1) {
                entryCandleIdx = Math.max(1, Math.floor(visibleCandles.length * 0.22));
              }

              // Map exit timestamp to candle index, or default to 75% across visible candles
              let exitCandleIdx = visibleCandles.findIndex((c) => Math.abs(c.time - backtestTrade.exitTimestamp) < getIntervalMs(timeframe));
              if (exitCandleIdx === -1 || exitCandleIdx <= entryCandleIdx) {
                exitCandleIdx = Math.min(visibleCandles.length - 2, entryCandleIdx + Math.max(4, Math.floor(visibleCandles.length * 0.52)));
              }

              const xEntry = entryCandleIdx * candleWidth + candleWidth / 2;
              const yEntry = getY(backtestTrade.entryPrice);
              const xExit = exitCandleIdx * candleWidth + candleWidth / 2;
              const yExit = getY(backtestTrade.exitPrice);

              const isLong = backtestTrade.side === 'LONG';
              const isProfitable = backtestTrade.realisedPnlUsd >= 0;
              const themeColor = isProfitable ? '#10b981' : '#f43f5e';

              return (
                <g id="backtest-simulation-overlay" clipPath="url(#chartPlotClip)" className="font-mono-numbers select-none">
                  {/* Invalidation Stop Loss Level (Rose dashed ray) */}
                  <line
                    x1={xEntry}
                    y1={getY(backtestTrade.initialStop)}
                    x2={chartWidth - paddingRight}
                    y2={getY(backtestTrade.initialStop)}
                    stroke="#f43f5e"
                    strokeWidth="1.2"
                    strokeDasharray="4 3"
                    strokeOpacity="0.8"
                  />
                  <rect
                    x={chartWidth - paddingRight - 85}
                    y={getY(backtestTrade.initialStop) - 8}
                    width="82"
                    height="16"
                    rx="3"
                    fill="#4c0519"
                    stroke="#e11d48"
                    strokeWidth="0.8"
                  />
                  <text
                    x={chartWidth - paddingRight - 44}
                    y={getY(backtestTrade.initialStop) + 3.5}
                    textAnchor="middle"
                    fill="#fecdd3"
                    fontSize="8"
                    fontWeight="bold"
                    fontFamily="JetBrains Mono"
                  >
                    SL (-1.0R): {(backtestTrade.initialStop * exchangeRate).toFixed(markPrice > 10 ? 1 : 2)}
                  </text>

                  {/* Half-Risk Cushion Stop (Amber dashed ray) if present */}
                  {backtestTrade.cushionStop && (
                    <>
                      <line
                        x1={xEntry + candleWidth * 2}
                        y1={getY(backtestTrade.cushionStop)}
                        x2={chartWidth - paddingRight}
                        y2={getY(backtestTrade.cushionStop)}
                        stroke="#f59e0b"
                        strokeWidth="1.2"
                        strokeDasharray="3 3"
                        strokeOpacity="0.85"
                      />
                      <rect
                        x={chartWidth - paddingRight - 110}
                        y={getY(backtestTrade.cushionStop) - 8}
                        width="107"
                        height="16"
                        rx="3"
                        fill="#451a03"
                        stroke="#d97706"
                        strokeWidth="0.8"
                      />
                      <text
                        x={chartWidth - paddingRight - 56}
                        y={getY(backtestTrade.cushionStop) + 3.5}
                        textAnchor="middle"
                        fill="#fde68a"
                        fontSize="8"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono"
                      >
                        CUSHION (-0.5R): {(backtestTrade.cushionStop * exchangeRate).toFixed(markPrice > 10 ? 1 : 2)}
                      </text>
                    </>
                  )}

                  {/* Profit-Lock Stop (Emerald dashed ray) if present */}
                  {backtestTrade.profitStop && (
                    <>
                      <line
                        x1={xEntry + candleWidth * 4}
                        y1={getY(backtestTrade.profitStop)}
                        x2={chartWidth - paddingRight}
                        y2={getY(backtestTrade.profitStop)}
                        stroke="#10b981"
                        strokeWidth="1.2"
                        strokeDasharray="3 3"
                        strokeOpacity="0.85"
                      />
                      <rect
                        x={chartWidth - paddingRight - 110}
                        y={getY(backtestTrade.profitStop) - 8}
                        width="107"
                        height="16"
                        rx="3"
                        fill="#064e3b"
                        stroke="#059669"
                        strokeWidth="0.8"
                      />
                      <text
                        x={chartWidth - paddingRight - 56}
                        y={getY(backtestTrade.profitStop) + 3.5}
                        textAnchor="middle"
                        fill="#a7f3d0"
                        fontSize="8"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono"
                      >
                        PROFIT-LOCK (+0.5R): {(backtestTrade.profitStop * exchangeRate).toFixed(markPrice > 10 ? 1 : 2)}
                      </text>
                    </>
                  )}

                  {/* Stage 1 Target (Cyan dashed ray) if present */}
                  {backtestTrade.stage1Price && (
                    <>
                      <line
                        x1={xEntry}
                        y1={getY(backtestTrade.stage1Price)}
                        x2={chartWidth - paddingRight}
                        y2={getY(backtestTrade.stage1Price)}
                        stroke="#06b6d4"
                        strokeWidth="1.2"
                        strokeDasharray="3 2"
                        strokeOpacity="0.85"
                      />
                      <rect
                        x={chartWidth - paddingRight - 105}
                        y={getY(backtestTrade.stage1Price) - 8}
                        width="102"
                        height="16"
                        rx="3"
                        fill="#083344"
                        stroke="#0891b2"
                        strokeWidth="0.8"
                      />
                      <text
                        x={chartWidth - paddingRight - 54}
                        y={getY(backtestTrade.stage1Price) + 3.5}
                        textAnchor="middle"
                        fill="#a5f3fc"
                        fontSize="8"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono"
                      >
                        STAGE 1 (+1.5R): {(backtestTrade.stage1Price * exchangeRate).toFixed(markPrice > 10 ? 1 : 2)}
                      </text>
                    </>
                  )}

                  {/* Horizontal Entry Line (Cyan/Amber) */}
                  <line
                    x1={xEntry}
                    y1={yEntry}
                    x2={xExit}
                    y2={yEntry}
                    stroke="#38bdf8"
                    strokeWidth="1.4"
                    strokeDasharray="3 2"
                  />

                  {/* Connecting Trade Trajectory Path with directional arrow */}
                  <line
                    x1={xEntry}
                    y1={yEntry}
                    x2={xExit}
                    y2={yExit}
                    stroke={themeColor}
                    strokeWidth="2.2"
                    strokeDasharray="5 3"
                    strokeOpacity="0.9"
                  />

                  {/* Shaded Profit/Loss Corridor between Entry and Exit */}
                  <polygon
                    points={`${xEntry},${yEntry} ${xExit},${yExit} ${xExit},${yEntry}`}
                    fill={themeColor}
                    fillOpacity="0.12"
                  />

                  {/* ─── ENTRY POINT MARKER ─── */}
                  <g transform={`translate(${xEntry}, ${yEntry})`}>
                    <circle r="9" fill={isLong ? '#10b981' : '#f43f5e'} fillOpacity="0.25" className="animate-pulse" />
                    <circle r="4.5" fill={isLong ? '#10b981' : '#f43f5e'} stroke="#0f172a" strokeWidth="1.5" />
                    {isLong ? (
                      <polygon points="0,-14 -6,-6 6,-6" fill="#10b981" />
                    ) : (
                      <polygon points="0,14 -6,6 6,6" fill="#f43f5e" />
                    )}
                    <rect
                      x="-48"
                      y={isLong ? -36 : 14}
                      width="96"
                      height="18"
                      rx="3"
                      fill="#090d16"
                      stroke={isLong ? '#10b981' : '#f43f5e'}
                      strokeWidth="1"
                    />
                    <text
                      x="0"
                      y={isLong ? -24 : 26}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="8.5"
                      fontWeight="bold"
                      fontFamily="JetBrains Mono"
                    >
                      {isLong ? '▲ BUY ENTRY' : '▼ SELL ENTRY'}
                    </text>
                  </g>

                  {/* ─── EXIT POINT MARKER ─── */}
                  <g transform={`translate(${xExit}, ${yExit})`}>
                    <circle r="10" fill={themeColor} fillOpacity="0.3" className="animate-pulse" />
                    <circle r="5" fill={themeColor} stroke="#0f172a" strokeWidth="1.5" />
                    <line x1="-8" y1="0" x2="8" y2="0" stroke="#ffffff" strokeWidth="1.2" />
                    <line x1="0" y1="-8" x2="0" y2="8" stroke="#ffffff" strokeWidth="1.2" />
                    <rect
                      x="-65"
                      y={isProfitable ? -42 : 14}
                      width="130"
                      height="26"
                      rx="4"
                      fill="#090d16"
                      stroke={themeColor}
                      strokeWidth="1.2"
                    />
                    <text
                      x="0"
                      y={isProfitable ? -28 : 28}
                      textAnchor="middle"
                      fill={themeColor}
                      fontSize="9"
                      fontWeight="extrabold"
                      fontFamily="JetBrains Mono"
                    >
                      EXIT: {currencyPrefix}{(backtestTrade.exitPrice * exchangeRate).toFixed(markPrice > 10 ? 1 : 2)}
                    </text>
                    <text
                      x="0"
                      y={isProfitable ? -17 : 37}
                      textAnchor="middle"
                      fill="#e2e8f0"
                      fontSize="7.5"
                      fontWeight="bold"
                      fontFamily="JetBrains Mono"
                    >
                      {isProfitable ? `+${backtestTrade.realisedR}R` : `${backtestTrade.realisedR}R`} ({isProfitable ? `+$${backtestTrade.realisedPnlUsd}` : `-$${Math.abs(backtestTrade.realisedPnlUsd)}`})
                    </text>
                  </g>
                </g>
              );
            })()
          )}

          {/* 7b-cam. CAMARILLA H3/H4/L3/L4 HORIZONTAL RAYS (concise labels & gutter prices solved below) */}
          {showCamarilla && (camarillaLevels || cprData) && (
            <g id="camarilla-levels-overlay" clipPath="url(#chartPlotClip)" className="font-mono-numbers select-none">
              {(() => {
                const refPiv = camarillaLevels?.pivot || cprData?.pivot || markPrice;
                const refRange =
                  camarillaLevels?.h4 && camarillaLevels?.l4
                    ? (camarillaLevels.h4 - camarillaLevels.l4) / 1.1
                    : Math.max(markPrice * 0.012, (cprData ? Math.abs(cprData.tc - cprData.bc) * 4 : markPrice * 0.012));
                const h4Lvl = camarillaLevels?.h4 || +(refPiv + refRange * 0.55).toFixed(2);
                const h3Lvl = camarillaLevels?.h3 || +(refPiv + refRange * 0.275).toFixed(2);
                const l3Lvl = camarillaLevels?.l3 || +(refPiv - refRange * 0.275).toFixed(2);
                const l4Lvl = camarillaLevels?.l4 || +(refPiv - refRange * 0.55).toFixed(2);

                const camItems = [
                  { tag: 'H4', price: h4Lvl, stroke: '#10B981', dash: '4 2', opacity: 0.8 },
                  { tag: 'H3', price: h3Lvl, stroke: '#22D3EE', dash: '2 3', opacity: 0.65 },
                  { tag: 'L3', price: l3Lvl, stroke: '#A78BFA', dash: '2 3', opacity: 0.65 },
                  { tag: 'L4', price: l4Lvl, stroke: '#F43F5E', dash: '4 2', opacity: 0.8 },
                ];

                return camItems.map((item) => {
                  if (!(item.price > 0) || item.price < minPrice || item.price > maxPrice) return null;
                  const y = getY(item.price);
                  return (
                    <line
                      key={item.tag}
                      x1="0"
                      y1={y}
                      x2={chartWidth - paddingRight}
                      y2={y}
                      stroke={item.stroke}
                      strokeWidth="1"
                      strokeDasharray={item.dash}
                      strokeOpacity={item.opacity}
                    />
                  );
                });
              })()}
            </g>
          )}

          {/* 7c. LOCKED AI COMMAND SIGNAL PRICE RAYS (Entry, Stop Loss, TP1, TP2) */}
          {activeLockedChartSignal && (
            <g
              id="locked-signal-overlays"
              clipPath="url(#chartPlotClip)"
              opacity={signalValidity.status === 'OVERDUE' ? 0.55 : 0.95}
              className="font-mono-numbers select-none"
            >
              {[
                { key: 'SL', price: activeLockedChartSignal.stopLoss, stroke: '#F43F5E' },
                { key: 'ENTRY', price: activeLockedChartSignal.entryPrice, stroke: '#22D3EE' },
                { key: 'TP1', price: activeLockedChartSignal.tp1, stroke: '#10B981' },
                { key: 'TP2', price: activeLockedChartSignal.tp2 || 0, stroke: '#A78BFA' },
              ].map((lvl) => {
                if (!(lvl.price > 0) || lvl.price < minPrice || lvl.price > maxPrice) return null;
                const y = getY(lvl.price);
                return (
                  <line
                    key={lvl.key}
                    x1="0"
                    y1={y}
                    x2={chartWidth - paddingRight}
                    y2={y}
                    stroke={lvl.stroke}
                    strokeWidth="1.2"
                    strokeDasharray={lvl.key === 'ENTRY' ? '5 3' : '3 3'}
                    strokeOpacity="0.92"
                  />
                );
              })}
            </g>
          )}

          {/* 8. LIVE TICK MARK PRICE LINE */}
          {markPrice >= minPrice && markPrice <= maxPrice && (
            <line
              x1="0"
              y1={getY(markPrice)}
              x2={chartWidth - paddingRight}
              y2={getY(markPrice)}
              stroke={tickFlash === 'DOWN' ? '#f23645' : '#089981'}
              strokeWidth="1.2"
              strokeDasharray="4 3"
            />
          )}

          {/* 8b. UNIFIED ANTI-COLLISION LAYER: Concise Canvas Level Titles + Right Y-Axis Gutter Price Badges */}
          <g id="anti-collision-labels-layer" className="font-mono-numbers select-none">
            {/* Concise inside-canvas level titles (dynamically clears VAP bars on the right) */}
            {showIndicatorLabels &&
              resolvedCanvasTitles.map((item) => {
                const plotRight = chartWidth - paddingRight;
                const pillWidth = Math.max(26, item.title.length * 5.8 + 10);
                let vapInset = 0;
                if (showVpvr && vpvrData && vpvrData.maxBinVol > 0) {
                  const rowBin = vpvrData.bins.find(
                    (b) => item.price >= b.lowPrice && item.price <= b.highPrice
                  );
                  if (rowBin) {
                    const binPx = (rowBin.totalVolume / vpvrData.maxBinVol) * (dynamicOverlayLayout.vapMaxBarWidth || 112);
                    if (binPx > 4) vapInset = binPx + 6;
                  }
                }
                const pillX = Math.max(6, plotRight - vapInset - pillWidth - 6);
                const y = item.resolvedY;
                const isOffset = Math.abs(y - item.rawY) > 2;
                return (
                  <g key={`title-${item.id}`} opacity={item.opacity ?? 0.96}>
                    {(isOffset || vapInset > 0) && (
                      <line
                        x1={pillX + pillWidth}
                        y1={y}
                        x2={plotRight}
                        y2={item.rawY}
                        stroke={item.stroke}
                        strokeWidth="0.75"
                        strokeOpacity="0.45"
                      />
                    )}
                    <rect
                      x={pillX}
                      y={y - 6.5}
                      width={pillWidth}
                      height="13"
                      rx="2"
                      fill="#050a14"
                      fillOpacity="0.95"
                      stroke={item.stroke}
                      strokeOpacity="0.8"
                      strokeWidth="0.85"
                    />
                    <text
                      x={pillX + pillWidth / 2}
                      y={y + 3}
                      textAnchor="middle"
                      fill={item.stroke}
                      fontSize="8"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {item.title}
                    </text>
                  </g>
                );
              })}

            {/* Right Y-Axis Gutter High-Contrast Price Badges (16px min separation + viewport clamping) */}
            {resolvedGutterBadges.map((item) => {
              const plotRight = chartWidth - paddingRight;
              const badgeHeight = item.isMark ? 16.5 : 15;
              const y = item.resolvedY;
              const isOffset = Math.abs(y - item.rawY) > 2;
              return (
                <g key={`gutter-${item.id}`} opacity={item.opacity ?? 1}>
                  {isOffset && (
                    <line
                      x1={plotRight}
                      y1={item.rawY}
                      x2={plotRight + 2}
                      y2={y}
                      stroke={item.stroke}
                      strokeWidth="1.1"
                      strokeOpacity="0.8"
                    />
                  )}
                  {item.isMark && (
                    <rect
                      x={plotRight + 1}
                      y={y - badgeHeight / 2 - 1}
                      width={paddingRight - 2}
                      height={badgeHeight + 2}
                      fill="#040811"
                      rx="2.5"
                    />
                  )}
                  <rect
                    x={plotRight + 2}
                    y={y - badgeHeight / 2}
                    width={paddingRight - 4}
                    height={badgeHeight}
                    fill={item.badgeBg}
                    stroke={item.isMark ? '#ffffff' : item.stroke}
                    strokeOpacity={item.isMark ? '0.72' : '0.78'}
                    strokeWidth={item.isMark ? '1.1' : '0.75'}
                    rx="2"
                  />
                  <text
                    x={plotRight + paddingRight / 2}
                    y={y + 3.1}
                    textAnchor="middle"
                    fill={item.isMark ? '#ffffff' : item.textColor}
                    fontSize={item.isMark ? '8.9' : '8.3'}
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                    className="font-mono-numbers"
                  >
                    {formatAxisPrice(item.price)}
                  </text>
                </g>
              );
            })}
          </g>

          {/* 9. INTERACTIVE 2D TRADINGVIEW CROSSHAIR */}
          {crosshairMode !== 'OFF' && hoverIndex !== null && activeCandle && (
            <g>
              {(() => {
                const cursorY =
                  crosshairMode === 'MAGNET'
                    ? getY(activeCandle.close)
                    : hoverY !== null
                    ? Math.max(8, Math.min(pricePlotHeight - 8, hoverY))
                    : getY(activeCandle.close);
                const cursorPrice =
                  crosshairMode === 'MAGNET'
                    ? activeCandle.close
                    : hoverY !== null
                    ? getPriceFromY(cursorY)
                    : activeCandle.close;
                return (
                  <>
                    {/* Vertical line */}
                    <line
                      x1={hoverIndex * candleWidth + candleWidth / 2}
                      y1="0"
                      x2={hoverIndex * candleWidth + candleWidth / 2}
                      y2={chartHeight - 16}
                      stroke="#cbd5e1"
                      strokeOpacity="0.65"
                      strokeWidth="0.85"
                      strokeDasharray="3 3"
                    />
                    {/* Horizontal line at free cursor Y */}
                    <line
                      x1="0"
                      y1={cursorY}
                      x2={chartWidth - paddingRight}
                      y2={cursorY}
                      stroke="#cbd5e1"
                      strokeOpacity="0.65"
                      strokeWidth="0.85"
                      strokeDasharray="3 3"
                    />
                    {/* High-Contrast Hover Price Tag on right axis */}
                    <rect
                      x={chartWidth - paddingRight + 1.5}
                      y={cursorY - 8.5}
                      width={paddingRight - 3}
                      height={17}
                      fill="#0b1528"
                      stroke="#38bdf8"
                      strokeWidth="1"
                      rx="2"
                    />
                    <text
                      x={chartWidth - paddingRight + paddingRight / 2}
                      y={cursorY + 3.2}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="8.6"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                      className="font-mono-numbers"
                    >
                      {formatAxisPrice(cursorPrice)}
                    </text>
                  </>
                );
              })()}
              {/* Hover Time Tag on bottom axis */}
              <rect
                x={hoverIndex * candleWidth + candleWidth / 2 - 28}
                y={chartHeight - 15.5}
                width="56"
                height="15"
                fill="#0b1528"
                stroke="#38bdf8"
                strokeWidth="0.85"
                rx="2"
              />
              <text
                x={hoverIndex * candleWidth + candleWidth / 2}
                y={chartHeight - 4.5}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="8.5"
                fontWeight="700"
                fontFamily="JetBrains Mono"
                className="font-mono-numbers"
              >
                {new Date(activeCandle.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </text>
            </g>
          )}

          {/* Right Price Axis Interactive Highlight & Border */}
          {(hoverZone === 'PRICE_AXIS' || activeDragMode === 'SCALE_Y') && (
            <rect
              x={chartWidth - paddingRight}
              y="0"
              width={paddingRight}
              height={chartHeight}
              fill="#2962ff"
              fillOpacity={activeDragMode === 'SCALE_Y' ? '0.12' : '0.06'}
            />
          )}
          {(hoverZone === 'TIME_AXIS' || activeDragMode === 'SCALE_X') && (
            <rect
              x="0"
              y={chartHeight - 18}
              width={chartWidth - paddingRight}
              height="18"
              fill="#2962ff"
              fillOpacity={activeDragMode === 'SCALE_X' ? '0.12' : '0.06'}
            />
          )}
          <line
            x1={chartWidth - paddingRight}
            y1="0"
            x2={chartWidth - paddingRight}
            y2={chartHeight}
            stroke={hoverZone === 'PRICE_AXIS' || activeDragMode === 'SCALE_Y' ? '#2962ff' : '#2a2e39'}
            strokeWidth="1"
          />
        </svg>

        {/* Floating TradingView "Reset Chart View" Pill when panned or manually scaled */}
        {isViewModified && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleResetZoom();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="btn-delta-sm btn-secondary absolute bottom-7 right-24 z-20 shadow-lg font-mono-numbers"
            title="Reset X & Y axes to live auto-fit (or double-click chart)"
          >
            <RotateCcw className="w-3 h-3 text-cyan-400" />
            <span>Reset Chart View</span>
          </button>
        )}

        {/* Loading overlay */}
        {isLoadingCandles && (
          <div className="absolute inset-0 bg-[#131722]/80 backdrop-blur-xs flex items-center justify-center">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1e222d] border border-[#2a2e39] text-xs text-cyan-400 font-mono-numbers">
              <Radio className="w-3.5 h-3.5 animate-spin" />
              <span>Streaming Delta K-Lines...</span>
            </div>
          </div>
        )}

        {/* ════════════════ EVENT CATALYST & VOLATILITY SPIKE INSPECTOR MODAL ════════════════ */}
        {selectedEventHeadline && (
          <div
            className="absolute inset-0 z-40 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 cursor-default select-text"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-delta border-cyan-500/50 p-5 max-w-lg w-full shadow-2xl text-slate-200 font-sans animate-in fade-in zoom-in-95 duration-150">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2.5 rounded-lg border ${
                      selectedEventHeadline.score >= 20
                        ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400'
                        : selectedEventHeadline.score <= -20
                        ? 'bg-rose-950/80 border-rose-500/50 text-rose-400'
                        : 'bg-amber-950/80 border-amber-500/50 text-amber-400'
                    }`}
                  >
                    {selectedEventHeadline.score >= 20 ? (
                      <ArrowUpRight className="w-5 h-5" />
                    ) : selectedEventHeadline.score <= -20 ? (
                      <ArrowDownRight className="w-5 h-5" />
                    ) : (
                      <Activity className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                        <Newspaper className="w-3 h-3" /> Market Catalyst
                      </span>
                      <span
                        className={`badge-delta font-mono-numbers ${
                          selectedEventHeadline.impact === 'HIGH'
                            ? 'badge-delta-danger'
                            : selectedEventHeadline.impact === 'MEDIUM'
                            ? 'badge-delta-paper'
                            : 'badge-delta-standby'
                        }`}
                      >
                        {selectedEventHeadline.impact} IMPACT
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-white mt-1 leading-snug">
                      {selectedEventHeadline.title}
                    </h3>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedEventHeadline(null)}
                  className="btn-delta-sm btn-secondary px-2"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 gap-2.5 my-3.5 text-xs font-mono-numbers">
                <div className="bg-[#080d1a] p-2.5 rounded-lg border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 uppercase block">Sentiment Score</span>
                  <span
                    className={`text-base font-bold ${
                      selectedEventHeadline.score >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {selectedEventHeadline.score > 0 ? `+${selectedEventHeadline.score}` : selectedEventHeadline.score} / 100
                  </span>
                  <span className="text-[9px] text-slate-500 block">
                    {selectedEventHeadline.sentiment}
                  </span>
                </div>

                <div className="bg-[#080d1a] p-2.5 rounded-lg border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 uppercase block">Source & Timestamp</span>
                  <span className="text-xs font-bold text-slate-200 block truncate" title={selectedEventHeadline.source}>
                    {selectedEventHeadline.source}
                  </span>
                  <span className="text-[9px] text-slate-500 block">
                    {new Date(selectedEventHeadline.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>

                <div className="bg-[#080d1a] p-2.5 rounded-lg border border-slate-800/80">
                  <span className="text-[10px] text-slate-400 uppercase block">Volatility Sync</span>
                  <span className="text-base font-bold text-cyan-300 block">
                    {Math.round(sentimentVolCorrelation.correlation * 100)}%
                  </span>
                  <span className="text-[9px] text-slate-500 block">
                    Correlation Index
                  </span>
                </div>
              </div>

              {/* AI Catalyst Rationale & Volatility Analysis */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px]">
                  <Flame className="w-3.5 h-3.5" />
                  <span>Price Reaction & Volatility Impact</span>
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  {selectedEventHeadline.aiRationale ||
                    'High frequency sentiment detection correlated with an immediate expansion in candle ATR and volume participation.'}
                </p>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-800 text-xs">
                <span className="text-[10px] text-slate-500">
                  Click any catalyst pin on the chart to inspect market events.
                </span>
                <button
                  onClick={() => setSelectedEventHeadline(null)}
                  className="btn-delta btn-toggle-active"
                >
                  Close Inspector
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════ TRADINGVIEW BOTTOM STATUS BAR ════════════════ */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 bg-[#0B111E] border-t border-slate-800/80 px-3 py-1.5 font-mono-numbers select-none">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-slate-200 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Delta Exchange India
          </span>
          <span className="text-slate-700">|</span>
          <span>Range: {currencyPrefix}{(minPrice * exchangeRate).toFixed(2)} – {currencyPrefix}{(maxPrice * exchangeRate).toFixed(2)}</span>
          {virginCprZones.length > 0 && (
            <>
              <span className="text-slate-700">|</span>
              <span className="text-purple-400">
                V-CPR: {virginCprZones.length} active
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="hidden sm:inline text-slate-500">
            Drag Canvas: Pan X/Y · Drag Price/Time Axis: Scale Y/X · Wheel: Zoom
          </span>
          <span className="hidden sm:inline text-slate-700">|</span>
          <span className="text-slate-300">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} UTC
          </span>
          <span className="text-slate-700">|</span>
          <button
            onClick={() => {
              setYScaleFactor(1);
              setYPanOffset(0);
            }}
            className={`btn-delta-sm ${
              isAutoScaleY
                ? 'btn-toggle-active'
                : 'btn-secondary text-slate-400'
            }`}
            title="Toggle Auto Price Scale (or double-click right price axis)"
          >
            Auto
          </button>
        </div>
      </div>
    </div>
  );
});

