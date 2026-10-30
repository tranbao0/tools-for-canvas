// @vitest-environment happy-dom
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../model/types';
import { parseTheme } from './Settings';
import { toggleHidden } from './Settings';
import { SettingsView } from './SettingsView';

afterEach(cleanup);

const courses = [
  { id: '1', name: 'BIO 201 Cell Biology' },
  { id: '2', name: 'Orientation' },
];

function setup(
  settings: Settings = DEFAULT_SETTINGS,
  origin: string | null = 'https://school.instructure.com',
) {
  const onChange = vi.fn<(settings: Settings) => void>();
  render(
    <SettingsView
      settings={settings}
      tools={DEFAULT_TOOLS_SETTINGS}
      onToolsChange={vi.fn()}
      courses={courses}
      origin={origin}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('SettingsView', () => {
  it('shows the four settings and the address', () => {
    setup();
    expect(screen.getByLabelText('Shown span')).toBeTruthy();
    expect(screen.queryByLabelText('First day of the week')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Show in my list' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show progress rings' })).toBeTruthy();
    expect(screen.getByLabelText('Theme')).toBeTruthy();
    expect(screen.getByText('school.instructure.com')).toBeTruthy();
  });

  it('ends with a quiet support link that opens in a new tab', () => {
    setup();
    const link = screen.getByRole('link', { name: 'Support on Ko-fi' }) as HTMLAnchorElement;
    expect(link.href).toBe('https://ko-fi.com/baowows');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('changes the theme', () => {
    const { onChange } = setup({ ...DEFAULT_SETTINGS, theme: 'light' });
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;
    expect(select.value).toBe('light');
    fireEvent.change(select, { target: { value: 'auto' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, theme: 'auto' });
  });

  it('shows every course in my list by default: each switch is on', () => {
    setup();
    const switches = screen
      .getAllByRole('switch')
      .filter((el) => /in my list$/.test(el.getAttribute('aria-label') ?? ''));
    expect(switches.length).toBeGreaterThan(0);
    for (const el of switches) expect((el as HTMLInputElement).checked).toBe(true);
  });

  it('turns a course off to hide it, and back on to show it, in the stored hidden ids', () => {
    const { onChange } = setup({ ...DEFAULT_SETTINGS, hiddenCourseIds: ['9'] });
    const course = screen.getByRole('switch', {
      name: 'Show Orientation in my list',
    }) as HTMLInputElement;
    expect(course.checked).toBe(true);
    fireEvent.click(course);
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hiddenCourseIds: ['9', '2'] });
  });

  it('shows a hidden course as a switch that is off, and turning it on removes the id', () => {
    const { onChange } = setup({ ...DEFAULT_SETTINGS, hiddenCourseIds: ['2', '9'] });
    const course = screen.getByRole('switch', {
      name: 'Show Orientation in my list',
    }) as HTMLInputElement;
    expect(course.checked).toBe(false);
    fireEvent.click(course);
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hiddenCourseIds: ['9'] });
  });

  it('turns the rings off, and has no switch for the in-page list', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'Show progress rings' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, showRings: false });
    expect(screen.queryByRole('switch', { name: /weekly list on Canvas/ })).toBeNull();
  });

  it('shows the address the first Canvas page set, with no way to type another', () => {
    setup(DEFAULT_SETTINGS, null);
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(
      screen.getByText(
        'The first Canvas page you open sets it. To use another Canvas, open it and choose Switch in the side panel.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});

describe('helpers', () => {
  it('parses the theme', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('auto')).toBe('auto');
    expect(parseTheme('sepia')).toBe('auto');
  });

  it('toggles a hidden course without duplicates', () => {
    expect(toggleHidden(['1'], '1', true)).toEqual(['1']);
    expect(toggleHidden(['1', '2'], '1', false)).toEqual(['2']);
  });
});
