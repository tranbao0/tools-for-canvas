// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SurfaceState } from '../model/types';
import type { WelcomeProps } from './contract';
import { spyActions } from './testing/actions';
import { ORIGIN, OTHER_OFFER, readyState } from './testing/mocks';
import { OFFER_ARM_MS } from './Notices';
import { WelcomeView } from './WelcomeView';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOT_SET_UP: SurfaceState = { kind: 'not_set_up', offer: null };

function setup(browser: WelcomeProps['browser'], shortcut: string | null, state: SurfaceState) {
  const actions = spyActions();
  render(<WelcomeView browser={browser} shortcut={shortcut} state={state} actions={actions} />);
  return actions;
}

describe('WelcomeView', () => {
  it('shows how to pin the button in Chrome, and the shortcut', () => {
    setup('chrome', 'Alt+Shift+W', NOT_SET_UP);
    expect(screen.getByText(/Then click the pin next to Tools for Canvas\./)).toBeTruthy();
    expect(screen.getByText('Alt+Shift+W').tagName).toBe('KBD');
    expect(screen.getByText(/You can also press/).textContent).toBe(
      'You can also press Alt+Shift+W.',
    );
  });

  it('shows the Edge pin steps and a shortcut hint when none is set', () => {
    setup('edge', null, NOT_SET_UP);
    expect(screen.getByText(/Then click the eye next to Tools for Canvas\./)).toBeTruthy();
    expect(screen.getByText(/set a keyboard shortcut/)).toBeTruthy();
  });

  it('has no address form, and asks the student to open Canvas', () => {
    setup('chrome', null, NOT_SET_UP);
    expect(screen.getByRole('heading', { name: 'Open your Canvas' })).toBeTruthy();
    expect(
      screen.getByText(
        "Open your school's Canvas in a browser tab. Tools for Canvas finds it by itself.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText('Canvas address')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull();
  });

  it('shows the Allow access button when the browser withholds access', () => {
    const actions = setup('chrome', null, {
      kind: 'no_access',
      origin: 'https://canvas.uw.edu',
      offer: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(actions.allowAccess).toHaveBeenCalledWith('https://canvas.uw.edu');
  });

  it('says that the list shows on Canvas pages, and how to use the side panel', () => {
    setup('chrome', null, NOT_SET_UP);
    expect(
      screen.getByText('Your list shows on the Canvas dashboard and on course home pages.'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Use the side panel' })).toBeTruthy();
    expect(
      screen.getByText(
        'On any page, click the Tools for Canvas button to open or close your list in the side panel.',
      ),
    ).toBeTruthy();
  });

  it('names the sidebar on Firefox', () => {
    setup('firefox', null, NOT_SET_UP);
    expect(screen.getByText(/choose Pin to Toolbar\./)).toBeTruthy();
    expect(screen.getByText(/open or close your list in the sidebar\.$/)).toBeTruthy();
  });

  it('asks "Use <host> as your Canvas?" when no address is saved, and answers with the buttons', () => {
    vi.useFakeTimers();
    const actions = setup('chrome', null, {
      kind: 'not_set_up',
      offer: { origin: 'https://canvas.school.edu' },
    });

    const offer = screen.getByRole('region', { name: 'Use canvas.school.edu as your Canvas?' });
    expect(offer.textContent).toContain('Use canvas.school.edu as your Canvas?');
    act(() => {
      vi.advanceTimersByTime(OFFER_ARM_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect(actions.acceptOffer).toHaveBeenCalledWith('https://canvas.school.edu');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(actions.dismissOffer).toHaveBeenCalledTimes(1);
  });

  it('shows no offer while an address is saved, which is a matter for the side panel', () => {
    setup('chrome', null, {
      kind: 'signed_out',
      origin: ORIGIN,
      isFirefox: false,
      offer: OTHER_OFFER,
    });
    expect(screen.queryByText('Switch to this Canvas?')).toBeNull();
    expect(document.body.textContent).not.toContain('canvas.state.edu');
  });

  it('confirms the address once the list is ready', () => {
    setup('chrome', null, readyState());
    expect(
      screen.getByText(
        (_, el) => el?.textContent === 'All set. Tools for Canvas uses school.instructure.com.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Open your Canvas dashboard to see your week.')).toBeTruthy();
  });
});
