/**
 * Theme preference (theme.first-visit.light-then-choice).
 *
 * First visit is light. The user can choose Light, Dark, or System in Settings; the choice
 * is kept in localStorage on this device only. The bootstrap below runs in <head> before
 * first paint, so a stored dark preference never flashes light.
 */
export const THEME_STORAGE_KEY = 'wl-theme';

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Browser chrome colour per resolved theme: the bg token of each theme. */
export const THEME_COLOR = { light: '#EDF0EC', dark: '#101311' } as const;

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * Inline, dependency-free, and static: no user input is interpolated into it. It also follows
 * an operating-system scheme change while the page is open, reading the current preference
 * from data-theme so a choice made in Settings is respected. ui/theme/theme.test.ts executes
 * it against a fake document.
 */
export const THEME_BOOTSTRAP = `(function(){var p='light';try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');if(s==='light'||s==='dark'||s==='system')p=s}catch(e){}var d=document.documentElement;function a(){var k=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);d.setAttribute('data-theme',p);d.style.colorScheme=k?'dark':'light';var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute('content',k?'${THEME_COLOR.dark}':'${THEME_COLOR.light}')}a();document.addEventListener('DOMContentLoaded',a);var q=window.matchMedia('(prefers-color-scheme: dark)');if(q.addEventListener)q.addEventListener('change',function(){var t=d.getAttribute('data-theme');if(t==='light'||t==='dark'||t==='system')p=t;a()})})()`;

export function resolvesDark(preference: ThemePreference, systemDark: boolean): boolean {
  return preference === 'dark' || (preference === 'system' && systemDark);
}

/** The same effect as the bootstrap, for a preference changed at runtime. */
export function applyTheme(preference: ThemePreference, doc: Document = document): void {
  const dark = resolvesDark(
    preference,
    doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches ?? false,
  );
  doc.documentElement.setAttribute('data-theme', preference);
  doc.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
  }
}
