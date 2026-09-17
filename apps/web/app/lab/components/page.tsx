import type { Metadata } from 'next';
import {
  AgentTag,
  Button,
  Delta,
  FIXED_NOW,
  FIXTURE_TIME_ZONE,
  fixtures,
  Heading,
  IconButton,
  messages,
  NumberField,
  Screen,
  SetProgress,
  SetTable,
  Stack,
  Stepper,
  Surface,
  Text,
  TopBar,
  Value,
} from '../../../ui';

export const metadata: Metadata = { title: messages.documentTitle('Components') };

export default function ComponentsPage() {
  return (
    <Screen bar={<TopBar title="Components" />}>
      <Stack gap={3} as="section" aria-labelledby="buttons">
        <Heading level={2} id="buttons">
          Buttons
        </Heading>
        <Button variant="primary" size="lg" expand>
          {messages.actions.logSet}
        </Button>
        <Button variant="primary" size="lg" expand busyLabel={messages.actions.saving}>
          {messages.actions.logSet}
        </Button>
        <Stack direction="inline" gap={2} wrap>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
        </Stack>
        <Stack direction="inline" gap={2}>
          <IconButton action="back" label={messages.actions.back} />
          <IconButton action="close" label={messages.actions.close} />
          <IconButton action="more" label={messages.actions.more} />
        </Stack>
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="inputs">
        <Heading level={2} id="inputs">
          Inputs
        </Heading>
        <Surface tone="panel">
          <Stack gap={4}>
            <Stepper quantity="load" defaultValue={80} />
            <Stepper quantity="reps" defaultValue={8} />
            <NumberField
              label="Body weight"
              name="weight"
              unit="kg"
              defaultValue="72,5"
              helper="Optional"
            />
            <NumberField
              label="Load"
              name="load"
              unit="kg"
              defaultValue="80.3"
              error="Use steps of 0.25 kg."
            />
          </Stack>
        </Surface>
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="progress">
        <Heading level={2} id="progress">
          Progress
        </Heading>
        <SetProgress total={4} done={1} current={2} />
        <SetProgress total={4} done={4} current={4} />
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="type">
        <Heading level={2} id="type">
          Type
        </Heading>
        <Value size="display" spoken="80 kilograms">
          80 kg
        </Value>
        <Value size="heading">1:30</Value>
        <Text size="title">Title text</Text>
        <Text>Body text for plain explanations.</Text>
        <Text size="label" tone="muted">
          Label text, muted
        </Text>
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="surfaces">
        <Heading level={2} id="surfaces">
          Surfaces
        </Heading>
        <Surface tone="card">
          <Text>Card: the focal object only.</Text>
        </Surface>
        <Surface tone="panel">
          <Text>Panel: groups inputs.</Text>
        </Surface>
        <Surface tone="plain">
          <Text>Plain: everything else.</Text>
        </Surface>
      </Stack>

      <Stack gap={3} as="section" aria-labelledby="data">
        <Heading level={2} id="data">
          Data
        </Heading>
        <SetTable caption="Romanian deadlift" rows={fixtures.DEADLIFT_SETS} />
        <Stack direction="inline" gap={3} wrap>
          <Delta kg={2.5} />
          <Delta kg={-5} />
          <Delta kg={0} />
        </Stack>
        <AgentTag createdAt={FIXED_NOW} timeZone={FIXTURE_TIME_ZONE} />
      </Stack>
    </Screen>
  );
}
