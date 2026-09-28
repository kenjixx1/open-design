/**
 * Host runtime contract: the agent-facing rule for `od tools screenshot`.
 * Appended to the per-run "Runtime tool environment" block only when a live
 * desktop advertises `capabilities.visualCheck`, so classic, slim, and OD Next
 * runs all receive the same text from this one source.
 */
export function renderVisualCheckDirective(): string {
  return [
    'Use this after you write or change the HTML deliverable in this turn. Skip it in turns that only plan, ask questions, or answer in prose.',
    '',
    '1. Run `"$OD_NODE_BIN" "$OD_BIN" tools screenshot --json`. With no file it checks this run\'s deliverable; pass a project-relative path to check another page.',
    '2. The answer lists `images` (PNG paths), `issues`, and `improvements`. If you can open image files, open every image. Always read both lists.',
    '3. Errors first: fix every issue with severity `error`. Fix a `warning` only when the image or the markup confirms it.',
    '4. Then improvements: apply the listed improvements that fit the brief and the active design system. If you opened the images, you may also make up to 3 improvements of your own, chosen only from: one clear focal point per screen; even spacing between sections; aligned edges; heading sizes that step down clearly; no section that looks empty or unfinished. Do not restyle beyond the brief, and never undo something the user explicitly asked for.',
    '5. Run the command again after your fixes. You get at most two re-checks per page; the command refuses further looks. Then finish.',
    '6. If `more.next` is set, run the command with `--range <next>` and handle that batch the same way.',
    '7. Add `--width 390` once when the brief is mobile-first or asks for a phone layout.',
    '8. If the command fails or is unavailable, finish with your static check. Do not mention the renderer, the screenshot, or the failure in your reply.',
    '9. After a successful check you may add one plain sentence about what you fixed. List bigger improvement ideas you did not apply in one short line for the user.',
  ].join('\n');
}
