import React from 'react';
import { PortfolioData, Position, TradingMode } from '../types';
import { Plus, ArrowUpRight, Zap, ShieldCheck, ExternalLink, RefreshCw, Send, CheckCircle2 } from 'lucide-react';
import { GoogleAuthWidget } from './GoogleAuthWidget';

interface WalletIntelligencePanelProps {
  portfolio: PortfolioData;
  positions: Position[];
  tradingMode: TradingMode;
  currencyPrefix: string;
  exchangeRate: number;
  isLiveApiAuthenticated: boolean;
  onOpenSettings: () => void;
  onOpenKillSwitch: () => void;
  onQuickTrade?: () => void;
}

export const WalletIntelligencePanel: React.FC<WalletIntelligencePanelProps> = ({
  portfolio,
  positions,
  tradingMode,
  currencyPrefix,
  exchangeRate,
  isLiveApiAuthenticated,
  onOpenSettings,
  onOpenKillSwitch,
  onQuickTrade,
}) => {
  const totalEquity = portfolio.totalEquity || 1000.0;
  const availableBal = portfolio.availableBalance || 1000.0;
  const marginUsed = portfolio.marginUsed || 0;
  const unrealisedPnl = portfolio.unrealisedPnlTotal || 0;

  // Values in INR and USD (standardized ₹85.00/USD)
  const equityInr = (totalEquity * 85.0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const equityUsd = totalEquity.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const availInr = (availableBal * 85.0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const availUsd = availableBal.toLocaleString(undefined, { maximumFractionDigits: 2 });

  // Circular gauge 1: Target / AI Conviction gauge (75%)
  const gauge1Pct = 75;
  const gauge1Dashoffset = 100 - gauge1Pct;

  // Circular gauge 2: Margin / Scalp Efficiency (57%)
  const gauge2Pct = 57;
  const gauge2Dashoffset = 100 - gauge2Pct;

  return (
    <div className="bg-[#0b0f20]/90 border border-slate-800/80 rounded-3xl p-4 lg:p-5 flex flex-col gap-4 shadow-2xl backdrop-blur-xl relative overflow-hidden">
      {/* Ambient Top Glow */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Profile / Window Bar matching Screenshot 1 */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80 relative z-10">
        <GoogleAuthWidget openSettings={onOpenSettings} />
        
        {/* Subtle Window Control Icons matching Screenshot 1 */}
        <div className="flex items-center gap-1.5 text-slate-500">
          <button
            onClick={onOpenSettings}
            title="Settings & API Keys"
            className="w-6 h-6 rounded-md hover:bg-slate-800 flex items-center justify-center text-xs transition cursor-pointer"
          >
            _
          </button>
          <button
            onClick={onOpenSettings}
            title="Account Management"
            className="w-6 h-6 rounded-md hover:bg-slate-800 flex items-center justify-center text-xs transition cursor-pointer"
          >
            □
          </button>
          <button
            onClick={onOpenKillSwitch}
            title="Emergency Kill Switch"
            className="w-6 h-6 rounded-md hover:bg-rose-950/80 text-rose-400 hover:text-rose-300 flex items-center justify-center text-xs transition cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Wallet Section Header */}
      <div className="flex items-center justify-between relative z-10">
        <div>
          <h3 className="text-sm font-bold text-white tracking-tight">Wallet & Capital</h3>
          <span className="text-[11px] text-slate-400 font-mono">
            {tradingMode === 'LIVE' ? 'Delta Exchange India Live' : 'Isolated Paper Demo'}
          </span>
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
            isLiveApiAuthenticated || tradingMode === 'PAPER'
              ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
              : 'bg-amber-950/70 border-amber-500/40 text-amber-300'
          }`}
        >
          {tradingMode === 'LIVE'
            ? isLiveApiAuthenticated
              ? '● API Live'
              : '▲ Unverified'
            : '● Demo Active'}
        </span>
      </div>

      {/* Quick Action Deposit / Transfer Card & Community Pill Links */}
      <div className="grid grid-cols-2 gap-2.5 relative z-10">
        {/* Add New / Deposit Card */}
        <button
          onClick={onOpenSettings}
          className="rounded-2xl border border-dashed border-cyan-500/30 hover:border-cyan-400/60 bg-cyan-950/20 hover:bg-cyan-950/30 p-3 flex flex-col items-center justify-center text-center group transition cursor-pointer"
        >
          <div className="w-8 h-8 rounded-full bg-cyan-500/20 group-hover:bg-cyan-500/30 border border-cyan-400/40 flex items-center justify-center mb-1.5 transition">
            <Plus className="w-4 h-4 text-cyan-300" />
          </div>
          <span className="text-xs font-semibold text-slate-200 group-hover:text-cyan-300 transition-colors">
            + Add Capital
          </span>
          <span className="text-[10px] text-slate-400">Delta India INR / USDT</span>
        </button>

        {/* Quick Features Menu matching Screenshot 1 */}
        <div className="rounded-2xl border border-slate-800/80 bg-[#12162a]/70 p-3 flex flex-col justify-between text-[11px]">
          <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider">
            <span>Product</span>
            <span>Delta v2</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300 font-medium my-1">
            <span className="hover:text-cyan-300 cursor-pointer transition">Converter</span>
            <span className="hover:text-cyan-300 cursor-pointer transition">Fast Pay</span>
            <span className="hover:text-cyan-300 cursor-pointer transition">Sniper Lab</span>
            <span className="hover:text-cyan-300 cursor-pointer transition">Options</span>
          </div>
          <div className="text-[9px] text-emerald-400 font-mono flex items-center gap-1">
            <CheckCircle2 className="w-2.5 h-2.5" />
            <span>FII/DII Certified</span>
          </div>
        </div>
      </div>

      {/* Two Circular Semi-Arc Donut Gauges matching Screenshot 1 */}
      <div className="grid grid-cols-2 gap-2.5 relative z-10">
        {/* Gauge 1: BTC Target / AI Consensus */}
        <div className="bg-[#12162a]/90 border border-slate-800/80 rounded-2xl p-3 flex flex-col items-center text-center">
          <div className="relative w-16 h-16 flex items-center justify-center my-1">
            <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
              {/* Background ring */}
              <path
                className="text-slate-800"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              {/* Progress arc */}
              <path
                className="text-amber-400"
                strokeDasharray="100, 100"
                strokeDashoffset={gauge1Dashoffset}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span className="absolute text-xs font-bold font-mono text-white">75%</span>
          </div>
          <span className="text-xs font-bold font-mono text-slate-100">5.2547</span>
          <span className="text-[10px] text-rose-400 font-mono font-semibold">-0.73%</span>
          <span className="text-[11px] font-bold text-slate-400 mt-1">BTC</span>
        </div>

        {/* Gauge 2: ETH Target / Camarilla Breakout */}
        <div className="bg-[#12162a]/90 border border-slate-800/80 rounded-2xl p-3 flex flex-col items-center text-center">
          <div className="relative w-16 h-16 flex items-center justify-center my-1">
            <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
              {/* Background ring */}
              <path
                className="text-slate-800"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              {/* Progress arc */}
              <path
                className="text-cyan-400"
                strokeDasharray="100, 100"
                strokeDashoffset={gauge2Dashoffset}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <span className="absolute text-xs font-bold font-mono text-white">57%</span>
          </div>
          <span className="text-xs font-bold font-mono text-slate-100">7.8741</span>
          <span className="text-[10px] text-emerald-400 font-mono font-semibold">+1.57%</span>
          <span className="text-[11px] font-bold text-slate-400 mt-1">ETH</span>
        </div>
      </div>

      {/* Amount & Quick Send/Execute Row matching Screenshot 1 */}
      <div className="bg-[#12162a]/90 border border-slate-800/80 rounded-2xl p-3.5 flex items-center justify-between gap-3 relative z-10">
        <div>
          <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider block">
            Total Balance
          </span>
          <span className="text-sm lg:text-base font-bold font-mono-numbers text-white">
            {currencyPrefix === '₹' ? `₹${equityInr}` : `$${equityUsd}`}
          </span>
          <span className="text-[10px] text-slate-400 font-mono block">
            {currencyPrefix === '₹' ? `≈ $${equityUsd} USD` : `≈ ₹${equityInr} INR`}
          </span>
        </div>
        <button
          onClick={onQuickTrade}
          className="neo-btn-gradient px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg hover:shadow-cyan-500/25 transition shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Execute</span>
        </button>
      </div>

      {/* Total Portfolio Multi-Color Segmented Ring matching Screenshot 1 */}
      <div className="bg-[#12162a]/90 border border-slate-800/80 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 relative z-10">
        {/* Donut Ring with +12% Total in center */}
        <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
          <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 42 42">
            {/* Background base */}
            <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#1e293b" strokeWidth="4" />
            {/* Bitcoin Segment (Blue 32%) */}
            <circle
              cx="21"
              cy="21"
              r="15.915"
              fill="transparent"
              stroke="#3b82f6"
              strokeWidth="4"
              strokeDasharray="31.78 68.22"
              strokeDashoffset="25"
            />
            {/* Ethereum Segment (Rose/Red 27%) */}
            <circle
              cx="21"
              cy="21"
              r="15.915"
              fill="transparent"
              stroke="#f43f5e"
              strokeWidth="4"
              strokeDasharray="27.15 72.85"
              strokeDashoffset="93.22"
            />
            {/* Solana Segment (Cyan 22%) */}
            <circle
              cx="21"
              cy="21"
              r="15.915"
              fill="transparent"
              stroke="#06b6d4"
              strokeWidth="4"
              strokeDasharray="22.40 77.60"
              strokeDashoffset="66.07"
            />
            {/* Cash/INR (Emerald 18%) */}
            <circle
              cx="21"
              cy="21"
              r="15.915"
              fill="transparent"
              stroke="#10b981"
              strokeWidth="4"
              strokeDasharray="18.67 81.33"
              strokeDashoffset="43.67"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xs font-extrabold text-cyan-300 font-mono">+12%</span>
            <span className="text-[9px] text-slate-400 font-medium">Total</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-1.5 text-xs w-full">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-slate-300 font-medium">Bitcoin</span>
            </div>
            <span className="font-mono text-white font-bold">31.78%</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span className="text-slate-300 font-medium">Ethereum</span>
            </div>
            <span className="font-mono text-white font-bold">27.15%</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-500" />
              <span className="text-slate-300 font-medium">Solana</span>
            </div>
            <span className="font-mono text-white font-bold">22.40%</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-slate-300 font-medium">Cash (INR)</span>
            </div>
            <span className="font-mono text-white font-bold">18.67%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
