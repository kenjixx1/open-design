import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DesktopRenderSlidesInput, DesktopRenderSlidesResult } from '@open-design/sidecar-proto';
import type { Express, Request, RequestHandler, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideDeck, registerVisualCheckToolRoutes } from '../../src/routes/visual-check-tool.js';
import { CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS } from '../../src/tool-tokens.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

const PAGE_FACTS = {
  boxes: [], brokenImages: [{ selector: 'img.logo', src: 'logo.png' }], consoleErrors: [], images: [], media: [], targets: [],
  document: { paintedElements: 3, scrollHeight: 3000, scrollWidth: 1440, visibleTextChars: 100 },
  viewport: { height: 1000, width: 1440 },
};

async function fixture(opts: {
  files?: Record<string, string>;
  kind?: string;
  entryFile?: string;
  available?: boolean;
  render?: (input: DesktopRenderSlidesInput) => Promise<DesktopRenderSlidesResult>;
} = {}) {
  const projectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'od-vc-projects-'));
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'od-vc-root-'));
  roots.push(projectsRoot, dataRoot);
  const projectId = 'project-1';
  const files = opts.files ?? { 'index.html': '<html><body><h1>Hi</h1></body></html>' };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(projectsRoot, projectId, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
  }
  const minted: string[] = [];
  const revoked: string[] = [];
  const inputs: DesktopRenderSlidesInput[] = [];
  let available = opts.available ?? true;
  const defaultRender = async (input: DesktopRenderSlidesInput): Promise<DesktopRenderSlidesResult> => {
    inputs.push(input);
    const files = [0, 1, 2].map((i) => path.join(input.outputDir!, `screen-${i + 1}.png`));
    for (const f of files) await fs.writeFile(f, 'png');
    return { ok: true, mode: 'page', slideFiles: files, indices: [0, 1, 2], total: 3, visualFacts: PAGE_FACTS };
  };
  let handler: RequestHandler | undefined;
  const app = { post(route: string, h: RequestHandler) { expect(route).toBe('/api/tools/visual-check'); handler = h; } } as unknown as Express;
  registerVisualCheckToolRoutes(app, {
    projectsRoot,
    visualChecksRoot: dataRoot,
    daemonUrl: () => 'http://127.0.0.1:7456',
    authorizeToolRequest: (_req, _res, op) => (op === 'visual-check:run' ? { runId: 'run-1', projectId } : null),
    authorizeProjectToolRequest: async () => ({ workspace: null }),
    getProject: () => ({ metadata: { kind: opts.kind ?? 'prototype', entryFile: opts.entryFile ?? 'index.html' } }),
    isAvailable: async () => available,
    renderSlides: async (input) => {
      if (opts.render) {
        inputs.push(input);
        return opts.render(input);
      }
      return defaultRender(input);
    },
    mintPreviewScope: () => { const s = `scope-${minted.length}`; minted.push(s); return s; },
    revokePreviewScope: (s) => { revoked.push(s); },
  });
  const call = async (body: Record<string, unknown> = {}) => {
    let status = 200;
    let json: any;
    const res = {
      req: {},
      status(code: number) { status = code; return this; },
      json(v: any) { json = v; return this; },
    } as unknown as Response;
    await handler!({ body } as Request, res, () => {});
    return { status, body: json };
  };
  return { call, inputs, minted, revoked, dataRoot, setAvailable: (v: boolean) => { available = v; } };
}

describe('tool token lists', () => {
  it('grants the visual-check endpoint and operation to chat runs', () => {
    expect(CHAT_TOOL_ENDPOINTS).toContain('/api/tools/visual-check');
    expect(CHAT_TOOL_OPERATIONS).toContain('visual-check:run');
  });
});

describe('decideDeck', () => {
  it('uses the host deck markers, the project kind, or an explicit override', () => {
    expect(decideDeck({ html: '<html data-od-deck-protocol="1">', projectKind: 'prototype', override: undefined })).toBe(true);
    expect(decideDeck({ html: '<div id="deck-stage">', projectKind: 'prototype', override: undefined })).toBe(true);
    expect(decideDeck({ html: '<section class="slide">carousel</section>', projectKind: 'prototype', override: undefined })).toBe(false);
    expect(decideDeck({ html: '<p>x</p>', projectKind: 'deck', override: undefined })).toBe(true);
    expect(decideDeck({ html: '<html data-od-deck-protocol="1">', projectKind: 'deck', override: false })).toBe(false);
  });
});

describe('visual-check route', () => {
  it('checks the run deliverable by default and returns images, issues, and budget', async () => {
    const t = await fixture();
    const { status, body } = await t.call();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, schema: 'od.visual-check.v1', file: 'index.html', mode: 'page', width: 1440, checklist: 'measured', looksLeft: 2 });
    expect(body.images.map((i: any) => [i.kind, i.n])).toEqual([['screen', 1], ['screen', 2], ['screen', 3]]);
    expect(body.issues.map((i: any) => i.kind)).toEqual(['broken-image']);
    expect(body.more).toEqual({ total: 3, captured: '1-3', next: null });
    expect(t.inputs[0]).toMatchObject({ inspect: true, deck: false, width: 1440 });
    expect(t.inputs[0]!.baseHref).toBe('http://127.0.0.1:7456/api/projects/project-1/preview/scope-0/');
    expect(t.inputs[0]!.outputDir!.startsWith(t.dataRoot)).toBe(true);
    expect(t.revoked).toEqual(['scope-0']);
  });

  it('refuses the fourth look at the same page and width', async () => {
    const t = await fixture();
    for (let i = 0; i < 3; i++) expect((await t.call()).body.ok).toBe(true);
    const fourth = await t.call();
    expect(fourth.body).toMatchObject({ ok: false, code: 'LOOK_BUDGET_SPENT' });
    expect(t.inputs).toHaveLength(3);
  });

  it('gives a phone-width check its own budget', async () => {
    const t = await fixture();
    for (let i = 0; i < 3; i++) await t.call();
    expect((await t.call({ width: 390 })).body.ok).toBe(true);
  });

  it('answers RENDERER_UNAVAILABLE without rendering when no desktop is attached', async () => {
    const t = await fixture({ available: false });
    expect((await t.call()).body).toMatchObject({ ok: false, code: 'RENDERER_UNAVAILABLE' });
    expect(t.inputs).toHaveLength(0);
  });

  it('does not spend look budget while the renderer is unavailable', async () => {
    const t = await fixture({ available: false });
    expect((await t.call()).body).toMatchObject({ ok: false, code: 'RENDERER_UNAVAILABLE' });
    t.setAvailable(true);
    const results = [(await t.call()).body, (await t.call()).body, (await t.call()).body];
    expect(results.every((b) => b.ok)).toBe(true);
    expect(results.map((b) => b.looksLeft)).toEqual([2, 1, 0]);
  });

  it('rejects non-HTML, missing, and escaping files', async () => {
    const t = await fixture({ files: { 'index.html': '<p>x</p>', 'notes.md': '# x' } });
    expect((await t.call({ file: 'notes.md' })).body).toMatchObject({ ok: false, code: 'NOT_HTML' });
    expect((await t.call({ file: 'missing.html' })).body).toMatchObject({ ok: false, code: 'FILE_NOT_FOUND' });
    expect((await t.call({ file: '../../etc/passwd.html' })).body).toMatchObject({ ok: false, code: 'FILE_NOT_FOUND' });
  });

  it('rejects bad input', async () => {
    const t = await fixture();
    expect((await t.call({ width: 50 })).body).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect((await t.call({ range: { start: -1, count: 2 } })).body).toMatchObject({ ok: false, code: 'BAD_INPUT' });
  });

  it('reports the next deck batch', async () => {
    const t = await fixture({
      files: { 'deck.html': '<html data-od-deck-protocol="1"><body></body></html>' },
      entryFile: 'deck.html',
      render: async (input) => {
        const files = Array.from({ length: 12 }, (_, i) => path.join(input.outputDir!, `slide-${i + 1}.png`));
        for (const f of files) await fs.writeFile(f, 'png');
        return { ok: true, mode: 'deck', slideFiles: files, indices: files.map((_, i) => i), total: 40 };
      },
    });
    const { body } = await t.call();
    expect(body).toMatchObject({ ok: true, mode: 'deck', checklist: 'unavailable', more: { total: 40, captured: '1-12', next: '13-24' } });
    expect(body.images[0]).toMatchObject({ kind: 'slide', n: 1 });
    expect(t.inputs[0]).toMatchObject({ deck: true });
    expect(t.inputs[0]!.width).toBeUndefined();
  });

  it('reports the deck render width instead of the fixed default', async () => {
    const t = await fixture({
      files: { 'deck.html': '<html data-od-deck-protocol="1"><body></body></html>' },
      entryFile: 'deck.html',
      render: async (input) => {
        const files = Array.from({ length: 12 }, (_, i) => path.join(input.outputDir!, `slide-${i + 1}.png`));
        for (const f of files) await fs.writeFile(f, 'png');
        return { ok: true, mode: 'deck', slideFiles: files, indices: files.map((_, i) => i), total: 12, width: 1920 };
      },
    });
    const { body } = await t.call();
    expect(body).toMatchObject({ ok: true, mode: 'deck', width: 1920 });
  });

  it('treats a non-zero range start as a later batch and skips page-wide issue kinds', async () => {
    const t = await fixture();
    const { body } = await t.call({ range: { start: 6, count: 6 } });
    expect(body.ok).toBe(true);
    expect(body.issues.map((i: any) => i.kind)).not.toContain('broken-image');
  });

  it('removes the folder and reports RENDER_FAILED when the renderer fails', async () => {
    const t = await fixture({ render: async () => ({ ok: false, error: 'boom', errorCode: 'RENDER_FAILED' }) });
    const { body } = await t.call();
    expect(body).toMatchObject({ ok: false, code: 'RENDER_FAILED', message: expect.stringContaining('boom') });
    await expect(fs.stat(t.inputs[0]!.outputDir!)).rejects.toThrow();
    expect(t.revoked).toEqual(['scope-0']);
  });

  it('maps a thrown renderer call to RENDERER_UNAVAILABLE', async () => {
    const t = await fixture({ render: async () => { throw new Error('socket closed'); } });
    expect((await t.call()).body).toMatchObject({ ok: false, code: 'RENDERER_UNAVAILABLE' });
  });
});
