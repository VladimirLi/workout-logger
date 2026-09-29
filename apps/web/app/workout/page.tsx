'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  deviceTimeZone,
  editButtonId,
  formatDate,
  Heading,
  ListRow,
  LiveRegion,
  messages,
  Screen,
  type SetRow,
  SetTable,
  Skeleton,
  Stack,
  StatusMessage,
  StickyActionBar,
  Surface,
  Text,
  UndoToast,
  WorkoutBar,
} from '../../ui';
import {
  type DisplaySyncState,
  deleteSet,
  downloadEverything,
  editStrengthSet,
  finishWorkout,
  liveSets,
  logStrengthSet,
  readActivePrescriptions,
  readActiveSession,
  readSessionExercises,
  restoreSet,
} from '../device';
import { EditSet } from './EditSet';
import {
  type LoggedSet,
  LogSet,
  type Prescription,
  REST_HEADING_ID,
  SET_HEADING_ID,
} from './LogSet';
import type { SetValues } from './SetControls';

/**
 * The workout in progress (workout-logging spec, tasks 5.1 and 5.2).
 *
 * Its own address, so it can be reopened directly, and everything it shows is read from the
 * device on every mount - which is what makes a refresh, a navigation, or a killed process
 * restore the session with every result already recorded rather than losing it.
 */

interface SessionView {
  readonly id: string;
  readonly startedAt: number;
  readonly rows: readonly Row[];
  readonly sync: DisplaySyncState | undefined;
  /** The exercises the workout can be logged against, with targets while the plan still has them. */
  readonly exercises: readonly Prescription[];
  /** False when the plan revision the workout started on is gone: nothing is prescribed. */
  readonly prescribed: boolean;
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly session: SessionView }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * One live set. `values` is what the controls can change, present for a strength set: a set
 * without it cannot be edited here, so it gets no Edit button.
 */
type Row = SetRow & { exerciseId: string; values?: SetValues };

type Rows = readonly Row[];

/** controls.destructive.undo-first: a delete can be undone for ten seconds. */
const UNDO_MS = 10_000;

type ChangeFailure = {
  readonly op: 'save' | 'delete' | 'undo';
  readonly full: boolean;
  /** For an undo: the set to try to restore again, and the number it had. */
  readonly setId?: string;
  readonly number?: number;
};

type PendingUndo = {
  readonly key: number;
  readonly setId: string;
  /** The number the set had when it was deleted; the table has already closed up. */
  readonly number: number;
  readonly expiresAt: number;
};

/** The selected exercise's sets renumbered from 1, or every set when nothing is selected. */
function recordedFor(rows: Rows, selected: Prescription | undefined) {
  return rows
    .filter((row) => !selected || row.exerciseId === selected.exerciseId)
    .map((row, index) => ({
      ...row,
      set: index + 1,
      ...(selected && row.values ? { exercise: selected.name } : {}),
    }));
}

function toRow(set: ReturnType<typeof liveSets>[number]): Row {
  const measurement = set.measurement;
  const strength = measurement.profile === 'cardio' ? undefined : measurement;
  const values: SetValues | undefined = strength && {
    loadKg: strength.load?.value,
    reps: strength.repetitions,
    // RIR as entered. The table's RPE is the domain's derivation, never a stored one.
    rir: strength.exertion?.rir.value,
    side: strength.profile === 'unilateral_strength' ? strength.side : undefined,
    loadSemantics: strength.profile === 'unilateral_strength' ? strength.loadSemantics : undefined,
    notes: strength.notes,
  };
  return {
    set: set.sequence,
    exerciseId: set.exerciseId,
    ...(values ? { id: set.setId, values } : {}),
    ...(strength ? { reps: strength.repetitions } : {}),
    ...(strength?.load ? { loadKg: strength.load.value } : {}),
    ...(strength?.exertion ? { rir: strength.exertion.rir.value } : {}),
  };
}

function ExerciseChips({
  exercises,
  selected,
  onSelect,
}: {
  exercises: readonly Prescription[];
  selected: Prescription | undefined;
  onSelect: (exerciseId: string) => void;
}) {
  return (
    <Stack as="section" gap={2} aria-labelledby="exercise-heading">
      <Heading level={2} id="exercise-heading">
        Exercises
      </Heading>
      <Stack direction="inline" wrap gap={2}>
        {exercises.map((item) => {
          const isSelected = item.exerciseId === selected?.exerciseId;
          return (
            <Button
              key={item.exerciseId}
              variant={isSelected ? 'secondary' : 'tertiary'}
              aria-pressed={isSelected}
              {...(isSelected ? { icon: 'check' as const } : {})}
              onClick={() => onSelect(item.exerciseId)}
            >
              {item.name}
            </Button>
          );
        })}
      </Stack>
    </Stack>
  );
}

function useWorkoutSession() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  /** Each write reads a whole session snapshot and puts it back, so writes must not overlap. */
  const busyRef = useRef(false);
  /** Woken when a write ends, so a set, an edit or an undo tapped meanwhile waits its turn. */
  const idleWaiters = useRef<(() => void)[]>([]);
  const releaseBusy = () => {
    busyRef.current = false;
    for (const wake of idleWaiters.current.splice(0)) wake();
  };
  /** Not async: the caller must claim the turn in the same tick it finds it free. */
  const nextRelease = () => new Promise<void>((resolve) => idleWaiters.current.push(resolve));
  /** A Done that did not land must say so, or the workout looks finished when it is not. */
  const [finishFailure, setFinishFailure] = useState<{ full: boolean }>();
  /** A write that did not land must say so: a silent failure looks exactly like a saved set. */
  const [logFailed, setLogFailed] = useState(false);
  /** A full device is not an error to report and forget; it needs a way out (task 4.8). */
  const [deviceFull, setDeviceFull] = useState(false);
  /** The last edit, delete or undo that did not land. An undo carries what to try again. */
  const [changeFailure, setChangeFailure] = useState<ChangeFailure>();
  /** The one delete that can still be undone: only the most recent, until it expires. */
  const [pendingUndo, setPendingUndo] = useState<PendingUndo>();
  const [announcement, setAnnouncement] = useState('');
  /**
   * Reading the device again failed. After a write that has already committed, the workout
   * stays on screen with this notice rather than blanking, so nothing looks unsaved.
   */
  const [refreshFailed, setRefreshFailed] = useState(false);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const [{ session, sync }, prescriptions] = await Promise.all([
        readActiveSession(),
        readActivePrescriptions(),
      ]);
      if (!session) {
        setState({ kind: 'none' });
        return true;
      }
      const prescribed = prescriptions !== undefined && prescriptions.length > 0;
      const exercises = prescribed ? prescriptions : await readSessionExercises();
      setState({
        kind: 'ready',
        session: {
          id: session.id,
          startedAt: session.startedAt.getTime(),
          rows: liveSets(session).map(toRow),
          sync,
          exercises,
          prescribed,
        },
      });
      setRefreshFailed(false);
      return true;
    } catch (error) {
      console.error('workout not read', error);
      setRefreshFailed(true);
      setState((current) =>
        current.kind === 'ready'
          ? current
          : { kind: 'failed', message: error instanceof Error ? error.message : String(error) },
      );
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const finish = async (sessionId: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setFinishFailure(undefined);
    try {
      const completed = await finishWorkout(sessionId);
      if (completed.ok) {
        // Typed routes know the route, not its query string; the query is data, not a route.
        router.replace(`/summary?session=${encodeURIComponent(sessionId)}` as never);
        return;
      }
      const failure = completed.error as { kind?: string } | undefined;
      if (failure?.kind !== 'storage_full') console.error('finish failed', completed.error);
      setFinishFailure({ full: failure?.kind === 'storage_full' });
      await load();
    } catch (error) {
      console.error('finish failed', error);
      setFinishFailure({ full: false });
    } finally {
      releaseBusy();
    }
  };

  /** Says it once, even when the same words were said last time: a live region only announces a change. */
  const announce = (text: string) => {
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(text), 50);
  };

  /** Runs one change to a recorded set. Reads the session again on success, so numbers close up. */
  const change = async (
    op: ChangeFailure['op'],
    run: () => Promise<{ readonly ok: boolean; readonly error?: unknown }>,
    retryWith?: { setId: string; number: number },
  ): Promise<boolean> => {
    while (busyRef.current) await nextRelease();
    busyRef.current = true;
    try {
      const result = await run();
      if (!result.ok) {
        const failure = result.error as { kind?: string } | undefined;
        const full = failure?.kind === 'storage_full';
        if (!full) console.error(`set ${op} failed`, result.error);
        setChangeFailure({ op, full, ...(retryWith ?? {}) });
        return false;
      }
      setChangeFailure(undefined);
      await load();
      return true;
    } catch (error) {
      console.error(`set ${op} failed`, error);
      setChangeFailure({ op, full: false, ...(retryWith ?? {}) });
      return false;
    } finally {
      releaseBusy();
    }
  };

  const editSet = async (sessionId: string, setId: string, number: number, values: SetValues) => {
    const saved = await change('save', () => editStrengthSet({ sessionId, setId, ...values }));
    if (saved) announce(messages.set.updated(number));
    return saved;
  };

  const removeSet = async (sessionId: string, setId: string, number: number) => {
    const removed = await change('delete', () => deleteSet(sessionId, setId));
    if (removed) {
      // A second delete replaces the first toast, and the first is final from then on.
      setPendingUndo({
        key: Date.now(),
        setId,
        number,
        expiresAt: Date.now() + UNDO_MS,
      });
    }
    return removed;
  };

  const undoDelete = async (sessionId: string, target: { setId: string; number: number }) => {
    // The offer stays until this undo has its turn, so a write already running cannot eat it.
    const restored = await change('undo', () => restoreSet(sessionId, target.setId), target);
    setPendingUndo((current) => (current?.setId === target.setId ? undefined : current));
    if (restored) announce(messages.set.restored(target.number));
    return restored;
  };

  const expireUndo = useCallback(() => setPendingUndo(undefined), []);

  /** Leaving or reopening an edit forgets its failure. An undo that failed stays until retried. */
  const dismissEditFailure = () =>
    setChangeFailure((current) => (current?.op === 'undo' ? current : undefined));

  const logSet = async (
    sessionId: string,
    logged: Parameters<React.ComponentProps<typeof LogSet>['onLog']>[0],
  ): Promise<boolean> => {
    while (busyRef.current) await nextRelease();
    busyRef.current = true;
    try {
      const result = await logStrengthSet({
        sessionId: sessionId,
        exerciseId: logged.exerciseId,
        loadKg: logged.loadKg,
        reps: logged.reps,
        rir: logged.rir,
        side: logged.side,
        loadSemantics: logged.loadSemantics,
      });
      if (!result.ok) {
        const failure = result.error as { kind?: string } | undefined;
        if (failure?.kind === 'storage_full') {
          setDeviceFull(true);
          setLogFailed(false);
        } else {
          console.error('set not saved', result.error);
          setLogFailed(true);
          setDeviceFull(false);
        }
        return false;
      }
      setLogFailed(false);
      setDeviceFull(false);
      await load();
      return true;
    } catch (error) {
      console.error('set not saved', error);
      setLogFailed(true);
      return false;
    } finally {
      releaseBusy();
    }
  };

  return {
    router,
    state,
    finishFailure,
    logFailed,
    deviceFull,
    changeFailure,
    pendingUndo,
    announcement,
    refreshFailed,
    reload: load,
    finish,
    logSet,
    editSet,
    removeSet,
    undoDelete,
    expireUndo,
    dismissEditFailure,
  };
}

function recordedForEdit(
  row: ReturnType<typeof recordedFor>[number] | undefined,
  selected: Prescription | undefined,
) {
  if (!row?.values || !selected) return undefined;
  return { ...row.values, number: row.set };
}

function PlanChangedNotice({ onLogAnyway }: { onLogAnyway?: () => void }) {
  return (
    <StatusMessage
      kind="stale"
      live="polite"
      {...(onLogAnyway
        ? {
            action: (
              <Button variant="secondary" onClick={onLogAnyway}>
                Log a set anyway
              </Button>
            ),
          }
        : {})}
    >
      The plan changed after this workout started, so there are no targets to show. Everything you
      have recorded is safe.
    </StatusMessage>
  );
}

function editFailureOf(failure: ChangeFailure | undefined) {
  return failure && failure.op !== 'undo' ? { op: failure.op, full: failure.full } : undefined;
}

function FailureMessages({
  deviceFull,
  changeFailure,
  finishFailure,
  onRetryUndo,
}: {
  deviceFull: boolean;
  changeFailure: ChangeFailure | undefined;
  finishFailure: { full: boolean } | undefined;
  onRetryUndo: (target: { setId: string; number: number }) => void;
}) {
  const exportAction = (
    <Button variant="secondary" onClick={() => void downloadEverything()}>
      {messages.actions.exportEverything}
    </Button>
  );
  const undoTarget =
    changeFailure?.op === 'undo' &&
    changeFailure.setId !== undefined &&
    changeFailure.number !== undefined
      ? { setId: changeFailure.setId, number: changeFailure.number }
      : undefined;
  return (
    <>
      {deviceFull && (
        <StatusMessage kind="warning" live="assertive" action={exportAction}>
          There is no room left on this device, so that set was not saved. Nothing already recorded
          has been lost, and nothing waiting to sync has been touched. Export your data, then free
          some space.
        </StatusMessage>
      )}

      {changeFailure?.op === 'undo' && (
        <StatusMessage
          kind={changeFailure.full ? 'warning' : 'error'}
          live="assertive"
          action={
            changeFailure.full ? (
              exportAction
            ) : (
              <Button variant="secondary" onClick={() => undoTarget && onRetryUndo(undoTarget)}>
                {messages.actions.retry}
              </Button>
            )
          }
        >
          {changeFailure.full ? messages.set.changeDeviceFull : messages.set.notRestored}
        </StatusMessage>
      )}

      {finishFailure && (
        <StatusMessage
          kind={finishFailure.full ? 'warning' : 'error'}
          live="assertive"
          {...(finishFailure.full ? { action: exportAction } : {})}
        >
          {finishFailure.full
            ? 'There is no room left on this device, so the workout was not finished. Every set is still saved. Export your data, free some space, then tap Finish workout again.'
            : 'The workout was not finished. Every set is still saved. Tap Finish workout to try again.'}
        </StatusMessage>
      )}
    </>
  );
}

type FocusTarget = { row: string } | { heading: true };

/** Moves focus to the target once its element is on the page, then clears it. */
function useFocusOnce(
  focusAt: FocusTarget | undefined,
  setFocusAt: (next: FocusTarget | undefined) => void,
) {
  useEffect(() => {
    if (focusAt === undefined) return;
    const id = 'row' in focusAt ? editButtonId(focusAt.row) : undefined;
    // Either the set view's heading or rest's is on the page, never both.
    const target = id
      ? document.getElementById(id)
      : (document.getElementById(SET_HEADING_ID) ?? document.getElementById(REST_HEADING_ID));
    target?.focus();
    setFocusAt(undefined);
  }, [focusAt, setFocusAt]);
}

function finishBody(stale: boolean, recorded: number): string {
  const summary = 'Finishing takes you to the summary.';
  return stale ? summary : `You have recorded ${messages.count.sets(recorded)}. ${summary}`;
}

/** A stale table would number the next set as the one just saved, so read again first. */
async function startNextSet(stale: boolean, refresh: () => Promise<boolean>, advance: () => void) {
  if (!stale || (await refresh())) advance();
}

function ReadyWorkout({
  session,
  selected,
  logFailed,
  deviceFull,
  finishFailure,
  changeFailure,
  pendingUndo,
  announcement,
  stale,
  onRefresh,
  onSelect,
  onLog,
  onFinish,
  onSaveEdit,
  onDelete,
  onUndo,
  onExpireUndo,
  onDismissEditFailure,
}: {
  session: SessionView;
  selected: Prescription | undefined;
  logFailed: boolean;
  deviceFull: boolean;
  finishFailure: { full: boolean } | undefined;
  changeFailure: ChangeFailure | undefined;
  pendingUndo: PendingUndo | undefined;
  announcement: string;
  /** The last read failed after a write, so the rows may be missing sets that are saved. */
  stale: boolean;
  onRefresh: () => Promise<boolean>;
  onSelect: (exerciseId: string) => void;
  onLog: (logged: LoggedSet) => Promise<boolean>;
  onFinish: () => void;
  onSaveEdit: (setId: string, number: number, values: SetValues) => Promise<boolean>;
  onDelete: (setId: string, number: number) => Promise<boolean>;
  onUndo: (target: { setId: string; number: number }) => Promise<boolean>;
  onExpireUndo: () => void;
  onDismissEditFailure: () => void;
}) {
  /** With no prescription, the set controls open only when the lifter asks for them. */
  const [loggingUnprescribed, setLoggingUnprescribed] = useState(false);
  /** Bumped to start the next set: remounting resets the controls to the prescription. */
  const [setInProgress, setSetInProgress] = useState(0);
  /** The recorded set being edited. Not stored: leaving or reloading the page drops it. */
  const [editingId, setEditingId] = useState<string>();
  /** Where focus goes once the view it left is back: a row's Edit button, or the set view's heading. */
  const [focusAt, setFocusAt] = useState<FocusTarget>();
  const { exercises } = session;

  useFocusOnce(focusAt, setFocusAt);

  const rows = recordedFor(session.rows, selected);
  const editing = editingId === undefined ? undefined : rows.find((row) => row.id === editingId);
  const editingRecorded = recordedForEdit(editing, selected);

  const stopEditing = (returnFocusTo?: FocusTarget) => {
    setEditingId(undefined);
    onDismissEditFailure();
    if (returnFocusTo !== undefined) setFocusAt(returnFocusTo);
  };

  const logSetShown = selected && (session.prescribed || loggingUnprescribed);
  const undoAndFocus = (target: { setId: string; number: number }) => {
    void onUndo(target).then((restored) => {
      if (restored) setFocusAt({ row: target.setId });
    });
  };
  const notice = pendingUndo ? (
    <UndoToast
      key={pendingUndo.key}
      message={messages.set.deleted(pendingUndo.number)}
      durationMs={Math.max(0, pendingUndo.expiresAt - Date.now())}
      onExpire={onExpireUndo}
      onUndo={() => undoAndFocus({ setId: pendingUndo.setId, number: pendingUndo.number })}
    />
  ) : undefined;

  return (
    <Stack gap={4}>
      {exercises.length > 1 && (
        <ExerciseChips
          exercises={exercises}
          selected={selected}
          onSelect={(id) => {
            stopEditing();
            onSelect(id);
            setSetInProgress((n) => n + 1);
          }}
        />
      )}

      {editing && editingRecorded && selected && (
        <EditSet
          key={editing.id}
          exerciseName={selected.name}
          target={selected.target}
          config={selected}
          recorded={editingRecorded}
          failure={editFailureOf(changeFailure)}
          notice={notice}
          onSave={async (values) => {
            const saved = await onSaveEdit(editing.id as string, editing.set, values);
            if (saved) stopEditing({ row: editing.id as string });
            return saved;
          }}
          onCancel={() => stopEditing({ row: editing.id as string })}
          onDelete={async () => {
            const removed = await onDelete(editing.id as string, editing.set);
            if (removed) stopEditing({ heading: true });
            return removed;
          }}
        />
      )}

      {/* Kept mounted while a set is edited, so rest keeps running underneath. */}
      <Stack gap={4} hidden={editing !== undefined}>
        {logSetShown ? (
          <LogSet
            key={`${selected.exerciseId}-${setInProgress}`}
            prescription={selected}
            setNumber={rows.length + 1}
            notSaved={logFailed}
            {...(editing ? {} : { notice })}
            onNextSet={() =>
              void startNextSet(stale, onRefresh, () => setSetInProgress((n) => n + 1))
            }
            onLog={onLog}
          />
        ) : (
          !session.prescribed && (
            <>
              <Heading level={1}>{selected?.name ?? 'Workout'}</Heading>
              <PlanChangedNotice
                {...(selected ? { onLogAnyway: () => setLoggingUnprescribed(true) } : {})}
              />
            </>
          )
        )}
      </Stack>

      {!logSetShown && !editing && notice && <StickyActionBar notice={notice} />}

      <FailureMessages
        deviceFull={deviceFull}
        changeFailure={changeFailure}
        finishFailure={finishFailure}
        onRetryUndo={undoAndFocus}
      />

      <Surface tone="card" aria-labelledby="workout-heading">
        <Stack gap={3}>
          <Heading level={2} id="workout-heading">
            In progress
          </Heading>
          <Text size="label" tone="muted">
            Started {formatDate(session.startedAt, deviceTimeZone())}
          </Text>
        </Stack>
      </Surface>

      <SetTable
        caption="Sets recorded"
        rows={rows}
        {...(selected
          ? {
              onEdit: (row: SetRow) => {
                onDismissEditFailure();
                if (row.id !== undefined) setEditingId(row.id);
              },
            }
          : {})}
      />

      {!editing && (
        <ConfirmDialog
          trigger="Finish workout"
          triggerVariant="secondary"
          title="Finish this workout?"
          body={finishBody(stale, session.rows.length)}
          confirm="Finish workout"
          cancel="Keep going"
          onConfirm={onFinish}
        />
      )}

      <LiveRegion>{announcement}</LiveRegion>
    </Stack>
  );
}

export default function WorkoutPage() {
  const {
    router,
    state,
    finishFailure,
    logFailed,
    deviceFull,
    changeFailure,
    pendingUndo,
    announcement,
    refreshFailed,
    reload,
    finish,
    logSet,
    editSet,
    removeSet,
    undoDelete,
    expireUndo,
    dismissEditFailure,
  } = useWorkoutSession();
  const [exerciseId, setExerciseId] = useState<string | undefined>();
  const session = state.kind === 'ready' ? state.session : undefined;
  const selected = session
    ? (session.exercises.find((item) => item.exerciseId === exerciseId) ?? session.exercises[0])
    : undefined;

  return (
    <Screen
      bar={
        <WorkoutBar
          // No sync state and no position until a session is read back: nothing is claimed
          // before that. Loading, no session and a failed read make no persistence claim.
          {...(session
            ? {
                exercise: selected ? session.exercises.indexOf(selected) + 1 : 1,
                exercises: Math.max(1, session.exercises.length),
                sync: session.sync ?? 'on-device',
              }
            : {})}
          onClose={() => router.push('/today')}
        />
      }
    >
      {state.kind === 'loading' && (
        <Stack gap={3}>
          <Heading level={1}>Workout</Heading>
          <Skeleton label="Loading the workout" />
        </Stack>
      )}

      {state.kind === 'failed' && (
        <Stack gap={3}>
          <Heading level={1}>Workout</Heading>
          <StatusMessage
            kind="error"
            live="assertive"
            action={
              <Button variant="secondary" onClick={() => void reload()}>
                {messages.actions.retry}
              </Button>
            }
          >
            {state.message}
          </StatusMessage>
        </Stack>
      )}

      {session && refreshFailed && (
        <StatusMessage
          kind="error"
          live="assertive"
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {messages.actions.retry}
            </Button>
          }
        >
          This screen could not be refreshed, so it may not show your latest sets. Everything
          already recorded is saved.
        </StatusMessage>
      )}

      {state.kind === 'none' && (
        <Surface tone="plain" as="section" aria-labelledby="nothing-active">
          <Stack gap={3}>
            <Heading level={1} id="nothing-active">
              No workout in progress
            </Heading>
            <Text>Start one from today’s plan.</Text>
            <Stack as="ul" gap={1}>
              <ListRow href="/today" title="Back to today" />
            </Stack>
          </Stack>
        </Surface>
      )}

      {session && (
        <ReadyWorkout
          session={session}
          selected={selected}
          logFailed={logFailed}
          deviceFull={deviceFull}
          finishFailure={finishFailure}
          changeFailure={changeFailure}
          pendingUndo={pendingUndo}
          announcement={announcement}
          stale={refreshFailed}
          onRefresh={reload}
          onSelect={setExerciseId}
          onLog={(logged) => logSet(session.id, logged)}
          onFinish={() => void finish(session.id)}
          onSaveEdit={(setId, number, values) => editSet(session.id, setId, number, values)}
          onDelete={(setId, number) => removeSet(session.id, setId, number)}
          onUndo={(target) => undoDelete(session.id, target)}
          onExpireUndo={expireUndo}
          onDismissEditFailure={dismissEditFailure}
        />
      )}
    </Screen>
  );
}
