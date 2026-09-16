import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyProjectSetup } from '../src/project-setup.js';

describe('applyProjectSetup', () => {
  it('writes the file, creates the folder, appends gitignore lines, idempotently', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'setup-'));
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
    const r1 = await applyProjectSetup(root, { designFiles: ['Design'], readFirst: ['README.md'], rules: 'Be kind.' });
    expect(r1.ok).toBe(true);
    expect(existsSync(path.join(root, 'Design'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(root, '.open-design.json'), 'utf8'))).toEqual({
      designFiles: ['Design'], readFirst: ['README.md'], rules: 'Be kind.',
    });
    const gi1 = readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gi1).toContain('node_modules/\n');
    expect(gi1).toContain('.od-skills/\n');
    expect(gi1).toContain('.od-frames/\n');
    await applyProjectSetup(root, { designFiles: ['Design'], readFirst: ['README.md'], rules: 'Be kind.' });
    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe(gi1);
  });
  it('rejects unusable input without touching the folder', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'setup-'));
    const r = await applyProjectSetup(root, { designFiles: ['../x'] });
    expect(r.ok).toBe(false);
    expect(existsSync(path.join(root, '.open-design.json'))).toBe(false);
  });
});
