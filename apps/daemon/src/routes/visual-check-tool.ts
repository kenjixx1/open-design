import fs from 'node:fs/promises';

import {
  VISUAL_CHECK_TOOL_SCHEMA,
  type VisualCheckFailureCode,
  type VisualCheckImage,
  type VisualCheckMore,
  type VisualCheckToolResponse,
} from '@open-design/contracts';
import {
  VISUAL_CHECK_MAX_SCREENS,
  VISUAL_CHECK_MAX_SLIDES,
  type DesktopRenderRange,
  type DesktopRenderSlidesInput,
  type DesktopRenderSlidesResult,
} from '@open-design/sidecar-proto';
import type { Express, Request, Response } from 'express';

import { buildDeckRenderInput } from '../deck-export.js';
import { sendApiError } from '../http/api-errors.js';
import { projectPreviewBaseHref } from '../preview-base-href.js';
import { readProjectFile } from '../projects.js';
import { validateRunDeliverable } from '../run-deliverable-validation.js';
import { analyzeVisualFacts } from '../visual-check/analyze.js';
import { createCheckDir, pruneVisualChecks } from '../visual-check/storage.js';

export { VISUAL_CHECK_TOOL_ENDPOINT } from '../tool-tokens.js';
export const VISUAL_CHECK_LOOK_BUDGET = 3;
export const VISUAL_CHECK_PREVIEW_SCOPE_TTL_MS = 610_000;
const DEFAULT_WIDTH = 1440;

type PreviewWorkspace = { workspaceId: string; workspaceMemberId: string } | null;

export interface RegisterVisualCheckToolRoutesDeps {
  projectsRoot: string;
  visualChecksRoot: string;
  daemonUrl(): string;
  authorizeToolRequest(req: Request, res: Response, operation: string): { runId: string; projectId: string } | null;
  authorizeProjectToolRequest(res: Response, projectId: string, access: { mode: 'read' }): Promise<{ workspace: PreviewWorkspace } | null>;
  getProject(projectId: string): { metadata?: Record<string, unknown> | null } | null;
  isAvailable(): Promise<boolean>;
  renderSlides: ((input: DesktopRenderSlidesInput) => Promise<DesktopRenderSlidesResult>) | null;
  mintPreviewScope(projectId: string, workspace: PreviewWorkspace): string;
  revokePreviewScope(scope: string): void;
}

/** Page vs deck: explicit flag, else the host deck contract markers, else project kind. */
export function decideDeck(input: { html: string; projectKind: unknown; override: unknown }): boolean {
  if (typeof input.override === 'boolean') return input.override;
  if (/data-od-deck-protocol\s*=\s*["']?1/i.test(input.html)) return true;
  if (/\bid\s*=\s*["']deck-stage["']/i.test(input.html)) return true;
  return input.projectKind === 'deck';
}

function fail(res: Response, code: VisualCheckFailureCode, message: string): void {
  const body: VisualCheckToolResponse = { ok: false, schema: VISUAL_CHECK_TOOL_SCHEMA, code, message };
  res.json(body);
}

function parseBody(raw: unknown):
  | { file?: string; width: number; range?: DesktopRenderRange; deck?: boolean }
  | { error: string } {
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: { file?: string; width: number; range?: DesktopRenderRange; deck?: boolean } = { width: DEFAULT_WIDTH };
  if (body.file != null) {
    if (typeof body.file !== 'string' || !body.file.trim()) return { error: 'file must be a non-empty project-relative path' };
    out.file = body.file.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  }
  if (body.width != null) {
    if (typeof body.width !== 'number' || !Number.isInteger(body.width) || body.width < 320 || body.width > 3840) {
      return { error: 'width must be an integer from 320 to 3840' };
    }
    out.width = body.width;
  }
  if (body.range != null) {
    const r = body.range as Record<string, unknown>;
    if (
      typeof r !== 'object'
      || typeof r.start !== 'number' || !Number.isInteger(r.start) || r.start < 0
      || typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 1 || r.count > VISUAL_CHECK_MAX_SLIDES
    ) {
      return { error: 'range must be { start >= 0, count 1..12 }' };
    }
    out.range = { start: r.start, count: r.count };
  }
  if (body.deck != null) {
    if (typeof body.deck !== 'boolean') return { error: 'deck must be true or false' };
    out.deck = body.deck;
  }
  return out;
}

function more(indices: number[], total: number | undefined, max: number): VisualCheckMore | null {
  if (!indices.length || total == null) return null;
  const first = indices[0]!;
  const last = indices[indices.length - 1]!;
  const next = last + 1 < total ? `${last + 2}-${Math.min(total, last + 1 + max)}` : null;
  return { total, captured: `${first + 1}-${last + 1}`, next };
}

export function registerVisualCheckToolRoutes(app: Express, deps: RegisterVisualCheckToolRoutesDeps): void {
  const looks = new Map<string, number>();
  const seqByRun = new Map<string, number>();

  app.post('/api/tools/visual-check', async (req, res) => {
    const grant = deps.authorizeToolRequest(req, res, 'visual-check:run');
    if (!grant) return;
    const authority = await deps.authorizeProjectToolRequest(res, grant.projectId, { mode: 'read' });
    if (!authority) return;
    const project = deps.getProject(grant.projectId);
    if (!project) {
      sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return;
    }
    const parsed = parseBody(req.body);
    if ('error' in parsed) return fail(res, 'BAD_INPUT', parsed.error);

    if (!deps.renderSlides || !(await deps.isAvailable())) {
      return fail(res, 'RENDERER_UNAVAILABLE', 'No desktop renderer is attached. Finish with your static check.');
    }

    const metadata = project.metadata ?? null;
    let file = parsed.file;
    if (!file) {
      const deliverable = await validateRunDeliverable({
        projectsRoot: deps.projectsRoot,
        projectId: grant.projectId,
        ...(metadata ? { projectMetadata: metadata } : {}),
        runStatus: 'succeeded',
        artifactCount: 1,
      });
      if (!deliverable.valid || !deliverable.entryFile) {
        return fail(res, 'NO_DELIVERABLE', 'No HTML deliverable found yet. Pass a file path.');
      }
      file = deliverable.entryFile;
    }
    if (!/\.html?$/i.test(file)) return fail(res, 'NOT_HTML', `${file} is not an HTML file.`);

    let html: string;
    try {
      html = (await readProjectFile(deps.projectsRoot, grant.projectId, file, metadata ?? undefined)).buffer.toString('utf8');
    } catch {
      return fail(res, 'FILE_NOT_FOUND', `${file} was not found in this project.`);
    }

    const deck = decideDeck({ html, projectKind: metadata?.kind, override: parsed.deck });
    const width = deck ? DEFAULT_WIDTH : parsed.width;
    const key = `${grant.runId}|${file}|${width}|${parsed.range?.start ?? 0}`;
    const used = looks.get(key) ?? 0;
    if (used >= VISUAL_CHECK_LOOK_BUDGET) {
      return fail(res, 'LOOK_BUDGET_SPENT', 'This page was already checked 3 times in this run. Finish now.');
    }
    looks.set(key, used + 1);
    if (looks.size > 2000) looks.delete(looks.keys().next().value as string);

    const seq = (seqByRun.get(grant.runId) ?? 0) + 1;
    seqByRun.set(grant.runId, seq);
    if (seqByRun.size > 500) seqByRun.delete(seqByRun.keys().next().value as string);
    const outputDir = await createCheckDir(deps.visualChecksRoot, grant.projectId, grant.runId, seq, file);

    const scope = deps.mintPreviewScope(grant.projectId, authority.workspace);
    let rendered: DesktopRenderSlidesResult;
    try {
      const { input } = await buildDeckRenderInput({
        baseHref: projectPreviewBaseHref(deps.daemonUrl(), grant.projectId, file, scope),
        daemonUrl: deps.daemonUrl(),
        deck,
        fileName: file,
        inspect: true,
        metadata,
        outputDir,
        projectId: grant.projectId,
        projectsRoot: deps.projectsRoot,
        sourceHtml: html,
        ...(parsed.range ? { range: parsed.range } : {}),
        ...(deck ? {} : { width }),
      });
      rendered = await deps.renderSlides(input);
    } catch (err) {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
      return fail(res, 'RENDERER_UNAVAILABLE', `The desktop renderer did not answer (${err instanceof Error ? err.message : String(err)}). Finish with your static check.`);
    } finally {
      deps.revokePreviewScope(scope);
    }

    if (!rendered.ok || !rendered.slideFiles?.length) {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
      return fail(res, 'RENDER_FAILED', rendered.error ?? 'The renderer returned no images.');
    }

    const mode = rendered.mode === 'deck' ? 'deck' : 'page';
    const indices = rendered.indices ?? rendered.slideFiles.map((_, i) => i);
    const images: VisualCheckImage[] = rendered.slideFiles.map((p, i) => ({
      kind: mode === 'deck' ? 'slide' : 'screen',
      n: (indices[i] ?? i) + 1,
      path: p,
    }));
    const analysis = rendered.visualFacts
      ? analyzeVisualFacts({ facts: rendered.visualFacts, mode, width })
      : { issues: [], improvements: [] };

    void pruneVisualChecks(deps.visualChecksRoot).catch(() => {});

    const body: VisualCheckToolResponse = {
      ok: true,
      schema: VISUAL_CHECK_TOOL_SCHEMA,
      file,
      mode,
      width,
      images,
      checklist: rendered.visualFacts ? 'measured' : 'unavailable',
      issues: analysis.issues,
      improvements: analysis.improvements,
      more: more(indices, rendered.total, mode === 'deck' ? VISUAL_CHECK_MAX_SLIDES : VISUAL_CHECK_MAX_SCREENS),
      looksLeft: VISUAL_CHECK_LOOK_BUDGET - (used + 1),
    };
    res.json(body);
  });
}
