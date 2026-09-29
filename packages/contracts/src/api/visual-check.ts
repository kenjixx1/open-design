/** Response of `POST /api/tools/visual-check` and `od tools screenshot --json`. */
export const VISUAL_CHECK_TOOL_SCHEMA = 'od.visual-check.v1';

export type VisualCheckSeverity = 'error' | 'warning' | 'suggestion';

export type VisualCheckIssueKind =
  | 'blank-page'
  | 'horizontal-overflow'
  | 'slide-overflow'
  | 'broken-image'
  | 'placeholder-text'
  | 'clipped-text'
  | 'overlapping-text'
  | 'console-error'
  | 'low-contrast'
  | 'tiny-text'
  | 'long-lines'
  | 'too-many-fonts'
  | 'blurry-image'
  | 'edge-crowding'
  | 'small-tap-target';

export interface VisualCheckIssue {
  kind: VisualCheckIssueKind;
  severity: VisualCheckSeverity;
  selector: string;
  text?: string;
  /** One plain sentence with real numbers. */
  detail: string;
}

export interface VisualCheckImage {
  kind: 'screen' | 'slide';
  /** 1-based screen or slide number. */
  n: number;
  /** Absolute path on the daemon host. Appears only in tool output, never in prompts. */
  path: string;
}

export interface VisualCheckMore {
  total: number;
  /** 1-based inclusive, e.g. "1-6". */
  captured: string;
  /** 1-based inclusive range for `--range`, or null when nothing is left. */
  next: string | null;
}

export type VisualCheckFailureCode =
  | 'RENDERER_UNAVAILABLE'
  | 'NOT_HTML'
  | 'FILE_NOT_FOUND'
  | 'NO_DELIVERABLE'
  | 'LOOK_BUDGET_SPENT'
  | 'RENDER_FAILED'
  | 'BAD_INPUT';

export interface VisualCheckToolSuccess {
  ok: true;
  schema: typeof VISUAL_CHECK_TOOL_SCHEMA;
  file: string;
  mode: 'page' | 'deck';
  width: number;
  images: VisualCheckImage[];
  checklist: 'measured' | 'unavailable';
  /** severity error | warning */
  issues: VisualCheckIssue[];
  /** severity suggestion */
  improvements: VisualCheckIssue[];
  more: VisualCheckMore | null;
  looksLeft: number;
}

export interface VisualCheckToolFailure {
  ok: false;
  schema: typeof VISUAL_CHECK_TOOL_SCHEMA;
  code: VisualCheckFailureCode;
  message: string;
}

export type VisualCheckToolResponse = VisualCheckToolSuccess | VisualCheckToolFailure;
