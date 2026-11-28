import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface GoogleUser {
  sub: string;
  name: string;
  email: string;
  picture: string;
  givenName?: string;
  familyName?: string;
  emailVerified?: boolean;
}

export interface AuthContextType {
  isAuthenticated: boolean;
  user: GoogleUser | null;
  token: string | null;
  clientId: string;
  customClientId: string;
  setCustomClientId: (clientId: string) => void;
  hasValidClientId: boolean;
  isGsiLoaded: boolean;
  loginWithCredential: (credential: string) => void;
  loginDemo: (userOverride?: Partial<GoogleUser>) => void;
  logout: () => void;
  renderGoogleButton: (elementId: string) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: any) => void;
          renderButton: (parent: HTMLElement, options: any) => void;
          prompt: (notification?: (notification: any) => void) => void;
          disableAutoSelect: () => void;
          revoke: (hint: string, done: () => void) => void;
        };
      };
    };
  }
}

export const STORAGE_KEY_CUSTOM_CLIENT_ID = 'delta_google_oauth_client_id_v1';

/**
 * Validates that a Google OAuth Web Client ID is present, non-empty,
 * ends with `.apps.googleusercontent.com`, and is not a placeholder value.
 */
export function isValidGoogleClientId(rawClientId?: string | null): boolean {
  if (typeof rawClientId !== 'string') return false;
  const trimmed = rawClientId.trim();
  if (!trimmed) return false;
  const suffix = '.apps.googleusercontent.com';
  if (!trimmed.endsWith(suffix)) return false;

  const prefix = trimmed.slice(0, -suffix.length);
  if (prefix.length < 12) return false;

  const lower = trimmed.toLowerCase();
  const invalidPlaceholders = [
    '548484550990-delta-crypto.apps.googleusercontent.com',
    'delta-crypto',
    'placeholder',
    'your_google_client_id',
    'your-google-client-id',
    'your_client_id',
    'your-client-id',
    'example',
    'demo',
    'xxxxx',
    '<',
    '>',
  ];
  if (invalidPlaceholders.some((token) => lower.includes(token))) {
    return false;
  }

  // Standard Google Cloud Web Client IDs start with numeric project number followed by '-' and alphanumeric hash
  return /^\d{6,}-[a-z0-9_-]{8,}$/i.test(prefix);
}

const RAW_ENV_GOOGLE_CLIENT_ID =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID
    ? String(import.meta.env.VITE_GOOGLE_CLIENT_ID).trim()
    : '';

export const GOOGLE_CLIENT_ID = isValidGoogleClientId(RAW_ENV_GOOGLE_CLIENT_ID)
  ? RAW_ENV_GOOGLE_CLIENT_ID
  : '';

const STORAGE_KEY_USER = 'delta_auth_user_v1';
const STORAGE_KEY_TOKEN = 'delta_auth_token_v1';

/**
 * Decodes standard JWT ID token payload safely with UTF-8 character support
 */
export function decodeJwtPayload(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (err) {
    console.warn('[AuthContext] JWT decode warning:', err);
    return null;
  }
}

const DEFAULT_LOCAL_USER: GoogleUser = {
  sub: 'admin-dhanrajk69-uid',
  name: 'Dhanraj K',
  email: 'dhanrajk69@gmail.com',
  picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
  givenName: 'Dhanraj',
  familyName: 'K',
  emailVerified: true,
};
const DEFAULT_LOCAL_TOKEN = 'admin-local-session-dhanrajk69-token';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<GoogleUser | null>(DEFAULT_LOCAL_USER);
  const [token, setToken] = useState<string | null>(DEFAULT_LOCAL_TOKEN);
  const [customClientId, setCustomClientIdState] = useState<string>('');
  const [isGsiLoaded, setIsGsiLoaded] = useState<boolean>(false);

  const setCustomClientId = useCallback((nextId: string) => {
    const trimmed = (nextId || '').trim();
    setCustomClientIdState(trimmed);
  }, []);

  const activeClientId = isValidGoogleClientId(customClientId)
    ? customClientId.trim()
    : GOOGLE_CLIENT_ID;
  const hasValidClientId = Boolean(activeClientId && isValidGoogleClientId(activeClientId));

  // Keep session state strictly in React memory (never persisted to localStorage)
  const saveSession = useCallback((newUser: GoogleUser | null, newToken: string | null) => {
    setUser(newUser);
    setToken(newToken);
  }, []);

  // Handle Google Credential Response (JWT token from Google Identity Services)
  const loginWithCredential = useCallback((credential: string) => {
    if (!credential) return;
    const payload = decodeJwtPayload(credential);
    if (!payload || !payload.sub) {
      console.error('[AuthContext] Invalid Google credential token');
      return;
    }

    const googleUser: GoogleUser = {
      sub: payload.sub,
      name: payload.name || payload.given_name || 'Delta Trader',
      email: payload.email || 'trader@delta.exchange',
      picture: payload.picture || '',
      givenName: payload.given_name,
      familyName: payload.family_name,
      emailVerified: Boolean(payload.email_verified),
    };

    saveSession(googleUser, credential);
  }, [saveSession]);

  // Demo sign-in fallback (ensures preview works seamlessly in Local Session Mode without triggering Error 401: invalid_client)
  const loginDemo = useCallback((userOverride?: Partial<GoogleUser>) => {
    const demoUser: GoogleUser = {
      sub: 'google-sub-demo-777',
      name: userOverride?.name || 'Dhanraj K',
      email: userOverride?.email || 'dhanrajk69@gmail.com',
      picture: userOverride?.picture || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
      givenName: 'Dhanraj',
      familyName: 'K',
      emailVerified: true,
      ...userOverride,
    };
    const syntheticJwt = `header.${btoa(JSON.stringify(demoUser))}.signature`;
    saveSession(demoUser, syntheticJwt);
  }, [saveSession]);

  // Logout handler
  const logout = useCallback(() => {
    try {
      if (hasValidClientId && typeof window !== 'undefined' && window.google?.accounts?.id?.disableAutoSelect) {
        window.google.accounts.id.disableAutoSelect();
      }
    } catch {}
    setUser(null);
    setToken(null);
  }, [hasValidClientId]);

  // Initialize Google Identity Services ONLY when a valid Google Client ID is configured
  useEffect(() => {
    if (!hasValidClientId || !activeClientId) {
      setIsGsiLoaded(false);
      return;
    }

    let checkTimer: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;

    const checkGsi = () => {
      attempts += 1;
      if (typeof window !== 'undefined' && window.google?.accounts?.id) {
        try {
          window.google.accounts.id.initialize({
            client_id: activeClientId,
            callback: (res: { credential?: string }) => {
              if (res?.credential) {
                loginWithCredential(res.credential);
              }
            },
            auto_select: false,
            cancel_on_tap_outside: true,
            use_fedcm_for_prompt: false,
          });
          setIsGsiLoaded(true);
        } catch {
          setIsGsiLoaded(false);
        }
        if (checkTimer) {
          clearInterval(checkTimer);
          checkTimer = null;
        }
      } else if (attempts >= 20 && checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
      }
    };

    checkGsi();
    if (!(typeof window !== 'undefined' && window.google?.accounts?.id)) {
      checkTimer = setInterval(checkGsi, 500);
    }

    return () => {
      if (checkTimer) clearInterval(checkTimer);
    };
  }, [activeClientId, hasValidClientId, loginWithCredential]);

  // Helper to render official Google Identity Services button onto a DOM container ONLY when a valid Client ID is present
  const renderGoogleButton = useCallback((elementId: string) => {
    if (!hasValidClientId || !activeClientId) return;
    if (typeof window !== 'undefined' && window.google?.accounts?.id) {
      const container = document.getElementById(elementId);
      if (container) {
        try {
          container.innerHTML = '';
          window.google.accounts.id.renderButton(container, {
            theme: 'filled_black',
            size: 'medium',
            text: 'signin_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: 190,
          });
        } catch {
          // Benign GSI renderButton fallback in restricted frames
        }
      }
    }
  }, [activeClientId, hasValidClientId]);

  const value: AuthContextType = {
    isAuthenticated: Boolean(user && token),
    user,
    token,
    clientId: activeClientId,
    customClientId,
    setCustomClientId,
    hasValidClientId,
    isGsiLoaded,
    loginWithCredential,
    loginDemo,
    logout,
    renderGoogleButton,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
