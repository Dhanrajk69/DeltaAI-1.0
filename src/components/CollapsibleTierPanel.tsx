import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useLayoutPriority } from '../context/LayoutPriorityContext';

export interface CollapsibleTierPanelProps {
  /** Stable identifier for the Tier 3 diagnostic/setup panel */
  id: string;
  /** Primary title shown in the 1-line summary header */
  title: string;
  /** Optional small tier classification tag (e.g. "TIER 3 · SETUP" or "TIER 3 · DIAGNOSTIC") */
  tierLabel?: string;
  /** Optional icon rendered inside the header badge */
  icon?: React.ReactNode;
  /** Compact 1-line status summary rendered in the header bar */
  summary?: React.ReactNode;
  /** Optional extra controls rendered right next to the Expand/Collapse toggle */
  headerActions?: React.ReactNode;
  /** Accent border styling class when collapsed or expanded */
  accentClass?: string;
  /** Whether the panel starts expanded when no live position is active and layoutMode is AUTO */
  defaultExpandedWhenIdle?: boolean;
  /** Optional extra wrapper className */
  className?: string;
  /** Optional padding override for body wrapper */
  bodyClassName?: string;
  children: React.ReactNode;
}

export const CollapsibleTierPanel: React.FC<CollapsibleTierPanelProps> = ({
  id,
  title,
  tierLabel = 'TIER 3 · SETUP',
  icon,
  summary,
  headerActions,
  accentClass = 'border-slate-800/80 hover:border-slate-700/90',
  defaultExpandedWhenIdle = false,
  className = '',
  bodyClassName = '',
  children,
}) => {
  const {
    layoutMode,
    effectiveCompact,
    hasActiveLivePosition,
    syncGeneration,
    globalTargetExpanded,
  } = useLayoutPriority();

  const computeDefaultOpen = () => {
    if (layoutMode === 'COMPACT') return false;
    if (layoutMode === 'EXPANDED') return true;
    return hasActiveLivePosition ? false : defaultExpandedWhenIdle;
  };

  const [isOpen, setIsOpen] = useState<boolean>(computeDefaultOpen);
  const lastGenRef = useRef<number>(syncGeneration);
  const prevEffectiveCompactRef = useRef<boolean>(effectiveCompact);

  // Respond to global header toggles or live-position auto-collapse events
  useEffect(() => {
    if (syncGeneration !== lastGenRef.current) {
      lastGenRef.current = syncGeneration;
      if (globalTargetExpanded !== null) {
        setIsOpen(globalTargetExpanded);
      } else {
        setIsOpen(hasActiveLivePosition ? false : defaultExpandedWhenIdle);
      }
      prevEffectiveCompactRef.current = effectiveCompact;
      return;
    }

    // If effectiveCompact flips to true (e.g. a live position opened right after mount), auto-collapse
    if (!prevEffectiveCompactRef.current && effectiveCompact) {
      setIsOpen(false);
    }
    prevEffectiveCompactRef.current = effectiveCompact;
  }, [
    syncGeneration,
    globalTargetExpanded,
    effectiveCompact,
    hasActiveLivePosition,
    defaultExpandedWhenIdle,
  ]);

  return (
    <section
      data-tier-panel={id}
      className={`min-w-0 max-w-full rounded-2xl border bg-[#0b1220]/95 shadow-lg transition-colors ${accentClass} ${className}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className={`w-full flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 cursor-pointer select-none transition-colors ${
          isOpen
            ? 'border-b border-slate-800/80 bg-[#0f172a]/70 rounded-t-2xl'
            : 'rounded-2xl hover:bg-slate-900/60'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2.5 min-w-[220px] flex-1">
          {icon && (
            <div className="shrink-0 w-7 h-7 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-center">
              {icon}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-200">
              {title}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700/70 text-slate-400">
              {tierLabel}
            </span>
            {!isOpen && effectiveCompact && hasActiveLivePosition && layoutMode === 'AUTO' && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
                Auto-Collapsed · Live Position
              </span>
            )}
          </div>
          {summary && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-slate-400 min-w-0">
              {summary}
            </div>
          )}
        </div>

        <div
          className="flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {headerActions}
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all ${
              isOpen
                ? 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
                : 'bg-cyan-500/10 border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/20'
            }`}
          >
            {isOpen ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Collapse</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Expand</span>
              </>
            )}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className={`min-w-0 max-w-full ${bodyClassName}`}>
          {children}
        </div>
      )}
    </section>
  );
};

export default CollapsibleTierPanel;
