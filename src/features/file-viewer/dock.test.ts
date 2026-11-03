// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDock, filePaneOpen, hideFilePane, type Dock, type DockRole } from './dock';

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
