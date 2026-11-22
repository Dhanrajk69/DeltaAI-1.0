import { isGlobalAudioMuted } from '../hooks/useSoundEffects';

export const AI_VOICE_URI_STORAGE_KEY = 'delta_ai_voice_uri';
export const VOICE_ENABLED_STORAGE_KEY = 'delta_voice_assistant_enabled';
export const VOICE_SETTINGS_EVENT = 'delta-voice-settings-changed';
export const VOICE_ACTIVATED_PHRASE = 'DeltaAI voice alerts activated';

export const VOICE_DEDUPE_COOLDOWN_MS = 45_000;

export const DEFAULT_VOICE_CADENCE = {
  pitch: 1.0,
  rate: 1.02,
  volume: 1,
} as const;

export interface VoiceAlertOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  force?: boolean;
  eventKey?: string;
  bypassCooldown?: boolean;
  onEnd?: () => void;
}

/**
 * Deduplication cache keyed by normalized message text (`text:...`) and optional
 * unique `eventKey` (`event:...`) mapped to last spoken timestamp (ms).
 */
export const recentlySpokenMap = new Map<string, number>();

const NATURAL_ENGLISH_TOKENS = ['natural', 'female', 'woman', 'aria', 'jenny', 'samantha', 'zira', 'heera', 'neerja', 'raveena', 'google'];

/**
 * Strong references to active SpeechSynthesisUtterance instances until onend/onerror
 * so Chromium garbage collection never cancels speech mid-sentence.
 */
export const activeUtterances = new Set<SpeechSynthesisUtterance>();

let cachedResolvedVoice: SpeechSynthesisVoice | null = null;
let voicesChangedBound = false;
let autoplayUnlockBound = false;
let autoplayUnlocked = false;
let activeUtteranceToken = 0;

function normalizeLang(lang?: string): string {
  return (lang || '').replace('_', '-').toLowerCase();
}

function isPreferredEnglishLocale(lang?: string): boolean {
  const norm = normalizeLang(lang);
  return norm.startsWith('en-in') || norm.startsWith('en-us');
}

function isTargetEnglishLocale(lang?: string): boolean {
  const norm = normalizeLang(lang);
  return norm.startsWith('en-in') || norm.startsWith('en-us') || norm.startsWith('en-gb');
}

function isAnyEnglish(lang?: string): boolean {
  return normalizeLang(lang).startsWith('en');
}

export function isVoiceAlertsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (isGlobalAudioMuted()) return false;
  try {
    return localStorage.getItem(VOICE_ENABLED_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function persistSelectedVoiceUri(voice: SpeechSynthesisVoice | null): void {
  if (!voice?.voiceURI || typeof window === 'undefined') return;
  try {
    localStorage.setItem(AI_VOICE_URI_STORAGE_KEY, voice.voiceURI);
  } catch {}
}

/**
 * Resolves an explicit English voice (`en-IN` or `en-US` prioritized, natural voices first).
 */
export function resolvePreferredEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!Array.isArray(voices) || voices.length === 0) return null;

  const byName = (v: SpeechSynthesisVoice) => (v.name || '').toLowerCase();

  // Tier 1: High-clarity en-IN / en-US voices
  const tier1 =
    voices.find((v) => normalizeLang(v.lang).startsWith('en-in') && NATURAL_ENGLISH_TOKENS.some((t) => byName(v).includes(t))) ||
    voices.find((v) => byName(v).includes('google us english')) ||
    voices.find((v) => byName(v).includes('microsoft aria online')) ||
    voices.find((v) => byName(v).includes('microsoft jenny online')) ||
    voices.find((v) => byName(v).includes('microsoft neerja')) ||
    voices.find((v) => byName(v).includes('microsoft heera')) ||
    voices.find((v) => byName(v).includes('microsoft zira'));
  if (tier1) return tier1;

  // Tier 2: Any en-IN or en-US voice
  const tier2 =
    voices.find((v) => normalizeLang(v.lang).startsWith('en-in')) ||
    voices.find((v) => normalizeLang(v.lang).startsWith('en-us'));
  if (tier2) return tier2;

  // Tier 3: Natural en-GB / en voice
  const tier3 =
    voices.find((v) => byName(v).includes('google uk english female')) ||
    voices.find((v) => isAnyEnglish(v.lang) && NATURAL_ENGLISH_TOKENS.some((t) => byName(v).includes(t)));
  if (tier3) return tier3;

  // Tier 4: Previously persisted voice URI if valid English
  try {
    const savedUri = localStorage.getItem(AI_VOICE_URI_STORAGE_KEY);
    if (savedUri) {
      const savedMatch = voices.find((v) => v.voiceURI === savedUri && isAnyEnglish(v.lang));
      if (savedMatch) return savedMatch;
    }
  } catch {}

  return (
    voices.find((v) => isPreferredEnglishLocale(v.lang)) ||
    voices.find((v) => isTargetEnglishLocale(v.lang)) ||
    voices.find((v) => isAnyEnglish(v.lang)) ||
    null
  );
}

function bindVoicesChangedListener(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !window.speechSynthesis) {
    return null;
  }

  const synth = window.speechSynthesis;
  const refreshVoice = () => {
    try {
      const voices = synth.getVoices();
      const resolved = resolvePreferredEnglishVoice(voices);
      if (resolved) {
        cachedResolvedVoice = resolved;
        persistSelectedVoiceUri(resolved);
      }
      return resolved;
    } catch {
      return cachedResolvedVoice;
    }
  };

  if (!voicesChangedBound) {
    voicesChangedBound = true;
    try {
      synth.addEventListener?.('voiceschanged', refreshVoice);
      const prevOnVoicesChanged = synth.onvoiceschanged;
      synth.onvoiceschanged = (ev) => {
        refreshVoice();
        if (typeof prevOnVoicesChanged === 'function') {
          prevOnVoicesChanged.call(synth, ev);
        }
      };
    } catch {}
  }

  return refreshVoice();
}

/**
 * Registers a one-time global `pointerdown` / `keydown` listener on `window`
 * that silently warms up `window.speechSynthesis` on the user's first interaction
 * anywhere in the app so Chrome autoplay blocks never silence automated trade alerts.
 */
export function ensureVoiceAutoplayUnlock(): void {
  if (typeof window === 'undefined' || autoplayUnlockBound || autoplayUnlocked) return;
  if (!('speechSynthesis' in window) || !window.speechSynthesis) return;

  autoplayUnlockBound = true;
  bindVoicesChangedListener();

  const cleanup = () => {
    window.removeEventListener('pointerdown', handleFirstUserGesture, true);
    window.removeEventListener('keydown', handleFirstUserGesture, true);
  };

  function handleFirstUserGesture() {
    if (autoplayUnlocked) {
      cleanup();
      return;
    }
    autoplayUnlocked = true;
    cleanup();

    try {
      const synth = window.speechSynthesis;
      bindVoicesChangedListener();

      // Silently unlock browser audio once without calling speechSynthesis.resume() on clicks
      if (!synth.speaking && !synth.pending) {
        const warmup = new SpeechSynthesisUtterance('');
        const voice = cachedResolvedVoice || resolvePreferredEnglishVoice(synth.getVoices());
        if (voice) {
          warmup.voice = voice;
          warmup.lang = voice.lang || 'en-US';
        } else {
          warmup.lang = 'en-US';
        }
        warmup.volume = 0;
        warmup.rate = DEFAULT_VOICE_CADENCE.rate;
        warmup.pitch = DEFAULT_VOICE_CADENCE.pitch;

        activeUtterances.add(warmup);
        const release = () => {
          activeUtterances.delete(warmup);
        };
        warmup.onend = release;
        warmup.onerror = release;

        synth.speak(warmup);
      }
    } catch {
      // Non-fatal in headless or restricted environments
    }
  }

  window.addEventListener('pointerdown', handleFirstUserGesture, { once: true, capture: true });
  window.addEventListener('keydown', handleFirstUserGesture, { once: true, capture: true });
}

if (typeof window !== 'undefined') {
  ensureVoiceAutoplayUnlock();
}

export function clearVoiceAlertQueue(): void {
  activeUtteranceToken += 1;
  activeUtterances.clear();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

/**
 * Chrome-safe Web Speech API broadcaster with single-shot eventKey + 45s text cooldown:
 * - Ignores duplicate `eventKey` calls permanently within session
 * - Ignores identical normalized `text` spoken within the last 45 seconds (unless `bypassCooldown`)
 * - Calls `speechSynthesis.cancel()` and `speechSynthesis.resume()` before `speak()`
 * - Resolves an explicit `en-IN` / `en-US` English voice
 * - Uses `volume = 1`, `rate = 1.02`, `pitch = 1.0`
 * - Retains the `SpeechSynthesisUtterance` instance until `onend`/`onerror` against Chrome GC
 */
export function speakVoiceAlert(
  text: string,
  eventKeyOrOptions?: string | VoiceAlertOptions,
  maybeOptions?: VoiceAlertOptions
): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !window.speechSynthesis) {
    return false;
  }

  const options: VoiceAlertOptions =
    typeof eventKeyOrOptions === 'string'
      ? { ...(maybeOptions || {}), eventKey: eventKeyOrOptions }
      : (eventKeyOrOptions || maybeOptions || {});

  const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) return false;
  if (!options.force && !isVoiceAlertsEnabled()) return false;

  const now = Date.now();
  const normalizedTextKey = `text:${cleanText.toLowerCase()}`;
  const rawEventKey = options.eventKey ? String(options.eventKey).trim() : '';
  const eventMapKey = rawEventKey ? `event:${rawEventKey}` : '';

  if (!options.bypassCooldown) {
    if (eventMapKey && recentlySpokenMap.has(eventMapKey)) {
      return false;
    }
    const lastSpokenAt = recentlySpokenMap.get(normalizedTextKey);
    if (lastSpokenAt !== undefined && now - lastSpokenAt < VOICE_DEDUPE_COOLDOWN_MS) {
      return false;
    }
  }

  // Prune expired text cooldown entries while preserving eventKey records
  for (const [k, ts] of recentlySpokenMap.entries()) {
    if (k.startsWith('text:') && now - ts >= VOICE_DEDUPE_COOLDOWN_MS) {
      recentlySpokenMap.delete(k);
    }
  }

  recentlySpokenMap.set(normalizedTextKey, now);
  if (eventMapKey) {
    recentlySpokenMap.set(eventMapKey, now);
  }

  try {
    ensureVoiceAutoplayUnlock();
    const synth = window.speechSynthesis;

    activeUtteranceToken += 1;
    const myToken = activeUtteranceToken;

    // Reset any stuck Chromium queue before dispatching the new utterance
    synth.cancel();
    synth.resume();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = synth.getVoices();
    const voice = resolvePreferredEnglishVoice(voices) || cachedResolvedVoice || bindVoicesChangedListener();

    if (voice) {
      cachedResolvedVoice = voice;
      utterance.voice = voice;
      utterance.lang = voice.lang || 'en-US';
      persistSelectedVoiceUri(voice);
    } else {
      utterance.lang = 'en-US';
    }

    utterance.volume = options.volume ?? DEFAULT_VOICE_CADENCE.volume;
    utterance.rate = options.rate ?? DEFAULT_VOICE_CADENCE.rate;
    utterance.pitch = options.pitch ?? DEFAULT_VOICE_CADENCE.pitch;

    activeUtterances.add(utterance);

    let finished = false;
    const handleDone = (invokeCallback: boolean) => {
      activeUtterances.delete(utterance);
      if (finished || myToken !== activeUtteranceToken) return;
      finished = true;
      if (invokeCallback) {
        options.onEnd?.();
      }
    };

    utterance.onend = () => handleDone(true);
    utterance.onerror = (ev) => {
      const canceled = ev?.error === 'canceled' || ev?.error === 'interrupted';
      handleDone(!canceled);
    };

    synth.speak(utterance);
    return true;
  } catch (err) {
    console.warn('[VoiceAlert] SpeechSynthesis error:', err);
    return false;
  }
}

export function announceVoiceActivated(): boolean {
  autoplayUnlocked = true;
  return speakVoiceAlert(VOICE_ACTIVATED_PHRASE, { force: true, bypassCooldown: true });
}

export function formatVoiceSymbol(symbol: string): string {
  const raw = String(symbol || 'BTCUSDT').trim().toUpperCase();
  if (raw.startsWith('BTC')) return 'BTC';
  if (raw.startsWith('ETH')) return 'ETH';
  if (raw.startsWith('SOL')) return 'SOL';
  return raw.replace(/USDT$|USD$/i, '') || raw;
}

export function formatVoicePrice(price?: number): string {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return '0';
  if (price >= 100) return Math.round(price).toLocaleString('en-US');
  if (price >= 1) {
    return Number(price.toFixed(2)).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  return Number(price.toFixed(4)).toString();
}
