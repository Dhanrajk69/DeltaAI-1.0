import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type GlobalLayoutMode = 'AUTO' | 'COMPACT' | 'EXPANDED';

interface LayoutPriorityContextValue {
  /** User-selected layout mode: AUTO collapses Tier 3 whenever a live position is open */
  layoutMode: GlobalLayoutMode;
  /** Effective collapsed state for Tier 3 setup/diagnostic panels */
  effectiveCompact: boolean;
  /** True when at least one perpetual, sniper, or options position is currently live */
  hasActiveLivePosition: boolean;
  /** Total active live position count across perpetuals, sniper, and options */
  activePositionCount: number;
  /** Monotonic generation counter used by CollapsibleTierPanel to sync global toggles & live-position auto-collapse */
  syncGeneration: number;
  /** Explicit target state from the latest global sync event */
  globalTargetExpanded: boolean | null;
  /** Switch directly between Compact and Expanded views from the global header toggle */
  toggleCompactExpanded: () => void;
  /** Explicitly set AUTO, COMPACT, or EXPANDED */
  setLayoutMode: (mode: GlobalLayoutMode) => void;
  /** Allow workspace engines (e.g. OptionsStrategyEngine) to report active live positions */
  reportActivePositionSource: (sourceId: string, count: number) => void;
}

const STORAGE_KEY = 'delta_global_layout_mode_v1';

const LayoutPriorityContext = createContext<LayoutPriorityContextValue | null>(null);

interface LayoutPriorityProviderProps {
  children: React.ReactNode;
  /** Active position count known directly by the root App (perpetuals + sniper + telemetry) */
  baseActivePositionCount?: number;
}

export const LayoutPriorityProvider: React.FC<LayoutPriorityProviderProps> = ({
  children,
  baseActivePositionCount = 0,
}) => {
  const [layoutMode, setLayoutModeState] = useState<GlobalLayoutMode>('AUTO');

  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});
  const [syncGeneration, setSyncGeneration] = useState<number>(0);
  const [globalTargetExpanded, setGlobalTargetExpanded] = useState<boolean | null>(null);

  const reportActivePositionSource = useCallback((sourceId: string, count: number) => {
    const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    setSourceCounts((prev) => {
      if ((prev[sourceId] ?? 0) === safeCount) return prev;
      return { ...prev, [sourceId]: safeCount };
    });
  }, []);

  const reportedCount = useMemo(
    () => Object.values(sourceCounts).reduce((sum, n) => sum + n, 0),
    [sourceCounts]
  );

  const activePositionCount = Math.max(0, baseActivePositionCount) + reportedCount;
  const hasActiveLivePosition = activePositionCount > 0;

  const effectiveCompact =
    layoutMode === 'COMPACT' || (layoutMode === 'AUTO' && hasActiveLivePosition);

  // Context-aware auto-collapse whenever a live position opens (false -> true) in AUTO mode
  const prevHasLiveRef = useRef<boolean>(hasActiveLivePosition);
  useEffect(() => {
    const prev = prevHasLiveRef.current;
    prevHasLiveRef.current = hasActiveLivePosition;
    if (layoutMode === 'AUTO' && !prev && hasActiveLivePosition) {
      setGlobalTargetExpanded(false);
      setSyncGeneration((g) => g + 1);
    }
  }, [hasActiveLivePosition, layoutMode]);

  const setLayoutMode = useCallback(
    (mode: GlobalLayoutMode) => {
      setLayoutModeState(mode);
      if (mode === 'COMPACT') {
        setGlobalTargetExpanded(false);
      } else if (mode === 'EXPANDED') {
        setGlobalTargetExpanded(true);
      } else {
        setGlobalTargetExpanded(hasActiveLivePosition ? false : null);
      }
      setSyncGeneration((g) => g + 1);
    },
    [hasActiveLivePosition]
  );

  const toggleCompactExpanded = useCallback(() => {
    if (effectiveCompact) {
      setLayoutModeState('EXPANDED');
      setGlobalTargetExpanded(true);
    } else {
      setLayoutModeState('COMPACT');
      setGlobalTargetExpanded(false);
    }
    setSyncGeneration((g) => g + 1);
  }, [effectiveCompact]);

  const value = useMemo<LayoutPriorityContextValue>(
    () => ({
      layoutMode,
      effectiveCompact,
      hasActiveLivePosition,
      activePositionCount,
      syncGeneration,
      globalTargetExpanded,
      toggleCompactExpanded,
      setLayoutMode,
      reportActivePositionSource,
    }),
    [
      layoutMode,
      effectiveCompact,
      hasActiveLivePosition,
      activePositionCount,
      syncGeneration,
      globalTargetExpanded,
      toggleCompactExpanded,
      setLayoutMode,
      reportActivePositionSource,
    ]
  );

  return (
    <LayoutPriorityContext.Provider value={value}>
      {children}
    </LayoutPriorityContext.Provider>
  );
};

export const useLayoutPriority = (): LayoutPriorityContextValue => {
  const ctx = useContext(LayoutPriorityContext);
  if (!ctx) {
    return {
      layoutMode: 'AUTO',
      effectiveCompact: false,
      hasActiveLivePosition: false,
      activePositionCount: 0,
      syncGeneration: 0,
      globalTargetExpanded: null,
      toggleCompactExpanded: () => {},
      setLayoutMode: () => {},
      reportActivePositionSource: () => {},
    };
  }
  return ctx;
};
