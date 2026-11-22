import React from 'react';
import {
  TrendingUp,
  Activity,
  Layers,
  Cpu,
  BarChart3,
  ShieldAlert,
  History,
  Settings,
  Volume2,
  VolumeX,
  Flame,
  Zap,
} from 'lucide-react';
import { TradingMode } from '../types';

interface LeftNavRailProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  openSettings: () => void;
  openKillSwitchModal: () => void;
  soundMuted: boolean;
  toggleSound: () => void;
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
  unreadNotifications: number;
  openNotifications: () => void;
}

export const LeftNavRail: React.FC<LeftNavRailProps> = ({
  currentTab,
  setCurrentTab,
  openSettings,
  openKillSwitchModal,
  soundMuted,
  toggleSound,
  tradingMode,
  setTradingMode,
  unreadNotifications,
  openNotifications,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
    { id: 'markets', label: 'Markets', icon: Activity },
    { id: 'strategies', label: 'Sniper Engine', icon: Layers },
    { id: 'ai-centre', label: 'AI Command', icon: Cpu },
    { id: 'performance', label: 'Analytics', icon: BarChart3 },
    { id: 'positions', label: 'Positions', icon: History },
    { id: 'risk', label: 'Risk Controls', icon: ShieldAlert },
  ];

  return (
    <aside className="w-18 lg:w-20 bg-[#0a0e1e]/90 border border-slate-800/80 rounded-3xl p-3.5 flex flex-col items-center justify-between gap-6 shadow-2xl backdrop-blur-xl shrink-0 my-auto">
      {/* Top 3D-styled Geometric Cube Logo matching Screenshot 1 */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={() => setCurrentTab('dashboard')}
          title="DeltaAI Dashboard"
          className="relative group cursor-pointer focus:outline-none"
        >
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-700 p-0.5 shadow-[0_0_20px_rgba(6,182,212,0.4)] group-hover:shadow-[0_0_28px_rgba(6,182,212,0.65)] transition-all">
            <div className="w-full h-full bg-[#0c1126] rounded-[14px] flex items-center justify-center">
              {/* Isometric Cube SVG matching the reference screenshot logo */}
              <svg className="w-6 h-6 transform group-hover:scale-105 transition-transform" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L3 7L12 12L21 7L12 2Z"
                  fill="#38bdf8"
                  fillOpacity="0.9"
                  stroke="#38bdf8"
                  strokeWidth="1.2"
                />
                <path
                  d="M3 7V17L12 22V12L3 7Z"
                  fill="#0284c7"
                  fillOpacity="0.85"
                  stroke="#0284c7"
                  strokeWidth="1.2"
                />
                <path
                  d="M21 7V17L12 22V12L21 7Z"
                  fill="#2563eb"
                  fillOpacity="0.95"
                  stroke="#2563eb"
                  strokeWidth="1.2"
                />
              </svg>
            </div>
          </div>
        </button>
      </div>

      {/* Main Navigation Stack */}
      <nav className="flex flex-col items-center gap-3 w-full">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id)}
              title={item.label}
              className={`relative flex items-center justify-center rounded-2xl transition-all duration-200 cursor-pointer group ${
                isActive
                  ? 'w-12 h-12 bg-gradient-to-r from-blue-600/40 to-cyan-500/30 border border-cyan-400/50 text-cyan-300 shadow-[0_0_16px_rgba(6,182,212,0.35)]'
                  : 'w-11 h-11 text-slate-400 hover:text-white hover:bg-slate-800/60 border border-transparent'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-cyan-300' : 'group-hover:text-cyan-200'}`} />

              {/* Tooltip for desktop hover */}
              <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 border border-slate-700/80 rounded-lg text-xs font-semibold text-white whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-xl">
                {item.label}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Bottom Controls (Mode Toggle, Sound, Settings, Kill Switch) */}
      <div className="flex flex-col items-center gap-3 w-full pt-3 border-t border-slate-800/80">
        {/* Mode Toggle Button */}
        <button
          onClick={() => setTradingMode(tradingMode === 'PAPER' ? 'LIVE' : 'PAPER')}
          title={`Switch to ${tradingMode === 'PAPER' ? 'LIVE' : 'PAPER'} Mode`}
          className={`w-9 h-9 rounded-xl flex items-center justify-center text-[10px] font-extrabold font-mono transition cursor-pointer border ${
            tradingMode === 'LIVE'
              ? 'bg-rose-950/80 border-rose-500/60 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
              : 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
          }`}
        >
          {tradingMode === 'LIVE' ? 'LIVE' : 'DEMO'}
        </button>

        {/* Sound Toggle */}
        <button
          onClick={toggleSound}
          title={soundMuted ? 'Unmute Sound FX' : 'Mute Sound FX'}
          className="w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 flex items-center justify-center transition cursor-pointer"
        >
          {soundMuted ? <VolumeX className="w-4 h-4 text-slate-500" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
        </button>

        {/* Settings */}
        <button
          onClick={openSettings}
          title="Terminal Settings & API Keys"
          className="w-9 h-9 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-cyan-300 border border-slate-800 flex items-center justify-center transition cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Emergency Kill Switch Button */}
        <button
          onClick={openKillSwitchModal}
          title="Emergency Kill Switch (Close all & cancel orders)"
          className="w-9 h-9 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-600/60 text-rose-300 flex items-center justify-center transition cursor-pointer shadow-[0_0_10px_rgba(244,63,94,0.25)]"
        >
          <Flame className="w-4 h-4 text-rose-400" />
        </button>
      </div>
    </aside>
  );
};
