/**
 * Client-side security utilities and helpers for credential handling,
 * key masking, and safe session state management.
 */

export function maskApiKey(val: string | undefined | null): string {
  if (!val || typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (trimmed.length <= 4) return '****';
  return `****${trimmed.slice(-4)}`;
}

export function isValidDeltaCredentialFormat(key: string, secret: string): boolean {
  const cleanKey = (key || '').trim();
  const cleanSecret = (secret || '').trim();

  return (
    cleanKey.length >= 8 &&
    !cleanKey.toLowerCase().startsWith('demo_') &&
    cleanSecret.length >= 8 &&
    !cleanSecret.toLowerCase().startsWith('demo_')
  );
}

export interface SessionAuthInfo {
  token: string;
  sessionId: string;
  expiresAt: number;
  serverLiveGateEnabled: boolean;
  liveTradingReady: boolean;
}
