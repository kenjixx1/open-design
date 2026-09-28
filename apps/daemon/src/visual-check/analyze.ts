import type { VisualCheckIssue, VisualCheckIssueKind, VisualCheckSeverity } from '@open-design/contracts';
import type { DesktopVisualBox, DesktopVisualColor, DesktopVisualFacts } from '@open-design/sidecar-proto';

const MAX_PER_KIND = 5;
const PLACEHOLDER_CASED_RE = /\bTODO\b|\bTBD\b/;
const PLACEHOLDER_TEXT_RE = /\blorem ipsum\b|\[image\]|your text here|placeholder text/i;
const CONSOLE_NOISE_RE = /SecurityError|localStorage|sessionStorage|service ?worker|document\.domain/i;

export interface AnalyzeVisualFactsInput {
  facts: DesktopVisualFacts;
  mode: 'page' | 'deck';
  width: number;
}

export interface AnalyzeVisualFactsResult {
  issues: VisualCheckIssue[];
  improvements: VisualCheckIssue[];
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 2 contrast ratio; a translucent foreground is blended over the background. */
export function contrastRatio(fg: DesktopVisualColor, bg: DesktopVisualColor): number {
  const alpha = fg[3];
  const over = (i: 0 | 1 | 2): number => fg[i] * alpha + bg[i] * (1 - alpha);
  const front = luminance([over(0), over(1), over(2)]);
  const back = luminance([bg[0], bg[1], bg[2]]);
  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
}

function isAncestor(boxes: Map<number, DesktopVisualBox>, maybeAncestor: number, child: DesktopVisualBox): boolean {
  let cur = child.parent;
  while (cur != null) {
    if (cur === maybeAncestor) return true;
    cur = boxes.get(cur)?.parent ?? null;
  }
  return false;
}

export function analyzeVisualFacts(input: AnalyzeVisualFactsInput): AnalyzeVisualFactsResult {
  const { facts, mode } = input;
  const vw = facts.viewport.width;
  const all: VisualCheckIssue[] = [];
  const counts = new Map<VisualCheckIssueKind, number>();
  const add = (kind: VisualCheckIssueKind, severity: VisualCheckSeverity, selector: string, detail: string, text?: string) => {
    const n = counts.get(kind) ?? 0;
    if (n >= MAX_PER_KIND) return;
    counts.set(kind, n + 1);
    all.push({ kind, severity, selector, detail, ...(text ? { text: text.slice(0, 60) } : {}) });
  };
  const textBoxes = facts.boxes.filter((b) => b.text.length > 0);
  const byId = new Map(facts.boxes.map((b) => [b.id, b]));

  // --- errors ---
  if (facts.document.visibleTextChars === 0 && facts.document.paintedElements === 0) {
    add('blank-page', 'error', 'body', 'The page shows no text and no images.');
  }

  if (mode === 'page' && facts.document.scrollWidth > vw + 1) {
    const offenders = textBoxes
      .filter((b) => b.x + b.w > vw + 1 && !b.insideScroller)
      .sort((a, b) => b.x + b.w - (a.x + a.w));
    if (offenders.length === 0) {
      add('horizontal-overflow', 'error', 'html', `Content is ${facts.document.scrollWidth}px wide in a ${vw}px screen.`);
    }
    for (const b of offenders) {
      add('horizontal-overflow', 'error', b.selector, `Content is ${facts.document.scrollWidth}px wide in a ${vw}px screen; this element ends at ${b.x + b.w}px.`, b.text);
    }
  }

  if (mode === 'deck' && facts.slides) {
    const slides = new Map(facts.slides.map((s) => [s.index, s]));
    for (const b of textBoxes) {
      if (b.slide == null) continue;
      const s = slides.get(b.slide);
      if (!s) continue;
      const spill = Math.max(s.x - b.x, s.y - b.y, b.x + b.w - (s.x + s.w), b.y + b.h - (s.y + s.h));
      if (spill > 4) add('slide-overflow', 'error', b.selector, `Spills ${Math.round(spill)}px outside slide ${b.slide + 1}.`, b.text);
    }
  }

  for (const img of facts.brokenImages) {
    add('broken-image', 'error', img.selector, `The image ${img.src} did not load.`);
  }

  for (const b of textBoxes) {
    if (PLACEHOLDER_CASED_RE.test(b.text) || PLACEHOLDER_TEXT_RE.test(b.text)) add('placeholder-text', 'error', b.selector, 'Placeholder text is still on the page.', b.text);
  }

  for (const b of facts.boxes) {
    if (b.ellipsis || b.animatedChildren || !b.text) continue;
    const hiddenX = b.clipsX ? b.scrollW - b.clientW : 0;
    const hiddenY = b.clipsY ? b.scrollH - b.clientH : 0;
    const hidden = Math.max(hiddenX, hiddenY);
    if (hidden > 4) add('clipped-text', 'warning', b.selector, `Text is cut off: ${hidden}px is hidden.`, b.text);
  }

  outer: for (let i = 0; i < textBoxes.length; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      if ((counts.get('overlapping-text') ?? 0) >= MAX_PER_KIND) break outer;
      const a = textBoxes[i]!;
      const b = textBoxes[j]!;
      if (a.slide !== b.slide) continue;
      if (isAncestor(byId, a.id, b) || isAncestor(byId, b.id, a)) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix <= 0 || iy <= 0) continue;
      const smaller = Math.min(a.w * a.h, b.w * b.h);
      if (smaller <= 0 || (ix * iy) / smaller <= 0.2) continue;
      add('overlapping-text', 'warning', `${a.selector} ↔ ${b.selector}`, `These two text boxes overlap by ${Math.round(iy)}px.`);
    }
  }

  for (const msg of facts.consoleErrors) {
    if (CONSOLE_NOISE_RE.test(msg)) continue;
    add('console-error', 'warning', 'console', `The page logged an error: ${msg}`);
  }

  // --- improvements ---
  const coveredByMedia = (b: DesktopVisualBox): boolean => {
    const area = b.w * b.h;
    if (area <= 0) return false;
    for (const m of facts.media) {
      const ix = Math.min(b.x + b.w, m.x + m.w) - Math.max(b.x, m.x);
      const iy = Math.min(b.y + b.h, m.y + m.h) - Math.max(b.y, m.y);
      if (ix <= 0 || iy <= 0) continue;
      if ((ix * iy) / area >= 0.5) return true;
    }
    return false;
  };

  for (const b of textBoxes) {
    if (!b.color || !b.background || b.bgImageBehind || coveredByMedia(b)) continue;
    const ratio = contrastRatio(b.color, b.background);
    const large = b.fontSize >= 24 || (b.fontSize >= 18.66 && b.fontWeight >= 700);
    const target = large ? 3 : 4.5;
    if (ratio < target) {
      add('low-contrast', 'suggestion', b.selector, `Text contrast is ${ratio.toFixed(1)} : 1; aim for ${target} : 1.`, b.text);
    }
  }

  for (const b of textBoxes) {
    if (b.fontSize > 0 && b.fontSize < 12 && b.text.length > 20) {
      add('tiny-text', 'suggestion', b.selector, `Text is ${b.fontSize}px; body text reads better at 14px or more.`, b.text);
    }
  }

  for (const b of textBoxes) {
    if (b.fontSize <= 0 || b.text.length < 100) continue;
    const perLine = Math.round(b.w / (b.fontSize * 0.5));
    if (perLine > 90) add('long-lines', 'suggestion', b.selector, `About ${perLine} letters fit on one line; aim for under 90.`, b.text);
  }

  const families = [...new Set(textBoxes.map((b) => b.fontFamily).filter(Boolean))];
  if (families.length > 3) {
    add('too-many-fonts', 'suggestion', 'body', `The page uses ${families.length} fonts (${families.join(', ')}); 2 or 3 look calmer.`);
  }

  for (const img of facts.images) {
    const scale = Math.max(img.drawnW / Math.max(1, img.naturalW), img.drawnH / Math.max(1, img.naturalH));
    if (scale > 1.5) {
      add('blurry-image', 'suggestion', img.selector, `The image is ${img.naturalW}px wide but drawn at ${img.drawnW}px, so it looks blurry.`);
    }
  }

  if (mode === 'page') {
    for (const b of textBoxes) {
      if (b.x < 0 || b.x + b.w > vw) continue;
      const gap = Math.min(b.x, vw - (b.x + b.w));
      if (gap < 8) add('edge-crowding', 'suggestion', b.selector, `Text sits ${gap}px from the screen edge; give it at least 16px.`, b.text);
    }
  }

  if (input.width <= 480) {
    for (const t of facts.targets) {
      if (t.w < 32 || t.h < 32) {
        add('small-tap-target', 'suggestion', t.selector, `This button or link is ${t.w}×${t.h}px; fingers need about 44×44px.`);
      }
    }
  }

  return {
    issues: all.filter((i) => i.severity !== 'suggestion'),
    improvements: all.filter((i) => i.severity === 'suggestion'),
  };
}
