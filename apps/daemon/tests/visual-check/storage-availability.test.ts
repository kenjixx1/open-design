import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { projectPreviewBaseHref } from '../../src/preview-base-href.js';
import { createVisualCheckAvailability } from '../../src/visual-check/availability.js';
import { createCheckDir, pruneVisualChecks, visualCheckRoot } from '../../src/visual-check/storage.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});
async function dataDir() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'od-vc-data-'));
  roots.push(d);
  return d;
}

describe('visual-check storage', () => {
  it('lays folders out under the data root', async () => {
    const data = await dataDir();
    const root = visualCheckRoot(data);
    expect(root).toBe(path.join(data, 'visual-checks'));
    const dir = await createCheckDir(root, 'proj-1', 'run-1', 2, 'design/index.html');
    expect(dir).toBe(path.join(root, 'proj-1', 'run-1', '2-index'));
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
  });

  it('never lets a segment escape the root', async () => {
    const root = visualCheckRoot(await dataDir());
    const dir = await createCheckDir(root, '../../etc', '..', 1, '../../x.html');
    expect(path.relative(root, dir).startsWith('..')).toBe(false);
    expect(dir.includes(`${path.sep}..${path.sep}`)).toBe(false);
  });

  it('prunes run folders older than 24 hours', async () => {
    const root = visualCheckRoot(await dataDir());
    const oldDir = await createCheckDir(root, 'p', 'old-run', 1, 'a.html');
    const newDir = await createCheckDir(root, 'p', 'new-run', 1, 'a.html');
    const now = Date.now();
    const old = new Date(now - 25 * 3_600_000);
    await fs.utimes(path.dirname(oldDir), old, old);
    const removed = await pruneVisualChecks(root, now);
    expect(removed).toBe(1);
    await expect(fs.stat(path.dirname(oldDir))).rejects.toThrow();
    expect((await fs.stat(newDir)).isDirectory()).toBe(true);
  });

  it('prune tolerates a missing root', async () => {
    expect(await pruneVisualChecks(path.join(await dataDir(), 'nope'))).toBe(0);
  });
});

describe('visual-check availability', () => {
  it('is false without a probe', async () => {
    expect(await createVisualCheckAvailability(null)()).toBe(false);
  });

  it('caches the probe for the TTL and treats a throw as false', async () => {
    let t = 0;
    const probe = vi.fn(async () => true);
    const available = createVisualCheckAvailability(probe, { ttlMs: 10_000, now: () => t });
    expect(await available()).toBe(true);
    t = 5_000;
    expect(await available()).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    t = 10_001;
    probe.mockRejectedValueOnce(new Error('ipc down'));
    expect(await available()).toBe(false);
  });
});

describe('projectPreviewBaseHref', () => {
  it('points at the scoped preview route and keeps the file folder', () => {
    expect(projectPreviewBaseHref('http://127.0.0.1:7456/', 'p 1', 'design/pages/index.html', 'sc')).toBe(
      'http://127.0.0.1:7456/api/projects/p%201/preview/sc/design/pages/',
    );
    expect(projectPreviewBaseHref('http://127.0.0.1:7456', 'p', 'index.html', 'sc')).toBe(
      'http://127.0.0.1:7456/api/projects/p/preview/sc/',
    );
  });
});
