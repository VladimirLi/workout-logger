import type { Metadata } from 'next';
import {
  AgentTag,
  BottomTabs,
  Button,
  FIXTURE_TIME_ZONE,
  fixtures,
  formatLoadReps,
  Heading,
  messages,
  Screen,
  Stack,
  Surface,
  Text,
  TopBar,
} from '../../../../ui';

export const metadata: Metadata = { title: messages.documentTitle('Today') };

const { PLAN } = fixtures;

/** Reference screen: today's plan before starting (R-003 plan view). */
export default function PlanScreen() {
  return (
    <Screen bar={<TopBar title={messages.nav.today} />} bottom={<BottomTabs current="today" />}>
      <Surface tone="card" aria-labelledby="plan-name">
        <Stack gap={3}>
          <Stack gap={1}>
            <Heading level={2} id="plan-name">
              {PLAN.name}
            </Heading>
            <Text size="label" tone="muted">
              {messages.count.exercises(PLAN.exercises.length)} ·{' '}
              {messages.count.sets(PLAN.exercises.reduce((sum, item) => sum + item.sets, 0))}
            </Text>
          </Stack>
          <AgentTag createdAt={PLAN.proposedAt} timeZone={FIXTURE_TIME_ZONE} />
          <Button variant="primary" size="lg" expand>
            {messages.actions.startWorkout}
          </Button>
        </Stack>
      </Surface>
      <Stack as="ol" gap={2}>
        {PLAN.exercises.map((item) => (
          <li key={item.name}>
            <Stack direction="inline" justify="between" align="baseline" gap={3}>
              <Text weight="label">{item.name}</Text>
              <Text size="label" tone="muted">
                {messages.count.sets(item.sets)} · {formatLoadReps(item.loadKg, item.reps)}
              </Text>
            </Stack>
          </li>
        ))}
      </Stack>
    </Screen>
  );
}
