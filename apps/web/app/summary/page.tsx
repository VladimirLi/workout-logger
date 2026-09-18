'use client';

import { Suspense } from 'react';
import { Screen, Skeleton, TopBar } from '../../ui';
import { SummaryView } from './SummaryView';

/**
 * A finished session (workout-logging spec, tasks 5.1 and 9.1).
 *
 * The session id is a query parameter rather than a path segment, so this is ONE static route
 * the service worker can cache. A path per session would need a server document per session,
 * which is precisely what a phone with no signal cannot fetch - the summary would have been
 * unreachable exactly when the device is the only place the workout exists. The address still
 * identifies the summary, so it can be reopened, linked, and returned to later.
 *
 * The Suspense boundary is what lets the route be prerendered while the view reads the query
 * string in the browser.
 */
export default function SummaryPage() {
  return (
    <Suspense
      fallback={
        <Screen bar={<TopBar title="Summary" back />}>
          <Skeleton label="Loading the summary" />
        </Screen>
      }
    >
      <SummaryView />
    </Suspense>
  );
}
