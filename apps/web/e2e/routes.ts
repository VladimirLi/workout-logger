/**
 * Every design-system page the browser gates cover: the shell, the lab, the state matrix,
 * and the coded reference screens (docs.examples.coded-screens).
 */
export const SHELL_ROUTES = ['/', '/offline'] as const;

export const LAB_ROUTES = ['/lab', '/lab/components', '/lab/states'] as const;

export const SCREEN_ROUTES = [
  '/lab/screens/plan',
  '/lab/screens/set-focus',
  '/lab/screens/rir-help',
  '/lab/screens/rest',
  '/lab/screens/summary',
  '/lab/screens/history',
  '/lab/screens/settings',
  '/lab/screens/empty',
  '/lab/screens/error',
  '/lab/screens/proposal-review',
  '/lab/screens/proposal-stale',
] as const;

export const ALL_ROUTES = [...SHELL_ROUTES, ...LAB_ROUTES, ...SCREEN_ROUTES] as const;
