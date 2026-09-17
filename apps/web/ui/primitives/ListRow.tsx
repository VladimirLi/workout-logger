import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import moduleStyles from './ListRow.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<
  'detail' | 'item' | 'meta' | 'row' | 'text' | 'title',
  string
>;

type ListRowProps = {
  href: Route;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
};

/** A plain list row (shape.card-policy.focal-groups): no card, a 56 px minimum, a divider. */
export function ListRow({ href, title, detail, meta }: ListRowProps) {
  return (
    <li className={styles.item}>
      <Link href={href} className={styles.row}>
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          {detail ? <span className={styles.detail}>{detail}</span> : null}
        </span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
        <Icon name="chevron-right" size="body" />
      </Link>
    </li>
  );
}
