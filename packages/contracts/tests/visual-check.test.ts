import { describe, expect, it } from 'vitest';

import { renderVisualCheckDirective, VISUAL_CHECK_TOOL_SCHEMA } from '../src/index.js';

describe('visual check directive', () => {
  const text = renderVisualCheckDirective();

  it('names the wrapper command with JSON output', () => {
    expect(text).toContain('"$OD_NODE_BIN" "$OD_BIN" tools screenshot --json');
  });

  it('orders errors before improvements and caps re-checks', () => {
    expect(text.indexOf('Errors first')).toBeGreaterThan(-1);
    expect(text.indexOf('Then improvements')).toBeGreaterThan(text.indexOf('Errors first'));
    expect(text).toContain('at most two re-checks');
  });

  it('covers batches, phone width, and silent failure', () => {
    expect(text).toContain('--range');
    expect(text).toContain('--width 390');
    expect(text).toContain('Do not mention the renderer');
  });

  it('limits self-chosen improvements to the fixed list', () => {
    expect(text).toContain('up to 3 improvements of your own');
    expect(text).toContain('one clear focal point per screen');
  });

  it('never contains an absolute path', () => {
    expect(text).not.toMatch(/(^|[\s`"'])\/(Users|home|private|tmp|var)\//);
    expect(text).not.toMatch(/[A-Za-z]:\\/);
  });

  it('exposes the response schema id', () => {
    expect(VISUAL_CHECK_TOOL_SCHEMA).toBe('od.visual-check.v1');
  });
});
