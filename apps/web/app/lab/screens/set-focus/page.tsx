import type { Metadata } from 'next';
import { messages } from '../../../../ui';
import { SetFocus } from './SetFocus';

export const metadata: Metadata = { title: messages.documentTitle('Set focus') };

export default function SetFocusScreen() {
  return <SetFocus />;
}
