import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderProjectRulesBlock, projectRulesForPrompt } from '../src/project-rules-prompt.js';

function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'rules-'));
  writeFileSync(path.join(root, 'CLAUDE.md'), '# rules');
  mkdirSync(path.join(root, 'docs'));
  return root;
}

describe('renderProjectRulesBlock', () => {
  it('lists only files that exist and appends the rules', () => {
    const root = repo();
    const block = renderProjectRulesBlock(
      { designFiles: ['Design'], readFirst: ['CLAUDE.md', 'docs/missing.md'], rules: 'Never edit app code.' },
      root,
    );
    expect(block).toBe(
      '## Project rules (from .open-design.json)\n\n' +
      'Read these files before designing anything:\n- CLAUDE.md\n\n' +
      'Never edit app code.',
    );
    expect(block).not.toContain(root);
  });
  it('returns empty when there is nothing to say', () => {
    expect(renderProjectRulesBlock({ designFiles: ['Design'], readFirst: [], rules: '' }, repo())).toBe('');
  });
});

describe('projectRulesForPrompt', () => {
  it('is empty without a baseDir or without the file', async () => {
    expect(await projectRulesForPrompt(null)).toBe('');
    expect(await projectRulesForPrompt(repo())).toBe('');
  });
  it('reads the file fresh from the repo root', async () => {
    const root = repo();
    writeFileSync(path.join(root, '.open-design.json'), JSON.stringify({ rules: 'Thai UI.' }));
    expect(await projectRulesForPrompt(root)).toContain('Thai UI.');
  });
});
