// @vitest-environment jsdom
//
// Home asks the three repo-setup questions right after a working directory is
// picked, then carries the answers into project creation. The card is a
// convenience, never a gate: an already-configured repo skips it, and a failed
// guess must not cost the user the folder they just chose.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: () => null,
}));

import { HomeView } from '../src/components/HomeView';
import { isOpenDesignHostAvailable, pickHostWorkingDir } from '@open-design/host';
import { fetchProjectSetupSuggestions, openFolderDialog } from '../src/providers/registry';
import { setHomeHeroPrompt } from './helpers/home-hero-lexical';

vi.mock('@open-design/host', async () => {
  const actual = await vi.importActual<typeof import('@open-design/host')>('@open-design/host');
  return {
    ...actual,
    isOpenDesignHostAvailable: vi.fn(),
    pickHostWorkingDir: vi.fn(),
  };
});

vi.mock('../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../src/providers/registry')>(
    '../src/providers/registry',
  );
  return {
    ...actual,
    openFolderDialog: vi.fn(),
    fetchProjectFiles: vi.fn().mockResolvedValue([]),
    fetchProjectSetupSuggestions: vi.fn(),
  };
});

const mockedIsHostAvailable = vi.mocked(isOpenDesignHostAvailable);
const mockedPickHostWorkingDir = vi.mocked(pickHostWorkingDir);
const mockedOpenFolderDialog = vi.mocked(openFolderDialog);
const mockedFetchSuggestions = vi.mocked(fetchProjectSetupSuggestions);

const FRESH_REPO = {
  alreadyConfigured: false,
  existing: null,
  designFolders: [
    { path: 'design', reason: 'existing folder' },
    { path: 'src/design', reason: 'source tree' },
  ],
  readFirst: [{ path: 'README.md', reason: 'project intro', checked: true }],
  rulesDraft: 'Use the tokens in theme.css.',
};

const CONFIGURED_REPO = {
  alreadyConfigured: true,
  existing: { designFiles: ['ui/design'], readFirst: ['README.md'], rules: 'Keep it flat.' },
  designFolders: [{ path: 'ui/design', reason: 'existing folder' }],
  readFirst: [],
  rulesDraft: '',
};

function renderHome(onSubmit: (payload: unknown) => void = () => undefined) {
  return render(
    <HomeView
      projects={[]}
      onSubmit={onSubmit}
      onOpenProject={() => undefined}
      onViewAllProjects={() => undefined}
    />,
  );
}

function pickFolder() {
  fireEvent.click(screen.getByTestId('working-dir-trigger'));
  fireEvent.click(screen.getByTestId('working-dir-pick'));
}

// Continue lights up only once the card has seeded itself from the daemon's
// guesses, so waiting on it is what proves the card is ready to accept.
async function acceptSetup() {
  const button = (await screen.findByTestId('repo-setup-continue')) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => {
    expect(screen.queryByTestId('repo-setup-dialog')).toBeNull();
  });
}

describe('Home repo setup after picking a working directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsHostAvailable.mockReturnValue(false);
    mockedOpenFolderDialog.mockResolvedValue('/Users/me/repo');
    mockedFetchSuggestions.mockResolvedValue(FRESH_REPO);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('opens the setup card for a fresh repo and labels the chip with the chosen folder', async () => {
    renderHome();
    pickFolder();

    await waitFor(() => {
      expect(screen.getByTestId('repo-setup-dialog')).toBeTruthy();
    });
    expect(mockedFetchSuggestions).toHaveBeenCalledWith('/Users/me/repo', undefined);

    await acceptSetup();
    expect(screen.getByTestId('working-dir-sublabel').textContent).toBe('designs in design');
  });

  it('skips the card for an already-configured repo and shows the folder it already uses', async () => {
    mockedFetchSuggestions.mockResolvedValue(CONFIGURED_REPO);

    renderHome();
    pickFolder();

    await waitFor(() => {
      expect(screen.getByTestId('working-dir-sublabel').textContent).toBe('designs in ui/design');
    });
    expect(screen.queryByTestId('repo-setup-dialog')).toBeNull();
  });

  it('keeps the picked folder when the suggestions request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockedFetchSuggestions.mockRejectedValue(new Error('daemon down'));

    renderHome();
    pickFolder();

    await waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('repo-setup-dialog')).toBeNull();
    expect(screen.queryByTestId('working-dir-sublabel')).toBeNull();
    expect(screen.getByTestId('working-dir-trigger').textContent).toContain('repo');
    warn.mockRestore();
  });

  it('spends the desktop token on the suggestions call and still opens the card', async () => {
    mockedIsHostAvailable.mockReturnValue(true);
    mockedPickHostWorkingDir.mockResolvedValue({
      ok: true,
      baseDir: '/Users/me/desktop-repo',
      token: 'wd-token',
    });

    renderHome();
    pickFolder();

    await waitFor(() => {
      expect(screen.getByTestId('repo-setup-dialog')).toBeTruthy();
    });
    expect(mockedFetchSuggestions).toHaveBeenCalledWith('/Users/me/desktop-repo', 'wd-token');
    expect(mockedOpenFolderDialog).not.toHaveBeenCalled();
  });

  it('reopens the card from "Edit project rules…" and clears everything on clear', async () => {
    renderHome();
    pickFolder();

    await waitFor(() => {
      expect(screen.getByTestId('repo-setup-dialog')).toBeTruthy();
    });
    await acceptSetup();

    fireEvent.click(screen.getByTestId('working-dir-trigger'));
    fireEvent.click(screen.getByTestId('working-dir-edit-rules'));
    await waitFor(() => {
      expect(screen.getByTestId('repo-setup-dialog')).toBeTruthy();
    });

    // "Not now" on the re-opened card drops the setup again, so the chip goes
    // back to the plain folder name.
    fireEvent.click(screen.getByText('Not now'));
    await waitFor(() => {
      expect(screen.queryByTestId('working-dir-sublabel')).toBeNull();
    });

    fireEvent.click(screen.getByTestId('working-dir-trigger'));
    fireEvent.click(screen.getByTestId('working-dir-clear'));
    expect(screen.queryByTestId('working-dir-sublabel')).toBeNull();
    fireEvent.click(screen.getByTestId('working-dir-trigger'));
    expect(screen.queryByTestId('working-dir-edit-rules')).toBeNull();
  });

  it('drops a guess that lands after the folder was cleared', async () => {
    let resolveSuggestions: (value: typeof FRESH_REPO) => void = () => undefined;
    // `…Once`, so the held-open promise belongs to this test alone and the
    // default guess is back in place for whatever runs next.
    mockedFetchSuggestions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSuggestions = resolve;
        }),
    );

    renderHome();
    pickFolder();
    await waitFor(() => expect(mockedFetchSuggestions).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('working-dir-trigger'));
    fireEvent.click(screen.getByTestId('working-dir-clear'));
    await act(async () => {
      resolveSuggestions(FRESH_REPO);
    });

    expect(screen.queryByTestId('repo-setup-dialog')).toBeNull();
    // The folder is gone, so the chip is back to its empty state.
    expect(screen.queryByTestId('working-dir-sublabel')).toBeNull();
  });

  it('carries the accepted setup in the create payload', async () => {
    const onSubmit = vi.fn();
    renderHome(onSubmit);
    pickFolder();

    await waitFor(() => {
      expect(screen.getByTestId('repo-setup-dialog')).toBeTruthy();
    });
    await acceptSetup();

    // `home-hero-input` is a Lexical contenteditable, so the prompt goes in
    // through the live editor rather than a synthetic change event.
    await screen.findByTestId('home-hero-input');
    setHomeHeroPrompt('Design a settings page');
    const submit = await screen.findByTestId('home-hero-submit');
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const [payload] = onSubmit.mock.calls[0] as [Record<string, unknown>];
    expect(payload.workingDir).toBe('/Users/me/repo');
    expect(payload.workingDirSetup).toEqual({
      designFiles: ['design'],
      readFirst: ['README.md'],
      rules: 'Use the tokens in theme.css.',
    });
  });
});
