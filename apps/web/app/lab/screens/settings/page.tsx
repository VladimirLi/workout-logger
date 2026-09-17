import type { Metadata } from 'next';
import {
  BottomTabs,
  ConfirmDialog,
  FeedbackSettings,
  messages,
  Screen,
  Stack,
  ThemeSetting,
  TopBar,
} from '../../../../ui';

export const metadata: Metadata = { title: messages.documentTitle('Settings') };

/** Reference screen: settings (theme, feedback, and a permanent action behind a dialog). */
export default function SettingsScreen() {
  return (
    <Screen
      bar={<TopBar title={messages.nav.settings} />}
      bottom={<BottomTabs current="settings" />}
    >
      <Stack gap={6}>
        <ThemeSetting />
        <FeedbackSettings />
        <ConfirmDialog
          trigger={messages.confirm.deleteHistoryAction}
          title={messages.confirm.deleteHistory}
          body={messages.confirm.deleteHistoryBody}
          confirm={messages.confirm.deleteHistoryAction}
        />
      </Stack>
    </Screen>
  );
}
