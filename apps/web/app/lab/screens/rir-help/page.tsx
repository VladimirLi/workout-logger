import type { Metadata } from 'next';
import { messages } from '../../../../ui';
import { SetFocus } from '../set-focus/SetFocus';

export const metadata: Metadata = { title: messages.documentTitle('RIR help') };

/** Reference screen: the RIR help sheet open over set focus (content.rir-help.helper-sheet). */
export default function RirHelpScreen() {
  return <SetFocus helpOpen />;
}
