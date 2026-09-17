import type { StorybookConfig } from '@storybook/nextjs-vite';

/**
 * Storybook lab (governance.lab.storybook), approved by Vladimir on 2026-09-17.
 *
 * The only design-system lab (ADR-0010): foundations, primitives, patterns, and reference
 * screens, rendered from `ui/` with the generated tokens and the document base. The accessibility addon runs axe per story; viewport and interaction tools
 * are built into Storybook 10. `pnpm storybook:build` is part of `pnpm verify`.
 */
const config: StorybookConfig = {
  stories: ['../ui/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/nextjs-vite', options: {} },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  staticDirs: ['../public'],
};

export default config;
