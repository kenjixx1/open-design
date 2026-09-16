import { describe, expect, it } from 'vitest';

import { physicalStatusAfterStrategyOutcome } from '../../src/strategies/od-next/blocked-run-status.js';

describe('physicalStatusAfterStrategyOutcome', () => {
  it('keeps an agent-declared block as a succeeded run with no error', () => {
    expect(physicalStatusAfterStrategyOutcome(
      'succeeded',
      'blocked',
      ['od_next_agent_declared_block'],
    )).toEqual({ status: 'succeeded', reportBlocked: false });
  });

  it('fails a machine-gated block', () => {
    expect(physicalStatusAfterStrategyOutcome(
      'succeeded',
      'blocked',
      ['od_next_protocol_stage_mismatch'],
    )).toEqual({ status: 'failed', reportBlocked: true });
  });

  it('fails a block that carries no reason codes', () => {
    expect(physicalStatusAfterStrategyOutcome('succeeded', 'blocked', []))
      .toEqual({ status: 'failed', reportBlocked: true });
  });

  it('fails a block mixing the agent-declared code with a machine code', () => {
    expect(physicalStatusAfterStrategyOutcome(
      'succeeded',
      'blocked',
      ['od_next_agent_declared_block', 'od_next_protocol_stage_mismatch'],
    )).toEqual({ status: 'failed', reportBlocked: true });
  });

  it('leaves an already failed run alone whatever the outcome', () => {
    expect(physicalStatusAfterStrategyOutcome(
      'failed',
      'blocked',
      ['od_next_agent_declared_block'],
    )).toEqual({ status: 'failed', reportBlocked: false });
    expect(physicalStatusAfterStrategyOutcome('failed', 'completed', []))
      .toEqual({ status: 'failed', reportBlocked: false });
    expect(physicalStatusAfterStrategyOutcome('failed', 'running', undefined))
      .toEqual({ status: 'failed', reportBlocked: false });
  });

  it('leaves a completed task succeeded', () => {
    expect(physicalStatusAfterStrategyOutcome('succeeded', 'completed', []))
      .toEqual({ status: 'succeeded', reportBlocked: false });
  });
});
