import { describe, expect, it } from "vitest";

import {
  normalizeDesktopSidecarMessage,
  SIDECAR_MESSAGES,
  VISUAL_CHECK_MAX_SCREENS,
  VISUAL_CHECK_MAX_SLIDES,
} from "../src/index.js";

const msg = (input: Record<string, unknown>) => ({ input, type: SIDECAR_MESSAGES.RENDER_SLIDES });

describe("render-slides inspect input", () => {
  it("exposes the batch limits", () => {
    expect(VISUAL_CHECK_MAX_SCREENS).toBe(6);
    expect(VISUAL_CHECK_MAX_SLIDES).toBe(12);
  });

  it("round-trips inspect with a range and an outputDir", () => {
    expect(
      normalizeDesktopSidecarMessage(
        msg({ html: "<p>x</p>", inspect: true, outputDir: "/data/visual-checks/p/r/1-index", range: { start: 6, count: 6 } }),
      ),
    ).toEqual({
      input: { html: "<p>x</p>", inspect: true, outputDir: "/data/visual-checks/p/r/1-index", range: { start: 6, count: 6 } },
      type: "render-slides",
    });
  });

  it("requires outputDir when inspecting", () => {
    expect(() => normalizeDesktopSidecarMessage(msg({ html: "<p>x</p>", inspect: true }))).toThrow(/requires outputDir/);
  });

  it("rejects a range without inspect", () => {
    expect(() =>
      normalizeDesktopSidecarMessage(msg({ html: "<p>x</p>", outputDir: "/d", range: { start: 0, count: 1 } })),
    ).toThrow(/requires inspect/);
  });

  it.each([
    [{ start: -1, count: 1 }],
    [{ start: 0.5, count: 1 }],
    [{ start: 0, count: 0 }],
    [{ start: 0, count: 13 }],
    [{ start: 0, count: 1, extra: true }],
    ["0-5"],
  ])("rejects bad range %j", (range) => {
    expect(() =>
      normalizeDesktopSidecarMessage(msg({ html: "<p>x</p>", inspect: true, outputDir: "/d", range })),
    ).toThrow();
  });

  it.each(["index", "stitch", "editable", "paginate"])("rejects inspect combined with %s", (key) => {
    const value = key === "index" ? 0 : true;
    expect(() =>
      normalizeDesktopSidecarMessage(msg({ html: "<p>x</p>", inspect: true, outputDir: "/d", [key]: value })),
    ).toThrow(new RegExp(`cannot be combined with ${key}`));
  });

  it("rejects a non-boolean inspect", () => {
    expect(() => normalizeDesktopSidecarMessage(msg({ html: "<p>x</p>", inspect: "yes", outputDir: "/d" }))).toThrow();
  });
});
