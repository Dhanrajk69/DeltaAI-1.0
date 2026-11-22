import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MarketTicker, AppNotification } from '../types';

export interface AssetVolatilityMetric {
  symbol: string;
  markPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  rangeVolatility24h: number; // ((high24h - low24h) / low24h) * 100
  compositeVolatility24h: number; // Effective 24h volatility %
  tickVelocityPct: number; // Instantaneous tick shock %
  exceedsThreshold: boolean;
  severity: 'NORMAL' | 'ELEVATED' | 'EXTREME';
  direction: 'BULL_BREAKOUT' | 'BEAR_FLUSH';
  rangePositionPct: number; // 0% at 24h low, 100% at 24h high
}

export interface VolatilitySpikeAlert {
  id: string;
  symbol: string;
  timestamp: number;
  markPrice: number;
  volatility24h: number;
  threshold24h: number;
  change24h: number;
  high24h: number;
  low24h: number;
  severity: 'ELEVATED' | 'EXTREME';
  direction: 'BULL_BREAKOUT' | 'BEAR_FLUSH';
  catalyst: string;
  acknowledged: boolean;
}

interface UseVolatilitySpikeMonitorProps {
  markets: Record<string, MarketTicker>;
  onPlaySpikeSound?: () => void;
  onSendNotification?: (title: string, message: string, type: AppNotification['type']) => void;
}

const DEFAULT_THRESHOLD_24H = 3.5; // Predefined 3.5% 24h volatility threshold
const ALERT_COOLDOWN_MS = 45000; // 45s per-symbol cooldown to prevent spam on every tick

export function useVolatilitySpikeMonitor({
  markets,
  onPlaySpikeSound,
  onSendNotification,
}: UseVolatilitySpikeMonitorProps) {
  const [threshold24h, setThreshold24h] = useState<number>(DEFAULT_THRESHOLD_24H);
  // Silent ambient telemetry by default - notifications removed per user request
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [autoBannerEnabled, setAutoBannerEnabled] = useState<boolean>(false);
  const [spikeAlerts, setSpikeAlerts] = useState<VolatilitySpikeAlert[]>([]);
  const [activeBannerAlert, setActiveBannerAlert] = useState<VolatilitySpikeAlert | null>(null);
  const [simulatedBoosts, setSimulatedBoosts] = useState<Record<string, { boostPct: number; expiresAt: number }>>({});

  const prevPricesRef = useRef<Record<string, number>>({});
  const lastAlertTimeBySymbolRef = useRef<Record<string, number>>({});
  const prevThresholdRef = useRef<number>(DEFAULT_THRESHOLD_24H);

  // Clean up expired simulated volatility boosts
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setSimulatedBoosts((prev) => {
        let changed = false;
        const next: Record<string, { boostPct: number; expiresAt: number }> = {};
        for (const [sym, data] of Object.entries(prev)) {
          if (data.expiresAt > now) {
            next[sym] = data;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Compute live 24h volatility metrics across all tracked perpetual markets
  const assetMetrics: AssetVolatilityMetric[] = useMemo(() => {
    const canonicalOrder = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT'];
    const entries = Object.values(markets).filter(
      (m) => m && m.symbol && !m.symbol.startsWith('C-') && !m.symbol.startsWith('P-')
    );

    const sorted = entries.sort((a, b) => {
      const idxA = canonicalOrder.indexOf(a.symbol);
      const idxB = canonicalOrder.indexOf(b.symbol);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    const now = Date.now();

    return sorted.map((m) => {
      const mark = m.markPrice || 1;
      const high = Math.max(m.high24h || mark * 1.015, mark);
      const low = Math.min(m.low24h || mark * 0.985, mark);
      const safeLow = low > 0 ? low : mark * 0.98;

      const rangeVol = +(((high - safeLow) / safeLow) * 100).toFixed(2);
      const absChange = Math.abs(m.change24h || 0);

      const prevPrice = prevPricesRef.current[m.symbol] || mark;
      const tickVelocity = prevPrice > 0 ? +((Math.abs(mark - prevPrice) / prevPrice) * 100).toFixed(3) : 0;

      const simBoost = simulatedBoosts[m.symbol]?.expiresAt > now ? simulatedBoosts[m.symbol].boostPct : 0;

      // Effective 24h volatility combines 24h High-Low range expansion, 24h change magnitude, and live tick shock
      const compositeVol = +(Math.max(rangeVol, absChange * 1.15) + tickVelocity * 8 + simBoost).toFixed(2);

      const exceeds = compositeVol >= threshold24h;
      const severity: AssetVolatilityMetric['severity'] =
        compositeVol >= threshold24h * 1.35
          ? 'EXTREME'
          : exceeds
          ? 'ELEVATED'
          : 'NORMAL';

      const rangeSpan = Math.max(0.0001, high - safeLow);
      const rangePositionPct = Math.min(100, Math.max(0, Math.round(((mark - safeLow) / rangeSpan) * 100)));

      const direction: AssetVolatilityMetric['direction'] =
        m.change24h >= 0 || rangePositionPct >= 55 ? 'BULL_BREAKOUT' : 'BEAR_FLUSH';

      return {
        symbol: m.symbol,
        markPrice: mark,
        change24h: m.change24h || 0,
        high24h: high,
        low24h: safeLow,
        rangeVolatility24h: rangeVol,
        compositeVolatility24h: compositeVol,
        tickVelocityPct: tickVelocity,
        exceedsThreshold: exceeds,
        severity,
        direction,
        rangePositionPct,
      };
    });
  }, [markets, threshold24h, simulatedBoosts]);

  // Reset cooldowns if user lowers threshold so newly breached assets trigger immediately
  useEffect(() => {
    if (threshold24h < prevThresholdRef.current) {
      lastAlertTimeBySymbolRef.current = {};
    }
    prevThresholdRef.current = threshold24h;
  }, [threshold24h]);

  // Monitor live feed updates & trigger visual + sound alert when 24h volatility exceeds threshold
  useEffect(() => {
    if (assetMetrics.length === 0) return;
    const now = Date.now();

    for (const metric of assetMetrics) {
      prevPricesRef.current[metric.symbol] = metric.markPrice;

      if (metric.exceedsThreshold) {
        const lastAlertTs = lastAlertTimeBySymbolRef.current[metric.symbol] || 0;
        if (now - lastAlertTs >= ALERT_COOLDOWN_MS) {
          lastAlertTimeBySymbolRef.current[metric.symbol] = now;

          const newAlert: VolatilitySpikeAlert = {
            id: `vol-spike-${metric.symbol}-${now}`,
            symbol: metric.symbol,
            timestamp: now,
            markPrice: metric.markPrice,
            volatility24h: metric.compositeVolatility24h,
            threshold24h,
            change24h: metric.change24h,
            high24h: metric.high24h,
            low24h: metric.low24h,
            severity: metric.severity === 'EXTREME' ? 'EXTREME' : 'ELEVATED',
            direction: metric.direction,
            catalyst:
              metric.direction === 'BULL_BREAKOUT'
                ? `24h range expansion (${metric.compositeVolatility24h.toFixed(2)}%) breached ${threshold24h.toFixed(1)}% threshold with upside momentum.`
                : `24h volatility surge (${metric.compositeVolatility24h.toFixed(2)}%) breached ${threshold24h.toFixed(1)}% threshold on downside sell pressure.`,
            acknowledged: false,
          };

          setSpikeAlerts((prev) => [newAlert, ...prev.slice(0, 29)]);
          if (autoBannerEnabled) {
            setActiveBannerAlert(newAlert);
          }

          if (soundEnabled && onPlaySpikeSound) {
            onPlaySpikeSound();
          }

          // Volatility notifications removed per user preference:
          // Replaced by ambient header regime pill and in-line asset metrics (zero-notification policy)
        }
      }
    }
  }, [assetMetrics, threshold24h, soundEnabled, autoBannerEnabled, onPlaySpikeSound]);

  // Manual / Simulated Volatility Spike Trigger for testing any symbol immediately
  const triggerTestSpike = useCallback(
    (targetSymbol = 'BTCUSDT') => {
      const now = Date.now();
      const targetMetric =
        assetMetrics.find((m) => m.symbol === targetSymbol) ||
        assetMetrics[0] || {
          symbol: targetSymbol,
          markPrice: 81702.5,
          change24h: 4.85,
          high24h: 83400,
          low24h: 79200,
          compositeVolatility24h: +(threshold24h + 2.4).toFixed(2),
          direction: 'BULL_BREAKOUT' as const,
        };

      const spikedVol = +(Math.max(targetMetric.compositeVolatility24h, threshold24h) + 2.35).toFixed(2);

      // Apply a 25-second live volatility boost on the symbol
      setSimulatedBoosts((prev) => ({
        ...prev,
        [targetMetric.symbol]: {
          boostPct: +(spikedVol - targetMetric.compositeVolatility24h + 0.5).toFixed(2),
          expiresAt: now + 25000,
        },
      }));

      lastAlertTimeBySymbolRef.current[targetMetric.symbol] = now;

      const testAlert: VolatilitySpikeAlert = {
        id: `vol-spike-${targetMetric.symbol}-${now}`,
        symbol: targetMetric.symbol,
        timestamp: now,
        markPrice: targetMetric.markPrice,
        volatility24h: spikedVol,
        threshold24h,
        change24h: targetMetric.change24h,
        high24h: targetMetric.high24h,
        low24h: targetMetric.low24h,
        severity: spikedVol >= threshold24h * 1.35 ? 'EXTREME' : 'ELEVATED',
        direction: targetMetric.direction,
        catalyst: `Live feed impulse detected: ${targetMetric.symbol} 24h volatility surged to ${spikedVol}% (Threshold: ${threshold24h.toFixed(1)}%).`,
        acknowledged: false,
      };

      setSpikeAlerts((prev) => [testAlert, ...prev.slice(0, 29)]);
      setActiveBannerAlert(testAlert);

      if (soundEnabled && onPlaySpikeSound) {
        onPlaySpikeSound();
      }

      // Volatility notifications removed per user preference
    },
    [assetMetrics, threshold24h, soundEnabled, onPlaySpikeSound]
  );

  const dismissBannerAlert = useCallback(() => {
    const currentBanner = activeBannerAlert;
    setActiveBannerAlert(null);
    if (currentBanner) {
      setSpikeAlerts((list) =>
        list.map((item) => (item.id === currentBanner.id ? { ...item, acknowledged: true } : item))
      );
    }
  }, [activeBannerAlert]);

  const clearSpikeAlerts = useCallback(() => {
    setSpikeAlerts([]);
    setActiveBannerAlert(null);
  }, []);

  const breachingAssetsCount = useMemo(
    () => assetMetrics.filter((m) => m.exceedsThreshold).length,
    [assetMetrics]
  );

  const maxVolatilityMetric = useMemo(() => {
    if (assetMetrics.length === 0) return null;
    return assetMetrics.reduce((max, curr) =>
      curr.compositeVolatility24h > max.compositeVolatility24h ? curr : max
    , assetMetrics[0]);
  }, [assetMetrics]);

  return {
    threshold24h,
    setThreshold24h,
    soundEnabled,
    setSoundEnabled,
    autoBannerEnabled,
    setAutoBannerEnabled,
    assetMetrics,
    spikeAlerts,
    activeBannerAlert,
    breachingAssetsCount,
    maxVolatilityMetric,
    triggerTestSpike,
    dismissBannerAlert,
    clearSpikeAlerts,
  };
}
