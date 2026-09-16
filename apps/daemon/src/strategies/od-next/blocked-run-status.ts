import { OD_NEXT_AGENT_DECLARED_BLOCK_REASON } from '@open-design/contracts';

import type { StrategyTaskOutcome } from '../task-store.js';

/** The terminal status a physical run can finish with. */
export type PhysicalRunStatus = 'succeeded' | 'failed' | 'canceled';

export interface PhysicalStatusAfterStrategyOutcome {
  /** The status the run should actually finish with. */
  status: PhysicalRunStatus;
  /** Whether the caller should publish the `OD_NEXT_TASK_BLOCKED` error. */
  reportBlocked: boolean;
}

/**
 * Reconcile a physical run's exit status with the strategy task's own outcome.
 *
 * A clean child exit does not complete a task the strategy gate rejected, so a
 * `blocked` task normally turns a `succeeded` run into a failed one and raises
 * `OD_NEXT_TASK_BLOCKED`.
 *
 * The one exception is the agent declaring the block itself with no machine
 * code of its own — reason codes exactly `[od_next_agent_declared_block]`. That
 * is an agent that deliberately answered without a deliverable (a question, an
 * explanation): a completed chat turn, not a crash, and showing it as "Run
 * failed" over a finished answer is simply wrong. The task record keeps its
 * `blocked` outcome for the strategy's own bookkeeping; only the run's user
 * facing status changes.
 *
 * Every other blocked case — a protocol mismatch, an invalid deliverable, no
 * reason codes at all, or the agent-declared code mixed with a machine code —
 * keeps the failed behaviour.
 */
export function physicalStatusAfterStrategyOutcome(
  status: PhysicalRunStatus,
  outcome: StrategyTaskOutcome | null | undefined,
  reasonCodes: readonly string[] | null | undefined,
): PhysicalStatusAfterStrategyOutcome {
  if (status !== 'succeeded' || outcome !== 'blocked') {
    return { status, reportBlocked: false };
  }
  const codes = reasonCodes ?? [];
  if (codes.length === 1 && codes[0] === OD_NEXT_AGENT_DECLARED_BLOCK_REASON) {
    return { status: 'succeeded', reportBlocked: false };
  }
  return { status: 'failed', reportBlocked: true };
}
