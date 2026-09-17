import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ICON_GEOMETRY } from './geometry';

const HERE = __dirname;
const WEB = join(HERE, '..', '..');
const ledger = readFileSync(join(HERE, 'ICONS_LICENSES.md'), 'utf8');
const ledgerNames = [...ledger.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((match) => match[1]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry) ? [path] : [];
  });
}

describe('icon ledger (ICONS_LICENSES.md)', () => {
  it('lists exactly the icons the app can render', () => {
    expect([...ledgerNames].sort()).toEqual(Object.keys(ICON_GEOMETRY).sort());
  });

  it('records a licence for every icon', () => {
    for (const row of ledger.split('\n').filter((line) => line.startsWith('| `'))) {
      expect(row, row).toMatch(/\| (ISC|ISC AND MIT \(Feather-derived\)) \|$/);
    }
  });

  it('keeps the full upstream licence text beside the vendored geometry', () => {
    const text = readFileSync(join(HERE, 'LICENSE-lucide.txt'), 'utf8');
    expect(text).toContain('ISC License');
    expect(text).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    expect(text).toContain('Copyright (c) 2013-present Cole Bemis');
    expect(readFileSync(join(WEB, 'public', 'third-party-notices.txt'), 'utf8')).toContain(text);
  });

  it('imports no icon package anywhere in the web app', () => {
    const manifest = readFileSync(join(WEB, 'package.json'), 'utf8');
    expect(manifest).not.toMatch(/lucide|heroicons|feather|fontawesome|material-symbols/i);
    for (const file of [...sourceFiles(join(WEB, 'app')), ...sourceFiles(join(WEB, 'ui'))]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /from ['"](lucide|@heroicons|react-icons)/,
      );
    }
  });

  it('stays inside the 15 KB compressed icon budget (performance.budget.moderate)', () => {
    const size = gzipSync(readFileSync(join(HERE, 'geometry.ts'))).length;
    expect(size).toBeLessThanOrEqual(15_000);
  });
});
