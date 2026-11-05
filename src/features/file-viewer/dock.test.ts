// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDock,
  filePaneOpen,
  giveBackRoom,
  hideFilePane,
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
