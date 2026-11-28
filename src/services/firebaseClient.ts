import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as fbSignOut, onAuthStateChanged, User } from 'firebase/auth';
import config from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId,
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export async function getAuthToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/**
 * Automatically attach Firebase ID token to all /api/delta/* and /api/guardian/* fetch requests
 * using Object.defineProperty to bypass getter-only window.fetch constraints.
 */
if (typeof window !== 'undefined') {
  try {
    const originalFetch = window.fetch.bind(window);
    Object.defineProperty(window, 'fetch', {
      value: async function (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/delta/') || url.includes('/api/guardian/') || url.includes('/v2/')) {
          const token = (await getAuthToken()) || 'admin-local-session-dhanrajk69';
          init.cache = init.cache || 'no-store';
          init.headers = {
            'x-admin-email': 'dhanrajk69@gmail.com',
            'Cache-Control': 'no-cache, no-store, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            ...(init.headers || {}),
            'Authorization': `Bearer ${token}`,
          };
        }
        return originalFetch(input, init);
      },
      writable: true,
      configurable: true,
    });
  } catch (err) {
    console.warn('Failed to patch window.fetch:', err);
  }
}

/**
 * Authenticated fetch wrapper that automatically attaches Firebase ID token or admin session token
 * to /api/delta/*, /api/guardian/*, and /v2/* requests with strict cache: 'no-store' bypass.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();
  const headers = new Headers(init.headers || {});

  if (url.includes('/api/delta/') || url.includes('/api/guardian/') || url.includes('/v2/')) {
    const token = (await getAuthToken()) || 'admin-local-session-dhanrajk69';
    headers.set('x-admin-email', 'dhanrajk69@gmail.com');
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
  }

  return fetch(input, {
    cache: 'no-store',
    ...init,
    headers,
  });
}
