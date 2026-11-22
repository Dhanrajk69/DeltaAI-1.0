import React, { useState } from 'react';
import { Search, ChevronDown, Plus, Radio, Zap, Bell, ShieldAlert } from 'lucide-react';
import { WsConnectionStatus } from '../hooks/useDeltaWebSocket';

interface DashboardTopBarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  currency: 'USD' | 'INR';
  toggleCurrency: () => void;
  wsStatus: WsConnectionStatus;
  wsLatency: number;
  openWsModal: () => void;
  onQuickTrade: () => void;
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
  unreadNotifications: number;
  openNotifications: () => void;
}

export const DashboardTopBar: React.FC<DashboardTopBarProps> = ({
  currentTab,
  setCurrentTab,
  currency,
  toggleCurrency,
  wsStatus,
  wsLatency,
  openWsModal,
  onQuickTrade,
  selectedSymbol,
  setSelectedSymbol,
  unreadNotifications,
  openNotifications,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // Current formatted date
  const todayStr = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  const subNavTabs = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'markets', label: 'Markets' },
    { id: 'strategies', label: 'Sniper Scalp' },
    { id: 'ai-centre', label: 'AI Matrix' },
    { id: 'performance', label: 'Analytics' },
    { id: 'positions', label: 'Positions' },
  ];

  const searchableSymbols = [
    { symbol: 'BTCUSDT', name: 'Bitcoin Perpetual', quote: 'Delta India' },
    { symbol: 'ETHUSDT', name: 'Ethereum Perpetual', quote: 'Delta India' },
    { symbol: 'SOLUSDT', name: 'Solana Perpetual', quote: 'Delta India' },
    { symbol: 'XRPUSDT', name: 'XRP Perpetual', quote: 'Delta India' },
  ];

  const filteredSymbols = searchableSymbols.filter(
    (s) =>
      s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-4 py-2">
      {/* Left: Date Selector + Title matching Screenshot 1 */}
      <div>
        <div className="flex items-center gap-3 text-xs text-slate-400 mb-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#12162a]/90 border border-slate-800 text-slate-300 font-mono text-[11px]">
            <span className="text-cyan-400">▾</span>
            <span>Today, {todayStr}</span>
          </div>

          {/* Quick Sub-navigation tabs matching Screenshot 1 */}
          <nav className="hidden lg:flex items-center gap-4 text-xs font-medium">
            {subNavTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id)}
                className={`transition-colors cursor-pointer ${
                  currentTab === tab.id
                    ? 'text-cyan-400 font-bold border-b-2 border-cyan-400 pb-0.5'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-baseline gap-3">
          <h1 className="text-xl lg:text-2xl font-black text-white tracking-tight">
            Dashboard
          </h1>
          <span className="text-xs text-slate-400 font-medium hidden sm:inline">
            Welcome back to DeltaAI Terminal!
          </span>
        </div>
      </div>

      {/* Right Controls: Quick Trade, Search Bar, Currency Switch, WS latency, Notifications */}
      <div className="flex items-center gap-3 flex-wrap w-full md:w-auto justify-between md:justify-end">
        {/* Quick Trade / Bidding Action Button matching Screenshot 1 */}
        <button
          onClick={onQuickTrade}
          className="min-h-[38px] px-4 py-2 text-xs font-bold tracking-wider text-white whitespace-nowrap rounded-xl bg-gradient-to-r from-cyan-500/25 via-blue-600/30 to-cyan-400/20 backdrop-blur-md border border-cyan-400/50 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)] hover:bg-cyan-500/40 hover:border-cyan-300 hover:shadow-[0_0_16px_rgba(34,211,238,0.5)] active:scale-[0.98] transition-all cursor-pointer flex items-center gap-1.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] shrink-0"
        >
          <Plus className="w-4 h-4 text-cyan-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
          <span className="text-white font-bold tracking-wider drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">+ Quick Trade</span>
        </button>

        {/* Search Bar matching Screenshot 1 */}
        <div className="relative">
          <div className="flex items-center gap-2 bg-[#101426]/90 border border-slate-800/90 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus-within:border-cyan-500/60 focus-within:ring-1 focus-within:ring-cyan-500/30 transition shadow-inner">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search symbol, contract..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchDropdown(true);
              }}
              onFocus={() => setShowSearchDropdown(true)}
              className="bg-transparent border-none outline-none text-white text-xs w-28 sm:w-40 placeholder:text-slate-500"
            />
          </div>

          {/* Search Dropdown */}
          {showSearchDropdown && searchQuery.trim().length > 0 && (
            <div className="absolute right-0 mt-2 w-64 bg-[#0d1226] border border-slate-800 rounded-xl shadow-2xl p-2 z-50">
              <div className="text-[10px] text-slate-400 uppercase font-bold px-2 py-1">
                Markets (Delta Exchange India)
              </div>
              {filteredSymbols.map((item) => (
                <button
                  key={item.symbol}
                  onClick={() => {
                    setSelectedSymbol(item.symbol);
                    setSearchQuery('');
                    setShowSearchDropdown(false);
                    setCurrentTab('dashboard');
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-cyan-950/40 text-xs flex items-center justify-between transition cursor-pointer"
                >
                  <div>
                    <span className="font-bold text-white">{item.symbol}</span>
                    <span className="text-[10px] text-slate-400 block">{item.name}</span>
                  </div>
                  <span className="text-[9px] text-cyan-400 font-mono">{item.quote}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Currency Switcher (INR ₹ / USD $) */}
        <button
          onClick={toggleCurrency}
          title="Toggle INR ₹ / USD $ display"
          className="px-2.5 py-1.5 rounded-xl bg-[#101426]/90 border border-slate-800/90 hover:border-slate-700 text-xs font-bold font-mono text-cyan-300 hover:text-white transition cursor-pointer shadow-inner"
        >
          {currency === 'INR' ? '₹ INR' : '$ USD'}
        </button>

        {/* Delta India WebSocket Status Indicator */}
        <button
          onClick={openWsModal}
          title="Delta India WebSocket Latency & Connection Radar"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#101426]/90 border border-slate-800/90 hover:border-cyan-500/40 text-xs font-mono transition cursor-pointer"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              wsStatus === 'CONNECTED'
                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                : 'bg-amber-400 animate-pulse'
            }`}
          />
          <span className="text-[11px] font-bold text-slate-300">{wsLatency}ms</span>
        </button>

        {/* Notification Bell */}
        <button
          onClick={openNotifications}
          title="Alerts & Notifications"
          className="relative p-2 rounded-xl bg-[#101426]/90 border border-slate-800/90 hover:border-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
        >
          <Bell className="w-4 h-4" />
          {unreadNotifications > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 text-slate-950 font-bold text-[9px] flex items-center justify-center">
              {unreadNotifications}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};
