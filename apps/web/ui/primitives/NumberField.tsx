import { useId } from 'react';
import { Icon } from '../icons/Icon';
import moduleStyles from './NumberField.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<
  'control' | 'error' | 'field' | 'helper' | 'input' | 'label' | 'unit',
  string
>;

type NumberFieldProps = {
  label: string;
  name: string;
  defaultValue?: string;
  unit?: string;
  helper?: string;
  /** Shown below with an icon and a thicker border; never colour alone. */
  error?: string;
};

/**
 * controls.field.outlined-label-above with platform.number-entry.native-decimal: the phone
 * shows its own decimal keypad. The value is text so a decimal comma is accepted.
 */
export function NumberField({ label, name, defaultValue, unit, helper, error }: NumberFieldProps) {
  const id = useId();
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={styles.field} data-invalid={error ? true : undefined}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.control}>
        <input
          id={id}
          name={name}
          className={styles.input}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, helperId].filter(Boolean).join(' ') || undefined}
        />
        {unit ? (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className={styles.error}>
          <Icon name="triangle-alert" size="inline" />
          <span>{error}</span>
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className={styles.helper}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}
