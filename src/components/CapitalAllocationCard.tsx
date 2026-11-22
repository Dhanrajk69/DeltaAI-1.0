import React, { useState } from 'react';
import {
  Sliders,
  DollarSign,
  Percent,
  Plus,
  Minus,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Layers,
  Sparkles,
  TrendingUp,
  Info,
  CheckCircle2,
} from 'lucide-react';
import { useCapitalAllocation, SizingMethod } from '../context/CapitalAllocationContext';
import { calculateSniperFriction } from '../utils/frictionUtils';

export interface CapitalAllocationCardProps {
  availableBalance?: number;
  markPrice?: number;
  selectedSymbol?: string;
  leverage?: number;
  className?: string;
}

export const CapitalAllocationCard: React.FC<CapitalAllocationCardProps> = ({
  availableBalance = 1000,
  markPrice = 81702.50,
  selectedSymbol = 'BTCUSDT',
  leverage: propLeverage,
  className = '',
}) => {
  const {
    sizingMethod,
    lotSizingMode,
    fixedLot,
    defaultLotSize,
    fixedRiskUsd,
    equityPercent,
    maxRiskPerTradePct,
    maxDailyLossPct,
    leverage: contextLeverage,
    lastServerSyncAt,
    setSizingMethod,
    setFixedLot,
    setFixedRiskUsd,
    setEquityPercent,
    getContractUnitValue,
    getContractsCount,
    resolveSafeExecutionLot,
    calculateLotSize,
    getMarginRequirement,
    getPointValue,
    autoFitLotToMaxMargin,
  } = useCapitalAllocation();

  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const activeLeverage = propLeverage || contextLeverage || 10;
  const activeLot = calculateLotSize(selectedSymbol, markPrice, undefined, availableBalance, activeLeverage);
  const contractUnit = getContractUnitValue(selectedSymbol);
  const activeContracts = getContractsCount(selectedSymbol, activeLot);
  const safeCheck = resolveSafeExecutionLot({
    symbol: selectedSymbol,
    markPrice,
    availableBalance,
    totalEquity: availableBalance,
    leverage: activeLeverage,
  });
  const requiredMargin = getMarginRequirement(activeLot, markPrice, activeLeverage);
  const pointValue = getPointValue(activeLot);
  const notionalValue = activeLot * markPrice;

  const friction = calculateSniperFriction({
    entryPrice: markPrice,
    direction: 'LONG',
    lotSize: activeLot,
    isTaker: true,
  });

  // Margin utilization percentage with color thresholds (<50% Green, 50-80% Amber, >80% Red)
  const utilizationPct = availableBalance > 0 ? (requiredMargin / availableBalance) * 100 : 0;
  const isMarginExceeded = requiredMargin > availableBalance || utilizationPct > 100;
  const isHighUtilization = utilizationPct > 80;
  const isMediumUtilization = utilizationPct >= 50 && utilizationPct <= 80;

  const cleanSym = selectedSymbol.replace('USDT', '').replace('USD', '') || 'BTC';

  const handleAutoFit = () => {
    autoFitLotToMaxMargin(availableBalance, markPrice, activeLeverage);
    setNotificationMsg('Lot size automatically calibrated to 90% available margin limit.');
    setTimeout(() => setNotificationMsg(null), 3500);
  };

  const lotPresets = [0.01, 0.05, 0.10, 0.25, 0.50, 1.0];
  const riskPresets = [25, 50, 100, 200, 250, 500];
  const equityPresets = [1, 2, 5, 10, 15, 25];

  return (
    <div
      className={`panel-delta p-4 sm:p-5 space-y-4 font-mono-numbers relative overflow-hidden ${className}`}
    >
      {/* Background cyber accent glow */}
      <div className="absolute top-0 right-0 w-80 h-40 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-950 via-slate-900 to-blue-950 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
            <Sliders className="w-4 h-4 text-cyan-300" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="panel-delta-title text-white">
                Global Capital Sizing &amp; Lot Configuration
              </h3>
              <span className="badge-delta badge-delta-armed">
                MODE: RISK-SCALED
              </span>
              <span className="badge-delta badge-delta-standby">
                {activeLot.toFixed(3)} {cleanSym} · {activeContracts} CTS
              </span>
              {lastServerSyncAt && (
                <span className="badge-delta badge-delta-live text-[10px]">
                  CONFIG.JSON SYNCED
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Single source of truth for Camarilla Sniper, Trading Desk, Options Lab &amp; AI Command (1 ct = {contractUnit} {cleanSym} · Max Risk {maxRiskPerTradePct}% · Daily Loss {maxDailyLossPct}%)
            </p>
          </div>
        </div>

        {/* Live Active Margin Badge */}
        <div className="flex items-center gap-2">
          <div
            className={`badge-delta ${
              utilizationPct > 80
                ? 'badge-delta-danger'
                : utilizationPct >= 50
                ? 'badge-delta-paper'
                : 'badge-delta-live'
            }`}
          >
            {isMarginExceeded ? (
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>
              {isMarginExceeded
                ? 'MARGIN EXCEEDED'
                : `${utilizationPct.toFixed(1)}% MARGIN UTILIZATION`}
            </span>
          </div>
        </div>
      </div>

      {notificationMsg && (
        <div className="p-2.5 bg-cyan-950/60 border border-cyan-600/60 rounded-lg text-xs text-cyan-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-cyan-400" />
          <span>{notificationMsg}</span>
        </div>
      )}

      {/* Sizing Mode Tabs & Active Controls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 relative z-10">
        {/* Left Column: Mode Tabs & Dynamic Inputs */}
        <div className="lg:col-span-7 space-y-4">
          {/* Sizing Mode Tabs */}
          <div>
            <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Capital Allocation Mode:
            </label>
            <div className="grid grid-cols-2 gap-2 p-1.5 bg-slate-950/90 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setSizingMethod('FIXED_RISK')}
                className={`btn-delta w-full ${
                  sizingMethod !== 'EQUITY_PERCENT' ? 'btn-toggle-active' : 'btn-secondary'
                }`}
              >
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span>$ Risk</span>
              </button>

              <button
                type="button"
                onClick={() => setSizingMethod('EQUITY_PERCENT')}
                className={`btn-delta w-full ${
                  sizingMethod === 'EQUITY_PERCENT' ? 'btn-toggle-active' : 'btn-secondary'
                }`}
              >
                <Percent className="w-3.5 h-3.5 text-purple-400" />
                <span>% Equity</span>
              </button>
            </div>
          </div>

          {/* Risk Dollar Amount Configuration */}
          {sizingMethod !== 'EQUITY_PERCENT' && (
            <div className="p-3.5 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-bold">Maximum Dollar Risk per Trade:</span>
                <span className="text-emerald-400 font-bold text-sm">${fixedRiskUsd.toFixed(2)}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFixedRiskUsd(Math.max(5, fixedRiskUsd - 10))}
                  className="btn-delta btn-secondary w-9 px-0 shrink-0"
                  title="Decrease $10"
                >
                  <Minus className="w-4 h-4 text-slate-300" />
                </button>

                <div className="relative flex-1">
                  <input
                    type="number"
                    step="5"
                    min="5"
                    max="5000"
                    value={fixedRiskUsd}
                    onChange={(e) => setFixedRiskUsd(Math.max(5, parseFloat(e.target.value) || 50))}
                    className="w-full h-9 bg-slate-900/90 border border-slate-700 focus:border-emerald-400 rounded-lg px-4 text-center text-white font-bold text-sm focus:outline-none transition"
                  />
                  <span className="absolute right-3 top-2 text-xs text-emerald-400 pointer-events-none font-bold">
                    USD ($)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setFixedRiskUsd(fixedRiskUsd + 10)}
                  className="btn-delta btn-secondary w-9 px-0 shrink-0"
                  title="Increase $10"
                >
                  <Plus className="w-4 h-4 text-slate-300" />
                </button>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
                  Risk Presets ($):
                </span>
                <div className="grid grid-cols-6 gap-1.5">
                  {riskPresets.map((val) => {
                    const isSelected = fixedRiskUsd === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setFixedRiskUsd(val)}
                        className={`btn-delta-sm w-full ${
                          isSelected ? 'btn-toggle-active' : 'btn-secondary'
                        }`}
                      >
                        ${val}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Mode 3: Percentage of Equity */}
          {sizingMethod === 'EQUITY_PERCENT' && (
            <div className="p-3.5 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-bold">Margin Allocation (% of Equity):</span>
                <span className="text-purple-300 font-bold text-sm">{equityPercent}%</span>
              </div>

              <div className="space-y-2">
                <input
                  type="range"
                  min="0.5"
                  max="30"
                  step="0.5"
                  value={equityPercent}
                  onChange={(e) => setEquityPercent(parseFloat(e.target.value))}
                  className="w-full accent-purple-400 cursor-pointer h-2 bg-slate-800 rounded-lg"
                />
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
                  Equity Presets (%):
                </span>
                <div className="grid grid-cols-6 gap-1.5">
                  {equityPresets.map((val) => {
                    const isSelected = equityPercent === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setEquityPercent(val)}
                        className={`btn-delta-sm w-full ${
                          isSelected ? 'btn-toggle-active' : 'btn-secondary'
                        }`}
                      >
                        {val}%
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Telemetry, Calculations & Utilization Gauge */}
        <div className="lg:col-span-5 bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 flex flex-col justify-between space-y-3.5">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/70">
              <span className="panel-delta-title text-slate-300">
                Telemetry &amp; Calculations
              </span>
              <span className="badge-delta badge-delta-armed">
                {activeLeverage}x LEVERAGE
              </span>
            </div>

            {/* Calculations List */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Mark Price:</span>
                <span className="text-white font-bold">
                  ${markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Delta Contracts ({contractUnit} {cleanSym}/ct):</span>
                <span className="text-amber-300 font-bold">
                  {activeContracts} cts ({activeLot.toFixed(3)} {cleanSym})
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Point Value (ΔP):</span>
                <span className="text-cyan-300 font-bold">
                  ${pointValue.toFixed(3)} / pt
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Notional Exposure:</span>
                <span className="text-slate-200 font-bold">
                  ${notionalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Required Margin:</span>
                <span
                  className={`font-bold ${
                    utilizationPct > 80 ? 'text-rose-400' : utilizationPct >= 50 ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  ${requiredMargin.toFixed(2)}{' '}
                  <span className="text-slate-500 font-normal">/ ${availableBalance.toFixed(2)}</span>
                </span>
              </div>

              {/* Margin Utilization Progress Bar Component (Used vs Available) */}
              <div className="space-y-1.5 py-1.5 px-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <span>Margin Utilization:</span>
                    <span className="text-slate-500 font-normal">
                      (${requiredMargin.toFixed(2)} used / ${availableBalance.toFixed(2)} avail)
                    </span>
                  </span>
                  <span
                    className={`font-bold font-mono px-1.5 py-0.5 rounded text-[10px] border ${
                      utilizationPct > 80
                        ? 'text-rose-300 bg-rose-950/80 border-rose-700'
                        : utilizationPct >= 50
                        ? 'text-amber-300 bg-amber-950/80 border-amber-700'
                        : 'text-emerald-300 bg-emerald-950/80 border-emerald-700'
                    }`}
                  >
                    {utilizationPct.toFixed(1)}% {utilizationPct > 80 ? (isMarginExceeded ? 'DEFICIT' : '>80% RED') : utilizationPct >= 50 ? '50–80% AMBER' : '<50% GREEN'}
                  </span>
                </div>

                {/* Color-Coded Progress Track: Green (<50%), Amber (50-80%), Red (>80%) */}
                <div className="w-full bg-slate-950 border border-slate-800 rounded-full h-2.5 overflow-hidden p-0.5 relative">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      utilizationPct > 80
                        ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]'
                        : utilizationPct >= 50
                        ? 'bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
                        : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(utilizationPct > 0 ? 3 : 0, utilizationPct))}%` }}
                  />
                </div>

                {/* Color-Coded Threshold Scale */}
                <div className="flex justify-between items-center text-[9px] font-mono text-slate-500 pt-0.5">
                  <span className={utilizationPct < 50 ? 'text-emerald-400 font-bold' : ''}>
                    ● &lt;50% Green
                  </span>
                  <span className={utilizationPct >= 50 && utilizationPct <= 80 ? 'text-amber-400 font-bold' : ''}>
                    ● 50–80% Amber
                  </span>
                  <span className={utilizationPct > 80 ? 'text-rose-400 font-bold' : ''}>
                    ● &gt;80% Red
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-slate-400 text-[11px]" title="Roundtrip Taker (0.05%) + 18% GST + 3 bps Slippage">Est. Friction Drag:</span>
                <span className="text-amber-300 font-bold">
                  ${friction.totalFrictionUsd.toFixed(2)}{' '}
                  <span className="text-slate-400 text-[10px] font-normal">(₹{friction.totalFrictionInr.toFixed(2)})</span>
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Net Point Drag:</span>
                <span className="text-cyan-300 font-mono font-bold">
                  ±${friction.pointDrag.toFixed(2)} / pt
                </span>
              </div>
            </div>
          </div>

          {/* Safety Action: Auto-fit Lot to Max Margin */}
          <div className="pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={handleAutoFit}
              className={`btn-delta w-full uppercase tracking-wider ${
                isMarginExceeded
                  ? 'btn-danger animate-pulse'
                  : 'btn-primary'
              }`}
              title="Clamp lot size to safely consume at most 90% of available margin balance"
            >
              <Zap className="w-4 h-4 shrink-0" />
              <span>Auto-fit Lot to Max Margin (≤ 90% Bal)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
