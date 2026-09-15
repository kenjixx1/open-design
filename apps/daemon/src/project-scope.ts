// Optional per-project scope for folder-backed projects.
//
// A repo opened as an Open Design project (metadata.baseDir) usually holds far
// more than designs: app code, docs, a vault. `.open-design.json` at the
// project root lets the repo say which top-level folders are the design
// files, which files an agent should read first, and any project-specific
// rules to fold into prompts:
//
//   {
//     "designFiles": ["PeeraneyERP_Design"],
//     "readFirst": ["CLAUDE.md", "docs/spec.md"],
//     "rules": "Save designs under PeeraneyERP_Design/."
//   }
//
// Absent or invalid → null → callers walk the whole root as before. designFiles
// entries are top-level folder names relative to the root; readFirst entries
// are repo-relative file paths and may contain `/`. Anything absolute, empty,
// or containing `..` is dropped. `readProjectScopeSync`/`readProjectScope` keep
// returning `designFiles` only (or null) for existing callers; the full parsed
// shape (including readFirst and rules) is available via
// `readFullProjectScopeSync`/`readFullProjectScope`.
import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_SCOPE_FILE = '.open-design.json';

const RULES_MAX = 2000;

export interface ProjectScope {
  designFiles: string[];
  readFirst: string[];
  rules: string;
}

function cleanRelativePath(entry: unknown, { singleSegment }: { singleSegment: boolean }): string | null {
  if (typeof entry !== 'string') return null;
  const trimmed = entry.trim().replace(/^\.\//, '').replace(/[\\/]+$/, '');
  if (!trimmed || path.isAbsolute(trimmed)) return null;
  const segs = trimmed.split(/[\\/]/);
  if (segs.some((s) => s === '' || s === '..')) return null;
  if (singleSegment && segs.length !== 1) return null;
  return segs.join('/');
}

export function parseProjectScope(raw: string): ProjectScope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const rec = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!rec) return null;
  const designFiles = [
    ...new Set(
      (Array.isArray(rec.designFiles) ? rec.designFiles : [])
        .map((e) => cleanRelativePath(e, { singleSegment: true }))
        .filter((e): e is string => e !== null),
    ),
  ];
  const readFirst = [
    ...new Set(
      (Array.isArray(rec.readFirst) ? rec.readFirst : [])
        .map((e) => cleanRelativePath(e, { singleSegment: false }))
        .filter((e): e is string => e !== null),
    ),
  ];
  const rules = typeof rec.rules === 'string' ? rec.rules.trim().slice(0, RULES_MAX) : '';
  if (designFiles.length === 0 && readFirst.length === 0 && rules === '') return null;
  return { designFiles, readFirst, rules };
}

/** Full parsed `<rootDir>/.open-design.json`, or null when absent/invalid/empty. */
export function readFullProjectScopeSync(rootDir: string): ProjectScope | null {
  try {
    return parseProjectScope(fs.readFileSync(path.join(rootDir, PROJECT_SCOPE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** Full parsed `<rootDir>/.open-design.json`, or null when absent/invalid/empty. */
export async function readFullProjectScope(rootDir: string): Promise<ProjectScope | null> {
  try {
    return parseProjectScope(await fs.promises.readFile(path.join(rootDir, PROJECT_SCOPE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/** Top-level design folders declared by `<rootDir>/.open-design.json`, or null. */
export function readProjectScopeSync(rootDir: string): string[] | null {
  const scope = readFullProjectScopeSync(rootDir);
  return scope?.designFiles.length ? scope.designFiles : null;
}

export async function readProjectScope(rootDir: string): Promise<string[] | null> {
  const scope = await readFullProjectScope(rootDir);
  return scope?.designFiles.length ? scope.designFiles : null;
}
