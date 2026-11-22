import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Volume2,
  VolumeX,
  X,
  Key,
  Lock,
  Unlock,
  Copy,
  Check,
  Bell,
  Wifi,
  Flame,
  Globe,
  ShieldAlert,
} from 'lucide-react';
import { DeltaApiCredentials, TradingMode } from '../types';
import { GoogleAuthWidget } from './GoogleAuthWidget';
import { copyToClipboard } from '../utils/clipboardUtils';
import { DELTA_NAV_ITEMS, DeltaNavId, resolveActiveNavId } from '../config/navigation';
import { DeltaBadge, DeltaButton } from './ui/DeltaSystem';

export interface DashdarkXSidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  activeStrategySubTab?: 'SNIPER' | 'OPTIONS' | 'COMBINED';
  isSettingsOpen?: boolean;
  onOpenOptionsLab?: () => void;
  positionsCount?: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  onOpenSettings?: () => void;
  onOpenKillSwitch?: () => void;
  soundMuted?: boolean;
  onToggleSound?: () => void;
  wsStatus?: string;
  wsLatency?: number;
  apiCredentials?: DeltaApiCredentials;
  isLiveApiAuthenticated?: boolean;
  serverLiveGateEnabled?: boolean;
  currency?: 'USD' | 'INR';
  onChangeCurrency?: (next: 'USD' | 'INR') => void;
  tradingMode?: TradingMode;
  setTradingMode?: (mode: TradingMode) => void;
  isServerLiveUnlocked?: boolean;
  serverIp?: string;
  onOpenWsModal?: () => void;
  unreadNotifications?: number;
  onOpenNotifications?: () => void;
}

export type DeltaAISidebarProps = DashdarkXSidebarProps;

export const DashdarkXSidebar: React.FC<DashdarkXSidebarProps> = ({
  currentTab,
  onSelectTab,
  activeStrategySubTab = 'SNIPER',
  isSettingsOpen = false,
  onOpenOptionsLab,
  positionsCount = 0,
  isCollapsed,
  onToggleCollapse,
  isOpenMobile = false,
  onCloseMobile,
  onOpenSettings,
  onOpenKillSwitch,
  soundMuted = false,
  onToggleSound,
  wsStatus = 'CONNECTED',
  wsLatency = 12,
  apiCredentials,
  isLiveApiAuthenticated = false,
  serverLiveGateEnabled = false,
  currency = 'USD',
  onChangeCurrency,
  tradingMode = 'PAPER',
  setTradingMode,
  isServerLiveUnlocked = false,
  serverIp = '34.47.205.98',
  onOpenWsModal,
  unreadNotifications = 0,
  onOpenNotifications,
}) => {
  const [isAccountStackOpen, setIsAccountStackOpen] = useState(true);
  const [copiedMobileIp, setCopiedMobileIp] = useState(false);

  const effectiveCollapsed = isOpenMobile ? false : isCollapsed;

  const handleCopyMobileServerIp = async () => {
    if (!serverIp) return;
    await copyToClipboard(serverIp);
    setCopiedMobileIp(true);
    setTimeout(() => setCopiedMobileIp(false), 1800);
  };

  const activeNavId = resolveActiveNavId({
    currentTab,
    isSettingsOpen,
    activeStrategySubTab,
  });

  const handleNavClick = (navId: DeltaNavId) => {
    if (navId === 'settings') {
      if (onOpenSettings) onOpenSettings();
    } else if (navId === 'options-lab') {
      if (onOpenOptionsLab) {
        onOpenOptionsLab();
      } else {
        onSelectTab('strategies');
      }
    } else {
      onSelectTab(navId);
    }
    if (onCloseMobile) onCloseMobile();
  };

  const handleTriggerSettingsModal = () => {
    if (onOpenSettings) onOpenSettings();
    if (onCloseMobile) onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 bg-[#080B17] border-r border-slate-800/80 flex flex-col justify-between transition-all duration-300 ease-in-out select-none shadow-[4px_0_24px_rgba(0,0,0,0.5)] lg:static lg:z-30 shrink-0 max-md:w-[285px] ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${effectiveCollapsed ? 'w-[64px]' : 'w-[256px]'}`}
      >
        {/* Top Header / Branding & Collapse Toggle */}
        <div className="p-3 border-b border-slate-800/80 flex items-center justify-between min-h-[52px]">
          <div
            onClick={() => handleNavClick('dashboard')}
            className={`flex items-center gap-2.5 cursor-pointer group ${
              effectiveCollapsed ? 'mx-auto' : ''
            }`}
            title="DeltaAI - Institutional Crypto Trading Platform"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 via-cyan-500 to-teal-400 p-[1.5px] shadow-[0_0_16px_rgba(6,182,212,0.35)] shrink-0 transition-transform group-hover:scale-105">
              <div className="w-full h-full bg-[#080B17] rounded-[6.5px] flex items-center justify-center">
                <span className="text-cyan-400 font-black text-sm font-mono">Δ</span>
              </div>
            </div>
            {!effectiveCollapsed && (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-extrabold text-sm tracking-tight text-white font-sans">
                  DeltaAI
                </span>
                <DeltaBadge variant="armed">INST</DeltaBadge>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close Navigation Drawer"
                className="btn-delta-sm btn-secondary !px-1.5 md:hidden"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hidden md:inline-flex btn-delta-sm btn-secondary !px-1.5"
              title={effectiveCollapsed ? 'Expand sidebar (256px)' : 'Collapse sidebar (64px)'}
            >
              {effectiveCollapsed ? (
                <ChevronRight className="w-4 h-4 text-cyan-400" />
              ) : (
                <ChevronLeft className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {/* Canonical 9-Item Navigation Rail + Self-Contained Account & Credentials Stack */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1 custom-scrollbar font-sans">
          {DELTA_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNavId === item.id;
            const badgeText =
              item.id === 'positions'
                ? positionsCount > 0
                  ? `${positionsCount}`
                  : undefined
                : item.badge;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                title={effectiveCollapsed ? `${item.label}${badgeText ? ` (${badgeText})` : ''}` : undefined}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center rounded-lg transition-all duration-150 cursor-pointer group ${
                  effectiveCollapsed
                    ? 'justify-center h-9 px-2'
                    : 'justify-between h-9 px-3 text-xs'
                } ${active ? 'nav-delta-active' : 'nav-delta-inactive'}`}
              >
                <div className={`flex items-center ${effectiveCollapsed ? 'justify-center' : 'gap-2.5 min-w-0'}`}>
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      active
                        ? 'text-cyan-300'
                        : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />
                  {!effectiveCollapsed && (
                    <span className="truncate text-xs font-semibold tracking-wide">
                      {item.label}
                    </span>
                  )}
                </div>

                {!effectiveCollapsed && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.id === 'dashboard' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]" />
                    )}
                    {badgeText && (
                      <DeltaBadge variant={item.badgeVariant || 'standby'}>
                        {badgeText}
                      </DeltaBadge>
                    )}
                  </div>
                )}
              </button>
            );
          })}

          {/* Mobile Drawer Quick Controls (< 768px only) */}
          <div className="md:hidden pt-2 mt-2 border-t border-slate-800/80 space-y-2">
            <div className="px-1 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
              Terminal Controls
            </div>

            {setTradingMode && (
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#040A20] border border-slate-800/80">
                <DeltaButton
                  size="sm"
                  variant={tradingMode === 'PAPER' ? 'toggle-active' : 'secondary'}
                  onClick={() => {
                    setTradingMode('PAPER');
                    if (onCloseMobile) onCloseMobile();
                  }}
                >
                  Paper Mode
                </DeltaButton>
                <DeltaButton
                  size="sm"
                  variant={
                    !isServerLiveUnlocked
                      ? 'secondary'
                      : tradingMode === 'LIVE'
                      ? 'primary'
                      : 'secondary'
                  }
                  onClick={() => {
                    if (!isServerLiveUnlocked) {
                      handleTriggerSettingsModal();
                      return;
                    }
                    setTradingMode('LIVE');
                    if (onCloseMobile) onCloseMobile();
                  }}
                >
                  {isServerLiveUnlocked ? (
                    <Flame className="w-3.5 h-3.5" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  <span>Live Mode</span>
                </DeltaButton>
              </div>
            )}

            {onChangeCurrency && (
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#040A20] border border-slate-800/80">
                <DeltaButton
                  size="sm"
                  variant={currency === 'USD' ? 'toggle-active' : 'secondary'}
                  onClick={() => onChangeCurrency('USD')}
                  className="font-mono"
                >
                  $ USD
                </DeltaButton>
                <DeltaButton
                  size="sm"
                  variant={currency === 'INR' ? 'toggle-active' : 'secondary'}
                  onClick={() => onChangeCurrency('INR')}
                  className="font-mono"
                >
                  ₹ INR
                </DeltaButton>
              </div>
            )}

            {onOpenNotifications && (
              <div className="grid grid-cols-1 gap-1.5">
                <DeltaButton
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onOpenNotifications();
                    if (onCloseMobile) onCloseMobile();
                  }}
                  className="font-mono text-cyan-200"
                >
                  <Bell className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>Alerts ({unreadNotifications > 0 ? unreadNotifications : 4})</span>
                </DeltaButton>
              </div>
            )}

            {serverIp && (
              <div className="px-2.5 py-2 rounded-lg bg-[#0B111E]/95 border border-slate-800/80 flex items-center justify-between gap-2 text-[11px] font-mono">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-slate-400 shrink-0">IPv4:</span>
                  <span className="text-white font-bold truncate">{serverIp}</span>
                </div>
                <DeltaButton
                  size="sm"
                  variant="secondary"
                  onClick={handleCopyMobileServerIp}
                >
                  {copiedMobileIp ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </DeltaButton>
              </div>
            )}
          </div>

          <div className="border-t border-slate-800/80 my-2" />

          {/* Account Identity Stack (Delta API Credentials live exclusively in Settings & Keys tab) */}
          {effectiveCollapsed ? (
            <div className="pt-1 space-y-1.5">
              <GoogleAuthWidget openSettings={handleTriggerSettingsModal} isCollapsed />
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setIsAccountStackOpen((prev) => !prev)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition cursor-pointer"
              >
                <span>Identity &amp; Session</span>
                {isAccountStackOpen ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {isAccountStackOpen && (
                <div className="space-y-2">
                  <GoogleAuthWidget openSettings={handleTriggerSettingsModal} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compact Bottom Drawer: Session Status, Sound Toggle, and Single Emergency Kill Switch */}
        <div className="p-2.5 border-t border-slate-800/80 bg-[#080B17]/95 space-y-2 pb-safe">
          <div
            className={`flex items-center ${
              effectiveCollapsed ? 'flex-col gap-2' : 'justify-between px-1'
            }`}
          >
            <div
              className={`flex items-center gap-1.5 font-mono text-[10px] text-slate-400 ${
                effectiveCollapsed ? 'justify-center' : ''
              }`}
              title={`Delta WebSocket Feed: ${wsStatus} (${wsLatency}ms)`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  wsStatus === 'CONNECTED'
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse'
                    : wsStatus === 'CONNECTING' || wsStatus === 'RECONNECTING'
                    ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                    : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'
                }`}
              />
              {!effectiveCollapsed && (
                <>
                  <span className="font-semibold text-slate-300">
                    {wsStatus === 'CONNECTED' ? 'FEED LIVE' : wsStatus}
                  </span>
                  <span className="text-cyan-400 font-bold">{wsLatency}ms</span>
                </>
              )}
            </div>

            {onToggleSound && (
              <button
                type="button"
                onClick={onToggleSound}
                className={`btn-delta-sm !px-2 ${soundMuted ? 'btn-secondary' : 'btn-toggle-active'}`}
                title={soundMuted ? 'Unmute terminal audio' : 'Mute terminal audio'}
              >
                {soundMuted ? (
                  <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-cyan-300" />
                )}
              </button>
            )}
          </div>

          {onOpenKillSwitch && (
            <button
              type="button"
              onClick={() => {
                onOpenKillSwitch();
                if (onCloseMobile) onCloseMobile();
              }}
              title="Emergency Kill Switch: immediately flatten all open positions and cancel pending orders"
              className={`w-full btn-delta btn-danger ${effectiveCollapsed ? '!px-0' : ''}`}
            >
              <ShieldAlert className="w-3.5 h-3.5 text-rose-300 shrink-0" />
              {!effectiveCollapsed && <span className="tracking-wide">Emergency Kill</span>}
            </button>
          )}
        </div>
      </aside>
    </>
  );
};

export const DeltaAISidebar = DashdarkXSidebar;
