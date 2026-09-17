import type { Decorator, Preview } from '@storybook/nextjs-vite';
import '../ui/tokens/tokens.css';
import '../app/global.css';

/**
 * The design-system lab (governance.lab.storybook, ADR-0010).
 *
 * Theme: applied to <html> before each story renders, exactly as the app's bootstrap does, so an
 * accessibility check never measures a half-switched theme.
 *
 * Page context: a component never appears on a page outside a main landmark with a heading.
 * Component stories are placed in that context, with the story's name as the page heading, so
 * page-level accessibility rules judge them as they will be used. Reference-screen stories set
 * `pageContext: false` because a screen brings its own header, main, and h1.
 */

const withPageContext: Decorator = (Story, context) => {
  const { pageContext } = context.parameters;
  if (pageContext === false) return <Story />;
  return (
    <main>
      <h1 className="visually-hidden">{`${context.title.split('/').at(-1)}: ${context.name}`}</h1>
      <Story />
    </main>
  );
};

const preview: Preview = {
  decorators: [withPageContext],
  beforeEach: ({ globals }) => {
    const { theme } = globals;
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  },
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
    a11y: { test: 'error' },
    nextjs: { appDirectory: true },
    options: {
      storySort: {
        order: [
          'Foundations',
          'Primitives',
          'Patterns',
          ['Navigation', 'Workout', 'Feedback', 'Data', 'Settings', 'Proposals', 'Layout'],
          'Reference screens',
        ],
      },
    },
  },
};

export default preview;
