/**
 * The Announcements tab of the weekly list (design decision 24): the switch under the rings, the
 * list of recent announcements, the message that opens in place without a read mark, and the
 * explicit "Mark as read" control with its Undo.
 */
import type { Locator, Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { CSRF_TOKEN } from './support/weekrow';
import {
  addCsrfCookie,
  doneBox,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';
import type { FakeCanvas } from './support/fake-canvas';

const QUIZ_3 = 'Quiz 3: Cell membranes';
const LAB_ROOM = 'Lab room change for Thursday';
const OFFICE_HOURS = 'Office hours move to Thursday this week';
const GOGGLES = 'Safety goggles are required';
const SYLLABUS = 'Syllabus quiz reminder';
const WELCOME = 'Welcome to BIO 110';
const READ_PATH = /^\/api\/v1\/courses\/\d+\/discussion_topics\/\d+\/read$/;

async function open(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  options: { page?: string; path?: string; width?: number } = {},
) {
  const path = options.path ?? '/';
  const served = await serveScenario(context, [
    { path, page: options.page ?? 'dashboard-card-view' },
  ]);
  await addCsrfCookie(context, served.canvas.origin);
  await page.setViewportSize({ width: options.width ?? 1280, height: 1000 });
  await openCanvasPage(page, served.canvas.origin, path);
  await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
  await settledList(page);
  return served;
}

/** The button of a row that opens its message. The Mark as read button has the title in its name too. */
function titleButton(list: Locator, title: string): Locator {
  return list.getByRole('button', { name: title, exact: true });
}

function tab(list: Locator, name: string | RegExp): Locator {
  return list.getByRole('tab', { name });
}

async function openAnnouncements(page: Page): Promise<Locator> {
  const list = inpageList(page);
  await tab(list, /^Announcements/).click();
  await expect(titleButton(list, LAB_ROOM)).toBeVisible();
  return list;
}

function writesTo(canvas: FakeCanvas, method: string) {
  return canvas.requests.filter(
    (r) => r.method === method && READ_PATH.test(r.path.split('?')[0] ?? ''),
  );
}

test.describe('the switch', () => {
  test('shows Tasks and Announcements under the rings, with the unread count', async ({
    context,
    page,
  }) => {
    await open(context, page);
    const list = inpageList(page);
    const tabs = list.getByRole('tablist', { name: 'Weekly list view' });
    await expect(tabs).toBeVisible();
    await expect(tab(list, 'Tasks')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(list, /^Announcements/)).toHaveAttribute('aria-selected', 'false');
    await expect(tab(list, /^Announcements/)).toContainText('3');
    await expect(tab(list, /^Announcements/)).toHaveAccessibleName('Announcements, 3 unread');
    // The strip sits under the rings and above the groups.
    const order = await list.evaluate((host) => {
      const root = host.querySelector('weekrow-list')?.shadowRoot;
      const at = (selector: string) =>
        root?.querySelector(selector)?.getBoundingClientRect().top ?? -1;
      return [at('.wr-rings'), at('[role="tablist"]'), at('.wr-scroll')];
    });
    expect(order[0]).toBeGreaterThan(0);
    expect(order[1]).toBeGreaterThan(order[0] ?? 0);
    expect(order[2]).toBeGreaterThan(order[1] ?? 0);
  });

  test('shows in List View too', async ({ context, page }) => {
    await open(context, page, { page: 'dashboard-list-view' });
    await expect(inpageList(page).getByRole('tablist')).toBeVisible();
  });

  test('is absent on the new widget dashboard, which sends no announcement request', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page, { page: 'dashboard-widgets', width: 1920 });
    const list = inpageList(page);
    await expect(list.getByRole('tablist')).toHaveCount(0);
    await expect(list.getByRole('tab')).toHaveCount(0);
    // Give a late request time to appear.
    await page.waitForTimeout(500);
    expect(canvas.requests.filter((r) => r.path.startsWith('/api/v1/announcements'))).toHaveLength(
      0,
    );
  });
});

test.describe('the Announcements tab', () => {
  test('lists the unread announcements of the last 14 days, newest first', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const list = await openAnnouncements(page);
    const panel = list.getByRole('tabpanel');
    const titles = panel.locator('.wr-ann-title');
    await expect(titles).toHaveText([LAB_ROOM, OFFICE_HOURS, GOGGLES]);

    const first = panel.locator('li', { hasText: LAB_ROOM });
    await expect(first).toContainText('BIO 110');
    await expect(first).toContainText('Dr. Maya Okafor');
    await expect(first).toContainText('The lab section moves to Science Hall 214');
    await expect(first.locator('.wr-ann-when')).toHaveText('Today');
    await expect(first.locator('.wr-ann-snippet')).not.toContainText('pwned');
    await expect(first.locator('.wr-ann-snippet')).not.toContainText('<');

    // The read one and the one from September are not there.
    await expect(panel.getByText(SYLLABUS)).toHaveCount(0);
    await expect(panel.getByText(WELCOME)).toHaveCount(0);

    const request = canvas.requests.find((r) => r.path.startsWith('/api/v1/announcements'));
    expect(request).toBeDefined();
    const url = new URL(request?.url ?? '');
    expect(url.searchParams.get('active_only')).toBe('true');
    expect(url.searchParams.getAll('context_codes[]')).toContain('course_101');
    expect(url.searchParams.get('start_date')).toMatch(/^2026-10-13T/);
  });

  test('shows read announcements with the Show read switch', async ({ context, page }) => {
    await open(context, page);
    const list = await openAnnouncements(page);
    const panel = list.getByRole('tabpanel');
    await list.getByRole('switch', { name: 'Show read' }).click();
    await expect(panel.locator('.wr-ann-title')).toHaveText([
      LAB_ROOM,
      OFFICE_HOURS,
      GOGGLES,
      SYLLABUS,
    ]);
    // A read row has no Mark as read control.
    await expect(
      panel.locator('li', { hasText: SYLLABUS }).getByRole('button', { name: /Mark as read/ }),
    ).toHaveCount(0);
  });

  test('opens a message in place without marking it as read, and the sanitizer holds', async ({
    context,
    page,
  }) => {
    const { canvas } = await open(context, page);
    const list = await openAnnouncements(page);
    const toggle = titleButton(list, LAB_ROOM);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const body = list.locator('.wr-ann-body');
    await expect(body).toContainText('Science Hall 214');
    await expect(body.locator('script, iframe, form, svg, input')).toHaveCount(0);
    await expect(body.locator('[onerror], [onclick], [style]')).toHaveCount(0);
    await expect(body.getByRole('link', { name: 'party' })).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();

    // Opening sends no read mark and loads no Canvas topic page.
    await page.waitForTimeout(300);
    expect(writesTo(canvas, 'PUT')).toHaveLength(0);
    expect(writesTo(canvas, 'DELETE')).toHaveLength(0);
    expect(
      canvas.requests.filter((r) => /^\/courses\/\d+\/discussion_topics\//.test(r.path)),
    ).toHaveLength(0);
    expect(
      canvas.requests.some((r) => r.path.startsWith('/api/v1/courses/101/discussion_topics/31901')),
    ).toBe(true);
    // The row is still unread, and Show less closes it.
    await expect(list.getByRole('button', { name: `Mark as read: ${LAB_ROOM}` })).toBeVisible();
    await list.getByRole('button', { name: 'Show less' }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(list.locator('.wr-ann-body')).toHaveCount(0);
  });

  test('"Mark as read" sends exactly one PUT, and the row leaves the list', async ({
    context,
    page,
  }) => {
    const { canvas, state } = await open(context, page);
    const list = await openAnnouncements(page);
    await list.getByRole('button', { name: `Mark as read: ${LAB_ROOM}` }).click();

    await expect.poll(() => writesTo(canvas, 'PUT').length).toBe(1);
    await expect(titleButton(list, LAB_ROOM)).toHaveCount(0);
    await expect(list.locator('.wr-toast')).toContainText('Marked as read');
    await expect(tab(list, /^Announcements/)).toHaveAccessibleName('Announcements, 2 unread');
    await settledList(page);
    await page.waitForTimeout(300);
    const puts = writesTo(canvas, 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.path).toBe('/api/v1/courses/101/discussion_topics/31901/read');
    expect(puts[0]?.headers['x-csrf-token']).toBe(CSRF_TOKEN);
    expect(state.readAnnouncements.has('101:31901')).toBe(true);
    // The row stays away after the lists load again.
    await expect(titleButton(list, LAB_ROOM)).toHaveCount(0);
    // Focus moves to the next row.
    await expect(list.getByRole('button', { name: `Mark as read: ${OFFICE_HOURS}` })).toBeFocused();
  });

  test('Undo puts the announcement back, and marks it unread again', async ({ context, page }) => {
    const { canvas, state } = await open(context, page);
    const list = await openAnnouncements(page);
    await list.getByRole('button', { name: `Mark as read: ${LAB_ROOM}` }).click();
    await expect(titleButton(list, LAB_ROOM)).toHaveCount(0);

    await list.locator('.wr-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(titleButton(list, LAB_ROOM)).toBeVisible();
    await expect.poll(() => writesTo(canvas, 'DELETE').length).toBe(1);
    await settledList(page);
    expect(writesTo(canvas, 'PUT')).toHaveLength(1);
    expect(writesTo(canvas, 'DELETE')[0]?.path).toBe(
      '/api/v1/courses/101/discussion_topics/31901/read',
    );
    expect(state.readAnnouncements.has('101:31901')).toBe(false);
    await expect(tab(list, /^Announcements/)).toHaveAccessibleName('Announcements, 3 unread');
    await expect(list.getByRole('button', { name: `Mark as read: ${LAB_ROOM}` })).toBeFocused();
  });

  test('keeps a marked row in the list while Show read is on', async ({ context, page }) => {
    await open(context, page);
    const list = await openAnnouncements(page);
    await list.getByRole('switch', { name: 'Show read' }).click();
    await list.getByRole('button', { name: `Mark as read: ${LAB_ROOM}` }).click();
    await expect(list.getByRole('button', { name: `Mark as read: ${LAB_ROOM}` })).toHaveCount(0);
    await expect(titleButton(list, LAB_ROOM)).toBeVisible();
  });

  test('remembers the chosen tab for the session', async ({ context, page }) => {
    await open(context, page);
    const list = await openAnnouncements(page);
    await page.reload();
    await page.locator('html[data-fixture-ready="true"]').waitFor({ state: 'attached' });
    await expect(tab(inpageList(page), /^Announcements/)).toHaveAttribute('aria-selected', 'true');
    await expect(titleButton(list, LAB_ROOM)).toBeVisible();
    await tab(inpageList(page), 'Tasks').click();
    await expect(doneBox(inpageList(page), QUIZ_3)).toBeVisible();
    await page.reload();
    await page.locator('html[data-fixture-ready="true"]').waitFor({ state: 'attached' });
    await expect(tab(inpageList(page), 'Tasks')).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps the scroll position of each tab in the one scroll region of the card', async ({
    context,
    page,
  }) => {
    await open(context, page);
    // A short window makes the region of the card short, so both tabs scroll.
    await page.setViewportSize({ width: 1280, height: 700 });
    const list = inpageList(page);
    const top = (): Promise<number> =>
      list.evaluate(
        (host) =>
          (
            host
              .querySelector('weekrow-list')
              ?.shadowRoot?.querySelector('.wr-scroll') as HTMLElement
          ).scrollTop,
      );
    const scrollTo = (value: number): Promise<void> =>
      list.evaluate((host, to) => {
        (
          host.querySelector('weekrow-list')?.shadowRoot?.querySelector('.wr-scroll') as HTMLElement
        ).scrollTop = to;
      }, value);

    // Wait until the region has room to scroll, after the window change and the loading days.
    const room = (): Promise<number> =>
      list.evaluate((host) => {
        const region = host.querySelector('weekrow-list')?.shadowRoot?.querySelector('.wr-scroll');
        return region ? region.scrollHeight - region.clientHeight : 0;
      });
    await expect.poll(room).toBeGreaterThan(130);
    await scrollTo(120);
    await expect.poll(top).toBe(120);
    await tab(list, /^Announcements/).click();
    await expect(titleButton(list, LAB_ROOM)).toBeVisible();
    // The region has the label of the tab, and the new tab starts at the top.
    await expect(list.getByRole('region', { name: 'Announcements' })).toBeVisible();
    await expect.poll(top).toBe(0);
    await expect.poll(room).toBeGreaterThan(50);
    await scrollTo(40);
    await expect.poll(top).toBe(40);

    await tab(list, 'Tasks').click();
    await expect(list.getByRole('region', { name: 'Tasks by day' })).toBeVisible();
    await expect.poll(top).toBe(120);
    await tab(list, /^Announcements/).click();
    await expect.poll(top).toBe(40);
  });
});

test.describe('the course home page', () => {
  test('shows only the announcements of that course', async ({ context, page }) => {
    const { canvas } = await open(context, page, { page: 'course-home', path: '/courses/101' });
    const list = inpageList(page);
    await tab(list, /^Announcements/).click();
    await expect(list.locator('.wr-ann-title')).toHaveText([LAB_ROOM]);
    await expect(list.getByText(OFFICE_HOURS)).toHaveCount(0);
    await expect(list.getByText(GOGGLES)).toHaveCount(0);
    await expect(tab(list, /^Announcements/)).toHaveAccessibleName('Announcements, 1 unread');
    // The row does not repeat the course name beside the title.
    await expect(list.locator('.wr-ann-course')).toHaveCount(0);
    const codes = canvas.requests
      .filter((r) => r.path.startsWith('/api/v1/announcements'))
      .flatMap((r) => new URL(r.url).searchParams.getAll('context_codes[]'));
    expect(codes.length).toBeGreaterThan(0);
  });
});

test.describe('hidden courses', () => {
  test('leave out the announcements of a course the student hid', async ({
    context,
    page,
    background,
  }) => {
    await saveSettings(background, { ...DEFAULT_SETTINGS, hiddenCourseIds: ['104'] });
    const { canvas } = await open(context, page);
    const list = inpageList(page);
    await tab(list, /^Announcements/).click();
    await expect(list.locator('.wr-ann-title')).toHaveText([LAB_ROOM, OFFICE_HOURS]);
    for (const request of canvas.requests.filter((r) =>
      r.path.startsWith('/api/v1/announcements'),
    )) {
      expect(new URL(request.url).searchParams.getAll('context_codes[]')).not.toContain(
        'course_104',
      );
    }
  });
});
