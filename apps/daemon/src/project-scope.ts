// Optional per-project scope for folder-backed projects.
//
// A repo opened as an Open Design project (metadata.baseDir) usually holds far
// more than designs: app code, docs, a vault. `.open-design.json` at the
// project root lets the repo say which top-level folders are the design
// files, so Design Files, the run artifact diff, and produced-file cards stay
// on those folders instead of walking the whole checkout:
//
//   { "designFiles": ["PeeraneyERP_Design"] }
//
// Absent or invalid → null → callers walk the whole root as before. Entries
// are top-level folder names relative to the root; anything absolute, empty,
// or containing `..` is dropped.
import fs from 'node:fs';
import path from 'node:path';

export const PROJECT_SCOPE_FILE = '.open-design.json';

function parseScope(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const list = (parsed as { designFiles?: unknown } | null)?.designFiles;
  if (!Array.isArray(list)) return null;
  const roots = new Set<string>();
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim().replace(/^\.\//, '').replace(/[\\/]+$/, '');
    if (!trimmed || path.isAbsolute(trimmed)) continue;
    if (trimmed.split(/[\\/]/).some((seg) => seg === '..' || seg === '')) continue;
    roots.add(trimmed);
  }
  return roots.size > 0 ? [...roots] : null;
}

/** Top-level design folders declared by `<rootDir>/.open-design.json`, or null. */
export function readProjectScopeSync(rootDir: string): string[] | null {
  try {
    return parseScope(fs.readFileSync(path.join(rootDir, PROJECT_SCOPE_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export async function readProjectScope(rootDir: string): Promise<string[] | null> {
  try {
    return parseScope(await fs.promises.readFile(path.join(rootDir, PROJECT_SCOPE_FILE), 'utf8'));
  } catch {
    return null;
  }
}
