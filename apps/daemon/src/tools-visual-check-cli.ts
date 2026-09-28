const USAGE = `Usage:
  od tools screenshot [file] [--width N] [--range A-B] [--deck|--page] [--json]

Photographs an HTML page of this run's project in the desktop renderer and
prints JSON: PNG paths, measured issues, and improvement ideas.

  file          project-relative path; default: this run's deliverable
  --width N     viewport width in CSS px (320-3840, default 1440; 390 = phone)
  --range A-B   1-based screens (page) or slides (deck), e.g. 7-12
  --deck        treat the file as a slide deck
  --page        treat the file as a scrolling page

Agent runtime invocation:
  "$OD_NODE_BIN" "$OD_BIN" tools screenshot --json
`;

type Body = { file?: string; width?: number; range?: { start: number; count: number }; deck?: boolean };

export function parseVisualCheckArgs(args: string[]): { help: true } | { error: string } | { body: Body } {
  const body: Body = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '-h' || arg === '--help') return { help: true };
    if (arg === '--json') continue;
    if (arg === '--width') {
      const raw = args[++i];
      const n = raw != null ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 320 || n > 3840) return { error: '--width needs an integer from 320 to 3840' };
      body.width = n;
      continue;
    }
    if (arg === '--range') {
      const m = /^(\d+)-(\d+)$/.exec(args[++i] ?? '');
      if (!m) return { error: '--range needs A-B, for example 7-12' };
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < 1 || b < a || b - a + 1 > 12) return { error: '--range must start at 1 or more and cover at most 12' };
      body.range = { start: a - 1, count: b - a + 1 };
      continue;
    }
    if (arg === '--deck' || arg === '--page') {
      const deck = arg === '--deck';
      if (body.deck !== undefined && body.deck !== deck) return { error: 'use either --deck or --page, not both' };
      body.deck = deck;
      continue;
    }
    if (arg.startsWith('-')) return { error: `unknown option: ${arg}` };
    if (body.file !== undefined) return { error: 'only one file may be given' };
    body.file = arg;
  }
  return { body };
}

function writeJson(value: unknown, stream: NodeJS.WriteStream): void {
  stream.write(`${JSON.stringify(value)}\n`);
}

function failure(message: string, extra: Record<string, unknown> = {}): { exitCode: number } {
  writeJson({ ok: false, error: { message, ...extra } }, process.stderr);
  return { exitCode: 1 };
}

export async function runVisualCheckToolCli(args: string[]): Promise<{ exitCode: number }> {
  const parsed = parseVisualCheckArgs(args);
  if ('help' in parsed) {
    process.stdout.write(USAGE);
    return { exitCode: 0 };
  }
  if ('error' in parsed) return failure(parsed.error);

  const rawUrl = process.env.OD_DAEMON_URL;
  if (!rawUrl) return failure('OD_DAEMON_URL is required');
  const token = process.env.OD_TOOL_TOKEN;
  if (!token) return failure('OD_TOOL_TOKEN is required');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return failure('OD_DAEMON_URL must be a valid URL');
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/api/tools/visual-check`;
  url.search = '';
  url.hash = '';

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.body),
    });
  } catch (error) {
    return failure(`daemon unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    const raw = body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : body;
    const err = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : { message: String(raw) };
    return failure(typeof err.message === 'string' ? err.message : 'request failed', typeof err.code === 'string' ? { code: err.code } : {});
  }
  writeJson(body, process.stdout);
  return { exitCode: body && typeof body === 'object' && (body as { ok?: unknown }).ok === true ? 0 : 2 };
}
