import moduleStyles from './Skeleton.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'block' | 'label' | 'skeleton', string>;

type SkeletonProps = {
  /** Announced politely; the blocks themselves are hidden from assistive technology. */
  label: string;
  rows?: number;
};

/**
 * feedback.loading.skeleton-delayed: nothing for the first 300 ms, then static blocks.
 * There is no shimmer: a loop would be motion without meaning.
 */
export function Skeleton({ label, rows = 3 }: SkeletonProps) {
  return (
    <div className={styles.skeleton}>
      <p className={styles.label} role="status">
        {label}
      </p>
      {Array.from({ length: rows }, (_, row) => (
        <div key={`row-${row + 1}`} className={styles.block} aria-hidden="true" />
      ))}
    </div>
  );
}
