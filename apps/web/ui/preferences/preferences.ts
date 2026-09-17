'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Device-local feedback preferences (haptics.rest-end.vibrate-optional-sound).
 * Vibration is on by default; the rest-end tone is off by default. Visual change always
 * happens, whatever these say.
 */
export const PREFERENCES = {
  vibration: { key: 'wl-vibration', defaultValue: true },
  restSound: { key: 'wl-rest-sound', defaultValue: false },
} as const;

export type Preference = keyof typeof PREFERENCES;

export function readPreference(preference: Preference): boolean {
  const { key, defaultValue } = PREFERENCES[preference];
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? defaultValue : stored === 'on';
  } catch {
    return defaultValue;
  }
}

export function usePreference(preference: Preference): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(PREFERENCES[preference].defaultValue);
  useEffect(() => setValue(readPreference(preference)), [preference]);
  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(PREFERENCES[preference].key, next ? 'on' : 'off');
      } catch {
        // Applies for this visit only when storage is unavailable.
      }
    },
    [preference],
  );
  return [value, update];
}

/** One light tick, only after user interaction and only when vibration is on. */
export function vibrate(pattern: number): void {
  const activated = navigator.userActivation?.hasBeenActive ?? false;
  if (activated && 'vibrate' in navigator && readPreference('vibration')) {
    navigator.vibrate(pattern);
  }
}

/** The optional rest-end tone: 200 ms, generated, so no audio file ships. */
export function playRestTone(): void {
  if (!readPreference('restSound') || typeof AudioContext === 'undefined') return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.2, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
  oscillator.onended = () => void context.close();
}
