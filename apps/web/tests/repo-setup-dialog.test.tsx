// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { RepoSetupDialog } from '../src/components/RepoSetupDialog';
import type { SetupSuggestions } from '../src/providers/registry';

afterEach(() => {
  cleanup();
});

const RULES_DRAFT =
  'Designs live in PeeraneyERP_Design. Match the existing look. The UI is Thai.';

function suggestionsFixture(): SetupSuggestions {
  return {
    alreadyConfigured: false,
    existing: null,
    designFolders: [
      { path: 'PeeraneyERP_Design', reason: 'already holds 3 canvases' },
      { path: 'Design', reason: 'empty folder' },
    ],
    readFirst: [
      { path: 'CLAUDE.md', reason: 'project rules', checked: true },
      { path: 'PeeraneyERPVault/REQUIREMENTS.md', reason: 'linked from CLAUDE.md', checked: true },
      { path: 'README.md', reason: '', checked: false },
    ],
    rulesDraft: RULES_DRAFT,
  };
}

function renderDialog(overrides: Partial<ComponentProps<typeof RepoSetupDialog>> = {}) {
  const onContinue = vi.fn();
  const onNotNow = vi.fn();
  const result = render(
    <RepoSetupDialog
      open
      repoName="Peeraney-ERP"
      suggestions={suggestionsFixture()}
      loading={false}
      onContinue={onContinue}
      onNotNow={onNotNow}
      {...overrides}
    />,
  );
  return { onContinue, onNotNow, ...result };
}

function designFolderSelect(): HTMLSelectElement {
  return screen.getByLabelText('Where do designs live?') as HTMLSelectElement;
}

describe('RepoSetupDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('Set up Peeraney-ERP for designs')).toBeNull();
  });

  it('opens pre-filled from the suggestions and hands the answers to onContinue', () => {
    const { onContinue } = renderDialog();

    expect(screen.getByText('Set up Peeraney-ERP for designs')).toBeTruthy();
    expect(designFolderSelect().value).toBe('PeeraneyERP_Design');

    const claude = screen.getByRole('checkbox', { name: /^CLAUDE\.md/ }) as HTMLInputElement;
    const requirements = screen.getByRole('checkbox', {
      name: /^PeeraneyERPVault\/REQUIREMENTS\.md/,
    }) as HTMLInputElement;
    const readme = screen.getByRole('checkbox', { name: /^README\.md/ }) as HTMLInputElement;
    expect(claude.checked).toBe(true);
    expect(requirements.checked).toBe(true);
    expect(readme.checked).toBe(false);

    const rules = screen.getByLabelText('House rules for designing here') as HTMLTextAreaElement;
    expect(rules.value).toBe(RULES_DRAFT);
    expect(rules.maxLength).toBe(2000);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith({
      designFiles: ['PeeraneyERP_Design'],
      readFirst: ['CLAUDE.md', 'PeeraneyERPVault/REQUIREMENTS.md'],
      rules: RULES_DRAFT,
    });
  });

  it('dismisses through Not now without reporting a setup', () => {
    const { onContinue, onNotNow } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(onNotNow).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('carries the edited ticks, the added file and the edited rules', () => {
    const { onContinue } = renderDialog();

    fireEvent.click(screen.getByRole('checkbox', { name: /^PeeraneyERPVault\/REQUIREMENTS\.md/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^README\.md/ }));

    const addFile = screen.getByPlaceholderText('Add a file…');
    fireEvent.change(addFile, { target: { value: 'docs/brand.md' } });
    fireEvent.keyDown(addFile, { key: 'Enter' });
    expect((addFile as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('House rules for designing here'), {
      target: { value: 'Use the house palette.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onContinue).toHaveBeenCalledWith({
      designFiles: ['PeeraneyERP_Design'],
      readFirst: ['CLAUDE.md', 'README.md', 'docs/brand.md'],
      rules: 'Use the house palette.',
    });
  });

  it('takes a new folder name as one path segment and blocks Continue until it is typed', () => {
    const { onContinue } = renderDialog();

    fireEvent.change(designFolderSelect(), { target: { value: '__create__' } });

    const continueButton = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);

    const nameInput = screen.getByLabelText('Create a new folder…') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Design/Mockups' } });
    expect(nameInput.value).toBe('DesignMockups');

    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledWith({
      designFiles: ['DesignMockups'],
      readFirst: ['CLAUDE.md', 'PeeraneyERPVault/REQUIREMENTS.md'],
      rules: RULES_DRAFT,
    });
  });

  it('shows the looking-at-the-repo line while the suggestions are still loading', () => {
    renderDialog({ suggestions: null, loading: true });

    expect(screen.getByText('Looking at the repo…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('blocks Continue for dot and dot-prefixed new folder names', () => {
    renderDialog();

    fireEvent.change(designFolderSelect(), { target: { value: '__create__' } });

    const continueButton = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    const nameInput = screen.getByLabelText('Create a new folder…') as HTMLInputElement;

    fireEvent.change(nameInput, { target: { value: '..' } });
    expect(continueButton.disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: '.hidden' } });
    expect(continueButton.disabled).toBe(true);

    fireEvent.change(nameInput, { target: { value: 'Design' } });
    expect(continueButton.disabled).toBe(false);
  });

  it('keeps a typed edit across a re-render with a freshly-cloned but equal suggestions object', () => {
    const onContinue = vi.fn();
    const onNotNow = vi.fn();
    const { rerender } = render(
      <RepoSetupDialog
        open
        repoName="Peeraney-ERP"
        suggestions={suggestionsFixture()}
        loading={false}
        onContinue={onContinue}
        onNotNow={onNotNow}
      />,
    );

    fireEvent.change(screen.getByLabelText('House rules for designing here'), {
      target: { value: 'Use the house palette.' },
    });

    rerender(
      <RepoSetupDialog
        open
        repoName="Peeraney-ERP"
        suggestions={suggestionsFixture()}
        loading={false}
        onContinue={onContinue}
        onNotNow={onNotNow}
      />,
    );

    expect(
      (screen.getByLabelText('House rules for designing here') as HTMLTextAreaElement).value,
    ).toBe('Use the house palette.');
  });

  it('pre-fills from an existing setup when one is handed in', () => {
    const { onContinue } = renderDialog({
      initial: {
        designFiles: ['Artboards'],
        readFirst: ['README.md'],
        rules: 'Keep it plain.',
      },
    });

    expect(designFolderSelect().value).toBe('Artboards');
    expect((screen.getByRole('checkbox', { name: /^README\.md/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole('checkbox', { name: /^CLAUDE\.md/ }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(
      (screen.getByLabelText('House rules for designing here') as HTMLTextAreaElement).value,
    ).toBe('Keep it plain.');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith({
      designFiles: ['Artboards'],
      readFirst: ['README.md'],
      rules: 'Keep it plain.',
    });
  });
});
