import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseVisualCheckArgs, runVisualCheckToolCli } from '../src/tools-visual-check-cli.js';

describe('parseVisualCheckArgs', () => {
  it('parses file, width, range, and mode flags', () => {
    expect(parseVisualCheckArgs(['design/index.html', '--width', '390', '--range', '7-12', '--page', '--json'])).toEqual({
      body: { file: 'design/index.html', width: 390, range: { start: 6, count: 6 }, deck: false },
    });
    expect(parseVisualCheckArgs(['--deck'])).toEqual({ body: { deck: true } });
    expect(parseVisualCheckArgs([])).toEqual({ body: {} });
    expect(parseVisualCheckArgs(['--help'])).toEqual({ help: true });
  });

  it.each([
    [['--width']],
    [['--width', 'wide']],
    [['--range', '5']],
    [['--range', '0-3']],
    [['--range', '9-4']],
    [['--range', '1-13']],
    [['--deck', '--page']],
    [['a.html', 'b.html']],
    [['--bogus']],
  ])('rejects %j', (args) => {
    expect(parseVisualCheckArgs(args)).toHaveProperty('error');
  });
});

describe('runVisualCheckToolCli', () => {
  let out = '';
  let err = '';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { out += String(chunk); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { err += String(chunk); return true; });
    vi.stubEnv('OD_DAEMON_URL', 'http://127.0.0.1:7456');
    vi.stubEnv('OD_TOOL_TOKEN', 'secret-token');
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, schema: 'od.visual-check.v1', images: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posts the parsed body with the bearer token and prints the JSON', async () => {
    const result = await runVisualCheckToolCli(['index.html', '--width', '390']);
    expect(result.exitCode).toBe(0);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:7456/api/tools/visual-check');
    expect(init.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(init.body)).toEqual({ file: 'index.html', width: 390 });
    expect(JSON.parse(out)).toMatchObject({ ok: true });
    expect(out + err).not.toContain('secret-token');
  });

  it('exits 2 on a tool outcome failure and still prints to stdout', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, code: 'LOOK_BUDGET_SPENT', message: 'done' }), { status: 200 }));
    const result = await runVisualCheckToolCli([]);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(out)).toMatchObject({ code: 'LOOK_BUDGET_SPENT' });
  });

  it('exits 1 when the token is missing', async () => {
    vi.stubEnv('OD_TOOL_TOKEN', '');
    const result = await runVisualCheckToolCli([]);
    expect(result.exitCode).toBe(1);
    expect(err).toContain('OD_TOOL_TOKEN is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 1 on an HTTP error', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'nope' } }), { status: 403 }));
    const result = await runVisualCheckToolCli([]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(err)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });

  it('prints usage for --help', async () => {
    const result = await runVisualCheckToolCli(['--help']);
    expect(result.exitCode).toBe(0);
    expect(out).toContain('od tools screenshot [file]');
  });
});
