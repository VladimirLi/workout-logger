/*!
 * Icon geometry vendored, unmodified, from lucide-static@1.46.0 (https://lucide.dev).
 * ISC License, Copyright (c) 2026 Lucide Icons and Contributors. Icons marked Feather-derived
 * in ICONS_LICENSES.md are also MIT License, Copyright (c) 2013-present Cole Bemis.
 * Full licence text: apps/web/ui/icons/LICENSE-lucide.txt, served at /third-party-notices.txt.
 */

/**
 * The closed icon set (iconography.style.outline-lucide). Every name here is recorded in
 * ICONS_LICENSES.md, and a unit test fails when the two disagree. No icon library is a
 * dependency: the geometry is data, rendered by Icon with the accepted 1.75 stroke.
 */
type Element = readonly ['path' | 'circle' | 'rect' | 'line', Readonly<Record<string, string>>];

export const ICON_GEOMETRY = {
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  'circle-check': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm16 9-5.5 5.5L8 12' }],
  ],
  smartphone: [
    ['rect', { width: '14', height: '20', x: '5', y: '2', rx: '2', ry: '2' }],
    ['path', { d: 'M12 18h.01' }],
  ],
  'refresh-cw': [
    ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
    ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
    ['path', { d: 'M8 16H3v5' }],
  ],
  'triangle-alert': [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  'cloud-off': [
    ['path', { d: 'M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057' }],
    ['path', { d: 'M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78' }],
    ['path', { d: 'm2 2 20 20' }],
  ],
  'timer-off': [
    ['path', { d: 'M10 2h4' }],
    ['path', { d: 'M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7' }],
    ['path', { d: 'M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2' }],
    ['path', { d: 'm2 2 20 20' }],
    ['path', { d: 'M12 12v-2' }],
  ],
  'arrow-left-right': [
    ['path', { d: 'M8 3 4 7l4 4' }],
    ['path', { d: 'M4 7h16' }],
    ['path', { d: 'm16 21 4-4-4-4' }],
    ['path', { d: 'M20 17H4' }],
  ],
  'rotate-ccw': [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
  ],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  minus: [['path', { d: 'M5 12h14' }]],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  'undo-2': [
    ['path', { d: 'M9 14 4 9l5-5' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' }],
  ],
  'chevron-left': [['path', { d: 'm15 18-6-6 6-6' }]],
  'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
  'ellipsis-vertical': [
    ['circle', { cx: '12', cy: '12', r: '1' }],
    ['circle', { cx: '12', cy: '5', r: '1' }],
    ['circle', { cx: '12', cy: '19', r: '1' }],
  ],
  'circle-question-mark': [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  dumbbell: [
    [
      'path',
      {
        d: 'M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z',
      },
    ],
    ['path', { d: 'm2.5 21.5 1.4-1.4' }],
    ['path', { d: 'm20.1 3.9 1.4-1.4' }],
    [
      'path',
      {
        d: 'M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z',
      },
    ],
    ['path', { d: 'm9.6 14.4 4.8-4.8' }],
  ],
  history: [
    ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
    ['path', { d: 'M3 3v5h5' }],
    ['path', { d: 'M12 7v5l4 2' }],
  ],
  settings: [
    [
      'path',
      {
        d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
      },
    ],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  timer: [
    ['line', { x1: '10', x2: '14', y1: '2', y2: '2' }],
    ['line', { x1: '12', x2: '15', y1: '14', y2: '11' }],
    ['circle', { cx: '12', cy: '14', r: '8' }],
  ],
  sun: [
    ['circle', { cx: '12', cy: '12', r: '4' }],
    ['path', { d: 'M12 2v2' }],
    ['path', { d: 'M12 20v2' }],
    ['path', { d: 'm4.93 4.93 1.41 1.41' }],
    ['path', { d: 'm17.66 17.66 1.41 1.41' }],
    ['path', { d: 'M2 12h2' }],
    ['path', { d: 'M20 12h2' }],
    ['path', { d: 'm6.34 17.66-1.41 1.41' }],
    ['path', { d: 'm19.07 4.93-1.41 1.41' }],
  ],
  moon: [
    [
      'path',
      {
        d: 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401',
      },
    ],
  ],
  monitor: [
    ['rect', { width: '20', height: '14', x: '2', y: '3', rx: '2' }],
    ['line', { x1: '8', x2: '16', y1: '21', y2: '21' }],
    ['line', { x1: '12', x2: '12', y1: '17', y2: '21' }],
  ],
} as const satisfies Record<string, readonly Element[]>;

export type IconName = keyof typeof ICON_GEOMETRY;

/** Icons whose meaning has a direction; they mirror in right-to-left layouts (i18n.rtl.logical-now). */
export const DIRECTIONAL_ICONS: ReadonlySet<IconName> = new Set([
  'chevron-left',
  'chevron-right',
  'undo-2',
]);
