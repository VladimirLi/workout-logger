import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEME_BOOTSTRAP, THEME_COLOR, THEME_STORAGE_KEY } from './theme';

/** Runs the inline bootstrap against a minimal document, the way <head> would. */
function boot(stored: string | null | Error, systemDark = false) {
  const attributes: Record<string, string> = {};
  const style: { colorScheme?: string } = {};
  const metas = [{ content: '', setAttribute: (_: string, v: string) => (metas[0]!.content = v) }];
  const listeners: (() => void)[] = [];
  const mediaListeners: (() => void)[] = [];
  const system = { dark: systemDark };
  runInNewContext(THEME_BOOTSTRAP, {
    localStorage: {
      getItem: (key: string) => {
        if (stored instanceof Error) throw stored;
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    },
    window: {
      matchMedia: () => ({
        get matches() {
          return system.dark;
        },
        addEventListener: (_: string, listener: () => void) => mediaListeners.push(listener),
      }),
    },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          attributes[name] = value;
        },
        getAttribute: (name: string) => attributes[name] ?? null,
        style,
      },
      querySelectorAll: () => metas,
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    },
  });
  const changeSystem = (dark: boolean) => {
    system.dark = dark;
    for (const listener of mediaListeners) listener();
    return { theme: attributes['data-theme'], scheme: style.colorScheme, meta: metas[0]!.content };
  };
  return {
    theme: attributes['data-theme'],
    scheme: style.colorScheme,
    meta: metas[0]!.content,
    listeners,
    changeSystem,
  };
}

describe('theme bootstrap', () => {
  it('is light on a first visit, whatever the OS prefers', () => {
    expect(boot(null, true)).toMatchObject({
      theme: 'light',
      scheme: 'light',
      meta: THEME_COLOR.light,
    });
  });

  it('applies a stored dark preference before first paint', () => {
    expect(boot('dark')).toMatchObject({ theme: 'dark', scheme: 'dark', meta: THEME_COLOR.dark });
  });

  it('follows the OS when the preference is system', () => {
    expect(boot('system', true)).toMatchObject({ theme: 'system', scheme: 'dark' });
    expect(boot('system', false)).toMatchObject({ theme: 'system', scheme: 'light' });
  });

  it('ignores an unknown stored value', () => {
    expect(boot('purple')).toMatchObject({ theme: 'light' });
  });

  it('falls back to light when storage is unavailable', () => {
    expect(boot(new Error('SecurityError'))).toMatchObject({ theme: 'light' });
  });

  it('follows an OS scheme change mid-session when the preference is system', () => {
    const booted = boot('system', false);
    expect(booted.scheme).toBe('light');
    expect(booted.changeSystem(true)).toMatchObject({ scheme: 'dark', meta: THEME_COLOR.dark });
  });

  it('ignores an OS scheme change when the preference is explicit', () => {
    expect(boot('light', false).changeSystem(true)).toMatchObject({ scheme: 'light' });
  });

  it('re-applies once the document has parsed, so late theme-color tags are updated', () => {
    expect(boot('dark').listeners).toHaveLength(1);
  });
});
