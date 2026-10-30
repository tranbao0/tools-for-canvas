// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../../weekly-list/model/types';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { SettingsFields } from '../../weekly-list/ui/Settings';
import { DeveloperSection } from './DeveloperSection';

beforeEach(() => fakeBrowser.reset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DeveloperSection', () => {
  it('has a Developer heading and a File access check link that asks the background to open the page', () => {
    const listener = vi.fn((_message: unknown) => ({ ok: true }));
    fakeBrowser.runtime.onMessage.addListener(listener);
    render(<DeveloperSection level={2} />);
    expect(screen.getByRole('heading', { name: 'Developer' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'File access check' }));
    expect(listener.mock.calls[0]?.[0]).toEqual({ type: 'weekrow:file-check-open' });
  });
});

describe('the settings', () => {
  const props = {
    settings: DEFAULT_SETTINGS,
    courses: [],
    level: 2 as const,
    onChange: vi.fn(),
    tools: DEFAULT_TOOLS_SETTINGS,
    onToolsChange: vi.fn(),
  };

  it('show no Developer group in a store build', () => {
    render(<SettingsFields {...props} />);
    expect(screen.queryByRole('heading', { name: 'Developer' })).toBeNull();
    expect(screen.queryByText('File access check')).toBeNull();
  });

  it('show the Developer group in a test build', () => {
    vi.stubGlobal('__FILE_CHECK__', true);
    render(<SettingsFields {...props} />);
    expect(screen.getByRole('heading', { name: 'Developer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'File access check' })).toBeTruthy();
  });
});
