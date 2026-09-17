'use client';

import { useId } from 'react';
import { messages } from '../i18n/messages';
import moduleStyles from './Switch.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<
  'helper' | 'label' | 'row' | 'state' | 'switch' | 'text',
  string
>;

type SwitchProps = {
  label: string;
  helper?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * controls.def.switch: only for settings that apply at once, and always with On or Off in
 * words beside it, so the state never depends on the thumb's position or colour.
 */
export function Switch({ label, helper, checked, onChange }: SwitchProps) {
  const id = useId();
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {helper ? (
          <p id={`${id}-helper`} className={styles.helper}>
            {helper}
          </p>
        ) : null}
      </div>
      <span className={styles.state} aria-hidden="true">
        {checked ? messages.settings.on : messages.settings.off}
      </span>
      <input
        id={id}
        className={styles.switch}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        aria-describedby={helper ? `${id}-helper` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}
