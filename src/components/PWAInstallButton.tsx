import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Smartphone, Download, X } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface PWAInstallButtonProps {}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running in standalone PWA mode, show subtle badge
  if (isInstalled) {
    return (
      <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 rounded">
        <Smartphone className="w-3 h-3 text-emerald-400" />
        <span>PWA Installed</span>
      </div>
    );
  }

  if (!isInstallable && !isIOS) return null;

  const handleInstallClick = async () => {
    triggerHaptic('medium');
    if (isInstallable) {
      const res = await install();
      if (res) triggerHaptic('success');
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  return (
    <>
      <button
        onClick={handleInstallClick}
        className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-semibold text-emerald-300 bg-emerald-950/70 border border-emerald-700/80 rounded hover:bg-emerald-900/70 hover:border-emerald-600 transition-colors whitespace-nowrap cursor-pointer shadow-sm shadow-emerald-950/50"
        title="Install Web App to Home Screen"
      >
        <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">App</span>
        <Download className="w-3 h-3 text-emerald-400 hidden sm:inline" />
      </button>

      {/* iOS Safari Fallback Guide */}
      {isIOS && showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-lg bg-slate-900 border border-slate-700 p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Install on iPhone / iPad</h3>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 text-xs text-slate-300 space-y-2 leading-relaxed">
              <p>1. Open Safari and tap the <strong>Share</strong> icon on the bottom toolbar.</p>
              <p>2. Scroll down and select <strong>Add to Home Screen</strong>.</p>
              <p>3. Tap <strong>Add</strong> in the top right to install DeltaAI as a standalone mobile terminal.</p>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-4 w-full rounded bg-slate-800 py-2 text-xs font-medium text-white hover:bg-slate-700"
            >
              Close Guide
            </button>
          </div>
        </div>
      )}
    </>
  );
};
