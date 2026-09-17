import type { Metadata } from 'next';
import { BottomTabs, Button, Heading, messages, Screen, Stack, Text, TopBar } from '../../../../ui';

export const metadata: Metadata = { title: messages.documentTitle('History') };

/**
 * Reference screen: empty history (iconography.empty-visual.text-only): a short heading, one
 * sentence, one button, no image.
 */
export default function EmptyScreen() {
  return (
    <Screen bar={<TopBar title={messages.nav.history} />} bottom={<BottomTabs current="history" />}>
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
