import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { Heading, messages, Screen, Stack, Text, TopBar } from '../../ui';

export const metadata: Metadata = { title: messages.documentTitle('Design-system lab') };

/**
 * The lab (docs.source.repo-md-lab): the component inventory, the state matrix, and the
 * coded reference screens (docs.examples.coded-screens), all rendered from fixture data.
 */
const INVENTORY: { name: string; kind: 'Primitive' | 'Pattern'; variants: string; href: Route }[] =
  [
    {
      name: 'Button',
      kind: 'Primitive',
      variants: 'primary, secondary, tertiary; md, lg; busy',
      href: '/lab/components#buttons',
    },
    {
      name: 'IconButton',
      kind: 'Primitive',
      variants: 'back, close, more',
      href: '/lab/components#buttons',
    },
    { name: 'Stepper', kind: 'Primitive', variants: 'load, reps', href: '/lab/components#inputs' },
    { name: 'Segmented', kind: 'Primitive', variants: 'RIR 0–4+', href: '/lab/components#inputs' },
    {
      name: 'NumberField',
      kind: 'Primitive',
      variants: 'default, helper, error',
      href: '/lab/components#inputs',
    },
    {
      name: 'Surface',
      kind: 'Primitive',
      variants: 'card, panel, plain',
      href: '/lab/components#surfaces',
    },
    {
      name: 'Heading, Text, Value',
      kind: 'Primitive',
      variants: 'levels 1–3; body, label, title; display',
      href: '/lab/components#type',
    },
    {
      name: 'ListRow',
      kind: 'Primitive',
      variants: 'title, detail, meta',
      href: '/lab/screens/history',
    },
    { name: 'Skeleton', kind: 'Primitive', variants: 'rows', href: '/lab/states#loading' },
    {
      name: 'Sheet',
      kind: 'Primitive',
      variants: 'title, close, handle',
      href: '/lab/screens/rir-help',
    },
    {
      name: 'SyncIndicator',
      kind: 'Pattern',
      variants: 'on device, syncing, needs attention, offline',
      href: '/lab/states#sync',
    },
    {
      name: 'StatusMessage',
      kind: 'Pattern',
      variants: 'success, warning, error, offline, stale, conflict',
      href: '/lab/states#messages',
    },
    {
      name: 'SetProgress',
      kind: 'Pattern',
      variants: 'pills and text',
      href: '/lab/components#progress',
    },
    {
      name: 'SetTable',
      kind: 'Pattern',
      variants: 'complete, missing values',
      href: '/lab/components#data',
    },
    {
      name: 'Delta, AgentTag',
      kind: 'Pattern',
      variants: 'up, down, same; date',
      href: '/lab/components#data',
    },
    { name: 'RestTimer', kind: 'Pattern', variants: 'stepped ring', href: '/lab/screens/rest' },
    {
      name: 'RirPicker',
      kind: 'Pattern',
      variants: 'helper, help sheet',
      href: '/lab/screens/set-focus',
    },
    { name: 'UndoToast', kind: 'Pattern', variants: '10 s undo', href: '/lab/states#undo' },
    {
      name: 'ThemeSetting',
      kind: 'Pattern',
      variants: 'Light, Dark, System',
      href: '/lab/screens/settings',
    },
    {
      name: 'TopBar, WorkoutBar, BottomTabs, StickyActionBar',
      kind: 'Pattern',
      variants: 'app and workout chrome',
      href: '/lab/screens/plan',
    },
    {
      name: 'Screen, TwoPane',
      kind: 'Pattern',
      variants: 'centred column; landscape two-pane',
      href: '/lab/screens/set-focus',
    },
  ];

const SCREENS: { label: string; href: Route }[] = [
  { label: 'Plan', href: '/lab/screens/plan' },
  { label: 'Set focus', href: '/lab/screens/set-focus' },
  { label: 'RIR help sheet', href: '/lab/screens/rir-help' },
  { label: 'Rest', href: '/lab/screens/rest' },
  { label: 'Workout summary', href: '/lab/screens/summary' },
  { label: 'History', href: '/lab/screens/history' },
  { label: 'Settings', href: '/lab/screens/settings' },
  { label: 'Empty', href: '/lab/screens/empty' },
  { label: 'Error', href: '/lab/screens/error' },
];

export default function LabPage() {
  return (
    <Screen bar={<TopBar title="Design-system lab" />}>
      <Text tone="muted">
        Quiet Performance 1.0.0. Fixture data, fixed clock: 14 Sept 2026, 10:00 UTC.
      </Text>

      <Stack gap={2} as="section" aria-labelledby="screens">
        <Heading level={2} id="screens">
          Reference screens
        </Heading>
        <ul>
          {SCREENS.map((screen) => (
            <li key={screen.href}>
              <Link href={screen.href}>{screen.label}</Link>
            </li>
          ))}
          <li>
            <Link href="/lab/states">State matrix</Link>
          </li>
          <li>
            <Link href="/lab/components">Components</Link>
          </li>
        </ul>
      </Stack>

      <Stack gap={2} as="section" aria-labelledby="inventory">
        <Heading level={2} id="inventory">
          Inventory
        </Heading>
        <ul>
          {INVENTORY.map((item) => (
            <li key={item.name}>
              <Link href={item.href}>{item.name}</Link> — {item.kind}. {item.variants}.
            </li>
          ))}
        </ul>
      </Stack>
    </Screen>
  );
}
