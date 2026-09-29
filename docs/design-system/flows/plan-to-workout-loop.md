# Screen and flow spec: the plan-to-workout loop

**Status: Proposed by design (UI/UX Designer), 2026-09-29.** Authoritative target for QA
design-conformance testing of VLA-2 once the P1 deltas below are closed.

**Revision 2, 2026-09-29.** Vlad answered the four open product questions (§8). Four things
changed: rest length comes from the plan (§4.4), names come from the plan schema (§7), Today
handles more than one session (§3.2), and editing or deleting a recorded set is **in this
slice** (new §4.8). Deltas D-21 to D-26 are new; D-1 and D-19 changed.

**Scope.** `/` → `/today` → `/workout` → `/summary` → `/history`. Settings, sign-in,
proposals, diagnostics, and offline are out of scope here.

**Needs an OpenSpec change.** Plan-carried rest, plan names, and set edit/delete alter stored
data shape and user-visible behaviour (`AGENTS.md`, "Does this need an OpenSpec change?").
That classification is the implementer's to record and an independent reviewer's to verify;
I am stating my view, not making the call.

**Subordinate to [DESIGN_SYSTEM.md](../../../DESIGN_SYSTEM.md) (Accepted, ADR-0008).** This
document decides *screens and flows*. It introduces no colour, type, spacing, motion, icon,
or component. Every element named here already exists in `apps/web/ui`. Where this document
and the design system disagree, the design system wins and this document is wrong.

**What this document is not.** It is not a conformance claim. Nothing here says the shipped
implementation meets WCAG, and nothing here approves my own work — QA verifies the
implementation against this spec and reports back.

---

## 1. Principles for this loop

Ranked. When two conflict, the higher one wins.

1. **One-handed, thumb-reachable, during a set.** The only controls that must be usable with
   sweaty hands mid-workout are: adjust load, adjust reps, pick RIR, log the set. Everything
   else may cost a second tap.
2. **Never claim a number nobody prescribed.** An absent target shows as absent, never as a
   guess. (This is the rule adversarial review established; it is also a design rule.)
3. **One focal object** (`principles.density.split`). During a workout the screen is about the
   current exercise's current set. History and Summary are plain lists with more rows.
4. **Legible at arm's length.** Load and reps at display size, tabular numerals, 7:1.
5. **Nothing recorded is ever lost or quietly changed** (`principles.def.values`, trust).

---

## 2. Route map and navigation model

| Route | Chrome (`bar`) | Bottom (`bottom`) | Back |
|---|---|---|---|
| `/` | — | — | redirect to `/today`, replacing history so back does not bounce |
| `/today` | `TopBar title="Today"` (no back — tab root) | `BottomTabs current="today"` | — |
| `/workout` | `WorkoutBar` | `StickyActionBar` | close, not back |
| `/summary?session=…` | `TopBar title="Summary" back` | — | to `/history` or `/today`, whichever was the referrer |
| `/history` | `TopBar title="History"` (no back — tab root) | `BottomTabs current="history"` | — |

Rules, all from the accepted system:

- **Tabs are hidden during a workout** (`navigation.primary.bottom-tabs`). `/workout` and
  `/summary` show no `BottomTabs`. `/summary` is reached from a workout or from History; it
  is not a tab root.
- **Leaving `/workout` does not end the workout** (`navigation.def.exit-workout`). The close
  action returns to `/today`, where the in-progress card offers "Continue the workout". Only
  Finish ends it.
- **Each route sets `document.title` and moves focus to its `h1`**
  (`navigation.def.titles`). `TopBar`'s `h1` already carries `data-route-focus`; `WorkoutBar`
  has no `h1`, so on `/workout` the `h1` is the exercise name inside `LogSet` and that is the
  focus target.
- **Hierarchy is at most two levels** (`navigation.def.breadcrumbs`). Tab root → detail. No
  breadcrumbs.

---

## 3. `/today`

### 3.1 Purpose

Answer one question in under a second: *what am I doing, and where do I press to start?*

### 3.2 States

Exactly one of these renders. They are mutually exclusive.

| # | State | Condition |
|---|---|---|
| T-1 | Loading | read in flight |
| T-2 | Failed | the device read threw |
| T-3 | Workout in progress | an active session exists |
| T-4 | Plan, ready to start | a plan is on the device and no active session |
| T-5 | No plan | no plan on the device and no active session |
| T-6 | Done for today | a plan is on the device, no active session, and every session scheduled for today is completed |

**T-1 Loading.** `Skeleton label="Loading today's plan"`. Nothing renders for 300 ms first
(`feedback.loading.skeleton-delayed`); the delay lives in `Skeleton`, not in the screen.

**T-2 Failed.** `StatusMessage kind="error" live="assertive"` with the failure text, plus a
`Retry` tertiary action that re-runs the read. **Delta D-9:** as-built has no retry, so a
transient read failure is a dead end.

**T-3 Workout in progress.** `Surface tone="card"`:
- `Heading level={2}` — "A workout is in progress"
- `Text` — "It was saved on this device, with everything recorded so far."
- `Text size="label" tone="muted"` — set count, via `messages.count.sets(n)`. **Delta D-10:**
  the count is already known (`activeSets`) and is the one fact that tells you whether the
  session is worth continuing; show it.
- `ListRow href="/workout" title="Continue the workout"` — the primary path
- `ConfirmDialog` "Discard the workout" — destructive, permanent, so it asks and names what is
  lost; the safe choice ("Keep the workout") is the primary button
  (`controls.destructive.undo-first`, reconciliation 11). As-built is correct.

T-3 takes precedence over T-4: when a workout is running, Today does not offer to start
another one. As-built is correct.

**T-4 Plan, ready to start.** `Surface tone="card"`:
- `Heading level={2}` — the plan's **name**. **Delta D-1:** as-built renders `plan.id`.
- One `li` per scheduled session that is not yet completed: `Text weight="label"` with the
  session's **name** and the date formatted through `formatDate` (**Delta D-2**: as-built
  prints the raw `scheduledFor` string), then the start button.
- **One session (the normal case):** a single `Button variant="primary" size="lg" expand`
  labelled "Start workout".
- **More than one session scheduled for today (rare, Vlad: "possible but rare"):** no
  chooser screen and no new component — rare does not earn a new pattern. Sessions list in
  scheduled order, and each button is labelled `Start {session name}` so the buttons are
  distinguishable by label, not by position (visible label and accessible name match, WCAG
  2.5.3). The **first** is `variant="primary"`; the rest are `variant="secondary"`, so there
  is still exactly one primary per screen (`navigation.def.one-primary`). **Delta D-22.**
- A session that has a completed workout for today drops out of this list. **Delta D-26:**
  as-built lists every session in the plan, so a finished workout can be started again from
  Today with nothing saying it was done.

**T-5 No plan.** `iconography.empty-visual.text-only` — a heading, one sentence, one button.
As-built has a heading and two paragraphs and no button. **Delta D-3:**
- `Heading level={2}` — "No plan on this device yet"
- `Text` — one sentence: "A plan arrives when this device syncs. There is no server to sync
  with yet."
- `Button variant="secondary"` — "See your history" → `/history`. (There is no useful primary
  action here; a tonal button is right, and the empty-state default's "one button" does not
  have to be primary when nothing can be started.)

The second paragraph ("Anything recorded here is saved on the device first…") is true and
worth saying, but it belongs in Settings, not in an empty state that the default caps at one
sentence.

**T-6 Done for today.** Same empty-state shape (`iconography.empty-visual.text-only`):
- `Heading level={2}` — "Today's workout is done"
- `Text` — "Your summary is saved on this device."
- `Button variant="secondary"` — "See your history" → `/history`

With several sessions scheduled, T-6 shows only when all are complete. A completed session's
"Start" button never reappears. No celebration animation, confetti, or streak — the accepted
system has none and this loop is not the place to add one.

### 3.3 Edge cases

- Plan present but with zero scheduled sessions → render T-5 with the same copy. A plan with
  nothing in it is, to the lifter, no plan.
- Active session whose scheduled session is not in the current plan → still T-3. The session
  is the source of truth for "in progress".
- Double-tap on "Start workout" → the button carries `busyLabel="Starting…"` and stays enabled
  (`controls.def.loading`, `controls.def.disabled`). A second press while busy is ignored by
  `Button` itself. As-built is correct.
- Start fails because a session is already active → reload and render T-3. As-built is
  correct and does not need an error message: T-3 explains the situation better than an
  error would.

---

## 4. `/workout`

The focal screen. Everything below serves "log the prescribed set in one press".

### 4.1 Chrome

**Delta D-4: use `WorkoutBar`, not `TopBar`.** `navigation.workout-chrome.minimal-bar` is
explicit — close, "Exercise 2 of 5", sync state, no title. As-built uses
`TopBar title="Workout" back`, which is the *outside-a-workout* bar and is barred from
workout chrome by the same decision. `WorkoutBar` already exists and takes exactly
`{exercise, exercises, sync}`.

- `exercise` = 1-based index of the selected exercise in the prescription list.
- `exercises` = prescription count.
- `sync` = the session's `DisplaySyncState`, falling back to `on-device` when nothing is
  queued (`feedback.sync-indicator.icon-label` requires it to be *always visible*; the
  as-built "Nothing waiting to sync" text is a second vocabulary for the same fact — **Delta
  D-5**, use `SyncIndicator` in the bar and drop the text).
- Close returns to `/today`. It does not end the workout and asks nothing.

With `WorkoutBar` carrying position and sync, the as-built "In progress / Started …" card is
redundant chrome competing with the focal object. **Delta D-6: remove it.** The start time is
not something anyone needs mid-set; it belongs on the Summary.

### 4.2 Exercise selection — **confirmed as chips, with one change**

Confirming the engineer's decision: **chips, not a tablist, not a stepper.**

- A tablist needs roving arrow-key focus and a tabpanel relationship. The accepted system has
  no Tabs primitive, so a tablist is a new component and therefore an OpenSpec change. Not
  worth it here.
- A stepper implies a required order. Exercise order in a session is a suggestion; lifters
  swap and superset. Forcing "next/previous" would make a common case slower.
- Chips are a *choice* over the session's exercises, not navigation between screens, so
  `controls.def.chips` ("not used for navigation") permits them.

**The change: `controls.def.chips` requires the selected chip to show a check icon**, and
`color.accent-strategy.solid-primary` says selection is an ink outline plus a check. As-built
signals selection with `variant="secondary"` and `aria-pressed` only. **Delta D-7:** the
selected chip adds `icon="check"`. `Button` already takes `icon?: IconName`, so this needs no
new component. Keep `variant="secondary"` + `aria-pressed={true}` selected, `tertiary` +
`aria-pressed={false}` unselected — that part is right, and `aria-pressed` on both is what
keeps the state off colour alone.

Layout: `Stack direction="inline" wrap gap={2}`, wrapping to as many rows as needed. 44 px
minimum target, 8 px between adjacent targets (both come from the `Button` md size and
`gap={2}`). Chips sit directly under `WorkoutBar`, above the focal object.

**Hidden for a single-exercise session — confirmed.** A one-item chooser is noise, and the
exercise name is already the `h1` of the focal object, so nothing is lost. `WorkoutBar` still
reads "Exercise 1 of 1"; that is honest and costs nothing.

Selecting a chip resets the log-set controls to that exercise's prescription (as-built
remounts `LogSet` via `key`). Correct: carrying the previous exercise's typed load across
would be exactly the "number nobody prescribed" failure.

### 4.3 The focal object — Set Focus

Unchanged from as-built (`LogSet`), which composes the accepted Set Focus layout: `TwoPane`
with the exercise name (`h1`), "Set n", and a `Surface tone="card"` Target showing
`load × reps` at display size on the focus side; a `Surface tone="panel"` Actual with Side
(unilateral only), load `Stepper`, reps `Stepper`, Load-counts `Segmented` (only where the
plan permits combined load), and `RirPicker` on the detail side.

Confirmed as-built. Specific confirmations:

- **Controls seed from the prescription**, so an as-prescribed set is one press (R-004).
- **"Set n" with no total.** `navigation.progress.pills-text` wants pills and "Set 2 of 4",
  and `SetProgress` exists — but the plan model carries no per-exercise set count, so a total
  would be invented. **Deliberate deviation, recorded:** `SetProgress` is not used in this
  loop, and the label reads "Set n". Revisit trigger: the plan gains a prescribed set count.
  This is the one place this spec knowingly departs from a design-system decision, and it
  departs in the direction principle 2 requires.
- **Target renders `{load} kg × {reps}`** — route it through `formatLoadReps` so the unit,
  the no-break space, and the spoken form come from the catalogue. **Delta D-8:** as-built
  interpolates `{loadKg} kg × {reps}` in the screen, which bypasses `i18n.scope.english-ready`
  and the metric-display constraint.

### 4.4 Log → rest

Confirmed as-built (`LogToRest`): 200 ms crossfade in place, focus moves to the Rest `h1`,
announcement "Set n saved. Rest 1:30." The rest view carries "Set n recorded", a success
`StatusMessage`, a `Button variant="secondary" size="lg" expand` "Next set", and the
`RestTimer` in its own card. Elapsed time derives from a timestamp, so a suspended tab does
not drift.

**Rest length: the plan carries it, per exercise (Vlad, Q-1). Delta D-21.**

- The timer starts at the prescribed rest of **the exercise just logged**, from the same plan
  revision the session started on. Rest is a plan value, so it obeys the same correctness
  rule as load and reps: a revision that has moved yields no prescribed rest.
- **Fallback: 90 s**, used only when the plan carries no rest for that exercise (plans stored
  before this change, an exercise with none set, or a moved revision). Flagging that 90 s is
  *not* a design-system value — the accepted system names no default rest length and
  `defaults.md` has none. It is a design decision I own here: the least surprising number
  when the plan is silent.
- **The screen does not say which it is.** Prescribed or fallback, the rest view reads "Rest"
  and a running clock. Nothing labels 90 s as prescribed and nothing needs to label it as a
  default; the clock is a tool, not a target.
- **No mid-workout override.** Vlad chose plan-carried rest; he did not choose an override, so
  there is no "adjust rest" control and I have not invented one. The lifter's control is
  what it already is: "Next set" is available the moment rest starts, and the end of rest is
  a signal, never a gate. Revisit trigger: a lifter reports needing to lengthen rest in the
  moment — that would be a new question for Vlad, not a design decision.
- Rest is whole seconds, displayed through the existing clock format (`m:ss`).

`Next set` returns to the set view with controls re-seeded from the prescription. The rest
timer never blocks: "Next set" is available the moment rest starts
(`accessibility.def.timing` — rest never forces an action). As-built is correct.

### 4.5 Recorded sets

`SetTable` showing **only the selected exercise's** sets, **renumbered from 1** — confirmed.

Rationale, so QA can test intent and not just behaviour: the set number a lifter holds in
their head is per-exercise ("third set of squats"), never session-wide. The session-wide
sequence is a storage ordering; surfacing it would make the table disagree with the "Set n"
label two inches above it. Renumbering is the only option that keeps those two consistent.

**Delta D-11:** the caption must name the exercise — `Sets recorded for {exercise}` — matching
`/summary`. As-built reads "Sets recorded", which, on a screen where a chip row has just
filtered the table, does not say what was filtered.

Empty (no sets logged yet for this exercise): `SetTable` renders its header and no rows. Do
not substitute an empty-state block; the table's presence is the affordance that says results
land here.

**Every row has an Edit action (Vlad, Q-4: in this slice).** `SetTable` gains an optional
trailing column; `/workout` uses it, `/summary` does not (§5). See §4.8 for the flow.
**Delta D-25.**
- The cell holds `Button variant="tertiary"` with the text "Edit". Text, not an icon: the icon
  set has no pencil, and adding one is a design-system change I am not making for this.
- Visible label "Edit"; accessible name "Edit set {n}, {exercise}" — a screen-reader user
  hears the table row's set, and the visible label is contained in the name (WCAG 2.5.3).
- 44 px minimum target. The column header is visually hidden ("Actions"), not absent, so the
  table stays a valid table.
- The table already scrolls sideways inside its own region at large text sizes; the Edit
  column scrolls with it and the page itself must still not scroll sideways.

### 4.6 Finish

**Delta D-12: the finish action lives in `StickyActionBar`**, not at the end of the scrolling
stack (`layout.primary-action.sticky-bottom`: the action bar sits above the safe area with a
separator). `Screen` already takes `bottom`; on `/workout` that slot is the action bar, not
tabs.

But the *primary* action during a workout is **Log set**, and there is at most one filled
primary per screen (`navigation.def.one-primary`). So:

- Sticky bar contains **Log set**, `variant="primary" size="lg" expand`. This is where the
  thumb is; it is the single most-pressed control in the app.
- **Finish workout** is `variant="secondary"`, at the end of the scrolling content, after the
  recorded-sets table. Ending the session is a once-per-workout action and should not sit
  under the thumb that presses Log set forty times.

This is a change of shape from as-built, where Log set is inline in `LogToRest` and the
primary button at the bottom of the stack is "Done". Both moves follow from the same two
accepted decisions.

**Delta D-13: label and confirmation.** `navigation.def.exit-workout` — "Only 'Finish
workout' ends it, with its own confirmation." Rename "Done" → "Finish workout"
(`content.def.terms`: one term per concept, and the concept is a workout). Add a
`ConfirmDialog`: title "Finish this workout?", body naming what is recorded
(`messages.count.sets(n)` across the session), confirm "Finish workout", cancel "Keep
going". One extra tap, once per session, in exchange for not ending a session by a mis-tap
while reaching for Log set.

On confirm → `/summary?session=…`, replacing history so back does not return to a workout
that has ended.

Finish workout does not render while a set is being edited (§4.8): ending the session from
inside an edit would leave the edit's fate undefined.

### 4.7 Degraded and failure states

| State | Treatment |
|---|---|
| Loading | `Skeleton label="Loading the workout"` |
| Read failed | `StatusMessage kind="error" live="assertive"` + `Retry` |
| No active session | see below |
| **No prescription** (plan revision moved) | see below — **needs design, supplied here** |
| Device full | `StatusMessage kind="warning" live="assertive"` + `Export everything` — as-built is correct and its copy is good; keep it verbatim |
| Log write failed | `StatusMessage kind="error" live="assertive"` — **Delta D-14:** as-built renders `JSON.stringify(result.error)`. A lifter cannot act on a serialised object. Copy: "That set was not saved. Nothing already recorded has been lost." with a `Retry` that re-submits the same values. The raw error goes to diagnostics, not to the screen. |

**No active session** (someone opened `/workout` directly). Empty-state shape — heading, one
sentence, one button:
- `Heading level={2}` "No workout in progress"
- `Text` "Start one from today's plan."
- `Button variant="primary"` "Go to today" → `/today`

As-built uses a `ListRow` here. **Delta D-15:** a `ListRow` is a list affordance; a single
recovery action in an empty state is a button (`iconography.empty-visual.text-only`).

**No prescription — the empty target state.** This is the state the engineer correctly
flagged as having no design. The correctness rule is right and stands: a session started
against plan revision *n* must never be shown targets from revision *n+1*. Here is its
design.

It is a **stale** state, not a warning — `StatusMessage` already has `kind="stale"` with the
`timer-off` icon, and the state matrix's stale copy ("Out of date. The plan changed after
this was made.") is exactly this situation. As-built uses `kind="warning"` with a
three-sentence paragraph and no action.

**Delta D-16.** Specified layout, in place of the `LogSet` block:

```
StatusMessage kind="stale" live="polite"
  text:   "The plan changed after this workout started, so there are no targets to show.
           Everything you have recorded is safe."
  action: Button variant="secondary" — "Log a set anyway"
```

- One sentence of cause, one of reassurance. No third sentence.
- `live="polite"`, not assertive: it is not blocking, and it is present on first render, so
  under the state matrix a static first-render message is not announced at all — it becomes
  polite only if the state is entered while the screen is open.
- **"Log a set anyway"** opens the same `LogSet` control with every field **empty** rather
  than seeded, and no Target card. This is the flow decision the empty state was missing:
  the lifter is standing under a bar and must still be able to record what they did. An
  unseeded control records facts without ever showing a number nobody prescribed.
- The chip row: exercise names come from the *session* (`session.exerciseIds`), which is
  snapshotted at start and therefore still available. Chips still render, still select, and
  still filter the recorded-sets table. Only the *prescription* is missing.
- The recorded-sets table and Finish workout render normally. Nothing already recorded is
  hidden by this state.
- `WorkoutBar` reads "Exercise n of m" from the session's exercise list in this state.
- Editing and deleting recorded sets (§4.8) work unchanged in this state.

### 4.8 Edit or delete a recorded set — **new, in this slice (Q-4)**

`principles.set-focus-scope.logging`: past-set edits share the Set Focus layout and controls.
So editing is not a new screen and not a new form. It is the focal object, in a different
mode. Nothing new is introduced: `LogSet`, `Stepper`, `Segmented`, `RirPicker`,
`StickyActionBar`, `UndoToast`, and `Button` all exist.

**Scope of this slice.** `/workout`, active session only. `/summary` and History stay
read-only. That is my call, not Vlad's: he said "in this slice" and did not say which screens.
Revisit trigger: a lifter wants to correct a set after finishing — that is a question about
reopening a finished session, which touches the sync and history model, and is not free.

**What can change:** load, reps, RIR, side (unilateral only), and whether load counts
(combined-load only) — exactly the controls of the set view. **What cannot:** the exercise,
the position, the time the set was recorded. To fix a set logged against the wrong exercise,
delete it and log it against the right one.

**Edit flow.**
1. Tap "Edit" on a row (§4.5). The focal region — the set view, or the rest view if rest is
   running — is replaced **in place** by the Set Focus layout in edit mode; no crossfade, no
   navigation, no sheet. Instant under reduced motion; otherwise the 100 ms fade-in of the
   set view.
2. Edit mode differs from logging in five ways only:
   - The label reads **"Editing set {n}"**, not "Set {n}". `h1` is still the exercise name
     and receives focus.
   - Actual controls are seeded from **the recorded values**, never the prescription.
   - The Target card stays when a prescription exists, so the lifter can compare; it does not
     seed. With no prescription (§4.7) there is no Target card, as elsewhere.
   - The sticky bar's single primary is **"Save changes"** (`variant="primary" size="lg"
     expand`) in place of "Log set". One primary per screen still holds.
   - Below the controls, in content: `Button variant="secondary"` "Cancel" and
     `Button variant="tertiary"` "Delete set", in that order, both `expand`. Delete is the
     last and quietest control and is not adjacent to Save.
3. **Save changes** writes the change, returns to the view the lifter left (set view or rest
   view), moves focus back to that row's Edit button, and announces "Set {n} updated" via the
   existing live region. Saving with nothing changed closes the edit and writes nothing.
4. **Cancel** returns the same way and discards edits **without a confirmation** — nothing
   recorded is touched, and a confirmation would cost more than the few taps it protects.
5. The **rest clock keeps running** while a set is edited; its elapsed time derives from a
   timestamp (§4.4). If rest ends during an edit, the end signal fires as normal and the
   lifter returns to a finished rest.

**Delete flow — undo-first, no dialog.** A deleted set is reversible, so
`controls.destructive.undo-first` applies: act at once, offer Undo for 10 s. A confirmation
dialog is the answer for permanent deletes only.
1. Tap "Delete set" in the edit view. The set is removed immediately; the view returns as in
   Save, and an `UndoToast` appears with the existing string `messages.set.deleted(n)` —
   "Set 2 deleted" — and **Undo**.
2. The toast sits directly **above** `StickyActionBar`, stacked, never over it: Log set stays
   fully reachable for the 10 s. It belongs to the page, not to `LogSet`, so it survives the
   set → rest → set transitions.
3. **Undo** restores the set with its original values and its original position, announces
   "Set {n} restored", and moves focus to that row's Edit button.
4. **Numbers close up.** Deleting set 2 of 4 leaves 1, 2, 3 (§4.5, renumbering). The toast
   names the number the set *had*; the table shows the new numbering. Undo puts it back.
5. A **second delete** while a toast is showing replaces the toast; the first delete becomes
   final at that moment. Only the most recent delete is undoable. Logging a new set does
   **not** dismiss the toast.
6. Toast expiry or Finish makes the delete final. The toast is paused on hover and focus
   (`UndoToast`, as built).
7. Deleting the **last remaining** set for an exercise leaves the table header alone (§4.5).

**States.**

| State | Treatment |
|---|---|
| Save fails | Stay in edit mode. `StatusMessage kind="error" live="assertive"`: "That change was not saved. The set is unchanged." + `Retry`. No serialised error on screen (D-14). |
| Delete fails | Set stays in the table, no toast. Same `StatusMessage`, copy: "That set was not deleted." + `Retry`. |
| Device full | Same `StatusMessage kind="warning"` + `Export everything` as logging. An edit may need room. |
| Undo fails | `StatusMessage kind="error"`: "That set could not be restored." + `Retry`. The toast has already closed; the message is the only trace. |
| Edit open, page reloaded or left | Edit mode does not persist. Coming back shows the recorded set unchanged. Nothing is lost, because nothing was written. |

**Engineering constraints that come from product rules, not from design taste** (AGENTS.md,
non-negotiable 5, ADR-0003): an edit and a delete are recorded mutations, and the delete must
not vanish if the queue is later replayed. Undo is a compensating action, not an erasure. How
that is modelled is the engineer's decision; the visible behaviour above is what QA tests.

---

## 5. `/summary?session=…`

Confirmed as-built in structure. The query-parameter address is right and the reasoning in
the file is right — one cacheable static route is what makes a summary reachable with no
signal.

**Layout.**
- `TopBar title="Summary" back`
- Header `Surface tone="card"`: `Heading level={2}` "Finished" (or "Still in progress"),
  started and finished times, `SyncIndicator`.
  - **Delta D-2 applies:** format both timestamps through `formatDate`. As-built prints
    `toISOString()`. An ISO string in a summary is the clearest single tell that a screen was
    built for a developer.
  - Add total volume? **No.** `data.charts-v1.defer` and restraint: v1 summaries are tables.
    Not in scope.
- One `Heading level={2}` per exercise, in session order, each followed by a `SetTable`
  captioned `Sets recorded for {exercise}`, renumbered from 1. Confirmed — and note this is
  the same renumbering rule as `/workout`, which is why they agree. **No Edit column here**
  (§4.8): the Summary table is read-only in this slice.
- Footer: `ListRow href="/history" title="Workout history"`. Confirmed — this is a list of
  one destination and a row is right here, unlike the empty states.

**States.**

| State | Treatment |
|---|---|
| Loading | `Skeleton label="Loading the summary"` |
| Missing `session` param, or session not on device | heading "That session is not on this device", one sentence, `Button variant="secondary"` "Go to today". **Delta D-15 applies** (as-built uses a `ListRow`). |
| Failed | `StatusMessage kind="error" live="assertive"` + `Retry` |
| Completed session with zero sets | header card renders; in place of the per-exercise sections, one `Text tone="muted"`: "No sets were recorded in this workout." Do not render empty tables per exercise. **Delta D-17** — as-built renders a captioned header-only table per exercise, which reads as a bug. |
| Session still active | header says "Still in progress" and the footer adds `Button variant="primary"` "Continue the workout" → `/workout`. **Delta D-18** — as-built shows the status but offers no way back into it. |

---

## 6. `/history`

Confirmed as-built in structure.

- `TopBar title="History"`, `BottomTabs current="history"`.
- Completed sessions, **newest first** — confirmed. QA should assert the ordering explicitly;
  it is the one thing on this screen that can silently invert.
- One `ListRow` per session, opening its summary:
  - `title` — the session's **name**, e.g. "Upper A". **Delta D-1 applies:** as-built renders
    `scheduledSessionId`.
  - `detail` — `{n} exercises · {m} sets`, via `messages.count.*` so plurals are correct.
    As-built hand-builds this string; **Delta D-19** — "1 exercises" is reachable.
  - `meta` — the date via `formatDate`. As-built constructs `Intl.DateTimeFormat` inline;
    route it through the catalogue for one formatting vocabulary. **Delta D-20.**
  - Row min height 56 px, chevron because the row opens a screen
    (`navigation.def.list-rows`). Both come from `ListRow`.
- **Empty:** heading "No finished workouts yet", one sentence "Your finished sessions will
  appear here.", `Button variant="primary"` "Go to today". **Delta D-15 applies.**
- Loading: `Skeleton label={messages.states.loadingHistory}`. Failed: error `StatusMessage` +
  `Retry`.

**Edge cases.**
- An active (unfinished) session does **not** appear in History. It appears on Today. This is
  as-built; stating it so QA can test the exclusion.
- Two sessions on the same date → both rows show the same `meta`; order within the date is
  newest-started first.

---

## 7. Cross-cutting: **Delta D-1, identifiers shown as names**

Raised separately because it is the single largest legibility problem in the loop and it
crosses four screens.

Today shows `plan.id`. History shows `scheduledSessionId`. Summary and the workout chips show
`exerciseId`. `readActivePrescriptions` sets `name: exercise.exerciseId` outright.

A lifter glancing at a phone between sets must read "Back squat", not
`ex_7f3a…` or `barbell-back-squat-high-bar`. This fails principle 4 and
`content.def.terms`. It is a design defect regardless of how the data arrives.

**Required behaviour:**
- Every user-visible reference to a plan, session, or exercise renders a human name.
- Where no name exists in the data, render a title-cased, de-slugged form of the identifier
  as a fallback ("barbell-back-squat" → "Barbell back squat"), never the raw string.
- Never render an opaque identifier (UUID, prefixed key) to the user at all. If the fallback
  cannot produce words, render the exercise's position instead ("Exercise 2").

**Decided (Vlad, Q-2): the plan schema carries a name.** So the rule is now two-tier:

1. **A name from the data is always used when present.** The plan has a name; each scheduled
   session has a name ("Upper A"); each exercise has a name ("Back squat"). I read "add a
   name field to the plan schema" as covering all three, because those are the three things
   this loop displays. **Engineer: confirm that reading in the OpenSpec change.** If only the
   plan gets a name, sessions and exercises still need one, or every History row and every
   chip falls to the fallback.
2. **The de-slug fallback above stays**, for data that predates the field and for any name
   that is missing or empty. It is a safety net, not a feature: QA should treat a fallback
   appearing on newly created data as a defect.

**The session snapshot must carry the names**, not look them up from the live plan. A session
is snapshotted at start (§4.7), and it has to keep showing "Back squat" on the chips and in
History after the plan moves on. Otherwise the stale state (D-16) would fall back to
de-slugging exactly where the lifter most needs to trust the screen.

**Design constraints on names** (the data shape — required or optional, exact length limit —
is the engineer's; these are the limits the layouts are drawn for):
- Layouts assume names up to **60 characters**. Please bound the schema at or under that.
- Names **wrap and never truncate** on `/workout` and `/summary`: the exercise `h1`, chip
  labels, table captions. A lifter must read the whole exercise name.
- List rows follow `ListRow` as built.
- Names are plain text. No markup, no emoji requirements.
- Who writes names (the user, an agent proposal) is out of scope here.

---

## 8. Product questions — answered

Vlad answered all four on 2026-09-29 (interaction `ae138f60`). None remain open.

| Q | Question | Answer | Where it landed |
|---|---|---|---|
| Q-1 | Rest length | The plan carries rest, per exercise | §4.4, D-21. No override was chosen, so none is specified. |
| Q-2 | Display names | Add a name field to the plan schema | §7, D-1. I read it as plan, session, and exercise; the engineer confirms. |
| Q-3 | Several sessions in one day | Possible but rare | §3.2, D-22. Handled in the list, no chooser. |
| Q-4 | Edit or delete a recorded set | In this slice | §4.8, D-23 to D-25. `/workout` only; `/summary` stays read-only. |

**Decisions I made that Vlad did not, recorded so they can be overruled:**
- Set edit and delete are on `/workout` only, not on `/summary` (§4.8).
- No mid-workout rest override (§4.4).
- Text-only "Edit" / "Delete set" buttons, because the icon set has no pencil or bin (§4.5).
- Sessions that are already completed today drop off Today, and Today gets a "done" state
  (§3.2, D-26).

---

## 9. Delta list for QA and the engineer

Everything this spec asks to change from as-built. **P1 blocks design-conformance sign-off**
(it contradicts an accepted decision or shows a developer artefact to the user). **P2** is
follow-up.

| # | Screen | Delta | Accepted decision | P |
|---|---|---|---|---|
| D-1 | all | Names from the plan schema (plan, session, exercise), carried in the session snapshot; de-slug fallback only for data without a name; never a raw identifier | `content.def.terms`, principle 4 | P1 |
| D-2 | today, workout, summary | Timestamps through `formatDate`, never `toISOString()` | `i18n.scope.english-ready` | P1 |
| D-3 | today | No-plan empty state → heading + one sentence + one button | `iconography.empty-visual.text-only` | P1 |
| D-4 | workout | `WorkoutBar`, not `TopBar` | `navigation.workout-chrome.minimal-bar` | P1 |
| D-5 | workout | Sync via `SyncIndicator` in the bar; drop the prose fallback | `feedback.sync-indicator.icon-label` | P1 |
| D-6 | workout | Remove the "In progress / Started …" card | `principles.density.split` | P2 |
| D-7 | workout | Selected chip adds `icon="check"` | `controls.def.chips`, `color.accent-strategy.solid-primary` | P1 |
| D-8 | workout | Target through `formatLoadReps` | `i18n.scope.english-ready` | P1 |
| D-9 | today, workout, summary, history | `Retry` on every failed read | `controls.def.validation`, state matrix | P2 |
| D-10 | today | In-progress card shows the recorded set count | — | P2 |
| D-11 | workout | Table caption names the exercise | — | P2 |
| D-12 | workout | Log set in `StickyActionBar`; Finish is secondary, in content | `layout.primary-action.sticky-bottom`, `navigation.def.one-primary` | P1 |
| D-13 | workout | "Finish workout" + `ConfirmDialog` | `navigation.def.exit-workout` | P1 |
| D-14 | workout | Log failure copy is human; no `JSON.stringify` on screen | `content.voice.plain` | P1 |
| D-15 | workout, summary, history | Empty-state recovery is a `Button`, not a `ListRow` | `iconography.empty-visual.text-only` | P2 |
| D-16 | workout | No-prescription stale state + "Log a set anyway" unseeded logging | state matrix, principle 2 | P1 |
| D-17 | summary | Zero-set session shows one sentence, not empty tables | — | P2 |
| D-18 | summary | Active session offers "Continue the workout" | — | P2 |
| D-19 | history | `detail` through `messages.count.*` for plurals | `i18n.scope.english-ready` | P1 |
| D-20 | history | Date through `formatDate` | `i18n.scope.english-ready` | P2 |
| D-21 | workout | Rest timer starts at the plan's rest for the exercise just logged; 90 s only when the plan has none or the revision moved | Q-1 | P1 |
| D-22 | today | Several sessions: `Start {session name}` buttons, first primary, rest secondary | `navigation.def.one-primary`, Q-3 | P2 |
| D-23 | workout | Edit a recorded set in place with the Set Focus layout: "Editing set n", seeded from recorded values, "Save changes" in the sticky bar, Cancel, no Finish while editing | `principles.set-focus-scope.logging`, Q-4 | P1 |
| D-24 | workout | Delete a set with immediate effect and a 10 s `UndoToast` above the action bar; numbers close up; Undo restores value and position | `controls.destructive.undo-first`, Q-4 | P1 |
| D-25 | workout | `SetTable` optional trailing Edit column (text button, accessible name "Edit set n, exercise"); absent on `/summary` | Q-4 | P1 |
| D-26 | today | Completed sessions drop out of the list; new T-6 "done for today" state | — | P2 |

**Confirmed as-built, no change:** chips over tablist/stepper (§4.2); chip row hidden for a
single-exercise session (§4.2); per-exercise set renumbering from 1 (§4.5, §5); 90 s as the
fallback rest (§4.4); the no-prescription *correctness rule* (§4.7 — only its presentation changes); the
`?session=` address (§5); `LogToRest` crossfade and rest content (§4.4); `LogSet` Set Focus
composition (§4.3); Today's in-progress precedence and discard confirmation (§3.2); device-full
copy (§4.7); History's newest-first ordering and row anatomy (§6).

**Known deviation from an accepted decision, deliberate:** `SetProgress` / "Set n of m" is not
used, because the plan carries no set count (§4.3). Revisit when it does.

---

## 10. What QA should test this against

Not a test plan — that is QA's to write — but the assertions this spec means to make
testable:

1. Every state in §3.2, §4.7, §5, §6 is reachable and renders the specified components.
2. No screen in this loop renders an ISO 8601 string, a raw identifier, or serialised JSON.
3. `/workout` renders no `BottomTabs`; `/today` and `/history` do.
4. `/workout` has exactly one `variant="primary"` button at any time.
5. Selected chip: `aria-pressed="true"` **and** a check icon. Unselected: `aria-pressed="false"`.
6. Chip row absent when the prescription count is 1, present when it is 2 or more.
7. Set rows for the selected exercise start at 1 and are contiguous, on both `/workout` and
   `/summary`.
8. With no prescription: stale message, no Target card, chips still present, recorded sets
   still visible, Finish still reachable, and "Log a set anyway" opens an unseeded control.
9. Finishing requires confirming; cancelling returns to the workout with nothing lost.
10. 375 × 667 portrait and 667 × 375 landscape: no horizontal scroll, Log set reachable
    without scrolling.
11. A plan-carried rest of 120 s starts the rest clock at 2:00 for that exercise. With no plan
    rest, or a moved revision, it starts at 1:30. Neither says "prescribed" or "default".
12. Edit: the edit view is seeded from the recorded values, reads "Editing set n", has exactly
    one primary ("Save changes"), and Finish workout is absent. Cancel writes nothing. Save
    with no change writes nothing. The rest clock keeps running throughout.
13. Delete: no dialog; the set leaves the table at once; the toast reads "Set n deleted" and
    sits above, not over, the action bar; remaining rows are 1..k contiguous; Undo restores
    values and position; a second delete replaces the toast and finalises the first.
14. Names: newly created data never shows a de-slugged fallback, a UUID, or a prefixed key.
    Session names survive a plan revision change on the chips and in History.
15. Several sessions today: exactly one primary button on Today; each button's accessible name
    equals its visible label; a completed session has no Start button; all complete shows T-6.
