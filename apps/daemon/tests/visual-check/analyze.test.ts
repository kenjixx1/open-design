import type { DesktopVisualBox, DesktopVisualFacts } from '@open-design/sidecar-proto';
import { describe, expect, it } from 'vitest';

import { analyzeVisualFacts, contrastRatio } from '../../src/visual-check/analyze.js';

let nextId = 0;
function box(o: Partial<DesktopVisualBox> = {}): DesktopVisualBox {
  return {
    animatedChildren: false, background: [255, 255, 255, 1], bgImageBehind: false,
    clientH: 20, clientW: 200, clipsX: false, clipsY: false, color: [0, 0, 0, 1], ellipsis: false,
    fontFamily: 'inter', fontSize: 16, fontWeight: 400, h: 20, id: nextId++, insideScroller: false,
    parent: null, scrollH: 20, scrollW: 200, selector: 'p', slide: null, text: 'Hello there',
    w: 200, x: 100, y: 100, ...o,
  };
}
function facts(o: Partial<DesktopVisualFacts> = {}): DesktopVisualFacts {
  return {
    boxes: [], brokenImages: [], consoleErrors: [], images: [], targets: [],
    document: { paintedElements: 4, scrollHeight: 1000, scrollWidth: 1440, visibleTextChars: 200 },
    viewport: { height: 1000, width: 1440 }, ...o,
  };
}
const page = (f: DesktopVisualFacts, width = 1440) => analyzeVisualFacts({ facts: f, mode: 'page', width });
const kinds = (list: { kind: string }[]) => list.map((i) => i.kind);

describe('contrastRatio', () => {
  it('matches known WCAG values', () => {
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 1);
    expect(contrastRatio([119, 119, 119, 1], [255, 255, 255, 1])).toBeCloseTo(4.48, 2);
  });
  it('blends a translucent foreground over the background', () => {
    expect(contrastRatio([0, 0, 0, 0], [255, 255, 255, 1])).toBeCloseTo(1, 5);
  });
});

describe('analyzeVisualFacts errors', () => {
  it('flags a blank page', () => {
    const r = page(facts({ document: { paintedElements: 0, scrollHeight: 1000, scrollWidth: 1440, visibleTextChars: 0 } }));
    expect(kinds(r.issues)).toContain('blank-page');
  });

  it('flags horizontal overflow and names the widest offender, skipping scrollers', () => {
    const r = page(facts({
      document: { paintedElements: 4, scrollHeight: 1000, scrollWidth: 1580, visibleTextChars: 200 },
      boxes: [
        box({ selector: '.menu .cards', x: 100, w: 1480 }),
        box({ selector: '.carousel p', x: 1300, w: 400, insideScroller: true }),
      ],
    }));
    const overflow = r.issues.filter((i) => i.kind === 'horizontal-overflow');
    expect(overflow).toHaveLength(1);
    expect(overflow[0]!.selector).toBe('.menu .cards');
    expect(overflow[0]!.detail).toContain('1580px');
    expect(overflow[0]!.severity).toBe('error');
  });

  it('flags slide overflow beyond 4px only', () => {
    const r = analyzeVisualFacts({
      mode: 'deck', width: 1920,
      facts: facts({
        viewport: { height: 1080, width: 1920 },
        slides: [{ index: 4, x: 0, y: 0, w: 1920, h: 1080 }],
        boxes: [
          box({ slide: 4, y: 1000, h: 120, selector: '.slide ul' }),
          box({ slide: 4, y: 1000, h: 83, selector: '.slide small' }),
        ],
      }),
    });
    const spills = r.issues.filter((i) => i.kind === 'slide-overflow');
    expect(spills.map((i) => i.selector)).toEqual(['.slide ul']);
    expect(spills[0]!.detail).toContain('slide 5');
  });

  it('flags broken images and placeholder text as errors', () => {
    const r = page(facts({
      brokenImages: [{ selector: 'img.logo', src: 'logo.png' }],
      boxes: [box({ text: 'Lorem ipsum dolor sit amet' })],
    }));
    expect(r.issues.filter((i) => i.severity === 'error').map((i) => i.kind).sort()).toEqual(['broken-image', 'placeholder-text']);
  });

  it('does not flag lowercase "todo" occurring in real content', () => {
    const r = page(facts({
      boxes: [
        box({ text: 'Add a todo' }),
        box({ text: 'My Todo list' }),
        box({ text: 'Date: tbd' }),
      ],
    }));
    expect(r.issues.filter((i) => i.kind === 'placeholder-text')).toHaveLength(0);
  });

  it('flags cased TODO/TBD markers and lorem ipsum as placeholder text', () => {
    const r = page(facts({
      boxes: [
        box({ text: 'TODO: hero copy' }),
        box({ text: 'Lorem ipsum dolor' }),
      ],
    }));
    expect(r.issues.filter((i) => i.kind === 'placeholder-text')).toHaveLength(2);
  });

  it('flags clipped text unless it is an ellipsis or an animated carousel', () => {
    const r = page(facts({
      boxes: [
        box({ selector: '.card', clipsY: true, scrollH: 140, clientH: 100 }),
        box({ selector: '.title', clipsX: true, scrollW: 300, clientW: 200, ellipsis: true }),
        box({ selector: '.marquee', clipsX: true, scrollW: 900, clientW: 200, animatedChildren: true }),
        box({ selector: '.italic', clipsX: true, scrollW: 203, clientW: 200 }),
      ],
    }));
    expect(r.issues.filter((i) => i.kind === 'clipped-text').map((i) => i.selector)).toEqual(['.card']);
  });

  it('flags overlapping text but not a parent and its child', () => {
    const parent = box({ selector: 'h1', x: 20, y: 30, w: 300, h: 40 });
    const r = page(facts({
      boxes: [
        box({ selector: 'nav a', x: 20, y: 20, w: 200, h: 30 }),
        parent,
        box({ selector: 'h1 > span', x: 20, y: 55, w: 100, h: 15, parent: parent.id }),
      ],
    }));
    const overlaps = r.issues.filter((i) => i.kind === 'overlapping-text');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.severity).toBe('warning');
    expect(overlaps[0]!.selector).toContain('nav a');
    expect(overlaps[0]!.selector).toContain('h1');
  });

  it('drops console noise from the data: URL load and keeps real errors as warnings', () => {
    const r = page(facts({
      consoleErrors: [
        "Uncaught SecurityError: Failed to read the 'localStorage' property from 'Window'",
        'Uncaught ReferenceError: slider is not defined',
      ],
    }));
    const logs = r.issues.filter((i) => i.kind === 'console-error');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.severity).toBe('warning');
    expect(logs[0]!.detail).toContain('slider is not defined');
  });
});

describe('analyzeVisualFacts improvements', () => {
  it('suggests contrast fixes and skips text over images', () => {
    const r = page(facts({
      boxes: [
        box({ selector: '.price', color: [160, 160, 160, 1] }),
        box({ selector: '.hero h2', color: [160, 160, 160, 1], background: null, bgImageBehind: true }),
        box({ selector: '.big', color: [140, 140, 140, 1], fontSize: 32 }),
      ],
    }));
    const low = r.improvements.filter((i) => i.kind === 'low-contrast');
    expect(low.map((i) => i.selector)).toEqual(['.price']);
    expect(low[0]!.detail).toMatch(/2\.\d : 1/);
    expect(low[0]!.severity).toBe('suggestion');
  });

  it('suggests bigger text, shorter lines, fewer fonts', () => {
    const long = 'x'.repeat(120);
    const r = page(facts({
      boxes: [
        box({ selector: '.fine', fontSize: 10, text: 'Terms apply to every order placed' }),
        box({ selector: '.story p', w: 1200, fontSize: 16, text: long }),
        box({ fontFamily: 'a' }), box({ fontFamily: 'b' }), box({ fontFamily: 'c' }), box({ fontFamily: 'd' }),
      ],
    }));
    expect(kinds(r.improvements)).toEqual(expect.arrayContaining(['tiny-text', 'long-lines', 'too-many-fonts']));
    expect(r.improvements.find((i) => i.kind === 'long-lines')!.detail).toContain('150');
  });

  it('suggests sharper images and edge padding', () => {
    const r = page(facts({
      images: [{ selector: 'img.hero', naturalW: 400, naturalH: 300, drawnW: 1200, drawnH: 900 }],
      boxes: [box({ selector: 'h1', x: 2 })],
    }));
    expect(kinds(r.improvements)).toEqual(expect.arrayContaining(['blurry-image', 'edge-crowding']));
  });

  it('checks tap targets only at phone width', () => {
    const f = facts({ targets: [{ selector: 'a.icon', w: 20, h: 20 }], viewport: { height: 1000, width: 390 } });
    expect(kinds(page(f, 390).improvements)).toContain('small-tap-target');
    expect(kinds(page({ ...f, viewport: { height: 1000, width: 1440 } }, 1440).improvements)).not.toContain('small-tap-target');
  });

  it('caps each kind at 5', () => {
    const r = page(facts({ brokenImages: Array.from({ length: 12 }, (_, i) => ({ selector: `img.i${i}`, src: `${i}.png` })) }));
    expect(r.issues.filter((i) => i.kind === 'broken-image')).toHaveLength(5);
  });

  it('returns nothing for a clean page', () => {
    const r = page(facts({ boxes: [box()] }));
    expect(r).toEqual({ issues: [], improvements: [] });
  });
});
