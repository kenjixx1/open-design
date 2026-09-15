import { describe, it, expect } from 'vitest';
import { parseProjectScope, readFullProjectScope } from '../src/project-scope.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('parseProjectScope', () => {
  it('reads all three fields and cleans paths', () => {
    const s = parseProjectScope(JSON.stringify({
      designFiles: ['./PeeraneyERP_Design/', 'design'],
      readFirst: ['CLAUDE.md', './docs/spec.md'],
      rules: '  Save designs here.  ',
    }));
    expect(s).toEqual({
      designFiles: ['PeeraneyERP_Design', 'design'],
      readFirst: ['CLAUDE.md', 'docs/spec.md'],
      rules: 'Save designs here.',
    });
  });
  it('drops unsafe entries and nested design folders', () => {
    const s = parseProjectScope(JSON.stringify({
      designFiles: ['../x', '/abs', 'a/b', 'ok'],
      readFirst: ['../secret', '/etc/passwd', 'docs//x.md', 'fine.md'],
    }));
    expect(s?.designFiles).toEqual(['ok']);
    expect(s?.readFirst).toEqual(['fine.md']);
  });
  it('truncates rules to 2000 chars', () => {
    const s = parseProjectScope(JSON.stringify({ rules: 'x'.repeat(2500) }));
    expect(s?.rules.length).toBe(2000);
  });
  it('returns null for invalid JSON or an empty object', () => {
    expect(parseProjectScope('{')).toBeNull();
    expect(parseProjectScope('{}')).toBeNull();
    expect(parseProjectScope(JSON.stringify({ designFiles: [] }))).toBeNull();
  });
});

describe('readFullProjectScope', () => {
  it('reads the file from a root and returns null when absent', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'scope-'));
    expect(await readFullProjectScope(root)).toBeNull();
    writeFileSync(path.join(root, '.open-design.json'), JSON.stringify({ rules: 'r' }));
    expect(await readFullProjectScope(root)).toEqual({ designFiles: [], readFirst: [], rules: 'r' });
  });
});
