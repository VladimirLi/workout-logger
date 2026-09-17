import { messages } from '../i18n/messages';
import { Icon } from '../icons/Icon';
import moduleStyles from './SetProgress.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'pill' | 'pills' | 'progress' | 'text', string>;

type SetProgressProps = { total: number; done: number; current: number };

/** navigation.progress.pills-text: a pill per set, a check on done sets, and "Set 2 of 4". */
export function SetProgress({ total, done, current }: SetProgressProps) {
  return (
    <div className={styles.progress}>
      <ol className={styles.pills}>
        {Array.from({ length: total }, (_, index) => {
          const number = index + 1;
          const isDone = number <= done;
          return (
            <li
              key={number}
              className={styles.pill}
              data-done={isDone || undefined}
              data-current={number === current || undefined}
              aria-current={number === current ? 'step' : undefined}
            >
              {isDone ? (
                <Icon name="check" size="inline" />
              ) : (
                <span aria-hidden="true">{number}</span>
              )}
              <span className="visually-hidden">{messages.progress.setPill(number, isDone)}</span>
            </li>
          );
        })}
      </ol>
      <p className={styles.text} aria-hidden="true">
        {messages.progress.set(current, total)}
      </p>
    </div>
  );
}
