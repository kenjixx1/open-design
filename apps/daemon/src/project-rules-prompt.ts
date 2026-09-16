// Turns a repo's `.open-design.json` into the "Project rules" block that the
// daemon appends to `projectInstructions` for every run. This is the one
// channel that reaches every agent runtime the same way (Codex, Claude,
// DeepSeek, BYOK…), unlike CLAUDE.md / AGENTS.md which only some CLIs read.
// Paths stay repo-relative so no absolute path enters any prompt bundle.
import fs from 'node:fs';
import path from 'node:path';
import { readFullProjectScope, type ProjectScope } from './project-scope.js';

export const PROJECT_RULES_HEADING = '## Project rules (from .open-design.json)';

export function renderProjectRulesBlock(scope: ProjectScope, rootDir: string): string {
  const present = scope.readFirst.filter((rel) => {
    try { const st = fs.statSync(path.join(rootDir, rel)); return st.isFile() || st.isDirectory(); } catch { return false; }
  });
  const parts: string[] = [];
  if (present.length > 0) {
    parts.push('Read these files before designing anything:\n' + present.map((p) => `- ${p}`).join('\n'));
  }
  // Without this the agent writes its runnable entry to the repo root, where a
  // scoped project never lists it — the run then fails as `entry_missing`.
  const placement = scope.designFiles.length > 0
    ? `Put every file you create, including the runnable entry (index.html), inside ${scope.designFiles[0]}/. `
      + 'Never write to the repo root.'
    : '';
  const placementAfterReadFirst = placement !== '' && parts.length > 0;
  if (placementAfterReadFirst) parts.push(placement);
  if (scope.rules) parts.push(scope.rules);
  if (placement !== '' && !placementAfterReadFirst) parts.push(placement);
  if (parts.length === 0) return '';
  return `${PROJECT_RULES_HEADING}\n\n${parts.join('\n\n')}`;
}

export async function projectRulesForPrompt(baseDir: string | null | undefined): Promise<string> {
  if (typeof baseDir !== 'string' || !baseDir.trim()) return '';
  const scope = await readFullProjectScope(baseDir);
  if (!scope) return '';
  return renderProjectRulesBlock(scope, baseDir);
}
