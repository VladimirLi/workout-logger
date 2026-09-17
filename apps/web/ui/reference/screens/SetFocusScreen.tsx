import {
  Delta,
  fixtures,
  formatLoadReps,
  Heading,
  LogToRest,
  messages,
  RirPicker,
  Screen,
  SetProgress,
  Stack,
  Stepper,
  Surface,
  Text,
  TwoPane,
  Value,
  WorkoutBar,
} from '../../index';
import { REST_HEADING_ID, RestView } from './RestView';

const { CURRENT_EXERCISE: exercise, REST } = fixtures;

/** Reference screen: logging one set (principles.set-focus-scope.logging). */
export function SetFocusScreen({ helpOpen = false }: { helpOpen?: boolean }) {
  return (
    <Screen
      bar={<WorkoutBar exercise={exercise.index} exercises={exercise.total} sync="on-device" />}
    >
      <LogToRest
        restHeadingId={REST_HEADING_ID}
        savedAnnouncement={messages.set.saved(exercise.set.current, REST.durationSeconds)}
        rest={<RestView />}
        set={
          <TwoPane
            focus={
              <Stack gap={3}>
                <Heading level={1}>{exercise.name}</Heading>
                <SetProgress {...exercise.set} />
                <Surface tone="card" aria-label="Target">
                  <Stack gap={1}>
                    <Text size="label" tone="muted" weight="label">
                      Target
                    </Text>
                    <Value size="display" spoken="80 kilograms, 8 reps">
                      {formatLoadReps(exercise.target.loadKg, exercise.target.reps)}
                    </Value>
                    <Delta kg={exercise.deltaKg} />
                  </Stack>
                </Surface>
              </Stack>
            }
            detail={
              <Surface tone="panel" aria-label="Actual">
                <Stack gap={4}>
                  <Stepper quantity="load" name="load" defaultValue={exercise.target.loadKg} />
                  <Stepper quantity="reps" name="reps" defaultValue={exercise.target.reps} />
                  <RirPicker defaultValue={exercise.target.rir} startOpen={helpOpen} />
                </Stack>
              </Surface>
            }
          />
        }
      />
    </Screen>
  );
}
