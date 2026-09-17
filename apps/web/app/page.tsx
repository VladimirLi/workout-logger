import Link from 'next/link';
import { Heading, messages, Screen, Stack, Surface, Text, TopBar } from '../ui';

/**
 * Landing page. It states what exists and what does not. Product screens (plan, active
 * workout, summary; R-003) are separate feature changes built on the design system; the
 * coded reference screens live in the design-system lab.
 */
export default function HomePage() {
  return (
    <Screen bar={<TopBar title="Foundation shell" />}>
      {/* brand.name.plain-text: the name in the UI font at 600, no logo lockup. */}
      <Text weight="heading">{messages.appName}</Text>
      <Text>
        The structural skeleton of the workout logger, styled with the accepted design system. It
        has no product features yet, and that is deliberate.
      </Text>

      <Surface tone="plain" as="section" aria-labelledby="decided">
        <Stack gap={2}>
          <Heading level={2} id="decided">
            Decided and enforced
          </Heading>
          <ul>
            <li>Provider-neutral domain with machine-enforced dependency direction.</li>
            <li>Agent writes are proposals; a moved base revision is rejected as stale.</li>
            <li>Typed measurement profiles with canonical units.</li>
            <li>Telemetry allowlist with a canary test proving workout content is dropped.</li>
            <li>The Quiet Performance design system: tokens, components, and baselines.</li>
          </ul>
        </Stack>
      </Surface>

      <Surface tone="plain" as="section" aria-labelledby="not-built">
        <Stack gap={2}>
          <Heading level={2} id="not-built">
            Not built yet
          </Heading>
          <ul>
            <li>
              Workout logging screens. The Storybook lab shows how they will look, with fixtures.
            </li>
            <li>Offline logging and the transactional outbox.</li>
            <li>Authentication, persistence, and the remote MCP server.</li>
          </ul>
        </Stack>
      </Surface>

      <ul>
        <li>
          <Link href="/offline">Offline fallback page</Link>
        </li>
      </ul>
    </Screen>
  );
}
