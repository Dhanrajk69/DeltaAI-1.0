import { Candle } from '../types';

export type CandlestickPatternType =
  | 'BULLISH_ENGULFING'
  | 'BEARISH_ENGULFING'
  | 'HAMMER'
  | 'INVERTED_HAMMER'
  | 'SHOOTING_STAR'
  | 'MORNING_STAR'
  | 'EVENING_STAR'
  | 'BULLISH_PIN_BAR'
  | 'BEARISH_PIN_BAR'
  | 'DOJI';

export type PatternSentiment = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface DetectedChartPattern {
  id: string;
  candleIndex: number;
  candleTime: number;
  type: CandlestickPatternType;
  shortCode: string;
  label: string;
  sentiment: PatternSentiment;
  anchorPrice: number;
  confidence: number;
  description: string;
}

export interface VapBin {
  binIndex: number;
  lowPrice: number;
  highPrice: number;
  midPrice: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  historicalVolume: number;
  visibleVolume: number;
  inValueArea: boolean;
  isHvn: boolean;
  isLvn: boolean;
  clusterRank: number;
}

export interface InstitutionalVapData {
  bins: VapBin[];
  maxBinVol: number;
  meanActiveBinVol: number;
  hvnThreshold: number;
  pocPrice: number;
  pocBinIndex: number;
  vah: number;
  val: number;
  binSize: number;
  hvnClusters: Array<{
    lowPrice: number;
    highPrice: number;
    midPrice: number;
    totalVolume: number;
  }>;
  historicalBlendActive: boolean;
  totalSampleCandles: number;
}

function getCandleBody(c: Candle) {
  return Math.abs(c.close - c.open);
}

function getCandleRange(c: Candle) {
  return Math.max(0, c.high - c.low);
}

function getUpperWick(c: Candle) {
  return Math.max(0, c.high - Math.max(c.open, c.close));
}

function getLowerWick(c: Candle) {
  return Math.max(0, Math.min(c.open, c.close) - c.low);
}

function computeLocalAtr(candles: Candle[], period = 14): number[] {
  const atr: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return atr;

  const trValues: number[] = candles.map((c, idx) => {
    if (idx === 0) return getCandleRange(c);
    const prevClose = candles[idx - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
  });

  let running = 0;
  for (let i = 0; i < trValues.length; i++) {
    if (i < period) {
      running += trValues[i];
      atr[i] = running / (i + 1);
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + trValues[i]) / period;
    }
  }
  return atr;
}

function getPriorTrendBias(candles: Candle[], idx: number, lookback = 5): 'UP' | 'DOWN' | 'FLAT' {
  const start = Math.max(0, idx - lookback);
  if (idx - start < 2) return 'FLAT';

  const firstClose = candles[start].close;
  const prevClose = candles[idx - 1].close;
  if (firstClose <= 0) return 'FLAT';

  const pctMove = ((prevClose - firstClose) / firstClose) * 100;
  let upBars = 0;
  let downBars = 0;
  for (let j = start + 1; j < idx; j++) {
    if (candles[j].close > candles[j - 1].close) upBars++;
    else if (candles[j].close < candles[j - 1].close) downBars++;
  }

  if (pctMove > 0.08 || upBars >= downBars + 2) return 'UP';
  if (pctMove < -0.08 || downBars >= upBars + 2) return 'DOWN';
  return 'FLAT';
}

interface CandidatePattern extends DetectedChartPattern {
  priority: number;
}

/**
 * Institutional Candlestick Pattern Detector
 * Evaluates ATR-normalized body/wick proportions, multi-bar trend context,
 * and relative volume participation to filter micro-noise.
 */
export function detectPatterns(candles: Candle[]): DetectedChartPattern[] {
  if (!candles || candles.length < 3) return [];

  const atrList = computeLocalAtr(candles, 14);
  const volLookback = 14;
  const bestByIndex = new Map<number, CandidatePattern>();

  const registerCandidate = (cand: CandidatePattern) => {
    const existing = bestByIndex.get(cand.candleIndex);
    if (!existing || cand.priority > existing.priority || (cand.priority === existing.priority && cand.confidence > existing.confidence)) {
      bestByIndex.set(cand.candleIndex, cand);
    }
  };

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const atr = Math.max(atrList[i] || 0, c.close * 0.00025);
    const range = getCandleRange(c);
    const body = getCandleBody(c);
    const upperWick = getUpperWick(c);
    const lowerWick = getLowerWick(c);

    // Filter out ultra-flat / dead candles
    if (range <= 0 || range < atr * 0.32) continue;

    // Average local volume for confidence scaling
    const volStart = Math.max(0, i - volLookback);
    let volSum = 0;
    let volCount = 0;
    for (let v = volStart; v < i; v++) {
      volSum += candles[v].volume || 0;
      volCount++;
    }
    const avgVol = volCount > 0 ? volSum / volCount : c.volume || 1;
    const volRatio = avgVol > 0 ? (c.volume || 0) / avgVol : 1;
    const volBoost = volRatio >= 1.25 ? 6 : volRatio >= 1.0 ? 3 : 0;

    const trend = getPriorTrendBias(candles, i, 5);
    const isBull = c.close > c.open;
    const isBear = c.close < c.open;
    const prevBull = prev.close > prev.open;
    const prevBear = prev.close < prev.open;
    const prevBody = getCandleBody(prev);
    const prevRange = getCandleRange(prev);

    const bodyRatio = body / range;
    const upperRatio = upperWick / range;
    const lowerRatio = lowerWick / range;

    // 1. 3-Candle Reversal Formations: Morning Star & Evening Star
    if (i >= 2) {
      const first = candles[i - 2];
      const middle = prev;
      const firstBody = getCandleBody(first);
      const firstRange = getCandleRange(first);
      const middleBody = getCandleBody(middle);
      const firstMidpoint = (first.open + first.close) / 2;
      const priorBeforeFirst = getPriorTrendBias(candles, i - 1, 4);

      // Morning Star: Bearish impulse -> small indecisive star -> Bullish confirmation closing past midpoint
      if (
        priorBeforeFirst === 'DOWN' &&
        first.close < first.open &&
        firstBody >= atr * 0.45 &&
        firstRange > 0 &&
        middleBody <= firstBody * 0.45 &&
        isBull &&
        body >= atr * 0.4 &&
        c.close > firstMidpoint
      ) {
        const confidence = Math.min(96, Math.round(80 + (c.close >= first.open ? 7 : 3) + volBoost));
        registerCandidate({
          id: `pat-${c.time}-MORNING_STAR`,
          candleIndex: i,
          candleTime: c.time,
          type: 'MORNING_STAR',
          shortCode: 'M★',
          label: 'Morning Star',
          sentiment: 'BULLISH',
          anchorPrice: Math.min(c.low, middle.low),
          confidence,
          priority: 95,
          description: `3-bar bullish reversal closing above prior bearish midpoint (${volRatio.toFixed(1)}x vol).`,
        });
      }

      // Evening Star: Bullish impulse -> small indecisive star -> Bearish confirmation closing below midpoint
      if (
        priorBeforeFirst === 'UP' &&
        first.close > first.open &&
        firstBody >= atr * 0.45 &&
        firstRange > 0 &&
        middleBody <= firstBody * 0.45 &&
        isBear &&
        body >= atr * 0.4 &&
        c.close < firstMidpoint
      ) {
        const confidence = Math.min(96, Math.round(80 + (c.close <= first.open ? 7 : 3) + volBoost));
        registerCandidate({
          id: `pat-${c.time}-EVENING_STAR`,
          candleIndex: i,
          candleTime: c.time,
          type: 'EVENING_STAR',
          shortCode: 'E★',
          label: 'Evening Star',
          sentiment: 'BEARISH',
          anchorPrice: Math.max(c.high, middle.high),
          confidence,
          priority: 95,
          description: `3-bar bearish distribution closing below prior bullish midpoint (${volRatio.toFixed(1)}x vol).`,
        });
      }
    }

    // 2. Bullish / Bearish Engulfing
    if (
      prevBear &&
      isBull &&
      prevBody > atr * 0.15 &&
      body >= prevBody * 1.08 &&
      c.open <= prev.close * 1.0012 &&
      c.close >= prev.open
    ) {
      const dominance = Math.min(2.5, body / Math.max(1e-8, prevBody));
      const confidence = Math.min(95, Math.round(74 + (trend === 'DOWN' ? 8 : 2) + (dominance - 1) * 6 + volBoost));
      registerCandidate({
        id: `pat-${c.time}-BULL_ENGULF`,
        candleIndex: i,
        candleTime: c.time,
        type: 'BULLISH_ENGULFING',
        shortCode: 'ENG+',
        label: 'Bullish Engulfing',
        sentiment: 'BULLISH',
        anchorPrice: c.low,
        confidence,
        priority: 90,
        description: `Demand absorption engulfed prior red body by ${dominance.toFixed(2)}x (${volRatio.toFixed(1)}x vol).`,
      });
    } else if (
      prevBull &&
      isBear &&
      prevBody > atr * 0.15 &&
      body >= prevBody * 1.08 &&
      c.open >= prev.close * 0.9988 &&
      c.close <= prev.open
    ) {
      const dominance = Math.min(2.5, body / Math.max(1e-8, prevBody));
      const confidence = Math.min(95, Math.round(74 + (trend === 'UP' ? 8 : 2) + (dominance - 1) * 6 + volBoost));
      registerCandidate({
        id: `pat-${c.time}-BEAR_ENGULF`,
        candleIndex: i,
        candleTime: c.time,
        type: 'BEARISH_ENGULFING',
        shortCode: 'ENG-',
        label: 'Bearish Engulfing',
        sentiment: 'BEARISH',
        anchorPrice: c.high,
        confidence,
        priority: 90,
        description: `Supply engulfment rejected prior green body by ${dominance.toFixed(2)}x (${volRatio.toFixed(1)}x vol).`,
      });
    }

    // 3. Institutional Pin Bars (sharp single-bar liquidity sweep >= 62% rejection tail)
    if (lowerRatio >= 0.62 && bodyRatio <= 0.28 && upperRatio <= 0.16 && range >= atr * 0.7) {
      const confidence = Math.min(92, Math.round(73 + (trend === 'DOWN' ? 8 : 3) + (lowerRatio - 0.62) * 25 + volBoost));
      registerCandidate({
        id: `pat-${c.time}-BULL_PIN`,
        candleIndex: i,
        candleTime: c.time,
        type: 'BULLISH_PIN_BAR',
        shortCode: 'PIN+',
        label: 'Bullish Pin Bar',
        sentiment: 'BULLISH',
        anchorPrice: c.low,
        confidence,
        priority: 82,
        description: `Long lower sweep (${Math.round(lowerRatio * 100)}% of bar) rejecting downside liquidity.`,
      });
    } else if (upperRatio >= 0.62 && bodyRatio <= 0.28 && lowerRatio <= 0.16 && range >= atr * 0.7) {
      const confidence = Math.min(92, Math.round(73 + (trend === 'UP' ? 8 : 3) + (upperRatio - 0.62) * 25 + volBoost));
      registerCandidate({
        id: `pat-${c.time}-BEAR_PIN`,
        candleIndex: i,
        candleTime: c.time,
        type: 'BEARISH_PIN_BAR',
        shortCode: 'PIN-',
        label: 'Bearish Pin Bar',
        sentiment: 'BEARISH',
        anchorPrice: c.high,
        confidence,
        priority: 82,
        description: `Long upper sweep (${Math.round(upperRatio * 100)}% of bar) rejecting overhead liquidity.`,
      });
    }

    // 4. Hammer, Inverted Hammer & Shooting Star (trend-conditioned)
    if (
      trend === 'DOWN' &&
      lowerWick >= Math.max(body * 2.0, range * 0.52) &&
      upperWick <= range * 0.18 &&
      bodyRatio >= 0.10 &&
      bodyRatio <= 0.38
    ) {
      const confidence = Math.min(89, Math.round(72 + lowerRatio * 14 + volBoost));
      registerCandidate({
        id: `pat-${c.time}-HAMMER`,
        candleIndex: i,
        candleTime: c.time,
        type: 'HAMMER',
        shortCode: 'HAM',
        label: 'Hammer',
        sentiment: 'BULLISH',
        anchorPrice: c.low,
        confidence,
        priority: 76,
        description: `Downswing rejection wick (${Math.round(lowerRatio * 100)}% lower shadow) signaling buyer defense.`,
      });
    } else if (
      trend === 'DOWN' &&
      upperWick >= Math.max(body * 2.0, range * 0.52) &&
      lowerWick <= range * 0.18 &&
      bodyRatio >= 0.10 &&
      bodyRatio <= 0.38
    ) {
      const confidence = Math.min(84, Math.round(67 + upperRatio * 12 + volBoost));
      registerCandidate({
        id: `pat-${c.time}-INV_HAMMER`,
        candleIndex: i,
        candleTime: c.time,
        type: 'INVERTED_HAMMER',
        shortCode: 'IHM',
        label: 'Inverted Hammer',
        sentiment: 'BULLISH',
        anchorPrice: c.low,
        confidence,
        priority: 73,
        description: `Bullish bottoming probe testing upper liquidity after a pullback.`,
      });
    } else if (
      trend === 'UP' &&
      upperWick >= Math.max(body * 2.0, range * 0.52) &&
      lowerWick <= range * 0.18 &&
      bodyRatio >= 0.10 &&
      bodyRatio <= 0.38
    ) {
      const confidence = Math.min(89, Math.round(72 + upperRatio * 14 + volBoost));
      registerCandidate({
        id: `pat-${c.time}-SHOOTING_STAR`,
        candleIndex: i,
        candleTime: c.time,
        type: 'SHOOTING_STAR',
        shortCode: 'STR',
        label: 'Shooting Star',
        sentiment: 'BEARISH',
        anchorPrice: c.high,
        confidence,
        priority: 76,
        description: `Upswing exhaustion tail (${Math.round(upperRatio * 100)}% upper shadow) warning of supply rejection.`,
      });
    }

    // 5. High-Range Indecision Doji
    if (bodyRatio <= 0.095 && range >= Math.max(atr * 0.55, prevRange * 0.45)) {
      const confidence = Math.min(82, Math.round(64 + (volRatio >= 1.1 ? 8 : 2) + (trend !== 'FLAT' ? 5 : 0)));
      registerCandidate({
        id: `pat-${c.time}-DOJI`,
        candleIndex: i,
        candleTime: c.time,
        type: 'DOJI',
        shortCode: 'DOJ',
        label: 'Doji Equilibrium',
        sentiment: 'NEUTRAL',
        anchorPrice: c.low,
        confidence,
        priority: 60,
        description: `Tight open/close equilibrium (${(bodyRatio * 100).toFixed(1)}% body) at potential inflection.`,
      });
    }
  }

  // Sort by candle index and de-clutter consecutive low-priority markers
  const sorted = Array.from(bestByIndex.values()).sort((a, b) => a.candleIndex - b.candleIndex);
  const filtered: DetectedChartPattern[] = [];

  for (const item of sorted) {
    const prevAccepted = filtered[filtered.length - 1];
    if (prevAccepted && item.candleIndex - prevAccepted.candleIndex === 1) {
      // If two consecutive candles triggered patterns, retain only the higher-priority signal
      const prevCand = bestByIndex.get(prevAccepted.candleIndex)!;
      if (item.priority > prevCand.priority) {
        filtered[filtered.length - 1] = item;
      }
      continue;
    }
    filtered.push(item);
  }

  return filtered;
}

/**
 * Institutional Volume-at-Price (VAP) Calculator
 * Combines visible-range orderflow candles with historical session candles
 * to surface Value Area (70%), POC, and High Volume Nodes (HVN liquidity clusters).
 */
export function computeInstitutionalVolumeProfile(
  visibleCandles: Candle[],
  historicalCandles: Candle[],
  minPrice: number,
  maxPrice: number,
  numBins = 42
): InstitutionalVapData | null {
  if (!visibleCandles || visibleCandles.length === 0 || maxPrice <= minPrice) return null;

  const priceSpan = Math.max(1e-6, maxPrice - minPrice);
  const binSize = priceSpan / numBins;

  const bins: VapBin[] = Array.from({ length: numBins }, (_, i) => {
    const lowPrice = minPrice + i * binSize;
    const highPrice = lowPrice + binSize;
    return {
      binIndex: i,
      lowPrice,
      highPrice,
      midPrice: lowPrice + binSize / 2,
      buyVolume: 0,
      sellVolume: 0,
      totalVolume: 0,
      historicalVolume: 0,
      visibleVolume: 0,
      inValueArea: false,
      isHvn: false,
      isLvn: false,
      clusterRank: 0,
    };
  });

  // Deduplicate historical candles against visible candle timestamps so visible bars aren't double-counted
  const visibleStartTime = visibleCandles[0]?.time ?? Infinity;
  const visibleEndTime = visibleCandles[visibleCandles.length - 1]?.time ?? -Infinity;

  const extraHistorical = (historicalCandles || []).filter((hc) => {
    if (!Number.isFinite(hc.high) || !Number.isFinite(hc.low)) return false;
    if (hc.high < minPrice || hc.low > maxPrice) return false;
    // Skip candles strictly covered inside the active visible time span if same/finer resolution
    if (hc.time >= visibleStartTime && hc.time <= visibleEndTime && historicalCandles.length <= visibleCandles.length * 1.2) {
      return false;
    }
    return true;
  });

  const accumulateCandles = (list: Candle[], weight: number, isHistorical: boolean) => {
    let addedVol = 0;
    for (const c of list) {
      const vol = Math.max(0.1, c.volume || 1) * weight;
      const isBuy = c.close >= c.open;
      const candleLow = Math.min(c.low, c.high);
      const candleHigh = Math.max(c.low, c.high);
      const candleRange = Math.max(binSize * 0.15, candleHigh - candleLow);

      let allocated = 0;
      for (let i = 0; i < numBins; i++) {
        const bin = bins[i];
        const overlap = Math.max(
          0,
          Math.min(candleHigh, bin.highPrice) - Math.max(candleLow, bin.lowPrice)
        );
        if (overlap > 0) {
          const share = (overlap / candleRange) * vol;
          if (isBuy) bin.buyVolume += share;
          else bin.sellVolume += share;
          bin.totalVolume += share;
          if (isHistorical) bin.historicalVolume += share;
          else bin.visibleVolume += share;
          allocated += share;
        }
      }

      if (allocated === 0 && c.close >= minPrice && c.close <= maxPrice) {
        const idx = Math.max(0, Math.min(numBins - 1, Math.floor((c.close - minPrice) / binSize)));
        if (isBuy) bins[idx].buyVolume += vol;
        else bins[idx].sellVolume += vol;
        bins[idx].totalVolume += vol;
        if (isHistorical) bins[idx].historicalVolume += vol;
        else bins[idx].visibleVolume += vol;
        addedVol += vol;
      } else {
        addedVol += allocated;
      }
    }
    return addedVol;
  };

  const visVolTotal = accumulateCandles(visibleCandles, 1.0, false);
  // Historical session volume contributes institutional liquidity memory weighted cleanly (0.42x)
  const histVolTotal = accumulateCandles(extraHistorical, 0.42, true);
  const grandTotalVolume = visVolTotal + histVolTotal;

  if (grandTotalVolume <= 0) return null;

  // Point of Control (POC)
  let maxBinIndex = 0;
  let maxBinVol = 0;
  let nonZeroCount = 0;
  for (let i = 0; i < numBins; i++) {
    if (bins[i].totalVolume > 0) nonZeroCount++;
    if (bins[i].totalVolume > maxBinVol) {
      maxBinVol = bins[i].totalVolume;
      maxBinIndex = i;
    }
  }

  if (maxBinVol <= 0) return null;

  const meanActiveBinVol = nonZeroCount > 0 ? grandTotalVolume / nonZeroCount : maxBinVol;
  const hvnThreshold = Math.max(meanActiveBinVol * 1.42, maxBinVol * 0.58);
  const lvnThreshold = meanActiveBinVol * 0.45;

  const pocBin = bins[maxBinIndex];
  pocBin.inValueArea = true;

  // Value Area (70% volume expansion outward from POC)
  const targetVaVolume = grandTotalVolume * 0.70;
  let currentVaVolume = pocBin.totalVolume;
  let lowerPtr = maxBinIndex - 1;
  let upperPtr = maxBinIndex + 1;

  while (currentVaVolume < targetVaVolume && (lowerPtr >= 0 || upperPtr < numBins)) {
    const lowerVol = lowerPtr >= 0 ? bins[lowerPtr].totalVolume : -1;
    const upperVol = upperPtr < numBins ? bins[upperPtr].totalVolume : -1;

    if (upperVol >= lowerVol && upperPtr < numBins) {
      bins[upperPtr].inValueArea = true;
      currentVaVolume += upperVol;
      upperPtr++;
    } else if (lowerPtr >= 0) {
      bins[lowerPtr].inValueArea = true;
      currentVaVolume += lowerVol;
      lowerPtr--;
    } else if (upperPtr < numBins) {
      bins[upperPtr].inValueArea = true;
      currentVaVolume += upperVol;
      upperPtr++;
    }
  }

  // Classify HVN & LVN liquidity nodes
  const rankedByVol = [...bins]
    .filter((b) => b.totalVolume >= hvnThreshold)
    .sort((a, b) => b.totalVolume - a.totalVolume);

  rankedByVol.forEach((b, rankIdx) => {
    bins[b.binIndex].isHvn = true;
    bins[b.binIndex].clusterRank = rankIdx + 1;
  });

  bins.forEach((b) => {
    if (!b.isHvn && b.totalVolume > 0 && b.totalVolume <= lvnThreshold) {
      b.isLvn = true;
    }
  });

  // Group contiguous HVN bins into institutional liquidity clusters (top 3 clusters)
  const hvnClusters: Array<{
    lowPrice: number;
    highPrice: number;
    midPrice: number;
    totalVolume: number;
  }> = [];

  let activeCluster: {
    lowPrice: number;
    highPrice: number;
    totalVolume: number;
  } | null = null;

  for (let i = 0; i < bins.length; i++) {
    const b = bins[i];
    if (b.isHvn) {
      if (!activeCluster) {
        activeCluster = {
          lowPrice: b.lowPrice,
          highPrice: b.highPrice,
          totalVolume: b.totalVolume,
        };
      } else {
        activeCluster.highPrice = b.highPrice;
        activeCluster.totalVolume += b.totalVolume;
      }
    } else if (activeCluster) {
      hvnClusters.push({
        ...activeCluster,
        midPrice: (activeCluster.lowPrice + activeCluster.highPrice) / 2,
      });
      activeCluster = null;
    }
  }
  if (activeCluster) {
    hvnClusters.push({
      ...activeCluster,
      midPrice: (activeCluster.lowPrice + activeCluster.highPrice) / 2,
    });
  }

  const topClusters = hvnClusters
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 3);

  const vaBins = bins.filter((b) => b.inValueArea);
  const vah = vaBins.length > 0 ? Math.max(...vaBins.map((b) => b.highPrice)) : maxPrice;
  const val = vaBins.length > 0 ? Math.min(...vaBins.map((b) => b.lowPrice)) : minPrice;

  return {
    bins,
    maxBinVol,
    meanActiveBinVol,
    hvnThreshold,
    pocPrice: pocBin.midPrice,
    pocBinIndex: maxBinIndex,
    vah,
    val,
    binSize,
    hvnClusters: topClusters,
    historicalBlendActive: extraHistorical.length > 0,
    totalSampleCandles: visibleCandles.length + extraHistorical.length,
  };
}
