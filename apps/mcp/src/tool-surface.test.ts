import { describe, expect, it } from 'vitest';
import {
  EXPOSED_TOOLS,
  FORBIDDEN_TOOL_PATTERNS,
  isExposed,
  PROPOSAL_TOOLS,
  READ_TOOLS,
  requiredScope,
} from './tool-surface.js';

describe('MCP tool surface', () => {
  it('exposes exactly the reviewed read tools', () => {
    expect([...READ_TOOLS]).toEqual([
      'workout.capabilities',
      'workout.active_plan_revision',
      'workout.scheduled_sessions',
      'workout.completed_session_summaries',
      'workout.exercise_definitions',
      'workout.proposal_status',
    ]);
  });

  it('exposes exactly the reviewed proposal tools', () => {
    expect([...PROPOSAL_TOOLS]).toEqual([
      'proposal.replace_plan',
      'proposal.change_scheduled_session',
      'proposal.change_exercise_prescription',
      'proposal.correct_completed_session',
    ]);
  });

  it('every write-shaped tool is a proposal, never a direct mutation', () => {
    for (const tool of PROPOSAL_TOOLS) {
      expect(tool.startsWith('proposal.')).toBe(true);
    }
  });

  it('exposes no SQL, query, patch, delete, deploy, credential, token, or admin tool', () => {
    for (const tool of EXPOSED_TOOLS) {
      for (const pattern of FORBIDDEN_TOOL_PATTERNS) {
        expect(tool, `tool "${tool}" matches forbidden pattern ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('rejects a tool name that is not on the list', () => {
    expect(isExposed('workout.run_sql')).toBe(false);
    expect(isExposed('proposal.replace_plan')).toBe(true);
  });

  it('maps reads to workout:read and proposals to proposal:create', () => {
    expect(requiredScope('workout.scheduled_sessions')).toBe('workout:read');
    expect(requiredScope('proposal.replace_plan')).toBe('proposal:create');
  });
});
