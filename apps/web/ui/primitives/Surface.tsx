import type { ReactNode } from 'react';
import moduleStyles from './Surface.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'surface', string>;

type SurfaceProps = {
  children: ReactNode;
  /**
   * shape.card-policy.focal-groups: `card` (raised) only for the focal object or the rest
   * timer; `panel` (sunken) groups inputs; `plain` is the default page surface.
   */
  tone: 'card' | 'panel' | 'plain';
  as?: 'div' | 'section' | 'article';
  'aria-labelledby'?: string;
  'aria-label'?: string;
};

/** Tonal elevation only (shape.elevation.tonal): surfaces never cast shadows. */
export function Surface({ children, tone, as: Tag = 'div', ...aria }: SurfaceProps) {
  return (
    <Tag className={styles.surface} data-tone={tone} {...aria}>
      {children}
    </Tag>
  );
}
