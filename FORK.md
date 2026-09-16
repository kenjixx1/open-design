# This is Kenji's tweaked Open Design

This checkout is a **fork of [nexu-io/open-design](https://github.com/nexu-io/open-design)**, not the
stock app. It exists so a design tool can sit in the middle of a coding workflow:
pick a repo, let the agent read that repo's rules, design inside it, save the
canvases next to the code.

- Fork: `kenjixx1/open-design`, branch `feat/working-dir-is-project-root` (origin).
- Upstream: `nexu-io/open-design` (remote `upstream`), base tag `open-design-v0.22.1`.
- Run: `./od-v0.sh start` (Electron window) · `./od-v0.sh web` (browser only) · `./od-v0.sh stop`.
  Icons: `~/Applications/OpenDesign v0.app` and `Stop OpenDesign v0.app`.
- Data lives in `~/.open-design-dev`, separate from the stock app's data.
- Update from upstream: `git fetch upstream && git rebase upstream/main`, then restart.

## What is different from stock (and why)

| Area | Change | Why |
|---|---|---|
| Home "Working directory" chip | Sets the project's folder (`metadata.baseDir`) instead of a read-only reference | Stock's modal with this option had lost its entry points; the chip is the door users actually find. `apps/web/src/components/EntryShell.tsx` |
| Desktop trust token | Lives 30 minutes, not 60 seconds; recent-folder clicks reopen the native picker | You type a prompt after picking; the token must survive that. `desktop-auth.ts`, desktop `runtime.ts`, sidecar `server.ts` |
| `.open-design.json` in a repo root | `{ designFiles, readFirst, rules }` scopes Design Files and the run diff, and its rules go into **every** runtime's prompt | Rules must reach Codex, Claude, DeepSeek, BYOK alike; AGENTS.md/CLAUDE.md are never written by the app. `project-scope.ts`, `project-rules-prompt.ts` |
| Repo setup dialog | After picking a folder, one dialog guesses design folder, read-first files, rules; Continue writes the file at project creation | No terminal, no hand-written config. `RepoSetupDialog.tsx`, `project-setup*.ts`, routes in `import-export-routes.ts` |
| Deliverable check | Accepts `<designFolder>/index.html` (or a single html there) as the runnable entry | Stock only looks at the repo root, which the scope hides. `run-deliverable-validation.ts` |
| Produced-files baseline | Not computed until the file list has loaded | First message of a folder project used an empty baseline and listed every repo file as "created". `ProjectView.tsx` |
| Linked directories → Codex | `OD_LINKED_DIRS` env (JSON keyed by `linked-dir:N`) | Stock passes nothing to Codex under OD Next (no `--add-dir`, alias only in prompt). Candidate upstream PR. |
| Agent-declared block | A prose answer with no deliverable stays a green, finished turn | Otherwise every question shows "Run failed". (In progress; see git log.) |

## Rules for working in this fork

- Keep every change a **small, additive commit** on top of upstream so `git rebase upstream/main` stays easy.
- Commit messages: plain sentence, ≤72 chars, no type prefix, **no trailers** (upstream rule).
- Never write the user's rules files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) from the app; only `.open-design.json`, two `.gitignore` lines, and the design folder.
- Never put an absolute path into any prompt bundle text; paths are repo-relative.
- Test before restart: `pnpm --filter @open-design/daemon exec vitest run <files>`, `pnpm --filter @open-design/web exec vitest run <files>`, `pnpm -r --if-present run typecheck`.
- Plans, briefs, and the progress ledger for the fork's own features live in `.plans/` and `.superpowers/` (git-excluded).

The upstream `AGENTS.md` below this banner is unchanged and still describes the codebase.
