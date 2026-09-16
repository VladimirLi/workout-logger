import type { MetadataRoute } from 'next';

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * This is manifest PLUMBING, not installability.
 *
 * A browser will not offer to install a PWA without icons, and icons are visual
 * assets that the undecided design system owns (DESIGN_SYSTEM.md, ADR-0007). So this
 * app is NOT installable today, and inventing placeholder icons to make it look
 * installable would be exactly the kind of accidental visual decision ADR-0007
 * exists to prevent.
 *
 * Installability is a product goal (D-021), reachable only after gate G-10. What is
 * verified now is that the manifest route is served and well formed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Workout Logger',
    short_name: 'Workout',
    description: 'Single-user gym workout logger.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
  };
}
