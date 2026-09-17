import {
  BottomTabs,
  ConfirmDialog,
  FeedbackSettings,
  fixtures,
  messages,
  Screen,
  Stack,
  ThemeSetting,
  TopBar,
} from '../../index';

/** Reference screen: settings (theme, feedback, and a permanent action behind a dialog). */
export function SettingsScreen() {
  return (
    <Screen
      bar={<TopBar title={messages.nav.settings} />}
      bottom={<BottomTabs current="settings" hrefs={fixtures.REFERENCE_TAB_HREFS} />}
    >
      <Stack gap={6}>
        <ThemeSetting />
        <FeedbackSettings />
        <ConfirmDialog
          trigger={messages.confirm.deleteHistoryAction}
          title={messages.confirm.deleteHistory}
          body={messages.confirm.deleteHistoryBody}
          confirm={messages.confirm.deleteHistoryAction}
          cancel={messages.confirm.keepHistory}
        />
      </Stack>
    </Screen>
  );
}
