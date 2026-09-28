import fs from 'node:fs/promises';
import path from 'node:path';

export const VISUAL_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Root for screenshots. Always derived from the resolved daemon data root. */
export function visualCheckRoot(runtimeDataDir: string): string {
  return path.join(runtimeDataDir, 'visual-checks');
}

function segment(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 80);
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
}

/** `<root>/<project>/<run>/<seq>-<file base name>/`, created on disk. */
export async function createCheckDir(
  root: string,
  projectId: string,
  runId: string,
  seq: number,
  fileName: string,
): Promise<string> {
  const base = path.posix.basename(fileName.replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
  const dir = path.join(root, segment(projectId), segment(runId), `${seq}-${segment(base)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Deletes run folders whose modification time is older than `maxAgeMs`. Returns how many. */
export async function pruneVisualChecks(
  root: string,
  now: number = Date.now(),
  maxAgeMs: number = VISUAL_CHECK_MAX_AGE_MS,
): Promise<number> {
  let removed = 0;
  let projects: string[];
  try {
    projects = await fs.readdir(root);
  } catch {
    return 0;
  }
  for (const project of projects) {
    const projectDir = path.join(root, project);
    let runs: string[];
    try {
      runs = await fs.readdir(projectDir);
    } catch {
      continue;
    }
    for (const run of runs) {
      const runDir = path.join(projectDir, run);
      try {
        const st = await fs.stat(runDir);
        if (now - st.mtimeMs > maxAgeMs) {
          await fs.rm(runDir, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        // raced with another prune; ignore
      }
    }
  }
  return removed;
}
