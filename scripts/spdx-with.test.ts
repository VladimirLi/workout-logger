import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifySpdx } from './spdx.mjs';

/**
 * `A WITH B` used to be handled by stripping `WITH B` and classifying A. So any string at
 * all could follow WITH: `Apache-2.0 WITH Totally-Made-Up-exception` came out allowed, and
 * so did `MIT WITH Classpath-exception-2.0` - an exception that only exists to modify the
 * GPL, attached to a licence it has nothing to do with.
 *
 * An exception changes the terms of the licence it is attached to. Accepting one we do not
 * recognise, or a pairing that is not real, means shipping under terms nobody read. So the
 * exception identifier must be a recognised SPDX exception, and the pairing must be listed
 * in the project's combination table. Everything else is unknown, which fails closed.
 */

const POLICY = {
  allowed: ['MIT', 'Apache-2.0'],
  rejected: ['AGPL-3.0-only'],
  reviewRequired: ['GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later'],
};

const classify = (expression: string) => classifySpdx(expression, POLICY);

describe('recognised exception, valid pairing', () => {
  it.each([
    ['Apache-2.0 WITH LLVM-exception', 'allowed'],
    ['GPL-2.0-only WITH Classpath-exception-2.0', 'review'],
    ['GPL-2.0-or-later WITH Classpath-exception-2.0', 'review'],
    ['GPL-3.0-or-later WITH GCC-exception-3.1', 'review'],
  ])('classifies %s as %s, by the licence', (expression, verdict) => {
    expect(classify(expression)).toBe(verdict);
  });

  it('keeps a valid pairing valid inside a disjunction', () => {
    expect(classify('Apache-2.0 WITH LLVM-exception OR MIT')).toBe('allowed');
  });
});

describe('unrecognised exception identifiers fail closed', () => {
  it.each([
    'Apache-2.0 WITH Totally-Made-Up-exception',
    'Apache-2.0 WITH LicenseRef-custom-exception',
    'MIT WITH MIT',
  ])('treats %s as unknown', (expression) => {
    expect(classify(expression)).toBe('unknown');
  });

  it('matches exception identifiers exactly, including case', () => {
    expect(classify('Apache-2.0 WITH llvm-exception')).toBe('unknown');
  });

  it('does not accept a deprecated exception identifier as current', () => {
    const deprecated = JSON.parse(
      readFileSync(
        'node_modules/.pnpm/spdx-exceptions@2.5.0/node_modules/spdx-exceptions/deprecated.json',
        'utf8',
      ),
    ) as string[];
    expect(deprecated.length).toBeGreaterThan(0);
    for (const id of deprecated) {
      expect(classify(`GPL-2.0-only WITH ${id}`), id).toBe('unknown');
    }
  });
});

describe('invalid licence/exception pairings fail closed', () => {
  it.each([
    'MIT WITH LLVM-exception',
    'MIT WITH Classpath-exception-2.0',
    'Apache-2.0 WITH Classpath-exception-2.0',
    'GPL-3.0-only WITH Classpath-exception-2.0',
    'GPL-2.0-only WITH GCC-exception-3.1',
    'GPL-2.0-only WITH LLVM-exception',
  ])('treats %s as unknown even though both identifiers are real', (expression) => {
    expect(classify(expression)).toBe('unknown');
  });

  it('does not let a permissive base licence launder a mismatched exception', () => {
    // The specific regression: MIT is allowed, so stripping the exception made this allowed.
    expect(classify('MIT WITH Classpath-exception-2.0')).not.toBe('allowed');
  });

  it('refuses a recognised exception that has no reviewed pairing at all', () => {
    // Recognised by SPDX, but nobody has reviewed which licences it may attach to.
    expect(classify('GPL-2.0-only WITH Qt-GPL-exception-1.0')).toBe('unknown');
  });
});

describe('malformed WITH expressions fail closed', () => {
  it.each([
    'MIT WITH',
    'WITH LLVM-exception',
    ' WITH LLVM-exception',
    'Apache-2.0 WITH LLVM-exception WITH LLVM-exception',
    'Apache-2.0 with LLVM-exception',
    'Apache-2.0 WITH  ',
    'Apache-2.0 WITH (LLVM-exception)',
    'Apache-2.0WITH LLVM-exception',
    'Apache 2.0 WITH LLVM-exception',
  ])('treats %j as unknown', (expression) => {
    expect(classify(expression)).toBe('unknown');
  });
});

describe('the pinned exception data is authoritative', () => {
  const pinned = JSON.parse(readFileSync('scripts/spdx-exceptions.json', 'utf8')) as {
    source: { package: string; version: string; file: string; sha256: string };
    licenseSource: { package: string; version: string; file: string; sha256: string };
    recognized: string[];
    combinations: Record<string, string[]>;
  };

  function installed(pkg: string, version: string, file: string) {
    // Read from the frozen install, at the exact version the lockfile pins. If the
    // package is absent or a different version, this throws and the test fails -
    // it never silently skips the cross-check.
    return readFileSync(`node_modules/.pnpm/${pkg}@${version}/node_modules/${pkg}/${file}`, 'utf8');
  }

  it('matches the installed spdx-exceptions list exactly', () => {
    const { package: pkg, version, file, sha256 } = pinned.source;
    const raw = installed(pkg, version, file);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(sha256);
    expect(pinned.recognized).toEqual(JSON.parse(raw));
  });

  it('pairs only recognised exceptions', () => {
    for (const exception of Object.keys(pinned.combinations)) {
      expect(pinned.recognized, exception).toContain(exception);
    }
  });

  it('pairs exceptions only with real, current SPDX licence identifiers', () => {
    const { package: pkg, version, file, sha256 } = pinned.licenseSource;
    const raw = installed(pkg, version, file);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(sha256);
    const licenses = new Set(JSON.parse(raw) as string[]);
    for (const [exception, bases] of Object.entries(pinned.combinations)) {
      expect(bases.length, exception).toBeGreaterThan(0);
      for (const base of bases) {
        expect(licenses.has(base), `${exception} pairs with unknown licence ${base}`).toBe(true);
      }
    }
  });
});
