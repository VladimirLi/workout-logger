import { formatDate, formatDelta } from '../i18n/format';
import { messages } from '../i18n/messages';
import moduleStyles from './Annotations.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'agentTag' | 'attribution' | 'date' | 'delta', string>;

/** data.comparison.delta-text: words and a neutral arrow; no red or green judgement. */
export function Delta({ kg }: { kg: number }) {
  const arrow = kg > 0 ? '↑' : kg < 0 ? '↓' : '→';
  return (
    <span className={styles.delta}>
      <span aria-hidden="true">{arrow}</span> {formatDelta(kg)}
    </span>
  );
}

/** content.agent-attribution.text-tag: a neutral "From agent" tag, and the date on a line below. */
export function AgentTag({ createdAt, timeZone }: { createdAt: number; timeZone: string }) {
  return (
    <span className={styles.attribution}>
      <span className={styles.agentTag}>{messages.agent.tag}</span>
      <span className={styles.date}>{messages.agent.created(formatDate(createdAt, timeZone))}</span>
    </span>
  );
}
