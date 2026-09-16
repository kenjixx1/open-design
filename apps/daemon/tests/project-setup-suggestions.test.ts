import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  resetDesktopAuthForTests,
  setDesktopAuthSecret,
  signDesktopImportToken,
  startServer,
} from '../src/server.js';
import {
  suggestProjectSetup,
  type SetupSuggestion,
} from '../src/project-setup-suggestions.js';

/**
 * The setup guesses. When a repo is pointed at Open Design for the first time,
 * nothing about it is configured yet, so the daemon reads the folder and
 * proposes an answer to the three questions the setup card asks: where do the
 * designs live, what should an agent read first, and what are the house rules.
 * Every suggestion is a guess the user can overrule — these tests pin the
 * guesses against a real temp filesystem, never a mocked one.
 */

const tempDirs: string[] = [];

function makeFolder(prefix = 'od-suggest-'): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function find(entries: SetupSuggestion[], p: string): SetupSuggestion | undefined {
  return entries.find((e) => e.path === p);
}

/** A repo shaped like a real one: canvases, a design folder, docs, agent rules. */
async function makeRepoFixture(): Promise<string> {
  const root = makeFolder();
  const claudeMd = [
    '# Peeraney ERP',
    '',
    'ระบบ ERP สำหรับโรงงาน.',
    '',
    'For the requirements see `docs/REQ.md` before anything else.',
    '',
  ].join('\n');
  await mkdir(path.join(root, 'PeeraneyERP_Design'), { recursive: true });
  await writeFile(path.join(root, 'PeeraneyERP_Design', 'A.dc.html'), '<main></main>');
  await mkdir(path.join(root, 'design'), { recursive: true });
  await writeFile(path.join(root, 'CLAUDE.md'), claudeMd);
  await writeFile(path.join(root, 'AGENTS.md'), claudeMd);
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'REQ.md'), '# Requirements\n');
  await writeFile(path.join(root, 'README.md'), '# Read me\n');
  return root;
}

describe('suggestProjectSetup', () => {
  afterEach(cleanupTempDirs);

  it('guesses the design folder, the read-first files, and Thai rules for a real repo', async () => {
    const root = await makeRepoFixture();

    const suggestions = await suggestProjectSetup(root);

    expect(suggestions.alreadyConfigured).toBe(false);
    expect(suggestions.existing).toBeNull();

    // The folder that already holds a canvas wins, and is the recommendation.
    expect(suggestions.designFolders[0]).toEqual({
      path: 'PeeraneyERP_Design',
      reason: 'already holds 1 canvas',
    });
    expect(find(suggestions.designFolders, 'design')).toEqual({
      path: 'design',
      reason: 'empty folder',
    });

    // CLAUDE.md is the project rules and is ticked by default.
    expect(find(suggestions.readFirst, 'CLAUDE.md')).toEqual({
      path: 'CLAUDE.md',
      reason: 'project rules',
      checked: true,
    });
    // AGENTS.md is byte-identical, so reading it twice buys nothing.
    expect(find(suggestions.readFirst, 'AGENTS.md')).toEqual({
      path: 'AGENTS.md',
      reason: 'same content as CLAUDE.md',
      checked: false,
    });
    // A path CLAUDE.md points at is worth reading too.
    expect(find(suggestions.readFirst, 'docs/REQ.md')).toEqual({
      path: 'docs/REQ.md',
      reason: 'linked from CLAUDE.md',
      checked: true,
    });
    expect(find(suggestions.readFirst, 'docs')?.reason).toBe('documentation folder');
    expect(find(suggestions.readFirst, 'README.md')?.reason).toBe('');
    expect(find(suggestions.readFirst, 'GEMINI.md')).toBeUndefined();

    expect(suggestions.rulesDraft.startsWith('Save every design in PeeraneyERP_Design')).toBe(true);
    expect(suggestions.rulesDraft).toContain('Thai UI');
  });

  it('never returns an absolute path, and caps the two lists', async () => {
    const root = await makeRepoFixture();
    const suggestions = await suggestProjectSetup(root);
    const all = [...suggestions.designFolders, ...suggestions.readFirst];
    expect(all.length).toBeGreaterThan(0);
    for (const entry of all) {
      expect(path.isAbsolute(entry.path)).toBe(false);
      expect(entry.path.includes(root)).toBe(false);
    }
    expect(suggestions.designFolders.length).toBeLessThanOrEqual(5);
    expect(suggestions.readFirst.length).toBeLessThanOrEqual(8);
  });

  it('proposes creating Design for an empty folder, with no Thai in the rules', async () => {
    const root = makeFolder();

    const suggestions = await suggestProjectSetup(root);

    expect(suggestions.designFolders).toEqual([{ path: 'Design', reason: 'will be created' }]);
    expect(suggestions.readFirst).toEqual([]);
    expect(suggestions.rulesDraft).not.toContain('Thai');
    expect(suggestions.rulesDraft.startsWith('Save every design in Design')).toBe(true);
  });

  it('reports a repo that is already configured, with the scope it already has', async () => {
    const root = makeFolder();
    await writeFile(
      path.join(root, '.open-design.json'),
      JSON.stringify({
        designFiles: ['Mockups'],
        readFirst: ['CLAUDE.md'],
        rules: 'Save designs under Mockups/.',
      }),
    );

    const suggestions = await suggestProjectSetup(root);

    expect(suggestions.alreadyConfigured).toBe(true);
    expect(suggestions.existing).toEqual({
      designFiles: ['Mockups'],
      readFirst: ['CLAUDE.md'],
      rules: 'Save designs under Mockups/.',
    });
  });

  it('ranks folders by how many canvases they already hold and skips ignored trees', async () => {
    const root = makeFolder();
    await mkdir(path.join(root, 'Sketches', 'flows'), { recursive: true });
    await writeFile(path.join(root, 'Sketches', 'One.dc.html'), '');
    await writeFile(path.join(root, 'Sketches', 'flows', 'Two.dc.html'), '');
    await mkdir(path.join(root, 'Old'), { recursive: true });
    await writeFile(path.join(root, 'Old', 'Solo.dc.html'), '');
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'pkg', 'Bad.dc.html'), '');
    await mkdir(path.join(root, '.hidden'), { recursive: true });
    await writeFile(path.join(root, '.hidden', 'Bad.dc.html'), '');

    const suggestions = await suggestProjectSetup(root);

    expect(suggestions.designFolders.map((e) => e.path)).toEqual(['Sketches', 'Old']);
    expect(suggestions.designFolders[0]?.reason).toBe('already holds 2 canvases');
    expect(suggestions.designFolders[1]?.reason).toBe('already holds 1 canvas');
  });

  it('falls back to AGENTS.md for the links when there is no CLAUDE.md', async () => {
    const root = makeFolder();
    await mkdir(path.join(root, 'spec'), { recursive: true });
    await writeFile(path.join(root, 'spec', 'api.md'), '# API\n');
    await writeFile(path.join(root, 'AGENTS.md'), 'Read [the api](spec/api.md) first.\n');

    const suggestions = await suggestProjectSetup(root);

    expect(find(suggestions.readFirst, 'AGENTS.md')).toEqual({
      path: 'AGENTS.md',
      reason: 'project rules',
      checked: true,
    });
    expect(find(suggestions.readFirst, 'spec/api.md')).toEqual({
      path: 'spec/api.md',
      reason: 'linked from AGENTS.md',
      checked: true,
    });
  });

  it('ignores linked paths that escape the root or do not exist', async () => {
    const root = makeFolder();
    await writeFile(
      path.join(root, 'CLAUDE.md'),
      [
        'See `../secrets.md` and `/etc/passwd` and `missing.md`.',
        'Also [the site](https://example.com/page.md).',
      ].join('\n'),
    );

    const suggestions = await suggestProjectSetup(root);

    expect(suggestions.readFirst.map((e) => e.path)).toEqual(['CLAUDE.md']);
  });
});

describe('POST /api/projects/setup-suggestions', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  beforeEach(() => {
    resetDesktopAuthForTests();
  });

  afterEach(() => {
    resetDesktopAuthForTests();
    cleanupTempDirs();
  });

  afterAll(() => {
    resetDesktopAuthForTests();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function ask(body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/api/projects/setup-suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('answers with the guesses for a real folder', async () => {
    const root = await makeRepoFixture();
    const resp = await ask({ baseDir: root });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      designFolders: SetupSuggestion[];
      readFirst: SetupSuggestion[];
      rulesDraft: string;
      alreadyConfigured: boolean;
    };
    expect(body.alreadyConfigured).toBe(false);
    expect(body.designFolders[0]?.path).toBe('PeeraneyERP_Design');
    expect(body.rulesDraft).toContain('PeeraneyERP_Design');
  });

  it('rejects a missing or non-string baseDir', async () => {
    const resp = await ask({});
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect((await ask({ baseDir: 42 })).status).toBe(400);
  });

  it('rejects a system directory', async () => {
    const resp = await ask({ baseDir: process.platform === 'win32' ? 'C:\\Windows' : '/etc' });
    expect(resp.status).toBe(400);
  });

  it('rejects a folder that does not exist', async () => {
    const root = makeFolder();
    const resp = await ask({ baseDir: path.join(root, 'nope') });
    expect(resp.status).toBe(400);
  });

  it('requires a desktop import token when the gate is active, and does not spend it', async () => {
    const root = await makeRepoFixture();
    const secret = randomBytes(32);
    setDesktopAuthSecret(secret);

    expect((await ask({ baseDir: root })).status).toBe(403);

    const exp = new Date(Date.now() + 60_000).toISOString();
    const token = signDesktopImportToken(secret, root, { nonce: 'n-suggest', exp });
    const first = await ask({ baseDir: root }, { 'x-od-desktop-import-token': token });
    expect(first.status).toBe(200);
    // The nonce is NOT consumed: the same token still has to work for the
    // working-dir call the user makes right after accepting the suggestions.
    const second = await ask({ baseDir: root }, { 'x-od-desktop-import-token': token });
    expect(second.status).toBe(200);
  });
});
