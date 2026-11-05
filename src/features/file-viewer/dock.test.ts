// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDock,
  filePaneOpen,
  giveBackRoom,
  hideFilePane,
  leaseRoom,
  removeStaleWeeklyDock,
  ROOM_ATTRIBUTE,
  WEEKLY_HOST_ID,
  WEEKLY_TAB_ID,
  type Dock,
  type DockRole,
} from './dock';

const padding = () => document.documentElement.style.getPropertyValue('padding-right');
const docks: Dock[] = [];

function dock(role: DockRole, width: number): Dock {
  const made = createDock({
    role,
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
