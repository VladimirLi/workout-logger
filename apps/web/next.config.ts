import type { NextConfig } from 'next';

/**
 * Deliberately minimal.
 *
 * No CSS framework, no UI library, no bundler plugins beyond what Next.js ships. The
 * accepted design system (DESIGN_SYSTEM.md, ADR-0008) is plain CSS custom properties and
 * CSS Modules, which Next.js supports natively.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // sharp is excluded from the dependency graph (pnpm-workspace.yaml,
  // ignoredOptionalDependencies) because it pulls an LGPL-3.0-or-later libvips
  // binary into the runtime tree for image optimization this product does not use.
  // Declaring it here means a future <Image> will fail loudly rather than silently
  // falling back.
  images: { unoptimized: true },
  // Transpiled from source so the monorepo does not need a separate build step
  // for shared packages during development.
  transpilePackages: [
    '@workout/domain',
    '@workout/contracts',
    '@workout/application',
    '@workout/observability',
    '@workout/adapters-supabase',
  ],
  typedRoutes: true,
  poweredByHeader: false,
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
    {
      // A cached service worker is a stuck service worker: the browser would keep
      // serving an old one and the user would have no way to get the new version.
      // Headers per the Next.js PWA guide.
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
      ],
    },
  ],
};

export default nextConfig;
