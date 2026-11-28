import { useCallback, useEffect, useRef, useState } from 'react';
import { CamarillaLevels, MaSlopeData } from '../types';
import { GLOBAL_AUDIO_MUTE_EVENT, isGlobalAudioMuted } from './useSoundEffects';

import {
  AI_VOICE_URI_STORAGE_KEY,
  VOICE_ENABLED_STORAGE_KEY,
  VOICE_SETTINGS_EVENT,
  DEFAULT_VOICE_CADENCE,
  speakVoiceAlert,
  clearVoiceAlertQueue,
  ensureVoiceAutoplayUnlock,
  isVoiceAlertsEnabled,
  setVoiceAlertsEnabledMemory,
  resolvePreferredEnglishVoice,
  persistSelectedVoiceUri,
} from '../utils/voiceAlert';

export { AI_VOICE_URI_STORAGE_KEY, VOICE_ENABLED_STORAGE_KEY, VOICE_SETTINGS_EVENT };
export const TEST_SOFT_FEMALE_VOICE_PHRASE = 'DeltaAI voice alerts activated.';

export const SOFT_FEMALE_VOICE_CADENCE = DEFAULT_VOICE_CADENCE;

export interface AnnounceOptionsStrategyParams {
  intradayMode?: boolean;
  correlatedStrategyName: string;
  selectedStrategyName?: string;
  delta?: number;
  targetStrike?: number;
  strikeType?: 'Call' | 'Put' | string;
  signalSide?: 'LONG' | 'SHORT' | 'NEUTRAL' | string;
}

export interface DetailedSignalParams {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice?: number;
  stopLoss?: number;
  tp1?: number;
  convictionPct?: number;
  reason?: string;
  contextNote?: string;
  vwapPrice?: number;
  vwapDistanceUsd?: number;
  ema9?: number;
  ema21?: number;
  camarilla?: Partial<CamarillaLevels>;
  maSlopeData?: Partial<MaSlopeData>;
  sentimentScore?: number;
  overallSentiment?: string;
  dedupeKey?: string;
}

const ASSET_SPEECH_NAMES: Record<string, string> = {
  BTC: 'Bitcoin',
  ETH: 'Ethereum',
  SOL: 'Solana',
  XRP: 'XRP',
  DOGE: 'Dogecoin',
  BNB: 'BNB',
  AVAX: 'Avalanche',
  ADA: 'Cardano',
  MATIC: 'Polygon',
  LINK: 'Chainlink',
  DOT: 'Polkadot',
  LTC: 'Litecoin',
};

export const MAX_SIGNAL_ANNOUNCEMENTS = 3;
export const SIGNAL_REPEAT_PAUSE_MS = 8000;
export const SIGNAL_REPEAT_FALLBACK_MS = 15000;

let activeSignalKeyState = '';
let announcementCountState = 0;
let repeatTimerState: ReturnType<typeof setTimeout> | null = null;
let fallbackTimerState: ReturnType<typeof setTimeout> | null = null;
let signalGenerationState = 0;
let activeUtteranceToken = 0;

function isVoicePreferenceEnabled(): boolean {
  return isVoiceAlertsEnabled();
}

export function clearSignalVoiceRepeats(): void {
  signalGenerationState += 1;
  activeUtteranceToken += 1;
  if (repeatTimerState) {
    clearTimeout(repeatTimerState);
    repeatTimerState = null;
  }
  if (fallbackTimerState) {
    clearTimeout(fallbackTimerState);
    fallbackTimerState = null;
  }
  clearVoiceAlertQueue();
}

/**
 * Selects a natural-sounding female English SpeechSynthesisVoice by strict priority order:
 * 1. Google UK English Female / Google US English
 * 2. Microsoft Aria Online (Natural) / Microsoft Jenny Online (Natural) / Microsoft Zira
 * 3. Apple Samantha / Victoria / Karen
 * 4. Any en-US / en-GB / en-IN voice containing Female, Woman, Aria, Jenny, Samantha, Zira, or Heera
 */
export function selectPreferredFemaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return resolvePreferredEnglishVoice(voices);
}

export { persistSelectedVoiceUri };

export function formatAssetNameForSpeech(symbol: string): string {
  const base = (symbol || 'BTCUSDT').replace(/USDT$|USD$/i, '').toUpperCase();
  return ASSET_SPEECH_NAMES[base] || base;
}

export function formatPriceForSpeech(price?: number): string {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return '';
  if (price >= 100) {
    return Math.round(price).toLocaleString('en-US');
  }
  if (price >= 1) {
    return Number(price.toFixed(2)).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  return Number(price.toFixed(4)).toString();
}

export function formatSignedNumberForSpeech(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value);
  if (rounded < 0) return `minus ${Math.abs(rounded).toLocaleString('en-US')}`;
  return rounded.toLocaleString('en-US');
}

function sanitizeTextForSpeech(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\b5m\b/gi, '5-minute')
    .replace(/\b15m\b/gi, '15-minute')
    .replace(/\b1h\b/gi, '1-hour')
    .replace(/\b9\/21\s*EMA\b/gi, '9 and 21 EMA')
    .replace(/\b9\/20\s*EMA\b/gi, '9 and 20 EMA')
    .replace(/\$\s*([\d,]+)(?:\.\d+)?/g, '$1 dollars')
    .replace(/-\s*(\d+(?:\.\d+)?)/g, 'minus $1')
    .replace(/%/g, ' percent')
    .replace(/[|·•]+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds a concise, natural-sounding spoken signal explanation with live indicator confluence,
 * entry level, and stop-loss / TP1 risk parameters.
 */
export function buildDetailedSignalAnnouncement(params: DetailedSignalParams): string {
  const {
    symbol,
    side,
    entryPrice,
    stopLoss,
    tp1,
    convictionPct,
    reason,
    contextNote,
    vwapPrice,
    vwapDistanceUsd,
    ema9,
    ema21,
    camarilla,
    maSlopeData,
    sentimentScore,
    overallSentiment,
  } = params;

  const assetName = formatAssetNameForSpeech(symbol);
  const sideWord = side === 'SHORT' ? 'short' : 'long';
  const isLong = side === 'LONG';
  const entrySpeech = formatPriceForSpeech(entryPrice);

  const intro = entrySpeech
    ? `New ${assetName} ${sideWord} signal identified at ${entrySpeech} dollars.`
    : `New ${assetName} ${sideWord} signal identified.`;

  // 1. Primary technical catalyst ("Why")
  let primaryCatalyst = '';
  const computedVwapDist =
    typeof vwapDistanceUsd === 'number' && Number.isFinite(vwapDistanceUsd)
      ? vwapDistanceUsd
      : typeof entryPrice === 'number' &&
        typeof vwapPrice === 'number' &&
        entryPrice > 0 &&
        vwapPrice > 0
      ? entryPrice - vwapPrice
      : null;

  const minSignificantDist = (entryPrice || 0) >= 1000 ? 25 : (entryPrice || 0) >= 50 ? 1 : 0.05;

  if (
    computedVwapDist !== null &&
    Math.abs(computedVwapDist) >= minSignificantDist &&
    ((isLong && computedVwapDist > 0) || (!isLong && computedVwapDist < 0))
  ) {
    const absDist = Math.abs(computedVwapDist);
    const distSpeech = absDist >= 10 ? Math.round(absDist).toLocaleString('en-US') : absDist.toFixed(2);
    primaryCatalyst = isLong
      ? `Price reclaimed ${distSpeech} dollars above 5-minute VWAP`
      : `Price rejected ${distSpeech} dollars below 5-minute VWAP`;
  } else if (
    typeof entryPrice === 'number' &&
    entryPrice > 0 &&
    camarilla &&
    ((isLong && typeof camarilla.h4 === 'number' && entryPrice >= camarilla.h4) ||
      (isLong && typeof camarilla.h3 === 'number' && entryPrice >= camarilla.h3) ||
      (!isLong && typeof camarilla.l4 === 'number' && entryPrice <= camarilla.l4) ||
      (!isLong && typeof camarilla.l3 === 'number' && entryPrice <= camarilla.l3))
  ) {
    const levelLabel = isLong
      ? typeof camarilla.h4 === 'number' && entryPrice >= camarilla.h4
        ? 'Camarilla H4'
        : 'Camarilla H3'
      : typeof camarilla.l4 === 'number' && entryPrice <= camarilla.l4
      ? 'Camarilla L4'
      : 'Camarilla L3';
    const hasEmaConfluence =
      typeof ema9 === 'number' &&
      typeof ema21 === 'number' &&
      ((isLong && ema9 >= ema21) || (!isLong && ema9 <= ema21));

    if (hasEmaConfluence) {
      primaryCatalyst = isLong
        ? `Strong bullish 9 and 20 EMA momentum breakout above ${levelLabel}`
        : `Strong bearish 9 and 20 EMA momentum breakdown below ${levelLabel}`;
    } else {
      primaryCatalyst = isLong
        ? `Bullish breakout momentum above ${levelLabel}`
        : `Bearish breakdown momentum below ${levelLabel}`;
    }
  } else if (
    typeof ema9 === 'number' &&
    typeof ema21 === 'number' &&
    ((isLong && ema9 >= ema21) || (!isLong && ema9 <= ema21))
  ) {
    primaryCatalyst = isLong
      ? 'Bullish 9 and 21 EMA upward alignment'
      : 'Bearish 9 and 21 EMA downward rejection';
  } else if (reason && reason.trim().length > 0) {
    primaryCatalyst = sanitizeTextForSpeech(reason).replace(/\.$/, '');
  } else if (contextNote && contextNote.trim().length > 0) {
    primaryCatalyst = sanitizeTextForSpeech(contextNote).replace(/\.$/, '');
  } else {
    primaryCatalyst = isLong
      ? 'Bullish multi-indicator AI Matrix alignment'
      : 'Bearish multi-indicator AI Matrix alignment';
  }

  // 2. 15-minute EMA / MA slope momentum context
  let slopeClause = '';
  if (maSlopeData && typeof maSlopeData.slopePct === 'number') {
    const absSlope = Math.abs(maSlopeData.slopePct);
    const dir = maSlopeData.direction;
    if (dir === 'UP' || maSlopeData.slopePct >= 0.02) {
      slopeClause = absSlope >= 0.08 ? 'strong bullish 15-minute EMA slope' : 'weak bullish 15-minute EMA slope';
    } else if (dir === 'DOWN' || maSlopeData.slopePct <= -0.02) {
      slopeClause = absSlope >= 0.08 ? 'strong bearish 15-minute EMA slope' : 'weak bearish 15-minute EMA slope';
    } else {
      slopeClause = 'neutral 15-minute EMA slope';
    }
  }

  // 3. Sentiment or conviction confirmation
  let tailClause = '';
  if (typeof sentimentScore === 'number' && Number.isFinite(sentimentScore) && Math.abs(sentimentScore) >= 10) {
    const scoreSpeech = formatSignedNumberForSpeech(sentimentScore);
    const sentimentTone =
      sentimentScore < 0 || overallSentiment?.toUpperCase().includes('BEAR') ? 'bearish' : 'bullish';
    tailClause = `${scoreSpeech} ${sentimentTone} sentiment`;
  } else if (typeof convictionPct === 'number' && Number.isFinite(convictionPct) && convictionPct > 0) {
    tailClause = `${Math.round(convictionPct)} percent conviction`;
  }

  let reasonSentence = `Reason: ${primaryCatalyst}`;
  if (slopeClause && tailClause) {
    reasonSentence += ` with ${slopeClause} and ${tailClause}`;
  } else if (slopeClause) {
    reasonSentence += ` with ${slopeClause}`;
  } else if (tailClause) {
    reasonSentence += ` with ${tailClause}`;
  }
  reasonSentence = `${reasonSentence.replace(/\.$/, '')}.`;

  // 4. Risk Parameters (Stop Loss & Target One)
  const slSpeech = formatPriceForSpeech(stopLoss);
  const tp1Speech = formatPriceForSpeech(tp1);
  let riskSentence = '';
  if (slSpeech && tp1Speech) {
    riskSentence = `Stop loss at ${slSpeech}, target one at ${tp1Speech}.`;
  } else if (slSpeech) {
    riskSentence = `Stop loss at ${slSpeech}.`;
  } else if (tp1Speech) {
    riskSentence = `Target one at ${tp1Speech}.`;
  }

  return [intro, reasonSentence, riskSentence].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function speakSoftFemaleVoice(
  text: string,
  options?: { rate?: number; pitch?: number; volume?: number; force?: boolean; onEnd?: () => void }
): boolean {
  activeUtteranceToken += 1;
  const myToken = activeUtteranceToken;
  return speakVoiceAlert(text, {
    rate: options?.rate ?? SOFT_FEMALE_VOICE_CADENCE.rate,
    pitch: options?.pitch ?? SOFT_FEMALE_VOICE_CADENCE.pitch,
    volume: options?.volume ?? SOFT_FEMALE_VOICE_CADENCE.volume,
    force: options?.force,
    onEnd: options?.onEnd
      ? () => {
          if (myToken !== activeUtteranceToken) return;
          options.onEnd?.();
        }
      : undefined,
  });
}

export function buildSignalVoiceKey(params: DetailedSignalParams): string {
  return (
    params.dedupeKey ||
    `${params.symbol}-${params.side}-${Math.round(params.entryPrice || 0)}`
  );
}

export function announceDetailedSignalGlobal(
  params: DetailedSignalParams,
  options?: { force?: boolean }
): string {
  const script = buildDetailedSignalAnnouncement(params);
  const nextSignalKey = buildSignalVoiceKey(params);

  if (!options?.force && !isVoicePreferenceEnabled()) {
    return script;
  }

  // Strictly block re-triggering or resetting repeats while the exact same signal remains active
  if (nextSignalKey === activeSignalKeyState) {
    if (announcementCountState >= MAX_SIGNAL_ANNOUNCEMENTS) {
      if (repeatTimerState) {
        clearTimeout(repeatTimerState);
        repeatTimerState = null;
      }
      if (fallbackTimerState) {
        clearTimeout(fallbackTimerState);
        fallbackTimerState = null;
      }
    }
    return script;
  }

  // Genuinely new signal arrived: cancel prior timers/speech, reset count = 0, store new activeSignalKey
  clearSignalVoiceRepeats();
  announcementCountState = 0;
  activeSignalKeyState = nextSignalKey;
  const currentGen = signalGenerationState;

  const triggerPlay = () => {
    if (
      currentGen !== signalGenerationState ||
      nextSignalKey !== activeSignalKeyState ||
      announcementCountState >= MAX_SIGNAL_ANNOUNCEMENTS
    ) {
      if (repeatTimerState) {
        clearTimeout(repeatTimerState);
        repeatTimerState = null;
      }
      if (fallbackTimerState) {
        clearTimeout(fallbackTimerState);
        fallbackTimerState = null;
      }
      return;
    }

    if (!options?.force && !isVoicePreferenceEnabled()) {
      clearSignalVoiceRepeats();
      return;
    }

    announcementCountState += 1;
    const playIndex = announcementCountState;

    let completed = false;
    const handleComplete = () => {
      if (completed) return;
      completed = true;
      if (fallbackTimerState) {
        clearTimeout(fallbackTimerState);
        fallbackTimerState = null;
      }
      if (currentGen !== signalGenerationState || nextSignalKey !== activeSignalKeyState) {
        return;
      }
      if (playIndex < MAX_SIGNAL_ANNOUNCEMENTS) {
        if (repeatTimerState) clearTimeout(repeatTimerState);
        repeatTimerState = setTimeout(() => {
          repeatTimerState = null;
          triggerPlay();
        }, SIGNAL_REPEAT_PAUSE_MS);
      } else if (repeatTimerState) {
        clearTimeout(repeatTimerState);
        repeatTimerState = null;
      }
    };

    const started = speakSoftFemaleVoice(script, {
      ...options,
      onEnd: handleComplete,
    });

    if (started && playIndex < MAX_SIGNAL_ANNOUNCEMENTS) {
      if (fallbackTimerState) clearTimeout(fallbackTimerState);
      fallbackTimerState = setTimeout(() => {
        fallbackTimerState = null;
        handleComplete();
      }, SIGNAL_REPEAT_FALLBACK_MS);
    }
  };

  // Play 1 of 3 immediately
  triggerPlay();
  return script;
}

/**
 * Institutional Voice Alert Hook for Real-Time Execution Announcements.
 * Calibrated to a soft, natural-sounding female English voice profile
 * (pitch 1.08, rate 0.96, volume 0.85) with async onvoiceschanged resolution.
 */
export function useVoiceAlerts() {
  const [voiceEnabled, setVoiceEnabledState] = useState<boolean>(() => isVoiceAlertsEnabled());

  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;
    try {
      const voices = window.speechSynthesis.getVoices();
      const chosen = selectPreferredFemaleVoice(voices);
      if (chosen) persistSelectedVoiceUri(chosen);
      return chosen;
    } catch {
      return null;
    }
  });

  const activeSignalKeyRef = useRef<string>(activeSignalKeyState);
  const announcementCountRef = useRef<number>(announcementCountState);
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(repeatTimerState);

  const setVoiceEnabled = useCallback((next: boolean) => {
    setVoiceAlertsEnabledMemory(next);
    setVoiceEnabledState(next);
    if (!next) {
      clearSignalVoiceRepeats();
      repeatTimerRef.current = null;
    }
    try {
      window.dispatchEvent(new Event(VOICE_SETTINGS_EVENT));
    } catch {}
  }, []);

  useEffect(() => {
    ensureVoiceAutoplayUnlock();
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const resolveVoices = () => {
      try {
        const voices = window.speechSynthesis.getVoices();
        const chosen = selectPreferredFemaleVoice(voices);
        if (chosen) {
          persistSelectedVoiceUri(chosen);
          setSelectedVoice(chosen);
        }
      } catch {}
    };

    resolveVoices();
    const synth = window.speechSynthesis;
    synth.addEventListener?.('voiceschanged', resolveVoices);
    const prevHandler = synth.onvoiceschanged;
    synth.onvoiceschanged = (ev) => {
      resolveVoices();
      if (typeof prevHandler === 'function') {
        prevHandler.call(synth, ev);
      }
    };

    return () => {
      synth.removeEventListener?.('voiceschanged', resolveVoices);
      if (synth.onvoiceschanged) {
        synth.onvoiceschanged = prevHandler ?? null;
      }
    };
  }, []);

  useEffect(() => {
    const syncVoiceEnabled = () => {
      const enabled = isVoiceAlertsEnabled();
      const globalMuted = isGlobalAudioMuted();
      setVoiceEnabledState(enabled);
      if (!enabled || globalMuted) {
        clearSignalVoiceRepeats();
        repeatTimerRef.current = null;
      }
    };
    window.addEventListener(VOICE_SETTINGS_EVENT, syncVoiceEnabled);
    window.addEventListener(GLOBAL_AUDIO_MUTE_EVENT, syncVoiceEnabled);
    return () => {
      window.removeEventListener(VOICE_SETTINGS_EVENT, syncVoiceEnabled);
      window.removeEventListener(GLOBAL_AUDIO_MUTE_EVENT, syncVoiceEnabled);
    };
  }, []);

  const speakMessage = useCallback(
    (text: string, options?: { rate?: number; pitch?: number; volume?: number; force?: boolean }) => {
      if (!options?.force && (!voiceEnabled || isGlobalAudioMuted())) return false;
      return speakSoftFemaleVoice(text, { ...options, force: true });
    },
    [voiceEnabled]
  );

  const testSoftFemaleVoice = useCallback(() => {
    return speakSoftFemaleVoice(TEST_SOFT_FEMALE_VOICE_PHRASE, { force: true });
  }, []);

  const announceDetailedSignal = useCallback(
    (params: DetailedSignalParams): string => {
      const script = buildDetailedSignalAnnouncement(params);
      if (!voiceEnabled) return script;
      const res = announceDetailedSignalGlobal(params);
      activeSignalKeyRef.current = activeSignalKeyState;
      announcementCountRef.current = announcementCountState;
      repeatTimerRef.current = repeatTimerState;
      return res;
    },
    [voiceEnabled]
  );

  /**
   * Synchronize Voice Announcement with the Correlated Strategy.
   * Reads correlatedStrategyName directly from active engine state,
   * constructs the directional template literal, and suppresses
   * generic 'Short Straddle' when directional signals are active.
   */
  const announceOptionsStrategy = useCallback(
    ({
      intradayMode = true,
      correlatedStrategyName,
      selectedStrategyName,
      delta,
      targetStrike,
      strikeType,
      signalSide,
    }: AnnounceOptionsStrategyParams): string => {
      // 1. Directly resolve active announced strategy
      let activeAnnouncedStrategy = intradayMode
        ? correlatedStrategyName
        : (selectedStrategyName || correlatedStrategyName);

      // 2. Suppress generic "Short Straddle" or "Delta Neutral" if directional LONG/SHORT is active
      const isDirectionalSignal = signalSide === 'LONG' || signalSide === 'SHORT';
      if (
        (activeAnnouncedStrategy === 'Short Straddle' || activeAnnouncedStrategy === 'Delta Neutral') &&
        isDirectionalSignal
      ) {
        activeAnnouncedStrategy = signalSide === 'SHORT' ? 'Bear Put Spread' : 'Bull Call Spread';
      }

      // 3. Format Delta readout (e.g., "Delta minus 0.24" or "Delta plus 0.22")
      let deltaFormatted = '';
      if (typeof delta === 'number' && !isNaN(delta)) {
        if (delta < 0) {
          deltaFormatted = ` Delta minus ${Math.abs(delta).toFixed(2)}.`;
        } else if (delta > 0) {
          deltaFormatted = ` Delta plus ${delta.toFixed(2)}.`;
        } else {
          deltaFormatted = ` Delta neutral 0.00.`;
        }
      }

      // 4. Format Target Strike readout (e.g., "Target strike 72,750 Put")
      let strikeFormatted = '';
      if (targetStrike && targetStrike > 0) {
        const legType = strikeType || (activeAnnouncedStrategy.toLowerCase().includes('put') ? 'Put' : 'Call');
        strikeFormatted = ` Target strike ${targetStrike.toLocaleString()} ${legType}.`;
      }

      // 5. Template literal: e.g. "Intraday 0-DTE Bear Put Spread armed. Delta minus 0.24. Target strike 72,750 Put."
      const message = `Intraday 0-DTE ${activeAnnouncedStrategy} armed.${deltaFormatted}${strikeFormatted}`
        .replace(/\s+/g, ' ')
        .trim();

      speakMessage(message);
      return message;
    },
    [speakMessage]
  );

  return {
    voiceEnabled,
    setVoiceEnabled,
    selectedVoice,
    speakMessage,
    testSoftFemaleVoice,
    announceDetailedSignal,
    announceOptionsStrategy,
  };
}
