import React, { useState, useEffect, useCallback } from 'react';
import { BtcStrategyReport, InstitutionalBtcSniperResult } from '../services/intradaySniperEngine';
import { SniperSignal } from '../types';
import {
  FileText,
  Copy,
  Check,
  X,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Layers,
  Crosshair,
  Target,
  Percent,
  Sliders,
  DollarSign,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';

interface BtcStrategyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report?: BtcStrategyReport | null;
  currentSignal: SniperSignal;
  currencyPrefix?: string;
}

export const BtcStrategyReportModal: React.FC<BtcStrategyReportModalProps> = React.memo(({
  isOpen,
  onClose,
  report: propReport,
  currentSignal,
  currencyPrefix = '$',
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [activeSection, setActiveSection] = useState<string>('ALL');

  // Retrieve report from prop or signal attachment
  const btcSniper = currentSignal.btcSniperResult as InstitutionalBtcSniperResult | undefined;
  const report: BtcStrategyReport | undefined = propReport || btcSniper?.report;

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopyReport = useCallback(async () => {
    if (!report?.formattedText) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(report.formattedText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = report.formattedText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy strategy report:', err);
    }
  }, [report?.formattedText]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-fade-in font-sans">
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-[#080B17] border border-cyan-500/30 rounded-2xl shadow-2xl shadow-black/95 flex flex-col overflow-hidden text-slate-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 bg-[#0D111D] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="report-title" className="text-sm sm:text-base font-bold text-white tracking-wide uppercase">
                  Institutional BTC Intraday Strategy Report
                </h2>
                <span className="badge-delta badge-delta-live text-[10px]">
                  Delta Exchange India
                </span>
                {report && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold border ${
                    report.sectionF_setupAndConfluence.confluence.grade === 'A+'
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                      : report.sectionF_setupAndConfluence.confluence.grade === 'A'
                      ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
                      : 'bg-amber-950/80 border-amber-500 text-amber-300'
                  }`}>
                    Grade {report.sectionF_setupAndConfluence.confluence.grade} · {report.sectionF_setupAndConfluence.confluence.totalScore}/16 Pts
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-mono-numbers mt-0.5">
                Market Structure · Trade Location · Momentum · Confirmation · Risk Management · Execution
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyReport}
              className={`btn-delta-sm ${
                copied ? 'btn-toggle-active !text-emerald-300 !border-emerald-500/50' : 'btn-secondary text-slate-300'
              }`}
              title="Copy full 9-section report in Markdown text"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
              <span>{copied ? 'Copied' : 'Copy Report'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 text-xs font-mono-numbers">
          {!report ? (
            <div className="py-12 text-center text-slate-400">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="font-semibold text-white">Strategy Engine Generating Report...</p>
              <p className="text-xs text-slate-500 mt-1">Collecting live completed candles and calculating confluence metrics.</p>
            </div>
          ) : (
            <>
              {/* SECTION A: MARKET SNAPSHOT */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
                    <Target className="w-4 h-4" />
                    <span>Section A · Market Snapshot</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Pair: BTCUSD · Delta Exchange</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block uppercase">Mark Price</span>
                    <span className="text-sm font-bold text-white tabular-nums">
                      ${report.sectionA_marketSnapshot.markPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block uppercase">24h Change</span>
                    <span className={`text-sm font-bold tabular-nums ${report.sectionA_marketSnapshot.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {report.sectionA_marketSnapshot.change24hPct >= 0 ? '+' : ''}
                      {report.sectionA_marketSnapshot.change24hPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block uppercase">24h High / Low</span>
                    <span className="text-xs font-bold text-slate-300 tabular-nums">
                      ${report.sectionA_marketSnapshot.high24h.toLocaleString('en-US', { maximumFractionDigits: 0 })} / ${report.sectionA_marketSnapshot.low24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block uppercase">15M ATR(14)</span>
                    <span className="text-xs font-bold text-cyan-300 tabular-nums">
                      ${report.sectionA_marketSnapshot.atr14_15m.toFixed(1)} ({report.sectionA_marketSnapshot.atrPct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* SECTION B: MARKET STRUCTURE (4H & 1H) */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
                    <Layers className="w-4 h-4" />
                    <span>Section B · Market Structure (Completed Candles)</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Strict Hierarchy Rule 1</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block uppercase">4H Macro Regime</span>
                    <span className={`text-xs font-bold flex items-center gap-1 mt-0.5 ${
                      report.sectionB_marketStructure.regime4H === 'BULLISH'
                        ? 'text-emerald-400'
                        : report.sectionB_marketStructure.regime4H === 'BEARISH'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}>
                      {report.sectionB_marketStructure.regime4H === 'BULLISH' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {report.sectionB_marketStructure.regime4H}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block uppercase">1H Trend Validation</span>
                    <span className={`text-xs font-bold flex items-center gap-1 mt-0.5 ${
                      report.sectionB_marketStructure.regime1H === 'BULLISH'
                        ? 'text-emerald-400'
                        : report.sectionB_marketStructure.regime1H === 'BEARISH'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}>
                      {report.sectionB_marketStructure.regime1H === 'BULLISH' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {report.sectionB_marketStructure.regime1H}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80">
                    <span className="text-slate-400 text-[10px] block uppercase">15M Trade Structure</span>
                    <span className={`text-xs font-bold flex items-center gap-1 mt-0.5 ${
                      report.sectionB_marketStructure.structure15M === 'BULLISH'
                        ? 'text-emerald-400'
                        : report.sectionB_marketStructure.structure15M === 'BEARISH'
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}>
                      {report.sectionB_marketStructure.structure15M}
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded border border-slate-800/60 flex items-center justify-between">
                  <span>Intraday Anchors: Swing Low ${report.sectionB_marketStructure.keySwings.swingLow.toFixed(1)}</span>
                  <span>Swing High ${report.sectionB_marketStructure.keySwings.swingHigh.toFixed(1)}</span>
                </div>
              </div>

              {/* SECTION C: DAILY CPR & VIRGIN CPR ANALYSIS */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
                    <Percent className="w-4 h-4" />
                    <span>Section C · Daily CPR &amp; Virgin CPR Registry</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    report.sectionC_cprAnalysis.widthRegime === 'NARROW'
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                      : report.sectionC_cprAnalysis.widthRegime === 'WIDE'
                      ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}>
                    {report.sectionC_cprAnalysis.widthRegime} CPR ({report.sectionC_cprAnalysis.widthPct.toFixed(3)}%)
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">TC (Top Central)</span>
                    <span className="text-xs font-bold text-white">${report.sectionC_cprAnalysis.cprTop.toFixed(1)}</span>
                  </div>
                  <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Pivot (P)</span>
                    <span className="text-xs font-bold text-cyan-300">${report.sectionC_cprAnalysis.p.toFixed(1)}</span>
                  </div>
                  <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">BC (Bottom Central)</span>
                    <span className="text-xs font-bold text-white">${report.sectionC_cprAnalysis.cprBottom.toFixed(1)}</span>
                  </div>
                  <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Acceptance</span>
                    <span className="text-xs font-bold text-emerald-400">{report.sectionC_cprAnalysis.priceAcceptance} CPR</span>
                  </div>
                </div>
                {report.sectionC_cprAnalysis.nearestVirginCpr && (
                  <div className="p-2 rounded bg-purple-950/50 border border-purple-500/40 text-[11px] text-purple-200 flex items-center justify-between">
                    <span>Virgin CPR Magnet: ${report.sectionC_cprAnalysis.nearestVirginCpr.midpoint.toFixed(1)} ({report.sectionC_cprAnalysis.nearestVirginCpr.relation})</span>
                    <span>{report.sectionC_cprAnalysis.nearestVirginCpr.distancePct.toFixed(2)}% away</span>
                  </div>
                )}
              </div>

              {/* SECTION D: CAMARILLA PIVOT CONFLUENCE */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
                    <Sliders className="w-4 h-4" />
                    <span>Section D · Camarilla Pivot Confluence (1D Completed Range)</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Range: ${report.sectionD_camarillaConfluence.range.toFixed(0)}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2 bg-rose-950/40 rounded border border-rose-500/30">
                    <span className="text-rose-300 text-[10px] block">H4 (Breakout Long)</span>
                    <span className="text-xs font-bold text-rose-200">${report.sectionD_camarillaConfluence.h4.toFixed(1)}</span>
                  </div>
                  <div className="p-2 bg-rose-950/20 rounded border border-rose-500/20">
                    <span className="text-rose-400 text-[10px] block">H3 (Range Top)</span>
                    <span className="text-xs font-bold text-rose-300">${report.sectionD_camarillaConfluence.h3.toFixed(1)}</span>
                  </div>
                  <div className="p-2 bg-emerald-950/20 rounded border border-emerald-500/20">
                    <span className="text-emerald-400 text-[10px] block">L3 (Range Bottom)</span>
                    <span className="text-xs font-bold text-emerald-300">${report.sectionD_camarillaConfluence.l3.toFixed(1)}</span>
                  </div>
                  <div className="p-2 bg-emerald-950/40 rounded border border-emerald-500/30">
                    <span className="text-emerald-300 text-[10px] block">L4 (Breakdown Short)</span>
                    <span className="text-xs font-bold text-emerald-200">${report.sectionD_camarillaConfluence.l4.toFixed(1)}</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 italic">
                  Note: {report.sectionD_camarillaConfluence.keyLevelNote}
                </p>
              </div>

              {/* SECTION E: FIBONACCI & EMA 9/21 */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
                    <TrendingUp className="w-4 h-4" />
                    <span>Section E · Fibonacci &amp; EMA 9/21 Stacks</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Dynamic Trend Geometry</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">15M EMA 9 / 21</span>
                    <span className="text-xs font-bold text-white">
                      ${report.sectionE_fibonacciAndEma.ema15m.ema9.toFixed(0)} / ${report.sectionE_fibonacciAndEma.ema15m.ema21.toFixed(0)}
                    </span>
                    <span className="text-[9px] text-cyan-300 block">{report.sectionE_fibonacciAndEma.ema15m.stack}</span>
                  </div>
                  <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">15M EMA Slope</span>
                    <span className="text-xs font-bold text-emerald-400">
                      {report.sectionE_fibonacciAndEma.ema15m.slopePct.toFixed(2)}% ({report.sectionE_fibonacciAndEma.ema15m.angleDeg}°)
                    </span>
                  </div>
                  <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Fib 0.500 / 0.618</span>
                    <span className="text-xs font-bold text-white">
                      ${report.sectionE_fibonacciAndEma.fibonacci.fib500.toFixed(0)} / ${report.sectionE_fibonacciAndEma.fibonacci.fib618.toFixed(0)}
                    </span>
                  </div>
                  <div className="p-2 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Fib 1.618 Target</span>
                    <span className="text-xs font-bold text-cyan-300">
                      ${report.sectionE_fibonacciAndEma.fibonacci.ext1618.toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* SECTION F: SETUP IDENTIFICATION & 16-POINT CONFLUENCE SCORE */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
                    <Crosshair className="w-4 h-4" />
                    <span>Section F · Setup &amp; 16-Point Confluence Scoring</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold text-sm">
                      {report.sectionF_setupAndConfluence.confluence.totalScore}/16 Pts
                    </span>
                    <span className="badge-delta badge-delta-live text-[10px]">
                      Grade {report.sectionF_setupAndConfluence.confluence.grade}
                    </span>
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1">
                  <div className="font-bold text-white text-xs">
                    {report.sectionF_setupAndConfluence.setup.name}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    {report.sectionF_setupAndConfluence.setup.description}
                  </p>
                </div>
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                    Confluence Criteria Checklist (16 Max Pts):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {report.sectionF_setupAndConfluence.confluence.items.map((item) => (
                      <div
                        key={item.id}
                        className={`p-2 rounded border flex items-center justify-between gap-2 text-[11px] ${
                          item.passed
                            ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          {item.passed ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <X className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                          <span className="font-medium truncate">{item.label}</span>
                        </div>
                        <span className="font-bold shrink-0 tabular-nums">
                          {item.earned}/{item.weight} pts
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* SECTION G: HARD NO-TRADE FILTERS AUDIT */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Section G · Hard No-Trade Filters Audit (11 Gates)</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    report.sectionG_hardFiltersAudit.passed
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                      : 'bg-rose-950/80 border-rose-500 text-rose-300'
                  }`}>
                    {report.sectionG_hardFiltersAudit.passed ? 'ALL FILTERS CLEARED' : `${report.sectionG_hardFiltersAudit.triggeredCount} FILTERS TRIGGERED`}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {report.sectionG_hardFiltersAudit.filters.map((f) => (
                    <div
                      key={f.id}
                      className={`p-2 rounded border flex items-center justify-between gap-2 text-[10.5px] ${
                        f.triggered
                          ? 'bg-rose-950/50 border-rose-500/60 text-rose-200'
                          : 'bg-slate-950 border-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        {f.triggered ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span className="font-medium truncate">{f.label}</span>
                      </div>
                      <span className={`text-[9.5px] font-bold uppercase shrink-0 ${f.triggered ? 'text-rose-300' : 'text-emerald-400'}`}>
                        {f.triggered ? 'BLOCKED' : 'PASS'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION H: RISK & POSITION SIZING PLAN */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider text-xs">
                    <DollarSign className="w-4 h-4" />
                    <span>Section H · Risk &amp; Delta Lots Sizing Plan</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Max Risk Cap: 0.25%</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Max Dollar Risk</span>
                    <span className="text-xs font-bold text-rose-400">
                      ${report.sectionH_riskAndPositionSizing.riskAmountUsd.toFixed(2)} ({report.sectionH_riskAndPositionSizing.riskPct.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Delta Lots (0.001 BTC)</span>
                    <span className="text-xs font-bold text-cyan-300">
                      {report.sectionH_riskAndPositionSizing.deltaLots} Lots ({report.sectionH_riskAndPositionSizing.clampedBtcSize.toFixed(3)} BTC)
                    </span>
                  </div>
                  <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Estimated Margin</span>
                    <span className="text-xs font-bold text-white">
                      ${report.sectionH_riskAndPositionSizing.estimatedMarginUsd.toFixed(2)} (~10x)
                    </span>
                  </div>
                  <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Roundtrip Friction</span>
                    <span className="text-xs font-bold text-slate-300">
                      ${report.sectionH_riskAndPositionSizing.roundtripFeeUsd.toFixed(2)} (Maker + GST)
                    </span>
                  </div>
                </div>
              </div>

              {/* SECTION I: FINAL EXECUTION SUMMARY */}
              <div className="p-4 rounded-xl bg-[#0D111D] border border-cyan-500/40 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-2 text-cyan-300 font-bold uppercase tracking-wider text-xs">
                    <CheckCircle className="w-4 h-4 text-cyan-400" />
                    <span>Section I · Final Execution Summary &amp; Exit Ladder</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase border ${
                    report.sectionI_finalExecutionSummary.action === 'LONG'
                      ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                      : report.sectionI_finalExecutionSummary.action === 'SHORT'
                      ? 'bg-rose-950 border-rose-500 text-rose-300'
                      : 'bg-amber-950 border-amber-500 text-amber-300'
                  }`}>
                    {report.sectionI_finalExecutionSummary.action} · {report.sectionI_finalExecutionSummary.signalState}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                      <span className="text-slate-400 text-[10px] block">Target 1 (Close 35%)</span>
                      <span className="text-xs font-bold text-white tabular-nums">
                        ${report.sectionI_finalExecutionSummary.exits.tp1Price.toFixed(2)} (1:{report.sectionI_finalExecutionSummary.exits.tp1R}R)
                      </span>
                      <span className="text-[9.5px] text-cyan-300 block mt-0.5">Move SL to Breakeven (+Fee)</span>
                    </div>
                    <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                      <span className="text-slate-400 text-[10px] block">Target 2 (Close 35%)</span>
                      <span className="text-xs font-bold text-emerald-400 tabular-nums">
                        ${report.sectionI_finalExecutionSummary.exits.tp2Price.toFixed(2)} (1:{report.sectionI_finalExecutionSummary.exits.tp2R}R)
                      </span>
                      <span className="text-[9.5px] text-slate-300 block mt-0.5">Bank Guaranteed Profit Cushion</span>
                    </div>
                    <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
                      <span className="text-slate-400 text-[10px] block">Runner (Trail 30%)</span>
                      <span className="text-xs font-bold text-cyan-300 tabular-nums">
                        ${report.sectionI_finalExecutionSummary.exits.tp3RunnerPrice.toFixed(2)} (1:{report.sectionI_finalExecutionSummary.exits.tp3R}R)
                      </span>
                      <span className="text-[9.5px] text-slate-300 block mt-0.5">Trail on 15M Swing / EMA 21</span>
                    </div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] text-slate-300 leading-relaxed font-sans">
                    <strong>Protocol:</strong> {report.sectionI_finalExecutionSummary.executionProtocol}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-800/80 bg-[#0D111D] flex items-center justify-between text-xs text-slate-400 shrink-0">
          <span>Engine: Institutional Intraday Sniper · BTCUSD</span>
          <button
            type="button"
            onClick={onClose}
            className="btn-delta-sm btn-secondary"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
});
