/**
 * The MCP tool surface (R-021, SECURITY.md).
 *
 * This file is the allowlist for what an external agent can do. It is declarative
 * on purpose: the set of exposed tools is reviewable at a glance, and a test
 * asserts that the forbidden tools are absent.
 */

export const READ_TOOLS = [
  'workout.capabilities',
  'workout.active_plan_revision',
  'workout.scheduled_sessions',
  'workout.completed_session_summaries',
  'workout.exercise_definitions',
  'workout.proposal_status',
] as const;

export const PROPOSAL_TOOLS = [
  'proposal.replace_plan',
  'proposal.change_scheduled_session',
  'proposal.change_exercise_prescription',
  'proposal.correct_completed_session',
] as const;

export type ReadTool = (typeof READ_TOOLS)[number];
export type ProposalTool = (typeof PROPOSAL_TOOLS)[number];
export type ToolName = ReadTool | ProposalTool;

export const EXPOSED_TOOLS: readonly ToolName[] = [...READ_TOOLS, ...PROPOSAL_TOOLS];

/**
 * Explicitly NOT exposed, ever (R-021). Named here so the prohibition is testable
 * rather than merely absent, and so a future contributor sees the intent.
 */
export const FORBIDDEN_TOOL_PATTERNS = [
  /sql/i,
  /query/i,
  /\bpatch\b/i,
  /delete/i,
  /deploy/i,
  /credential/i,
  /token/i,
  /admin/i,
] as const;

export const SCOPES = ['workout:read', 'proposal:create'] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * Scope required per tool. Read and propose are granted together initially
 * (D-020), and still enforced separately server-side (SECURITY.md).
 */
export function requiredScope(tool: ToolName): Scope {
  return (READ_TOOLS as readonly string[]).includes(tool) ? 'workout:read' : 'proposal:create';
}

export function isExposed(tool: string): tool is ToolName {
  return (EXPOSED_TOOLS as readonly string[]).includes(tool);
}
