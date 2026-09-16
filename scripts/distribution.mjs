/**
 * Detection of breaches of the licence approval conditions (owner decision,
 * 2026-09-16).
 *
 * Every licence exception's legal analysis assumes two things: the product is NOT
 * DISTRIBUTED, and the excepted dependencies are UNMODIFIED. A change to either voids
 * the analysis, so it must fail the gate and force new review rather than silently
 * inherit the old approval.
 *
 * This is deliberately a detector of concrete, mechanical signals - a publishable
 * manifest, a publish command, a binary or desktop bundler, a patch or override of an
 * excepted package - not a judgement about intent. A distribution plan that leaves no
 * trace in the repository cannot be detected here, which is why the condition is also
 * written down in docs/license-policy.md.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLISH_COMMAND =
  /\b(?:npm|pnpm|yarn)(?:\s+(?:-r|--recursive|npm))?\s+publish\b|\bchangeset\s+publish\b/;

const SINGLE_EXECUTABLE =
  /--experimental-sea-config\b|\bbun\s+build\b[^\n]*--compile\b|\bdeno\s+compile\b/;

const BINARY_OR_DESKTOP_BUNDLERS = new Set([
  'electron',
  'electron-builder',
  '@electron-forge/cli',
  '@electron-forge/core',
  '@tauri-apps/cli',
  '@tauri-apps/api',
  'pkg',
  '@yao-pkg/pkg',
  'nexe',
  'postject',
  '@neutralinojs/neu',
]);

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

/** `@scope/name@1.2.3`, `name@1.2.3`, `parent>name` or a pnpm patch name -> package name. */
export function packageName(spec) {
  const unquoted = String(spec)
    .trim()
    .replace(/^['"]|['"]$/g, '');
  const last = unquoted.split('>').pop().trim();
  const at = last.indexOf('@', last.startsWith('@') ? 1 : 0);
  return at === -1 ? last : last.slice(0, at);
}

function stripYamlComments(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

/** Keys (or list items) directly under a top-level YAML mapping key. */
function topLevelEntries(yaml, key) {
  const entries = [];
  let inBlock = false;
  for (const line of stripYamlComments(yaml).split('\n')) {
    if (line.trim() === '') continue;
    if (/^\S/.test(line)) {
      inBlock = line.startsWith(`${key}:`);
      continue;
    }
    if (!inBlock) continue;
    const item = line.trim().replace(/^-\s+/, '');
    const mapping = /^(['"]?)(.+?)\1\s*:(\s|$)/.exec(item);
    entries.push(mapping ? mapping[2] : item);
  }
  return entries;
}

function publishabilityDetails(json) {
  if (json.private !== true) return ['package is not marked "private": true, so it is publishable'];
  if (json.publishConfig !== undefined) return ['publishConfig is declared'];
  return [];
}

function scriptDetails(json) {
  return Object.entries(json.scripts ?? {}).flatMap(([name, command]) => {
    if (PUBLISH_COMMAND.test(String(command))) return [`script "${name}" publishes: ${command}`];
    if (SINGLE_EXECUTABLE.test(String(command))) {
      return [`script "${name}" builds a standalone executable: ${command}`];
    }
    return [];
  });
}

function bundlerDetails(json) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(json[field] ?? {})
      .filter((dependency) => BINARY_OR_DESKTOP_BUNDLERS.has(dependency))
      .map((dependency) => `${field} includes the binary or desktop bundler ${dependency}`),
  );
}

function redirectDetails(json, exceptedNames) {
  const redirects = [
    ['overrides', json.overrides],
    ['resolutions', json.resolutions],
    ['pnpm.overrides', json.pnpm?.overrides],
    ['pnpm.patchedDependencies', json.pnpm?.patchedDependencies],
  ];
  return redirects.flatMap(([field, map]) =>
    Object.keys(map ?? {})
      .filter((spec) => exceptedNames.has(packageName(spec)))
      .map((spec) => `${field} targets the excepted component ${spec}`),
  );
}

function manifestFindings({ path, json }, exceptedNames) {
  const distribution = [
    ...publishabilityDetails(json),
    ...scriptDetails(json),
    ...bundlerDetails(json),
  ];
  return [
    ...distribution.map((detail) => ({ condition: 'no-distribution', path, detail })),
    ...redirectDetails(json, exceptedNames).map((detail) => ({
      condition: 'unmodified-dependencies',
      path,
      detail,
    })),
  ];
}

function workflowFindings({ path, text }) {
  const code = stripYamlComments(text);
  if (PUBLISH_COMMAND.test(code)) {
    return [{ condition: 'no-distribution', path, detail: 'a workflow step publishes a package' }];
  }
  if (/^\s*publish\s*:/m.test(code)) {
    return [{ condition: 'no-distribution', path, detail: 'a workflow configures a publish step' }];
  }
  return [];
}

function workspaceFindings(workspaceYaml, exceptedNames) {
  return ['patchedDependencies', 'overrides'].flatMap((block) =>
    topLevelEntries(workspaceYaml, block)
      .filter((spec) => exceptedNames.has(packageName(spec)))
      .map((spec) => ({
        condition: 'unmodified-dependencies',
        path: 'pnpm-workspace.yaml',
        detail: `${block} targets the excepted component ${spec}`,
      })),
  );
}

function patchFindings(patchFiles, pnpmfiles, exceptedNames) {
  const patched = patchFiles
    .filter((file) => {
      const base = file
        .split('/')
        .pop()
        .replace(/\.patch$/, '')
        .replace(/__/g, '/');
      return exceptedNames.has(packageName(base));
    })
    .map((file) => ({
      condition: 'unmodified-dependencies',
      path: file,
      detail: 'a patch file modifies an excepted component',
    }));
  const hooks = pnpmfiles.map((file) => ({
    condition: 'unmodified-dependencies',
    path: file,
    detail: 'a pnpmfile can rewrite any dependency manifest, including excepted ones',
  }));
  return [...patched, ...hooks];
}

/**
 * @param {{
 *   manifests: {path: string, json: Record<string, any>}[],
 *   workflows: {path: string, text: string}[],
 *   workspaceYaml: string,
 *   patchFiles: string[],
 *   pnpmfiles?: string[],
 *   exceptedNames: Set<string>,
 * }} input
 * @returns {{condition: 'no-distribution' | 'unmodified-dependencies', path: string, detail: string}[]}
 */
export function detectApprovalConditionBreaches({
  manifests,
  workflows,
  workspaceYaml,
  patchFiles,
  pnpmfiles = [],
  exceptedNames,
}) {
  return [
    ...manifests.flatMap((manifest) => manifestFindings(manifest, exceptedNames)),
    ...workflows.flatMap(workflowFindings),
    ...workspaceFindings(workspaceYaml, exceptedNames),
    ...patchFindings(patchFiles, pnpmfiles, exceptedNames),
  ];
}

function listFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function workspaceManifests() {
  const manifests = [
    { path: 'package.json', json: JSON.parse(readFileSync('package.json', 'utf8')) },
  ];
  for (const parent of ['apps', 'packages']) {
    if (!existsSync(parent)) continue;
    for (const child of readdirSync(parent)) {
      const path = join(parent, child, 'package.json');
      if (existsSync(path)) manifests.push({ path, json: JSON.parse(readFileSync(path, 'utf8')) });
    }
  }
  return manifests;
}

/** Reads the real repository into the shape detectApprovalConditionBreaches expects. */
export function collectRepositoryInputs(exceptions) {
  const workflowDir = '.github/workflows';
  return {
    manifests: workspaceManifests(),
    workflows: existsSync(workflowDir)
      ? readdirSync(workflowDir)
          .filter((name) => /\.ya?ml$/.test(name))
          .map((name) => ({
            path: join(workflowDir, name),
            text: readFileSync(join(workflowDir, name), 'utf8'),
          }))
      : [],
    workspaceYaml: existsSync('pnpm-workspace.yaml')
      ? readFileSync('pnpm-workspace.yaml', 'utf8')
      : '',
    patchFiles: listFiles('patches'),
    pnpmfiles: ['.pnpmfile.cjs', '.pnpmfile.mjs'].filter((file) => existsSync(file)),
    exceptedNames: new Set(exceptions.map((entry) => packageName(entry.component))),
  };
}
