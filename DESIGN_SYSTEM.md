# Design System: Quiet Performance

**Status: Accepted.** Version 1.0.0, 2026-09-17.

**Decided by:** Vladimir, the owner, by submitting the design-system workbook payload: 65
decisions selected, 0 unresolved, 0 deferred. The payload is kept verbatim in
[docs/design-system/decision-payload.txt](docs/design-system/decision-payload.txt),
SHA-256 `44c665fd0ca1e56d6c61c81badedd06605b5e18f6c4de8a9a8efa12a6183267c`.

**Recorded by:** [ADR-0008](docs/adr/0008-quiet-performance-design-system.md), which supersedes
ADR-0007, [ADR-0010](docs/adr/0010-storybook-is-the-only-design-system-lab.md), and the OpenSpec
change `decide-design-system`.

**Validation: open.** Accepting the decisions unblocks UI work built on them. It does not
validate the critical journeys with the target user (R-022), does not establish WCAG
conformance, and does not close gate G-10. See [Validation status](#validation-status).

## The rule

> **Substantive UI builds on this system and nothing else.** Colour, type, spacing, radius,
> motion, layers, icons, and components come from `apps/web/tokens` and `apps/web/ui`.

"Substantive UI" means anything that expresses a visual language: colour, type scale, spacing,
component styling, iconography, motion, chart styling, or product screens.

Changing this system follows [Change control](#change-control). A change that needs something
this system does not provide proposes it; it does not add it locally.

## Where it lives

| What | Where |
|---|---|
| Rules and decisions | This file |
| Every decision, with implementation and proof | [docs/design-system/decision-matrix.md](docs/design-system/decision-matrix.md) |
| Defaults, deferrals, and reference tables from the workbook | [docs/design-system/defaults.md](docs/design-system/defaults.md) |
| Token source (DTCG 2025.10 JSON) | `apps/web/tokens/*.tokens.json` |
| Generated custom properties and TypeScript table | `apps/web/ui/tokens/` (never edited by hand) |
| Primitives, patterns, icons, catalogue | `apps/web/ui/` |
| Reference screens and their fixtures | `apps/web/ui/reference/` |
| The lab: foundations, component inventory, state matrix, reference screens | Storybook (`pnpm storybook`, built by `pnpm storybook:build`), the only lab (ADR-0010) |
| Icon licences | `apps/web/ui/icons/ICONS_LICENSES.md` |
| Visual baselines | `apps/web/e2e/__screenshots__/{platform}/` |

## Decisions

All 65, grouped as the workbook groups them. Each line is the selected option and what it
means here. The matrix adds where each lives and what proves it. Options marked ¹ are not the
workbook's recommendation; the owner chose them deliberately.

### Principles

- `principles.density.split`: one focal object during a workout; history and settings are plain lists with more rows.
- `principles.set-focus-scope.logging`: live set logging and past-set edits share the Set Focus layout and controls.
- `principles.accent-budget.action-progress`: accent fill only on the one primary button; accent tint for completed progress.

### Typography

- `typography.family.system`: the platform UI font stack, no font download; OS text size applies.
- `typography.numerals.tabular`: `font-variant-numeric: tabular-nums`, so digits never shift.
- `typography.scale.two-tier`: fixed UI tier 13 / 16 / 18 / 22 px in rem; fluid display tier for focal numbers.
- `typography.heading-posture.sentence-semibold`: headings at 600 with −0.01em tracking, sentence case.

### Colour

- `color.neutral.green-grey`: neutrals with a slight green cast.
- `color.accent-strategy.solid-primary`: the primary button is solid green with white text; selection is an ink outline plus a check.
- `color.contrast-target.aa-plus`: 7:1 for loads, reps, the timer, and primary labels; 4.5:1 for other text; 3:1 for non-text.
- `color.focus-ring.blue`: a separate blue used only for focus, #0B57D0 light and #8AB4F8 dark.

### Layout

- `layout.base-unit.four`: spacing 4, 8, 12, 16, 24, 32, 48, 64.
- `layout.wide-screen.centered-column`: one 520 px column, centred; extra space stays empty.
- `layout.primary-action.sticky-bottom`: the action bar sits above the safe area with a separator.
- `layout.landscape.two-pane`: values left, controls and action right; the action stays in view at the bottom of the right pane. At 667 × 375 an ordinary set fits with no scrolling. A unilateral or combined-load set scrolls its controls inside the right pane, above the action and never under it. The session summary, set table and Done sit below and scroll with the page.

### Shape

- `shape.radius.soft`: controls 10 px, cards 14 px, sheets and dialogs 20 px, chips fully round.
- `shape.elevation.tonal`: lighter surfaces lift; shadows only on sheets, dialogs, and toasts.
- `shape.card-policy.focal-groups`: one card for the focal object or rest timer; inputs share a sunken panel; lists are plain rows.

### Controls

- `controls.button-hierarchy.filled-tonal-text`: primary solid accent, secondary neutral tonal, tertiary text.
- `controls.adjust.flank-stepper`: − and + at 48 px either side of a value you can also type.
- `controls.rir.segmented`: one row 0, 1, 2, 3, 4+; the choice is raised with a check; helper text below.
- `controls.field.outlined-label-above`: persistent label above, 1 px border at 3:1, focus ring, helper and error below.
- `controls.destructive.undo-first`: reversible deletes act at once with Undo for 10 s; permanent ones ask in a dialog.

### Navigation

- `navigation.primary.bottom-tabs`: three labelled tabs, hidden during a workout.
- `navigation.workout-chrome.minimal-bar`: close, "Exercise 2 of 5", sync state; no title.
- `navigation.progress.pills-text`: a numbered pill per set, a check when done, and "Set 2 of 4".
- `navigation.overlay.sheet`: a bottom sheet with handle, title, and close; focus stays inside; back closes it.

### Feedback

- `feedback.sync-indicator.icon-label`: icon plus "On device", "Syncing", or "Needs attention", visible on every screen that shows a workout read from the device. While loading, with no session, or after a failed read it is absent: nothing has been read, so no persistence is claimed.
- `feedback.set-saved.inline-rest`: the pill gets a check and rest opens in place; a screen reader hears "Set 2 saved. Rest 1:30."
- `feedback.loading.skeleton-delayed`: nothing for 300 ms, then static blocks in the final shape; no shimmer.

### Motion

- `motion.character.minimal`: short fades and position changes, 150–250 ms, ease-out; press is a colour change.
- `motion.log-to-rest.crossfade`: a 200 ms fade in place; focus moves to the rest heading.
- `motion.rest-timer.ring-stepped`: the ring moves in 1 s steps with the numbers.

### Iconography

- `iconography.style.outline-lucide`: Lucide outline icons, stroke 1.75, round caps and joins.
- `iconography.labels.known-only`: only back, close, and more may be icon-only, with an accessible name.
- `iconography.empty-visual.text-only`: an empty state is a heading, one sentence, and one button.

### Data

- `data.charts-v1.defer`: no charts in v1; summaries and tables only. Chart rules are kept for later.
- `data.set-table.aligned-table`: columns Set, Load, Reps, RIR; tabular, right-aligned, real table markup.
- `data.comparison.delta-text`: "+2.5 kg vs last" with an up or down arrow in a neutral colour.

### Content

- `content.voice.plain`: short verbs and facts. "Log set." "Set 2 saved." "Rest 1:30."
- `content.rir-help.helper-sheet`: "Reps you could still do" under the control; a button opens the RPE mapping.
- `content.agent-attribution.text-tag`: a neutral "From agent" tag with a date line; no provider name.

### Accessibility

- `accessibility.targets.tiered`: 44 px minimum everywhere; 48 px for steppers, RIR, and the primary action in a workout.
- `accessibility.timer-announce.milestones`: polite announcements at start, at 10 s left, and at the end.
- `accessibility.testing.auto-only` ¹: axe and automated checks in CI are the routine baseline. See [Accessibility](#accessibility): this does not waive the manual checks R-007 requires before any conformance claim.

### Theme

- `theme.first-visit.light-then-choice`: light on first visit regardless of the OS; Settings offers Light, Dark, System.
- `theme.dark-surfaces.tonal-lift`: dark bg #101311, surface #181C19, raised #212622.

### Tokens

- `tokens.tiers.two-tier`: core values, then semantic roles; components use only semantic tokens.
- `tokens.naming.category-role`: `--color-surface-raised`, `--space-4`, `--radius-control`, `--motion-base`.
- `tokens.source.dtcg-json`: DTCG JSON is the source; a small script generates CSS custom properties and a TypeScript type.
- `tokens.component-api.closed-variants`: closed `variant` and `size` props; no `className` on primitives; layout by composition.

### Governance

- `governance.lab.storybook` ¹: Storybook is the only lab (ADR-0010), with the accessibility addon; viewport and interaction tools are built in. Stories live beside the components in `apps/web/ui`, one component per file.
- `governance.visual-regression.two-viewport`: 375 × 667 and 1280 × 800, light and dark, the state matrix and key screens, 0.1 % threshold.
- `governance.change-control.tiered`: foundation changes need an ADR and OpenSpec; component API changes need OpenSpec; fixes need a PR note and baseline.

### Brand

- `brand.name.plain-text`: "Workout Logger" in the UI font at 600; no logo lockup.
- `brand.app-icon.bars`: three rounded bars of rising height on the accent green.
- `brand.launch.manifest-plain`: the OS splash from the manifest background #EDF0EC and the icon; nothing else.

### Platform

- `platform.display-mode.standalone`: no browser UI; the app provides its own back; safe-area insets apply.
- `platform.number-entry.native-decimal`: `inputmode="decimal"`; the field scrolls clear of the keyboard and sticky bar.

### Internationalisation

- `i18n.scope.english-ready`: all strings in one catalogue with plurals; Intl formatting from day one.
- `i18n.rtl.logical-now`: logical CSS properties now; directional icons mirror; no RTL QA in v1.

### Documentation

- `docs.source.repo-md-lab`: this file for rules, `apps/web/tokens` for values, Storybook for live examples (the lab moved from `/lab` to Storybook by owner decision, ADR-0010).
- `docs.examples.coded-screens`: Set Focus, Rest, History, Settings, Empty, and Error built from real components with fixtures, as `Reference screens` stories.

### Performance

- `performance.budget.moderate` ¹: CSS at most 50 KB gzip; at most one font file of 60 KB (none ships); icons at most 15 KB.

### Haptics

- `haptics.rest-end.vibrate-optional-sound`: a short vibration at rest end where supported; an optional tone, off by default; the visual change always.

## Inherited constraints

These came from accepted discovery decisions before this system existed. The system satisfies
them; they were never open choices.

| Constraint | How it is met | Proof |
|---|---|---|
| Phone-first: at 375 × 667 the exercise, target and actual, sync state, and log action are usable with no horizontal scroll (R-004) | Set Focus composition; the sticky action bar | test:visual phone projects; no-overflow tests |
| One primary action to accept an unchanged prescribed set (R-004) | "Log set" is the only primary button on Set Focus | test:visual set-focus |
| WCAG 2.2 AA target, 44 × 44 px in-workout targets (R-007) | 44 px floor, 48 px workout tier | accessibility.spec.ts target tests |
| Three sync states distinguishable without colour (R-010) | distinct icon and words per state | design-system.spec.ts state test |
| Metric display by default (resolved decision 3) | kg with a no-break space | format.test.ts |
| RIR by default, derived RPE read-only (resolved decision 4) | RIR segmented control; RPE only in the help sheet | test:visual rir-help |
| Automated scans cannot establish conformance (R-007) | manual matrix below remains required | open, see Validation status |

## Tokens

**Tiers.** Core tokens (`core.tokens.json`) hold raw values, named by family and step, where a
larger step is always darker; `green-700` is the accent the decision names. Semantic tokens
(`semantic.tokens.json`, `semantic.light.tokens.json`, `semantic.dark.tokens.json`) name roles.
Only semantic tokens become custom properties, so no component can reach a raw value.
Component tokens are added only when two themes need them.

**Format.** DTCG Format Module 2025.10: sRGB colour objects with hex, dimension and duration
objects, `cubicBezier`, `fontFamily`, `fontWeight`, `number`, `shadow`, and `{group.token}`
references. `apps/web/tokens/build-tokens.mjs` validates references, types, cycles, and that
every hex agrees with its components, then writes `apps/web/ui/tokens/tokens.css` and
`tokens.generated.ts`. A test fails when either output drifts from the source.

**Names.** `--color-*`, `--space-0` … `--space-8`, `--radius-control|card|sheet|pill`,
`--font-size-label|body|title|heading|display`, `--font-weight-*`, `--line-height-*`,
`--tracking-*`, `--motion-fast|base|slow|skeleton-delay`, `--ease-standard|exit`, `--layer-base|sticky|sheet|dialog|toast`,
`--target-min|workout|gap|rir-segment|row`, `--icon-inline|body|button|stroke`, `--focus-width|offset`,
`--shadow-overlay`, `--layout-*`. No vendor, model, or provider names.

### Colour roles

| Role | Light | Dark |
|---|---|---|
| --color-bg | #EDF0EC | #101311 |
| --color-surface | #F9FAF8 | #181C19 |
| --color-surface-raised | #FFFFFF | #212622 |
| --color-surface-sunken | #E3E8E4 | #0B0D0C |
| --color-ink | #18201B | #EEF1EF |
| --color-ink-muted | #4F5C55 | #A9B3AC |
| --color-border | #D4DAD5 | #2E3530 |
| --color-border-strong | #7D8982 | #75807A |
| --color-accent | #275F3C | #8FD1A5 |
| --color-accent-hover | #1F4F31 | #A6DDB8 |
| --color-accent-pressed | #183F27 | #79BF91 |
| --color-accent-soft | #DCE8DF | #1F3527 |
| --color-accent-soft-ink | #1F4B30 | #BFE6CB |
| --color-on-accent | #FFFFFF | #0D2416 |
| --color-focus | #0B57D0 | #8AB4F8 |
| --color-success / -soft | #2B6A43 / #DDEBE0 | #8FD1A5 / #1D3325 |
| --color-warning / -soft | #7A5000 / #F6E7C8 | #E9BE62 / #3A2E14 |
| --color-danger / -soft | #B3261E / #F7DEDB | #F2B8B5 / #3F1F1D |
| --color-info / -soft | #235C8C / #DCE7F1 | #9CC3E6 / #1B2C3B |
| --color-offline / -soft | #505B55 / #E2E6E3 | #B7C0BA / #262B28 |
| --color-scrim | ink at 45 % | black at 68 % |

### Contrast

Computed from the generated tokens by `apps/web/tokens/tokens.test.ts`, which asserts every
pair below (and more) in both themes.

| Pair | Minimum | Light | Dark |
|---|---|---|---|
| ink on bg | 7:1 | 14.49:1 | 16.44:1 |
| ink on surface | 7:1 | 15.90:1 | 15.15:1 |
| ink on surface-raised | 7:1 | 16.65:1 | 13.53:1 |
| ink on surface-sunken | 7:1 | 13.42:1 | 17.14:1 |
| ink-muted on bg | 4.5:1 | 6.10:1 | 8.66:1 |
| ink-muted on surface-raised | 4.5:1 | 7.01:1 | 7.13:1 |
| ink-muted on surface-sunken | 4.5:1 | 5.65:1 | 9.03:1 |
| on-accent on accent | 7:1 | 7.53:1 | 9.24:1 |
| on-accent on accent-hover | 7:1 | 9.46:1 | 10.66:1 |
| on-accent on accent-pressed | 7:1 | 11.80:1 | 7.55:1 |
| accent on surface | 4.5:1 | 7.19:1 | 9.71:1 |
| accent-soft-ink on accent-soft | 4.5:1 | 7.90:1 | 9.64:1 |
| border-strong on surface | 3:1 | 3.47:1 | 4.20:1 |
| border-strong on surface-raised | 3:1 | 3.64:1 | 3.75:1 |
| focus on bg | 3:1 | 5.56:1 | 8.87:1 |
| focus on surface-raised | 3:1 | 6.39:1 | 7.30:1 |
| success on surface | 4.5:1 | 6.18:1 | 9.71:1 |
| warning on surface | 4.5:1 | 6.74:1 | 9.85:1 |
| danger on surface | 4.5:1 | 6.24:1 | 10.09:1 |
| info on surface | 4.5:1 | 6.73:1 | 9.32:1 |
| offline on surface | 4.5:1 | 6.76:1 | 9.24:1 |
| ink on danger-soft | 7:1 | 13.02:1 | 12.96:1 |
| ink on warning-soft | 7:1 | 13.62:1 | 11.68:1 |

Light border-strong on surface-sunken is 2.93:1, below 3:1. So an outlined control is never
drawn directly on a sunken panel: it carries the raised fill, and its boundary is measured
against that. A test records the restriction.

## Type, space, and shape

| | Values |
|---|---|
| Family | `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`; iOS follows Dynamic Type through `font: -apple-system-body` |
| UI sizes | label 13 px, body 16 px, title 18 px, heading 22 px (all in rem) |
| Display | `clamp(2.5rem, 12vw, 4rem)`, weight 700, line height 1.05, tracking −0.03em |
| Weights | 400 body, 500 labels, 600 headings and buttons, 700 display numbers |
| Line heights | 1.5 body, 1.3 labels, 1.2 headings, 1.05 display |
| Spacing | 0, 4, 8, 12, 16, 24, 32, 48, 64 |
| Gutters | 16 px below 400 px, 20 px from 400 px, 24 px from 600 px, plus safe-area insets |
| Breakpoints | 400, 600, 1024 px; landscape phone when height is at most 500 px |
| Radius | control 10, card 14, sheet and dialog 20, pill full |
| Targets | 44 px minimum, 48 px in a workout, 56 px RIR segments and list rows, 8 px between workout targets |

## Components

The inventory is the Storybook sidebar, filed as `Foundations`, `Primitives`,
`Patterns/{Navigation, Workout, Feedback, Data, Settings, Proposals, Layout}`, and
`Reference screens`, one component per story file; a unit test fails when an exported component
has no story or a story is misfiled. Primitives take
closed variant props and no `className` or `style`; screens compose them and import only from
`apps/web/ui`. `Stack` is the layout-only escape hatch. A visual override needs an ADR note and
a follow-up to add a variant or remove the override.

| Component | Kind | Variants and states |
|---|---|---|
| Button | Primitive | primary, secondary, tertiary; md, lg; busy ("Saving…", stays enabled) |
| IconButton | Primitive | back, close, more only |
| Stepper | Primitive | load (2.5 kg), reps (1); typeable spinbutton |
| Segmented | Primitive | native radios; selected raised with check |
| NumberField | Primitive | default, helper, error with icon and thicker border |
| Switch | Primitive | On and Off in words |
| Surface | Primitive | card, panel, plain |
| Heading, Text, Value | Primitive | levels 1–3; body, label, title; display, heading, title |
| ListRow | Primitive | title, detail, meta |
| Skeleton | Primitive | delayed static blocks |
| Sheet | Primitive | handle, title, close; Escape, back, scrim tap |
| ConfirmDialog | Primitive | question title, result-named actions |
| SyncIndicator | Pattern | on device, syncing, needs attention, offline |
| StatusMessage | Pattern | success, warning, error, offline, stale, conflict; optional retry |
| SetProgress | Pattern | numbered pills, check when done, "Set n of m" |
| SetTable | Pattern | complete and missing values; scrolls in its own region |
| Delta, AgentTag | Pattern | up, down, same; tag with date line |
| RestTimer | Pattern | stepped ring, milestone announcements, end signal |
| RirPicker | Pattern | helper line and help sheet |
| LogToRest | Pattern | crossfade to rest in place, focus to rest heading |
| UndoToast | Pattern | 10 s, paused on hover or focus |
| ThemeSetting, FeedbackSettings | Pattern | Light, Dark, System; vibration, rest tone |
| TopBar, WorkoutBar, BottomTabs, StickyActionBar | Pattern | app and workout chrome |
| StickyActionBar | Pattern | a region labelled Actions, so landmark navigation reaches it |
| ProposalReview | Pattern | base revision, diff in words, plain-text rationale, creation time |
| Screen, TwoPane | Pattern | centred column, landmarks; landscape two-pane |

**Reference screens** (`Reference screens/*` stories): plan, set focus, RIR help, rest, workout
summary, history, settings, empty history, sync error, proposal review, stale proposal, and the
state matrix. The six named by `docs.examples.coded-screens` are all present; plan, summary, RIR
help, and the proposal screens are added because R-007 and the agent-proposals specification
name them.

## State matrix

The source for copy, icon shape, tone, and announcement of every state is the table in
[defaults.md](docs/design-system/defaults.md), Feedback. The `Reference screens/State matrix`
story renders every cell. No
state relies on colour: each pairs an icon shape with words, and an error adds a thick border.
Only a blocking error is announced assertively; everything else is polite or silent.

## Motion

| Token | Value | Use |
|---|---|---|
| --motion-fast | 100 ms | press feedback; each half of the log-to-rest crossfade |
| --motion-base | 200 ms | position changes such as the switch thumb |
| --motion-slow | 300 ms | reserved for larger position changes |
| --motion-skeleton-delay | 300 ms | nothing shows for this long before a skeleton |
| --ease-standard | cubic-bezier(0.2, 0, 0, 1) | entering |
| --ease-exit | cubic-bezier(0.3, 0, 1, 1) | leaving |

Allowed: opacity, transform, and colour. No layout animation, no loops, no flashing. The rest
ring steps once per second. With `prefers-reduced-motion: reduce`, every transition and
animation becomes instant; the rest timer still steps, because its steps are state, not
decoration. A pressed state appears within 100 ms.

## Accessibility

- **Target:** WCAG 2.2 AA with the AA+ contrast and 44/48 px targets above.
- **Focus:** a 3 px ring in the focus colour with a 2 px offset; never hidden by the sticky bar
  (scroll padding); returns to the trigger when an overlay closes.
- **Landmarks:** a header, main, and navigation where tabs show; one h1 per screen; a skip link.
- **Screen readers:** values with units in words ("80 kilograms"); pills read "Set 1, done";
  timer milestones only.
- **Reflow and orientation:** 200 % text and 320 px with no sideways scroll; tables scroll in
  their own focusable region; portrait and landscape both work.
- **Forced colours and contrast preference:** system colours with real borders; increased
  contrast turns muted ink to ink and borders to strong borders.

**Testing depth (`accessibility.testing.auto-only`).** The owner chose automated checks as the
routine CI baseline: every axe rule on every story at 375 and 1280 px and on the product routes,
in both themes, plus automated target,
focus, reflow, landmark, and reduced-motion checks. This is a choice about what runs on every
change. It does not waive R-007: automated scans cannot establish conformance, so no
conformance claim may be made until the manual matrix below has been performed and recorded.

| Environment | Viewport | Flows |
|---|---|---|
| iOS Safari + VoiceOver | 375 × 667 | start workout, log set, adjust load, pick RIR, rest, edit set, undo delete, sync error |
| Android Chrome + TalkBack | 360 × 800 | same |
| macOS Safari, keyboard only | 1280 × 800 | same |
| Windows Edge, forced colours | 1280 × 800 | same |
| Chrome, 200 % text and 400 % zoom | 320 px | same |
| Any, reduced motion | 375 × 667 | same |

## Theme

First visit is light. Settings offers Light, Dark, and System, stored on the device. An inline
script in `<head>` applies the stored choice, `color-scheme`, and the theme colour before first
paint; a test proves it works with every application script blocked. Both themes meet the same
contrast target and are in the same visual matrix.

## Identity and platform

The manifest names the app "Workout Logger", displays standalone, launches on #EDF0EC with the
bars icon, and locks no orientation. Icons: SVG, 32 px, 180 px Apple touch, 192 and 512 px,
512 px maskable with the bars inside the safe zone, and a monochrome SVG. They are original
artwork generated by `apps/web/tools/build-icons.mjs`. Declaring them is not the same as a
phone offering installation, which is verified only on a device.

## Visual regression

| Project | Viewport | Theme | Text |
|---|---|---|---|
| visual-phone-small-light, -dark | 375 × 667 | light, dark | 100 % |
| visual-phone-small-light-text200 | 375 × 667 | light | 200 % |
| visual-phone-large-light, -dark | 412 × 915 | light, dark | 100 % |
| visual-wide-light, -dark | 1280 × 800 | light, dark | 100 % |

The product routes and every reference screen story are captured in every project, and every
foundation, primitive, and pattern story at the small phone in both themes: 282 files per
platform, including the colour-vision and forced-colours renders and the accessibility-tree
snapshots. The threshold is 0.1 % of pixels. Fixtures pin time (2026-09-14 10:00 UTC through
the page clock), data (`apps/web/ui/reference/fixtures.ts`), browser (the Chromium build pinned by
`@playwright/test`), animations (disabled), the caret (hidden), time zone, and locale.

**Fonts are pinned per platform, not across OS versions.** The accepted system uses the
platform's own UI font, so baselines are stored per platform and captured after
`document.fonts.ready`. An operating-system update that changes the system font can move
pixels; that shows up as a visual diff to review, not as silent drift. A test-only font was
rejected because it would stop the baselines showing the accepted rendering.

A repeatability test renders every target twice in fresh contexts, one test per target, and
requires identical bytes; `toHaveScreenshot` alone cannot prove that. It proves determinism
within a run on one machine, not across machines.

`pnpm test:visual` never writes a baseline, so a missing one fails. `pnpm visual:update`
writes them, and its output may be committed only in a dedicated visual-change PR that the team
approves under the baseline rule in AGENTS.md § Working on UI.

**Darwin and Linux baselines both exist.** Linux baselines were generated in
`mcr.microsoft.com/playwright:v1.63.0-noble` (linux/amd64) only after every target rendered
identically twice in every project, and `CI=1 pnpm verify` passes every gate in that image. CI's
verify job runs in the same image, pinned by digest. `verify` runs on the public remote and passed
on `main` (run 36966526528, 2026-10-02).

**Current baselines are provisional.** They were committed before any PR flow exists, so they have
not had a visual-change PR approval. Under `AGENTS.md`, the team approves baselines (independent
review agent plus QA agent), not the owner.

## Change control

| Change | Needs |
|---|---|
| Foundation: token tier, palette, type, spacing, motion | an ADR and an OpenSpec change |
| New component or component API change | an OpenSpec change |
| Fix | a PR note, and an updated baseline if pixels move |

Versioning is semantic, recorded here: major for a token rename or removal, minor for a new
token or component, patch for a fix. Deprecated tokens and props are marked with their
replacement and kept for one minor version. Vladimir owns foundations and approvals; agents
propose through OpenSpec. The system is reviewed at each milestone and after every 10 merged
UI PRs. Code and the Storybook lab are the source of truth; differences from the workbook mockups are
logged below, then resolved.

## Reconciliation log

Where the accepted inputs disagreed, or needed interpretation, this is what was done.

1. **Dark scrim.** The default says "scrim 45 % ink". In dark, ink is near-white, so 45 % ink
   would brighten the page. Light uses ink at 45 %; dark uses black at 68 %, the value the
   workbook's own dark preview renders.
2. **Outlined controls on sunken panels.** Light border-strong on surface-sunken is 2.93:1.
   Controls in a panel carry the raised fill, so their boundary meets 3:1 against it.
3. **Field focus width.** `controls.field.outlined-label-above` says "focus adds 2 px ring";
   the accessibility focus default says 3 px. The stricter 3 px applies everywhere.
4. **Display size units.** The decision states `clamp(40px, 12vw, 64px)`; the text-scaling
   default requires rem, so it is `clamp(2.5rem, 12vw, 4rem)`, equal at default text size.
5. **Plural syntax.** Messages use ICU plural syntax through a small in-repo formatter that
   supports only arguments and plurals and fails loudly on anything else. No MessageFormat
   dependency is added.
6. **Visual matrix.** The decision's 375 × 667 and 1280 × 800 in both themes are kept. A
   412 × 915 large phone and 200 % text are added because R-007 requires them.
7. **Token names.** The workbook palette table labels some roles `--color-raised` and
   `--color-muted`; `tokens.naming.category-role` gives `--color-surface-raised`, which is used.
   The roles map one to one.
8. **Landmarks versus hidden tabs.** The landmarks default asks for navigation on every screen;
   `navigation.primary.bottom-tabs` hides tabs during a workout. The selected option wins.
9. **Dark borders.** "Borders only on inputs" governs surfaces. List and table separators are
   hairline separators under the separators default, not surface borders.
10. **Accent budget.** Completed pills use the accent tint; the current tab, selected segment,
    switch on-state, and native radios use ink, so the only accent fill is the primary button.
    The native-controls default says `accent-color`; the ink tint is applied through it, because
    `color.accent-strategy.solid-primary` makes selection ink.
11. **Confirm dialog emphasis.** The safe choice ("Keep history") is the primary button; the
    permanent action is secondary.
12. **Stale icon.** The matrix asks for a clock with a slash. Lucide has none; `timer-off` is used.
13. **Core step labels.** Only `green-700` was named. The other steps are derived so that a larger
    step is always darker, and a test enforces it.
14. **Retry copy.** The state matrix labels the button "Retry"; the catalogue uses it.
15. **Stepper increments and precision.** `controls.adjust.flank-stepper` takes its increment
    from plate settings, which do not exist yet; the load step is 2.5 kg until the settings
    feature supplies it. A typed load snaps to 0.25 kg under the precision default, so "81,3"
    becomes 81.25. The rounding is currently silent; saying so beside the field is feature work.
16. **Crossfade.** The set view fades out and rest fades in, 100 ms each (200 ms in total).
17. **Feature defaults.** Defaults that describe feature behaviour (wake lock during a workout,
    the Install app row after a second workout, theme sync to a signed-in profile, sync retry
    back-off, announcing syncing after 10 s) bind the feature change that builds that behaviour.
    They are not implemented by this change.

## Validation status

Accepted is not validated. These remain open, and nothing here claims otherwise. **This table
is the canonical list.** Gate G-10, ADR-0008, and the OpenSpec change refer to it rather than
repeating it. G-10 closes only when every row has a dated, attributed evidence line; a guardrail
test enforces that.

| Item | State | What closes it |
|---|---|---|
| Target user has used the critical journeys (R-022) | **Not performed.** The journeys are not built; Storybook uses fixtures. | Vladimir uses the first vertical slice's journeys and the evidence is recorded |
| Manual accessibility matrix (R-007) | **Browser evidence recorded; people and devices not.** `test:a11y` keeps accessibility-tree snapshots of every reference screen, keyboard-only walks through logging, retry, undo, and proposal decisions, forced-colours and 200 % text / 320 px checks, and every axe rule on every story. VoiceOver, TalkBack, Windows forced colours, and a keyboard user on macOS Safari have not been run. | Each row of the matrix above run by a person with that technology, recorded |
| Colour-blind simulation check (colour-blind default) | **Simulated; not reviewed by a person.** `pnpm test` checks every contrast pair as seen with deuteranopia, protanopia, and achromatopsia (Machado 2009); `test:visual` keeps renders of the state matrix, set focus, and proposal review under Chromium's emulation of each, and under forced colours. Nothing depends on hue alone. | A person reviews those renders, recorded |
| Proposal review UX and its baselines | **Minimum implemented.** The review content the agent-proposals specification requires is built from accepted components as `Reference screens/Proposal review` and `Stale proposal`, with baselines and behaviour tests. Any richer review UX is a first-slice decision. | Nothing further for the design system |
| Linux baselines for CI | **Verified in CI.** Linux baselines come from the pinned Playwright image after a byte-identical repeatability pass, `CI=1 pnpm verify` passes every gate in that image, and the verify workflow runs in it by digest. `verify`, including `browser-visual`, passed on `main` in GitHub Actions (run 36966526528, 2026-10-02). | Nothing further for this row; kept here until G-10 closes |
| Approval of baselines | **Partly approved, by direct review.** On 2026-09-18 Vladimir reviewed the baseline artifact and approved the 56 product-route baselines (today, workout, summary, diagnostics x 7 projects x darwin and Linux) as committed through `edf4c1b`. That is 56 of the 620 tracked baselines: the 564 design-system baselines are NOT covered, and the approval does not extend to any later change to those 56. No visual-change PR exists for the other 564. | The team approves the remaining baselines and future baseline changes in visual-change PRs, per `AGENTS.md` |
| Storybook (`governance.lab.storybook`) | **Implemented, and the only lab (ADR-0010).** Implemented 2026-09-17 from the owner-approved change: storybook, @storybook/nextjs-vite, and @storybook/addon-a11y 10.6.0 with vite 8.3.0. esbuild@0.28.2 is the only lifecycle script allowed. The licence gate passes (541 components, no new exception) and the audit gate reports no advisories. `pnpm storybook:build` runs in `pnpm verify`; `pnpm test` pins one story per component in the agreed hierarchy; `test:e2e` renders every story and keyboard-tests the interactive ones; `test:a11y` runs every axe rule on every story at 375 and 1280 px in both themes. | Nothing further; kept here until G-10 closes |
| Installation offered on a real phone | **Not verified.** | iOS and Android device check, recorded |
| Vibration and rest tone on a device | **Not verified.** | Device check, recorded |
| Interaction to Next Paint under 200 ms | **Lab measured; field unmeasured.** `test:e2e` measures set-screen interactions with the Event Timing API at a 4x CPU slowdown and requires under 200 ms (worst 24 ms on 2026-09-17). Layout shift is measured (under 0.05). | A field measurement on a real phone, recorded |
| App icon legibility at 16 px | **Judged by eye only.** | Owner review of the rendered favicon |

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-09-17 | Quiet Performance accepted from the owner's 65-decision payload |

See [ADR-0008](docs/adr/0008-quiet-performance-design-system.md).
