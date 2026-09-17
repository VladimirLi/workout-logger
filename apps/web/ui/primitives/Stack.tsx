import type { ReactNode } from 'react';
import moduleStyles from './Stack.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'stack', string>;

type Space = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type StackProps = {
  children: ReactNode;
  /** A step on the 4 px scale: 1 = 4 px ... 7 = 48 px. */
  gap?: Space;
  direction?: 'block' | 'inline';
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  as?: 'div' | 'ul' | 'ol' | 'section' | 'header' | 'footer';
  'aria-labelledby'?: string;
};

/**
 * The layout escape hatch. Only layout props, and only token steps: a screen composes
 * spacing here instead of adding its own CSS.
 */
export function Stack({
  children,
  gap = 4,
  direction = 'block',
  align = 'stretch',
  justify = 'start',
  wrap = false,
  as: Tag = 'div',
  ...aria
}: StackProps) {
  return (
    <Tag
      className={styles.stack}
      data-gap={gap}
      data-direction={direction}
      data-align={align}
      data-justify={justify}
      data-wrap={wrap || undefined}
      {...aria}
    >
      {children}
    </Tag>
  );
}
