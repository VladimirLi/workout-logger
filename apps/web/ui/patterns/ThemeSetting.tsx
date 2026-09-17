'use client';

import { useEffect, useState } from 'react';
import { messages } from '../i18n/messages';
import { Icon, type IconName } from '../icons/Icon';
import {
  applyTheme,
  isThemePreference,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '../theme/theme';
import moduleStyles from './ThemeSetting.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'group' | 'legend' | 'option' | 'radio', string>;

const ICONS: Record<ThemePreference, IconName> = { light: 'sun', dark: 'moon', system: 'monitor' };

/** theme.first-visit.light-then-choice: Light, Dark, or System, kept on this device. */
export function ThemeSetting() {
  const [preference, setPreference] = useState<ThemePreference>('light');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemePreference(stored)) setPreference(stored);
    } catch {
      // Storage can be unavailable (private mode); the default stays light.
    }
  }, []);

  const choose = (next: ThemePreference) => {
    setPreference(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Applies for this visit only when storage is unavailable.
    }
    applyTheme(next);
  };

  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{messages.theme.label}</legend>
      {THEME_PREFERENCES.map((option) => (
        <label key={option} className={styles.option}>
          <input
            className={styles.radio}
            type="radio"
            name="theme"
            value={option}
            checked={preference === option}
            onChange={() => choose(option)}
          />
          <Icon name={ICONS[option]} size="body" />
          <span>{messages.theme[option]}</span>
        </label>
      ))}
    </fieldset>
  );
}
