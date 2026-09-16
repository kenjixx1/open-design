// Write a folder-backed project's setup to disk.
//
// When the user points a project at a repo and says which folders hold the
// designs, which files to read first, and any house rules, this is what lands
// on disk. It touches three things and nothing else:
//
//   - `.open-design.json` at the project root (the scope file other code reads)
//   - the design folders (`mkdir -p`, so an empty repo gets somewhere to save)
//   - `.gitignore`, gaining `.od-skills/` and `.od-frames/` when they are absent
//
// It never writes agent instruction files (CLAUDE.md / AGENTS.md / GEMINI.md)
// and never runs git. It is idempotent: a second run with the same input leaves
// the folder byte-identical.
import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_SCOPE_FILE, parseProjectScope, type ProjectScope } from './project-scope.js';

const GITIGNORE_FILE = '.gitignore';
const GITIGNORE_COMMENT = '# Open Design scratch folders';
const GITIGNORE_LINES = ['.od-skills/', '.od-frames/'];

export interface ProjectSetupInput {
  designFiles?: unknown;
  readFirst?: unknown;
  rules?: unknown;
}

export type ProjectSetupResult =
  | { ok: true; scope: ProjectScope; wrote: string[] }
  | { ok: false; error: string };

/** The `.open-design.json` body for a scope, with empty fields left out. */
function scopeFileContents(scope: ProjectScope): string {
  const body: Record<string, unknown> = {};
  if (scope.designFiles.length) body.designFiles = scope.designFiles;
  if (scope.readFirst.length) body.readFirst = scope.readFirst;
  if (scope.rules) body.rules = scope.rules;
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** Append the scratch-folder lines to `.gitignore`; returns true when it changed. */
async function ensureGitignore(rootDir: string): Promise<boolean> {
  const file = path.join(rootDir, GITIGNORE_FILE);
  let current = '';
  try {
    current = await fs.promises.readFile(file, 'utf8');
  } catch {
    current = '';
  }
  const present = new Set(current.split('\n').map((line) => line.trim()));
  const missing = GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) return false;

  let next = current;
  if (next && !next.endsWith('\n')) next += '\n';
  if (next) next += '\n';
  next += `${GITIGNORE_COMMENT}\n${missing.join('\n')}\n`;
  await fs.promises.writeFile(file, next, 'utf8');
  return true;
}

/**
 * Apply a project's setup inside `rootDir`. Validation is the same one that
 * reads the file back (`parseProjectScope`), so nothing lands on disk that the
 * reader would later drop.
 */
export async function applyProjectSetup(
  rootDir: string,
  input: ProjectSetupInput,
): Promise<ProjectSetupResult> {
  const scope = parseProjectScope(
    JSON.stringify({
      designFiles: input.designFiles,
      readFirst: input.readFirst,
      rules: input.rules,
    }),
  );
  if (!scope) return { ok: false, error: 'nothing to set up' };

  const wrote: string[] = [];
  try {
    for (const folder of scope.designFiles) {
      await fs.promises.mkdir(path.join(rootDir, folder), { recursive: true });
      wrote.push(folder);
    }
    await fs.promises.writeFile(
      path.join(rootDir, PROJECT_SCOPE_FILE),
      scopeFileContents(scope),
      'utf8',
    );
    wrote.push(PROJECT_SCOPE_FILE);
    if (await ensureGitignore(rootDir)) wrote.push(GITIGNORE_FILE);
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
  return { ok: true, scope, wrote };
}
