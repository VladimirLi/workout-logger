import type { MetadataRoute } from 'next';

/**
 * Web app manifest, served at /manifest.webmanifest (DESIGN_SYSTEM.md, ADR-0008).
 *
 * brand.name.plain-text, brand.app-icon.bars, brand.launch.manifest-plain (the launch
 * screen is the manifest background plus the icon, no custom splash images), and
 * platform.display-mode.standalone. No orientation lock: both orientations are supported
 * (WCAG 1.3.4, layout.landscape.two-pane).
 *
 * These are the declarations a browser needs. Whether a given phone offers installation is
 * verified only on that phone and recorded in docs/external-gates.md, G-10.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Workout Logger',
    short_name: 'Workout',
    description: 'Single-user gym workout logger.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#EDF0EC',
    theme_color: '#EDF0EC',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-monochrome.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'monochrome',
      },
    ],
  };
}
