// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Offer, SurfaceState } from '../model/types';
import { App, HiddenCourseNote } from './App';
import type { AppProps, SurfaceKind } from './contract';
import { spyActions } from './testing/actions';
import { hiddenCourseView, nonReadyStates, ORIGIN, OTHER_OFFER, readyState } from './testing/mocks';

afterEach(cleanup);

function setup(
  state: SurfaceState,
  surface: SurfaceKind = 'panel',
  extra: Pick<AppProps, 'browser' | 'shortcut'> = {},
) {
  const actions = spyActions();
  render(<App surface={surface} state={state} actions={actions} {...extra} />);
  return actions;
}

const NOT_SET_UP: SurfaceState = { kind: 'not_set_up', offer: null, savedOrigin: null };

const EXPECTED_TEXT: Record<string, string> = {
  loading: 'Loading your list',
  'not-set-up': 'Connect your Canvas',
  // The offer itself shows in the side panel only; its own tests cover it.
  'not-set-up-offer': 'Connect your Canvas',
  'not-set-up-saved': 'Change your Canvas address',
  checking: 'Checking',
  'checking-saved': 'Keep using',
  'no-access': 'Tools for Canvas needs access to your Canvas',
  redirects: 'This address redirects',
  'not-canvas': 'This address is not a Canvas site',
  'not-canvas-saved': 'Keep using',
  unreachable: "Couldn't reach canvas.stat.edu",
  'unreachable-saved': 'Keep using',
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

describe('setup form', () => {
  it('asks for a valid address', () => {
    const actions = setup(NOT_SET_UP);
    const input = screen.getByLabelText('Canvas address');
    fireEvent.input(input, { target: { value: 'school' } });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter a web address, such as school.instructure.com.')).toBeTruthy();
    expect(actions.allowAccess).not.toHaveBeenCalled();
  });

  it('calls allowAccess with the origin inside the submit handler', () => {
    const actions = setup(NOT_SET_UP);
    fireEvent.input(screen.getByLabelText('Canvas address'), {
      target: { value: 'canvas.state.edu/courses/12' },
    });
    // The click dispatches submit synchronously, so the call happens inside the user gesture.
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(actions.allowAccess).toHaveBeenCalledTimes(1);
    expect(actions.allowAccess).toHaveBeenCalledWith('https://canvas.state.edu');
  });

  it('uses the shared address rules, so an IP address is not accepted', () => {
    const actions = setup(NOT_SET_UP);
    const input = screen.getByLabelText('Canvas address');
    fireEvent.input(input, { target: { value: '192.168.1.20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(actions.allowAccess).not.toHaveBeenCalled();
  });

  it('accepts or dismisses the "Use this Canvas?" offer', () => {
    const actions = setup({
      kind: 'not_set_up',
      offer: { origin: ORIGIN, mode: 'use' },
      savedOrigin: null,
    });
    expect(screen.getByText('school.instructure.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect(actions.acceptOffer).toHaveBeenCalledWith(ORIGIN);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(actions.dismissOffer).toHaveBeenCalledTimes(1);
  });

  it('prefills the address after a failed check', () => {
    setup({ kind: 'not_canvas', origin: 'https://www.state.edu', savedOrigin: null });
    expect((screen.getByLabelText('Canvas address') as HTMLInputElement).value).toBe(
      'www.state.edu',
    );
  });

  it('tells the student how to find the real address when it redirects', () => {
    setup({ kind: 'redirects', origin: 'https://lms.state.edu', savedOrigin: null });
    expect(
      screen.getByText(
        'Open Canvas in a tab and sign in. Then click the Tools for Canvas button in the toolbar while that tab is open.',
      ),
    ).toBeTruthy();
  });
});

describe('access and sign-in', () => {
  it('requests access again for the saved address', () => {
    const actions = setup({
      kind: 'no_access',
      origin: 'https://canvas.state.edu',
      savedOrigin: null,
      offer: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(actions.allowAccess).toHaveBeenCalledWith('https://canvas.state.edu');
  });

  it('shows the saved address, the sign-in button and the Change it link', () => {
    const actions = setup({ kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null });
    expect(screen.getByText('school.instructure.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Canvas to sign in' }));
    expect(actions.openCanvas).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Change it' }));
    expect(actions.changeAddress).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/private window/)).toBeNull();
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
      savedOrigin: null,
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
      savedOrigin: null,
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

describe('unreachable address', () => {
  const state: SurfaceState = {
    kind: 'unreachable',
    origin: 'https://canvas.stat.edu',
    savedOrigin: null,
  };

  it('asks the student to check the address, with the form prefilled', () => {
    setup(state);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      "Couldn't reach canvas.stat.edu",
    );
    expect(screen.getByText(/^Check the address\./)).toBeTruthy();
    expect((screen.getByLabelText('Canvas address') as HTMLInputElement).value).toBe(
      'canvas.stat.edu',
    );
    expect(screen.queryByRole('button', { name: /^Keep using/ })).toBeNull();
  });

  it('keeps each host name as one unit that breaks only after its dots', () => {
    setup({ ...state, savedOrigin: ORIGIN });
    const hosts = [...document.querySelectorAll('.wr-host')];
    expect(hosts.map((host) => host.textContent)).toEqual([
      'canvas.stat.edu',
      'school.instructure.com',
    ]);
    expect(hosts[0]?.closest('h2')).not.toBeNull();
    expect(hosts[1]?.closest('button')?.textContent).toBe('Keep using school.instructure.com');
    expect(hosts[1]?.querySelectorAll('wbr')).toHaveLength(2);
  });

  it('retries the check, or checks a corrected address', () => {
    const actions = setup(state);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(actions.retry).toHaveBeenCalledTimes(1);
    fireEvent.input(screen.getByLabelText('Canvas address'), {
      target: { value: 'canvas.state.edu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(actions.allowAccess).toHaveBeenCalledWith('https://canvas.state.edu');
  });

  it('never says "You\'re offline.", because the usual cause is a wrong address', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    setup(state);
    expect(screen.queryByText(/offline/)).toBeNull();
  });
});

describe('changing the address', () => {
  const state: SurfaceState = { kind: 'not_set_up', offer: null, savedOrigin: ORIGIN };

  it('opens an empty address form with "Keep using" as a cancel', () => {
    const actions = setup(state);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Change your Canvas address',
    );
    expect((screen.getByLabelText('Canvas address') as HTMLInputElement).value).toBe('');
    const keep = screen.getByRole('button', { name: /^Keep using/ });
    expect(keep.textContent).toBe('Keep using school.instructure.com');
    fireEvent.click(keep);
    expect(actions.keepSavedAddress).toHaveBeenCalledTimes(1);
  });

  it('checks the new address', () => {
    const actions = setup(state);
    fireEvent.input(screen.getByLabelText('Canvas address'), {
      target: { value: 'canvas.state.edu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    expect(actions.allowAccess).toHaveBeenCalledWith('https://canvas.state.edu');
  });

  it('shows no first-run steps on Firefox, because this is not the first run', () => {
    setup(state, 'panel', { browser: 'firefox', shortcut: null });
    expect(screen.queryByText('Pin the Tools for Canvas button')).toBeNull();
  });
});

describe('first run in the side panel', () => {
  it('shows only the connect form in every browser, because the welcome page opens on install', () => {
    for (const browser of ['chrome', 'edge', 'firefox'] as const) {
      setup(NOT_SET_UP, 'panel', { browser, shortcut: 'Alt+Shift+W' });
      expect(screen.queryByText('Pin the Tools for Canvas button')).toBeNull();
      expect(document.querySelector('.wr-steps')).toBeNull();
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Connect your Canvas');
      cleanup();
    }
  });

  it('keeps the offer above the connect form', () => {
    setup(
      { kind: 'not_set_up', offer: { origin: ORIGIN, mode: 'use' }, savedOrigin: null },
      'panel',
      { browser: 'firefox', shortcut: null },
    );
    const offer = screen.getByRole('region', { name: 'Use this Canvas?' });
    const form = screen.getByLabelText('Canvas address');
    expect(offer.compareDocumentPosition(form)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('the "Switch to this Canvas?" offer', () => {
  const states: SurfaceState[] = [
    { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: OTHER_OFFER },
    { kind: 'no_access', origin: ORIGIN, savedOrigin: null, offer: OTHER_OFFER },
    { kind: 'no_courses', origin: ORIGIN, offer: OTHER_OFFER },
    { kind: 'cant_load', origin: ORIGIN, offline: false, savedOrigin: null, offer: OTHER_OFFER },
  ];

  it.each(states.map((state) => [state.kind, state] as const))(
    'shows at the top of %s in the side panel',
    (_, state) => {
      const actions = setup(state);
      const banner = screen.getByRole('region', { name: 'Switch to this Canvas?' });
      expect(banner.closest('.wr-state')?.firstElementChild).toBe(banner);
      expect(banner.textContent).toContain('canvas.state.edu');
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

  it('shows the hidden course note with a link to the settings', () => {
    let opened = 0;
    render(<HiddenCourseNote onOpenSettings={() => (opened += 1)} />);
    expect(screen.getByText('You hid this course from the weekly list.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(opened).toBe(1);
  });

  it('shows the hidden course note instead of the list on a hidden course', () => {
    const actions = setup(readyState({ view: hiddenCourseView() }), 'inpage');
    expect(screen.getByText('You hid this course from the weekly list.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('.wr')?.getAttribute('data-surface')).toBe('inpage');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    // The link opens the settings in place, not the settings page.
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(actions.openSettings).not.toHaveBeenCalled();
  });
});

describe('keeping the saved address', () => {
  const CANDIDATE = 'https://www.state.edu';

  it.each<SurfaceState>([
    { kind: 'not_set_up', offer: null, savedOrigin: ORIGIN },
    { kind: 'checking', origin: CANDIDATE, savedOrigin: ORIGIN },
    { kind: 'no_access', origin: CANDIDATE, savedOrigin: ORIGIN, offer: null },
    { kind: 'redirects', origin: CANDIDATE, savedOrigin: ORIGIN },
    { kind: 'not_canvas', origin: CANDIDATE, savedOrigin: ORIGIN },
    { kind: 'unreachable', origin: CANDIDATE, savedOrigin: ORIGIN },
  ])('offers to keep the saved address in $kind', (state) => {
    const actions = setup(state);
    const button = screen.getByRole('button', { name: /^Keep using/ });
    expect(button.textContent).toBe('Keep using school.instructure.com');
    fireEvent.click(button);
    expect(actions.keepSavedAddress).toHaveBeenCalledTimes(1);
  });

  it('offers nothing when no other address is saved', () => {
    setup({ kind: 'not_canvas', origin: CANDIDATE, savedOrigin: null });
    expect(screen.queryByRole('button', { name: /^Keep using/ })).toBeNull();
    cleanup();
    setup({ kind: 'redirects', origin: ORIGIN, savedOrigin: ORIGIN });
    expect(screen.queryByRole('button', { name: /^Keep using/ })).toBeNull();
  });
});
