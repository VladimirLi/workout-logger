import type { Metadata } from 'next';
import {
  Button,
  fixtures,
  messages,
  Screen,
  SetTable,
  Stack,
  StickyActionBar,
  SyncIndicator,
  Text,
  TopBar,
} from '../../../../ui';

export const metadata: Metadata = { title: messages.documentTitle('Workout summary') };

/** Reference screen: completed-workout summary with facts only, no invented score. */
export default function SummaryScreen() {
  return (
    <Screen
      bar={<TopBar title="Workout done" trailing={<SyncIndicator state="on-device" />} />}
      bottom={
        <StickyActionBar>
          <Button variant="primary" size="lg" expand>
            {messages.actions.done}
          </Button>
        </StickyActionBar>
      }
    >
      <Text tone="muted">
        {fixtures.PLAN.name} · {messages.count.exercises(2)} · {messages.count.sets(7)}
      </Text>
      <Stack gap={6}>
        <SetTable caption="Back squat" rows={fixtures.SQUAT_SETS} />
        <SetTable caption="Romanian deadlift" rows={fixtures.DEADLIFT_SETS} />
      </Stack>
    </Screen>
  );
}
