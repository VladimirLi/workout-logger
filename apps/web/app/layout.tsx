import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { messages, THEME_BOOTSTRAP, THEME_COLOR } from '../ui';
import { ServiceWorkerRegistration } from './service-worker-registration';
import '../ui/tokens/tokens.css';
import './global.css';

/**
 * Root layout (DESIGN_SYSTEM.md, ADR-0008).
 *
 * Identity follows the accepted decisions: the plain-text name (brand.name.plain-text), the
 * rising-bars app icon (brand.app-icon.bars), standalone display
 * (platform.display-mode.standalone), and a plain manifest launch with no custom splash
 * images (brand.launch.manifest-plain). Declaring these does not make the app installable
 * on a given phone; that is recorded only from a real device (docs/external-gates.md, G-10).
 */

export const metadata: Metadata = {
  title: messages.appName,
  applicationName: messages.appName,
  description: 'Single-user workout logger.',
  appleWebApp: { capable: true, title: messages.appName, statusBarStyle: 'default' },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // userScalable is left at its default so pinch zoom works (WCAG 2.2, R-007).
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // First visit is light; the bootstrap rewrites this for a stored dark preference.
  themeColor: THEME_COLOR.light,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set again by the bootstrap before first paint, so the attribute can
    // legitimately differ from the server HTML.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a static constant with no interpolated input; it must run before first paint to avoid a theme flash (theme.first-visit.light-then-choice) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          {messages.skipToContent}
        </a>
        <main id="main">{children}</main>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
