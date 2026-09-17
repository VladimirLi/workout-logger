import type {
  ExercisePrescription,
  Measurement,
  PlanDiff,
  ScheduledSession,
} from '@workout/domain';
import type { ReactNode } from 'react';
import { formatDate, formatMeasurement } from '../i18n/format';
import { messages } from '../i18n/messages';
import { Heading, Text } from '../primitives/Text';
import { AgentTag } from './Annotations';
import moduleStyles from './ProposalReview.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<
  'arrow' | 'change' | 'changes' | 'detail' | 'rationale' | 'review' | 'title',
  string
>;

/**
 * Proposal review (agent-proposals spec: "The user reviews proposals in the PWA").
 *
 * The minimum the accepted specification requires, composed from accepted components: the base
 * revision, the structured diff in words, the rationale, and the creation time. The rationale is
 * untrusted agent text, so it is rendered as plain text, never as markup.
 */

export interface ProposalView {
  readonly baseRevision: number;
  readonly createdAt: number;
  readonly rationale: string;
  readonly diff: PlanDiff;
}

type ProposalReviewProps = {
  proposal: ProposalView;
  /** The plan the proposal was made against, so a change can show what it replaces. */
  planSessions: readonly ScheduledSession[];
  exerciseNames: Readonly<Record<string, string>>;
  timeZone: string;
};

const day = (date: string) => formatDate(Date.parse(`${date}T00:00:00Z`), 'UTC');

function Change({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <li className={styles.change}>
      <span className={styles.title}>{title}</span>
      {children ? <span className={styles.detail}>{children}</span> : null}
    </li>
  );
}

function FromTo({ from, to }: { from: Measurement | undefined; to: Measurement }) {
  if (!from) return <>{formatMeasurement(to)}</>;
  return (
    <>
      {formatMeasurement(from)}{' '}
      <span aria-hidden="true" className={styles.arrow}>
        →
      </span>
      <span className="visually-hidden">{` ${messages.proposal.changesTo} `}</span>{' '}
      {formatMeasurement(to)}
    </>
  );
}

function exerciseChanges(
  before: readonly ExercisePrescription[] | undefined,
  after: readonly ExercisePrescription[],
  names: Readonly<Record<string, string>>,
): ReactNode[] {
  return after.map((exercise) => {
    const previous = before?.find((item) => item.exerciseId === exercise.exerciseId)?.prescription;
    return (
      <Change key={exercise.exerciseId} title={names[exercise.exerciseId] ?? exercise.exerciseId}>
        <FromTo from={previous} to={exercise.prescription} />
      </Change>
    );
  });
}

function diffItems(
  diff: PlanDiff,
  sessions: readonly ScheduledSession[],
  names: Readonly<Record<string, string>>,
): ReactNode[] {
  const session = (id: string) => sessions.find((candidate) => candidate.id === id);
  switch (diff.op) {
    case 'replace_plan':
      return [
        <Change key="replace" title={messages.proposal.replacePlan}>
          {messages.proposal.sessions(diff.sessions.length)}
        </Change>,
      ];
    case 'change_scheduled_session': {
      const current = session(diff.sessionId);
      const items: ReactNode[] = [];
      if (diff.scheduledFor) {
        items.push(
          <Change
            key="date"
            title={messages.proposal.sessionOn(
              current ? day(current.scheduledFor) : diff.sessionId,
            )}
          >
            {messages.proposal.movesTo(day(diff.scheduledFor))}
          </Change>,
        );
      }
      if (diff.exercises) items.push(...exerciseChanges(current?.exercises, diff.exercises, names));
      return items;
    }
    case 'change_exercise_prescription':
      return exerciseChanges(
        session(diff.sessionId)?.exercises,
        [{ exerciseId: diff.exerciseId, prescription: diff.prescription }],
        names,
      );
    case 'correct_completed_session':
      return diff.corrections.map((correction) => (
        <Change key={correction.setId} title={messages.proposal.correction}>
          {messages.proposal.correctedSet(
            correction.setId,
            formatMeasurement(correction.measurement),
          )}
        </Change>
      ));
  }
}

export function ProposalReview({
  proposal,
  planSessions,
  exerciseNames,
  timeZone,
}: ProposalReviewProps) {
  return (
    <div className={styles.review}>
      <AgentTag createdAt={proposal.createdAt} timeZone={timeZone} withTime />
      <Text size="label" tone="muted">
        {messages.proposal.baseRevision(proposal.baseRevision)}
      </Text>
      <ul className={styles.changes} aria-label={messages.proposal.changes}>
        {diffItems(proposal.diff, planSessions, exerciseNames)}
      </ul>
      <section className={styles.rationale} aria-labelledby="proposal-why">
        <Heading level={2} id="proposal-why">
          {messages.proposal.why}
        </Heading>
        <Text>{proposal.rationale}</Text>
      </section>
    </div>
  );
}
