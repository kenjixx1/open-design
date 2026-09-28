import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  VISUAL_CHECK_MAX_SCREENS,
  VISUAL_CHECK_MAX_SLIDES,
  type DesktopRenderSlidesInput,
  type DesktopRenderSlidesResult,
  type DesktopVisualBox,
  type DesktopVisualFacts,
  type PageVisualFacts,
} from "@open-design/sidecar-proto";

import { collectVisualFactsInPage, type CollectVisualFactsOptions } from "./visual-probe.js";

/** The slice of Electron's NativeImage this module needs. */
export interface CapturedImageLike {
  getSize(): { height: number; width: number };
  resize(options: { width: number }): CapturedImageLike;
  toPNG(): Buffer;
}

/** The slice of Electron's BrowserWindow this module needs. */
export interface VisualCheckWindow {
  setContentSize(width: number, height: number): void;
  webContents: {
    capturePage(rect: { height: number; width: number; x: number; y: number }): Promise<CapturedImageLike>;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  };
}

/** Helpers owned by deck-capture.ts, injected to avoid an import cycle. */
export interface VisualCheckPageDeps {
  nextFrames(): Promise<void>;
  preparePage(): Promise<void>;
  scrollTo(target: number): Promise<number>;
  viewportBand(p: number, actualY: number, totalLogical: number, viewportH: number): { height: number; top: number };
}

export interface VisualCheckDeckDeps {
  captureSlide(index: number): Promise<CapturedImageLike>;
}

const DOC_HEIGHT_JS =
  "Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))";

export function collectorScript(opts: CollectVisualFactsOptions): string {
  return `(${collectVisualFactsInPage.toString()})(${JSON.stringify(opts)})`;
}

/** Indices of one batch: `range` if given, else the first `max`. Empty when past the end. */
export function batchIndices(
  range: { count: number; start: number } | undefined,
  total: number,
  max: number,
): number[] {
  const start = range?.start ?? 0;
  const count = Math.min(range?.count ?? max, max);
  const out: number[] = [];
  for (let i = start; i < total && out.length < count; i++) out.push(i);
  return out;
}

/** Collects error-level console messages; Electron 41 passes one details object. */
export function recordConsoleError(
  sink: string[],
  details: { level?: number | string; message?: string } | null | undefined,
): void {
  if (!details) return;
  const isError = details.level === "error" || details.level === 3;
  if (!isError || typeof details.message !== "string") return;
  if (sink.length >= 10) return;
  sink.push(details.message.length > 300 ? `${details.message.slice(0, 297)}...` : details.message);
}

export function mergeDeckFacts(
  perSlide: Array<{ facts: PageVisualFacts; index: number }>,
  stage: { h: number; w: number },
  consoleErrors: string[],
): DesktopVisualFacts | undefined {
  if (perSlide.length === 0) return undefined;
  const boxes: DesktopVisualBox[] = [];
  const brokenImages: DesktopVisualFacts["brokenImages"] = [];
  const brokenSeen = new Set<string>();
  const images: DesktopVisualFacts["images"] = [];
  const targets: DesktopVisualFacts["targets"] = [];
  let offset = 0;
  let visibleTextChars = 0;
  let paintedElements = 0;
  let scrollWidth = 0;
  let scrollHeight = 0;
  for (const { facts, index } of perSlide) {
    for (const b of facts.boxes) {
      boxes.push({ ...b, id: b.id + offset, parent: b.parent == null ? null : b.parent + offset, slide: index });
    }
    offset += facts.boxes.length;
    for (const img of facts.brokenImages) {
      const key = `${img.selector}|${img.src}`;
      if (!brokenSeen.has(key) && brokenImages.length < 20) {
        brokenSeen.add(key);
        brokenImages.push(img);
      }
    }
    for (const img of facts.images) if (images.length < 40) images.push(img);
    for (const t of facts.targets) if (targets.length < 60) targets.push(t);
    visibleTextChars += facts.document.visibleTextChars;
    paintedElements += facts.document.paintedElements;
    scrollWidth = Math.max(scrollWidth, facts.document.scrollWidth);
    scrollHeight = Math.max(scrollHeight, facts.document.scrollHeight);
  }
  return {
    boxes,
    brokenImages,
    consoleErrors: [...consoleErrors],
    document: { paintedElements, scrollHeight, scrollWidth, visibleTextChars },
    images,
    slides: perSlide.map(({ index }) => ({ h: stage.h, index, w: stage.w, x: 0, y: 0 })),
    targets,
    viewport: { height: stage.h, width: stage.w },
  };
}

async function writePng(outputDir: string, name: string, image: CapturedImageLike, logicalWidth: number): Promise<string> {
  const size = image.getSize();
  const oneX = size.width > logicalWidth ? image.resize({ width: logicalWidth }) : image;
  const file = path.join(outputDir, name);
  await writeFile(file, oneX.toPNG());
  return file;
}

async function runCollector(window: VisualCheckWindow, opts: CollectVisualFactsOptions): Promise<PageVisualFacts | null> {
  try {
    const value = await window.webContents.executeJavaScript(collectorScript(opts), true);
    return value && typeof value === "object" ? (value as PageVisualFacts) : null;
  } catch {
    return null;
  }
}

/**
 * Page mode. Order matters: prepare (freeze motion, scroll through to trigger
 * reveals and lazy images), return to the top, measure, then capture tiles.
 */
export async function capturePageForVisualCheck(
  window: VisualCheckWindow,
  input: DesktopRenderSlidesInput,
  pageSize: { h: number; w: number },
  deps: VisualCheckPageDeps,
  consoleErrors: string[],
): Promise<DesktopRenderSlidesResult> {
  const outputDir = input.outputDir!;
  window.setContentSize(pageSize.w, pageSize.h);
  await deps.nextFrames();
  await deps.preparePage();
  await deps.scrollTo(0);
  const facts = await runCollector(window, { collectTargets: pageSize.w <= 480, maxBoxes: 400 });
  const measured = Number(await window.webContents.executeJavaScript(DOC_HEIGHT_JS, true));
  const docH = Math.max(pageSize.h, Number.isFinite(measured) ? Math.ceil(measured) : pageSize.h);
  const total = Math.max(1, Math.ceil(docH / pageSize.h));
  const indices = batchIndices(input.range, total, VISUAL_CHECK_MAX_SCREENS);
  if (indices.length === 0) {
    return {
      ok: false,
      error: `screen range starts past the end (page has ${total} screen(s))`,
      errorCode: "SLIDE_INDEX_OUT_OF_RANGE",
    };
  }
  await mkdir(outputDir, { recursive: true });
  const maxScroll = Math.max(0, docH - pageSize.h);
  const slideFiles: string[] = [];
  for (const p of indices) {
    const actualY = await deps.scrollTo(Math.min(p * pageSize.h, maxScroll));
    const band = deps.viewportBand(p, actualY, docH, pageSize.h);
    const image = await window.webContents.capturePage({ height: band.height, width: pageSize.w, x: 0, y: band.top });
    slideFiles.push(await writePng(outputDir, `screen-${p + 1}.png`, image, pageSize.w));
  }
  return {
    height: pageSize.h,
    indices,
    mode: "page",
    ok: true,
    slideFiles,
    total,
    width: pageSize.w,
    ...(facts ? { visualFacts: { ...facts, consoleErrors: [...consoleErrors] } } : {}),
  };
}

/** Deck mode: capture the slide batch and collect facts per shown slide. */
export async function captureDeckForVisualCheck(
  window: VisualCheckWindow,
  slideCount: number,
  stage: { h: number; w: number },
  input: DesktopRenderSlidesInput,
  deps: VisualCheckDeckDeps,
  consoleErrors: string[],
): Promise<DesktopRenderSlidesResult> {
  const outputDir = input.outputDir!;
  const indices = batchIndices(input.range, slideCount, VISUAL_CHECK_MAX_SLIDES);
  if (indices.length === 0) {
    return {
      ok: false,
      error: `slide range starts past the end (deck has ${slideCount} slide(s))`,
      errorCode: "SLIDE_INDEX_OUT_OF_RANGE",
    };
  }
  await mkdir(outputDir, { recursive: true });
  const slideFiles: string[] = [];
  const perSlide: Array<{ facts: PageVisualFacts; index: number }> = [];
  for (const i of indices) {
    const image = await deps.captureSlide(i);
    slideFiles.push(await writePng(outputDir, `slide-${i + 1}.png`, image, stage.w));
    const facts = await runCollector(window, { collectTargets: false, maxBoxes: 200 });
    if (facts) perSlide.push({ facts, index: i });
  }
  const visualFacts = mergeDeckFacts(perSlide, stage, consoleErrors);
  return {
    height: stage.h,
    indices,
    mode: "deck",
    ok: true,
    slideFiles,
    total: slideCount,
    width: stage.w,
    ...(visualFacts ? { visualFacts } : {}),
  };
}
