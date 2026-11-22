import React, { useState } from 'react';
import { MarketTicker } from '../types';
import { Search, Flame, ArrowUpRight, ArrowDownRight, BarChart3, Clock, ShieldAlert, Radio, Activity } from 'lucide-react';
import { TelemetryProcessorPanel } from './TelemetryProcessorPanel';
import { SentimentVolatilityGatePanel } from './SentimentVolatilityGatePanel';

interface MarketCentreProps {
  markets: Record<string, MarketTicker>;
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  currencyPrefix: string;
  exchangeRate: number;
  wsStatus?: string;
  wsLatency?: number;
  openWsModal?: () => void;
}

export const MarketCentre: React.FC<MarketCentreProps> = ({
  markets,
  selectedSymbol,
  onSelectSymbol,
  currencyPrefix,
  exchangeRate,
  wsStatus,
  wsLatency,
  openWsModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'HOT' | 'HIGH_OI' | 'FUNDING'>('ALL');
  const [activeSubView, setActiveSubView] = useState<'MARKETS' | 'TELEMETRY_PROCESSOR' | 'SENTIMENT_GATE'>('MARKETS');

  const marketList = Object.values(markets).filter((m) => {
    const matchesSearch = m.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;
    if (filterType === 'HOT') return Math.abs(m.change24h) >= 2.0;
    if (filterType === 'HIGH_OI') return m.openInterestUsd > 100000000;
    if (filterType === 'FUNDING') return m.fundingRate > 0.01;
    return true;
  });

  const totalMarketVolume = Object.values(markets).reduce((acc, m) => acc + m.volume24hUsd, 0);
  const totalOpenInterest = Object.values(markets).reduce((acc, m) => acc + m.openInterestUsd, 0);
  const totalLongLiq = Object.values(markets).reduce((acc, m) => acc + m.liquidationsLong24h, 0);
  const totalShortLiq = Object.values(markets).reduce((acc, m) => acc + m.liquidationsShort24h, 0);

  return (
    <div className="space-y-4">
      {/* Real-time WebSocket Live Feed Status Banner */}
      <div className="panel-delta px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono-numbers">
        <div className="flex items-center gap-2">
          <div className="badge-delta badge-delta-armed">
            <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span>DELTA WEBSOCKET LIVE</span>
          </div>
          <span className="text-slate-400 text-[11px]">
            Streaming live L2 orderbook & v2/ticker updates from Delta Exchange India
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg mr-2">
            <button
              type="button"
              onClick={() => setActiveSubView('MARKETS')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSubView === 'MARKETS' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Markets &amp; Tickers
            </button>
            <button
              type="button"
              onClick={() => setActiveSubView('TELEMETRY_PROCESSOR')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSubView === 'TELEMETRY_PROCESSOR' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              Telemetry Normalizer
            </button>
            <button
              type="button"
              onClick={() => setActiveSubView('SENTIMENT_GATE')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                activeSubView === 'SENTIMENT_GATE' ? 'bg-slate-800 text-emerald-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sentiment &amp; Alert Gate
            </button>
          </div>
          <span className="text-[11px] text-slate-500">RTT Latency:</span>
          <span className="text-emerald-400 font-bold text-[11px]">{wsLatency || 18}ms</span>
          {openWsModal && (
            <button
              type="button"
              onClick={openWsModal}
              className="btn-delta-sm btn-secondary"
            >
              Inspect Feed
            </button>
          )}
        </div>
      </div>

      {activeSubView === 'TELEMETRY_PROCESSOR' ? (
        <TelemetryProcessorPanel markets={markets} selectedSymbol={selectedSymbol} />
      ) : activeSubView === 'SENTIMENT_GATE' ? (
        <SentimentVolatilityGatePanel markets={markets} selectedSymbol={selectedSymbol} />
      ) : (
        <>
      {/* Market Macro Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="panel-delta p-3">
          <div className="text-[11px] text-slate-400 mb-0.5">Delta India 24h Volume</div>
          <div className="text-base lg:text-lg font-bold font-mono-numbers text-white">
            ${(totalMarketVolume / 1e6).toFixed(1)}M
          </div>
          <div className="text-[10px] text-emerald-400 mt-0.5">+14.2% vs previous session</div>
        </div>

        <div className="panel-delta p-3">
          <div className="text-[11px] text-slate-400 mb-0.5">Aggregate Open Interest</div>
          <div className="text-base lg:text-lg font-bold font-mono-numbers text-cyan-400">
            ${(totalOpenInterest / 1e6).toFixed(1)}M
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Institutional depth</div>
        </div>

        <div className="panel-delta p-3">
          <div className="text-[11px] text-slate-400 mb-0.5">24h Total Liquidations</div>
          <div className="text-base lg:text-lg font-bold font-mono-numbers text-rose-400">
            ${((totalLongLiq + totalShortLiq) / 1e6).toFixed(2)}M
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Longs: ${(totalLongLiq / 1e6).toFixed(1)}M · Shorts: ${(totalShortLiq / 1e6).toFixed(1)}M
          </div>
        </div>

        <div className="panel-delta p-3">
          <div className="text-[11px] text-slate-400 mb-0.5">Next Funding Settlement</div>
          <div className="text-base lg:text-lg font-bold font-mono-numbers text-amber-400 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-400" />
            <span>03h 42m 18s</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Delta Exchange 8-hour cycle</div>
        </div>
      </div>

      {/* Controls & Search Strip */}
      <div className="panel-delta p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search BTC, ETH, SOL or Altcoins..."
            className="w-full h-9 bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono-numbers"
          />
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterType('ALL')}
            className={`btn-delta-sm ${
              filterType === 'ALL' ? 'btn-toggle-active' : 'btn-secondary'
            }`}
          >
            All Markets
          </button>
          <button
            type="button"
            onClick={() => setFilterType('HOT')}
            className={`btn-delta-sm ${
              filterType === 'HOT' ? 'btn-toggle-active' : 'btn-secondary'
            }`}
          >
            High Volatility
          </button>
          <button
            type="button"
            onClick={() => setFilterType('HIGH_OI')}
            className={`btn-delta-sm ${
              filterType === 'HIGH_OI' ? 'btn-toggle-active' : 'btn-secondary'
            }`}
          >
            Highest Open Interest
          </button>
          <button
            type="button"
            onClick={() => setFilterType('FUNDING')}
            className={`btn-delta-sm ${
              filterType === 'FUNDING' ? 'btn-toggle-active' : 'btn-secondary'
            }`}
          >
            Elevated Funding
          </button>
        </div>
      </div>

      {/* Ticker Table */}
      <div className="panel-delta overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800/80">
              <tr>
                <th className="py-2.5 px-4 font-medium">Contract / Pair</th>
                <th className="py-2.5 px-4 font-medium text-right">Mark Price</th>
                <th className="py-2.5 px-4 font-medium text-right">Index Price</th>
                <th className="py-2.5 px-4 font-medium text-right">24h Change</th>
                <th className="py-2.5 px-4 font-medium text-right hidden sm:table-cell">24h High / Low</th>
                <th className="py-2.5 px-4 font-medium text-right">Funding Rate (8h)</th>
                <th className="py-2.5 px-4 font-medium text-right hidden md:table-cell">Open Interest</th>
                <th className="py-2.5 px-4 font-medium text-right hidden lg:table-cell">24h Liquidations</th>
                <th className="py-2.5 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono-numbers">
              {marketList.map((m) => {
                const isSelected = m.symbol === selectedSymbol;
                const isBull = m.change24h >= 0;
                return (
                  <tr
                    key={m.symbol}
                    className={`transition-colors hover:bg-slate-900/60 cursor-pointer ${
                      isSelected ? 'bg-emerald-950/20' : ''
                    }`}
                    onClick={() => onSelectSymbol(m.symbol)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white tracking-wide">{m.symbol}</span>
                        <span className="text-[10px] text-slate-500 hidden xl:inline">{m.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-white">
                      {currencyPrefix}{(m.markPrice * exchangeRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: m.markPrice > 10 ? 2 : 4 })}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400">
                      ${m.indexPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: m.markPrice > 10 ? 2 : 4 })}
                    </td>
                    <td className="py-3 px-4 text-right font-bold">
                      <span className={`inline-flex items-center gap-0.5 ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isBull ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {isBull ? '+' : ''}{m.change24h}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400 hidden sm:table-cell">
                      <span className="text-emerald-400">${m.high24h.toLocaleString()}</span>
                      <span className="text-slate-600 mx-1">/</span>
                      <span className="text-rose-400">${m.low24h.toLocaleString()}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={m.fundingRate > 0.015 ? 'text-amber-400 font-semibold' : 'text-emerald-400'}>
                        +{m.fundingRate}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right hidden md:table-cell text-slate-300">
                      <div>${(m.openInterestUsd / 1e6).toFixed(1)}M</div>
                      <div className="text-[10px] text-slate-500">{m.openInterestContracts.toLocaleString()} cont</div>
                    </td>
                    <td className="py-3 px-4 text-right hidden lg:table-cell text-slate-300">
                      <div className="text-rose-400">${((m.liquidationsLong24h + m.liquidationsShort24h) / 1e6).toFixed(2)}M</div>
                      <div className="text-[10px] text-slate-500">
                        L: ${(m.liquidationsLong24h / 1e6).toFixed(1)}M · S: ${(m.liquidationsShort24h / 1e6).toFixed(1)}M
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSymbol(m.symbol);
                        }}
                        className={`btn-delta-sm ${
                          isSelected ? 'btn-primary' : 'btn-secondary'
                        }`}
                      >
                        {isSelected ? 'Active' : 'Trade'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}
    </div>
  );
};
