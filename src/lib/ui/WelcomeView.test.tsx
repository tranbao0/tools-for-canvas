// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { SurfaceState } from '../model/types';
import type { WelcomeProps } from './contract';
import { spyActions } from './testing/actions';
import { ORIGIN, readyState } from './testing/mocks';
import { WelcomeView } from './WelcomeView';

afterEach(cleanup);

const NOT_SET_UP: SurfaceState = { kind: 'not_set_up', offer: null, savedOrigin: null };

function setup(browser: WelcomeProps['browser'], shortcut: string | null, state: SurfaceState) {
  const actions = spyActions();
  render(<WelcomeView browser={browser} shortcut={shortcut} state={state} actions={actions} />);
  return actions;
}

describe('WelcomeView', () => {
  it('shows how to pin the button in Chrome, and the shortcut', () => {
    setup('chrome', 'Alt+Shift+W', NOT_SET_UP);
    expect(screen.getByText(/Then click the pin next to Weekrow for Canvas\./)).toBeTruthy();
    expect(screen.getByText('Alt+Shift+W').tagName).toBe('KBD');
    expect(screen.getByText(/You can also press/).textContent).toBe(
      'You can also press Alt+Shift+W.',
    );
  });

  it('shows the Edge pin steps and a shortcut hint when none is set', () => {
    setup('edge', null, NOT_SET_UP);
    expect(screen.getByText(/Then click the eye next to Weekrow for Canvas\./)).toBeTruthy();
    expect(screen.getByText(/set a keyboard shortcut/)).toBeTruthy();
  });

  it('has the same setup steps as the panel', () => {
    const actions = setup('chrome', null, NOT_SET_UP);
    fireEvent.input(screen.getByLabelText('Canvas address'), {
      target: { value: 'canvas.uw.edu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(actions.allowAccess).toHaveBeenCalledWith('https://canvas.uw.edu');
  });

  it('says that the list shows on Canvas pages, and that the side panel is optional', () => {
    setup('chrome', null, NOT_SET_UP);
    expect(screen.getByRole('heading', { name: 'Find your list' })).toBeTruthy();
    expect(
      screen.getByText(
        'Your list shows on the Canvas dashboard and on course home pages. On any page, click the Weekrow button to open or close it in the side panel.',
      ),
    ).toBeTruthy();
  });

  it('names the sidebar on Firefox', () => {
    setup('firefox', null, NOT_SET_UP);
    expect(screen.getByText(/choose Pin to Toolbar\./)).toBeTruthy();
    expect(screen.getByText(/open or close it in the sidebar\.$/)).toBeTruthy();
  });

  it('offers "Keep using" while the student changes the address', () => {
    const actions = setup('chrome', null, { kind: 'not_set_up', offer: null, savedOrigin: ORIGIN });
    const keep = screen.getByRole('button', { name: /^Keep using/ });
    expect(keep.textContent).toBe('Keep using school.instructure.com');
    fireEvent.click(keep);
    expect(actions.keepSavedAddress).toHaveBeenCalledTimes(1);
  });

  it('never shows the offer, which belongs to the side panel', () => {
    setup('chrome', null, {
      kind: 'not_set_up',
      offer: { origin: ORIGIN, mode: 'use' },
      savedOrigin: null,
    });
    expect(screen.queryByText('Use this Canvas?')).toBeNull();
  });

  it('confirms the address once the list is ready', () => {
    setup('chrome', null, readyState());
    expect(
      screen.getByText(
        (_, el) => el?.textContent === 'All set. Weekrow uses school.instructure.com.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Open your Canvas dashboard to see your week.')).toBeTruthy();
  });
});
