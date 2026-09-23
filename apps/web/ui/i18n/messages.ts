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

  deletion: {
    heading: 'Your data',
    deleteAction: 'Delete all history',
    deleteTitle: 'Delete all history?',
    deleteBody:
      'Workouts leave this device now and stay recoverable here for 30 days. After that they are permanently removed. There are no scheduled backups on this private single-user slice, so the only recovery path is that 30-day copy. Any pre-migration dump taken before you delete may still hold a copy until that dump is retired under the backup runbook.',
    deleteConfirm: 'Delete history',
    deleteCancel: 'Keep history',
    pendingHeading: 'Deletion pending',
    pendingBody: (until: string) =>
      `Your data was removed from active use. You can restore it until ${until}. After that it is permanently deleted from this device.`,
    restoreAction: 'Restore history',
    empty: 'There is no workout history on this device to delete.',
    restored: 'Your history is back on this device.',
    purged: 'The recovery window ended. The data is gone from this device.',
    backupNote:
      'Backup copies: none are scheduled while this stays a private single-user slice. Pre-migration dumps, if any exist outside the app, stop containing deleted data when those dumps are retired.',
  },

  count: {
    sets: (count: number) =>
      formatMessage('{count, plural, one {# set} other {# sets}}', { count }),
    exercises: (count: number) =>
      formatMessage('{count, plural, one {# exercise} other {# exercises}}', { count }),
  },
} as const;
