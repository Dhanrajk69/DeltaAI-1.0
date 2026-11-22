import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  MarketTicker,
  Position,
  PortfolioData,
  TradingMode,
  NewsSentimentRadarData,
  AiTradeCardData,
  PositionAdjustment,
} from '../types';
import { useAiMatrixCorrelation } from '../context/AiMatrixCorrelationContext';
import { formatEnumLabel } from '../utils/enumFormatters';
import {
  Pause,
  Play,
  List,
  Volume2,
  VolumeX,
  X,
  Target,
  ExternalLink,
  Newspaper,
  BarChart3,
  ShieldAlert,
} from 'lucide-react';

export interface SynthesizedBulletin {
  id: string;
  category:
    | 'CAMARILLA'
    | 'CPR'
    | 'VWAP_EMA'
    | 'VPVR'
    | 'SENTIMENT'
    | 'HEADLINE'
    | 'MICROSTRUCTURE'
    | 'POSITION_AUDIT'
    | 'DISPLACEMENT';
  tag: string;
  badgeBg: string;
  badgeColor: string;
  headline: string;
  timestamp: number;
  isPriority?: boolean;
  targetPrice?: number;
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  symbol?: string;
  side?: 'LONG' | 'SHORT';
  levelType?:
    | 'H4'
    | 'H5'
    | 'L4'
    | 'CPR'
    | 'POC'
    | 'VWAP'
    | 'ENTRY'
    | 'SL'
    | 'TP1'
    | 'TP2'
    | 'BE_STOP';
  scalePct?: number;
  adjustmentRef?: PositionAdjustment;
  newsLink?: string;
  newsSource?: string;
  newsImpact?: 'HIGH' | 'MEDIUM' | 'LOW';
  isDeltaFeed?: boolean;
}

export interface FlashLiveStreamProps {
  markets: Record<string, MarketTicker>;
  positions: Position[];
  portfolio: PortfolioData;
  tradingMode?: TradingMode;
  selectedSymbol: string;
  currencyPrefix?: string;
  exchangeRate?: number;
  newsRadarData?: NewsSentimentRadarData | null;
  wsLatency?: number;
  lastTickTimestamp?: number;
  onSelectBulletin?: (tradeSetup: AiTradeCardData, levelType?: string) => void;
  onOpenNewsRadar?: () => void;
  soundAlertsEnabled?: boolean;
  onToggleSound?: () => void;
  sniperEngine?: any;
}

type AllFeedFilter = 'ALL' | 'NEWS_SENTIMENT' | 'ALERTS_CPR';

// Leaf component so 1s tick-age counter never re-renders the marquee track or parent component
const LiveTickAge: React.FC<{ lastTickTimestamp?: number }> = React.memo(({ lastTickTimestamp }) => {
  const [ageSec, setAgeSec] = useState<number>(0);

  useEffect(() => {
    const computeAge = () => {
      if (lastTickTimestamp && lastTickTimestamp > 0) {
        setAgeSec(Math.max(0, Math.floor((Date.now() - lastTickTimestamp) / 1000)));
      } else {
        setAgeSec((prev) => (prev >= 6 ? 0 : prev + 1));
      }
    };
    computeAge();
    const timer = setInterval(computeAge, 1000);
    return () => clearInterval(timer);
  }, [lastTickTimestamp]);

  return <span className="inline-block min-w-[2.2ch] text-right tabular-nums">{ageSec}s</span>;
});

interface MarqueeItemRowProps {
  item: SynthesizedBulletin;
  isDuplicate: boolean;
  lastTickTimestamp?: number;
  onSelect: (item: SynthesizedBulletin) => void;
}

// Memoized item row updated in-place by stable ID without unmounting or resetting CSS animation
const MarqueeItemRow: React.FC<MarqueeItemRowProps> = React.memo(
  ({ item, isDuplicate, lastTickTimestamp, onSelect }) => {
    return (
      <>
        <button
          type="button"
          tabIndex={isDuplicate ? -1 : 0}
          onClick={() => onSelect(item)}
          className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md hover:bg-slate-800/80 transition-colors cursor-pointer whitespace-nowrap group/item tabular-nums"
          title={
            item.category === 'HEADLINE' || item.category === 'SENTIMENT'
              ? 'Click to open Live News & Sentiment Radar'
              : 'Click to highlight reference level on chart and cue Execution Pad'
          }
        >
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] tracking-tight leading-none tabular-nums ${item.badgeBg} ${item.badgeColor}`}
          >
            {item.tag}
          </span>
          <span className="text-[11px] sm:text-xs text-slate-200 group-hover/item:text-white font-medium tabular-nums">
            {item.headline}
            {item.isDeltaFeed && (
              <>
                {' · Tick '}
                <LiveTickAge lastTickTimestamp={lastTickTimestamp} />
              </>
            )}
          </span>
        </button>
        <span className="mx-2 text-slate-700 text-[10px] select-none" aria-hidden="true">
          •
        </span>
      </>
    );
  }
);

const MARQUEE_PX_PER_SEC = 55;
const MARQUEE_MIN_DURATION_SEC = 25;
const MARQUEE_WIDTH_DEADBAND_PX = 48;

export const FlashLiveStream: React.FC<FlashLiveStreamProps> = React.memo(
  ({
    markets,
    positions,
    portfolio,
    selectedSymbol,
    currencyPrefix = '$',
    exchangeRate = 1,
    newsRadarData,
    wsLatency = 42,
    lastTickTimestamp,
    onSelectBulletin,
    onOpenNewsRadar,
    soundAlertsEnabled = false,
    onToggleSound,
    sniperEngine,
  }) => {
    const {
      aiMatrixScore,
      correlatedSignal,
      syncLevelToExecutionPad,
      activeAdjustmentsList,
      isCircuitBreakerTripped,
      circuitBreakerReason,
    } = useAiMatrixCorrelation();

    const [isManuallyPaused, setIsManuallyPaused] = useState<boolean>(false);
    const [isAllDrawerOpen, setIsAllDrawerOpen] = useState<boolean>(false);
    const [allFeedFilter, setAllFeedFilter] = useState<AllFeedFilter>('ALL');
    const [priorityAlert, setPriorityAlert] = useState<SynthesizedBulletin | null>(null);

    const priceWindowRef = useRef<{ time: number; price: number }[]>([]);
    const priorityExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const marqueeTrackRef = useRef<HTMLDivElement | null>(null);
    const firstSegmentRef = useRef<HTMLDivElement | null>(null);
    const lastMeasuredWidthRef = useRef<number>(0);
    const lastDurationSecRef = useRef<number>(45);

    useEffect(() => {
      return () => {
        if (priorityExpiryRef.current) clearTimeout(priorityExpiryRef.current);
      };
    }, []);

    // Close the "All" quick-view drawer on outside click or Escape
    useEffect(() => {
      if (!isAllDrawerOpen) return;
      const handlePointerDown = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setIsAllDrawerOpen(false);
        }
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setIsAllDrawerOpen(false);
      };
      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('mousedown', handlePointerDown);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }, [isAllDrawerOpen]);

    // Constant ~55px/sec broadcast speed via ResizeObserver on the half-track segment,
    // preserving exact animation progress via Web Animations API so adding/removing headlines never jumps
    useEffect(() => {
      const segmentEl = firstSegmentRef.current;
      const trackEl = marqueeTrackRef.current;
      if (!segmentEl || !trackEl) return;

      const applyConstantSpeedDuration = (measuredHalfWidth: number) => {
        if (!Number.isFinite(measuredHalfWidth) || measuredHalfWidth <= 0) return;

        // Deadband prevents minor digit-width fluctuations on price ticks from altering animation duration
        const prevWidth = lastMeasuredWidthRef.current;
        if (prevWidth > 0 && Math.abs(measuredHalfWidth - prevWidth) < MARQUEE_WIDTH_DEADBAND_PX) {
          return;
        }

        const nextDurationSec = Math.max(
          MARQUEE_MIN_DURATION_SEC,
          Math.round(measuredHalfWidth / MARQUEE_PX_PER_SEC)
        );
        const prevDurationSec = lastDurationSecRef.current;
        lastMeasuredWidthRef.current = measuredHalfWidth;

        if (prevWidth > 0 && nextDurationSec === prevDurationSec) {
          return;
        }

        // Preserve current scroll progress ratio seamlessly if duration adjusts when headlines arrive
        let preservedProgress: number | null = null;
        let runningAnim: Animation | null = null;
        try {
          const anims = typeof trackEl.getAnimations === 'function' ? trackEl.getAnimations() : [];
          if (anims.length > 0 && typeof anims[0].currentTime === 'number' && prevDurationSec > 0) {
            runningAnim = anims[0];
            preservedProgress = ((anims[0].currentTime / 1000) % prevDurationSec) / prevDurationSec;
          }
        } catch {
          // Ignore browsers without getAnimations support
        }

        lastDurationSecRef.current = nextDurationSec;
        trackEl.style.setProperty('--marquee-duration', `${nextDurationSec}s`);

        if (runningAnim && preservedProgress !== null && Number.isFinite(preservedProgress)) {
          try {
            runningAnim.currentTime = preservedProgress * nextDurationSec * 1000;
          } catch {
            // Ignore read-only currentTime in restricted environments
          }
        }
      };

      // Initial synchronous measurement
      applyConstantSpeedDuration(segmentEl.getBoundingClientRect().width);

      if (typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        const width =
          entry?.borderBoxSize?.[0]?.inlineSize ??
          entry?.contentRect?.width ??
          segmentEl.getBoundingClientRect().width;
        applyConstantSpeedDuration(width);
      });

      observer.observe(segmentEl);
      return () => observer.disconnect();
    }, []);

    const curMarket = markets[selectedSymbol] ||
      markets['BTCUSD'] ||
      markets['BTCUSDT'] || {
        symbol: selectedSymbol,
        name: `${selectedSymbol} Perpetual`,
        markPrice: 81702.5,
        indexPrice: 81737.9,
        change24h: -0.68,
        high24h: 82307.5,
        low24h: 80894.0,
        volume24hUsd: 882428819,
        fundingRate: 0.0042,
        nextFundingCountdown: '03:42:18',
      };

    const markPrice = curMarket.markPrice || 81702.5;
    const high24h = curMarket.high24h || markPrice * 1.018;
    const low24h = curMarket.low24h || markPrice * 0.982;
    const change24h = curMarket.change24h ?? 0;

    // Real-Time Price Displacement Detector (stable ID so updating never remounts track)
    useEffect(() => {
      const now = Date.now();
      priceWindowRef.current.push({ time: now, price: markPrice });
      priceWindowRef.current = priceWindowRef.current.filter((p) => now - p.time <= 180000);

      if (priceWindowRef.current.length > 2) {
        const oldest = priceWindowRef.current[0].price;
        const delta = markPrice - oldest;
        const deltaPct = oldest > 0 ? (delta / oldest) * 100 : 0;

        if (Math.abs(deltaPct) >= 0.25) {
          const isSurge = deltaPct > 0;
          const symShort = selectedSymbol.replace('USDT', '').replace('USD', '');
          const alert: SynthesizedBulletin = {
            id: 'displacement-alert',
            category: 'DISPLACEMENT',
            tag: '⚡ DISPLACEMENT',
            badgeBg: isSurge
              ? 'bg-emerald-950/90 border-emerald-500/70'
              : 'bg-rose-950/90 border-rose-500/70',
            badgeColor: isSurge ? 'text-emerald-300' : 'text-rose-300',
            headline: `${symShort} ${isSurge ? 'surged' : 'dropped'} ${isSurge ? '+' : ''}${deltaPct.toFixed(2)}% in 3m · Testing ${isSurge ? 'H4 Breakout' : 'L4 Breakdown'}`,
            timestamp: now,
            isPriority: true,
            targetPrice: markPrice,
            stopLoss: isSurge ? markPrice * 0.992 : markPrice * 1.008,
            tp1: isSurge ? markPrice * 1.015 : markPrice * 0.985,
            tp2: isSurge ? markPrice * 1.03 : markPrice * 0.97,
            symbol: selectedSymbol,
            side: isSurge ? 'LONG' : 'SHORT',
            levelType: isSurge ? 'H4' : 'L4',
          };

          setPriorityAlert(alert);
          if (priorityExpiryRef.current) clearTimeout(priorityExpiryRef.current);
          priorityExpiryRef.current = setTimeout(() => {
            setPriorityAlert(null);
          }, 15000);
        }
      }
    }, [markPrice, selectedSymbol]);

    // Memoize live headlines separately by stable headline.id so price ticks don't rebuild headline items
    const headlineBulletins = useMemo<SynthesizedBulletin[]>(() => {
      const liveHeadlines = Array.isArray(newsRadarData?.headlines) ? newsRadarData.headlines : [];
      const fallbackTs = newsRadarData?.lastUpdated || 0;
      return liveHeadlines
        .filter((item) => Boolean(item?.title))
        .map((item, idx) => {
          const isBullH = item.sentiment === 'BULLISH';
          const isBearH = item.sentiment === 'BEARISH';
          const impactPrefix = item.impact === 'HIGH' ? '🔥 ' : '';
          const stableHeadlineId = item.id || `hl-${idx}-${item.title.slice(0, 24)}`;
          return {
            id: `news-headline-${stableHeadlineId}`,
            category: 'HEADLINE' as const,
            tag: `📰 HEADLINE${item.source ? ` · ${item.source}` : ''}`,
            badgeBg: isBullH
              ? 'bg-emerald-950/80 border-emerald-600/65'
              : isBearH
              ? 'bg-rose-950/80 border-rose-600/65'
              : 'bg-slate-900/90 border-cyan-700/60',
            badgeColor: isBullH
              ? 'text-emerald-300 font-semibold'
              : isBearH
              ? 'text-rose-300 font-semibold'
              : 'text-cyan-300 font-semibold',
            headline: `${impactPrefix}${item.title}`,
            timestamp: item.timestamp || fallbackTs,
            symbol: selectedSymbol,
            side: isBearH ? ('SHORT' as const) : ('LONG' as const),
            newsLink: item.link,
            newsSource: item.source,
            newsImpact: item.impact,
          };
        });
    }, [newsRadarData?.headlines, newsRadarData?.lastUpdated, selectedSymbol]);

    // Memoize sentiment bulletin keyed by stable sentimentRegime
    const sentimentBulletin = useMemo<SynthesizedBulletin>(() => {
      const sentScore = Math.round(newsRadarData?.aggregateScore ?? 0);
      const sentOverall =
        newsRadarData?.overallSentiment ??
        (sentScore > 10 ? 'BULLISH' : sentScore < -10 ? 'BEARISH' : 'NEUTRAL');
      const isBearishSent = sentOverall === 'BEARISH' || sentScore < 0;
      const isBullishSent = sentOverall === 'BULLISH' || sentScore > 0;
      const dominantPct = isBearishSent
        ? Math.round(newsRadarData?.bearishScore ?? Math.min(99, Math.max(50, Math.abs(sentScore) + 33)))
        : isBullishSent
        ? Math.round(newsRadarData?.bullishScore ?? Math.min(99, Math.max(50, Math.abs(sentScore) + 33)))
        : Math.round(newsRadarData?.neutralScore ?? 50);
      const biasShort = isBearishSent ? 'Bear' : isBullishSent ? 'Bull' : 'Neutral';
      const signedScore = sentScore > 0 ? `+${sentScore}` : `${sentScore}`;
      const regimeNote =
        Math.abs(sentScore) >= 25
          ? 'Regime Shift'
          : newsRadarData?.macroCatalyst
          ? newsRadarData.macroCatalyst.slice(0, 64)
          : Math.abs(change24h) > 2
          ? 'Volatility Expansion'
          : 'Balanced Flow';

      return {
        id: 'sentimentRegime',
        category: 'SENTIMENT',
        tag: `📊 SENTIMENT: ${dominantPct}% ${biasShort} (${signedScore})`,
        badgeBg: isBearishSent
          ? 'bg-rose-950/90 border-rose-500/75'
          : isBullishSent
          ? 'bg-emerald-950/90 border-emerald-500/75'
          : 'bg-amber-950/85 border-amber-500/70',
        badgeColor: isBearishSent
          ? 'text-rose-300 font-bold'
          : isBullishSent
          ? 'text-emerald-300 font-bold'
          : 'text-amber-300 font-bold',
        headline: `${regimeNote}${
          newsRadarData?.macroCatalyst && Math.abs(sentScore) >= 25
            ? ` · ${newsRadarData.macroCatalyst}`
            : ''
        }`,
        timestamp: newsRadarData?.lastUpdated || 0,
        isPriority: Math.abs(sentScore) >= 25,
        symbol: selectedSymbol,
        side: isBearishSent ? 'SHORT' : 'LONG',
      };
    }, [
      newsRadarData?.aggregateScore,
      newsRadarData?.overallSentiment,
      newsRadarData?.bearishScore,
      newsRadarData?.bullishScore,
      newsRadarData?.neutralScore,
      newsRadarData?.macroCatalyst,
      newsRadarData?.lastUpdated,
      change24h,
      selectedSymbol,
    ]);

    // Quantize latency into 5ms buckets so micro jitter (41ms <-> 43ms) doesn't trigger unnecessary rebuilds
    const bucketedLatencyMs = Math.max(1, Math.round(wsLatency / 5) * 5);

    // Unified Continuous Ticker Synthesis with stable IDs (updates text in place without remounting)
    const synthesizedBulletins = useMemo<SynthesizedBulletin[]>(() => {
      const bulletins: SynthesizedBulletin[] = [];
      const symShort = selectedSymbol.replace('USDT', '').replace('USD', '');
      const fmtPrice = (p: number) =>
        `${currencyPrefix}${(p * exchangeRate).toLocaleString('en-US', {
          minimumFractionDigits: p > 10 ? 2 : 4,
          maximumFractionDigits: p > 10 ? 2 : 4,
        })}`;

      // 1. Circuit Breaker (if tripped)
      if (isCircuitBreakerTripped) {
        bulletins.push({
          id: 'circuit-breaker-hard-lock',
          category: 'POSITION_AUDIT',
          tag: '🚨 CIRCUIT BREAKER',
          badgeBg: 'bg-rose-950/95 border-rose-500/80',
          badgeColor: 'text-rose-200 font-bold',
          headline: `${circuitBreakerReason || 'Risk Limits Triggered'} · Trading Halted`,
          timestamp: 0,
          isPriority: true,
          targetPrice: markPrice,
          symbol: selectedSymbol,
          side: 'LONG',
        });
      }

      // 2. Live Market Sentiment Update (stable ID: sentimentRegime)
      bulletins.push(sentimentBulletin);

      // 3. Active Session CPR Alert (stable ID: cprType)
      const pivot = (high24h + low24h + markPrice) / 3;
      const bc = (high24h + low24h) / 2;
      const tc = pivot - bc + pivot;
      const cprWidthPct = pivot > 0 ? (Math.abs(tc - bc) / pivot) * 100 : 0.05;
      const cprRegime = cprWidthPct < 0.2 ? 'Narrow' : cprWidthPct <= 0.45 ? 'Average' : 'Wide';

      bulletins.push({
        id: 'cprType',
        category: 'CPR',
        tag: `⚡ CPR: ${cprRegime} ${cprWidthPct.toFixed(2)}%`,
        badgeBg:
          cprRegime === 'Narrow'
            ? 'bg-amber-950/90 border-amber-500/75'
            : 'bg-indigo-950/85 border-indigo-500/70',
        badgeColor: cprRegime === 'Narrow' ? 'text-amber-300 font-bold' : 'text-indigo-300 font-bold',
        headline: `${cprRegime === 'Narrow' ? 'High expansion breakout bias' : 'Rotational session range'} · TC ${fmtPrice(tc)} | P ${fmtPrice(pivot)} | BC ${fmtPrice(bc)}`,
        timestamp: 0,
        targetPrice: pivot,
        stopLoss: Math.min(tc, bc) * 0.995,
        tp1: pivot * 1.015,
        symbol: selectedSymbol,
        side: markPrice >= pivot ? 'LONG' : 'SHORT',
        levelType: 'CPR',
      });

      // 4. Active Position SL Defense & Invalidation Alerts (stable per position ID / symbol+side)
      if (positions.length > 0) {
        positions.forEach((pos) => {
          const stablePosId = pos.id || `${pos.symbol}-${pos.side}`;
          const uPnlPct = pos.unrealisedPnlPercent || 0;
          const posSymShort = pos.symbol.replace('USDT', '').replace('USD', '');
          const slPrice =
            pos.stopLoss && pos.stopLoss > 0
              ? pos.stopLoss
              : pos.side === 'LONG'
              ? pos.entryPrice * 0.985
              : pos.entryPrice * 1.015;
          const tp1Est =
            pos.takeProfit || (pos.side === 'LONG' ? pos.entryPrice * 1.025 : pos.entryPrice * 0.975);
          const tp2Est = pos.side === 'LONG' ? pos.entryPrice * 1.045 : pos.entryPrice * 0.955;

          if (uPnlPct <= -2 || (pos.unrealisedPnl || 0) < 0) {
            bulletins.push({
              id: `pos-defense-${stablePosId}`,
              category: 'POSITION_AUDIT',
              tag: `🛡️ SL Defense @ ${fmtPrice(slPrice)}`,
              badgeBg: 'bg-rose-950/90 border-rose-500/75',
              badgeColor: 'text-rose-300 font-bold',
              headline: `${posSymShort} ${pos.side} (${pos.unrealisedPnl >= 0 ? '+' : '-'}${currencyPrefix}${Math.abs((pos.unrealisedPnl || 0) * exchangeRate).toFixed(2)} / ${uPnlPct.toFixed(1)}%) · Invalidation guard active`,
              timestamp: 0,
              isPriority: uPnlPct <= -4,
              targetPrice: pos.entryPrice,
              stopLoss: slPrice,
              tp1: tp1Est,
              symbol: pos.symbol,
              side: pos.side,
              levelType: 'SL',
            });
          } else if (uPnlPct >= 10) {
            bulletins.push({
              id: `pos-defense-${stablePosId}`,
              category: 'POSITION_AUDIT',
              tag: uPnlPct >= 20 ? '🎯 PROFIT LOCK' : '🎯 SCALE 25%',
              badgeBg: 'bg-emerald-950/85 border-emerald-500/75',
              badgeColor: 'text-emerald-300 font-bold',
              headline: `${posSymShort} ${pos.side} (+${uPnlPct.toFixed(1)}%) · SL Defense @ ${fmtPrice(pos.entryPrice)} · Next TP ${fmtPrice(uPnlPct >= 20 ? tp2Est : tp1Est)}`,
              timestamp: 0,
              targetPrice: uPnlPct >= 20 ? tp2Est : tp1Est,
              stopLoss: pos.entryPrice,
              tp1: tp1Est,
              tp2: tp2Est,
              symbol: pos.symbol,
              side: pos.side,
              levelType: 'BE_STOP',
            });
          } else {
            bulletins.push({
              id: `pos-defense-${stablePosId}`,
              category: 'POSITION_AUDIT',
              tag: `🛡️ SL Defense @ ${fmtPrice(slPrice)}`,
              badgeBg: 'bg-cyan-950/85 border-cyan-500/70',
              badgeColor: 'text-cyan-300 font-bold',
              headline: `${posSymShort} ${pos.side} (${pos.leverage}x) · UPNL ${pos.unrealisedPnl >= 0 ? '+' : '-'}${currencyPrefix}${Math.abs((pos.unrealisedPnl || 0) * exchangeRate).toFixed(2)} (${uPnlPct.toFixed(1)}%)`,
              timestamp: 0,
              targetPrice: pos.entryPrice,
              stopLoss: slPrice,
              tp1: tp1Est,
              symbol: pos.symbol,
              side: pos.side,
              levelType: 'SL',
            });
          }
        });
      } else if (
        sniperEngine?.activeTrade?.currentStopLoss ||
        sniperEngine?.currentSignal?.initialStopLoss
      ) {
        const activeSl =
          sniperEngine?.activeTrade?.currentStopLoss ||
          sniperEngine?.activeTrade?.initialStopLoss ||
          sniperEngine?.currentSignal?.initialStopLoss;
        const activeSide: 'LONG' | 'SHORT' =
          sniperEngine?.activeTrade?.side ||
          (sniperEngine?.currentSignal?.signal === 'SHORT' ? 'SHORT' : 'LONG');
        if (activeSl && activeSl > 0) {
          bulletins.push({
            id: 'sniper-sl-defense',
            category: 'POSITION_AUDIT',
            tag: `🛡️ SL Defense @ ${fmtPrice(activeSl)}`,
            badgeBg: 'bg-amber-950/85 border-amber-500/70',
            badgeColor: 'text-amber-300 font-bold',
            headline: `${symShort} ${activeSide} Sniper Invalidation Level · Avail Margin ${currencyPrefix}${(portfolio.availableBalance * exchangeRate).toFixed(2)}`,
            timestamp: 0,
            targetPrice:
              sniperEngine?.activeTrade?.entryPrice ||
              sniperEngine?.currentSignal?.entryPrice ||
              markPrice,
            stopLoss: activeSl,
            symbol: selectedSymbol,
            side: activeSide,
            levelType: 'SL',
          });
        }
      }

      // Dynamic Ratchet Adjustments
      activeAdjustmentsList.forEach((adj) => {
        const isStage1 = adj.stage === 1;
        bulletins.push({
          id: `dyn-ratchet-${adj.positionId}`,
          category: 'POSITION_AUDIT',
          tag: isStage1 ? '🛡️ RATCHET BE' : '🛡️ TRAILING ATR',
          badgeBg: isStage1
            ? 'bg-amber-950/90 border-amber-500/75'
            : 'bg-purple-950/90 border-purple-500/75',
          badgeColor: isStage1 ? 'text-amber-300 font-bold' : 'text-purple-300 font-bold',
          headline: `${adj.symbol} ${adj.side} (+${adj.unrealizedPnlPct.toFixed(1)}%) · SL -> ${fmtPrice(adj.recommendedStopLoss)}`,
          timestamp: adj.timestamp,
          isPriority: true,
          targetPrice: adj.currentMarkPrice,
          stopLoss: adj.recommendedStopLoss,
          tp1: adj.side === 'LONG' ? adj.currentMarkPrice * 1.03 : adj.currentMarkPrice * 0.97,
          symbol: adj.symbol,
          side: adj.side,
          scalePct: adj.recommendedScalePct,
          adjustmentRef: adj,
          levelType: 'BE_STOP',
        });
      });

      // 5. All Live Crypto & Macro Headlines (memoized by headline.id)
      bulletins.push(...headlineBulletins);

      // 6. AI Matrix Consensus Setup
      const activeSniper = sniperEngine?.activeTrade || sniperEngine?.currentSignal;
      const dynamicSide: 'LONG' | 'SHORT' =
        activeSniper?.side ||
        (activeSniper?.signal
          ? activeSniper.signal === 'SHORT'
            ? 'SHORT'
            : 'LONG'
          : correlatedSignal.side) ||
        'SHORT';
      const dynamicEntry =
        activeSniper?.entryPrice && activeSniper.entryPrice > 0
          ? activeSniper.entryPrice
          : correlatedSignal.entryPrice;
      const dynamicSl =
        (activeSniper?.currentStopLoss || activeSniper?.initialStopLoss || activeSniper?.stopLoss) >
        0
          ? activeSniper.currentStopLoss || activeSniper.initialStopLoss || activeSniper.stopLoss
          : correlatedSignal.stopLoss;
      const dynamicTp1 =
        activeSniper?.tp1 && activeSniper.tp1 > 0 ? activeSniper.tp1 : correlatedSignal.tp1;
      const dynamicTp2 =
        activeSniper?.tp2 && activeSniper.tp2 > 0 ? activeSniper.tp2 : correlatedSignal.tp2;

      bulletins.push({
        id: 'bulletin-ai-matrix-score',
        category: 'CAMARILLA',
        tag: `🤖 AI MATRIX ${aiMatrixScore.total}/180 · Grade ${aiMatrixScore.grade}`,
        badgeBg:
          aiMatrixScore.grade === 'A+' || aiMatrixScore.grade === 'A'
            ? 'bg-cyan-950/90 border-cyan-500/75'
            : 'bg-emerald-950/85 border-emerald-500/70',
        badgeColor: 'text-cyan-300 font-bold',
        headline: `${dynamicSide} ${symShort} Entry ${fmtPrice(dynamicEntry)} | SL ${fmtPrice(dynamicSl)} | TP1 ${fmtPrice(dynamicTp1)} (${aiMatrixScore.convictionPct}%)`,
        timestamp: 0,
        targetPrice: dynamicEntry,
        stopLoss: dynamicSl,
        tp1: dynamicTp1,
        tp2: dynamicTp2,
        symbol: selectedSymbol,
        side: dynamicSide,
        levelType: 'ENTRY',
      });

      if (!correlatedSignal.isApproved) {
        bulletins.push({
          id: 'bulletin-ai-risk-gate',
          category: 'POSITION_AUDIT',
          tag: `⛔ RISK GATE [${formatEnumLabel(correlatedSignal.gateFailed, 'Locked')}]`,
          badgeBg: 'bg-rose-950/90 border-rose-500/75',
          badgeColor: 'text-rose-300 font-bold',
          headline: `${correlatedSignal.rejectionReason || 'Universal Risk Engine 0.50% Budget Locked'}`,
          timestamp: 0,
          targetPrice: markPrice,
          symbol: selectedSymbol,
          side: correlatedSignal.side,
        });
      }

      // 7. Camarilla Breakout, VWAP/EMA, VPVR POC & Delta Feed Telemetry
      const range = high24h - low24h;
      const h4 = markPrice + (range * 1.1) / 2;
      const h5 = (high24h / (low24h || 1)) * markPrice;
      const l4 = markPrice - (range * 1.1) / 2;
      const l5 = markPrice - (h5 - markPrice);
      const isBull = markPrice >= (h4 + l4) / 2;

      bulletins.push({
        id: 'camarilla-regime',
        category: 'CAMARILLA',
        tag: isBull ? '📈 CAMARILLA H4' : '📉 CAMARILLA L4',
        badgeBg: isBull
          ? 'bg-emerald-950/80 border-emerald-700/75'
          : 'bg-rose-950/80 border-rose-700/75',
        badgeColor: isBull ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-semibold',
        headline: `${symShort} ${fmtPrice(markPrice)} vs ${isBull ? `H4 ${fmtPrice(h4)} -> Target H5 ${fmtPrice(h5)}` : `L4 ${fmtPrice(l4)} -> Target L5 ${fmtPrice(l5)}`}`,
        timestamp: 0,
        targetPrice: isBull ? h4 : l4,
        stopLoss: isBull ? markPrice * 0.99 : markPrice * 1.01,
        tp1: isBull ? h5 : l5,
        tp2: isBull ? h5 * 1.015 : l5 * 0.985,
        symbol: selectedSymbol,
        side: isBull ? 'LONG' : 'SHORT',
        levelType: isBull ? 'H4' : 'L4',
      });

      const vwapApprox = (high24h + low24h + markPrice * 2) / 4;
      const vwapDiff = markPrice - vwapApprox;
      const vwapAbove = vwapDiff >= 0;

      bulletins.push({
        id: 'vwap-ema',
        category: 'VWAP_EMA',
        tag: '💠 VWAP & EMA',
        badgeBg: vwapAbove
          ? 'bg-cyan-950/80 border-cyan-700/75'
          : 'bg-amber-950/80 border-amber-700/75',
        badgeColor: vwapAbove ? 'text-cyan-300 font-semibold' : 'text-amber-300 font-semibold',
        headline: `${vwapAbove ? '+' : '-'}${currencyPrefix}${Math.abs(vwapDiff * exchangeRate).toFixed(2)} ${vwapAbove ? 'above' : 'below'} 5m VWAP (${fmtPrice(vwapApprox)}) · 9/20 EMA ${vwapAbove ? 'Bullish Stack' : 'Mean Reversion'}`,
        timestamp: 0,
        targetPrice: vwapApprox,
        stopLoss: vwapApprox * (vwapAbove ? 0.992 : 1.008),
        tp1: markPrice * (vwapAbove ? 1.015 : 0.985),
        symbol: selectedSymbol,
        side: vwapAbove ? 'LONG' : 'SHORT',
        levelType: 'VWAP',
      });

      const pocEstimate = low24h + (high24h - low24h) * 0.485;
      const vahEstimate = pocEstimate * 1.008;
      const valEstimate = pocEstimate * 0.992;

      bulletins.push({
        id: 'vpvr-poc',
        category: 'VPVR',
        tag: '📊 VPVR POC',
        badgeBg: 'bg-amber-950/80 border-amber-700/75',
        badgeColor: 'text-amber-300 font-semibold',
        headline: `POC ${fmtPrice(pocEstimate)} · Value Area ${fmtPrice(valEstimate)} – ${fmtPrice(vahEstimate)}`,
        timestamp: 0,
        targetPrice: pocEstimate,
        stopLoss: valEstimate * 0.995,
        tp1: vahEstimate * 1.01,
        symbol: selectedSymbol,
        side: 'LONG',
        levelType: 'POC',
      });

      bulletins.push({
        id: 'delta-microstructure',
        category: 'MICROSTRUCTURE',
        tag: '🛰️ DELTA FEED',
        badgeBg: 'bg-cyan-950/80 border-cyan-800/75',
        badgeColor: 'text-cyan-300 font-semibold',
        headline: `Latency ${bucketedLatencyMs}ms · Funding +${(curMarket.fundingRate || 0.0042).toFixed(4)}%`,
        timestamp: 0,
        targetPrice: markPrice,
        symbol: selectedSymbol,
        side: 'LONG',
        isDeltaFeed: true,
      });

      return bulletins;
    }, [
      selectedSymbol,
      markPrice,
      high24h,
      low24h,
      currencyPrefix,
      exchangeRate,
      positions,
      portfolio.availableBalance,
      sentimentBulletin,
      headlineBulletins,
      bucketedLatencyMs,
      curMarket.fundingRate,
      sniperEngine,
      aiMatrixScore,
      correlatedSignal,
      activeAdjustmentsList,
      isCircuitBreakerTripped,
      circuitBreakerReason,
    ]);

    const activeStream = useMemo(() => {
      if (priorityAlert) {
        return [priorityAlert, ...synthesizedBulletins.filter((b) => b.id !== priorityAlert.id)];
      }
      return synthesizedBulletins;
    }, [priorityAlert, synthesizedBulletins]);

    const headlineCount = useMemo(
      () => activeStream.filter((b) => b.category === 'HEADLINE' || b.category === 'SENTIMENT').length,
      [activeStream]
    );

    const filteredDrawerItems = useMemo(() => {
      if (allFeedFilter === 'NEWS_SENTIMENT') {
        return activeStream.filter((b) => b.category === 'HEADLINE' || b.category === 'SENTIMENT');
      }
      if (allFeedFilter === 'ALERTS_CPR') {
        return activeStream.filter((b) => b.category !== 'HEADLINE' && b.category !== 'SENTIMENT');
      }
      return activeStream;
    }, [activeStream, allFeedFilter]);

    const handleClickBulletin = useCallback(
      (b: SynthesizedBulletin) => {
        if ((b.category === 'SENTIMENT' || b.category === 'HEADLINE') && onOpenNewsRadar) {
          onOpenNewsRadar();
          setIsAllDrawerOpen(false);
          return;
        }

        const target = b.targetPrice || markPrice;
        const side = b.side || 'LONG';

        syncLevelToExecutionPad({
          symbol: b.symbol || selectedSymbol,
          side,
          price: target,
          stopLoss: b.stopLoss,
          takeProfit: b.tp1,
          size: b.adjustmentRef ? undefined : correlatedSignal.allowedLotSize,
          reason: b.adjustmentRef?.reason || b.tag,
          type:
            (b.levelType as any) ||
            (b.adjustmentRef ? (b.adjustmentRef.stage === 1 ? 'BE_STOP' : 'SL') : 'ENTRY'),
          stage: b.adjustmentRef?.stage,
        });

        if (onSelectBulletin) {
          const tradeSetup: AiTradeCardData = {
            symbol: b.symbol || selectedSymbol,
            action: side === 'SHORT' ? 'SELL_SHORT' : 'BUY_LONG',
            entryZone: [target * 0.998, target * 1.002],
            stopLoss: b.stopLoss || (side === 'LONG' ? target * 0.988 : target * 1.012),
            tp1: b.tp1 || (side === 'LONG' ? target * 1.025 : target * 0.975),
            tp2: b.tp2 || (side === 'LONG' ? target * 1.045 : target * 0.955),
            riskRewardRatio: '2.5R',
            riskLevel: 'Medium',
            recommendedLeverage: 10,
            strategy: b.tag || 'AI Matrix & Camarilla Confluence',
            lotSize: correlatedSignal.allowedLotSize,
          };
          onSelectBulletin(tradeSetup, b.levelType);
        }

        setIsAllDrawerOpen(false);
      },
      [
        onOpenNewsRadar,
        markPrice,
        syncLevelToExecutionPad,
        selectedSymbol,
        correlatedSignal.allowedLotSize,
        onSelectBulletin,
      ]
    );

    return (
      <div ref={containerRef} className="relative w-full z-40">
        <div className="panel-delta w-full rounded-lg px-2 py-1 flex items-center justify-between gap-2 text-xs font-mono-numbers select-none transition-all hover:border-slate-700/90">
          {/* Left Segment: Compact LIVE Pulsing Beacon */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="badge-delta badge-delta-live !py-0.5 !px-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-[10px] font-extrabold tracking-wider">LIVE</span>
            </div>
          </div>

          {/* Center Segment: 60fps GPU-Accelerated Seamless Horizontal Marquee Ticker */}
          <div className="live-bulletin-marquee-viewport flex-1 min-w-0">
            <div
              ref={marqueeTrackRef}
              className={`live-bulletin-marquee-track ${
                isManuallyPaused || isAllDrawerOpen ? 'live-bulletin-marquee-paused' : ''
              }`}
            >
              {/* Primary Track Half (observed by ResizeObserver for exact ~55px/s constant speed) */}
              <div ref={firstSegmentRef} className="inline-flex items-center shrink-0">
                {activeStream.map((item) => (
                  <MarqueeItemRow
                    key={`track-a-${item.id}`}
                    item={item}
                    isDuplicate={false}
                    lastTickTimestamp={lastTickTimestamp}
                    onSelect={handleClickBulletin}
                  />
                ))}
              </div>
              {/* Duplicate Track Half for Seamless -50% Loop */}
              <div className="inline-flex items-center shrink-0" aria-hidden="true">
                {activeStream.map((item) => (
                  <MarqueeItemRow
                    key={`track-b-${item.id}`}
                    item={item}
                    isDuplicate={true}
                    lastTickTimestamp={lastTickTimestamp}
                    onSelect={handleClickBulletin}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Right Segment: Subtle [Pause / All] Quick-View Pill + Sound Toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <div className="inline-flex items-center rounded-md bg-slate-900/90 border border-slate-700/80 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsManuallyPaused((prev) => !prev)}
                className={`inline-flex items-center gap-1 h-6 px-2 text-[10px] font-semibold transition-colors cursor-pointer ${
                  isManuallyPaused
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                }`}
                title={isManuallyPaused ? 'Resume live ticker scroll' : 'Pause live ticker scroll'}
                aria-pressed={isManuallyPaused}
              >
                {isManuallyPaused ? (
                  <>
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>Play</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-2.5 h-2.5" />
                    <span>Pause</span>
                  </>
                )}
              </button>
              <span className="w-[1px] h-3.5 bg-slate-700/80" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setIsAllDrawerOpen((prev) => !prev)}
                className={`inline-flex items-center gap-1 h-6 px-2 text-[10px] font-semibold transition-colors cursor-pointer ${
                  isAllDrawerOpen
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'text-cyan-300/90 hover:text-cyan-200 hover:bg-slate-800/80'
                }`}
                aria-expanded={isAllDrawerOpen}
                title="View all live sentiment updates, headlines, CPR & SL alerts"
              >
                <List className="w-2.5 h-2.5" />
                <span>All</span>
                <span className="text-[9px] text-slate-400 tabular-nums">({activeStream.length})</span>
              </button>
            </div>

            {onToggleSound && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSound();
                }}
                className="btn-delta-sm btn-secondary !h-6 !w-6 !px-0"
                title={soundAlertsEnabled ? 'Mute flash alerts' : 'Enable flash audio alerts'}
              >
                {soundAlertsEnabled ? (
                  <Volume2 className="w-3 h-3 text-emerald-400" />
                ) : (
                  <VolumeX className="w-3 h-3 text-slate-500" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Quick-View All Live Feed Drawer */}
        {isAllDrawerOpen && (
          <div className="absolute right-0 top-full mt-1.5 w-full sm:w-[34rem] max-w-[calc(100vw-24px)] rounded-xl bg-[#080d1a]/98 border border-cyan-500/35 shadow-2xl backdrop-blur-md p-2.5 z-50">
            <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-800/90">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Live Unified Ticker Feed ({activeStream.length})</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setAllFeedFilter('ALL')}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer border transition-colors ${
                    allFeedFilter === 'ALL'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/45'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  All ({activeStream.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAllFeedFilter('NEWS_SENTIMENT')}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer border transition-colors ${
                    allFeedFilter === 'NEWS_SENTIMENT'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/45'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  <Newspaper className="w-2.5 h-2.5" />
                  <span>News ({headlineCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAllFeedFilter('ALERTS_CPR')}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer border transition-colors ${
                    allFeedFilter === 'ALERTS_CPR'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/45'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  <ShieldAlert className="w-2.5 h-2.5" />
                  <span>Alerts</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAllDrawerOpen(false)}
                  className="ml-1 p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                  aria-label="Close live ticker feed list"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {filteredDrawerItems.map((item) => {
                const isNewsOrSent = item.category === 'HEADLINE' || item.category === 'SENTIMENT';
                return (
                  <div
                    key={`drawer-${item.id}`}
                    className="w-full rounded-lg bg-slate-900/75 hover:bg-slate-800/85 border border-slate-800/90 hover:border-cyan-500/40 transition-colors p-2 flex items-start justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleClickBulletin(item)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] leading-none ${item.badgeBg} ${item.badgeColor}`}
                        >
                          {item.tag}
                        </span>
                        {item.newsImpact === 'HIGH' && (
                          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                            HIGH IMPACT
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-200 leading-snug">
                        {item.headline}
                        {item.isDeltaFeed && (
                          <>
                            {' · Tick '}
                            <LiveTickAge lastTickTimestamp={lastTickTimestamp} />
                          </>
                        )}
                      </p>
                    </button>

                    <div className="flex items-center gap-1 shrink-0 pt-0.5">
                      {isNewsOrSent ? (
                        <>
                          {item.newsLink && (
                            <a
                              href={item.newsLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 transition-colors"
                              title="Open source headline"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {onOpenNewsRadar && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenNewsRadar();
                                setIsAllDrawerOpen(false);
                              }}
                              className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-cyan-950/80 hover:bg-cyan-900/80 border border-cyan-700/60 text-[10px] text-cyan-300 cursor-pointer"
                              title="Open Sentiment Radar"
                            >
                              <BarChart3 className="w-2.5 h-2.5" />
                              <span>Radar</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleClickBulletin(item)}
                          className="inline-flex items-center gap-1 px-1.5 py-1 rounded bg-emerald-950/70 hover:bg-emerald-900/70 border border-emerald-700/60 text-[10px] text-emerald-300 cursor-pointer"
                          title="Cue Execution Pad"
                        >
                          <Target className="w-2.5 h-2.5" />
                          <span>Cue</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
);
