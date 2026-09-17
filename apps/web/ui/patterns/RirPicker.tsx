'use client';

import { useState } from 'react';
import { messages } from '../i18n/messages';
import { Icon } from '../icons/Icon';
import { Segmented } from '../primitives/Segmented';
import { Sheet } from '../primitives/Sheet';
import { Text } from '../primitives/Text';
import moduleStyles from './RirPicker.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'help' | 'mapping' | 'picker', string>;

const OPTIONS = [
  { value: '0', label: '0' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4+' },
] as const;

/** RPE is derived from RIR and read-only (resolved decision 4); this is the mapping shown. */
const RPE_FOR_RIR = [
  ['0', '10'],
  ['1', '9'],
  ['2', '8'],
  ['3', '7'],
  ['4+', '6 or less'],
] as const;

/**
 * controls.rir.segmented with content.rir-help.helper-sheet: a helper line always visible,
 * and a labelled button that opens a sheet with the RIR to RPE mapping.
 */
export function RirPicker({
  defaultValue,
  startOpen = false,
}: {
  defaultValue?: string;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className={styles.picker}>
      <Segmented
        legend={messages.set.rir}
        name="rir"
        options={OPTIONS}
        defaultValue={defaultValue}
        helper={messages.set.rirHelper}
      />
      <button
        type="button"
        className={styles.help}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="circle-question-mark" size="inline" />
        <span>{messages.set.rirHelpButton}</span>
      </button>
      <Sheet
        title={messages.rirHelp.title}
        closeLabel={messages.actions.close}
        open={open}
        onClose={() => setOpen(false)}
      >
        <Text>{messages.rirHelp.body}</Text>
        <table className={styles.mapping}>
          <thead>
            <tr>
              <th scope="col">RIR</th>
              <th scope="col">RPE</th>
            </tr>
          </thead>
          <tbody>
            {RPE_FOR_RIR.map(([rir, rpe]) => (
              <tr key={rir}>
                <td>{rir}</td>
                <td>{rpe}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Text tone="muted" size="label">
          {messages.rirHelp.mapping}
        </Text>
      </Sheet>
    </div>
  );
}
