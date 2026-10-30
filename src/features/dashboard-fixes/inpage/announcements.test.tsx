// @vitest-environment happy-dom
import { act } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { announcementsFix } from './announcements';
import {
  COURSES,
  dashboardData,
  drawDashboard,
  fakeContext,
  type FakeContext,
} from './testing/dashboard';
import type { AnnouncementEntry } from '../protocol';

const ITEM = '[data-testid="announcement-item-31901"]';
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

function replies(
  context: FakeContext,
  message = '<p>Hello <strong>world</strong></p><script>x()</script>',
): void {
  context.answer((request) => {
    const type = (request as { type: string }).type;
    if (type === 'weekrow:announcement') return { title: 'T', message };
    if (type === 'weekrow:announcement-list') {
      const entries: AnnouncementEntry[] = [
        {
          id: '1',
          courseId: '101',
          title: 'First',
          message: '<p>one</p>',
          postedAt: '2026-10-27T12:00:00Z',
          author: 'Dr. Okafor',
          read: false,
        },
        {
          id: '2',
          courseId: '101',
          title: 'Second',
          message: '<p>two</p>',
          postedAt: null,
          author: null,
          read: true,
        },
      ];
      return entries;
    }
    return undefined;
  });
}

function messageText(): string {
  return (
    document.querySelector(`${ITEM} > [data-wr-own]`)?.shadowRoot?.querySelector('.wr-body')
      ?.textContent ?? ''
  );
}

let fix: ReturnType<typeof announcementsFix>;
let context: FakeContext;

beforeEach(() => {
  drawDashboard();
  fix = announcementsFix();
  context = fakeContext();
  replies(context);
  fix.apply(context);
});
afterEach(() => fix.remove());

function readMore(): HTMLAnchorElement {
  return document.querySelector(`${ITEM} a[href*="discussion_topics"]`) as HTMLAnchorElement;
}

describe('announcementsFix: Read more', () => {
  it('marks the pieces of each item and puts the course filter after the read filter', () => {
    expect(document.querySelector(`${ITEM} [data-wr-snippet]`)).not.toBeNull();
    expect(document.querySelector(`${ITEM} [data-wr-title]`)?.textContent).toContain(
      'Lab room change',
    );
    const filter = document.querySelector('[data-wr-filter]');
    expect(
      filter?.previousElementSibling?.querySelector('[data-testid="announcement-filter-select"]'),
    ).not.toBeNull();
    expect(
      [...(filter?.querySelectorAll('option') ?? [])].map((option) => option.textContent),
    ).toEqual(['All courses', ...COURSES.map((course) => course.name)]);
  });

  it('intercepts a plain click on Read more, opens the message in a shadow root', async () => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    readMore().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fix.apply(context);
    await flush();
    expect(messageText()).toBe('Hello world');
    expect(
      document.querySelector(`${ITEM} [data-wr-own]`)?.shadowRoot?.querySelector('script'),
    ).toBeNull();
    expect(context.sent).toEqual([
      { type: 'weekrow:announcement', courseId: '101', topicId: '31901' },
    ]);
    expect(document.querySelector(ITEM)?.hasAttribute('data-wr-open')).toBe(true);
  });

  it('opens with a click on the title, and leaves a click with a modifier key to the browser', async () => {
    const title = document.querySelector(`${ITEM} [data-wr-title]`) as HTMLElement;
    const modified = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      shiftKey: true,
    });
    title.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    const middle = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 });
    readMore().dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(false);
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    fix.apply(context);
    await flush();
    expect(messageText()).toBe('Hello world');
  });

  it('stops the click before the listeners of the page see it', () => {
    let seen = false;
    document.body.addEventListener('click', () => (seen = true));
    readMore().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(seen).toBe(false);
  });

  it('sends only the request for the message, however many passes draw it', async () => {
    readMore().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    for (let pass = 0; pass < 4; pass += 1) {
      fix.apply(context);
      await flush();
    }
    expect(context.sent).toEqual([
      { type: 'weekrow:announcement', courseId: '101', topicId: '31901' },
    ]);
  });

  it('closes with Show less, and leaves the read state and the item alone', async () => {
    readMore().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    fix.apply(context);
    await flush();
    fix.apply(context);
    await flush();
    const less = [
      ...(document
        .querySelector(`${ITEM} > [data-wr-own]`)
        ?.shadowRoot?.querySelectorAll('button') ?? []),
    ].find((button) => button.textContent === 'Show less');
    less?.click();
    fix.apply(context);
    expect(document.querySelector(`${ITEM} > [data-wr-own]`)).toBeNull();
    expect(document.querySelector(ITEM)?.hasAttribute('data-wr-open')).toBe(false);
    expect(document.querySelector(ITEM)?.hasAttribute('data-wr-gone')).toBe(false);
    expect(document.querySelector(ITEM)?.hasAttribute('data-wr-read')).toBe(false);
    expect(context.sent).toEqual([
      { type: 'weekrow:announcement', courseId: '101', topicId: '31901' },
    ]);
  });

  it('shows a link to Canvas when the message does not load', async () => {
    context.answer(() => Promise.reject(new Error('down')));
    readMore().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    fix.apply(context);
    await flush();
    const note = document
      .querySelector(`${ITEM} > [data-wr-own]`)
      ?.shadowRoot?.querySelector('[role="status"]');
    expect(note?.textContent).toContain("Couldn't load the announcement.");
    expect(note?.querySelector('a')?.getAttribute('href')).toBe(
      'https://school.instructure.com/courses/101/discussion_topics/31901',
    );
  });

  it('keeps the message open when React draws the item again', async () => {
    readMore().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    fix.apply(context);
    await flush();
    drawDashboard();
    expect(document.querySelector(`${ITEM} > [data-wr-own]`)).toBeNull();
    fix.apply(context);
    await flush();
    expect(messageText()).toBe('Hello world');
  });
});

describe('announcementsFix: keyboard and read state', () => {
  const open = async () => {
    readMore().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    fix.apply(context);
    await flush();
    fix.apply(context);
    await flush();
  };
  const hostOf = () => document.querySelector<HTMLElement>(`${ITEM} > [data-wr-own]`);
  const lessButton = () =>
    [...(hostOf()?.shadowRoot?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === 'Show less',
    );

  it('moves the focus into the message when it opens, and back to Read more when it closes', async () => {
    await open();
    expect(hostOf()?.shadowRoot?.activeElement).toBe(lessButton());
    lessButton()?.click();
    fix.apply(context);
    await flush();
    expect(document.activeElement).toBe(readMore());
  });

  it('shows no line about a read mark, whether Canvas shows the announcement as read or not', async () => {
    await open();
    expect(hostOf()?.shadowRoot?.textContent).not.toContain('Marked as read');
    lessButton()?.click();
    fix.apply(context);
    await flush();
    document
      .querySelector(`${ITEM} [data-testid="mark-read-31901"]`)
      ?.setAttribute('data-testid', 'mark-unread-31901');
    await open();
    expect(hostOf()?.shadowRoot?.textContent).not.toContain('Marked as read');
    expect(context.sent.map((m) => (m as { type: string }).type)).toEqual(['weekrow:announcement']);
  });

  it('builds the message once, however many passes run', async () => {
    await open();
    const body = hostOf()?.shadowRoot?.querySelector('.wr-body');
    fix.apply(context);
    await flush();
    expect(hostOf()?.shadowRoot?.querySelector('.wr-body')).toBe(body);
  });

  it('leaves a click alone in a widget that the fix did not find', () => {
    document.querySelector('[data-testid="announcement-filter-select"]')?.remove();
    fix.apply(context);
    drawDashboard();
    document.querySelector('[data-testid="announcement-filter-select"]')?.remove();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    readMore().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('announcementsFix: the course filter', () => {
  const select = () =>
    document.querySelector<HTMLSelectElement>('[data-wr-filter] select') as HTMLSelectElement;

  async function choose(id: string): Promise<void> {
    select().value = id;
    select().dispatchEvent(new Event('change', { bubbles: true }));
    fix.apply(context);
    await flush();
    fix.apply(context);
    await flush();
  }

  it('hides the list and the pager of the widget and lists the announcements of the course', async () => {
    await choose('101');
    const widget = document.querySelector('[data-testid="widget-announcements-widget"]');
    expect(widget?.hasAttribute('data-wr-filtered')).toBe(true);
    const list = widget?.querySelector('[data-wr-list]')?.shadowRoot;
    // Unread is the read filter, so the read announcement stays out.
    expect(list?.textContent).toContain('First');
    expect(list?.textContent).not.toContain('Second');
    expect(context.sent).toContainEqual({ type: 'weekrow:announcement-list', courseId: '101' });
  });

  it('asks for a course once, and goes back to the widget list with All courses', async () => {
    await choose('101');
    await choose('');
    await choose('101');
    expect(
      context.sent.filter((m) => (m as { type: string }).type === 'weekrow:announcement-list'),
    ).toHaveLength(1);
    await choose('');
    expect(document.querySelector('[data-wr-list]')).toBeNull();
    expect(
      document
        .querySelector('[data-testid="widget-announcements-widget"]')
        ?.hasAttribute('data-wr-filtered'),
    ).toBe(false);
  });

  it('says so when the announcements of the course do not load', async () => {
    context.answer(() => Promise.reject(new Error('down')));
    await choose('102');
    expect(document.querySelector('[data-wr-list]')?.shadowRoot?.textContent).toContain(
      "Couldn't load the announcements of this course.",
    );
  });

  it('asks again for a course that failed once the background has new data', async () => {
    context.answer(() => Promise.reject(new Error('down')));
    await choose('101');
    replies(context);
    fix.reload?.();
    fix.apply(context);
    await flush();
    fix.apply(context);
    await flush();
    expect(document.querySelector('[data-wr-list]')?.shadowRoot?.textContent).toContain('First');
  });

  it('opens a message in place inside the filtered list', async () => {
    await choose('101');
    const button = [
      ...(document.querySelector('[data-wr-list]')?.shadowRoot?.querySelectorAll('button') ?? []),
    ].find((candidate) => candidate.textContent === 'Read more');
    act(() => button?.click());
    await flush();
    expect(
      document.querySelector('[data-wr-list]')?.shadowRoot?.querySelector('.wr-body')?.textContent,
    ).toBe('Hello world');
  });

  it('keeps an unread entry in the list after the message opens and closes, and sends no write', async () => {
    await choose('101');
    const shadow = () => document.querySelector('[data-wr-list]')?.shadowRoot;
    const press = (label: string) =>
      act(() =>
        [...(shadow()?.querySelectorAll('button') ?? [])]
          .find((candidate) => candidate.textContent === label)
          ?.click(),
      );
    expect(shadow()?.textContent).toContain('First');
    press('Read more');
    await flush();
    expect(shadow()?.querySelector('.wr-body')?.textContent).toBe('Hello world');
    expect(shadow()?.textContent).not.toContain('Marked as read');
    press('Show less');
    await flush();
    expect(shadow()?.querySelector('.wr-body')).toBeNull();
    expect(shadow()?.textContent).toContain('First');
    const types = context.sent.map((m) => (m as { type: string }).type);
    expect(types.filter((type) => type !== 'weekrow:announcement-list')).toEqual([
      'weekrow:announcement',
    ]);
  });
});

describe('announcementsFix: remove', () => {
  it('gives back the page: no node, no mark, no listener', async () => {
    readMore().dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
    );
    fix.apply(context);
    await flush();
    fix.remove();
    expect(document.querySelector('[data-wr-own]')).toBeNull();
    for (const attribute of [
      'ann',
      'bar',
      'content',
      'snippet',
      'more',
      'title',
      'open',
      'gone',
      'filtered',
    ]) {
      expect(document.querySelector(`[data-wr-${attribute}]`), attribute).toBeNull();
    }
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    readMore().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('announcementsFix: with no data yet', () => {
  it('still opens messages, and adds no filter', () => {
    fix.remove();
    drawDashboard();
    const bare = fakeContext(null);
    const again = announcementsFix();
    again.apply(bare);
    expect(document.querySelector('[data-wr-filter]')).toBeNull();
    expect(dashboardData().courses.length).toBeGreaterThan(0);
    again.remove();
  });
});
