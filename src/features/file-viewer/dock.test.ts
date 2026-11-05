// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDock,
  filePaneOpen,
  giveBackRoom,
  fullViewAvailable,
  hideFilePane,
  isFullView,
  leaseRoom,
  removeStaleWeeklyDock,
  ROOM_ATTRIBUTE,
  setFullView,
  watchFullView,
  WEEKLY_HOST_ID,
  WEEKLY_TAB_ID,
  type Dock,
  type DockRole,
} from './dock';

const padding = () => document.documentElement.style.getPropertyValue('padding-right');
const docks: Dock[] = [];

function dock(role: DockRole, width: number, card = false): Dock {
  const made = createDock({
    role,
    card,
    id: `tools-${role}`,
    label: role,
    resizeLabel: `Resize ${role}`,
    width,
    onResized: () => undefined,
  });
  docks.push(made);
  return made;
}

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  document.body.innerHTML = '';
});
afterEach(() => {
  for (const made of docks.splice(0)) made.close();
  document.body.innerHTML = '';
});

describe('the record of the room on the page', () => {
  const html = document.documentElement;

  it('holds the padding of the page while a dock has room, and goes with the room', () => {
    html.style.setProperty('padding-right', '13px', 'important');
    const file = dock('file', 600);
    file.open();
    expect(JSON.parse(html.getAttribute(ROOM_ATTRIBUTE)!)).toEqual({
      value: '13px',
      priority: 'important',
    });
    file.close();
    expect(html.hasAttribute(ROOM_ATTRIBUTE)).toBe(false);
    expect(padding()).toBe('13px');
  });

  it('is not rewritten by a second dock, which keeps the first record', () => {
    html.style.setProperty('padding-right', '13px');
    dock('file', 600).open();
    dock('turn-in', 480).open();
    expect(JSON.parse(html.getAttribute(ROOM_ATTRIBUTE)!).value).toBe('13px');
  });

  it('gives the room back from the state in memory when no record is left', () => {
    html.style.setProperty('padding-right', '13px');
    const turnIn = dock('turn-in', 480);
    turnIn.open();
    turnIn.host.remove();
    giveBackRoom(document);
    expect(padding()).toBe('13px');
    expect(html.hasAttribute(ROOM_ATTRIBUTE)).toBe(false);
  });

  it('gives the room back when a page element only shares the id of a pane', () => {
    html.style.setProperty('padding-right', '13px');
    const turnIn = dock('turn-in', 480);
    turnIn.open();
    turnIn.host.remove();
    const lookalike = document.createElement('div');
    lookalike.id = 'tools-turn-in';
    document.body.append(lookalike);
    giveBackRoom(document);
    expect(padding()).toBe('13px');
    lookalike.remove();
  });
});

describe('the room of the docks', () => {
  it('restores the exact inline padding and priority when the last dock leaves', () => {
    document.documentElement.style.setProperty('padding-right', '13px', 'important');
    const file = dock('file', 600);
    const turnIn = dock('turn-in', 480);
    file.open();
    expect(padding()).toBe('600px');
    turnIn.open();
    file.close();
    expect(padding()).toBe('480px');
    turnIn.close();
    expect(padding()).toBe('13px');
    expect(document.documentElement.style.getPropertyPriority('padding-right')).toBe('important');
  });

  it('keeps the first saved padding when a page removed the host of a dock that held room', () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const file = dock('file', 600);
    file.open();
    file.host.remove();
    const turnIn = dock('turn-in', 480);
    turnIn.open();
    expect(padding()).toBe('480px');
    turnIn.close();
    expect(padding()).toBe('13px');
  });

  it('gives the padding back when the dock that is left was pruned and then closes', () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const file = dock('file', 600);
    const turnIn = dock('turn-in', 480);
    file.open();
    turnIn.open();
    file.host.remove();
    turnIn.close();
    expect(padding()).toBe('13px');
    file.close();
    expect(padding()).toBe('13px');
  });

  it('takes no room back for a hidden dock whose host a page removed', () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const file = dock('file', 600);
    const turnIn = dock('turn-in', 480);
    file.open();
    hideFilePane(true);
    turnIn.open();
    file.host.remove();
    hideFilePane(false);
    expect(filePaneOpen()).toBe(false);
    turnIn.close();
    expect(padding()).toBe('13px');
  });
});

describe('the weekly list dock', () => {
  const html = document.documentElement;

  it('takes its room like the other docks and gives the exact padding back', () => {
    html.style.setProperty('padding-right', '13px', 'important');
    const weekly = createDock({
      role: 'weekly',
      id: WEEKLY_HOST_ID,
      label: 'Weekly list',
      resizeLabel: 'Resize weekly list',
      width: 360,
      onResized: () => undefined,
    });
    docks.push(weekly);
    weekly.open();
    expect(padding()).toBe('360px');
    weekly.setHidden(true);
    expect(padding()).toBe('13px');
    weekly.setHidden(false);
    expect(padding()).toBe('360px');
    weekly.close();
    expect(padding()).toBe('13px');
    expect(html.style.getPropertyPriority('padding-right')).toBe('important');
  });

  it('is not the file pane: it never counts for filePaneOpen', () => {
    const weekly = dock('weekly', 360);
    weekly.open();
    expect(filePaneOpen()).toBe(false);
  });

  it('keeps its room for a copy that starts later while its host is on the page', () => {
    html.style.setProperty('padding-right', '13px');
    const weekly = dock('weekly', 360);
    weekly.host.id = WEEKLY_HOST_ID;
    weekly.open();
    giveBackRoom(document);
    expect(padding()).toBe('360px');
  });

  describe('the cleanup of a dead copy', () => {
    function deadDock(): HTMLElement {
      const host = document.createElement('div');
      host.id = WEEKLY_HOST_ID;
      host.setAttribute('data-weekrow-dock', '');
      document.body.append(host);
      return host;
    }

    it('removes the dock and the tab of an earlier copy and gives the room back', () => {
      html.style.setProperty('padding-right', '13px');
      html.style.setProperty('padding-right', '360px', 'important');
      html.setAttribute(ROOM_ATTRIBUTE, JSON.stringify({ value: '13px', priority: '' }));
      const host = deadDock();
      const tab = document.createElement('div');
      tab.id = WEEKLY_TAB_ID;
      tab.setAttribute('data-weekrow-dock', '');
      document.body.append(tab);
      removeStaleWeeklyDock(document);
      expect(host.isConnected).toBe(false);
      expect(tab.isConnected).toBe(false);
      expect(padding()).toBe('13px');
      expect(html.hasAttribute(ROOM_ATTRIBUTE)).toBe(false);
    });

    it('leaves an element that a page gave the same id', () => {
      const lookalike = document.createElement('div');
      lookalike.id = WEEKLY_HOST_ID;
      document.body.append(lookalike);
      removeStaleWeeklyDock(document);
      expect(lookalike.isConnected).toBe(true);
    });
  });
});

describe('a dock that a page hid and removed', () => {
  it('shows again when it opens again', () => {
    const weekly = dock('weekly', 360);
    weekly.open();
    weekly.setHidden(true);
    expect(weekly.host.style.display).toBe('none');
    weekly.host.remove();
    weekly.close();
    weekly.open();
    expect(weekly.host.isConnected).toBe(true);
    expect(weekly.host.style.display).toBe('');
    expect(weekly.shown).toBe(true);
    expect(padding()).toBe('360px');
  });
});

describe('the layer of a dock', () => {
  it('is above every page layer for the panes, and below the overlays of Canvas for the weekly list', () => {
    expect(dock('file', 480).host.style.zIndex).toBe('2147483647');
    const weekly = createDock({
      role: 'weekly',
      id: WEEKLY_HOST_ID,
      label: 'Weekly list',
      resizeLabel: 'Resize weekly list',
      width: 360,
      zIndex: 1000,
      onResized: () => undefined,
    });
    docks.push(weekly);
    expect(weekly.host.style.zIndex).toBe('1000');
  });
});

describe('a dock that was forgotten', () => {
  it('never writes the padding again, and takes nothing off the page', () => {
    const weekly = dock('weekly', 360);
    weekly.open();
    weekly.forget();
    document.documentElement.style.setProperty('padding-right', '480px');
    window.dispatchEvent(new Event('resize'));
    weekly.setWidth(400);
    expect(padding()).toBe('480px');
    expect(weekly.host.isConnected).toBe(true);
  });

  it('never writes the padding when its host is off the page', () => {
    const weekly = dock('weekly', 360);
    weekly.open();
    weekly.host.remove();
    document.documentElement.style.setProperty('padding-right', '480px');
    window.dispatchEvent(new Event('resize'));
    expect(padding()).toBe('480px');
  });
});

describe('the room of a tab', () => {
  const html = document.documentElement;
  const leases: { release(): void }[] = [];

  function tabHost(): HTMLElement {
    const host = document.createElement('div');
    document.body.append(host);
    return host;
  }
  afterEach(() => {
    for (const lease of leases.splice(0)) lease.release();
  });

  it('takes the width of the tab and gives the exact padding back', () => {
    html.style.setProperty('padding-right', '13px', 'important');
    const lease = leaseRoom(tabHost(), 38);
    leases.push(lease);
    expect(padding()).toBe('38px');
    expect(html.style.getPropertyPriority('padding-right')).toBe('important');
    expect(JSON.parse(html.getAttribute(ROOM_ATTRIBUTE)!).value).toBe('13px');
    lease.release();
    expect(padding()).toBe('13px');
    expect(html.hasAttribute(ROOM_ATTRIBUTE)).toBe(false);
  });

  it('shares the lease with a dock: the page padding returns only after the last holder', () => {
    html.style.setProperty('padding-right', '13px');
    const lease = leaseRoom(tabHost(), 38);
    leases.push(lease);
    const weekly = dock('weekly', 360);
    weekly.open();
    expect(padding()).toBe('360px');
    lease.release();
    expect(padding()).toBe('360px');
    weekly.close();
    expect(padding()).toBe('13px');
  });

  it('takes the room back from a pane whose host a page removed', () => {
    html.style.setProperty('padding-right', '13px');
    const file = dock('file', 480);
    file.open();
    const lease = leaseRoom(tabHost(), 38);
    leases.push(lease);
    file.host.remove();
    lease.refresh();
    expect(padding()).toBe('38px');
  });

  it('leaves the page padding alone below 900 px, where the tab covers the page', () => {
    html.style.setProperty('padding-right', '13px');
    const { innerWidth } = window;
    try {
      window.innerWidth = 800;
      const lease = leaseRoom(tabHost(), 38);
      leases.push(lease);
      expect(padding()).toBe('13px');
      window.innerWidth = 1200;
      window.dispatchEvent(new Event('resize'));
      expect(padding()).toBe('38px');
    } finally {
      window.innerWidth = innerWidth;
    }
  });

  it('stops writing the padding after it was forgotten', () => {
    const lease = leaseRoom(tabHost(), 38);
    leases.push(lease);
    lease.forget();
    html.style.setProperty('padding-right', '480px');
    window.dispatchEvent(new Event('resize'));
    expect(padding()).toBe('480px');
  });
});

describe('a card pane', () => {
  const html = document.documentElement;
  // An earlier test can leave a holder that a reset of the body removed from the page.
  beforeEach(() => giveBackRoom(document));

  it('keeps the gap of the card inside its host and inside the room beside it', () => {
    html.style.setProperty('padding-right', '13px');
    const turnIn = dock('turn-in', 480, true);
    turnIn.open();
    expect(turnIn.host.hasAttribute('data-card')).toBe(true);
    expect(turnIn.host.style.width).toBe('492px');
    expect(padding()).toBe('492px');
    turnIn.close();
    expect(padding()).toBe('13px');
  });

  it('gives a dock that is no card the room of its width, with no gap', () => {
    const weekly = dock('weekly', 360);
    weekly.open();
    expect(weekly.host.hasAttribute('data-card')).toBe(false);
    expect(padding()).toBe('360px');
  });
});

describe('full view', () => {
  afterEach(() => setFullView(false));

  it('is off at the start, and no pane means no full view', () => {
    expect(isFullView()).toBe(false);
    setFullView(true);
    expect(isFullView()).toBe(false);
  });

  it('widens the host over the window and leaves the room of the page as it is', () => {
    const turnIn = dock('turn-in', 480, true);
    turnIn.open();
    setFullView(true);
    expect(isFullView()).toBe(true);
    expect(turnIn.full).toBe(true);
    expect(turnIn.host.hasAttribute('data-full')).toBe(true);
    // The host reaches from the left edge to the right edge of the window, which are the edges
    // without a scroll bar, and it has no width of its own.
    expect(turnIn.host.style.left).toBe('0px');
    expect(turnIn.host.style.right).toBe('0px');
    expect(turnIn.host.style.width).toBe('');
    expect(padding()).toBe('492px');
    setFullView(false);
    expect(turnIn.full).toBe(false);
    expect(turnIn.host.hasAttribute('data-full')).toBe(false);
    expect(turnIn.host.style.left).toBe('');
    expect(turnIn.host.style.width).toBe('492px');
    expect(padding()).toBe('492px');
  });

  it('tells the watchers once for each change', () => {
    const calls: boolean[] = [];
    const stop = watchFullView(() => calls.push(isFullView()));
    dock('file', 480, true).open();
    setFullView(true);
    setFullView(true);
    setFullView(false);
    setFullView(false);
    stop();
    setFullView(true);
    expect(calls).toEqual([true, false]);
  });

  it('shows a pane that covers another one in full view too, and the pane under it again after it closes', () => {
    const turnIn = dock('turn-in', 480, true);
    const file = dock('file', 600, true);
    turnIn.open();
    setFullView(true);
    turnIn.setHidden(true);
    file.open();
    expect(file.full).toBe(true);
    expect(file.host.style.left).toBe('0px');
    expect(file.host.style.width).toBe('');
    file.close();
    turnIn.setHidden(false);
    expect(isFullView()).toBe(true);
    expect(turnIn.full).toBe(true);
    expect(padding()).toBe('492px');
  });

  it('ends with the last pane, and a pane that opens later starts in its place', () => {
    const turnIn = dock('turn-in', 480, true);
    turnIn.open();
    setFullView(true);
    turnIn.close();
    expect(isFullView()).toBe(false);
    const next = dock('feedback', 480, true);
    next.open();
    expect(next.full).toBe(false);
    expect(next.host.style.width).toBe('492px');
  });

  it('does not start the next pane in full view when a page removed the host of the last one', () => {
    const turnIn = dock('turn-in', 480, true);
    turnIn.open();
    setFullView(true);
    turnIn.host.remove();
    const next = dock('feedback', 480, true);
    next.open();
    expect(next.full).toBe(false);
    expect(isFullView()).toBe(false);
  });

  it('ends full view when the last pane is forgotten', () => {
    const turnIn = dock('turn-in', 480, true);
    turnIn.open();
    setFullView(true);
    turnIn.forget();
    expect(isFullView()).toBe(false);
  });

  it('ends when a page removed the host of the only pane', () => {
    const turnIn = dock('turn-in', 480, true);
    turnIn.open();
    setFullView(true);
    turnIn.host.remove();
    expect(isFullView()).toBe(false);
  });

  it.each(['turn-in', 'feedback'] as const)(
    'ends with the close of a %s pane that covers a hidden file pane, and the file pane comes back out of full view',
    (role) => {
      const file = dock('file', 600, true);
      const pane = dock(role, 480, true);
      file.open();
      pane.open();
      file.setHidden(true);
      setFullView(true);
      expect(pane.full).toBe(true);
      pane.close();
      file.setHidden(false);
      expect(isFullView()).toBe(false);
      expect(file.full).toBe(false);
      expect(file.host.style.left).toBe('');
      expect(file.host.style.width).toBe('612px');
    },
  );

  it('keeps full view for a pane that a closing file pane uncovers, whichever pane it is', () => {
    const feedback = dock('feedback', 480, true);
    const file = dock('file', 600, true);
    feedback.open();
    setFullView(true);
    feedback.setHidden(true);
    file.open();
    file.close();
    feedback.setHidden(false);
    expect(isFullView()).toBe(true);
    expect(feedback.full).toBe(true);
  });

  it('never fills the window on a narrow window, and comes back when the window is wide again', () => {
    const { innerWidth } = window;
    try {
      const turnIn = dock('turn-in', 480, true);
      turnIn.open();
      setFullView(true);
      window.innerWidth = 800;
      window.dispatchEvent(new Event('resize'));
      expect(fullViewAvailable()).toBe(false);
      expect(turnIn.full).toBe(false);
      expect(turnIn.host.style.width).toBe('100vw');
      expect(turnIn.host.hasAttribute('data-full')).toBe(false);
      window.innerWidth = 1200;
      window.dispatchEvent(new Event('resize'));
      expect(fullViewAvailable()).toBe(true);
      expect(turnIn.full).toBe(true);
    } finally {
      window.innerWidth = innerWidth;
    }
  });

  it('is no state of the weekly dock', () => {
    const weekly = dock('weekly', 360);
    const turnIn = dock('turn-in', 480, true);
    weekly.open();
    turnIn.open();
    setFullView(true);
    expect(weekly.full).toBe(false);
    expect(weekly.host.style.width).toBe('360px');
  });

  it('ignores an Escape that a script made', () => {
    const turnIn = dock('turn-in', 480, true);
    turnIn.open();
    setFullView(true);
    turnIn.section.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isFullView()).toBe(true);
  });
});
