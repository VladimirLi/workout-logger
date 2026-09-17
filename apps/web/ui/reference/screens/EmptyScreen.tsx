import {
  BottomTabs,
  Button,
  fixtures,
  Heading,
  messages,
  Screen,
  Stack,
  Text,
  TopBar,
} from '../../index';

/**
 * Reference screen: empty history (iconography.empty-visual.text-only): a short heading, one
 * sentence, one button, no image.
 */
export function EmptyScreen() {
  return (
    <Screen
      bar={<TopBar title={messages.nav.history} />}
      bottom={<BottomTabs current="history" hrefs={fixtures.REFERENCE_TAB_HREFS} />}
    >
      <Stack gap={2}>
        <Heading level={2}>{messages.states.empty}</Heading>
        <Text tone="muted">{messages.states.emptyBody}</Text>
        <div>
          <Button variant="primary">{messages.states.emptyAction}</Button>
        </div>
      </Stack>
    </Screen>
  );
}
