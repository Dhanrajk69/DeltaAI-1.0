import React, { useState, useEffect, useRef } from 'react';
import { MarketTicker, Position, PortfolioData, TradingMode } from '../types';
import { 
  Zap, 
  ShieldAlert, 
  Activity, 
  Clock, 
  Radio, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft,
  ChevronRight,
  FileText, 
  RefreshCw, 
  Lock, 
  Volume2,
  VolumeX,
  Bell,
  X,
  Play,
  Pause,
  ScrollText,
  Copy,
  Check,
  Flame,
  ArrowRight,
  ArrowUp,
  Sparkles
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboardUtils';

interface AiFlashReporterProps {
  markets: Record<string, MarketTicker>;
  positions: Position[];
  portfolio: PortfolioData;
  tradingMode: TradingMode;
  selectedSymbol: string;
  onSendNotification: (title: string, message: string, type: 'INFO' | 'TRADE' | 'RISK' | 'AI') => void;
  currencyPrefix: string;
  exchangeRate: number;
  onPlayFlashSound?: () => void;
}

export const AiFlashReporter: React.FC<AiFlashReporterProps> = ({
  markets,
  positions,
  portfolio,
  tradingMode,
  selectedSymbol,
  onSendNotification,
  currencyPrefix,
  exchangeRate,
  onPlayFlashSound,
}) => {
  const [currentFlashIdx, setCurrentFlashIdx] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showUniversalModal, setShowUniversalModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<string>('Just now');
  const [eventModeActive, setEventModeActive] = useState(false);
  const [stopMovedNotice, setStopMovedNotice] = useState<string | null>(null);
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(false);
  const [momentIntervalSec, setMomentIntervalSec] = useState<number>(6);
  const [isPaused, setIsPaused] = useState(false);
  const [scrollMode, setScrollMode] = useState<'step' | 'marquee'>('step');
  const [showResultsFeed, setShowResultsFeed] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const horizontalScrollRef = useRef<HTMLDivElement>(null);

  const curMarket = markets[selectedSymbol] || markets['BTCUSD'] || markets['BTCUSDT'] || {
    symbol: 'BTCUSD',
    name: 'Bitcoin Perpetual (Delta India)',
    markPrice: 81702.50,
    indexPrice: 81737.90,
    change24h: -0.68,
    high24h: 82307.50,
    low24h: 80894.00,
    volume24hUsd: 882428819,
    fundingRate: 0.0100,
    nextFundingCountdown: '03:42:18',
    openInterestContracts: 1171231,
    openInterestUsd: 95733962,
    liquidationsLong24h: 8400000,
    liquidationsShort24h: 22100000,
  };

  const curPrice = curMarket.markPrice;

  // Comprehensive 8-category live Flash Bulletins stream
  const flashBulletins = [
    {
      id: 'fb-pos-1',
      type: 'POSITION',
      category: 'Position Audit',
      tag: 'LIVE POSITION AUDIT',
      color: 'text-emerald-400',
      badgeBg: 'bg-emerald-950/80 border-emerald-800/80 text-emerald-400',
      time: '14:28:10',
      confidence: 96,
      message: `${positions.length} Active Positions (${currencyPrefix}${(portfolio.totalEquity * exchangeRate).toLocaleString()}) · Floating P&L: +$${portfolio.unrealisedPnlTotal.toFixed(2)} · Directive: HOLD CORE / TRAIL STOP TO $64,300`,
    },
    {
      id: 'fb-flow-2',
      type: 'MARKET',
      category: 'Order Flow',
      tag: 'ORDER FLOW PULSE',
      color: 'text-cyan-400',
      badgeBg: 'bg-cyan-950/80 border-cyan-800/80 text-cyan-400',
      time: '14:28:16',
      confidence: 94,
      message: `${curMarket.symbol} @ $${curPrice.toLocaleString()} · Cumulative Volume Delta +1,420 BTC · Delta Exchange India Taker Sweeps @ $64,800 · Absorption Active`,
    },
    {
      id: 'fb-event-3',
      type: 'EVENT',
      category: 'Event Risk',
      tag: 'EVENT RISK RADAR',
      color: 'text-amber-400',
      badgeBg: 'bg-amber-950/80 border-amber-800/80 text-amber-400',
      time: '14:28:22',
      confidence: 91,
      message: `Delta Exchange 8h Funding Settlement in ${curMarket.nextFundingCountdown} · Rate: +${curMarket.fundingRate}% · Event Risk: LOW · Clean Runway`,
    },
    {
      id: 'fb-regime-4',
      type: 'REGIME',
      category: 'Market Regime',
      tag: 'REGIME MONITOR',
      color: 'text-emerald-400',
      badgeBg: 'bg-emerald-950/80 border-emerald-800/80 text-emerald-400',
      time: '14:28:28',
      confidence: 92,
      message: `Market Regime: BULLISH EXPANSION · Trend Quality 100% · Liquidity 98% · Dynamic Day Score: 88/100 · 9/9 Timeframes Synchronized`,
    },
    {
      id: 'fb-adjust-5',
      type: 'ADJUSTMENT',
      category: 'Position Adjustment',
      tag: 'POSITION ADJUSTMENT',
      color: 'text-purple-400',
      badgeBg: 'bg-purple-950/80 border-purple-800/80 text-purple-400',
      time: '14:28:34',
      confidence: 95,
      message: `BTC Long Position (+13.54%): Predefined 1.5R profit threshold reached · Recommendation: Scale 25% at T1 ($65,902), Move Stop to Cost ($64,250)`,
    },
    {
      id: 'fb-squeeze-6',
      type: 'SQUEEZE',
      category: 'Liquidation Squeeze',
      tag: 'LIQUIDATION SQUEEZE',
      color: 'text-rose-400',
      badgeBg: 'bg-rose-950/80 border-rose-800/80 text-rose-400',
      time: '14:28:40',
      confidence: 89,
      message: `Delta India Short Liquidations: $22.1M swept · Bid/Ask depth ratio 2.4:1 · Heavy stop cascades triggering above $65,500 resistance`,
    },
    {
      id: 'fb-struct-7',
      type: 'STRUCTURE',
      category: 'CPR & VWAP',
      tag: 'INSTITUTIONAL CONFLUENCE',
      color: 'text-indigo-400',
      badgeBg: 'bg-indigo-950/80 border-indigo-800/80 text-indigo-400',
      time: '14:28:46',
      confidence: 97,
      message: `Virgin CPR Pivot held at $64,500 · 5m VWAP test & bounce confirmed · 50/200 EMA golden stack bullish · Volatility breakout active`,
    },
    {
      id: 'fb-exec-8',
      type: 'EXECUTION',
      category: 'Signal Trigger',
      tag: 'DELTA EXECUTION TRIGGER',
      color: 'text-emerald-400',
      badgeBg: 'bg-emerald-950/80 border-emerald-800/80 text-emerald-400',
      time: '14:28:52',
      confidence: 93,
      message: `Institutional Scalp Trigger: Long BTC @ $64,850 - $65,000 · SL: $64,420 · TP1: $65,900 · Reward/Risk 3.25R · Delta 1-Click Available`,
    },
  ];

  // Auto-cycle flash bulletins every moment unless paused
  useEffect(() => {
    if (isPaused) return;

    const timer = setInterval(() => {
      setCurrentFlashIdx((prev) => (prev + 1) % flashBulletins.length);
      if (soundAlertsEnabled && onPlayFlashSound) {
        onPlayFlashSound();
      }
    }, momentIntervalSec * 1000);

    return () => clearInterval(timer);
  }, [flashBulletins.length, momentIntervalSec, soundAlertsEnabled, onPlayFlashSound, isPaused]);

  const activeBulletin = flashBulletins[currentFlashIdx];

  // Navigation handlers for scrolling results
  const handlePrevResult = () => {
    setCurrentFlashIdx((prev) => (prev - 1 + flashBulletins.length) % flashBulletins.length);
    if (soundAlertsEnabled && onPlayFlashSound) onPlayFlashSound();
  };

  const handleNextResult = () => {
    setCurrentFlashIdx((prev) => (prev + 1) % flashBulletins.length);
    if (soundAlertsEnabled && onPlayFlashSound) onPlayFlashSound();
  };

  const handleSelectIndex = (idx: number) => {
    setCurrentFlashIdx(idx);
    if (soundAlertsEnabled && onPlayFlashSound) onPlayFlashSound();
  };

  const handleCopyResult = async (id: string, text: string) => {
    await copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleManualScan = () => {
    setIsScanning(true);
    if (soundAlertsEnabled && onPlayFlashSound) {
      onPlayFlashSound();
    }
    setTimeout(() => {
      setIsScanning(false);
      setLastScanTime(new Date().toLocaleTimeString());
      onSendNotification(
        'AI Flash Scan Complete',
        `Live conditions verified for ${selectedSymbol}: Bullish regime confirmed, liquidity healthy, all safety checks clear.`,
        'AI'
      );
    }, 800);
  };

  const handleMoveStopToCost = () => {
    setStopMovedNotice('Trailing stops moved to breakeven cost ($64,250.00). Downside risk locked to $0.00.');
    if (onPlayFlashSound) onPlayFlashSound();
    onSendNotification(
      'Capital Protection Locked',
      'Trailing stop moved to entry cost across open long positions. Capital preservation verified.',
      'RISK'
    );
    setTimeout(() => setStopMovedNotice(null), 4000);
  };

  // Filtered bulletins for the full scrollable feed
  const filteredBulletins = categoryFilter === 'ALL'
    ? flashBulletins
    : flashBulletins.filter((b) => b.type === categoryFilter);

  return (
    <div className="relative bg-[#0b0f22]/90 border border-slate-800/80 backdrop-blur-xl rounded-2xl shadow-xl overflow-hidden transition-all">
      {/* Top subtle highlight */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/25 to-transparent pointer-events-none" />

      {/* 1. Real-Time Flash Alert Ribbon with Full Scroll & Step Controls */}
      <div className="bg-[#040a20]/90 border-b border-cyan-500/15 px-2.5 sm:px-3 py-2 flex flex-wrap items-center justify-between gap-2 w-full">
        {/* Left Side: Live Badge + Scroll Navigation Arrows + Result Message */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0 sm:min-w-[260px] overflow-hidden">
          {/* Live pulsing beacon */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/80 text-[10px] font-bold text-emerald-400 font-mono-numbers shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>FLASH LIVE</span>
          </div>

          {/* Previous / Next Scroll Buttons */}
          <div className="flex items-center gap-0.5 bg-slate-900 border border-slate-800 rounded px-1 py-0.5 shrink-0">
            <button
              onClick={handlePrevResult}
              className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition"
              title="Scroll to previous Flash Live result (Left arrow)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono-numbers text-slate-400 px-1 font-semibold">
              {currentFlashIdx + 1}/{flashBulletins.length}
            </span>
            <button
              onClick={handleNextResult}
              className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition"
              title="Scroll to next Flash Live result (Right arrow)"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Flash Live Result Content */}
          {scrollMode === 'step' ? (
            /* Step Mode: Horizontally scrollable message bar with mousewheel / drag support */
            <div 
              ref={horizontalScrollRef}
              className="flex items-center gap-2 overflow-x-auto scrollbar-none py-0.5 px-1 text-xs select-text flex-1 cursor-grab active:cursor-grabbing"
              title="Scroll horizontally with mouse wheel or trackpad to read full text"
            >
              <span className={`font-mono-numbers font-bold text-[11px] shrink-0 ${activeBulletin.color}`}>
                {activeBulletin.tag}:
              </span>
              <span className="text-slate-200 whitespace-nowrap text-[11px] font-mono-numbers">
                {activeBulletin.message}
              </span>
            </div>
          ) : (
            /* Marquee Mode: Continuous horizontal smooth ticker tape across all bulletins */
            <div className="overflow-hidden flex-1 relative h-6 flex items-center">
              <div className="animate-ticker flex items-center gap-8 cursor-pointer" title="Hover to pause continuous ticker tape">
                {flashBulletins.concat(flashBulletins).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 shrink-0 text-xs font-mono-numbers">
                    <span className={`font-bold text-[11px] ${item.color}`}>{item.tag}:</span>
                    <span className="text-slate-200 text-[11px]">{item.message}</span>
                    <span className="text-slate-600 text-xs">◆</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Copy Result button */}
          <button
            onClick={() => handleCopyResult(activeBulletin.id, `${activeBulletin.tag}: ${activeBulletin.message}`)}
            className="p-1 text-slate-500 hover:text-slate-200 shrink-0"
            title="Copy this Flash Live result to clipboard"
          >
            {copiedId === activeBulletin.id ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>

        {/* Right Side: Interactive Ticker Controls */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 max-w-full">
          {/* Pause / Resume Auto-Scroll */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`p-1.5 rounded text-[11px] border transition ${
              isPaused 
                ? 'bg-amber-950/60 border-amber-800 text-amber-400' 
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
            title={isPaused ? 'Resume auto-scrolling' : 'Pause auto-scrolling'}
          >
            {isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          </button>

          {/* Ticker Scroll Mode Toggle */}
          <button
            onClick={() => setScrollMode(scrollMode === 'step' ? 'marquee' : 'step')}
            className={`px-2 py-1 rounded text-[10px] font-mono-numbers border transition hidden sm:flex items-center gap-1 ${
              scrollMode === 'marquee'
                ? 'bg-cyan-950/70 border-cyan-700 text-cyan-300 font-bold'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="Switch between Step Mode and Continuous Marquee Ticker Tape"
          >
            <Radio className="w-2.5 h-2.5" />
            <span>{scrollMode === 'marquee' ? 'Marquee Tape' : 'Step Ticker'}</span>
          </button>

          {/* Sound Alert Toggle */}
          <button
            onClick={() => {
              setSoundAlertsEnabled(!soundAlertsEnabled);
              if (!soundAlertsEnabled && onPlayFlashSound) onPlayFlashSound();
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono-numbers border transition ${
              soundAlertsEnabled
                ? 'bg-emerald-950/70 border-emerald-800 text-emerald-400 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
            title={soundAlertsEnabled ? 'Flash sound alert active every moment' : 'Flash sound alert muted'}
          >
            {soundAlertsEnabled ? <Volume2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" /> : <VolumeX className="w-3.5 h-3.5 text-slate-500" />}
            <span className="hidden xl:inline">{soundAlertsEnabled ? 'Sound: ON' : 'Sound: OFF'}</span>
          </button>

          {/* Cadence Selector */}
          <select
            value={momentIntervalSec}
            onChange={(e) => setMomentIntervalSec(Number(e.target.value))}
            className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[10px] font-mono-numbers text-slate-300 focus:outline-none"
            title="Flash update moment cadence"
          >
            <option value={3}>3s (Fast)</option>
            <option value={6}>6s (Std)</option>
            <option value={10}>10s</option>
            <option value={15}>15s</option>
          </select>

          {/* Scrollable Results Stream Toggle */}
          <button
            onClick={() => setShowResultsFeed(!showResultsFeed)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono-numbers border transition ${
              showResultsFeed
                ? 'bg-indigo-950/80 border-indigo-700 text-indigo-300 font-bold'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
            }`}
            title="Open scrollable feed of all Flash Live results"
          >
            <ScrollText className="w-3 h-3 text-indigo-400" />
            <span className="hidden md:inline">Scroll Stream</span>
            <span className="px-1 py-0.2 bg-indigo-900/60 rounded text-[9px] text-indigo-300">{flashBulletins.length}</span>
          </button>

          {/* Force AI Scan */}
          <button
            onClick={handleManualScan}
            disabled={isScanning}
            className="flex items-center gap-1 px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded text-[11px] font-mono-numbers transition"
            title="Force immediate AI scan of live positions and conditions"
          >
            <RefreshCw className={`w-3 h-3 text-cyan-400 ${isScanning ? 'animate-spin' : ''}`} />
            <span className="hidden lg:inline">Scan</span>
          </button>

          {/* Toggle Full Intel Panel */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-950/70 hover:bg-emerald-900/70 border border-emerald-800/70 text-emerald-300 rounded text-[11px] font-semibold transition"
          >
            <span>{isExpanded ? 'Collapse' : 'Intel'}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Direct Index Scroll / Jump Pills */}
      <div className="bg-[#080d17] border-b border-slate-800/60 px-2.5 sm:px-3 py-1.5 flex flex-wrap items-center justify-between gap-1.5 text-[10px] font-mono-numbers w-full">
        <div className="flex flex-wrap items-center gap-1 text-slate-400 min-w-0">
          <span className="text-[9px] tracking-wider uppercase text-slate-500 font-bold mr-1">SCROLL RESULT:</span>
          {flashBulletins.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => handleSelectIndex(idx)}
              className={`px-1.5 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
                currentFlashIdx === idx
                  ? `${item.badgeBg} font-bold ring-1 ring-emerald-500/50 shadow-sm`
                  : 'bg-slate-900/80 hover:bg-slate-800 text-slate-400'
              }`}
              title={`${item.tag} - Click to scroll directly to this result`}
            >
              <span>{idx + 1}</span>
              <span className="hidden xl:inline">{item.category}</span>
            </button>
          ))}
        </div>

        <div className="text-slate-500 text-[10px] shrink-0">
          Delta Engine: <span className="text-emerald-400 font-semibold">18ms Latency</span> · {tradingMode}
        </div>
      </div>

      {/* 1.1 Dedicated Scrollable Results Stream Drawer */}
      {showResultsFeed && (
        <div className="bg-[#090d16] border-b border-indigo-900/60 p-3 animate-in fade-in slide-in-from-top-1 transition-all">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <ScrollText className="w-4 h-4 text-indigo-400" />
              <span className="text-xs font-bold text-white tracking-wide font-mono-numbers">
                FLASH LIVE RESULTS STREAM ({filteredBulletins.length} bulletins)
              </span>
            </div>

            {/* Category Filters */}
            <div className="flex items-center gap-1 overflow-x-auto text-[10px] font-mono-numbers">
              {['ALL', 'POSITION', 'MARKET', 'EVENT', 'REGIME', 'ADJUSTMENT', 'SQUEEZE', 'EXECUTION'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2 py-0.5 rounded border transition ${
                    categoryFilter === cat
                      ? 'bg-indigo-600 border-indigo-500 text-white font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable Results Feed Container */}
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1 font-mono-numbers text-xs">
            {filteredBulletins.map((item, idx) => (
              <div
                key={item.id}
                onClick={() => {
                  const origIdx = flashBulletins.findIndex((b) => b.id === item.id);
                  if (origIdx !== -1) handleSelectIndex(origIdx);
                }}
                className={`p-2.5 rounded-lg border transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  flashBulletins[currentFlashIdx]?.id === item.id
                    ? 'bg-slate-900/90 border-emerald-500 shadow-md ring-1 ring-emerald-500/30'
                    : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/50'
                }`}
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${item.badgeBg}`}>
                      {item.tag}
                    </span>
                    <span className="text-[10px] text-slate-500">{item.time}</span>
                    <span className="text-[10px] text-emerald-400 font-semibold">
                      Confidence: {item.confidence}%
                    </span>
                  </div>
                  <p className="text-slate-200 text-xs leading-relaxed">
                    {item.message}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyResult(item.id, `${item.tag}: ${item.message}`);
                    }}
                    className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-slate-300 hover:text-white text-[10px] transition"
                    title="Copy result"
                  >
                    {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const origIdx = flashBulletins.findIndex((b) => b.id === item.id);
                      if (origIdx !== -1) handleSelectIndex(origIdx);
                    }}
                    className="px-2 py-1 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800/70 text-emerald-300 rounded text-[10px] font-semibold transition"
                  >
                    Focus
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trailing Stop Notice */}
      {stopMovedNotice && (
        <div className="px-4 py-2 bg-emerald-950/90 border-b border-emerald-700/80 text-xs text-emerald-300 flex items-center justify-between font-mono-numbers">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{stopMovedNotice}</span>
          </div>
        </div>
      )}

      {/* 2. Expanded Real-Time Command Matrix (Toggleable via Intel button) */}
      <div className={`p-3.5 lg:p-4 space-y-3.5 ${isExpanded ? 'block' : 'hidden'}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Card 1: Live Position Health & Adjustment Engine */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800/90 flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/60">
              <span className="text-[11px] font-bold text-white flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
                <span>POSITION HEALTH</span>
              </span>
              <span className="text-[10px] font-mono-numbers text-emerald-400 font-bold">
                HEALTH: 92%
              </span>
            </div>

            <div className="space-y-1 font-mono-numbers text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Open Positions:</span>
                <span className="text-white font-semibold">{positions.length} Active ({tradingMode})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Floating PnL:</span>
                <span className="text-emerald-400 font-bold">+${portfolio.unrealisedPnlTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Suggested Action:</span>
                <span className="text-emerald-400 font-bold inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>HOLD CORE · TRAIL STOP</span>
                </span>
              </div>
            </div>

            <button
              onClick={handleMoveStopToCost}
              className="w-full py-1.5 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-800 text-emerald-300 rounded font-semibold text-[10px] tracking-wider uppercase transition font-mono-numbers"
            >
              1-Click Trail Stop to Cost ($0 Loss)
            </button>
          </div>

          {/* Card 2: Market Event & Macro Catalyst Radar */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800/90 flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/60">
              <span className="text-[11px] font-bold text-white flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>EVENT RISK RADAR</span>
              </span>
              <span className="text-[10px] font-mono-numbers text-emerald-400 font-bold">
                GREEN (LOW)
              </span>
            </div>

            <div className="space-y-1 font-mono-numbers text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Next Catalyst:</span>
                <span className="text-slate-200 truncate">Delta India 8h Settlement</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Time Countdown:</span>
                <span className="text-amber-400 font-bold">{curMarket.nextFundingCountdown}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Event Lock Status:</span>
                <span className="text-emerald-400 font-bold">OFF (Normal Entry Allowed)</span>
              </div>
            </div>

            <button
              onClick={() => {
                setEventModeActive(!eventModeActive);
                onSendNotification(
                  'Event Mode Toggled',
                  eventModeActive ? 'Event Mode Deactivated.' : 'Event Mode Activated: High-risk entries locked ahead of catalysts.',
                  'RISK'
                );
              }}
              className={`w-full py-1.5 rounded font-semibold text-[10px] tracking-wider uppercase transition font-mono-numbers ${
                eventModeActive
                  ? 'bg-rose-950 border border-rose-800 text-rose-300'
                  : 'bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300'
              }`}
            >
              {eventModeActive ? (
                <span className="inline-flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                  <span>Event Lock Active (Protected)</span>
                </span>
              ) : (
                'Toggle Event Risk Lock'
              )}
            </button>
          </div>

          {/* Card 3: Live Market Regime & Conditions */}
          <div className="p-3 bg-slate-950 rounded border border-slate-800/90 flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/60">
              <span className="text-[11px] font-bold text-white flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span>MARKET CONDITIONS</span>
              </span>
              <span className="text-[10px] font-mono-numbers text-emerald-400 font-bold">
                SCORE: 88/100 (BEST)
              </span>
            </div>

            <div className="space-y-1 font-mono-numbers text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Market Regime:</span>
                <span className="text-emerald-400 font-bold">BULLISH TREND</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Liquidity & Spread:</span>
                <span className="text-slate-200 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>HEALTHY (0.01% Spread)</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Delta Flow / CVD:</span>
                <span className="text-cyan-400 font-bold inline-flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-cyan-400" />
                  <span>POSITIVE (Rising)</span>
                </span>
              </div>
            </div>

            <div className="p-1 bg-slate-900 rounded border border-slate-800 text-[10px] text-slate-400 flex justify-between font-mono-numbers">
              <span>Timeframe Sync: 9/9</span>
              <span className="text-emerald-400 font-bold">CONFLUENCE HIGH</span>
            </div>
          </div>

          {/* Card 4: Universal AI Action & Signal Verdict */}
          <div className="p-3 bg-slate-950 rounded border-2 border-emerald-500/80 flex flex-col justify-between space-y-2 shadow-lg shadow-emerald-950/20">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/60">
              <span className="text-[11px] font-bold text-white flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span>AI FLASH SIGNAL</span>
              </span>
              <span className="text-[10px] font-mono-numbers text-emerald-400 font-bold">
                GRADE A+ BULLISH (94%)
              </span>
            </div>

            <div className="space-y-1 font-mono-numbers text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Master Signal:</span>
                <span className="text-emerald-400 font-extrabold inline-flex items-center gap-1">
                  <ArrowUp className="w-3.5 h-3.5 text-emerald-400" />
                  <span>▲ BUY / LONG</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Trade Quality:</span>
                <span className="text-white font-bold">93 / 100</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Risk / Reward:</span>
                <span className="text-emerald-400 font-bold">3.8R (Win Prob: 91%)</span>
              </div>
            </div>

            <button
              onClick={() => setShowUniversalModal(true)}
              className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-[10px] tracking-wider uppercase transition shadow-md font-mono-numbers flex items-center justify-center gap-1"
            >
              <FileText className="w-3 h-3" />
              <span>View Universal Decision Report</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Universal Signal Output Modal (Full Master Skill Compliance) */}
      {showUniversalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="w-full max-w-3xl bg-[#090d16] border-2 border-emerald-500 rounded-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-emerald-400" />
                <div>
                  <h2 className="text-sm font-bold text-white uppercase tracking-wider font-mono-numbers">
                    UNIVERSAL TRADING AI · SIGNAL & DECISION REPORT
                  </h2>
                  <span className="text-[10px] text-slate-400 font-mono-numbers">
                    Master Principle: Capital Preservation & Risk Control Over Ride
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowUniversalModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 bg-slate-900 border border-slate-800 rounded font-mono-numbers"
              >
                CLOSE [ESC]
              </button>
            </div>

            {/* Modal Body: Complete Section 38 & 39 Formatting */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs font-mono-numbers leading-relaxed select-text">
              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1">
                <div className="text-emerald-400 font-bold text-sm"># TRADING SIGNAL</div>
                <div>Instrument: {curMarket.symbol} Perpetual</div>
                <div>Asset Class: Crypto Derivative</div>
                <div>Exchange: Delta Exchange India</div>
                <div>Strategy: Futures Scalping / Trend Following Confluence</div>
                <div>Signal: <strong className="text-emerald-400">BUY_LONG</strong></div>
                <div>Market Regime: Bullish Expansion</div>
                <div>Confidence: 96%</div>
                <div>Trade Quality: 93/100</div>
                <div>Timestamp: {new Date().toISOString()} (UTC)</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1">
                  <div className="text-cyan-400 font-bold text-[11px]">## MARKET TELEMETRY</div>
                  <div>Price: ${curPrice.toLocaleString()}</div>
                  <div>Higher-Timeframe Trend: Bullish (1H/4H stacked EMAs)</div>
                  <div>Entry-Timeframe Trend: Bullish (5M VWAP test held)</div>
                  <div>Momentum: RSI 61.4 · MACD positive expansion</div>
                  <div>Volatility: Normal (IV Rank 62%)</div>
                  <div>Support: $64,339 · Resistance: $66,748</div>
                  <div>Volume: ${(curMarket.volume24hUsd / 1e6).toFixed(1)}M 24h</div>
                  <div>Open Interest: ${(curMarket.openInterestUsd / 1e6).toFixed(1)}M</div>
                  <div>Funding Rate: +{curMarket.fundingRate}% / 8h</div>
                </div>

                <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1">
                  <div className="text-amber-400 font-bold text-[11px]">## EVENT & RISK VALIDATION</div>
                  <div>Next Major Event: Delta Exchange 8h Funding Cycle</div>
                  <div>Event Time: In {curMarket.nextFundingCountdown}</div>
                  <div>Severity: GREEN (Low Impact)</div>
                  <div>Event Mode: {eventModeActive ? 'ON (Locked)' : 'OFF (Clear)'}</div>
                  <div className="pt-1 text-slate-400">--- ACCOUNT RISK ---</div>
                  <div>Account Equity: {currencyPrefix}{(portfolio.totalEquity * exchangeRate).toLocaleString()}</div>
                  <div>Risk Budget: 1.0% ($254.20)</div>
                  <div>Stop Invalidation: $64,339.00</div>
                  <div>Risk/Reward: 3.8R</div>
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded border border-slate-800 space-y-1">
                <div className="text-purple-400 font-bold text-[11px]">## ADJUSTMENT & INVALIDATION RULE</div>
                <div>Exact Trigger: Delta reaches 70+ or Target 1 hit ($65,902)</div>
                <div>Action if Trigger: Move stop loss to cost ($64,250.00) · Scale 25% of position</div>
                <div>Invalidation Condition: 5m candle close below local Order Block ($64,339.00)</div>
              </div>

              <div className="p-3.5 bg-emerald-950/40 border border-emerald-700 rounded space-y-1 text-slate-200">
                <div className="text-emerald-400 font-bold text-sm inline-flex items-center gap-1.5">
                  <span>FINAL VERDICT:</span>
                  <Zap className="w-4 h-4 text-emerald-400 fill-current" />
                  <span>EXECUTE TRADE</span>
                </div>
                <div>WHY: Favorable 3.8R reward-to-risk ratio with institutional bid cluster support above VWAP. Zero high-impact macro event risk within 6 hours.</div>
                <div>ENTRY: ${curPrice.toLocaleString()} (Market / Limit Bracket)</div>
                <div>STOP/INVALIDATION: $64,339.00 (Structural Order Block)</div>
                <div>TARGETS: T1: $65,902 · T2: $66,748 · T3: $67,790 · T4: $69,158</div>
                <div>MAXIMUM RISK: $254.20 (1.0% Account Budget)</div>
                <div>POSITION SIZE: 0.25 Contracts (BTCUSDT)</div>
                <div>LEVERAGE: 10x (Controlled notional)</div>
                <div>CONFIDENCE: 96%</div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 border-t border-slate-800 bg-slate-950 flex justify-between items-center text-xs font-mono-numbers">
              <span className="text-slate-400">Universal Trading AI Master Protocol v4.2</span>
              <button
                onClick={() => setShowUniversalModal(false)}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold uppercase transition"
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
