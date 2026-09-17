#!/usr/bin/env node
/**
 * Serves a directory over HTTP for the browser gates: the static Storybook build that is the
 * design-system lab (ADR-0010). Read-only, loopback only, no directory listings, and it refuses
 * paths outside the served root.
 *
 *   node scripts/serve-static.mjs <directory> <port>
 *
 * GUARDRAIL FILE: the browser gates depend on what it serves.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const [directory, portText] = process.argv.slice(2);
if (!directory || !portText) {
  console.error('usage: serve-static.mjs <directory> <port>');
  process.exit(2);
}
const root = resolve(directory);
if (!existsSync(join(root, 'index.html'))) {
  console.error(`serve-static: ${root} has no index.html; build it first (pnpm storybook:build)`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((request, response) => {
  const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/'));
  const file = join(root, path === sep || path === '/' ? 'index.html' : path);
  if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(Number(portText), '127.0.0.1', () => {
  console.log(`serve-static: ${root} on http://127.0.0.1:${portText}`);
});
