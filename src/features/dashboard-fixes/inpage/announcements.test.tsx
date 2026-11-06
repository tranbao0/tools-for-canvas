// @vitest-environment happy-dom
import { act } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AVATAR_COLORS,
  announcementsFix,
  initialsOf,
  localToday,
  rangeDays,
} from './announcements';
import { drawDashboard, fakeContext, type FakeContext } from './testing/dashboard';
import type { AnnouncementListRow } from '../protocol';

const WIDGET = '[data-testid="widget-announcements-widget"]';

function row(id: string, patch: Partial<AnnouncementListRow> = {}): AnnouncementListRow {
  return {
    id,
    courseId: '101',
    courseName: 'BIO 110: Principles of Biology',
    title: `Topic ${id}`,
    postedAt: '2026-10-20T15:00:00Z',
    author: 'Dr. Maya Okafor',
    avatarUrl: null,
    read: false,
    message: `<p>Message of <b>${id}</b></p>`,
    ...patch,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

/** Clicks as the student does: happy-dom marks only a native click as trusted. */
async function clickTrusted(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    Object.defineProperty(MouseEvent.prototype, 'isTrusted', {
      get: () => true,
      configurable: true,
    });
    element?.click();
    await vi.advanceTimersByTimeAsync(400);
  });
  await flush();
  delete (MouseEvent.prototype as { isTrusted?: boolean }).isTrusted;
}

interface Server {
  rows: AnnouncementListRow[];
  failPages: boolean;
  failRanges: boolean;
  markOk: boolean;
  /** The range reply says that the range holds more rows than it carries. */
  truncated: boolean;
  /** The first page holds rows of the server that the projection drops, so it shows no row. */
  dropFirstPage: boolean;
}

function serve(context: FakeContext, server: Server): void {
  context.answer((message) => {
    const request = message as Record<string, unknown>;
    switch (request['type']) {
      case 'weekrow:announcement-page': {
        if (server.failPages) throw new Error('offline');
        const filtered = server.rows.filter(
          (candidate) =>
            (request['courseId'] === null || candidate.courseId === request['courseId']) &&
            (request['read'] === 'all' || candidate.read === (request['read'] === 'read')),
        );
        const offset = request['offset'] as number;
        const first = request['first'] as number;
        const slice = filtered.slice(offset, offset + first);
        if (server.dropFirstPage && offset === 0) {
          return {
            items: [],
            count: slice.length,
            userId: '7',
            total: filtered.length,
            hasNext: true,
          };
        }
        return {
          items: slice,
          count: slice.length,
          userId: '7',
          total: filtered.length,
          hasNext: offset + first < filtered.length,
        };
      }
      case 'weekrow:announcement-mark': {
        const found = server.rows.find(
          (candidate) =>
            candidate.courseId === request['courseId'] && candidate.id === request['topicId'],
        );
        if (server.markOk && found !== undefined) found.read = request['read'] === true;
        return { ok: server.markOk };
      }
      case 'weekrow:announcement-range':
        if (server.failRanges) throw new Error('offline');
        return {
          items: server.rows.filter((candidate) => candidate.postedAt !== null),
          userId: '7',
          truncated: server.truncated,
        };
      case 'weekrow:announcement':
        return { title: 'T', message: '<p>Hello <strong>world</strong></p><script>x()</script>' };
    }
    return undefined;
  });
}

const many = (count: number) =>
  Array.from({ length: count }, (_unused, index) => row(String(index + 1)));

let fix: ReturnType<typeof announcementsFix>;
let context: FakeContext;
let server: Server;

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`${WIDGET} [data-wr-list]`);
}
function shadow(selector: string): HTMLElement | null {
  return host()?.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}
function shadowAll(selector: string): HTMLElement[] {
  return [...(host()?.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])];
}
function sentOf(type: string): Record<string, unknown>[] {
  return context.sent.filter((message) => (message as { type: string }).type === type) as Record<
    string,
    unknown
  >[];
}

/** Lets the requests answer, and runs the passes that the fix asks for, as the engine does. */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round++) {
    const asked = context.again.mock.calls.length;
    await flush();
    if (context.again.mock.calls.length > asked) fix.apply(context);
  }
}

async function start(rows: AnnouncementListRow[] = many(25)): Promise<void> {
  server.rows = rows;
  fix.apply(context);
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  drawDashboard();
  fix = announcementsFix();
  context = fakeContext();
  server = {
    rows: [],
    failPages: false,
    failRanges: false,
    markOk: true,
    truncated: false,
    dropFirstPage: false,
  };
  serve(context, server);
});
afterEach(() => {
  fix.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the list replaces the one of Canvas', () => {
  it('hides the list and the pager of Canvas from the first pass on, and loads 10 rows', async () => {
    server.rows = many(25);
    fix.apply(context);
    // Before the first page arrives, Canvas's list is already hidden.
    expect(document.querySelector(WIDGET)?.hasAttribute('data-wr-filtered')).toBe(true);
    await settle();
    expect(sentOf('weekrow:announcement-page')[0]).toEqual({
      type: 'weekrow:announcement-page',
      courseId: null,
      read: 'unread',
      offset: 0,
      first: 10,
    });
    expect(shadowAll('article')).toHaveLength(10);
    expect(shadow('[role=feed]')?.getAttribute('tabindex')).toBe('0');
    expect(shadow('[role=feed]')?.getAttribute('aria-label')).toBe('Announcements');
    expect(shadowAll('article')[0]?.getAttribute('aria-label')).toBe('Topic 1');
  });

  it('marks the pieces of the widget, and puts the course filter after the read filter', async () => {
    await start();
    const widget = document.querySelector(WIDGET)!;
    expect(widget.hasAttribute('data-wr-ann')).toBe(true);
    const filter = document.querySelector('[data-wr-filter]');
    expect(
      filter?.previousElementSibling?.querySelector('[data-testid="announcement-filter-select"]'),
    ).not.toBeNull();
    expect(host()?.parentElement?.hasAttribute('data-wr-bar')).toBe(true);
  });

  it('shows Canvas again when the first page of all courses fails, and nothing of the fix stays', async () => {
    server.failPages = true;
    await start();
    expect(host()).toBeNull();
    expect(document.querySelector('[data-wr-filter]')).toBeNull();
    expect(document.querySelector('[data-wr-own]')).toBeNull();
    const widget = document.querySelector(WIDGET)!;
    expect(widget.getAttribute('data-wr-filtered')).toBeNull();
    expect(widget.getAttributeNames().filter((name) => name.startsWith('data-wr-'))).toEqual([]);
  });

  it('comes back when a later reload finds the page', async () => {
    server.failPages = true;
    await start();
    expect(host()).toBeNull();
    server.failPages = false;
    fix.reload?.();
    await settle();
    expect(shadowAll('article')).toHaveLength(10);
    expect(document.querySelector(WIDGET)?.hasAttribute('data-wr-filtered')).toBe(true);
  });

  it('removes every mark and node when the fix goes', async () => {
    const before = document.querySelector(WIDGET)!.outerHTML;
    await start();
    fix.remove();
    expect(document.querySelector(WIDGET)!.outerHTML).toBe(before);
  });
});

describe('a row', () => {
  it('shows the title, the author and the date, the course, the snippet and Read more', async () => {
    await start([
      row('1', {
        title: 'L'.repeat(90),
        message: `<p>${'word '.repeat(60)}</p>`,
      }),
    ]);
    const article = shadow('article')!;
    expect(article.querySelector('.wr-a-title')?.textContent).toBe(`${'L'.repeat(75)}...`);
    const meta = [...article.querySelectorAll('.wr-a-meta')].map((node) => node.textContent);
    expect(meta[0]).toMatch(/^Sent by Dr\. Maya Okafor \| Oct 2\d, 2026$/);
    expect(meta[1]).toBe('BIO 110: Principles of Biology');
    expect(article.querySelector('.wr-a-snippet')?.textContent?.endsWith('...')).toBe(true);
    expect(article.querySelector('.wr-a-snippet')?.textContent?.length).toBeGreaterThan(110);
    expect(article.querySelector('.wr-a-snippet')?.textContent?.length).toBeLessThanOrEqual(123);
    expect(article.querySelector('.wr-a-more button')?.textContent).toBe('Read more');
  });

  it('shows the initials on a color when there is no image, and an image with strict attributes', async () => {
    await start([
      row('1', { avatarUrl: 'https://school.instructure.com/images/a.png' }),
      row('2', { author: 'Fabio Di Troia' }),
      row('3', { author: null }),
    ]);
    const [first, second, third] = shadowAll('.wr-a-avatar');
    const image = first?.querySelector('img');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image?.getAttribute('src')).toBe('https://school.instructure.com/images/a.png');
    expect(second?.textContent).toBe('FT');
    expect(second?.querySelector('img')).toBeNull();
    expect(third?.textContent).toBe('?');
  });

  it('falls back to the initials when the image fails', async () => {
    await start([row('1', { avatarUrl: 'https://school.instructure.com/images/a.png' })]);
    const image = shadow('.wr-a-avatar img')!;
    await act(async () => {
      image.dispatchEvent(new Event('error'));
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(shadow('.wr-a-avatar img')).toBeNull();
    expect(shadow('.wr-a-avatar')?.textContent).toBe('DO');
  });

  it('opens the whole message in place and sends no mark', async () => {
    await start(many(3));
    const event = shadowAll('.wr-a-more button')[0]!;
    await act(async () => {
      event.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    const article = shadowAll('article')[0]!;
    expect(article.querySelector('.wr-body')?.textContent).toBe('Hello world');
    expect(article.querySelector('script')).toBeNull();
    expect(article.querySelector('.wr-a-snippet')).toBeNull();
    expect(article.querySelector('.wr-a-title')?.textContent).toBe('Topic 1');
    expect(sentOf('weekrow:announcement')).toEqual([
      { type: 'weekrow:announcement', courseId: '101', topicId: '1' },
    ]);
    expect(sentOf('weekrow:announcement-mark')).toEqual([]);

    await act(async () => {
      [...article.querySelectorAll('button')].find((b) => b.textContent === 'Show less')?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(shadowAll('article')[0]?.querySelector('.wr-body')).toBeNull();
    expect(sentOf('weekrow:announcement-mark')).toEqual([]);
  });

  it('keeps a message that arrives after the fix went out of the next student view', async () => {
    await start(many(3));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const send = vi.mocked(context.send);
    const inner = send.getMockImplementation()!;
    let held = false;
    send.mockImplementation(async (message) => {
      if ((message as { type: string }).type !== 'weekrow:announcement' || held)
        return inner(message);
      held = true;
      context.sent.push(message);
      await gate;
      return { title: 'T', message: '<p>Copy of the first student</p>' };
    });
    await act(async () => {
      shadowAll('.wr-a-more button')[0]?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    fix.remove();
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(400);
    });

    await start(many(3));
    await act(async () => {
      shadowAll('.wr-a-more button')[0]?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(sentOf('weekrow:announcement')).toHaveLength(2);
    expect(shadowAll('article')[0]?.querySelector('.wr-body')?.textContent).toBe('Hello world');
  });

  it('opens the whole title of a long title', async () => {
    await start([row('1', { title: 'T'.repeat(90) })]);
    await act(async () => {
      shadowAll('.wr-a-more button')[0]?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(shadow('.wr-a-title')?.textContent).toBe('T'.repeat(90));
  });
});

describe('the read control', () => {
  it('sends the mark only on a click of the student', async () => {
    await start(many(3));
    const control = shadowAll('.wr-a-read')[0]!;
    expect(control.getAttribute('aria-pressed')).toBe('false');
    expect(control.getAttribute('aria-label')).toBe('Mark Topic 1 as read');

    // A click that a script makes is not trusted.
    await act(async () => {
      control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(sentOf('weekrow:announcement-mark')).toEqual([]);
  });

  it('shows the check at once, sends the mark, and takes the row out after the hold', async () => {
    await start(many(3));
    const control = shadowAll('.wr-a-read')[0]!;
    // happy-dom marks every event as trusted only through a native click.
    await act(async () => {
      Object.defineProperty(MouseEvent.prototype, 'isTrusted', {
        get: () => true,
        configurable: true,
      });
      control.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    delete (MouseEvent.prototype as { isTrusted?: boolean }).isTrusted;
    expect(sentOf('weekrow:announcement-mark')).toEqual([
      {
        type: 'weekrow:announcement-mark',
        courseId: '101',
        topicId: '1',
        userId: '7',
        read: true,
      },
    ]);
    expect(shadowAll('article')).toHaveLength(3);
    expect(shadowAll('.wr-a-read')[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(shadowAll('.wr-a-read')[0]?.getAttribute('aria-label')).toBe('Mark Topic 1 as unread');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await flush();
    expect(shadowAll('article').map((article) => article.getAttribute('aria-label'))).toEqual([
      'Topic 2',
      'Topic 3',
    ]);
  });

  it('puts the row back with a short note when the reply is not ok', async () => {
    server.markOk = false;
    await start(many(3));
    await act(async () => {
      Object.defineProperty(MouseEvent.prototype, 'isTrusted', {
        get: () => true,
        configurable: true,
      });
      shadowAll('.wr-a-read')[0]?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    delete (MouseEvent.prototype as { isTrusted?: boolean }).isTrusted;
    expect(shadowAll('.wr-a-read')[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(shadow('.wr-a-res [role=status]')?.textContent).toBe("Couldn't change the read mark.");
    await flush();
  });
});

describe('the filter round trip', () => {
  const choose = (label: string): void => {
    (document.querySelector('#ann-read') as HTMLInputElement).value = label;
    fix.apply(context);
  };

  it('takes a row in its hold out of the Unread list when the student leaves the filter', async () => {
    await start(many(3));
    await clickTrusted(shadowAll('.wr-a-read')[0]);
    expect(shadowAll('article')).toHaveLength(3);

    choose('Read');
    await settle();
    expect(shadowAll('article').map((article) => article.getAttribute('aria-label'))).toEqual([
      'Topic 1',
    ]);
    choose('Unread');
    await settle();
    expect(shadowAll('article').map((article) => article.getAttribute('aria-label'))).toEqual([
      'Topic 2',
      'Topic 3',
    ]);
  });
});

describe('paging', () => {
  type Callback = (entries: { isIntersecting: boolean }[]) => void;
  let observers: { callback: Callback; options: IntersectionObserverInit; root: Element | null }[];

  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: Callback, options: IntersectionObserverInit) {
          observers.push({ callback, options, root: (options.root as Element | null) ?? null });
        }
        observe() {}
        disconnect() {}
      },
    );
  });

  it('loads 10 more when the sentinel comes near the end of the scroll area', async () => {
    await start(many(25));
    const live = observers.at(-1)!;
    expect(live.root).toBe(shadow('.wr-a-scroll'));
    expect(live.options.rootMargin).toBe('0px 0px 200px 0px');

    await act(async () => {
      live.callback([{ isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(sentOf('weekrow:announcement-page').at(-1)).toMatchObject({ offset: 10, first: 10 });
    expect(shadowAll('article')).toHaveLength(20);
  });

  it('shows the end line when no more exist, and an error line with Retry', async () => {
    await start(many(12));
    await act(async () => {
      observers.at(-1)?.callback([{ isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(shadowAll('article')).toHaveLength(12);
    expect(shadow('.wr-a-scroll')?.textContent).toContain('No more announcements');
    expect(shadow('.wr-a-sentinel')).toBeNull();
  });

  it('keeps asking for pages after a first page that shows no row, and shows no empty text', async () => {
    server.dropFirstPage = true;
    await start(many(25));
    expect(shadowAll('article')).toHaveLength(0);
    expect(shadow('.wr-a-scroll')?.textContent).not.toContain('No unread announcements');
    expect(shadow('.wr-a-sentinel')).not.toBeNull();

    await act(async () => {
      observers.at(-1)?.callback([{ isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(sentOf('weekrow:announcement-page').at(-1)).toMatchObject({ offset: 10, first: 10 });
    expect(shadowAll('article')).toHaveLength(10);
  });

  it('shows Retry when a later page fails, and loads it on a click', async () => {
    await start(many(25));
    server.failPages = true;
    await act(async () => {
      observers.at(-1)?.callback([{ isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(shadow('.wr-a-scroll')?.textContent).toContain("Couldn't load more announcements.");
    server.failPages = false;
    await act(async () => {
      shadowAll('.wr-a-line button')[0]?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(shadowAll('article')).toHaveLength(20);
  });
});

describe('search by topic', () => {
  const searchable = [
    row('1', {
      title: 'Gentle Reminder: test your laptop',
      message: '<p>Use the Lockdown Browser.</p>',
    }),
    row('2', {
      title: 'HW2 on Thursday',
      message: '<p>Install the lockdown browser.</p>',
      read: true,
    }),
    row('3', { title: 'Office hours', message: '<p>Thursday 3pm.</p>' }),
    ...many(8).map((entry, index) => ({ ...entry, id: String(10 + index) })),
  ];

  async function type(value: string): Promise<void> {
    const input = shadow('input[type=search]') as HTMLInputElement;
    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
  }

  it('loads every announcement once, and shows the matches with the match in <mark>', async () => {
    await start(searchable);
    await type('lockdown');
    const pages = sentOf('weekrow:announcement-page').filter((message) => message['first'] === 100);
    expect(pages).toEqual([
      {
        type: 'weekrow:announcement-page',
        courseId: null,
        read: 'all',
        offset: 0,
        first: 100,
      },
    ]);
    expect(shadowAll('article')).toHaveLength(2);
    expect(shadow('.wr-a-res [role=status]')?.textContent).toBe('2 results, read and unread');
    const marks = shadowAll('mark').map((node) => node.textContent);
    expect(marks).toEqual(['Lockdown', 'lockdown']);
    // The read filter does not apply: the read row is in the results.
    expect(shadowAll('.wr-a-read[data-read=true]')).toHaveLength(1);
    // A second search does not load again.
    await type('lockdown browser');
    expect(
      sentOf('weekrow:announcement-page').filter((message) => message['first'] === 100),
    ).toHaveLength(1);
  });

  it('says that a search cut at 20 pages covers the newest 2000, and shows no end line', async () => {
    await start([
      row('1', { title: 'Lockdown Browser', message: '<p>Use it.</p>' }),
      ...Array.from({ length: 2100 }, (_unused, index) => row(String(10 + index))),
    ]);
    await type('lockdown');
    const line = shadow('.wr-a-res [role=status]')?.textContent ?? '';
    expect(line).toMatch(/^1 result, read and unread\./);
    expect(line).toContain('Searched the newest 2000 announcements');
    expect(shadow('.wr-a-scroll')?.textContent).not.toContain('No more announcements');
  });

  it('ends a search that covered every announcement with the end line', async () => {
    await start(searchable);
    await type('lockdown');
    expect(shadow('.wr-a-res [role=status]')?.textContent).toBe('2 results, read and unread');
    expect(shadow('.wr-a-scroll')?.textContent).toContain('No more announcements');
  });

  it('builds the highlight from text nodes and never from markup', async () => {
    await start([
      row('1', { title: '<img src=x onerror=alert(1)> lockdown', message: '<p>a</p>' }),
    ]);
    await type('lockdown');
    expect(shadow('article img')).toBeNull();
    expect(shadow('.wr-a-title')?.textContent).toBe('<img src=x onerror=alert(1)> lockdown');
    expect(shadow('.wr-a-title mark')?.textContent).toBe('lockdown');
  });

  it('is no search for one character, says when nothing matches, and the x goes back to the list', async () => {
    await start(searchable);
    await type('l');
    expect(
      sentOf('weekrow:announcement-page').filter((message) => message['first'] === 100),
    ).toEqual([]);
    await type('zebra');
    expect(shadow('.wr-a-scroll')?.textContent).toContain('No announcements match');
    await act(async () => {
      shadow('.wr-a-x')?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect((shadow('input[type=search]') as HTMLInputElement).value).toBe('');
    expect(shadowAll('article')).toHaveLength(10);
  });

  it('narrows the results by the course filter', async () => {
    await start([
      row('1', { courseId: '101', title: 'lockdown A' }),
      row('2', { courseId: '102', title: 'lockdown B' }),
    ]);
    await type('lockdown');
    expect(shadowAll('article')).toHaveLength(2);
    const select = document.querySelector<HTMLSelectElement>('[data-wr-filter] select')!;
    await act(async () => {
      select.value = '102';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    fix.apply(context);
    await flush();
    expect(shadowAll('article')).toHaveLength(1);
    expect(shadow('.wr-a-title')?.textContent).toBe('lockdown B');
  });
});

describe('search by date', () => {
  async function setDate(label: string, value: string): Promise<void> {
    const input = shadowAll('.wr-a-dates label')
      .find((node) => node.querySelector('span')?.textContent === label)
      ?.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
  }

  async function openDates(): Promise<void> {
    await act(async () => {
      shadow('.wr-a-cal')?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
  }

  it('opens From and To with the button, which says that it is expanded', async () => {
    await start();
    const button = shadow('.wr-a-cal')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Search by date');
    await openDates();
    expect(shadow('.wr-a-cal')?.getAttribute('aria-expanded')).toBe('true');
    expect(shadowAll('.wr-a-dates input[type=date]')).toHaveLength(2);
  });

  it('sends the range when a date is set, with today for a missing To and 2000-01-01 for a missing From', async () => {
    await start();
    await openDates();
    await setDate('From', '2026-10-01');
    expect(sentOf('weekrow:announcement-range')).toEqual([
      {
        type: 'weekrow:announcement-range',
        courseId: null,
        from: '2026-10-01',
        to: localToday(),
      },
    ]);
    await setDate('From', '');
    await setDate('To', '2026-10-31');
    expect(sentOf('weekrow:announcement-range').at(-1)).toEqual({
      type: 'weekrow:announcement-range',
      courseId: null,
      from: '2000-01-01',
      to: '2026-10-31',
    });
    expect(shadowAll('article').length).toBeGreaterThan(0);
    expect(shadow('.wr-a-res [role=status]')?.textContent).toMatch(/results?, read and unread/);
  });

  it('shows Retry for a range that failed, and asks again only on a click', async () => {
    server.failRanges = true;
    await start();
    await openDates();
    await setDate('From', '2026-10-01');
    await flush();
    await flush();
    // The failed range is not asked for again at each paint.
    expect(sentOf('weekrow:announcement-range')).toHaveLength(1);
    expect(shadow('.wr-a-scroll')?.textContent).toContain("Couldn't load the announcements.");
    const retry = shadowAll('.wr-a-line button')[0];
    expect(retry?.textContent).toBe('Retry');

    server.failRanges = false;
    await act(async () => {
      retry?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(sentOf('weekrow:announcement-range')).toHaveLength(2);
    expect(shadowAll('article').length).toBeGreaterThan(0);
    expect(shadow('.wr-a-scroll')?.textContent).not.toContain("Couldn't load");
  });

  it('sends no range for a day that the background would refuse', async () => {
    await start();
    await openDates();
    // A date input accepts a year below 100, and the background refuses it.
    await setDate('From', '0050-01-01');
    await setDate('From', '2026-02-30');
    expect(sentOf('weekrow:announcement-range')).toEqual([]);
  });

  it('says that a cut range shows the first 500, with the count', async () => {
    server.truncated = true;
    await start(many(3));
    await openDates();
    await setDate('From', '2026-10-01');
    const line = shadow('.wr-a-res [role=status]')?.textContent ?? '';
    expect(line).toContain('Showing the first 500');
    expect(line).toMatch(/3 results/);
    expect(shadow('.wr-a-scroll')?.textContent).not.toContain('No more announcements');
  });

  it('ends a range that holds every row with the end line', async () => {
    await start(many(3));
    await openDates();
    await setDate('From', '2026-10-01');
    expect(shadow('.wr-a-scroll')?.textContent).toContain('No more announcements');
  });

  it('shows a note and sends nothing when From is after To', async () => {
    await start();
    await openDates();
    await setDate('To', '2026-10-01');
    await setDate('From', '2026-10-31');
    expect(sentOf('weekrow:announcement-range')).toHaveLength(1);
    expect(shadow('.wr-a-res [role=status]')?.textContent).toBe(
      'The From date must be on or before the To date.',
    );
  });

  it('filters the rows of the range by the text of the search', async () => {
    server.rows = [row('1', { title: 'Lockdown quiz' }), row('2', { title: 'Office hours' })];
    await start(server.rows);
    await openDates();
    await setDate('From', '2026-10-01');
    expect(shadowAll('article')).toHaveLength(2);
    const input = shadow('input[type=search]') as HTMLInputElement;
    await act(async () => {
      input.value = 'lockdown';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(shadowAll('article')).toHaveLength(1);
    expect(sentOf('weekrow:announcement-range')).toHaveLength(1);
  });

  it('goes back to the list at its old scroll position with Clear', async () => {
    await start(many(25));
    const area = shadow('.wr-a-scroll')!;
    area.scrollTop = 240;
    await openDates();
    await setDate('From', '2026-10-01');
    expect(shadow('.wr-a-scroll')?.scrollTop).toBe(0);
    await act(async () => {
      shadowAll('.wr-a-res button')[0]?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await flush();
    expect(shadow('.wr-a-dates')).toBeNull();
    expect(shadow('.wr-a-scroll')?.scrollTop).toBe(240);
    expect(shadowAll('article')).toHaveLength(10);
  });
});

describe('the helpers', () => {
  it('takes the initials from the first and the last word of a name', () => {
    expect(initialsOf('Ching-seh Wu')).toBe('CW');
    expect(initialsOf('Madonna')).toBe('M');
    expect(initialsOf('  anna   maria   rossi ')).toBe('AR');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
  });

  it('names today from the parts of the local date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localToday(new Date(2026, 10, 4, 0, 1))).toBe('2026-11-04');
  });

  it('gives a missing From the first day of 2000 and a missing To today', () => {
    expect(rangeDays('', '', '2026-11-04')).toEqual({ from: '2000-01-01', to: '2026-11-04' });
    expect(rangeDays('2026-10-01', '', '2026-11-04')).toEqual({
      from: '2026-10-01',
      to: '2026-11-04',
    });
  });

  it('has a white text contrast of 4.5 or more on every avatar color', () => {
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map((at) => {
        const value = parseInt(hex.slice(at, at + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    for (const color of AVATAR_COLORS) {
      expect(1.05 / (luminance(color) + 0.05), color).toBeGreaterThanOrEqual(4.5);
    }
  });
});
