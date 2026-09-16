import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ServiceWorkerRegistration } from './service-worker-registration';
import './global.css';

/**
 * Root layout - structural only.
 *
 * No brand, no visual language, no component library (ADR-0007). Landmarks and
 * skip navigation are here because they are accessibility structure, which is
 * required regardless of what the design system turns out to be.
 */

export const metadata: Metadata = {
  title: 'Workout Logger',
  description:
    'Single-user workout logger. Structural shell; the design system is not decided yet.',
  applicationName: 'Workout Logger',
  appleWebApp: { capable: true, title: 'Workout Logger', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  // Phone-first (R-004). userScalable is left at its default so pinch zoom works;
  // suppressing it would fail the WCAG 2.2 zoom requirement (R-007).
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <header>
          <p>
            <strong>Workout Logger</strong> — foundation shell
          </p>
        </header>
        <main id="main">{children}</main>
        <footer>
          <p>
            Unstyled by design. The visual design system is an open decision; see DESIGN_SYSTEM.md.
          </p>
        </footer>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
