import { formatClock, speakDuration } from './format';
import { formatMessage } from './icu';

/**
 * The English message catalogue (i18n.scope.english-ready, content.voice.plain).
 *
 * Plain, short, sentence case. Plurals go through Intl.PluralRules. Components take their
 * words from here, never from string literals, so a translation replaces this module.
 */
export const messages = {
  appName: 'Workout Logger',
  documentTitle: (screen: string) => `${screen} · Workout Logger`,
  skipToContent: 'Skip to main content',

  nav: { label: 'Primary', today: 'Today', history: 'History', settings: 'Settings' },
  actions: {
    label: 'Actions',
    back: 'Back',
    close: 'Close',
    more: 'More',
    logSet: 'Log set',
    saving: 'Saving…',
    undo: 'Undo',
    retry: 'Retry',
    startWorkout: 'Start workout',
    skipRest: 'Skip rest',
    addTime: 'Add 30 seconds',
    done: 'Done',
    decrease: (what: string) => `Decrease ${what}`,
    increase: (what: string) => `Increase ${what}`,
  },

  progress: {
    exercise: (index: number, total: number) =>
      formatMessage('Exercise {index} of {total}', { index, total }),
    set: (index: number, total: number) =>
      formatMessage('Set {index} of {total}', { index, total }),
    setPill: (index: number, done: boolean) => `Set ${index}, ${done ? 'done' : 'not done'}`,
  },

  sync: {
    onDevice: 'On device',
    syncing: 'Syncing',
    needsAttention: 'Needs attention',
    offline: 'Offline',
  },

  set: {
    load: 'Load',
    reps: 'Reps',
    rir: 'RIR',
    rirHelper: 'Reps you could still do',
    rirHelpButton: 'What is RIR?',
    saved: (index: number, restSeconds: number) =>
      `Set ${index} saved. Rest ${formatClock(restSeconds)}.`,
    deleted: (index: number) => `Set ${index} deleted`,
    notRecorded: 'not recorded',
  },

  rest: {
    heading: 'Rest',
    started: (seconds: number) => `Rest started. ${speakDuration(seconds)}.`,
    tenSecondsLeft: '10 seconds left.',
    done: 'Rest done.',
    next: (exercise: string, load: string, reps: number) =>
      formatMessage('Next: {exercise}, {load} × {reps}', { exercise, load, reps }),
  },

  rirHelp: {
    title: 'RIR: reps in reserve',
    body: 'RIR is how many more good reps you could have done at the end of a set.',
    mapping: 'RPE is worked out from RIR and cannot be edited.',
  },

  states: {
    success: (index: number) => `Set ${index} saved`,
    warning: 'Rest is longer than planned',
    error: 'Sync failed. Your sets are safe on this device.',
    offline: 'Offline. Logging still works.',
    loadingHistory: 'Loading history…',
    empty: 'No workouts yet',
    emptyBody: 'Your finished workouts will show here.',
    emptyAction: 'Start workout',
    stale: 'Out of date. The plan changed after this was made.',
    conflict: 'Changed on 2 devices. Choose a version.',
  },

  agent: { tag: 'From agent', created: (date: string) => `Created ${date}` },

  proposal: {
    title: 'Plan change',
    changes: 'Changes',
    why: 'Why',
    baseRevision: (revision: number) =>
      formatMessage('Made against plan revision {revision}', { revision }),
    accept: 'Accept change',
    reject: 'Reject',
    changesTo: 'changes to',
    staleNothingApplied: 'Nothing was changed. Ask the agent for a new proposal.',
    replacePlan: 'Replaces the whole plan',
    sessions: (count: number) =>
      formatMessage('{count, plural, one {# session} other {# sessions}}', { count }),
    sessionOn: (date: string) => `Session on ${date}`,
    movesTo: (date: string) => `Moves to ${date}`,
    exercisesChange: 'Its exercises change',
    correction: 'Correction to a completed workout',
    correctedSet: (setId: string, value: string) => `Set ${setId} becomes ${value}`,
  },

  theme: { label: 'Theme', light: 'Light', dark: 'Dark', system: 'System' },

  settings: {
    vibration: 'Vibration',
    vibrationHelp: 'A short buzz when you log a set and when rest ends.',
    restSound: 'Rest end sound',
    restSoundHelp: 'A short tone when rest ends.',
    on: 'On',
    off: 'Off',
  },

  confirm: {
    keepHistory: 'Keep history',
    deleteHistory: 'Delete all history?',
    deleteHistoryBody: 'This removes every workout from this device and cannot be undone.',
    deleteHistoryAction: 'Delete history',
  },

  count: {
    sets: (count: number) =>
      formatMessage('{count, plural, one {# set} other {# sets}}', { count }),
    exercises: (count: number) =>
      formatMessage('{count, plural, one {# exercise} other {# exercises}}', { count }),
  },
} as const;
