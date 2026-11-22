import React from 'react';
import { motion } from 'framer-motion';

interface ConvictionGaugeProps {
  convictionPct: number;
  className?: string;
}

export const ConvictionGauge: React.FC<ConvictionGaugeProps> = ({
  convictionPct,
  className = '',
}) => {
  const safePct = Number.isFinite(convictionPct) ? convictionPct : 0;
  const clampedPct = Math.max(0, Math.min(100, Math.round(safePct)));

  const tier =
    clampedPct < 50
      ? {
          barClass: 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.65)]',
          textClass: 'text-rose-400',
          borderClass: 'border-rose-500/35',
          bgClass: 'bg-rose-950/50',
          label: 'Low',
        }
      : clampedPct <= 80
      ? {
          barClass: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]',
          textClass: 'text-amber-300',
          borderClass: 'border-amber-500/35',
          bgClass: 'bg-amber-950/40',
          label: 'Moderate',
        }
      : {
          barClass: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]',
          textClass: 'text-emerald-300',
          borderClass: 'border-emerald-500/35',
          bgClass: 'bg-emerald-950/45',
          label: 'High',
        };

  return (
    <div
      className={`inline-flex items-center gap-1.5 h-5 px-2 rounded-full border transition-colors duration-500 ease-in-out ${tier.bgClass} ${tier.borderClass} ${className}`}
      title={`AI Matrix Conviction: ${clampedPct}% (${tier.label})`}
    >
      <div
        role="progressbar"
        aria-label="AI Matrix Conviction"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedPct}
        className="w-16 sm:w-20 h-1.5 rounded-full bg-slate-800/90 overflow-hidden relative"
      >
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: clampedPct / 100 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className={`h-full w-full origin-left rounded-full transition-[background-color,box-shadow] duration-500 ease-in-out ${tier.barClass}`}
        />
      </div>
      <span
        className={`text-[10px] font-mono-numbers font-bold tabular-nums leading-none transition-colors duration-500 ease-in-out ${tier.textClass}`}
      >
        {clampedPct}%
      </span>
    </div>
  );
};
