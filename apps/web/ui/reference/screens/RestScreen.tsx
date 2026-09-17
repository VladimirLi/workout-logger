import { fixtures, Screen, WorkoutBar } from '../../index';
import { RestView } from './RestView';

const { CURRENT_EXERCISE: exercise } = fixtures;

/** Reference screen: rest after a logged set. */
export function RestScreen() {
  return (
    <Screen
      bar={<WorkoutBar exercise={exercise.index} exercises={exercise.total} sync="syncing" />}
    >
      <RestView />
    </Screen>
  );
}
