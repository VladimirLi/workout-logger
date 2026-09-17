import {
  Button,
  fixtures,
  Heading,
  messages,
  Screen,
  SetTable,
  StatusMessage,
  WorkoutBar,
} from '../../index';

/** Reference screen: a sync failure during a workout; the sets stay safe on the device. */
export function ErrorScreen() {
  return (
    <Screen bar={<WorkoutBar exercise={2} exercises={5} sync="needs-attention" />}>
      <Heading level={1}>{fixtures.CURRENT_EXERCISE.name}</Heading>
      <StatusMessage
        kind="error"
        action={
          <Button variant="secondary" icon="rotate-ccw">
            {messages.actions.retry}
          </Button>
        }
      >
        {messages.states.error}
      </StatusMessage>
      <SetTable caption="Logged sets" rows={fixtures.SQUAT_SETS.slice(0, 2)} />
    </Screen>
  );
}
