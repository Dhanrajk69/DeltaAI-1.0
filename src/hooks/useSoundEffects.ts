import { useState, useCallback, useEffect } from 'react';

export const GLOBAL_AUDIO_MUTE_STORAGE_KEY = 'delta_global_audio_muted';
export const GLOBAL_AUDIO_MUTE_EVENT = 'delta-global-audio-mute-changed';

export function isGlobalAudioMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(GLOBAL_AUDIO_MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setGlobalAudioMuted(isMuted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GLOBAL_AUDIO_MUTE_STORAGE_KEY, String(isMuted));
    window.dispatchEvent(new CustomEvent(GLOBAL_AUDIO_MUTE_EVENT, { detail: { muted: isMuted } }));
  } catch {}
}

export function useSoundEffects(externalMuted = false) {
  const [muted, setMuted] = useState(false);
  const [globalMuted, setGlobalMutedState] = useState<boolean>(() => isGlobalAudioMuted());

  useEffect(() => {
    const syncMute = () => setGlobalMutedState(isGlobalAudioMuted());
    window.addEventListener(GLOBAL_AUDIO_MUTE_EVENT, syncMute);
    window.addEventListener('storage', syncMute);
    return () => {
      window.removeEventListener(GLOBAL_AUDIO_MUTE_EVENT, syncMute);
      window.removeEventListener('storage', syncMute);
    };
  }, []);

  const effectiveMuted = muted || externalMuted || globalMuted;

  const playRawTone = useCallback((freq: number, type: OscillatorType, duration: number, gainValue = 0.08) => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(gainValue, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Audio autoplay policy gracefully handled
    }
  }, []);

  const playTone = useCallback((freq: number, type: OscillatorType, duration: number, gainValue = 0.08) => {
    if (effectiveMuted) return;
    playRawTone(freq, type, duration, gainValue);
  }, [effectiveMuted, playRawTone]);

  const playTradeFill = useCallback(() => {
    // 2-tone pleasant chord
    playTone(587.33, 'sine', 0.12, 0.08); // D5
    setTimeout(() => playTone(880, 'sine', 0.18, 0.06), 70); // A5
  }, [playTone]);

  const playAlert = useCallback(() => {
    playTone(440, 'triangle', 0.15, 0.09);
    setTimeout(() => playTone(440, 'triangle', 0.15, 0.09), 160);
  }, [playTone]);

  const playKillSwitch = useCallback(() => {
    playTone(220, 'sawtooth', 0.35, 0.12);
  }, [playTone]);

  const playFlashBeep = useCallback(() => {
    // Subtle, clean institutional acoustic tick
    playTone(784, 'sine', 0.08, 0.04);
  }, [playTone]);

  const playVolatilitySpike = useCallback(() => {
    // High-priority 3-pulse rising frequency volatility spike alarm
    playTone(523.25, 'sawtooth', 0.11, 0.09); // C5
    setTimeout(() => playTone(659.25, 'sawtooth', 0.11, 0.09), 120); // E5
    setTimeout(() => playTone(987.77, 'triangle', 0.22, 0.11), 240); // B5
  }, [playTone]);

  const playVolatilityBreachChime = useCallback(() => {
    // Dedicated crystal bell chime for Volatility Breach alerts (independent of global mute)
    playRawTone(880, 'sine', 0.22, 0.09); // A5
    setTimeout(() => playRawTone(1174.66, 'sine', 0.24, 0.08), 110); // D6
    setTimeout(() => playRawTone(1567.98, 'triangle', 0.36, 0.07), 220); // G6
  }, [playRawTone]);

  return {
    muted,
    effectiveMuted,
    setMuted,
    playTradeFill,
    playAlert,
    playKillSwitch,
    playFlashBeep,
    playVolatilitySpike,
    playVolatilityBreachChime,
  };
}
