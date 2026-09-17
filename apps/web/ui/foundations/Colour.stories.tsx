import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { themeTokens } from '../tokens/tokens.generated';
import moduleStyles from './Foundations.module.css';

/** CSS Module class names used here; ui/css-modules.test.ts checks each exists. */
const styles = moduleStyles as Record<'swatch' | 'table', string>;

type Role = keyof (typeof themeTokens)['light'];

function Palette() {
  const roles = (Object.keys(themeTokens.light) as Role[]).filter((role) =>
    role.startsWith('color-'),
  );
  return (
    <table className={styles.table}>
      <caption>Semantic colour roles</caption>
      <thead>
        <tr>
          <th scope="col">Role</th>
          <th scope="col">Light</th>
          <th scope="col">Dark</th>
        </tr>
      </thead>
      <tbody>
        {roles.map((role) => (
          <tr key={role}>
            <th scope="row">
              <code>--{role}</code>
            </th>
            {(['light', 'dark'] as const).map((theme) => (
              <td key={theme}>
                {/* A swatch is the one place forced colours must not repaint (color.def.forced). */}
                <span
                  className={styles.swatch}
                  style={{ background: themeTokens[theme][role] }}
                  aria-hidden="true"
                />{' '}
                <code>{themeTokens[theme][role]}</code>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const meta = {
  title: 'Foundations/Colour',
  component: Palette,
} satisfies Meta<typeof Palette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SemanticRoles: Story = {};
