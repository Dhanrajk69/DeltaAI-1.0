import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Crosshair,
  Sliders,
  Cpu,
  Activity,
  BarChart3,
  History,
  ShieldAlert,
  Settings,
} from 'lucide-react';

export type DeltaNavId =
  | 'dashboard'
  | 'strategies'
  | 'options-lab'
  | 'ai-centre'
  | 'markets'
  | 'performance'
  | 'positions'
  | 'risk'
  | 'settings';

export type DeltaBadgeVariant =
  | 'live'
  | 'paper'
  | 'armed'
  | 'warning'
  | 'danger'
  | 'standby';

export interface DeltaNavItem {
  id: DeltaNavId;
  label: string;
  icon: LucideIcon;
  badge?: string;
  badgeVariant?: DeltaBadgeVariant;
}

/**
 * Single source of truth for primary navigation across Desktop Left Sidebar,
 * Slide-Over Mobile Drawer, and Android Bottom Navigation Bar.
 */
export const DELTA_NAV_ITEMS: DeltaNavItem[] = [
  {
    id: 'dashboard',
    label: 'Trading Desk',
    icon: LayoutDashboard,
    badge: 'LIVE',
    badgeVariant: 'live',
  },
  {
    id: 'strategies',
    label: 'Camarilla Sniper',
    icon: Crosshair,
    badge: 'SNIPER',
    badgeVariant: 'armed',
  },
  {
    id: 'options-lab',
    label: 'Options Lab',
    icon: Sliders,
    badge: 'OPT',
    badgeVariant: 'armed',
  },
  {
    id: 'ai-centre',
    label: 'AI Command',
    icon: Cpu,
    badge: '23-AI',
    badgeVariant: 'armed',
  },
  {
    id: 'markets',
    label: 'Markets & Risk',
    icon: Activity,
    badge: 'FEED',
    badgeVariant: 'standby',
  },
  {
    id: 'performance',
    label: 'Analytics & PnL',
    icon: BarChart3,
    badge: 'PNL',
    badgeVariant: 'armed',
  },
  {
    id: 'positions',
    label: 'Positions & Fills',
    icon: History,
    badgeVariant: 'live',
  },
  {
    id: 'risk',
    label: 'Risk Settings',
    icon: ShieldAlert,
    badge: 'GATES',
    badgeVariant: 'danger',
  },
  {
    id: 'settings',
    label: 'Settings & Keys',
    icon: Settings,
    badge: 'CONFIG',
    badgeVariant: 'armed',
  },
];

export function resolveActiveNavId(params: {
  currentTab: string;
  isSettingsOpen?: boolean;
  activeStrategySubTab?: 'SNIPER' | 'OPTIONS' | 'COMBINED';
}): DeltaNavId {
  if (params.isSettingsOpen) return 'settings';
  if (params.currentTab === 'dashboard' || params.currentTab === 'terminal') return 'dashboard';
  if (params.currentTab === 'strategies') {
    return params.activeStrategySubTab === 'OPTIONS' ? 'options-lab' : 'strategies';
  }
  if (
    params.currentTab === 'ai-centre' ||
    params.currentTab === 'markets' ||
    params.currentTab === 'performance' ||
    params.currentTab === 'positions' ||
    params.currentTab === 'risk'
  ) {
    return params.currentTab;
  }
  return 'dashboard';
}
