import React from 'react';
import { ArrowUp, ArrowDown, Cpu, Activity, Landmark, Zap, Shield, ShieldAlert, CheckCircle, AlertTriangle } from 'lucide-react';
import { SniperExposureMode, SniperScalpTier } from '../types';
import { useCapitalAllocation } from '../context/CapitalAllocationContext';
import { calculateSniperFriction } from '../utils/frictionUtils';

export interface SniperExecutionControlProps {
  directionMode: 'AUTO' | 'LONG' | 'SHORT';
  setDirectionMode?: (mode: 'AUTO' | 'LONG' | 'SHORT') => void;
  exposureMode: SniperExposureMode;
  setExposureMode?: (mode: SniperExposureMode) => void;
  scalpTier?: SniperScalpTier;
  setScalpTier?: (tier: SniperScalpTier) => void;
  signalSource: 'COMMAND_CENTER' | 'QUANT_ALGO';
  setSignalSource?: (source: 'COMMAND_CENTER' | 'QUANT_ALGO') => void;
  bypassHtfFilter: boolean;
  setBypassHtfFilter?: (bypass: boolean) => void;
  tradingMode: 'PAPER' | 'LIVE';
  isAboveHtfAndVwap?: boolean;
  h4Level?: number;
  markPrice?: number;
  symbol?: string;
  currencyPrefix?: string;
  exchangeRate?: number;
  className?: string;
}

export const SniperExecutionControl: React.FC<SniperExecutionControlProps> = ({
  directionMode,
  setDirectionMode,
  exposureMode,
  setExposureMode,
  scalpTier,
  setScalpTier,
  signalSource,
  setSignalSource,
  bypassHtfFilter,
  setBypassHtfFilter,
  tradingMode,
  isAboveHtfAndVwap = true,
  h4Level,
  markPrice = 81702.5,
  symbol = 'BTCUSDT',
  currencyPrefix = '$',
  exchangeRate = 1,
  className = '',
}) => {
  const {
    defaultLotSize,
    lotSizingMode,
    sizingMethod,
    fixedRiskUsd,
    equityPercent,
    maxRiskPerTradePct,
    calculateLotSize,
    getContractsCount,
  } = useCapitalAllocation();
  const activeTier = scalpTier || (exposureMode === 'MICRO_15' ? 'TIER_15' : 'TIER_50');
  const isMicro15 = exposureMode === 'MICRO_15' || (exposureMode !== 'MACRO' && activeTier === 'TIER_15');
  const isMicro50 = exposureMode === 'MICRO_50' || (exposureMode !== 'MACRO' && activeTier === 'TIER_50');

  const activeLot =
    lotSizingMode === 'FIXED_LOT'
      ? defaultLotSize
      : calculateLotSize(symbol, markPrice) || defaultLotSize;
  const activeContracts = getContractsCount(symbol, activeLot);
  const isPaper = tradingMode === 'PAPER';
  const effectiveDirection = directionMode === 'AUTO' 
    ? (isAboveHtfAndVwap ? 'LONG' : 'SHORT')
    : directionMode;

  const friction = calculateSniperFriction({
    entryPrice: markPrice,
    direction: effectiveDirection,
    lotSize: activeLot,
    isTaker: true,
  });

  const displayH4 = h4Level && h4Level > 0 
    ? h4Level.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (markPrice >= 70000 ? '78,165.28' : markPrice.toFixed(2));

  return (
    <div className={`panel-delta panel-delta-body font-mono-numbers space-y-2.5 ${className}`}>
      {/* Top Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Directional Bias Quick Switch */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Directional Bias:</span>
          </span>

          {setDirectionMode && (
            <div className="inline-flex items-center p-1 bg-slate-900/90 border border-slate-800/80 rounded-lg text-xs gap-1">
              <button
                type="button"
                onClick={() => setDirectionMode('AUTO')}
                className={`btn-delta-sm ${
                  directionMode === 'AUTO' ? 'btn-toggle-active' : 'btn-secondary'
                }`}
                title="AUTO: Dynamic direction aligning with 1H EMA50 / VWAP regime"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>AUTO</span>
              </button>

              <button
                type="button"
                onClick={() => setDirectionMode('LONG')}
                className={`btn-delta-sm ${
                  directionMode === 'LONG' ? 'btn-primary' : 'btn-secondary'
                }`}
                title="LONG: Force bullish breakout mode targeting H5/H6 ladder"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>LONG</span>
              </button>

              <button
                type="button"
                onClick={() => setDirectionMode('SHORT')}
                className={`btn-delta-sm ${
                  directionMode === 'SHORT' ? 'btn-danger' : 'btn-secondary'
                }`}
                title="SHORT: Force bearish breakdown mode targeting L5/L6 ladder"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                <span>SHORT</span>
              </button>
            </div>
          )}
        </div>

        {/* Center: Global Lot Size & Friction Drag Pill */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-slate-800/80 rounded-lg text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400">Lot:</span>
            <span className="font-bold text-white text-xs">
              {activeLot.toFixed(3)} {symbol.replace('USDT', '').replace('USD', '')} ({activeContracts} cts)
            </span>
            <span className="badge-delta badge-delta-armed">
              {sizingMethod === 'EQUITY_PERCENT'
                ? `${equityPercent}% Eq`
                : `Risk ${maxRiskPerTradePct}%`}
            </span>
          </div>
          <span className="text-slate-600">|</span>
          <div className="flex items-center gap-1 text-[10px]" title="Roundtrip Taker 0.05% + 18% GST + 3 bps Slippage">
            <span className="text-slate-400">Friction:</span>
            <span className="text-amber-300 font-bold">${friction.totalFrictionUsd.toFixed(2)}</span>
            <span className="text-[9px] text-cyan-400 font-mono">(±${friction.pointDrag.toFixed(1)}/pt)</span>
          </div>
        </div>

        {/* Right: Bypass HTF Filter (Paper Demo Only) Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {setBypassHtfFilter && (
            <label
              className={`btn-delta ${
                bypassHtfFilter && isPaper ? 'btn-toggle-active' : 'btn-secondary'
              } ${!isPaper ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={
                isPaper
                  ? 'Bypass HTF / VWAP Guard (Paper): Forces Gate #1 to PASS (OVERRIDE) and unlocks order execution buttons for manual paper testing'
                  : 'Bypass toggle is strictly restricted to Paper Demo mode'
              }
            >
              <input
                type="checkbox"
                checked={bypassHtfFilter && isPaper}
                disabled={!isPaper}
                onChange={(e) => setBypassHtfFilter(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`w-7 h-4 rounded-full relative transition-colors ${
                  bypassHtfFilter && isPaper ? 'bg-amber-400' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${
                    bypassHtfFilter && isPaper ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </div>

              <span>Bypass HTF / VWAP Guard (Paper)</span>

              {bypassHtfFilter && isPaper && (
                <span className="badge-delta badge-delta-paper animate-pulse">
                  ACTIVE
                </span>
              )}
            </label>
          )}

          {/* Dual Sniper Scalp Mode Selector & Exposure Mode */}
          {(setExposureMode || setScalpTier) && (
            <div className="inline-flex items-center p-1 bg-slate-900/90 border border-slate-800/80 rounded-lg text-xs gap-1">
              <button
                type="button"
                onClick={() => {
                  if (setScalpTier) setScalpTier('TIER_50');
                  else if (setExposureMode) setExposureMode('MICRO_50');
                }}
                className={`btn-delta-sm ${
                  isMicro50 ? 'btn-toggle-active' : 'btn-secondary'
                }`}
                title="Tier 1: Standard Sniper ($50 Max Risk) - 0.05 to 0.10 BTC sizing, $25/$50/$100/$150 profit ladder"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Tier 1: Standard ($50 Max Risk)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (setScalpTier) setScalpTier('TIER_15');
                  else if (setExposureMode) setExposureMode('MICRO_15');
                }}
                className={`btn-delta-sm ${
                  isMicro15 ? 'btn-toggle-active' : 'btn-secondary'
                }`}
                title="Tier 2: Micro Sniper ($15 Max Risk) - 0.01 to 0.02 BTC micro contract sizing, $7.50/$15/$30/$45 profit ladder"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300" />
                <span>Tier 2: Micro ($15 Max Risk)</span>
              </button>

              <button
                type="button"
                onClick={() => setExposureMode?.('MACRO')}
                className={`btn-delta-sm ${
                  exposureMode === 'MACRO' ? 'btn-toggle-active' : 'btn-secondary'
                }`}
                title="Institutional Macro Exposure"
              >
                <Landmark className="w-3.5 h-3.5" />
                <span>MACRO</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recalculated Long Breakout Parameters Banner when LONG or AUTO with price > EMA50/VWAP */}
      {effectiveDirection === 'LONG' && (
        <div className="p-2.5 bg-emerald-950/35 border border-emerald-500/35 rounded-lg text-[11px] text-emerald-300 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              <strong>Bullish HTF Bias Armed:</strong> Price above 1H EMA50 &amp; Session VWAP.
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10.5px] flex-wrap">
            <span>
              Long Breakout: <strong className="text-white font-mono">H4 &ge; ${displayH4}</strong>
            </span>
            <span className="text-cyan-300 font-mono">
              Cost-Covered BE: <strong className="text-white">${friction.netBreakevenPrice.toLocaleString()}</strong> <span className="text-[9.5px] text-emerald-400">(+${friction.totalFrictionUsd.toFixed(2)})</span>
            </span>
            <span className="text-emerald-400/80">
              Targets: <strong className="text-emerald-300">H5 / H6 Ascending Ladder</strong>
            </span>
          </div>
        </div>
      )}

      {/* Warning/Bypass status banner when SHORT is selected while price is above EMA50 */}
      {effectiveDirection === 'SHORT' && isAboveHtfAndVwap && (
        <div className={`p-2.5 rounded-lg text-[11px] flex flex-wrap items-center justify-between gap-2 border ${
          bypassHtfFilter && isPaper
            ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
            : 'bg-rose-950/40 border-rose-500/35 text-rose-300'
        }`}>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${bypassHtfFilter && isPaper ? 'text-amber-400' : 'text-rose-400'}`} />
            <span>
              {bypassHtfFilter && isPaper ? (
                <>
                  <strong>Paper Override Active:</strong> SHORT execution unlocked despite price &gt; 1H EMA50 / VWAP.
                </>
              ) : (
                <>
                  <strong>Counter-Trend Short:</strong> Price above 1H EMA50 / VWAP. Enable Bypass or switch to <strong>[LONG]</strong> / <strong>[AUTO]</strong> for bullish breakout.
                </>
              )}
            </span>
          </div>
          <span className={`badge-delta ${bypassHtfFilter && isPaper ? 'badge-delta-paper' : 'badge-delta-warning'}`}>
            {bypassHtfFilter && isPaper ? 'GATE #1: PASS (OVERRIDE)' : 'GATE #1: ADVISORY WARNING'}
          </span>
        </div>
      )}

      {/* Tight-Spread Slippage Alert when Micro Sniper friction exceeds 12% ($1.80) */}
      {isMicro15 && friction.totalFrictionUsd > 1.80 && (
        <div className="p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-lg text-[11px] text-amber-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              <strong>Tight-Spread Slippage Alert:</strong> Roundtrip friction (${friction.totalFrictionUsd.toFixed(2)}) exceeds 12% ($1.80) of $15 micro risk envelope.
            </span>
          </div>
          <span className="badge-delta badge-delta-warning">
            BUFFER CRITICAL
          </span>
        </div>
      )}
    </div>
  );
};
