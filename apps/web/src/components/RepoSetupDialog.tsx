import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
  Select,
  Textarea,
} from '@open-design/components';

import { useT } from '../i18n';
import type { SetupSuggestions } from '../providers/registry';
import styles from './RepoSetupDialog.module.css';

/** The answers to the three setup questions, as `.open-design.json` holds them. */
export interface RepoSetup {
  designFiles: string[];
  readFirst: string[];
  rules: string;
}

export interface RepoSetupDialogProps {
  open: boolean;
  /** Basename of the picked folder, shown in the title. */
  repoName: string;
  /** The daemon's guesses, or null while they are still being fetched. */
  suggestions: SetupSuggestions | null;
  loading: boolean;
  /** Prefill when editing a setup the user (or the repo) already has. */
  initial?: RepoSetup | null;
  onContinue: (setup: RepoSetup) => void;
  onNotNow: () => void;
}

/**
 * Sentinel value for the "Create a new folder…" option. Not a path, so it can
 * never collide with a real folder name in the select.
 */
const CREATE_FOLDER = '__create__';

/** Matches the daemon's own cap on the rules string. */
const RULES_MAX_LENGTH = 2000;

interface ReadFirstRow {
  path: string;
  reason: string;
  checked: boolean;
}

/** A new folder is one path segment, so slashes never make it into the name. */
function oneSegment(value: string): string {
  return value.replace(/[\\/]/g, '');
}

/**
 * Guards the "Create a new folder…" name: rejects empty/whitespace-only
 * input, any slash, `.` and `..`, and any dot-prefixed name (e.g. `.git`) —
 * none of those are a folder Open Design should create or write into.
 */
function isValidNewFolderName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/[\\/]/.test(trimmed)) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (trimmed.startsWith('.')) return false;
  return true;
}

function seedRows(suggestions: SetupSuggestions | null, initial?: RepoSetup | null): ReadFirstRow[] {
  const rows: ReadFirstRow[] = (suggestions?.readFirst ?? []).map((entry) => ({
    path: entry.path,
    reason: entry.reason,
    // Editing an existing setup: that setup's list decides the ticks, so a
    // file the user already dropped does not come back ticked every time.
    checked: initial ? initial.readFirst.includes(entry.path) : entry.checked !== false,
  }));
  for (const path of initial?.readFirst ?? []) {
    if (!rows.some((row) => row.path === path)) rows.push({ path, reason: '', checked: true });
  }
  return rows;
}

/**
 * The setup card (Screen A): the three questions asked once, when a repo is
 * pointed at Open Design — where designs live, what the agent reads first, and
 * the house rules. Every field opens pre-filled with the daemon's guess, so
 * accepting is one click and correcting is an edit rather than a form to fill.
 *
 * Presentational: it holds the edits and hands them back through `onContinue`.
 * Nothing here talks to the daemon, and nothing is written until the caller
 * carries this setup to the working-dir (or setup) call.
 */
export function RepoSetupDialog({
  open,
  repoName,
  suggestions,
  loading,
  initial,
  onContinue,
  onNotNow,
}: RepoSetupDialogProps) {
  const t = useT();
  const titleId = useId();
  const folderId = useId();
  const rulesId = useId();

  const [folder, setFolder] = useState('');
  const [newFolder, setNewFolder] = useState('');
  const [rows, setRows] = useState<ReadFirstRow[]>([]);
  const [rules, setRules] = useState('');
  const [addDraft, setAddDraft] = useState('');

  // Seed every field when the card opens, and again when a later answer from
  // the daemon (or a different setup to edit) actually changes. Keyed on the
  // *content* of suggestions/initial (via a ref, not the effect deps): a
  // caller that re-creates an equal object on every render — new identity,
  // same data — must not wipe the user's edits mid-typing.
  const seedKeyRef = useRef<string | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    if (!open) {
      openRef.current = open;
      return;
    }
    const seedKey = JSON.stringify({ s: suggestions, i: initial });
    const justOpened = !openRef.current;
    openRef.current = open;
    if (!justOpened && seedKey === seedKeyRef.current) return;
    seedKeyRef.current = seedKey;

    const candidates = suggestions?.designFolders ?? [];
    setFolder(initial?.designFiles[0] ?? candidates[0]?.path ?? CREATE_FOLDER);
    setNewFolder('');
    setRows(seedRows(suggestions, initial));
    setRules(initial?.rules ?? suggestions?.rulesDraft ?? '');
    setAddDraft('');
  }, [open, suggestions, initial]);

  if (!open) return null;

  const options = (suggestions?.designFolders ?? []).map((entry) => ({
    path: entry.path,
    reason: entry.reason,
  }));
  // A folder carried in from an existing setup may not be one the daemon
  // guessed; it still has to be selectable, so it leads the list.
  if (folder && folder !== CREATE_FOLDER && !options.some((o) => o.path === folder)) {
    options.unshift({ path: folder, reason: '' });
  }

  const creating = folder === CREATE_FOLDER;
  const designFolder = creating ? newFolder.trim() : folder;
  const canContinue =
    !loading && (creating ? isValidNewFolderName(newFolder) : designFolder.length > 0);

  function addFile() {
    const path = addDraft.trim().replace(/^\.\//, '').replace(/[\\/]+$/, '');
    if (!path) return;
    setAddDraft('');
    setRows((current) =>
      current.some((row) => row.path === path)
        ? current.map((row) => (row.path === path ? { ...row, checked: true } : row))
        : [...current, { path, reason: '', checked: true }],
    );
  }

  const dialog = (
    <Dialog
      className={styles.dialog}
      onClose={onNotNow}
      closeOnEscape
      ariaLabelledBy={titleId}
      data-testid="repo-setup-dialog"
    >
      <DialogTitle id={titleId}>{t('repoSetup.title', { name: repoName })}</DialogTitle>
      <DialogDescription>{t('repoSetup.lead')}</DialogDescription>

      {loading ? (
        <p className={styles.loading}>{t('repoSetup.loading')}</p>
      ) : (
        <div className={styles.body}>
          <section className={styles.section}>
            <label className={styles.label} htmlFor={folderId}>
              {t('repoSetup.designFolder')}
            </label>
            <Select
              id={folderId}
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              data-testid="repo-setup-folder"
            >
              {options.map((option) => (
                <option key={option.path} value={option.path}>
                  {option.reason ? `${option.path} — ${option.reason}` : option.path}
                </option>
              ))}
              <option value={CREATE_FOLDER}>{t('repoSetup.createFolder')}</option>
            </Select>
            {creating ? (
              <Input
                className={styles.newFolder}
                aria-label={t('repoSetup.createFolder')}
                value={newFolder}
                onChange={(event) => setNewFolder(oneSegment(event.target.value))}
                data-testid="repo-setup-new-folder"
              />
            ) : null}
          </section>

          <section className={styles.section}>
            <span className={styles.label}>{t('repoSetup.readFirst')}</span>
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.path}>
                  <label className={styles.row}>
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={() =>
                        setRows((current) =>
                          current.map((entry) =>
                            entry.path === row.path
                              ? { ...entry, checked: !entry.checked }
                              : entry,
                          ),
                        )
                      }
                    />
                    <span className={styles.rowPath}>{row.path}</span>
                    {row.reason ? <span className={styles.rowReason}>{row.reason}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
            <Input
              className={styles.addFile}
              placeholder={t('repoSetup.addFile')}
              aria-label={t('repoSetup.addFile')}
              value={addDraft}
              onChange={(event) => setAddDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addFile();
              }}
              data-testid="repo-setup-add-file"
            />
          </section>

          <section className={styles.section}>
            <label className={styles.label} htmlFor={rulesId}>
              {t('repoSetup.rules')}
            </label>
            <Textarea
              id={rulesId}
              rows={4}
              maxLength={RULES_MAX_LENGTH}
              value={rules}
              onChange={(event) => setRules(event.target.value)}
              data-testid="repo-setup-rules"
            />
          </section>
        </div>
      )}

      <p className={styles.finePrint}>{t('repoSetup.finePrint')}</p>

      <DialogFooter className={styles.actions}>
        <Button type="button" variant="default" onClick={onNotNow}>
          {t('repoSetup.notNow')}
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={!canContinue}
          onClick={() =>
            onContinue({
              designFiles: [designFolder],
              readFirst: rows.filter((row) => row.checked).map((row) => row.path),
              rules,
            })
          }
          data-testid="repo-setup-continue"
        >
          {t('repoSetup.continue')}
        </Button>
      </DialogFooter>
    </Dialog>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
}
