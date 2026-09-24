/**
 * The design system's public surface (ADR-0008). Screens import from here and nowhere
 * else; ui/architecture.test.ts enforces it.
 */
export { formatDate, formatLoad, formatLoadReps, speakLoad } from './i18n/format';
export { messages } from './i18n/messages';
export { Icon, type IconName } from './icons/Icon';
export { AgentTag, Delta } from './patterns/Annotations';
export { BottomTabs, StickyActionBar, type TabHrefs, TopBar, WorkoutBar } from './patterns/Bars';
export { FeedbackSettings } from './patterns/FeedbackSettings';
export { LogToRest } from './patterns/LogToRest';
export { ProposalReview, type ProposalView } from './patterns/ProposalReview';
export { RestTimer } from './patterns/RestTimer';
export { RirPicker } from './patterns/RirPicker';
export { Screen, TwoPane } from './patterns/Screen';
export { SetProgress } from './patterns/SetProgress';
export { type SetRow, SetTable } from './patterns/SetTable';
export { SignInForm } from './patterns/SignInForm';
export { type StatusKind, StatusMessage } from './patterns/StatusMessage';
export { SYNC_STATES, SyncIndicator, type SyncState } from './patterns/SyncIndicator';
export { ThemeSetting } from './patterns/ThemeSetting';
export { UndoToast } from './patterns/UndoToast';
export { Button } from './primitives/Button';
export { ConfirmDialog } from './primitives/ConfirmDialog';
export { IconButton } from './primitives/IconButton';
export { ListRow } from './primitives/ListRow';
export { NumberField } from './primitives/NumberField';
export { Segmented } from './primitives/Segmented';
export { Skeleton } from './primitives/Skeleton';
export { Stack } from './primitives/Stack';
export { Stepper } from './primitives/Stepper';
export { Surface } from './primitives/Surface';
export { Switch } from './primitives/Switch';
export { Heading, Text, Value, VisuallyHidden } from './primitives/Text';
export * as fixtures from './reference/fixtures';
export { FIXED_NOW, FIXTURE_TIME_ZONE } from './reference/fixtures';
export { THEME_BOOTSTRAP, THEME_COLOR } from './theme/theme';
