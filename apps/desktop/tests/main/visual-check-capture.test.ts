import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PageVisualFacts } from '@open-design/sidecar-proto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  batchIndices,
  capturePageForVisualCheck,
  captureDeckForVisualCheck,
  collectorScript,
  filterFactsToBand,
  mergeDeckFacts,
  recordConsoleError,
  type CapturedImageLike,
} from '../../src/main/visual-check-capture.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), 'od-visual-'));
  dirs.push(d);
  return d;
}

function fakeImage(width: number, height: number): CapturedImageLike {
  return {
    getSize: () => ({ width, height }),
    resize: ({ width: w }) => fakeImage(w, Math.round((height * w) / width)),
    toPNG: () => Buffer.from(`png-${width}x${height}`),
  };
}

function facts(overrides: Partial<PageVisualFacts> = {}): PageVisualFacts {
  return {
    boxes: [
      { animatedChildren: false, background: [255, 255, 255, 1], bgImageBehind: false, clientH: 20, clientW: 100, clipsX: false, clipsY: false, color: [0, 0, 0, 1], ellipsis: false, fontFamily: 'Inter', fontSize: 16, fontWeight: 400, h: 20, id: 0, insideScroller: false, ownText: true, parent: null, scrollH: 20, scrollW: 100, selector: 'h1', slide: null, text: 'Hello', textW: 100, textX: 10, w: 100, x: 10, y: 10 },
      { animatedChildren: false, background: [255, 255, 255, 1], bgImageBehind: false, clientH: 20, clientW: 100, clipsX: false, clipsY: false, color: [0, 0, 0, 1], ellipsis: false, fontFamily: 'Inter', fontSize: 16, fontWeight: 400, h: 20, id: 1, insideScroller: false, ownText: true, parent: 0, scrollH: 20, scrollW: 100, selector: 'h1 > span', slide: null, text: 'World', textW: 100, textX: 10, w: 100, x: 10, y: 10 },
    ],
    brokenImages: [{ selector: 'img.logo', src: 'logo.png' }],
    document: { paintedElements: 3, scrollHeight: 2500, scrollWidth: 1440, visibleTextChars: 10 },
    images: [],
    media: [],
    targets: [],
    viewport: { height: 1000, width: 1440 },
    ...overrides,
  };
}

function fakeWindow(pageFacts: PageVisualFacts | Error, docHeight: number) {
  return {
    setContentSize: vi.fn(),
    webContents: {
      executeJavaScript: vi.fn(async (code: string) => {
        if (code.includes('collectVisualFactsInPage')) {
          if (pageFacts instanceof Error) throw pageFacts;
          return pageFacts;
        }
        return docHeight;
      }),
      capturePage: vi.fn(async (rect: { width: number; height: number }) => fakeImage(rect.width * 2, rect.height * 2)),
    },
  };
}

const pageDeps = () => ({
  nextFrames: vi.fn(async () => {}),
  preparePage: vi.fn(async () => {}),
  scrollTo: vi.fn(async (target: number) => target),
  viewportBand: (_p: number, _y: number, _total: number, vh: number) => ({ top: 0, height: vh }),
});

describe('batchIndices', () => {
  it('defaults to the first batch', () => {
    expect(batchIndices(undefined, 9, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('honours start and count and stops at the end', () => {
    expect(batchIndices({ start: 6, count: 6 }, 9, 6)).toEqual([6, 7, 8]);
  });
  it('clamps count to the batch max', () => {
    expect(batchIndices({ start: 0, count: 12 }, 20, 6)).toHaveLength(6);
  });
  it('returns nothing past the end', () => {
    expect(batchIndices({ start: 9, count: 3 }, 9, 6)).toEqual([]);
  });
});

describe('recordConsoleError', () => {
  it('keeps only error-level messages, capped and truncated', () => {
    const sink: string[] = [];
    recordConsoleError(sink, { level: 'warning', message: 'nope' });
    recordConsoleError(sink, { level: 3, message: 'numeric error' });
    recordConsoleError(sink, { level: 'error', message: 'x'.repeat(400) });
    for (let i = 0; i < 20; i++) recordConsoleError(sink, { level: 'error', message: `e${i}` });
    expect(sink).toHaveLength(10);
    expect(sink[0]).toBe('numeric error');
    expect(sink[1]).toHaveLength(300);
    expect(sink[1].endsWith('...')).toBe(true);
  });
  it('ignores null details', () => {
    const sink: string[] = [];
    recordConsoleError(sink, null);
    expect(sink).toEqual([]);
  });
});

describe('collectorScript', () => {
  it('produces a parseable self-invoking expression', () => {
    const script = collectorScript({ collectTargets: false, maxBoxes: 400 });
    expect(script).toContain('collectVisualFactsInPage');
    expect(script.endsWith('({"collectTargets":false,"maxBoxes":400})')).toBe(true);
    // Compiles without running (the body touches `window`/`document`).
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('filterFactsToBand', () => {
  function boxAt(y: number, h = 20): PageVisualFacts['boxes'][number] {
    return { animatedChildren: false, background: [255, 255, 255, 1], bgImageBehind: false, clientH: h, clientW: 100, clipsX: false, clipsY: false, color: [0, 0, 0, 1], ellipsis: false, fontFamily: 'Inter', fontSize: 16, fontWeight: 400, h, id: 0, insideScroller: false, ownText: true, parent: null, scrollH: h, scrollW: 100, selector: 'p', slide: null, text: 'x', textW: 100, textX: 10, w: 100, x: 10, y };
  }

  it('keeps boxes intersecting the band and drops boxes outside it', () => {
    const f = facts({
      boxes: [boxAt(100), boxAt(1200), boxAt(2500), boxAt(900, 200)],
      media: [{ h: 20, w: 20, x: 0, y: 100, contains: [0] }, { h: 20, w: 20, x: 0, y: 1200, contains: [2, 3] }],
    });
    const out = filterFactsToBand(f, 1000, 2000);
    expect(out.boxes.map((b) => b.y)).toEqual([1200, 900]);
    expect(out.media.map((m) => m.y)).toEqual([1200]);
    expect(out.media.map((m) => m.contains)).toEqual([[2, 3]]);
  });
});

describe('mergeDeckFacts', () => {
  it('re-ids boxes per slide and records slide rects', () => {
    const merged = mergeDeckFacts(
      [
        { index: 2, facts: facts() },
        { index: 3, facts: facts() },
      ],
      { w: 1920, h: 1080 },
      ['boom'],
    )!;
    expect(merged.boxes.map((b) => [b.id, b.parent, b.slide])).toEqual([
      [0, null, 2],
      [1, 0, 2],
      [2, null, 3],
      [3, 2, 3],
    ]);
    expect(merged.slides).toEqual([
      { index: 2, x: 0, y: 0, w: 1920, h: 1080 },
      { index: 3, x: 0, y: 0, w: 1920, h: 1080 },
    ]);
    expect(merged.brokenImages).toHaveLength(1);
    expect(merged.consoleErrors).toEqual(['boom']);
    expect(merged.viewport).toEqual({ width: 1920, height: 1080 });
    expect(merged.document.visibleTextChars).toBe(20);
  });
  it('returns undefined when no slide produced facts', () => {
    expect(mergeDeckFacts([], { w: 1920, h: 1080 }, [])).toBeUndefined();
  });
  it('offsets media contains ids the same way it offsets box ids', () => {
    const merged = mergeDeckFacts(
      [
        { index: 2, facts: facts({ media: [{ h: 20, w: 20, x: 0, y: 0, contains: [1] }] }) },
        { index: 3, facts: facts({ media: [{ h: 20, w: 20, x: 0, y: 0, contains: [0] }] }) },
      ],
      { w: 1920, h: 1080 },
      [],
    )!;
    expect(merged.media.map((m) => m.contains)).toEqual([[1], [2]]);
  });
});

describe('capturePageForVisualCheck', () => {
  it('writes 1x screen tiles for the first batch and attaches facts', async () => {
    const outputDir = await tmp();
    const window = fakeWindow(facts(), 2500);
    const deps = pageDeps();
    const sink = ['err'];
    const result = await capturePageForVisualCheck(window, { html: 'x', inspect: true, outputDir }, { w: 1440, h: 1000 }, deps, sink);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('page');
    expect(result.total).toBe(3);
    expect(result.indices).toEqual([0, 1, 2]);
    expect((await readdir(outputDir)).sort()).toEqual(['screen-1.png', 'screen-2.png', 'screen-3.png']);
    expect((await readFile(join(outputDir, 'screen-1.png'), 'utf8'))).toBe('png-1440x1000');
    expect(result.visualFacts?.consoleErrors).toEqual(['err']);
    expect(deps.preparePage).toHaveBeenCalledOnce();
    expect(deps.preparePage.mock.invocationCallOrder[0]).toBeLessThan(window.webContents.executeJavaScript.mock.invocationCallOrder[0]!);
  });

  it('captures only the requested range', async () => {
    const outputDir = await tmp();
    const result = await capturePageForVisualCheck(
      fakeWindow(facts(), 2500),
      { html: 'x', inspect: true, outputDir, range: { start: 1, count: 1 } },
      { w: 1440, h: 1000 },
      pageDeps(),
      [],
    );
    expect(result.indices).toEqual([1]);
    expect(await readdir(outputDir)).toEqual(['screen-2.png']);
  });

  it('fails cleanly when the range starts past the end', async () => {
    const outputDir = await tmp();
    const result = await capturePageForVisualCheck(
      fakeWindow(facts(), 900),
      { html: 'x', inspect: true, outputDir, range: { start: 4, count: 1 } },
      { w: 1440, h: 1000 },
      pageDeps(),
      [],
    );
    expect(result).toMatchObject({ ok: false, errorCode: 'SLIDE_INDEX_OUT_OF_RANGE' });
  });

  it('still returns images when the collector throws', async () => {
    const outputDir = await tmp();
    const result = await capturePageForVisualCheck(
      fakeWindow(new Error('boom'), 1000),
      { html: 'x', inspect: true, outputDir },
      { w: 1440, h: 1000 },
      pageDeps(),
      [],
    );
    expect(result.ok).toBe(true);
    expect(result.slideFiles).toHaveLength(1);
    expect(result.visualFacts).toBeUndefined();
  });
});

describe('captureDeckForVisualCheck', () => {
  it('captures the slide batch and merges per-slide facts', async () => {
    const outputDir = await tmp();
    const window = fakeWindow(facts(), 1080);
    const captureSlide = vi.fn(async (_index: number) => fakeImage(3840, 2160));
    const result = await captureDeckForVisualCheck(
      window,
      15,
      { w: 1920, h: 1080 },
      { html: 'x', inspect: true, outputDir, range: { start: 12, count: 12 } },
      { captureSlide },
      [],
    );
    expect(result).toMatchObject({ ok: true, mode: 'deck', total: 15, indices: [12, 13, 14] });
    expect(captureSlide.mock.calls.map((c) => c[0])).toEqual([12, 13, 14]);
    expect((await readdir(outputDir)).sort()).toEqual(['slide-13.png', 'slide-14.png', 'slide-15.png']);
    expect(await readFile(join(outputDir, 'slide-13.png'), 'utf8')).toBe('png-1920x1080');
    expect(result.visualFacts?.slides?.map((s) => s.index)).toEqual([12, 13, 14]);
  });
});
