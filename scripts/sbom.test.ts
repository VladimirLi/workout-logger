import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The SBOM is evidence, and evidence that changes every time it is produced is hard
 * to reason about. These assert it is well formed and byte-reproducible from the
 * committed lockfile, so a checksum recorded against a release is meaningful and two
 * SBOMs can be diffed for real dependency changes.
 */

function generate(): string {
  execFileSync('pnpm', ['sbom:generate'], { encoding: 'utf8', stdio: 'pipe' });
  return readFileSync('artifacts/sbom.cdx.json', 'utf8');
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('sbom', () => {
  it('is byte-reproducible across runs over the same lockfile', () => {
    expect(digest(generate())).toBe(digest(generate()));
  });

  it('is valid CycloneDX describing a non-empty component set', () => {
    const document = JSON.parse(generate()) as {
      bomFormat: string;
      specVersion: string;
      components: { name: string; version: string; purl?: string }[];
    };

    expect(document.bomFormat).toBe('CycloneDX');
    expect(document.specVersion).toBe('1.6');
    expect(document.components.length).toBeGreaterThan(100);
    expect(document.components.every((c) => Boolean(c.name && c.version))).toBe(true);
  });

  it('carries no wall-clock timestamp or per-run serial number', () => {
    const document = JSON.parse(generate()) as {
      serialNumber?: string;
      metadata?: { timestamp?: string };
    };

    expect(document.serialNumber).toBeUndefined();
    expect(document.metadata?.timestamp).toBeUndefined();
  });
});
