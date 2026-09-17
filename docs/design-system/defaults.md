# Design-system defaults, deferrals, and reference tables

The owner's submitted payload selects 65 decisions. Alongside each section, the workbook the
owner decided in carried **defaults** (adopted unless a decision says otherwise), **deferrals**
(explicitly out of scope for v1, with the trigger to revisit), and **reference tables**. They
are recorded here as extracted from the rendered workbook, so the accepted system is complete
without re-opening it. 146 defaults, 22 deferrals.

Where a default and a selected option disagree, the selected option wins, and the
reconciliation is logged in [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md), Reconciliation log.
A default describing feature behaviour (for example the install row after a second workout,
or the screen wake lock during a workout) binds the feature change that builds it; it is not
implemented by the design-system change.

## Principles
- **Four principles** (principles.def.values). Calm: one focal object in a workout. Technical clarity: exact numbers, units always shown. Restraint: no decoration without a job. Trust: state of every saved set is visible.
- **Hierarchy order** (principles.def.hierarchy). Current action, then current values, then context (exercise, set number), then history.
- **One primary action per screen** (principles.def.one-primary). Only one filled accent button is visible at a time.
- **No decoration** (principles.def.decoration). No gradients, glass effects, decorative loops, badges without meaning or icon boxes.
- **Deferred.** **Marketing site personality** (principles.later.marketing). Revisit when a public landing page is planned.

## Typography
- **Weights** (typography.def.weights). 400 body, 500 labels, 600 headings and buttons, 700 display numbers. No other weights.
- **Line heights** (typography.def.line-height). 1.5 body, 1.3 labels, 1.2 headings, 1.05 display numbers.
- **Letter spacing** (typography.def.tracking). 0 for body. −0.01em headings. −0.03em display numbers. No positive tracking on sentence-case text.
- **Long text** (typography.def.long-text). Exercise names wrap to 2 lines in Set Focus, never truncate there. Lists clamp to 2 lines and show the full name on the detail screen. Notes wrap with overflow-wrap: anywhere.
- **Text scaling** (typography.def.zoom). All text sizes in rem. No fixed heights on text containers. Layout checked at 200% text and 400% zoom (320 CSS px).
- **OS text size (Dynamic Type, Android font scale)** (typography.def.os-scaling). Android Chrome applies the OS font scale to rem text. iOS Safari does not; on iOS the root size follows the OS setting through font: -apple-system-body with a @supports guard. Checked at the largest OS size.
- **Minimum size** (typography.def.min-size). 13 px for secondary labels. 16 px for inputs to stop iOS zoom on focus.
- **Licensing and delivery** (typography.def.license). System fonts need no license. If a bundled font is chosen: OFL only, self-hosted WOFF2, font-display: swap, entry in the license ledger.
- **Deferred.** **Custom brand typeface** (typography.later.brand-face). Revisit only if a brand identity project starts.

## Color
- **Semantic roles** (color.def.roles). bg, surface, surface-raised, surface-sunken, ink, ink-muted, border, border-strong, accent, accent-hover, accent-pressed, on-accent, focus, success, warning, danger, info, offline. Each status has a soft fill role.
- **Color-blind safety** (color.def.colorblind). No state uses color alone. Status pairs color with icon shape and text. Success shares the green family with the accent, so success always carries a check icon and text. Success and danger never appear as a red/green pair without text. Checked with deuteranopia and protanopia simulation.
- **Forced colors** (color.def.forced). In Windows high contrast, components use system colors (Canvas, CanvasText, Highlight, ButtonText). Every control keeps a real border so it stays visible. Only swatches use forced-color-adjust: none.
- **prefers-contrast: more** (color.def.more-contrast). Muted ink maps to ink. Border maps to border-strong.
- **Offline and sync colors** (color.def.sync). Saved on device: offline neutral. Syncing: info. Needs attention: warning. Shape and text always differ too (see Feedback).
- **Deferred.** **Display P3 accent** (color.later.p3). Revisit after launch if the accent looks dull on wide-gamut screens.
- **Deferred.** **User-selectable accent** (color.later.user-accent). Not planned for v1. Revisit on user request.

| Role | Token | Light | Dark |
|---|---|---|---|
| Background | --color-bg | #EDF0EC | #101311 |
| Surface | --color-surface | #F9FAF8 | #181C19 |
| Elevated surface | --color-raised | #FFFFFF | #212622 |
| Ink | --color-ink | #18201B | #EEF1EF |
| Muted ink | --color-muted | #4F5C55 | #A9B3AC |
| Border (decorative) | --color-border | #D4DAD5 | #2E3530 |
| Border (controls) | --color-border-strong | #7D8982 | #75807A |
| Accent | --color-accent | #275F3C | #8FD1A5 |
| Accent hover | --color-accent-hover | #1F4F31 | #A6DDB8 |
| Accent pressed | --color-accent-pressed | #183F27 | #79BF91 |
| On accent | --color-on-accent | #FFFFFF | #0D2416 |
| Focus | --color-focus | #0B57D0 | #8AB4F8 |
| Success | --color-success | #2B6A43 | #8FD1A5 |
| Warning | --color-warning | #7A5000 | #E9BE62 |
| Danger | --color-danger | #B3261E | #F2B8B5 |
| Info / syncing | --color-info | #235C8C | #9CC3E6 |
| Offline / on device | --color-offline | #505B55 | #B7C0BA |

| Pair | Target | Light | Dark |
|---|---|---|---|
| Body text on background ink / bg | 7:1 | 14.49:1 Pass | 16.44:1 Pass |
| Workout values on raised surface ink / raised | 7:1 | 16.65:1 Pass | 13.53:1 Pass |
| Muted text on background muted / bg | 4.5:1 | 6.10:1 Pass | 8.66:1 Pass |
| Muted text on raised surface muted / raised | 4.5:1 | 7.01:1 Pass | 7.13:1 Pass |
| Primary button label onAccent / accent | 4.5:1 | 7.53:1 Pass | 9.24:1 Pass |
| Hover button label onAccent / accentHover | 4.5:1 | 9.46:1 Pass | 10.66:1 Pass |
| Pressed button label onAccent / accentPressed | 4.5:1 | 11.80:1 Pass | 7.55:1 Pass |
| Accent text or link on surface accent / surface | 4.5:1 | 7.19:1 Pass | 9.71:1 Pass |
| Input border (UI boundary) borderStrong / surface | 3:1 | 3.47:1 Pass | 4.20:1 Pass |
| Focus ring on background focus / bg | 3:1 | 5.56:1 Pass | 8.87:1 Pass |
| Focus ring on raised surface focus / raised | 3:1 | 6.39:1 Pass | 7.30:1 Pass |
| Success text success / surface | 4.5:1 | 6.18:1 Pass | 9.71:1 Pass |
| Warning text warning / surface | 4.5:1 | 6.74:1 Pass | 9.85:1 Pass |
| Danger text danger / surface | 4.5:1 | 6.24:1 Pass | 10.09:1 Pass |
| Info text info / surface | 4.5:1 | 6.73:1 Pass | 9.32:1 Pass |
| Offline / on-device text offline / surface | 4.5:1 | 6.76:1 Pass | 9.24:1 Pass |

## Layout
- **Spacing tokens** (layout.def.scale). space-0 to space-9: 0, 4, 8, 12, 16, 24, 32, 48, 64 px (if 4 px base is chosen).
- **Page gutters** (layout.def.gutters). 16 px below 400 px width, 20 px from 400 px, 24 px from 600 px. Plus env(safe-area-inset-*).
- **Vertical rhythm** (layout.def.rhythm). 8 px within a group, 16 px between groups, 32 px between sections.
- **Breakpoints** (layout.def.breakpoints). Content-driven: 400, 600, 1024 px. Container queries for components that live in several widths.
- **Reflow** (layout.def.reflow). No horizontal page scroll at 320 CSS px. Tables that cannot reflow scroll inside their own container with a visible label.
- **Scroll rules** (layout.def.scroll). Document scroll, not nested scroll areas. Only one sticky region at the bottom and one at the top. Use 100dvh, not 100vh.
- **Density modes** (layout.def.density). One density in v1. No compact setting.
- **Deferred.** **Compact density setting** (layout.later.compact-mode). Revisit if users ask to see more sets on one screen.
- **Deferred.** **Foldable hinge layouts** (layout.later.foldables). Revisit after v1 if analytics show foldable use.

## Shape
- **Nesting limit** (shape.def.nesting). Maximum two surface levels inside the page. No card inside a card inside a card.
- **Border strategy** (shape.def.borders). 1 px border token on inputs (3:1 border-strong) and in dark theme on raised surfaces. Decorative dividers use the lighter border token.
- **Separators** (shape.def.separators). Hairline 1 px, inset to text start in lists, full width between page regions.
- **Overlays** (shape.def.overlays). Scrim 45% ink. Bottom sheet top radius 20 px with drag handle and close button. Dialog radius 20 px, max width 420 px.
- **Layer order** (shape.def.layers). Named z-index tokens: base, sticky, sheet, dialog, toast. No raw z-index numbers in components.
- **Shadow tokens** (shape.def.shadow-tokens). shadow-overlay only (if tonal is chosen). No colored shadows.

## Controls
- **Target size** (controls.def.targets). 44×44 px minimum. 48 px for steppers, RIR and primary action in active workout. 8 px between adjacent targets.
- **Icon buttons** (controls.def.icon-button). 44 px square, 24 px icon, accessible name required, tooltip on pointer hover only.
- **Menus and popovers** (controls.def.menu). Overflow “More” menu opens a bottom sheet list on phones and an anchored popover on wide screens. Items 48 px, text labels, destructive item last. Escape and outside tap close it; focus returns to the trigger.
- **Chips** (controls.def.chips). Filter and choice chips only. Not used for navigation. Selected chip shows a check icon.
- **Checkbox, radio, select** (controls.def.native). Native elements with accent-color and 24 px visual size inside a 44 px label target. Native select on phones.
- **Switch** (controls.def.switch). Only for settings that apply at once. Shows On/Off text next to it.
- **Slider** (controls.def.slider). Not used for logging values. Allowed only for non-critical settings with a number field next to it.
- **Validation** (controls.def.validation). Validate on blur and on submit, not on each key. Error text says what to do. Icon + text + border change. Focus moves to first error.
- **Disabled and read-only** (controls.def.disabled). Avoid disabled buttons. Keep them enabled and explain the missing input on press. Read-only values render as text, not greyed inputs.
- **Loading buttons** (controls.def.loading). Button keeps width and label, adds “Saving…” text and aria-busy. No spinner-only buttons.
- **Keyboard** (controls.def.keyboard). Tab order follows visual order. Steppers use role spinbutton with arrow keys. Segmented control uses radio group arrow keys. Escape closes sheets.
- **Number entry** (controls.def.number-input). inputmode="decimal", autocomplete off, 16 px text, select all on focus.
- **Deferred.** **Swipe gestures on rows** (controls.later.gesture). Revisit after v1. Must always have a button alternative.

## Navigation
- **Back behavior** (navigation.def.back). Browser and OS back closes the top overlay first, then goes back one screen. Each screen and sheet has its own URL state so back never exits the app by surprise.
- **Leaving a workout** (navigation.def.exit-workout). Leaving the workout screen keeps the workout open; nothing is lost and it resumes from Today. Only “Finish workout” ends it, with its own confirmation screen.
- **One primary action rule** (navigation.def.one-primary). Each screen and each sheet has at most one filled primary button.
- **Top bar outside workouts** (navigation.def.top-bar). Today, History and Settings: left-aligned screen title (h1, 22 px), optional one icon action on the right, sync status label. No back button on tab roots. Not sticky; tab bar stays fixed.
- **List row anatomy** (navigation.def.list-rows). Row min height 56 px. Title and one secondary line. Numbers right-aligned. Chevron only when the row opens a screen. Row actions in the detail screen, not hidden in swipe.
- **Breadcrumbs** (navigation.def.breadcrumbs). Not used. Hierarchy is at most two levels deep.
- **Page titles** (navigation.def.titles). Each route sets document.title “Screen · Workout Logger” and moves focus to the h1 on route change.
- **Modal rules** (navigation.def.dialog-rules). No overlay opens another overlay. Dialogs have a clear cancel. Sheets close with Escape, back, scrim tap and close button.
- **Deferred.** **Tablet navigation rail** (navigation.later.tablet-rail). Revisit only if the wide-screen decision changes to two columns and tablet use is common.

## Feedback
- **Error placement** (feedback.def.errors). Error message next to its cause, with a fix action (WCAG 3.3.1, 3.3.3). App-level problems such as sync use a banner. No error dialogs during a workout.
- **State matrix applies** (feedback.def.matrix). The table above is the source for copy, icon shape, tone and announcement for each state.
- **Announcements** (feedback.def.announce). Status changes use a polite live region. Only errors that block the current task use assertive.
- **Toasts** (feedback.def.toast). Only for Undo. 10 s minimum, pause on focus or hover, never the only place a message appears.
- **Empty states** (feedback.def.empty). One sentence that says why it is empty and one action. See Iconography for visuals.
- **Retry** (feedback.def.retry). Automatic retry with backoff for sync. Manual Retry button after 3 failures. No data loss on retry.
- **Deferred.** **Push notifications for sync problems** (feedback.later.push). Revisit after multi-device sync ships.

| State | Icon shape | Copy | Tone | Announcement |
|---|---|---|---|---|
| Saved on device | Phone with check | On device | offline | None (quiet default) |
| Syncing | Two arrows | Syncing | info | None unless over 10 s |
| Needs attention | Triangle | Needs attention | warning | Polite, once |
| Offline | Cloud with slash | Offline. Logging still works. | offline | Polite, once |
| Loading | Static blocks | Loading history… | offline | Polite after 1 s |
| Success | Circle with check | Set 2 saved | success | Polite |
| Warning | Triangle | Rest is longer than planned | warning | Polite |
| Error | Triangle + thick border | Sync failed. Your sets are safe on this device. | danger | Assertive only if blocking |
| Empty | None or outline box | No workouts yet | offline | None |
| Stale proposal | Clock with slash | Out of date. The plan changed after this was made. | warning | Polite |
| Conflict | Opposing arrows | Changed on 2 devices. Choose a version. | warning | Polite |
| Retry | Circular arrow | Retry (button) | info | Result announced |

## Motion
- **Duration tokens** (motion.def.tokens). motion-fast 100 ms, motion-base 200 ms, motion-slow 300 ms. Nothing longer except the timer.
- **Easing tokens** (motion.def.easing). ease-standard cubic-bezier(.2,0,0,1). ease-exit cubic-bezier(.3,0,1,1). No bounce.
- **Allowed transitions** (motion.def.allowed). Opacity, transform (translate and small scale), color. No layout property animation. No parallax.
- **Reduced motion** (motion.def.reduced). prefers-reduced-motion: reduce replaces all movement with opacity fades of 100 ms or instant change. Timer keeps stepping.
- **No decorative loops** (motion.def.loops). No looping animation except an active loading indicator, which stops after 10 s and shows text.
- **Press response** (motion.def.tactile). Visible pressed state within 100 ms of touch start. Haptics rules are in section 22.
- **Chart motion** (motion.def.charts). Charts render without entry animation.
- **Deferred.** **View Transitions API** (motion.later.view-transitions). Revisit when support in Safari and Firefox is stable.

## Iconography
- **Sizes** (iconography.def.sizes). 16 px inline with small text, 20 px with body text, 24 px in icon buttons. Always inside a 44 px target when interactive.
- **Optical weight** (iconography.def.weight). Stroke stays 1.75 at all sizes. Icon color matches adjacent text color.
- **Accessibility** (iconography.def.a11y). Decorative icons aria-hidden. Icon-only buttons have aria-label. Status icons are paired with text.
- **License ledger** (iconography.def.ledger). ICONS_LICENSES.md lists source, license and version for every icon set and font.
- **Photos and illustrations** (iconography.def.photos). No stock photos. No exercise photos in v1. No decorative illustrations.
- **Exercise media** (iconography.def.exercise-media). Exercise names are text only in v1.
- **Deferred.** **Exercise technique diagrams** (iconography.later.exercise-diagrams). Revisit if exercise guidance becomes a feature. Needs content and safety review.

## Data
- **Units** (data.def.units). Metric default (kg). Unit shown next to every load. Imperial (lb) as a setting; stored values keep original unit.
- **Precision** (data.def.precision). kg to 0.25 without trailing zeros (80, 82.5, 81.25). lb to 0.5. Reps and RIR integers. Durations m:ss.
- **Alignment** (data.def.alignment). Numbers right-aligned with tabular numerals. Text left-aligned. Units in the header when a column shares one unit.
- **Missing data** (data.def.missing). Show “—” with accessible text “not recorded”. Never show 0 for missing.
- **Workout summary** (data.def.summary). Duration, exercises, sets, total reps and volume (load × reps) per exercise. No composite or invented score.
- **RIR shown by default** (data.def.rir-display). RIR column and RIR in Set Focus are on by default. Can be hidden in settings.
- **Chart rules (when charts ship)** (data.def.chart-rules). Direct labels, marker shapes per series, axes with units, start y-axis at a labeled value, data table alternative, no animation, no color-only series.
- **Deferred.** **Trend charts** (data.later.charts). Revisit after 8 weeks of real use data, if charts are deferred.
- **Deferred.** **Estimated 1RM** (data.later.e1rm). Revisit with a named formula and a clear “estimate” label.

## Content
- **Capitalization** (content.def.case). Sentence case everywhere, including buttons, headings and tabs. RIR, RPE, kg and lb keep their normal form.
- **Terminology** (content.def.terms). Workout, Exercise, Set, Load, Reps, RIR, Rest, Plan. “Load” not “weight” in controls. One term per concept.
- **Action verbs** (content.def.verbs). Log, Save, Edit, Delete, Undo, Skip, Retry, Start, Finish. Button text says the result, not “OK”.
- **Metric and unit format** (content.def.units-format). Number, no-break space, unit: “80 kg”. Sets: “80 kg × 8”. Use × (multiplication sign), not x.
- **Dates and times** (content.def.dates). “Today”, “Yesterday”, then locale short date via Intl (“Mon 14 Sep”). Time in user locale 12 h or 24 h. Durations “1:30”, spoken “1 minute 30 seconds”.
- **RIR and RPE** (content.def.rpe). RIR is primary. RPE mapping (RPE 10 = RIR 0) only in the help sheet.
- **Confirmations** (content.def.confirm). Title is a question with the object: “Delete workout from 14 Sep?” Buttons: “Delete workout” and “Keep workout”.
- **Error messages** (content.def.errors). What happened, then what to do. No blame, no codes in the main text. “Sync failed. Your sets are safe on this device. Retry.”
- **Safety-neutral language** (content.def.safety). No medical claims, no “push through pain”, no body judgment. Lower performance is shown as data, not failure.
- **Text expansion** (content.def.expansion). Layouts allow 40% longer labels. No text in images. Strings in one message catalog.
- **Deferred.** **Tone setting** (content.later.tone-settings). Revisit only on user request.

## Accessibility
- **Landmarks and headings** (accessibility.def.landmarks). header, nav, main on every screen. One h1 per screen. Heading levels in order.
- **Focus** (accessibility.def.focus). 3 px focus ring in focus color, 2 px offset, 3:1 against both adjacent colors. Focus never hidden by sticky bars (2.4.11). Focus returns to the trigger when an overlay closes.
- **Screen reader names** (accessibility.def.sr). Values read with units: “80 kilograms”. Steppers announce new value. Set pills read “Set 1, done”.
- **No drag-only actions** (accessibility.def.dragging). Every drag or swipe has a button alternative (2.5.7).
- **Text scaling and reflow** (accessibility.def.reflow). Works at 200% text size and at 320 CSS px width with no horizontal scroll (1.4.4, 1.4.10). Text spacing override does not clip (1.4.12).
- **Orientation** (accessibility.def.orientation). Portrait and landscape both supported (1.3.4).
- **Reduced motion** (accessibility.def.motion). Honors prefers-reduced-motion. No flashing content.
- **Cognitive load** (accessibility.def.cognitive). One task per screen in a workout. Consistent position of help (3.2.6). No re-entering data already given (3.3.7).
- **Error recovery** (accessibility.def.recovery). Undo for reversible actions. Confirmation for permanent ones (3.3.4). Input kept after an error.
- **Accessible authentication** (accessibility.def.auth). Whatever sign-in method the product picks: no cognitive tests, puzzles or CAPTCHA; password fields allow paste and password managers (3.3.8). The sign-in method itself is a product decision outside this workbook.
- **Timing** (accessibility.def.timing). Rest timer never forces an action. Nothing expires during a workout (2.2.1).
- **Forced colors and contrast** (accessibility.def.forced). See Color section. Tested in Windows high contrast.
- **Deferred.** **Voice input for logging** (accessibility.later.voice). Revisit after v1.

| Environment | Viewport | Flows |
|---|---|---|
| iOS Safari + VoiceOver | Phone 375×667 | Start workout, log set, adjust load, pick RIR, rest, edit set, undo delete, sync error |
| Android Chrome + TalkBack | Phone 360×800 | Start workout, log set, adjust load, pick RIR, rest, edit set, undo delete, sync error |
| macOS Safari, keyboard only | Desktop 1280×800 | Start workout, log set, adjust load, pick RIR, rest, edit set, undo delete, sync error |
| Windows Edge, forced colors | Desktop 1280×800 | Start workout, log set, adjust load, pick RIR, rest, edit set, undo delete, sync error |
| Chrome, 200% text / 400% zoom | 320 CSS px | Start workout, log set, adjust load, pick RIR, rest, edit set, undo delete, sync error |
| Any, reduced motion on | Phone 375×667 | Start workout, log set, adjust load, pick RIR, rest, edit set, undo delete, sync error |

## Theme
- **Persistence** (theme.def.persist). Choice stored on device (localStorage) and in the user profile when signed in.
- **No flash** (theme.def.no-flash). Inline script in head sets data-theme and the color-scheme meta before first paint, so native controls match the chosen theme, not the OS.
- **PWA theme-color** (theme.def.theme-color). theme-color meta tags per scheme set only after tokens are accepted. Light #EDF0EC, dark #101311 proposed.
- **Contrast parity** (theme.def.parity). Both themes meet the same contrast target. Tested in the same visual-regression matrix.
- **Assets per theme** (theme.def.images). Icons use currentColor. No image needs a dark version.
- **Deferred.** **Scheduled theme** (theme.later.schedule). Not planned; System option covers it.

## Tokens
- **Styling technology** (tokens.def.css-modules). CSS Modules for components. Tokens as CSS custom properties. No runtime CSS-in-JS.
- **Composition over inheritance** (tokens.def.composition). Build larger components from primitives (Stack, Surface, Button). No component extends another.
- **Escape-hatch policy** (tokens.def.escape). Layout-only wrapper props allowed. Visual overrides need an ADR note and a follow-up ticket to add a variant or remove the override.
- **Ownership** (tokens.def.ownership). Vladimir owns foundations and approvals. Agents may propose changes through OpenSpec.
- **Deprecation** (tokens.def.deprecation). Mark token or prop @deprecated with replacement. Keep for one minor version. Lint warns on use.
- **Provider neutrality** (tokens.def.neutral). No vendor, model or provider names in token, component or prop names.
- **Folder structure** (tokens.def.structure). tokens/, ui/primitives/, ui/patterns/, ui/lab/. Screens import only from ui/.
- **Deferred.** **Separate npm package** (tokens.later.package). Revisit if a second app uses the system.

## Governance
- **Deterministic fixtures** (governance.def.fixtures). Fixed clock (2026-09-14 10:00), seeded data, fonts ready, animations disabled, caret hidden.
- **Baseline approval** (governance.def.baseline). Baseline updates only in a PR labeled visual-change, approved by Vladimir.
- **Automated accessibility** (governance.def.a11y-checks). axe on each lab page and key screen in CI. Fails on serious and critical issues.
- **Design-to-code reconciliation** (governance.def.reconcile). Code and lab are the source of truth. Mockups are references; differences are logged in DESIGN_SYSTEM.md, then resolved.
- **Versioning** (governance.def.versioning). Semantic version in DESIGN_SYSTEM.md. Major: token rename or removal. Minor: new token or component. Patch: fix.
- **Review cadence** (governance.def.cadence). Design-system review at each milestone and after each 10 merged UI PRs.
- **Deferred.** **Design tool sync** (governance.later.figma-sync). Revisit if a design tool file becomes part of the workflow.

## Brand
- **No identity from scaffold** (brand.def.scaffold). Manifest name, short_name, theme_color, icons and favicon are placeholders until these decisions are accepted. A test fails if framework default icons are present.
- **Favicon set** (brand.def.favicon). SVG favicon, 32 px PNG, 180 px apple-touch-icon, 192 and 512 px PNG, 512 px maskable with 20% safe zone.
- **Accent in identity** (brand.def.accent). Accent green as full background only in the app icon, not in product screens.
- **Monochrome icon** (brand.def.monochrome). Provide a monochrome variant for Android themed icons.
- **Deferred.** **Final product name** (brand.later.final-name). Revisit before public release. Name treatment above makes this cheap.

## Platform
- **Safe areas** (platform.def.safe-area). viewport-fit=cover. Top and bottom bars pad with env(safe-area-inset-*). Landscape side insets on notched phones.
- **Install prompt posture** (platform.def.install). No automatic install banner. An “Install app” row in Settings, shown after the second completed workout. iOS shows Add to Home Screen steps as text.
- **Browser chrome color** (platform.def.theme-color). theme-color matches bg token per scheme (after brand acceptance).
- **Viewport units** (platform.def.viewport). 100dvh for full-height views. Sticky action bar uses the visual viewport so it does not jump when the keyboard opens.
- **Pointer and hover** (platform.def.pointer). Hover styles only inside @media (hover: hover). No information only on hover. Larger hit areas for pointer: coarse.
- **Reduced data** (platform.def.reduced-data). No web fonts or images to reduce. Sync batches wait for Wi-Fi only if the user asks.
- **Offline** (platform.def.offline). All logging works offline. App shell cached by service worker. Offline is a normal state, not an error.
- **Screen wake lock** (platform.def.wake-lock). Keep screen on during an active workout with the Screen Wake Lock API when available. Released when the workout ends or the app is hidden. Setting to turn off (battery).
- **Font rendering** (platform.def.rendering). No font-smoothing overrides. Accept small OS differences. Visual baselines are per browser engine.
- **Support matrix** (platform.def.browsers). iOS Safari last 2 versions, Android Chrome last 2, desktop Chrome, Safari, Firefox, Edge last 2.
- **Deferred.** **Native wrappers** (platform.later.native). Revisit only if PWA limits (notifications on iOS, background sync) block core use.

## I18n
- **Decimal separator input** (i18n.def.decimal). Accept comma and period in load fields. Display with the locale separator (82,5 kg in de-DE, 82.5 kg in en). Rejecting the local separator only creates errors.
- **Formatting APIs** (i18n.def.intl). Intl.NumberFormat, DateTimeFormat, RelativeTimeFormat, PluralRules, ListFormat. No hand-built formats.
- **Units by setting, not locale** (i18n.def.units). kg/lb is a user setting with a locale-based first guess. Stored values keep the entered unit.
- **Time zones** (i18n.def.time-zones). Store UTC timestamps plus the IANA zone at workout start. A workout belongs to the local date where it started.
- **Week start** (i18n.def.week). From locale (Intl.Locale weekInfo where supported), Monday fallback.
- **Label expansion** (i18n.def.expansion). Buttons wrap to 2 lines instead of truncating. Tested with a pseudo-locale (+40% length, accents).
- **Font fallback and glyphs** (i18n.def.glyphs). System fonts cover Latin, Greek, Cyrillic, Arabic, Hebrew, CJK. × and – glyphs present in all stacks.
- **Deferred.** **Additional languages** (i18n.later.languages). Revisit when a non-English user group asks.

## Docs
- **DESIGN_SYSTEM.md acceptance criteria** (docs.def.acceptance). Lists every accepted decision ID from this workbook, token tables for both themes with contrast values, component inventory with states, motion spec, content rules, a11y rules, change process. Each rule is testable or links to a test.
- **Component inventory** (docs.def.inventory). Table: component, variants, sizes, states, owner, lab link, test link, status (draft, stable, deprecated).
- **State matrix** (docs.def.state-matrix). Per component: default, hover, pressed, focus, selected, disabled/unavailable, loading, error, read-only, in both themes.
- **Motion spec** (docs.def.motion-spec). MOTION.md section: duration and easing tokens, list of allowed transitions per component, reduced-motion replacement for each, and the timer update rule.
- **Iteration process** (docs.def.iteration). Proposal → OpenSpec change → lab prototype → review → baseline update → DESIGN_SYSTEM.md update → version bump.

| Deliverable | Contains | Acceptance check |
|---|---|---|
| DESIGN_SYSTEM.md | Accepted decision IDs, rules, change process | Every “Decide now” ID listed with chosen option |
| tokens/*.tokens.json + tokens.css | Primitive and semantic tokens, both themes | Contrast test passes for all pairs |
| Component inventory | Components, variants, states, status | Each entry links to lab page |
| State matrix | All states per component and system state | Lab renders every cell |
| Motion spec | Duration and easing tokens, allowed transitions, reduced-motion map | Reduced-motion E2E check |
| ICONS_LICENSES.md | Icon and font sources, licenses, versions | CI checks icon imports against ledger |
| Visual baselines | 375×667 and 1280×800, light and dark | Approved in a visual-change PR |
| Reference screens | Set Focus, Rest, History, Settings, Empty, Error | Built only from ui/ components |

## Performance
- **Layout stability** (performance.def.cls). Reserve space for all async content. CLS target below 0.05 on key screens.
- **Input response** (performance.def.input). Tap to visible response under 100 ms. INP target below 200 ms on mid-range Android.

## Haptics
- **Log set haptic** (haptics.def.log-tick). One light tick on set logged, where supported. Off with the vibration setting.
- **No other sounds** (haptics.def.no-sound-default). No UI sounds besides the optional rest tone.
- **Deferred.** **Background rest notification** (haptics.later.notification). Revisit when web push on iOS is reliable for installed PWAs.
