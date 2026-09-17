import { DIRECTIONAL_ICONS, ICON_GEOMETRY, type IconName } from './geometry';
import moduleStyles from './Icon.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'icon', string>;

export type { IconName } from './geometry';

type IconProps = {
  name: IconName;
  /** iconography.def.sizes: 16 inline, 20 body, 24 in buttons. */
  size?: 'inline' | 'body' | 'button';
};

/**
 * A decorative outline icon. Icons never carry meaning alone
 * (iconography.labels.known-only): the text beside them does, so they are hidden from
 * assistive technology. The only icon-only controls are back, close, and more, and
 * IconButton gives those an accessible name.
 */
export function Icon({ name, size = 'body' }: IconProps) {
  return (
    <svg
      className={styles.icon}
      data-size={size}
      data-directional={DIRECTIONAL_ICONS.has(name) || undefined}
      data-icon={name}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_GEOMETRY[name].map(([tag, attributes], index) => {
        const Tag = tag;
        // Geometry is static data; its order is its identity.
        return <Tag key={index} {...attributes} />;
      })}
    </svg>
  );
}
