import {
  Button,
  FIXED_NOW,
  fixtures,
  formatLoad,
  Heading,
  messages,
  RestTimer,
  SetProgress,
  Stack,
  StatusMessage,
  Surface,
  Text,
} from '../../../../ui';

const { CURRENT_EXERCISE: exercise, REST } = fixtures;

export const REST_HEADING_ID = 'rest-heading';

/** Rest after a logged set (feedback.set-saved.inline-rest, motion.rest-timer.ring-stepped). */
export function RestView() {
  return (
    <>
      <Heading level={1} id={REST_HEADING_ID} focusTarget>
        {messages.rest.heading}
      </Heading>
      {/* feedback.set-saved.inline-rest: the logged set's pill now carries its check. */}
      <SetProgress
        total={exercise.set.total}
        done={exercise.set.current}
        current={exercise.set.current + 1}
      />
      <StatusMessage kind="success">{messages.set.saved(2, REST.durationSeconds)}</StatusMessage>
      <Surface tone="card" aria-label="Rest timer">
        <RestTimer
          durationSeconds={REST.durationSeconds}
          startedAt={REST.startedAt}
          initialNow={FIXED_NOW}
        />
      </Surface>
      <Text weight="label">
        {messages.rest.next(
          exercise.name,
          formatLoad(exercise.target.loadKg),
          exercise.target.reps,
        )}
      </Text>
      <Stack direction="inline" gap={2} justify="between" wrap>
        <Button variant="secondary">{messages.actions.addTime}</Button>
        <Button variant="tertiary">{messages.actions.skipRest}</Button>
      </Stack>
    </>
  );
}
