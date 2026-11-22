import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { calculateNetLadderPayouts } from '../utils/frictionUtils';
import type { MarginMode, LotSizingMode, RiskSettings } from '../types';

export type SizingMethod = 'FIXED_LOT' | 'FIXED_RISK' | 'EQUITY_PERCENT';

export interface GlobalLeverageUpdate {
  globalLeverage?: number;
  defaultLeverage?: number;
  maxLeverageCap?: number;
  marginMode?: MarginMode;
  leverageSyncLocked?: boolean;
}

export interface EquitySafeLotParams {
  symbol: string;
  markPrice: number;
  availableBalance: number;
  leverage?: number;
  maxEquityPct?: number;
  requestedLotSize?: number;
  isOption?: boolean;
  optionPremiumUsd?: number;
  legsCount?: number;
}

export interface EquitySafeLotResult {
  lotSize: number;
  contracts: number;
  estimatedMarginUsd: number;
  maxAllowedMarginUsd: number;
  wasScaled: boolean;
  scaleReason?: string;
}

export interface SafeExecutionLotParams {
  symbol: string;
  markPrice: number;
  availableBalance: number;
  totalEquity?: number;
  stopLossDistance?: number;
  leverage?: number;
  overrideLotSize?: number;
  isOption?: boolean;
  optionMarginPerContractUsd?: number;
}

export interface SafeExecutionLotResult {
  lotSize: number;
  requestedLotSize: number;
  contracts: number;
  requestedContracts: number;
  contractUnit: number;
  lotSizingMode: LotSizingMode;
  estimatedMarginUsd: number;
  estimatedRiskUsd: number;
  maxAllowedRiskUsd: number;
  wasClamped: boolean;
  clampReason?: string;
  clampSource?: 'MARGIN' | 'MAX_RISK_PCT' | 'BOTH';
}

export interface CapitalAllocationConfig {
  sizingMethod: SizingMethod;
  lotSizingMode: LotSizingMode;
  fixedLot: number;
  defaultLotSize: number;
  fixedRiskUsd: number;
  equityPercent: number;
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxDailyLossUsd: number;
  maxTradesPerDay: number;
  maxPositionSizePercent: number;
  maxDrawdownPercent: number;
  killSwitchArmed: boolean;
  autoHedgeEnabled: boolean;
  leverage: number;
  globalLeverage: number;
  defaultLeverage: number;
  maxLeverageCap: number;
  marginMode: MarginMode;
  leverageSyncLocked: boolean;
}

export interface CapitalAllocationContextType {
  config: CapitalAllocationConfig;
  riskSettings: RiskSettings;
  sizingMethod: SizingMethod;
  lotSizingMode: LotSizingMode;
  fixedLot: number;
  defaultLotSize: number;
  fixedRiskUsd: number;
  equityPercent: number;
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  leverage: number;
  globalLeverage: number;
  defaultLeverage: number;
  maxLeverageCap: number;
  marginMode: MarginMode;
  leverageSyncLocked: boolean;
  lastServerSyncAt: number | null;
  setSizingMethod: (method: SizingMethod) => void;
  setLotSizingMode: (mode: LotSizingMode) => void;
  setFixedLot: (lot: number) => void;
  setDefaultLotSize: (lot: number) => void;
  setFixedRiskUsd: (risk: number) => void;
  setEquityPercent: (pct: number) => void;
  setMaxRiskPerTradePct: (pct: number) => void;
  setMaxDailyLossPct: (pct: number) => void;
  setLeverage: (lev: number) => void;
  setGlobalLeverage: (lev: number) => void;
  setMaxLeverageCap: (cap: number) => void;
  setMarginMode: (mode: MarginMode) => void;
  setLeverageSyncLocked: (locked: boolean) => void;
  applyGlobalLeverageConfig: (partial: GlobalLeverageUpdate) => void;
  updateRiskSettings: (partial: Partial<RiskSettings>, options?: { persistServer?: boolean; immediate?: boolean }) => void;
  hydrateFromServerConfig: (serverRisk: Partial<RiskSettings>) => void;
  clampLeverage: (requestedLev?: number) => number;
  getContractUnitValue: (symbol: string) => number;
  getContractsCount: (symbol: string, lotSize: number) => number;
  resolveSafeExecutionLot: (params: SafeExecutionLotParams) => SafeExecutionLotResult;
  calculateLotSize: (
    symbol: string,
    markPrice: number,
    stopLossDistance?: number,
    availableBalance?: number,
    customLeverage?: number
  ) => number;
  getMarginRequirement: (lotSize: number, markPrice: number, customLeverage?: number) => number;
  getPointValue: (lotSize: number) => number;
  getLadderPayouts: (
    entryPrice: number,
    targets: { tp1: number; tp2: number; tp3: number; tp4: number },
    lotSize: number,
    isShort?: boolean
  ) => {
    tp1Payout: number;
    tp2Payout: number;
    tp3Payout: number;
    tp4Payout: number;
    tp1Gross?: number;
    tp1Net?: number;
    tp2Gross?: number;
    tp2Net?: number;
    tp3Gross?: number;
    tp3Net?: number;
    tp4Gross?: number;
    tp4Net?: number;
  };
  autoFitLotToMaxMargin: (availableBalance: number, markPrice: number, customLeverage?: number) => number;
  autoScaleToEquityCap: (params: EquitySafeLotParams) => EquitySafeLotResult;
}

const STORAGE_KEY = 'delta_capital_allocation_v1';
const RISK_SETTINGS_STORAGE_KEY = 'delta_risk_settings_v1';
const SYNC_EVENT = 'delta_capital_allocation_change';

const DEFAULT_CONFIG: CapitalAllocationConfig = {
  sizingMethod: 'FIXED_RISK',
  lotSizingMode: 'RISK_BASED',
  fixedLot: 0.10, // Default 0.10 BTC = 100 contracts on Delta Exchange India (0.001 BTC/ct)
  defaultLotSize: 0.10,
  fixedRiskUsd: 50,
  equityPercent: 5,
  maxRiskPerTradePct: 1,
  maxDailyLossPct: 3,
  maxDailyLossUsd: 1500,
  maxTradesPerDay: 25,
  maxPositionSizePercent: 20,
  maxDrawdownPercent: 8,
  killSwitchArmed: true,
  autoHedgeEnabled: true,
  leverage: 10,
  globalLeverage: 10,
  defaultLeverage: 10,
  maxLeverageCap: 20,
  marginMode: 'ISOLATED',
  leverageSyncLocked: true,
};

export function getContractUnitForSymbol(symbol: string): number {
  const clean = String(symbol || 'BTCUSDT').toUpperCase();
  if (clean.startsWith('BTC')) return 0.001;
  if (clean.startsWith('ETH')) return 0.01;
  if (clean.startsWith('SOL')) return 0.1;
  return 1;
}

export function getContractsForLot(symbol: string, lotSize: number): number {
  const unit = getContractUnitForSymbol(symbol);
  if (!Number.isFinite(lotSize) || lotSize <= 0) return 1;
  return Math.max(1, Math.round(lotSize / unit));
}

function floorLotToUnit(lot: number, unit: number): number {
  if (!Number.isFinite(lot) || lot <= unit) return unit;
  if (unit >= 1) return Math.max(1, Math.floor(lot));
  const inv = Math.round(1 / unit);
  return Math.max(unit, +(Math.floor(lot * inv) / inv).toFixed(4));
}

function roundLotToUnit(lot: number, unit: number): number {
  if (!Number.isFinite(lot) || lot <= unit) return unit;
  if (unit >= 1) return Math.max(1, Math.round(lot));
  const inv = Math.round(1 / unit);
  return Math.max(unit, +(Math.round(lot * inv) / inv).toFixed(4));
}

function sanitizeConfig(parsed: any): CapitalAllocationConfig {
  const maxCapRaw =
    typeof parsed?.maxLeverageCap === 'number' && parsed.maxLeverageCap >= 1
      ? Math.min(100, Math.round(parsed.maxLeverageCap))
      : typeof parsed?.maxLeverage === 'number' && parsed.maxLeverage >= 1
      ? Math.min(100, Math.round(parsed.maxLeverage))
      : DEFAULT_CONFIG.maxLeverageCap;

  const rawGlobal =
    typeof parsed?.defaultLeverage === 'number' && parsed.defaultLeverage >= 1
      ? parsed.defaultLeverage
      : typeof parsed?.globalLeverage === 'number' && parsed.globalLeverage >= 1
      ? parsed.globalLeverage
      : typeof parsed?.leverage === 'number' && parsed.leverage >= 1
      ? parsed.leverage
      : DEFAULT_CONFIG.globalLeverage;

  const clampedGlobal = Math.max(1, Math.min(maxCapRaw, Math.round(rawGlobal)));
  const marginMode: MarginMode =
    String(parsed?.marginMode || '').toUpperCase() === 'CROSS' ? 'CROSS' : 'ISOLATED';
  const leverageSyncLocked =
    typeof parsed?.leverageSyncLocked === 'boolean'
      ? parsed.leverageSyncLocked
      : DEFAULT_CONFIG.leverageSyncLocked;

  const rawLot =
    typeof parsed?.defaultLotSize === 'number' && parsed.defaultLotSize > 0
      ? parsed.defaultLotSize
      : typeof parsed?.fixedLot === 'number' && parsed.fixedLot > 0
      ? parsed.fixedLot
      : DEFAULT_CONFIG.defaultLotSize;
  const sanitizedLot = Math.max(0.001, Math.min(100, +Number(rawLot).toFixed(4)));

  const rawSizingMethod: SizingMethod =
    parsed?.sizingMethod === 'EQUITY_PERCENT'
      ? 'EQUITY_PERCENT'
      : 'FIXED_RISK';

  const rawLotSizingMode: LotSizingMode = 'RISK_BASED';
  const syncedSizingMethod: SizingMethod = rawSizingMethod;

  const numInRange = (val: any, min: number, max: number, defVal: number, decimals = 2): number => {
    const n = Number(val);
    if (!Number.isFinite(n)) return defVal;
    return Number(Math.max(min, Math.min(max, n)).toFixed(decimals));
  };

  return {
    sizingMethod: syncedSizingMethod,
    lotSizingMode: rawLotSizingMode,
    fixedLot: sanitizedLot,
    defaultLotSize: sanitizedLot,
    fixedRiskUsd: numInRange(parsed?.fixedRiskUsd, 1, 50000, DEFAULT_CONFIG.fixedRiskUsd, 2),
    equityPercent: numInRange(parsed?.equityPercent, 0.5, 100, DEFAULT_CONFIG.equityPercent, 2),
    maxRiskPerTradePct: numInRange(parsed?.maxRiskPerTradePct, 0.1, 25, DEFAULT_CONFIG.maxRiskPerTradePct, 2),
    maxDailyLossPct: numInRange(parsed?.maxDailyLossPct, 0.5, 50, DEFAULT_CONFIG.maxDailyLossPct, 2),
    maxDailyLossUsd: numInRange(parsed?.maxDailyLossUsd, 50, 1000000, DEFAULT_CONFIG.maxDailyLossUsd, 2),
    maxTradesPerDay: Math.round(numInRange(parsed?.maxTradesPerDay, 1, 500, DEFAULT_CONFIG.maxTradesPerDay, 0)),
    maxPositionSizePercent: numInRange(parsed?.maxPositionSizePercent, 1, 100, DEFAULT_CONFIG.maxPositionSizePercent, 1),
    maxDrawdownPercent: numInRange(parsed?.maxDrawdownPercent, 1, 50, DEFAULT_CONFIG.maxDrawdownPercent, 1),
    killSwitchArmed: typeof parsed?.killSwitchArmed === 'boolean' ? parsed.killSwitchArmed : DEFAULT_CONFIG.killSwitchArmed,
    autoHedgeEnabled: typeof parsed?.autoHedgeEnabled === 'boolean' ? parsed.autoHedgeEnabled : DEFAULT_CONFIG.autoHedgeEnabled,
    leverage: clampedGlobal,
    globalLeverage: clampedGlobal,
    defaultLeverage: clampedGlobal,
    maxLeverageCap: maxCapRaw,
    marginMode,
    leverageSyncLocked,
  };
}

function toRiskSettingsObject(cfg: CapitalAllocationConfig): RiskSettings {
  return {
    defaultLotSize: cfg.defaultLotSize,
    maxRiskPerTradePct: cfg.maxRiskPerTradePct,
    maxDailyLossPct: cfg.maxDailyLossPct,
    defaultLeverage: cfg.globalLeverage,
    lotSizingMode: cfg.lotSizingMode,
    maxDailyLossUsd: cfg.maxDailyLossUsd,
    maxTradesPerDay: cfg.maxTradesPerDay,
    maxPositionSizePercent: cfg.maxPositionSizePercent,
    maxLeverage: cfg.maxLeverageCap,
    maxLeverageCap: cfg.maxLeverageCap,
    globalLeverage: cfg.globalLeverage,
    marginMode: cfg.marginMode,
    leverageSyncLocked: cfg.leverageSyncLocked,
    maxDrawdownPercent: cfg.maxDrawdownPercent,
    killSwitchArmed: cfg.killSwitchArmed,
    autoHedgeEnabled: cfg.autoHedgeEnabled,
  };
}

function getAuthHeadersForConfigSync(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-admin-email': 'dhanrajk69@gmail.com',
  };
  try {
    const token =
      localStorage.getItem('delta_session_token') ||
      localStorage.getItem('delta_auth_token') ||
      sessionStorage.getItem('delta_session_token');
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {}
  return headers;
}

const CapitalAllocationContext = createContext<CapitalAllocationContextType | null>(null);

export const CapitalAllocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<CapitalAllocationConfig>(() => {
    try {
      if (typeof window !== 'undefined') {
        const savedAlloc = localStorage.getItem(STORAGE_KEY);
        const savedRisk = localStorage.getItem(RISK_SETTINGS_STORAGE_KEY);
        const parsedAlloc = savedAlloc ? JSON.parse(savedAlloc) : {};
        const parsedRisk = savedRisk ? JSON.parse(savedRisk) : {};
        if (savedAlloc || savedRisk) {
          return sanitizeConfig({
            ...parsedAlloc,
            ...parsedRisk,
            // Preserve whichever has an explicit defaultLotSize/fixedLot
            defaultLotSize: parsedRisk.defaultLotSize ?? parsedAlloc.defaultLotSize ?? parsedAlloc.fixedLot,
            fixedLot: parsedRisk.defaultLotSize ?? parsedAlloc.fixedLot ?? parsedAlloc.defaultLotSize,
            lotSizingMode: parsedRisk.lotSizingMode ?? parsedAlloc.lotSizingMode,
          });
        }
      }
    } catch (e) {
      console.warn('[CapitalAllocation] Failed to load from localStorage:', e);
    }
    return DEFAULT_CONFIG;
  });

  const [lastServerSyncAt, setLastServerSyncAt] = useState<number | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasHydratedFromServerRef = useRef<boolean>(false);

  const persistToServer = useCallback((nextCfg: CapitalAllocationConfig, immediate = false) => {
    if (typeof window === 'undefined') return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    const executePost = () => {
      const riskPayload = toRiskSettingsObject(nextCfg);
      fetch('/api/delta/save-config', {
        method: 'POST',
        headers: getAuthHeadersForConfigSync(),
        body: JSON.stringify({
          globalLeverage: nextCfg.globalLeverage,
          defaultLeverage: nextCfg.globalLeverage,
          maxLeverageCap: nextCfg.maxLeverageCap,
          marginMode: nextCfg.marginMode,
          leverageSyncLocked: nextCfg.leverageSyncLocked,
          defaultLotSize: nextCfg.defaultLotSize,
          maxRiskPerTradePct: nextCfg.maxRiskPerTradePct,
          maxDailyLossPct: nextCfg.maxDailyLossPct,
          lotSizingMode: nextCfg.lotSizingMode,
          riskSettings: riskPayload,
        }),
      })
        .then((res) => {
          if (res.ok) {
            setLastServerSyncAt(Date.now());
          }
        })
        .catch(() => {});
    };

    if (immediate) {
      executePost();
    } else {
      persistTimerRef.current = setTimeout(executePost, 220);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, []);

  // Ensure initial localStorage persistence
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        if (!localStorage.getItem(STORAGE_KEY)) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        }
        if (!localStorage.getItem(RISK_SETTINGS_STORAGE_KEY)) {
          localStorage.setItem(RISK_SETTINGS_STORAGE_KEY, JSON.stringify(toRiskSettingsObject(config)));
        }
      }
    } catch {}
  }, [config]);

  // Hydrate persisted Risk Settings from ~/.deltaai-data/config.json on mount
  useEffect(() => {
    if (hasHydratedFromServerRef.current || typeof window === 'undefined') return;
    hasHydratedFromServerRef.current = true;
    fetch('/api/delta/server-config', {
      headers: getAuthHeadersForConfigSync(),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        const srvRisk = data.riskSettings || data.config?.riskSettings;
        const srvLev = data.globalLeverageConfig || data.config?.globalLeverageConfig;
        if (srvRisk || srvLev) {
          setConfig((prev) => {
            const merged = sanitizeConfig({
              ...prev,
              ...(srvLev || {}),
              ...(srvRisk || {}),
            });
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
              localStorage.setItem(RISK_SETTINGS_STORAGE_KEY, JSON.stringify(toRiskSettingsObject(merged)));
            } catch {}
            return merged;
          });
          setLastServerSyncAt(Date.now());
        }
      })
      .catch(() => {});
  }, []);

  // Sync to localStorage, broadcast cross-component event, and optionally persist to server config.json
  const updateConfig = useCallback(
    (
      updater: (prev: CapitalAllocationConfig) => CapitalAllocationConfig,
      options?: { persistServer?: boolean; immediate?: boolean }
    ) => {
      const shouldPersist = options?.persistServer !== false;
      const immediate = Boolean(options?.immediate);

      setConfig((prev) => {
        const next = sanitizeConfig(updater(prev));
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          localStorage.setItem(RISK_SETTINGS_STORAGE_KEY, JSON.stringify(toRiskSettingsObject(next)));
          window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: next }));
        } catch (err) {
          console.warn('[CapitalAllocation] Failed to persist config:', err);
        }
        if (shouldPersist) {
          persistToServer(next, immediate);
        }
        return next;
      });
    },
    [persistToServer]
  );

  // Listen for storage events from other tabs or windows
  useEffect(() => {
    const handleSync = (e?: Event) => {
      try {
        if (e && (e as CustomEvent).detail) {
          return;
        }
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const sanitized = sanitizeConfig(JSON.parse(saved));
          setConfig(sanitized);
        }
      } catch {}
    };

    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  const hydrateFromServerConfig = useCallback((serverRisk: Partial<RiskSettings>) => {
    if (!serverRisk || typeof serverRisk !== 'object') return;
    updateConfig(
      (prev) => ({
        ...prev,
        ...serverRisk,
        fixedLot: serverRisk.defaultLotSize ?? prev.fixedLot,
        defaultLotSize: serverRisk.defaultLotSize ?? prev.defaultLotSize,
        globalLeverage: serverRisk.defaultLeverage ?? serverRisk.globalLeverage ?? prev.globalLeverage,
        defaultLeverage: serverRisk.defaultLeverage ?? serverRisk.globalLeverage ?? prev.defaultLeverage,
        leverage: serverRisk.defaultLeverage ?? serverRisk.globalLeverage ?? prev.leverage,
      }),
      { persistServer: false }
    );
  }, [updateConfig]);

  const setSizingMethod = useCallback(
    (method: SizingMethod) => {
      updateConfig(
        (prev) => ({
          ...prev,
          sizingMethod: method,
          lotSizingMode: method === 'FIXED_LOT' ? 'FIXED_LOT' : 'RISK_BASED',
        }),
        { persistServer: true, immediate: true }
      );
    },
    [updateConfig]
  );

  const setLotSizingMode = useCallback(
    (mode: LotSizingMode) => {
      updateConfig(
        (prev) => ({
          ...prev,
          lotSizingMode: mode,
          sizingMethod:
            mode === 'FIXED_LOT'
              ? 'FIXED_LOT'
              : prev.sizingMethod === 'FIXED_LOT'
              ? 'FIXED_RISK'
              : prev.sizingMethod,
        }),
        { persistServer: true, immediate: true }
      );
    },
    [updateConfig]
  );

  const setFixedLot = useCallback(
    (lot: number) => {
      const valid = Math.max(0.001, Math.min(100, +Number(lot || 0.001).toFixed(4)));
      updateConfig(
        (prev) => ({
          ...prev,
          fixedLot: valid,
          defaultLotSize: valid,
        }),
        { persistServer: true, immediate: false }
      );
    },
    [updateConfig]
  );

  const setDefaultLotSize = setFixedLot;

  const setFixedRiskUsd = useCallback(
    (risk: number) => {
      const valid = Math.max(1, +Number(risk || 1).toFixed(2));
      updateConfig((prev) => ({ ...prev, fixedRiskUsd: valid }), { persistServer: true, immediate: false });
    },
    [updateConfig]
  );

  const setEquityPercent = useCallback(
    (pct: number) => {
      const valid = Math.min(100, Math.max(0.5, +Number(pct || 0.5).toFixed(2)));
      updateConfig((prev) => ({ ...prev, equityPercent: valid }), { persistServer: true, immediate: false });
    },
    [updateConfig]
  );

  const setMaxRiskPerTradePct = useCallback(
    (pct: number) => {
      const valid = Math.min(25, Math.max(0.1, +Number(pct || 1).toFixed(2)));
      updateConfig((prev) => ({ ...prev, maxRiskPerTradePct: valid }), { persistServer: true, immediate: false });
    },
    [updateConfig]
  );

  const setMaxDailyLossPct = useCallback(
    (pct: number) => {
      const valid = Math.min(50, Math.max(0.5, +Number(pct || 3).toFixed(2)));
      updateConfig((prev) => ({ ...prev, maxDailyLossPct: valid }), { persistServer: true, immediate: false });
    },
    [updateConfig]
  );

  const setGlobalLeverage = useCallback(
    (lev: number) => {
      updateConfig(
        (prev) => {
          const cap = prev.maxLeverageCap || 20;
          const valid = Math.max(1, Math.min(cap, Math.round(lev)));
          return { ...prev, globalLeverage: valid, defaultLeverage: valid, leverage: valid };
        },
        { persistServer: true, immediate: false }
      );
    },
    [updateConfig]
  );

  const setLeverage = setGlobalLeverage;

  const setMaxLeverageCap = useCallback(
    (cap: number) => {
      updateConfig(
        (prev) => {
          const validCap = Math.max(1, Math.min(100, Math.round(cap)));
          const clampedGlobal = Math.max(1, Math.min(validCap, prev.globalLeverage || 10));
          return {
            ...prev,
            maxLeverageCap: validCap,
            globalLeverage: clampedGlobal,
            defaultLeverage: clampedGlobal,
            leverage: clampedGlobal,
          };
        },
        { persistServer: true, immediate: false }
      );
    },
    [updateConfig]
  );

  const setMarginMode = useCallback(
    (mode: MarginMode) => {
      updateConfig(
        (prev) => ({
          ...prev,
          marginMode: mode === 'CROSS' ? 'CROSS' : 'ISOLATED',
        }),
        { persistServer: true, immediate: true }
      );
    },
    [updateConfig]
  );

  const setLeverageSyncLocked = useCallback(
    (locked: boolean) => {
      updateConfig(
        (prev) => ({ ...prev, leverageSyncLocked: Boolean(locked) }),
        { persistServer: true, immediate: true }
      );
    },
    [updateConfig]
  );

  const applyGlobalLeverageConfig = useCallback(
    (partial: GlobalLeverageUpdate) => {
      updateConfig(
        (prev) => {
          const nextCap =
            typeof partial.maxLeverageCap === 'number' && Number.isFinite(partial.maxLeverageCap)
              ? Math.max(1, Math.min(100, Math.round(partial.maxLeverageCap)))
              : prev.maxLeverageCap;
          const rawGlobal =
            typeof partial.defaultLeverage === 'number' && Number.isFinite(partial.defaultLeverage)
              ? partial.defaultLeverage
              : typeof partial.globalLeverage === 'number' && Number.isFinite(partial.globalLeverage)
              ? partial.globalLeverage
              : prev.globalLeverage;
          const nextGlobal = Math.max(1, Math.min(nextCap, Math.round(rawGlobal)));
          const nextMarginMode: MarginMode =
            partial.marginMode !== undefined
              ? partial.marginMode === 'CROSS'
                ? 'CROSS'
                : 'ISOLATED'
              : prev.marginMode;
          const nextLocked =
            partial.leverageSyncLocked !== undefined
              ? Boolean(partial.leverageSyncLocked)
              : prev.leverageSyncLocked;

          return {
            ...prev,
            maxLeverageCap: nextCap,
            globalLeverage: nextGlobal,
            defaultLeverage: nextGlobal,
            leverage: nextGlobal,
            marginMode: nextMarginMode,
            leverageSyncLocked: nextLocked,
          };
        },
        { persistServer: false }
      );
    },
    [updateConfig]
  );

  const updateRiskSettings = useCallback(
    (partial: Partial<RiskSettings>, options?: { persistServer?: boolean; immediate?: boolean }) => {
      updateConfig(
        (prev) => {
          const nextLot =
            typeof partial.defaultLotSize === 'number' && partial.defaultLotSize > 0
              ? Math.max(0.001, Math.min(100, +partial.defaultLotSize.toFixed(4)))
              : prev.defaultLotSize;
          const nextCap =
            typeof (partial.maxLeverageCap ?? partial.maxLeverage) === 'number'
              ? Math.max(1, Math.min(100, Math.round((partial.maxLeverageCap ?? partial.maxLeverage) as number)))
              : prev.maxLeverageCap;
          const nextLevRaw = partial.defaultLeverage ?? partial.globalLeverage ?? prev.globalLeverage;
          const nextLev = Math.max(1, Math.min(nextCap, Math.round(nextLevRaw)));
          const nextMode: LotSizingMode =
            partial.lotSizingMode === 'RISK_BASED'
              ? 'RISK_BASED'
              : partial.lotSizingMode === 'FIXED_LOT'
              ? 'FIXED_LOT'
              : prev.lotSizingMode;
          const nextSizingMethod: SizingMethod =
            nextMode === 'FIXED_LOT'
              ? 'FIXED_LOT'
              : prev.sizingMethod === 'FIXED_LOT'
              ? 'FIXED_RISK'
              : prev.sizingMethod;

          return {
            ...prev,
            defaultLotSize: nextLot,
            fixedLot: nextLot,
            lotSizingMode: nextMode,
            sizingMethod: nextSizingMethod,
            maxRiskPerTradePct: partial.maxRiskPerTradePct ?? prev.maxRiskPerTradePct,
            maxDailyLossPct: partial.maxDailyLossPct ?? prev.maxDailyLossPct,
            maxDailyLossUsd: partial.maxDailyLossUsd ?? prev.maxDailyLossUsd,
            maxTradesPerDay: partial.maxTradesPerDay ?? prev.maxTradesPerDay,
            maxPositionSizePercent: partial.maxPositionSizePercent ?? prev.maxPositionSizePercent,
            maxDrawdownPercent: partial.maxDrawdownPercent ?? prev.maxDrawdownPercent,
            killSwitchArmed: partial.killSwitchArmed ?? prev.killSwitchArmed,
            autoHedgeEnabled: partial.autoHedgeEnabled ?? prev.autoHedgeEnabled,
            maxLeverageCap: nextCap,
            globalLeverage: nextLev,
            defaultLeverage: nextLev,
            leverage: nextLev,
            marginMode: partial.marginMode ?? prev.marginMode,
            leverageSyncLocked: partial.leverageSyncLocked ?? prev.leverageSyncLocked,
          };
        },
        {
          persistServer: options?.persistServer !== false,
          immediate: options?.immediate !== false,
        }
      );
    },
    [updateConfig]
  );

  const clampLeverage = useCallback(
    (requestedLev?: number): number => {
      const cap = config.maxLeverageCap || 20;
      const syncedGlobal = Math.max(1, Math.min(cap, config.globalLeverage || 10));
      if (config.leverageSyncLocked) {
        return syncedGlobal;
      }
      const candidate =
        typeof requestedLev === 'number' && Number.isFinite(requestedLev) && requestedLev >= 1
          ? Math.round(requestedLev)
          : syncedGlobal;
      return Math.max(1, Math.min(cap, candidate));
    },
    [config.maxLeverageCap, config.globalLeverage, config.leverageSyncLocked]
  );

  const getContractUnitValue = useCallback((symbol: string): number => {
    return getContractUnitForSymbol(symbol);
  }, []);

  const getContractsCount = useCallback((symbol: string, lotSize: number): number => {
    return getContractsForLot(symbol, lotSize);
  }, []);

  // Unified Execution Lot Resolver respecting FIXED_LOT vs RISK_BASED + Safe Wallet Margin & Max Risk % Clamp
  const resolveSafeExecutionLot = useCallback(
    (params: SafeExecutionLotParams): SafeExecutionLotResult => {
      const unit = getContractUnitForSymbol(params.symbol);
      const price = params.markPrice > 0 ? params.markPrice : 65000;
      const effLev = clampLeverage(params.leverage);
      const availBal = Math.max(0, Number(params.availableBalance || 0));
      const eq = Math.max(availBal, Number(params.totalEquity || 0));
      const slDist =
        typeof params.stopLossDistance === 'number' && params.stopLossDistance > 0
          ? params.stopLossDistance
          : price * 0.005;
      const mode: LotSizingMode = config.lotSizingMode || 'FIXED_LOT';
      const maxRiskPct = config.maxRiskPerTradePct > 0 ? config.maxRiskPerTradePct : 1;
      const maxAllowedRiskUsd = eq > 0 ? +(eq * (maxRiskPct / 100)).toFixed(2) : 0;

      // Determine requested baseline lot
      let requestedLot: number;
      if (typeof params.overrideLotSize === 'number' && params.overrideLotSize > 0) {
        requestedLot = roundLotToUnit(params.overrideLotSize, unit);
      } else if (mode === 'FIXED_LOT') {
        requestedLot = roundLotToUnit(config.defaultLotSize || config.fixedLot || 0.1, unit);
      } else {
        // RISK_BASED: scale contracts strictly within maxRiskPerTradePct of equity (or equityPercent/fixedRiskUsd)
        if (config.sizingMethod === 'EQUITY_PERCENT' && availBal > 0) {
          const marginToCommit = (config.equityPercent / 100) * availBal;
          requestedLot = floorLotToUnit((marginToCommit * effLev) / price, unit);
        } else if (eq > 0 && slDist > 0) {
          const riskBudgetUsd = maxAllowedRiskUsd > 0 ? maxAllowedRiskUsd : config.fixedRiskUsd;
          requestedLot = floorLotToUnit(riskBudgetUsd / slDist, unit);
        } else {
          requestedLot = floorLotToUnit(config.fixedRiskUsd / Math.max(0.01, slDist), unit);
        }
      }

      const requestedContracts = Math.max(1, Math.round(requestedLot / unit));
      let finalLot = requestedLot;
      let wasClamped = false;
      const clampReasons: string[] = [];
      let clampedByMargin = false;
      let clampedByRisk = false;

      if (mode !== 'FIXED_LOT') {
        if (params.isOption) {
          const marginPerContract = Math.max(0.25, Number(params.optionMarginPerContractUsd || 10));
          const desiredMargin = +(requestedContracts * marginPerContract).toFixed(2);
          if (availBal > 0 && desiredMargin > availBal * 0.95) {
            const safeContracts = Math.max(1, Math.floor((availBal * 0.95) / marginPerContract));
            if (safeContracts < requestedContracts) {
              finalLot = +(safeContracts * unit).toFixed(4);
              wasClamped = true;
              clampedByMargin = true;
              clampReasons.push(
                `Wallet Margin Clamp: ${requestedContracts} → ${safeContracts} cts (Avail $${availBal.toFixed(2)})`
              );
            }
          }
        } else {
          // 1. Wallet margin hard clamp (only in RISK_BASED mode)
          const reqMargin = (finalLot * price) / effLev;
          if (availBal > 0 && reqMargin > availBal * 0.95) {
            const maxLotByMargin = floorLotToUnit(((availBal * 0.95) * effLev) / price, unit);
            if (maxLotByMargin < finalLot) {
              const marginCts = Math.max(1, Math.floor((maxLotByMargin + 1e-9) / unit));
              finalLot = +(marginCts * unit).toFixed(4);
              wasClamped = true;
              clampedByMargin = true;
              clampReasons.push(
                `Margin Clamp: ${requestedContracts} → ${marginCts} cts ($${availBal.toFixed(2)} avail @ ${effLev}x)`
              );
            }
          }

          // 2. Max Risk % per trade strict hard clamp (never exceed riskSettings.maxRiskPerTradePct)
          if (maxAllowedRiskUsd > 0 && slDist > 0) {
            const projectedRiskUsd = finalLot * slDist;
            if (projectedRiskUsd > maxAllowedRiskUsd + 1e-6) {
              const maxLotByRisk = floorLotToUnit(maxAllowedRiskUsd / slDist, unit);
              if (maxLotByRisk < finalLot) {
                const riskCts = Math.max(1, Math.floor((maxLotByRisk + 1e-9) / unit));
                finalLot = +(riskCts * unit).toFixed(4);
                wasClamped = true;
                clampedByRisk = true;
                clampReasons.push(
                  `Max Risk ${maxRiskPct}% Clamp: scaled to ${riskCts} cts ($${maxAllowedRiskUsd.toFixed(2)} max risk)`
                );
              }
            }
          }
        }
      }

      const finalContracts = Math.max(1, Math.round(finalLot / unit));
      const estimatedMarginUsd = params.isOption
        ? +(finalContracts * Math.max(0.25, Number(params.optionMarginPerContractUsd || 10))).toFixed(2)
        : +((finalLot * price) / effLev).toFixed(2);
      const estimatedRiskUsd = +(finalLot * slDist).toFixed(2);

      const clampSource =
        clampedByMargin && clampedByRisk
          ? 'BOTH'
          : clampedByMargin
          ? 'MARGIN'
          : clampedByRisk
          ? 'MAX_RISK_PCT'
          : undefined;

      return {
        lotSize: finalLot,
        requestedLotSize: requestedLot,
        contracts: finalContracts,
        requestedContracts,
        contractUnit: unit,
        lotSizingMode: mode,
        estimatedMarginUsd,
        estimatedRiskUsd,
        maxAllowedRiskUsd,
        wasClamped,
        clampReason: clampReasons.length > 0 ? clampReasons.join(' · ') : undefined,
        clampSource,
      };
    },
    [config, clampLeverage]
  );

  // Dynamic lot size calculator based on active sizing method
  const calculateLotSize = useCallback(
    (
      symbol: string,
      markPrice: number,
      stopLossDistance?: number,
      availableBalance: number = 1000,
      customLeverage?: number
    ): number => {
      const lev = customLeverage || config.globalLeverage || config.leverage || 10;
      const price = markPrice > 0 ? markPrice : 81702.50;

      let computedLot = config.defaultLotSize || config.fixedLot;

      if (config.lotSizingMode === 'FIXED_LOT' || config.sizingMethod === 'FIXED_LOT') {
        computedLot = config.defaultLotSize || config.fixedLot;
      } else if (config.sizingMethod === 'EQUITY_PERCENT') {
        const marginToCommit = (config.equityPercent / 100) * Math.max(100, availableBalance);
        const notional = marginToCommit * lev;
        computedLot = notional / price;
      } else {
        // RISK_BASED / FIXED_RISK: use maxRiskPerTradePct of equity when available, else fixedRiskUsd
        const slDist = stopLossDistance && stopLossDistance > 0 ? stopLossDistance : price * 0.005;
        const riskUsd =
          availableBalance > 0 && config.maxRiskPerTradePct > 0
            ? availableBalance * (config.maxRiskPerTradePct / 100)
            : config.fixedRiskUsd;
        computedLot = riskUsd / slDist;
      }

      const unit = getContractUnitForSymbol(symbol);
      return roundLotToUnit(computedLot, unit);
    },
    [config]
  );

  // Margin Requirement: (Lot Size * Mark Price) / Leverage
  const getMarginRequirement = useCallback(
    (lotSize: number, markPrice: number, customLeverage?: number): number => {
      const lev = customLeverage || config.globalLeverage || config.leverage || 10;
      const price = markPrice > 0 ? markPrice : 81702.50;
      return (lotSize * price) / lev;
    },
    [config.globalLeverage, config.leverage]
  );

  // Expected dollar per point movement: ($1 move in asset price = Lot Size in USD)
  const getPointValue = useCallback((lotSize: number): number => {
    return Math.max(0.001, lotSize);
  }, []);

  // 4-Stage Profit Ladder payout calculator (calculates true net profit after deducting fees, GST, and slippage)
  const getLadderPayouts = useCallback(
    (
      entryPrice: number,
      targets: { tp1: number; tp2: number; tp3: number; tp4: number },
      lotSize: number,
      isShort: boolean = false
    ) => {
      const entry = entryPrice > 0 ? entryPrice : 81702.50;
      const netLevels = calculateNetLadderPayouts(entry, targets, lotSize, isShort);

      return {
        tp1Payout: netLevels.tp1Net,
        tp2Payout: netLevels.tp2Net,
        tp3Payout: netLevels.tp3Net,
        tp4Payout: netLevels.tp4Net,
        tp1Gross: netLevels.tp1Gross,
        tp1Net: netLevels.tp1Net,
        tp2Gross: netLevels.tp2Gross,
        tp2Net: netLevels.tp2Net,
        tp3Gross: netLevels.tp3Gross,
        tp3Net: netLevels.tp3Net,
        tp4Gross: netLevels.tp4Gross,
        tp4Net: netLevels.tp4Net,
      };
    },
    []
  );

  // Auto-fit Lot Size to safely consume at most 90% of available margin
  const autoFitLotToMaxMargin = useCallback(
    (availableBalance: number, markPrice: number, customLeverage?: number): number => {
      const lev = customLeverage || config.globalLeverage || config.leverage || 10;
      const price = markPrice > 0 ? markPrice : 81702.50;
      const safeMargin = Math.max(10, availableBalance * 0.90);
      const maxNotional = safeMargin * lev;
      const safeLot = maxNotional / price;

      const clamped = Math.max(0.001, Math.floor(safeLot * 1000) / 1000);
      updateConfig(
        (prev) => ({
          ...prev,
          fixedLot: clamped,
          defaultLotSize: clamped,
          sizingMethod: 'FIXED_LOT',
          lotSizingMode: 'FIXED_LOT',
        }),
        { persistServer: true, immediate: true }
      );
      return clamped;
    },
    [config.globalLeverage, config.leverage, updateConfig]
  );

  // Auto-scale lot size & contract count respecting FIXED_LOT vs equity cap
  const autoScaleToEquityCap = useCallback(
    (params: EquitySafeLotParams): EquitySafeLotResult => {
      const cleanSym = String(params.symbol || 'BTCUSDT').toUpperCase();
      const price =
        params.markPrice > 0
          ? params.markPrice
          : cleanSym.startsWith('ETH')
          ? 3200
          : cleanSym.startsWith('SOL')
          ? 180
          : 81702.5;
      const effectiveLev = clampLeverage(params.leverage);
      const safeBalance = Math.max(0, Number(params.availableBalance || 0));
      const capPct =
        typeof params.maxEquityPct === 'number' && params.maxEquityPct > 0
          ? Math.min(0.95, params.maxEquityPct)
          : 0.95;
      const maxAllowedMarginUsd = +(safeBalance * capPct).toFixed(2);
      const step = getContractUnitForSymbol(cleanSym);

      if (params.isOption) {
        const legs = Math.max(1, Math.round(params.legsCount || 2));
        const desiredOptionLot =
          params.requestedLotSize && params.requestedLotSize > 0
            ? params.requestedLotSize
            : config.defaultLotSize || 0.1;

        const contractMult = cleanSym.startsWith('BTC') ? 0.001 : cleanSym.startsWith('ETH') ? 0.01 : 1;
        const premUsd =
          params.optionPremiumUsd && params.optionPremiumUsd > 0 ? params.optionPremiumUsd : price * 0.012;
        const marginPerContract = Math.max(
          0.5,
          +((price * contractMult * 0.06) / Math.max(1, effectiveLev) + premUsd * contractMult * 0.35).toFixed(2)
        );

        const desiredContractsTotal = Math.max(1, Math.round(desiredOptionLot / contractMult));
        const desiredEstMargin = +(desiredContractsTotal * marginPerContract * Math.min(2, legs * 0.65)).toFixed(2);

        if (safeBalance <= 0) {
          return {
            lotSize: desiredOptionLot,
            contracts: desiredContractsTotal,
            estimatedMarginUsd: desiredEstMargin,
            maxAllowedMarginUsd: 0,
            wasScaled: false,
          };
        }

        if (desiredEstMargin <= maxAllowedMarginUsd) {
          return {
            lotSize: +desiredOptionLot.toFixed(4),
            contracts: desiredContractsTotal,
            estimatedMarginUsd: desiredEstMargin,
            maxAllowedMarginUsd,
            wasScaled: false,
          };
        }

        const safeContracts = Math.max(
          1,
          Math.floor(maxAllowedMarginUsd / (marginPerContract * Math.min(2, legs * 0.65)))
        );
        const scaledLotRaw = +(safeContracts * contractMult).toFixed(4);
        const estMargin = +(safeContracts * marginPerContract * Math.min(2, legs * 0.65)).toFixed(2);

        return {
          lotSize: scaledLotRaw,
          contracts: safeContracts,
          estimatedMarginUsd: estMargin,
          maxAllowedMarginUsd,
          wasScaled: true,
          scaleReason: `Option size clamped ${desiredContractsTotal} → ${safeContracts} cts ($${maxAllowedMarginUsd.toFixed(2)} margin cap)`,
        };
      }

      // Perpetual Futures
      const desiredLot =
        params.requestedLotSize && params.requestedLotSize > 0
          ? params.requestedLotSize
          : calculateLotSize(cleanSym, price, undefined, safeBalance || 1000, effectiveLev);
      const desiredMargin = +((desiredLot * price) / effectiveLev).toFixed(2);
      const desiredContracts = Math.max(1, Math.round(desiredLot / step));

      if (safeBalance <= 0 || desiredMargin <= maxAllowedMarginUsd) {
        return {
          lotSize: desiredLot,
          contracts: desiredContracts,
          estimatedMarginUsd: desiredMargin,
          maxAllowedMarginUsd,
          wasScaled: false,
        };
      }

      const maxNotional = maxAllowedMarginUsd * effectiveLev;
      const scaledLot = floorLotToUnit(maxNotional / price, step);
      const scaledContracts = Math.max(1, Math.round(scaledLot / step));
      const estMargin = +((scaledLot * price) / effectiveLev).toFixed(2);

      return {
        lotSize: scaledLot,
        contracts: scaledContracts,
        estimatedMarginUsd: estMargin,
        maxAllowedMarginUsd,
        wasScaled: true,
        scaleReason: `Margin Clamp: ${desiredLot} → ${scaledLot} (${scaledContracts} cts @ ${effectiveLev}x · $${maxAllowedMarginUsd.toFixed(2)} cap)`,
      };
    },
    [clampLeverage, calculateLotSize, config.defaultLotSize]
  );

  const riskSettings = useMemo(() => toRiskSettingsObject(config), [config]);

  const value = useMemo(
    () => ({
      config,
      riskSettings,
      sizingMethod: config.sizingMethod,
      lotSizingMode: config.lotSizingMode,
      fixedLot: config.defaultLotSize,
      defaultLotSize: config.defaultLotSize,
      fixedRiskUsd: config.fixedRiskUsd,
      equityPercent: config.equityPercent,
      maxRiskPerTradePct: config.maxRiskPerTradePct,
      maxDailyLossPct: config.maxDailyLossPct,
      leverage: config.globalLeverage,
      globalLeverage: config.globalLeverage,
      defaultLeverage: config.globalLeverage,
      maxLeverageCap: config.maxLeverageCap,
      marginMode: config.marginMode,
      leverageSyncLocked: config.leverageSyncLocked,
      lastServerSyncAt,
      setSizingMethod,
      setLotSizingMode,
      setFixedLot,
      setDefaultLotSize,
      setFixedRiskUsd,
      setEquityPercent,
      setMaxRiskPerTradePct,
      setMaxDailyLossPct,
      setLeverage,
      setGlobalLeverage,
      setMaxLeverageCap,
      setMarginMode,
      setLeverageSyncLocked,
      applyGlobalLeverageConfig,
      updateRiskSettings,
      hydrateFromServerConfig,
      clampLeverage,
      getContractUnitValue,
      getContractsCount,
      resolveSafeExecutionLot,
      calculateLotSize,
      getMarginRequirement,
      getPointValue,
      getLadderPayouts,
      autoFitLotToMaxMargin,
      autoScaleToEquityCap,
    }),
    [
      config,
      riskSettings,
      lastServerSyncAt,
      setSizingMethod,
      setLotSizingMode,
      setFixedLot,
      setDefaultLotSize,
      setFixedRiskUsd,
      setEquityPercent,
      setMaxRiskPerTradePct,
      setMaxDailyLossPct,
      setLeverage,
      setGlobalLeverage,
      setMaxLeverageCap,
      setMarginMode,
      setLeverageSyncLocked,
      applyGlobalLeverageConfig,
      updateRiskSettings,
      hydrateFromServerConfig,
      clampLeverage,
      getContractUnitValue,
      getContractsCount,
      resolveSafeExecutionLot,
      calculateLotSize,
      getMarginRequirement,
      getPointValue,
      getLadderPayouts,
      autoFitLotToMaxMargin,
      autoScaleToEquityCap,
    ]
  );

  return <CapitalAllocationContext.Provider value={value}>{children}</CapitalAllocationContext.Provider>;
};

export const useCapitalAllocation = (): CapitalAllocationContextType => {
  const ctx = useContext(CapitalAllocationContext);
  if (!ctx) {
    return {
      config: DEFAULT_CONFIG,
      riskSettings: toRiskSettingsObject(DEFAULT_CONFIG),
      sizingMethod: DEFAULT_CONFIG.sizingMethod,
      lotSizingMode: DEFAULT_CONFIG.lotSizingMode,
      fixedLot: DEFAULT_CONFIG.defaultLotSize,
      defaultLotSize: DEFAULT_CONFIG.defaultLotSize,
      fixedRiskUsd: DEFAULT_CONFIG.fixedRiskUsd,
      equityPercent: DEFAULT_CONFIG.equityPercent,
      maxRiskPerTradePct: DEFAULT_CONFIG.maxRiskPerTradePct,
      maxDailyLossPct: DEFAULT_CONFIG.maxDailyLossPct,
      leverage: DEFAULT_CONFIG.globalLeverage,
      globalLeverage: DEFAULT_CONFIG.globalLeverage,
      defaultLeverage: DEFAULT_CONFIG.globalLeverage,
      maxLeverageCap: DEFAULT_CONFIG.maxLeverageCap,
      marginMode: DEFAULT_CONFIG.marginMode,
      leverageSyncLocked: DEFAULT_CONFIG.leverageSyncLocked,
      lastServerSyncAt: null,
      setSizingMethod: () => {},
      setLotSizingMode: () => {},
      setFixedLot: () => {},
      setDefaultLotSize: () => {},
      setFixedRiskUsd: () => {},
      setEquityPercent: () => {},
      setMaxRiskPerTradePct: () => {},
      setMaxDailyLossPct: () => {},
      setLeverage: () => {},
      setGlobalLeverage: () => {},
      setMaxLeverageCap: () => {},
      setMarginMode: () => {},
      setLeverageSyncLocked: () => {},
      applyGlobalLeverageConfig: () => {},
      updateRiskSettings: () => {},
      hydrateFromServerConfig: () => {},
      clampLeverage: (lev) =>
        Math.max(1, Math.min(DEFAULT_CONFIG.maxLeverageCap, Math.round(lev || DEFAULT_CONFIG.globalLeverage))),
      getContractUnitValue: getContractUnitForSymbol,
      getContractsCount: getContractsForLot,
      resolveSafeExecutionLot: (p) => {
        const unit = getContractUnitForSymbol(p.symbol);
        const lot = DEFAULT_CONFIG.defaultLotSize;
        const cts = Math.max(1, Math.round(lot / unit));
        return {
          lotSize: lot,
          requestedLotSize: lot,
          contracts: cts,
          requestedContracts: cts,
          contractUnit: unit,
          lotSizingMode: 'FIXED_LOT',
          estimatedMarginUsd: +((lot * (p.markPrice || 65000)) / (p.leverage || 10)).toFixed(2),
          estimatedRiskUsd: +(lot * (p.stopLossDistance || 300)).toFixed(2),
          maxAllowedRiskUsd: 0,
          wasClamped: false,
        };
      },
      calculateLotSize: () => DEFAULT_CONFIG.defaultLotSize,
      getMarginRequirement: (lot, price, lev) => (lot * price) / (lev || 10),
      getPointValue: (lot) => lot,
      getLadderPayouts: () => ({ tp1Payout: 12.5, tp2Payout: 25.0, tp3Payout: 37.5, tp4Payout: 50.0 }),
      autoFitLotToMaxMargin: () => DEFAULT_CONFIG.defaultLotSize,
      autoScaleToEquityCap: (p) => {
        const lev = p.leverage || 10;
        const lot = DEFAULT_CONFIG.defaultLotSize;
        const unit = getContractUnitForSymbol(p.symbol);
        const cts = Math.max(1, Math.round(lot / unit));
        return {
          lotSize: lot,
          contracts: cts,
          estimatedMarginUsd: +((lot * p.markPrice) / lev).toFixed(2),
          maxAllowedMarginUsd: +((p.availableBalance || 0) * (p.maxEquityPct ?? 0.95)).toFixed(2),
          wasScaled: false,
        };
      },
    };
  }
  return ctx;
};

export const useRiskSettings = useCapitalAllocation;
