import { type CSSProperties, useId } from 'react';
import { Icon } from '../icons/Icon';
import moduleStyles from './Segmented.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<
  'check' | 'group' | 'helper' | 'input' | 'legend' | 'segment' | 'segments',
  string
>;

type SegmentedProps = {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | undefined;
  helper?: string;
};

/**
 * controls.rir.segmented: one row of equal segments. Native radio inputs, so arrow keys,
 * form submission, and screen-reader semantics come from the platform. The selected
 * segment is raised and carries a check, so selection never depends on colour.
 */
export function Segmented({ legend, name, options, defaultValue, helper }: SegmentedProps) {
  const id = useId();
  return (
    <fieldset className={styles.group} aria-describedby={helper ? `${id}-helper` : undefined}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.segments} style={{ '--segments': options.length } as CSSProperties}>
        {options.map((option) => (
          <label key={option.value} className={styles.segment}>
            <input
              className={styles.input}
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === defaultValue}
            />
            <span className={styles.check}>
              <Icon name="check" size="inline" />
            </span>
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {helper ? (
        <p id={`${id}-helper`} className={styles.helper}>
          {helper}
        </p>
      ) : null}
    </fieldset>
  );
}
