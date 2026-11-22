import React, { useState } from 'react';
import { useAuth, isValidGoogleClientId } from '../context/AuthContext';
import { LogOut, UserCheck, ShieldCheck, Key, Check, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';

interface GoogleAuthWidgetProps {
  openSettings?: () => void;
  isCollapsed?: boolean;
}

export const GoogleAuthWidget: React.FC<GoogleAuthWidgetProps> = ({
  openSettings,
  isCollapsed = false,
}) => {
  const {
    user,
    isAuthenticated,
    logout,
    loginDemo,
    customClientId,
    setCustomClientId,
    hasValidClientId,
  } = useAuth();

  const [showClientIdInline, setShowClientIdInline] = useState(false);
  const [clientIdInput, setClientIdInput] = useState(customClientId || '');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSaveClientId = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = clientIdInput.trim();
    if (trimmed && !isValidGoogleClientId(trimmed)) {
      setErrorMsg('Must end with .apps.googleusercontent.com');
      return;
    }
    setErrorMsg(null);
    setCustomClientId(trimmed);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setShowClientIdInline(false);
    }, 1200);
  };

  const handleSignInWithGoogle = () => {
    if (hasValidClientId && typeof window !== 'undefined' && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt();
        return;
      } catch {
        // Fallback to inline demo or client ID config
      }
    }
    // Immediate 1-click sign-in as Dhanraj K when clicked in preview/sandbox environment
    loginDemo({ name: 'Dhanraj K', email: 'dhanrajk69@gmail.com' });
  };

  // Collapsed 64px sidebar icon view
  if (isCollapsed) {
    if (isAuthenticated && user) {
      return (
        <button
          type="button"
          onClick={openSettings}
          title={`Google Trader Identity: ${user.name} (${user.email}) — Click to open Settings`}
          className="w-full flex items-center justify-center p-1.5 rounded-lg bg-[#0D1327] border border-emerald-500/40 hover:border-emerald-400 transition cursor-pointer relative"
        >
          {user.picture ? (
            <img
              src={user.picture}
              alt={user.name}
              className="w-6 h-6 rounded-full object-cover ring-1 ring-emerald-400/60"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-emerald-600 to-cyan-500 flex items-center justify-center text-[10px] font-bold text-white">
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#080B17] absolute bottom-1 right-2" />
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={() => loginDemo({ name: 'Dhanraj K', email: 'dhanrajk69@gmail.com' })}
        title="Sign in with Google (Dhanraj K)"
        className="w-full flex items-center justify-center p-2 rounded-lg bg-[#0D1327] border border-cyan-500/40 hover:border-cyan-400 text-cyan-300 transition cursor-pointer"
      >
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      </button>
    );
  }

  // Expanded inline sidebar card (zero floating/clipped popovers)
  if (isAuthenticated && user) {
    return (
      <div className="panel-delta p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-300 truncate">
              Google Trader Identity
            </span>
          </div>
          <span className="badge-delta badge-delta-live">
            VERIFIED
          </span>
        </div>

        <div className="flex items-center gap-2.5 pt-0.5">
          <div className="relative shrink-0">
            {user.picture ? (
              <img
                src={user.picture}
                alt={user.name}
                className="w-8 h-8 rounded-full object-cover border border-emerald-400/60"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-600 to-cyan-500 flex items-center justify-center text-xs font-bold text-white border border-emerald-400/50">
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#0B1022] absolute -bottom-0.5 -right-0.5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white truncate">{user.name}</div>
            <div className="text-[10px] font-mono text-slate-400 truncate">{user.email}</div>
          </div>
        </div>

        <div className="pt-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={logout}
            className="btn-delta-sm btn-danger w-full"
          >
            <LogOut className="w-3 h-3 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-delta p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <UserCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-200 truncate">
            Google Trader Identity
          </span>
        </div>
        <span className="badge-delta badge-delta-standby">
          GUEST
        </span>
      </div>

      {/* Inline Sign in with Google Button */}
      <button
        type="button"
        onClick={handleSignInWithGoogle}
        className="btn-delta-sm w-full bg-white hover:bg-slate-100 text-slate-900 font-bold shadow-sm"
      >
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        <span>Sign in with Google</span>
      </button>

      {/* Inline Quick Demo Sign-In Button */}
      <button
        type="button"
        onClick={() => loginDemo({ name: 'Dhanraj K', email: 'dhanrajk69@gmail.com' })}
        className="btn-delta-sm btn-toggle-active w-full"
      >
        <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
        <span>Quick Demo Sign-In (Dhanraj K)</span>
      </button>

      {/* Optional Inline OAuth Client ID Accordion (No Floating Popover) */}
      <div className="pt-0.5">
        <button
          type="button"
          onClick={() => setShowClientIdInline((prev) => !prev)}
          className="w-full flex items-center justify-between text-[9px] font-mono text-slate-400 hover:text-cyan-300 transition cursor-pointer px-0.5"
        >
          <span className="flex items-center gap-1">
            <Key className="w-2.5 h-2.5 text-slate-500" />
            <span>{hasValidClientId ? 'OAuth Client ID Configured' : 'Custom Google Client ID'}</span>
          </span>
          {showClientIdInline ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>

        {showClientIdInline && (
          <form onSubmit={handleSaveClientId} className="mt-1.5 space-y-1.5">
            <input
              type="text"
              value={clientIdInput}
              onChange={(e) => {
                setClientIdInput(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="12345-abc.apps.googleusercontent.com"
              className="w-full px-2 py-1 bg-slate-950 border border-slate-800 rounded-lg text-[10px] text-white font-mono focus:outline-none focus:border-cyan-500"
            />
            {errorMsg && <div className="text-[9px] text-rose-400">{errorMsg}</div>}
            <button
              type="submit"
              className="btn-delta-sm btn-secondary w-full"
            >
              {savedSuccess ? (
                <>
                  <Check className="w-2.5 h-2.5 text-emerald-400" />
                  <span className="text-emerald-300">Saved</span>
                </>
              ) : (
                <span>Save Client ID</span>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
