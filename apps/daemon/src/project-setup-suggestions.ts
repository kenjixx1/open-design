// Guess a folder's Open Design setup before the user is asked to confirm it.
//
// Pointing an existing repo at Open Design raises three questions: where do
// the designs go, what should an agent read before it draws anything, and what
// house rules apply. Asking a person to answer all three from an empty form is
// the friction that stops setup happening at all, so the daemon reads the
// folder and proposes an answer to each one. Every entry here is a *guess* the
// setup card renders as an editable, tickable row — nothing is written, and
// `applyProjectSetup` (project-setup.ts) is the only thing that touches disk.
//
// The guesses:
//   - designFolders — folders that already hold `*.dc.html` canvases win,
//     ranked by how many; then folders merely *named* like design folders;
//     then, for a repo with neither, a `Design` folder that does not exist yet.
//   - readFirst — the agent instruction files and the README, plus any repo
//     file CLAUDE.md (or AGENTS.md) points at, since a rules file that says
//     "read the spec first" is telling us exactly that.
//   - rulesDraft — one sentence of house rules, using the recommended folder,
//     and mentioning a Thai UI when the repo's own prose is written in Thai.
//
// Read-only. Every returned `path` is repo-relative: an absolute path here
// would leak the user's home directory into a config file meant to be
// committed.
import fs from 'node:fs';
import path from 'node:path';

import { isIgnoredProjectDirName } from './project-ignored-dirs.js';
import { readFullProjectScope, type ProjectScope } from './project-scope.js';

const CANVAS_SUFFIX = '.dc.html';
/** How deep below a top-level folder to look for canvases before giving up. */
const CANVAS_SCAN_MAX_DEPTH = 3;
const DEFAULT_DESIGN_FOLDER = 'Design';
const MAX_DESIGN_FOLDERS = 5;
const MAX_READ_FIRST = 8;

/** Top-level folder names that mean "designs live here" even when empty. */
const DESIGN_FOLDER_NAMES = new Set([
  'design',
  'designs',
  'mockups',
  'mockup',
  'ui',
  'figma',
  'wireframes',
]);

interface ReadFirstCandidate {
  name: string;
  kind: 'file' | 'dir';
  reason: string;
  checked: boolean;
}

// Order matters: this is the order the rows appear in the setup card.
const READ_FIRST_CANDIDATES: ReadFirstCandidate[] = [
  { name: 'CLAUDE.md', kind: 'file', reason: 'project rules', checked: true },
  { name: 'AGENTS.md', kind: 'file', reason: 'project rules', checked: true },
  { name: 'GEMINI.md', kind: 'file', reason: 'project rules', checked: false },
  { name: 'README.md', kind: 'file', reason: '', checked: false },
  { name: 'docs', kind: 'dir', reason: 'documentation folder', checked: false },
];

/** The files whose prose decides whether this project's UI is Thai. */
const THAI_SOURCE_FILES = ['CLAUDE.md', 'AGENTS.md', 'README.md'];
/** The Thai Unicode block (U+0E00–U+0E7F). */
const THAI_RE = /[฀-๿]/;

/** Backticked paths (`docs/REQ.md`) and markdown link targets (`](docs/REQ.md)`). */
const BACKTICK_RE = /`([^`\n]+)`/g;
const MD_LINK_RE = /\]\(([^)\s]+)\)/g;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** One proposed row in the setup card: a path, why it is proposed, and a tick. */
export interface SetupSuggestion {
  path: string;
  reason: string;
  checked?: boolean;
}

export interface SetupSuggestions {
  /** True when `.open-design.json` already exists — the card shows a re-run. */
  alreadyConfigured: boolean;
  /** The scope already on disk, so the card can pre-fill from it. */
  existing: ProjectScope | null;
  /** At most 5; the first is the recommendation. */
  designFolders: SetupSuggestion[];
  /** At most 8, each with an explicit `checked` default. */
  readFirst: SetupSuggestion[];
  rulesDraft: string;
}

function canvasCountReason(count: number): string {
  return count === 1 ? 'already holds 1 canvas' : `already holds ${count} canvases`;
}

function fileCountReason(count: number): string {
  if (count === 0) return 'empty folder';
  return count === 1 ? '1 file' : `${count} files`;
}

async function readDirEntries(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** True for trees that are generated, installed, or hidden — never designs. */
function isSkippableDirName(name: string): boolean {
  return name.startsWith('.') || isIgnoredProjectDirName(name);
}

/** How many `*.dc.html` files live in `dir`, looking at most 3 levels down. */
async function countCanvases(dir: string, depth: number): Promise<number> {
  if (depth > CANVAS_SCAN_MAX_DEPTH) return 0;
  let count = 0;
  for (const entry of await readDirEntries(dir)) {
    if (entry.isDirectory()) {
      if (isSkippableDirName(entry.name)) continue;
      count += await countCanvases(path.join(dir, entry.name), depth + 1);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(CANVAS_SUFFIX)) {
      count += 1;
    }
  }
  return count;
}

async function suggestDesignFolders(rootDir: string): Promise<SetupSuggestion[]> {
  const topLevelDirs = (await readDirEntries(rootDir))
    .filter((entry) => entry.isDirectory() && !isSkippableDirName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const withCanvases: { name: string; count: number }[] = [];
  const namedLikeDesign: string[] = [];
  for (const name of topLevelDirs) {
    const count = await countCanvases(path.join(rootDir, name), 1);
    if (count > 0) withCanvases.push({ name, count });
    else if (DESIGN_FOLDER_NAMES.has(name.toLowerCase())) namedLikeDesign.push(name);
  }
  // Most canvases first; ties keep the alphabetical order they arrived in.
  withCanvases.sort((a, b) => b.count - a.count);

  const suggestions: SetupSuggestion[] = withCanvases.map(({ name, count }) => ({
    path: name,
    reason: canvasCountReason(count),
  }));
  for (const name of namedLikeDesign) {
    const entries = await readDirEntries(path.join(rootDir, name));
    suggestions.push({ path: name, reason: fileCountReason(entries.length) });
  }

  if (suggestions.length === 0) {
    return [{ path: DEFAULT_DESIGN_FOLDER, reason: 'will be created' }];
  }
  return suggestions.slice(0, MAX_DESIGN_FOLDERS);
}

async function readTextFile(file: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Paths a rules file points at, as raw (unvalidated) strings. */
function extractLinkedPaths(text: string): string[] {
  const found: string[] = [];
  for (const re of [BACKTICK_RE, MD_LINK_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const raw = match[1]?.trim();
      if (raw) found.push(raw);
    }
  }
  return found;
}

/**
 * A raw link turned into a repo-relative file path, or null. Rejects URLs,
 * anchors, absolute paths, anything with a `..` segment, anything that is not
 * an existing file, and anything whose real path escapes the root via a
 * symlink.
 */
async function resolveLinkedPath(
  realRoot: string,
  raw: string,
): Promise<string | null> {
  if (!raw || raw.startsWith('#') || URL_SCHEME_RE.test(raw)) return null;
  const cleaned = raw.replace(/^\.\//, '');
  if (!cleaned || path.isAbsolute(cleaned) || cleaned.startsWith('/')) return null;
  const segments = cleaned.split(/[\\/]/);
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  const relative = segments.join('/');
  const absolute = path.join(realRoot, ...segments);
  try {
    if (!(await fs.promises.stat(absolute)).isFile()) return null;
    const real = await fs.promises.realpath(absolute);
    if (real !== absolute && !real.startsWith(realRoot + path.sep)) return null;
  } catch {
    return null;
  }
  return relative;
}

async function suggestReadFirst(
  rootDir: string,
  realRoot: string,
  rulesText: Map<string, string>,
): Promise<SetupSuggestion[]> {
  const suggestions: SetupSuggestion[] = [];
  const present = new Set<string>();

  for (const candidate of READ_FIRST_CANDIDATES) {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(path.join(rootDir, candidate.name));
    } catch {
      continue;
    }
    if (candidate.kind === 'file' ? !stat.isFile() : !stat.isDirectory()) continue;
    present.add(candidate.name);
    suggestions.push({
      path: candidate.name,
      reason: candidate.reason,
      checked: candidate.checked,
    });
  }

  // Reading AGENTS.md after CLAUDE.md buys nothing when they are the same
  // bytes — a very common repo shape — so untick the copy and say why.
  const claude = rulesText.get('CLAUDE.md');
  const agents = rulesText.get('AGENTS.md');
  if (claude != null && agents != null && claude === agents) {
    const duplicate = suggestions.find((s) => s.path === 'AGENTS.md');
    if (duplicate) {
      duplicate.reason = 'same content as CLAUDE.md';
      duplicate.checked = false;
    }
  }

  // A rules file that names a spec is telling us to read the spec.
  const linkSource = claude != null ? 'CLAUDE.md' : agents != null ? 'AGENTS.md' : null;
  const linkText = linkSource != null ? rulesText.get(linkSource) : null;
  if (linkSource != null && linkText) {
    for (const raw of extractLinkedPaths(linkText)) {
      if (suggestions.length >= MAX_READ_FIRST) break;
      const resolved = await resolveLinkedPath(realRoot, raw);
      if (resolved == null || present.has(resolved)) continue;
      present.add(resolved);
      suggestions.push({
        path: resolved,
        reason: `linked from ${linkSource}`,
        checked: true,
      });
    }
  }

  return suggestions.slice(0, MAX_READ_FIRST);
}

function draftRules(designFolder: string, thai: boolean): string {
  return [
    `Save every design in ${designFolder} as <Screen> - <Mobile|Web>.dc.html.`,
    'Never edit app code from a design session.',
    `${thai ? 'Thai UI, r' : 'R'}eal names and data from the project docs, never lorem.`,
  ].join(' ');
}

/**
 * Read `rootDir` and propose a setup for it. Never writes, never throws for an
 * unreadable folder — an empty repo is a legitimate answer, not an error.
 */
export async function suggestProjectSetup(rootDir: string): Promise<SetupSuggestions> {
  let realRoot = rootDir;
  try {
    realRoot = await fs.promises.realpath(rootDir);
  } catch {
    realRoot = rootDir;
  }

  const rulesText = new Map<string, string>();
  for (const name of THAI_SOURCE_FILES) {
    const text = await readTextFile(path.join(rootDir, name));
    if (text != null) rulesText.set(name, text);
  }

  const existing = await readFullProjectScope(rootDir);
  const designFolders = await suggestDesignFolders(rootDir);
  const readFirst = await suggestReadFirst(rootDir, realRoot, rulesText);
  const thai = [...rulesText.values()].some((text) => THAI_RE.test(text));

  return {
    alreadyConfigured: existing !== null,
    existing,
    designFolders,
    readFirst,
    rulesDraft: draftRules(designFolders[0]?.path ?? DEFAULT_DESIGN_FOLDER, thai),
  };
}
