#!/usr/bin/env node
/**
 * Remote MCP entry point - SKELETON.
 *
 * Separate from apps/web on purpose (D-029, ADR-0001): the MCP server is
 * independently deployable and has its own access boundary.
 *
 * It does not start. Serving requires an OAuth authorization server, an HTTPS
 * origin, and a provisioned database - gates G-1, G-2, G-3 and G-4 in
 * docs/external-gates.md. Starting a server that answered nothing, or answered
 * without authorization, would be worse than not starting.
 */
import { EXPOSED_TOOLS } from './tool-surface.js';

const GATE_MESSAGE = [
  '@workout/mcp is a skeleton and does not serve yet.',
  '',
  `Declared tool surface (${EXPOSED_TOOLS.length} tools):`,
  ...EXPOSED_TOOLS.map((tool) => `  - ${tool}`),
  '',
  'Blocked on external gates: G-1 (GitHub), G-2 (Supabase), G-3 (domain/RP ID), G-4 (hosting).',
  'See docs/external-gates.md.',
].join('\n');

process.stderr.write(`${GATE_MESSAGE}\n`);
process.exit(1);
