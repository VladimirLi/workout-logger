import type { Metadata } from 'next';
import { fixtures, messages, Screen, WorkoutBar } from '../../../../ui';
import { RestView } from './RestView';

export const metadata: Metadata = { title: messages.documentTitle('Rest') };

const { CURRENT_EXERCISE: exercise } = fixtures;

/** Reference screen: rest after a logged set. */
export default function RestScreen() {
  return (
    <Screen
      bar={<WorkoutBar exercise={exercise.index} exercises={exercise.total} sync="syncing" />}
    >
      <RestView />
    </Screen>
  );
}
