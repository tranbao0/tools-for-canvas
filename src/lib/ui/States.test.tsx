// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Offer, SurfaceState } from '../model/types';
import { App } from './App';
import { OFFER_ARM_MS } from './Notices';
import type { SurfaceKind } from './contract';
import { spyActions } from './testing/actions';
import { hiddenCourseView, nonReadyStates, ORIGIN, OTHER_OFFER, readyState } from './testing/mocks';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Lets the accept button of an offer switch on, which takes a second. */
function armOffer(): void {
  act(() => {
    vi.advanceTimersByTime(OFFER_ARM_MS);
  });
}

function setup(state: SurfaceState, surface: SurfaceKind = 'panel') {
  const actions = spyActions();
  render(<App surface={surface} state={state} actions={actions} />);
  return actions;
}

const NOT_SET_UP: SurfaceState = { kind: 'not_set_up', offer: null };

const EXPECTED_TEXT: Record<string, string> = {
  loading: 'Loading your list',
  'not-set-up': 'Open your Canvas to see your list',
  // The offer shows in the panel and the welcome page; its own tests cover it.
  'not-set-up-use': 'Open your Canvas to see your list',
  // The offer itself shows in the side panel only; its own tests cover it.
  'no-access': 'Tools for Canvas needs access to your Canvas',
  'signed-out': "You're signed out of Canvas",
  'signed-out-firefox': "You're signed out of Canvas",
  'signed-out-offer': "You're signed out of Canvas",
  'no-courses': 'No active courses',
  'cant-load': "Couldn't load your list",
  'cant-load-offline': "Couldn't load your list",
};

describe('every state renders', () => {
  for (const { name, state } of nonReadyStates()) {
    it(`renders ${name} on both surfaces`, () => {
      const text = EXPECTED_TEXT[name];
      if (text === undefined) throw new Error(`No expected text for ${name}`);
      for (const surface of ['panel', 'inpage'] as const) {
        setup(state, surface);
        expect(
          screen.getAllByText((_, el) => el?.textContent?.startsWith(text) ?? false).length,
        ).toBeGreaterThan(0);
        cleanup();
      }
    });
  }
});

describe('loading', () => {
  it('keeps the header layout and marks the surface busy', () => {
    setup({ kind: 'loading' });
    expect(document.querySelector('.wr')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading your list');
    expect(
      (screen.getByRole('button', { name: 'Previous week' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Add task' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});

describe('not set up', () => {
  it('asks the student to open Canvas, with no address form', () => {
    setup(NOT_SET_UP);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Open your Canvas to see your list',
    );
    expect(
      screen.getByText(
        "Open your school's Canvas in a browser tab. Tools for Canvas finds it by itself.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText('Canvas address')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull();
  });
});

describe('the "Use <host> as your Canvas?" offer', () => {
  const state: SurfaceState = {
    kind: 'not_set_up',
    offer: { origin: 'https://canvas.school.edu' },
  };

  it('shows in the side panel above the open-Canvas line, with the real host', () => {
    vi.useFakeTimers();
    const actions = setup(state);
    const offer = screen.getByRole('region', { name: 'Use canvas.school.edu as your Canvas?' });
    expect(offer.closest('.wr-state')?.firstElementChild).toBe(offer);
    expect(offer.textContent).toContain('Use canvas.school.edu as your Canvas?');
    expect(offer.querySelector('.wr-host')?.textContent).toBe('canvas.school.edu');
    armOffer();
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect(actions.acceptOffer).toHaveBeenCalledWith('https://canvas.school.edu');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(actions.dismissOffer).toHaveBeenCalledTimes(1);
  });

  it('never shows in the in-page list', () => {
    setup(state, 'inpage');
    expect(screen.queryByRole('button', { name: 'Use it' })).toBeNull();
    expect(document.body.textContent).not.toContain('canvas.school.edu');
  });
});

describe('access and sign-in', () => {
  it('requests access again for the saved address', () => {
    const actions = setup({
      kind: 'no_access',
      origin: 'https://canvas.state.edu',
      offer: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(actions.allowAccess).toHaveBeenCalledWith('https://canvas.state.edu');
  });

  it('shows the saved address and the sign-in button, and no way to type another address', () => {
    const actions = setup({ kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null });
    expect(screen.getByText('school.instructure.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Canvas to sign in' }));
    expect(actions.openCanvas).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Change it' })).toBeNull();
    expect(screen.queryByText(/private window/)).toBeNull();
  });

  it('keeps each host name as one unit that breaks only after its dots', () => {
    setup({ kind: 'no_access', origin: 'https://canvas.state.edu', offer: null });
    const hosts = [...document.querySelectorAll('.wr-host')];
    expect(hosts.map((host) => host.textContent)).toEqual(['canvas.state.edu']);
    expect(hosts[0]?.querySelectorAll('wbr')).toHaveLength(2);
  });

  it('adds the private window hint on Firefox', () => {
    setup({ kind: 'signed_out', origin: ORIGIN, isFirefox: true, offer: null });
    expect(
      screen.getByText(
        'In a private window or a container tab, Firefox keeps a separate sign-in. Sign in to Canvas in a normal window.',
      ),
    ).toBeTruthy();
  });

  it('retries after a failed first load', () => {
    const actions = setup({
      kind: 'cant_load',
      origin: ORIGIN,
      offline: false,
      offer: null,
    });
    expect(screen.queryByText("You're offline.")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(actions.retry).toHaveBeenCalledTimes(1);
  });

  it('says "You\'re offline." after a network error only when the browser is offline', () => {
    const state: SurfaceState = {
      kind: 'cant_load',
      origin: ORIGIN,
      offline: true,
      offer: null,
    };
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    setup(state);
    expect(screen.queryByText("You're offline.")).toBeNull();
    cleanup();
    onLine.mockReturnValue(false);
    setup(state);
    expect(screen.getByText("You're offline.")).toBeTruthy();
    cleanup();
    setup({ ...state, offline: false });
    expect(screen.queryByText("You're offline.")).toBeNull();
  });
});

describe('first run in the side panel', () => {
  it('shows only the open-Canvas line, because the welcome page opens on install', () => {
    setup(NOT_SET_UP);
    expect(screen.queryByText('Pin the Tools for Canvas button')).toBeNull();
    expect(document.querySelector('.wr-steps')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Open your Canvas to see your list',
    );
  });
});

describe('the "Switch to this Canvas?" offer', () => {
  const states: SurfaceState[] = [
    { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: OTHER_OFFER },
    { kind: 'no_access', origin: ORIGIN, offer: OTHER_OFFER },
    { kind: 'no_courses', origin: ORIGIN, offer: OTHER_OFFER, allCourses: [] },
    { kind: 'cant_load', origin: ORIGIN, offline: false, offer: OTHER_OFFER },
  ];

  it.each(states.map((state) => [state.kind, state] as const))(
    'shows at the top of %s in the side panel',
    (_, state) => {
      vi.useFakeTimers();
      const actions = setup(state);
      const banner = screen.getByRole('region', { name: 'Switch to this Canvas?' });
      expect(banner.closest('.wr-state')?.firstElementChild).toBe(banner);
      expect(banner.textContent).toContain('canvas.state.edu');
      armOffer();
      fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
      expect(actions.acceptOffer).toHaveBeenCalledWith(OTHER_OFFER.origin);
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
      expect(actions.dismissOffer).toHaveBeenCalledTimes(1);
    },
  );

  it.each(states.map((state) => [state.kind, state] as const))(
    'never shows in the in-page list, in %s',
    (_, state) => {
      setup(state, 'inpage');
      expect(screen.queryByText('Switch to this Canvas?')).toBeNull();
      expect(document.body.textContent).not.toContain('canvas.state.edu');
    },
  );

  it('never shows in the in-page list when the list is ready', () => {
    const offer: Offer = OTHER_OFFER;
    setup(readyState({ offer }), 'inpage');
    expect(screen.queryByText('Switch to this Canvas?')).toBeNull();
    expect(document.body.textContent).not.toContain('canvas.state.edu');
  });

  it('keeps the offer out of the live region of a failed load', () => {
    setup(states[3] as SurfaceState);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe("Couldn't load your list");
  });
});

describe('in-page surface', () => {
  it('always shows the list, also while the side panel is open', () => {
    setup(readyState(), 'inpage');
    expect(screen.queryByText('Shown in the side panel')).toBeNull();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });

  it('uses level 2 headings inside the Canvas page', () => {
    setup(readyState(), 'inpage');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 })[0]?.textContent).toContain('Oct 25 - 31');
  });

  it('shows the hidden course note instead of the list on a hidden course', () => {
    setup(readyState({ view: hiddenCourseView() }), 'inpage');
    expect(screen.getByText('You hid this course from the weekly list.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('.wr')?.getAttribute('data-surface')).toBe('inpage');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    // The link opens the settings in place.
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  });
});
