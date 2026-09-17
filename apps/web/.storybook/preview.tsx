import type { Decorator, Preview } from '@storybook/nextjs-vite';
import { useEffect } from 'react';
import '../ui/tokens/tokens.css';
import '../app/global.css';

/** Applies the story's theme the same way the app does: a data-theme attribute on <html>. */
const withTheme: Decorator = (Story, context) => {
  const { theme: selected } = context.globals;
  const theme = selected === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return <Story />;
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'padded',
    // Fail loudly on accessibility violations in the Storybook test runner and panel.
    a11y: { test: 'error' },
    nextjs: { appDirectory: true },
  },
};

export default preview;
