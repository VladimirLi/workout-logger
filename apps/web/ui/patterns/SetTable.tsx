import { formatLoad, formatNumber, MISSING, speakLoad } from '../i18n/format';
import { messages } from '../i18n/messages';
import { Button } from '../primitives/Button';
import moduleStyles from './SetTable.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'caption' | 'scroller' | 'table' | 'unit', string>;

export type SetRow = {
  set: number;
  loadKg?: number;
  reps?: number;
  rir?: number;
  /** Names the row for an action on it and anchors focus to it. Needed only with `onEdit`. */
  id?: string;
  /** The exercise the row belongs to, for an action's accessible name. */
  exercise?: string;
};

/** The id of a row's Edit button, so a screen can return focus to it after a change. */
export const editButtonId = (rowId: string) => `edit-set-${rowId}`;

function Missing() {
  return (
    <>
      <span aria-hidden="true">{MISSING}</span>
      <span className="visually-hidden">{messages.set.notRecorded}</span>
    </>
  );
}

/**
 * data.set-table.aligned-table: a real table, right-aligned tabular numbers. At large text
 * sizes a table may be wider than a phone; it then scrolls inside its own keyboard-focusable
 * region, and the page itself never scrolls sideways (WCAG 1.4.10).
 */
export function SetTable({
  caption,
  rows,
  onEdit,
}: {
  caption: string;
  rows: readonly SetRow[];
  /** Adds a trailing Edit column to rows that have an id. Absent where a table is read-only. */
  onEdit?: (row: SetRow) => void;
}) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard
    <section className={styles.scroller} tabIndex={0} aria-label={caption}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Set</th>
            <th scope="col">
              {messages.set.load} <span className={styles.unit}>kg</span>
            </th>
            <th scope="col">{messages.set.reps}</th>
            <th scope="col">{messages.set.rir}</th>
            {onEdit && (
              <th scope="col">
                <span className="visually-hidden">{messages.actions.label}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.set}>
              <th scope="row">{formatNumber(row.set)}</th>
              <td>
                {row.loadKg === undefined ? (
                  <Missing />
                ) : (
                  <>
                    <span aria-hidden="true">{formatLoad(row.loadKg).replace(/ kg$/, '')}</span>
                    <span className="visually-hidden">{speakLoad(row.loadKg)}</span>
                  </>
                )}
              </td>
              <td>{row.reps === undefined ? <Missing /> : formatNumber(row.reps)}</td>
              <td>{row.rir === undefined ? <Missing /> : formatNumber(row.rir)}</td>
              {onEdit && (
                <td>
                  {row.id !== undefined && (
                    <Button
                      variant="tertiary"
                      id={editButtonId(row.id)}
                      aria-label={messages.set.editLabel(row.set, row.exercise ?? '')}
                      onClick={() => onEdit(row)}
                    >
                      {messages.actions.edit}
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
