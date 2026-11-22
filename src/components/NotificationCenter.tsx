import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AppNotification } from '../types';
import { X, Bell, CheckCheck, Trash2, Zap, ShieldAlert, Cpu, Info, Target } from 'lucide-react';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
  onNavigateToValidator?: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAllAsRead,
  onClearAll,
  onNavigateToValidator,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const getIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'TRADE':
        return <Zap className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'RISK':
        return <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'AI':
        return <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-slate-400 shrink-0" />;
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      {/* Click-outside backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Notification Menu / Drawer floating cleanly above Header & Chart */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Platform Notifications"
        className="relative z-[101] mt-[58px] mr-3 mb-3 max-h-[calc(100vh-70px)] w-full max-w-sm panel-delta rounded-2xl border-cyan-500/40 shadow-[0_18px_48px_rgba(0,0,0,0.85),0_0_24px_rgba(6,182,212,0.2)] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="panel-delta-header h-12 px-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-emerald-400" />
            <h2 className="panel-delta-title text-white normal-case tracking-normal">Platform Notifications</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-delta-sm btn-secondary px-2"
            aria-label="Close notifications"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Bar */}
        <div className="px-4 py-2 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono-numbers">
          <span>{notifications.length} events logged</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onMarkAllAsRead}
              className="btn-delta-sm btn-secondary"
              title="Mark all notifications as read"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark Read</span>
            </button>
            <button
              type="button"
              onClick={onClearAll}
              className="btn-delta-sm btn-danger"
              title="Clear notification list"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          </div>
        </div>

        {/* Notification List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2">
          {notifications.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-xs">
              No active notifications. Strategy events and fills will appear here.
            </div>
          ) : (
            notifications.map((n) => {
              const isConfluence = n.title.includes('CONFLUENCE') || n.message.includes('CONFLUENCE');
              return (
                <div
                  key={n.id}
                  className={`p-3 text-xs space-y-1.5 rounded-lg transition ${
                    n.read ? 'bg-transparent text-slate-400' : 'bg-slate-800/40 text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {getIcon(n.type)}
                    <span className="font-semibold text-white">{n.title}</span>
                    <span className="text-[10px] text-slate-500 ml-auto font-mono-numbers">
                      {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-300 pl-6">
                    {n.message}
                  </p>
                  {isConfluence && onNavigateToValidator && (
                    <div className="pl-6 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onNavigateToValidator();
                        }}
                        className="btn-delta-sm btn-primary"
                      >
                        <Target className="w-3 h-3" />
                        <span>Inspect AI Validator</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
