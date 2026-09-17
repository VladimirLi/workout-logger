import type { Metadata } from 'next';
import {
  BottomTabs,
  FIXTURE_TIME_ZONE,
  fixtures,
  formatDate,
  ListRow,
  messages,
  Screen,
  TopBar,
} from '../../../../ui';

export const metadata: Metadata = { title: messages.documentTitle('History') };

/** Reference screen: past workouts as plain rows. */
export default function HistoryScreen() {
  return (
    <Screen bar={<TopBar title={messages.nav.history} />} bottom={<BottomTabs current="history" />}>
      <ul aria-label="Workouts">
        {fixtures.HISTORY.map((workout) => (
          <ListRow
            key={workout.id}
            href="/lab/screens/summary"
            title={workout.name}
            detail={`${messages.count.exercises(workout.exercises)} · ${messages.count.sets(workout.sets)}`}
            meta={formatDate(workout.date, FIXTURE_TIME_ZONE)}
          />
        ))}
      </ul>
    </Screen>
  );
}
