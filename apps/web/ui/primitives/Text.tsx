import type { ReactNode } from 'react';
import moduleStyles from './Text.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'heading' | 'text' | 'value', string>;

type HeadingProps = {
  level: 1 | 2 | 3;
  children: ReactNode;
  id?: string;
  /** Route-change focus target (navigation.def.focus). */
  focusTarget?: boolean;
};

/** typography.heading-posture.sentence-semibold. One h1 per screen. */
export function Heading({ level, children, id, focusTarget = false }: HeadingProps) {
  const Tag = `h${level}` as const;
  return (
    <Tag
      id={id}
      className={styles.heading}
      data-level={level}
      tabIndex={focusTarget ? -1 : undefined}
    >
      {children}
    </Tag>
  );
}

type TextProps = {
  children: ReactNode;
  /** typography.scale.two-tier: body and label are the UI tier. */
  size?: 'body' | 'label' | 'title';
  tone?: 'default' | 'muted';
  weight?: 'body' | 'label' | 'heading';
  as?: 'p' | 'span' | 'div';
  id?: string;
};

export function Text({
  children,
  size = 'body',
  tone = 'default',
  weight = 'body',
  as: Tag = 'p',
  id,
}: TextProps) {
  return (
    <Tag id={id} className={styles.text} data-size={size} data-tone={tone} data-weight={weight}>
      {children}
    </Tag>
  );
}

type ValueProps = {
  children: ReactNode;
  /** display is the fluid tier for the focal number: load, reps, the timer. */
  size: 'display' | 'heading' | 'title';
  /** Spoken form, e.g. "80 kilograms", when the visual form abbreviates. */
  spoken?: string;
};

/** Workout numbers: tabular, and 7:1 contrast because they are always ink on a surface. */
export function Value({ children, size, spoken }: ValueProps) {
  return (
    <span className={styles.value} data-size={size}>
      <span aria-hidden={spoken ? true : undefined}>{children}</span>
      {spoken ? <span className="visually-hidden">{spoken}</span> : null}
    </span>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="visually-hidden">{children}</span>;
}

/** A polite live region that is always on the page, so a change to its text is announced. */
export function LiveRegion({ children }: { children: ReactNode }) {
  return (
    <p className="visually-hidden" role="status">
      {children}
    </p>
  );
}
