import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-full bg-amber-500/95 text-slate-950 font-bold px-4 py-2 text-xs shadow-2xl backdrop-blur-md border border-amber-400 animate-bounce">
      <WifiOff className="w-4 h-4 text-slate-950 shrink-0" />
      <span>Android Offline Mode · Local Risk Engine Active</span>
      <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 text-slate-900" />
    </div>
  );
};
