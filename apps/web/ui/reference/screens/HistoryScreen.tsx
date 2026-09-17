import {
  BottomTabs,
  FIXTURE_TIME_ZONE,
  fixtures,
  formatDate,
  ListRow,
  messages,
  Screen,
  TopBar,
} from '../../index';

/** Reference screen: past workouts as plain rows. */
export function HistoryScreen() {
  return (
    <Screen
      bar={<TopBar title={messages.nav.history} />}
      bottom={<BottomTabs current="history" hrefs={fixtures.REFERENCE_TAB_HREFS} />}
    >
      <ul aria-label="Workouts">
        {fixtures.HISTORY.map((workout) => (
          <ListRow
            key={workout.id}
            href={fixtures.REFERENCE_WORKOUT_HREF}
            title={workout.name}
            detail={`${messages.count.exercises(workout.exercises)} · ${messages.count.sets(workout.sets)}`}
            meta={formatDate(workout.date, FIXTURE_TIME_ZONE)}
          />
        ))}
      </ul>
    </Screen>
  );
}
