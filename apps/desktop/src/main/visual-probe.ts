import type { DesktopVisualBox, DesktopVisualColor, PageVisualFacts } from "@open-design/sidecar-proto";

export type CollectVisualFactsOptions = { collectTargets: boolean; maxBoxes: number };

/**
 * Runs INSIDE the rendered page (stringified by `collectorScript`). Read-only:
 * it measures and never writes to the document. Must stay self-contained — no
 * imports, no module constants — because only its source text reaches the page.
 */
export function collectVisualFactsInPage(opts: CollectVisualFactsOptions): PageVisualFacts {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const root = document.documentElement;
  const body = document.body;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  function toColor(css: string | null | undefined): DesktopVisualColor | null {
    if (!ctx || !css) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, Math.round((d[3]! / 255) * 1000) / 1000];
  }

  function selectorOf(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    for (let i = 0; cur && i < 3; i++) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`${part}#${cur.id}`);
        break;
      }
      const cls = (typeof cur.className === "string" ? cur.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += `.${cls.join(".")}`;
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function isVisible(el: Element, rect: DOMRect): boolean {
    if (rect.width < 1 || rect.height < 1) return false;
    const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    if (typeof check === "function") {
      return check.call(el, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    }
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) !== 0;
  }

  function ownText(el: Element): string {
    let t = "";
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) t += n.nodeValue ?? "";
    }
    return t.replace(/\s+/g, " ").trim();
  }

  function backgroundOf(el: Element): { color: DesktopVisualColor | null; imageBehind: boolean } {
    let cur: Element | null = el;
    while (cur) {
      const cs = getComputedStyle(cur);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return { color: null, imageBehind: true };
      const c = toColor(cs.backgroundColor);
      if (c && c[3] >= 0.99) return { color: c, imageBehind: false };
      cur = cur.parentElement;
    }
    return { color: [255, 255, 255, 1], imageBehind: false };
  }

  function insideScroller(el: Element): boolean {
    for (let c = el.parentElement; c && c !== body; c = c.parentElement) {
      const o = getComputedStyle(c).overflowX;
      if (o === "auto" || o === "scroll") return true;
    }
    return false;
  }

  function hasAnimatedChildren(el: Element): boolean {
    for (let k = el.firstElementChild; k; k = k.nextElementSibling) {
      const s = getComputedStyle(k);
      if ((s.transform && s.transform !== "none") || (s.animationName && s.animationName !== "none")) return true;
    }
    return false;
  }

  function textExtent(el: Element, rect: DOMRect, cs: CSSStyleDeclaration): { w: number; x: number } {
    const range = document.createRange();
    let minX = Infinity;
    let maxX = -Infinity;
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 3 || !(n.nodeValue ?? "").trim()) continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 1) continue;
        minX = Math.min(minX, r.left);
        maxX = Math.max(maxX, r.right);
      }
    }
    if (minX === Infinity) {
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      return { w: Math.max(0, Math.round(rect.width - pl - pr)), x: Math.round(rect.left + pl) };
    }
    return { w: Math.round(maxX - minX), x: Math.round(minX) };
  }

  const ids = new Map<Element, number>();
  const boxes: DesktopVisualBox[] = [];
  const boxEls: Element[] = [];
  const media: PageVisualFacts["media"] = [];
  const mediaEls: Element[] = [];
  let visibleTextChars = 0;
  let paintedElements = 0;
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"]);
  const all = body ? body.querySelectorAll("*") : [];

  for (const el of Array.from(all)) {
    if (skip.has(el.tagName)) continue;
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) continue;
    const cs = getComputedStyle(el);
    const tag = el.tagName;
    const isMediaTag = ["IMG", "VIDEO", "CANVAS", "PICTURE", "SVG"].includes(tag.toUpperCase());
    if (
      isMediaTag
      || (cs.backgroundImage && cs.backgroundImage !== "none")
      || (toColor(cs.backgroundColor)?.[3] ?? 0) > 0
    ) {
      if (rect.width * rect.height > 100) paintedElements += 1;
    }
    if (
      (isMediaTag || (cs.backgroundImage && cs.backgroundImage !== "none"))
      && rect.width * rect.height >= 2500
      && media.length < 100
    ) {
      media.push({ contains: [], h: Math.round(rect.height), w: Math.round(rect.width), x: Math.round(rect.left), y: Math.round(rect.top) });
      mediaEls.push(el);
    }
    if (rect.width <= 2 || rect.height <= 2) continue;
    if (cs.clip && cs.clip !== "auto") continue;
    if (cs.clipPath && cs.clipPath !== "none") continue;
    const own = ownText(el);
    visibleTextChars += own.length;
    const clipsX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    const clipsY = cs.overflowY === "hidden" || cs.overflowY === "clip";
    const overflowing = (clipsX && el.scrollWidth > el.clientWidth + 4) || (clipsY && el.scrollHeight > el.clientHeight + 4);
    const clipText = overflowing ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : "";
    if (!own && !clipText) continue;
    if (boxes.length >= opts.maxBoxes) continue;
    let parent: number | null = null;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const pid = ids.get(p);
      if (pid !== undefined) {
        parent = pid;
        break;
      }
    }
    const bg = backgroundOf(el);
    const id = boxes.length;
    const extent = textExtent(el, rect, cs);
    ids.set(el, id);
    boxes.push({
      animatedChildren: hasAnimatedChildren(el),
      background: bg.color,
      bgImageBehind: bg.imageBehind,
      clientH: el.clientHeight,
      clientW: el.clientWidth,
      clipsX,
      clipsY,
      color: toColor(cs.color),
      ellipsis: cs.textOverflow === "ellipsis" || (cs.getPropertyValue("-webkit-line-clamp") || "none") !== "none",
      fontFamily: (cs.fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim().toLowerCase(),
      fontSize: parseFloat(cs.fontSize) || 0,
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      h: Math.round(rect.height),
      id,
      insideScroller: insideScroller(el),
      ownText: own.length > 0,
      parent,
      scrollH: el.scrollHeight,
      scrollW: el.scrollWidth,
      selector: selectorOf(el),
      slide: null,
      text: (own || clipText).slice(0, 120),
      textW: extent.w,
      textX: extent.x,
      w: Math.round(rect.width),
      x: Math.round(rect.left),
      y: Math.round(rect.top),
    });
    boxEls.push(el);
  }

  for (let i = 0; i < mediaEls.length; i++) {
    const mediaEl = mediaEls[i]!;
    const contains = media[i]!.contains;
    for (let j = 0; j < boxEls.length; j++) {
      if (contains.length >= 1500) break;
      if (mediaEl.contains(boxEls[j]!)) contains.push(j);
    }
  }

  const brokenImages: PageVisualFacts["brokenImages"] = [];
  const images: PageVisualFacts["images"] = [];
  for (const img of Array.from(document.images)) {
    const src = img.getAttribute("src") || img.currentSrc || "";
    if (!src) continue;
    if (img.complete && img.naturalWidth === 0) {
      if (brokenImages.length < 20) brokenImages.push({ selector: selectorOf(img), src: src.slice(0, 200) });
      continue;
    }
    const r = img.getBoundingClientRect();
    if (img.naturalWidth > 0 && isVisible(img, r) && images.length < 40) {
      images.push({ drawnH: Math.round(r.height), drawnW: Math.round(r.width), naturalH: img.naturalHeight, naturalW: img.naturalWidth, selector: selectorOf(img) });
    }
  }

  const targets: PageVisualFacts["targets"] = [];
  if (opts.collectTargets) {
    for (const el of Array.from(document.querySelectorAll('a[href], button, [role="button"], input, select, textarea'))) {
      const r = el.getBoundingClientRect();
      if (!isVisible(el, r)) continue;
      if (targets.length >= 60) break;
      targets.push({ h: Math.round(r.height), selector: selectorOf(el), w: Math.round(r.width) });
    }
  }

  return {
    boxes,
    brokenImages,
    document: {
      paintedElements,
      scrollHeight: Math.max(root.scrollHeight, body ? body.scrollHeight : 0),
      scrollWidth: Math.max(root.scrollWidth, body ? body.scrollWidth : 0),
      visibleTextChars,
    },
    images,
    media,
    targets,
    viewport: { height: vh, width: vw },
  };
}
