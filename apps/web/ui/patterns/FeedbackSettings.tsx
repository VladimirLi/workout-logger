'use client';

import { messages } from '../i18n/messages';
import { usePreference } from '../preferences/preferences';
import { Switch } from '../primitives/Switch';

/** haptics.rest-end.vibrate-optional-sound: vibration on, the rest tone off, by default. */
export function FeedbackSettings() {
  const [vibration, setVibration] = usePreference('vibration');
  const [restSound, setRestSound] = usePreference('restSound');
  return (
    <div>
      <Switch
        label={messages.settings.vibration}
        helper={messages.settings.vibrationHelp}
        checked={vibration}
        onChange={setVibration}
      />
      <Switch
        label={messages.settings.restSound}
        helper={messages.settings.restSoundHelp}
        checked={restSound}
        onChange={setRestSound}
      />
    </div>
  );
}
