// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../model/types';
import { parseTheme } from './Settings';
import { parseWeekStart, SettingsView, toggleHidden } from './SettingsView';

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
  const onChangeAddress = vi.fn();
  render(
    <SettingsView
      settings={settings}
      courses={courses}
      origin={origin}
      onChange={onChange}
      onChangeAddress={onChangeAddress}
    />,
  );
  return { onChange, onChangeAddress };
}

describe('SettingsView', () => {
  it('shows the five settings and the address', () => {
    setup();
    expect(screen.getByLabelText('First day of the week')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hidden courses' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show progress rings' })).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Show the weekly list on Canvas pages' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Shows on the Card View and Recent Activity dashboards and on course home pages. On other pages, use the side panel.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Theme')).toBeTruthy();
    expect(screen.getByText('school.instructure.com')).toBeTruthy();
  });

  it('changes the first day of the week', () => {
    const { onChange } = setup();
    const select = screen.getByLabelText('First day of the week') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Automatic',
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]);
    expect(
      document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Automatic takes the first day from your Canvas language.');
    fireEvent.change(select, { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, weekStart: 1 });
  });

  it('changes the theme', () => {
    const { onChange } = setup({ ...DEFAULT_SETTINGS, theme: 'light' });
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;
    expect(select.value).toBe('light');
    fireEvent.change(select, { target: { value: 'auto' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, theme: 'auto' });
  });

  it('hides and shows a course', () => {
    const { onChange } = setup({ ...DEFAULT_SETTINGS, hiddenCourseIds: ['9'] });
    const hide = screen.getByRole('switch', { name: 'Hide Orientation' }) as HTMLInputElement;
    expect(hide.checked).toBe(false);
    fireEvent.click(hide);
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hiddenCourseIds: ['9', '2'] });
  });

  it('turns the rings and the in-page list off', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'Show progress rings' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, showRings: false });
    fireEvent.click(screen.getByRole('switch', { name: 'Show the weekly list on Canvas pages' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
  });

  it('changes the address', () => {
    const { onChangeAddress } = setup(DEFAULT_SETTINGS, null);
    expect(screen.getByText('Not set')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onChangeAddress).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('parses the week start', () => {
    expect(parseWeekStart('auto')).toBe('auto');
    expect(parseWeekStart('7')).toBe(7);
    expect(parseWeekStart('8')).toBe('auto');
  });

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
