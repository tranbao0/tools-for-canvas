// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOOLS_SETTINGS,
  type DashboardFixesSettings,
  type ToolsSettings,
} from '../../../shared/settings/tools';
import { FixesSettings } from './FixesSettings';

afterEach(cleanup);

const LABELS: readonly [keyof DashboardFixesSettings, string][] = [
  ['courseColors', 'Course colors on Course work icons'],
  ['announcementsInPlace', 'Announcements in place'],
  ['courseWorkExtras', 'Course work extras'],
  ['allCourseGrades', 'All course grades'],
];

function setup(tools: ToolsSettings = DEFAULT_TOOLS_SETTINGS) {
  const onChange = vi.fn<(tools: ToolsSettings) => void>();
  render(<FixesSettings tools={tools} level={3} onChange={onChange} />);
  return { onChange };
}

function switchOf(label: string): HTMLInputElement {
  return screen.getByRole('switch', { name: label }) as HTMLInputElement;
}

describe('FixesSettings', () => {
  it('shows the group heading and its help', () => {
    setup();

    expect(screen.getByRole('heading', { level: 3, name: 'New dashboard fixes' })).toBeTruthy();
    expect(
      screen.getByText(
        'Small fixes for the widgets of the new Canvas dashboard. Each one works on its own.',
      ),
    ).toBeTruthy();
  });

  it('shows four switches with the labels of the fixes', () => {
    setup();

    expect(screen.getAllByRole('switch')).toHaveLength(4);
    for (const [, label] of LABELS) expect(switchOf(label)).toBeTruthy();
  });

  it('shows the heading at the level that the caller gives', () => {
    const onChange = vi.fn();
    render(<FixesSettings tools={DEFAULT_TOOLS_SETTINGS} level={2} onChange={onChange} />);

    expect(screen.getByRole('heading', { level: 2, name: 'New dashboard fixes' })).toBeTruthy();
  });

  it('turns every switch on for the defaults', () => {
    setup();

    for (const [, label] of LABELS) expect(switchOf(label).checked).toBe(true);
  });

  it('reflects the value of each field', () => {
    setup({
      dashboardFixes: {
        courseColors: false,
        announcementsInPlace: true,
        courseWorkExtras: false,
        allCourseGrades: true,
      },
    });

    expect(switchOf('Course colors on Course work icons').checked).toBe(false);
    expect(switchOf('Announcements in place').checked).toBe(true);
    expect(switchOf('Course work extras').checked).toBe(false);
    expect(switchOf('All course grades').checked).toBe(true);
  });

  it.each(LABELS)('turns off %s alone and gives the full settings', (key, label) => {
    const { onChange } = setup();

    fireEvent.click(switchOf(label));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, [key]: false },
    });
  });

  it.each(LABELS)('turns on %s alone when the other switches are off', (key, label) => {
    const allOff: ToolsSettings = {
      dashboardFixes: {
        courseColors: false,
        announcementsInPlace: false,
        courseWorkExtras: false,
        allCourseGrades: false,
      },
    };
    const { onChange } = setup(allOff);

    fireEvent.click(switchOf(label));

    expect(onChange).toHaveBeenCalledWith({
      dashboardFixes: { ...allOff.dashboardFixes, [key]: true },
    });
  });

  it('does not change the tools it was given', () => {
    const tools: ToolsSettings = structuredClone(DEFAULT_TOOLS_SETTINGS);
    const { onChange } = setup(tools);

    fireEvent.click(switchOf('Course work extras'));

    expect(tools).toEqual(DEFAULT_TOOLS_SETTINGS);
    expect(onChange.mock.calls[0]?.[0]).not.toBe(tools);
  });
});
