import path from 'node:path';
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  expect,
  doneBox,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const WRAPPER = '[data-testid="widget-container-course-work-combined-widget"]';
const SECTION = '[data-testid="widget-course-work-combined-widget"]';
const HOST = '#weekrow-inpage > weekrow-list';
const FIRST_WRAPPER = '[data-testid="widget-container-course_work_combined-widget-first"]';

/** Waits for a few frames, so the page has laid out after a change of the window. */
async function frames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) await new Promise((r) => requestAnimationFrame(r));
  }, count);
}

/** What React draws when it replaces a node: a copy without what the extension set on it. */
function freshClone(page: Page, selector: string): Promise<void> {
  return page.locator(selector).evaluate((node) => {
    const fresh = (
      window as unknown as { fixtureFreshClone(node: Element): Element }
    ).fixtureFreshClone(node);
    node.replaceWith(fresh);
  });
}

/** Puts the Customize dashboard buttons on the page, as Canvas shows them in edit mode. */
async function enterEditMode(page: Page): Promise<void> {
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.dataset.testid = 'save-customize-button';
    document.getElementById('content')!.append(button);
  });
}

async function leaveEditMode(page: Page): Promise<void> {
  await page.getByTestId('save-customize-button').evaluate((node) => node.remove());
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1100, height: 800 },
]) {
  test(`replaces the widget at ${size.width}x${size.height}`, async ({ context, page }) => {
    await page.addInitScript(() => {
      const audit = {
        box: null as null | { left: number; right: number; top: number; height: number },
        modes: [] as string[],
      };
      Object.assign(window, { slotAudit: audit });
      new MutationObserver(() => {
        const section = document.querySelector(
          '[data-testid="widget-course-work-combined-widget"]',
        );
        if (!audit.box && section) {
          const { left, right, top, height } = section.getBoundingClientRect();
          audit.box = { left, right, top, height };
        }
        const mode = document
          .querySelector('#weekrow-inpage > weekrow-list')
          ?.getAttribute('data-panel');
        if (mode && audit.modes.at(-1) !== mode) audit.modes.push(mode);
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize(size);
    await openCanvasPage(page, canvas.origin);
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
    await expect(doneBox(inpageList(page), 'Quiz 3: Cell membranes')).toBeVisible();
    await settledList(page);
    const card = inpageList(page).locator('.wr');
    const measured = await page.evaluate(
      () =>
        (
          window as unknown as {
            slotAudit: { box: { left: number; right: number; top: number; height: number } };
          }
        ).slotAudit.box,
    );
    const box = await card.boundingBox();
    expect(box!.x).toBeCloseTo(measured.left, 0);
    expect(box!.x + box!.width).toBeCloseTo(measured.right, 0);
    expect(box!.y).toBeCloseTo(measured.top, 0);
    expect(box!.height).toBeCloseTo(Math.max(420, measured.height), 0);
    await expect(page.locator(WRAPPER)).toBeHidden();
    expect(
      await page.locator(WRAPPER).evaluate((node) => {
        const control = node.querySelector('input')!;
        control.focus();
        return document.activeElement === control;
      }),
    ).toBe(false);
    expect(await page.locator(WRAPPER).ariaSnapshot()).toBe('');
    await expect(page.locator(`${WRAPPER} [data-wr-extra], ${WRAPPER} [data-wr-cc]`)).toHaveCount(
      0,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: path.resolve(`screenshots/m1-slot-${size.width}x${size.height}.png`),
    });
    const height = box!.height;
    await page.getByRole('tab', { name: 'Courses', exact: true }).click();
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'stack');
    await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
    // A fresh section inside the wrapper: the wrapper stays claimed, and the new section is not
    // measured again.
    await freshClone(page, SECTION);
    await expect(page.locator(WRAPPER)).toBeHidden();
    await expect(page.locator(WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
    expect((await card.boundingBox())!.height).toBeCloseTo(height, 0);
    await page.locator(SECTION).evaluate((node) => {
      (node as HTMLElement).style.height = '1200px';
    });
    await page.setViewportSize({ width: size.width - 50, height: 600 });
    await frames(page);
    expect((await card.boundingBox())!.height).toBeCloseTo(height, 0);
    // A fresh wrapper: it shows until the placement runs, then it is claimed and hidden again.
    await freshClone(page, WRAPPER);
    await expect(page.locator(WRAPPER)).toBeHidden();
    await expect(page.locator(WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
    await expect
      .poll(() =>
        page
          .locator('#weekrow-inpage')
          .evaluate((node) => node.nextElementSibling?.getAttribute('data-testid')),
      )
      .toBe('widget-container-course-work-combined-widget');
    expect((await card.boundingBox())!.height).toBeCloseTo(height, 0);
    const next = page.locator('#weekrow-inpage').locator('..').locator(':scope > div').last();
    const before = (await next.boundingBox())!.y;
    await inpageList(page).getByRole('button', { name: 'Minimize list' }).click();
    await expect.poll(async () => (await card.boundingBox())!.height).toBeLessThan(80);
    expect((await next.boundingBox())!.y).toBeLessThan(before - 100);
    await inpageList(page)
      .getByRole('button', { name: /^Weekly list/ })
      .click();
    await expect.poll(async () => (await card.boundingBox())!.height).toBeCloseTo(height, 0);
    await enterEditMode(page);
    await expect(page.locator(WRAPPER)).toBeVisible();
    await expect(page.locator('#weekrow-inpage')).toBeHidden();
    await page
      .locator(WRAPPER)
      .evaluate((node) => document.querySelector('[data-testid="widget-column-2"]')!.append(node));
    await leaveEditMode(page);
    await expect(page.locator(WRAPPER)).toBeHidden();
    await expect(page.locator(HOST)).toBeVisible();
    // The card follows the widget to its new place.
    expect(
      await page.locator('#weekrow-inpage').evaluate((node) => ({
        parent: node.parentElement?.getAttribute('data-testid'),
        next: node.nextElementSibling?.getAttribute('data-testid'),
      })),
    ).toEqual({
      parent: 'widget-column-2',
      next: 'widget-container-course-work-combined-widget',
    });
    expect((await card.boundingBox())!.height).toBeCloseTo(height, 0);
  });
}

for (const state of ['delayed', 'error', 'loading', 'none']) {
  test(`handles a ${state} widget`, async ({ context, page }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width: 2088, height: 900 });
    await page.addInitScript(() => {
      Object.assign(window, { slotModes: [] as string[] });
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName !== 'data-panel') continue;
          const mode = (record.target as Element).getAttribute('data-panel');
          if (mode) (window as unknown as { slotModes: string[] }).slotModes.push(mode);
        }
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-panel'] });
    });
    await page.goto(`${canvas.origin}/?fixture_delay_ms=0&fixture_course_work=${state}`);
    await page.bringToFront();
    if (state === 'delayed' || state === 'loading') {
      await expect(page.locator(WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
      await expect(page.locator('#weekrow-inpage')).toBeHidden();
    }
    await expect(page.locator(HOST)).toHaveAttribute(
      'data-panel',
      state === 'none' ? 'area' : 'slot',
      { timeout: 15000 },
    );
    expect(
      await page.evaluate(() => (window as unknown as { slotModes: string[] }).slotModes),
    ).toEqual([state === 'none' ? 'area' : 'slot']);
    if (state !== 'none') await expect(page.locator(WRAPPER)).toBeHidden();
    if (state === 'error') {
      expect((await inpageList(page).locator('.wr').boundingBox())!.height).toBeCloseTo(420, 0);
    }
  });
}

async function openFixture(
  context: Parameters<typeof serveScenario>[0],
  page: Page,
  state: string,
  size = { width: 1440, height: 900 },
): Promise<void> {
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize(size);
  await openCanvasPage(page, canvas.origin, `/?fixture_course_work=${state}`);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await settledList(page);
}

for (const state of ['default', 'second', 'pair']) {
  test(`stops writing to the page when nothing changes (${state})`, async ({ context, page }) => {
    await openFixture(context, page, state);
    // The fixes draw their extras after the data arrives and the card is placed.
    if (state !== 'default') await expect(page.locator('[data-wr-extra]').first()).toBeAttached();
    await page.waitForTimeout(500);
    const records = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          const observer = new MutationObserver((list) => {
            for (const record of list) {
              const target = record.target as Element;
              seen.push(
                `${record.type} ${record.attributeName ?? ''} ${target.nodeName} ${target.getAttribute?.('data-testid') ?? ''}`,
              );
            }
          });
          observer.observe(document, { subtree: true, childList: true, attributes: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(seen);
          }, 2000);
        }),
    );
    expect(records).toEqual([]);
  });
}

test('measures a slot that shows up after the wait, when the student opens the Dashboard tab', async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
  await addCsrfCookie(context, canvas.origin);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${canvas.origin}/?fixture_delay_ms=0&fixture_course_work=loading`);
  await page.bringToFront();
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await tab('Courses').click();
  // The wait for the grid runs out on a tab without a grid.
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'stack', { timeout: 15_000 });
  await tab('Dashboard').click();
  await expect(page.locator(WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
  // The slot is still loading, so the card waits and does not take a height of its own.
  await frames(page, 5);
  await expect(page.locator('#weekrow-inpage')).toBeHidden();
  const widgetHeight = await page.locator(SECTION).evaluate((node) => {
    node.innerHTML =
      '<input data-testid="submission-status-filter-select"><div style="height:700px">Loaded</div>';
    return node.getBoundingClientRect().height;
  });
  expect(widgetHeight).toBeGreaterThan(700);
  await expect(page.locator(HOST)).toHaveAttribute('data-panel', 'slot');
  await expect(page.locator(WRAPPER)).toBeHidden();
  expect((await inpageList(page).locator('.wr').boundingBox())!.height).toBeCloseTo(
    widgetHeight,
    0,
  );
});

test('swaps the card and the widget in one frame when edit mode ends', async ({
  context,
  page,
}) => {
  await openFixture(context, page, 'default');
  await enterEditMode(page);
  await expect(page.locator(WRAPPER)).toBeVisible();
  // In edit mode the widget is Canvas's again, so the fixes add their extras to it.
  await expect(page.locator(`${WRAPPER} [data-wr-extra]`)).toBeAttached();
  const states = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const wrapper = document.querySelector(
          '[data-testid="widget-container-course-work-combined-widget"]',
        )!;
        const container = document.getElementById('weekrow-inpage')!;
        const seen: string[] = [];
        document.querySelector('[data-testid="save-customize-button"]')!.remove();
        let frame = 0;
        // This runs after the placement of the frame: the callback registers after its own.
        const sample = (): void => {
          const hiddenWrapper = getComputedStyle(wrapper).display === 'none';
          const hiddenCard = getComputedStyle(container).display === 'none';
          seen.push(
            `${frame} wrapper:${hiddenWrapper ? 'hidden' : 'shown'} card:${hiddenCard ? 'hidden' : 'shown'}`,
          );
          if (++frame < 40) requestAnimationFrame(sample);
          else resolve(seen);
        };
        void Promise.resolve().then(() => requestAnimationFrame(sample));
      }),
  );
  expect(states.filter((state) => !state.endsWith('wrapper:hidden card:shown'))).toEqual([]);
});

test('keeps the scroll position of the day list over edit mode', async ({
  background,
  context,
  page,
}) => {
  await saveSettings(background, { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } });
  await openFixture(context, page, 'default');
  const region = inpageList(page).locator('.wr-scroll');
  await region.evaluate((element) => {
    element.scrollTop = 300;
  });
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(300);
  await enterEditMode(page);
  await expect(page.locator('#weekrow-inpage')).toBeHidden();
  await leaveEditMode(page);
  await expect(page.locator('#weekrow-inpage')).toBeVisible();
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(300);
});

for (const { width, mode } of [
  { width: 2088, mode: 'area' },
  { width: 1280, mode: 'stack' },
]) {
  test(`keeps the card in the ${mode} in edit mode at ${width} px when the page has no Course work widget`, async ({
    context,
    page,
  }) => {
    const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
    await page.setViewportSize({ width, height: 900 });
    await openCanvasPage(page, canvas.origin, '/?fixture_course_work=none');
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
    await enterEditMode(page);
    await frames(page, 5);
    await expect(page.locator('#weekrow-inpage')).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
    // One writer places the card: nothing changes while the page stands still.
    await page.waitForTimeout(500);
    const records = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let count = 0;
          const observer = new MutationObserver((list) => (count += list.length));
          observer.observe(document, { subtree: true, childList: true, attributes: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(count);
          }, 1000);
        }),
    );
    expect(records).toBe(0);
    await leaveEditMode(page);
    await frames(page, 5);
    await expect(page.locator('#weekrow-inpage')).toBeVisible();
    await expect(page.locator(HOST)).toHaveAttribute('data-panel', mode);
  });
}

test.describe('with two loaded Course work widgets', () => {
  test('replaces the first one and leaves the extras and colors on the second', async ({
    context,
    page,
  }) => {
    await openFixture(context, page, 'pair');
    // The second widget is not replaced, so it gets the extras and the colors.
    await expect(page.locator(`${WRAPPER} [data-wr-extra]`)).toHaveCount(1);
    await expect(page.locator(`${WRAPPER} [data-wr-cc]`).first()).toBeAttached();
    await expect(page.locator(FIRST_WRAPPER)).toHaveAttribute('data-weekrow-replaced', '');
    await expect(page.locator(FIRST_WRAPPER)).toBeHidden();
    await expect(page.locator(WRAPPER)).toBeVisible();
    await expect(
      page.locator(`${FIRST_WRAPPER} [data-wr-extra], ${FIRST_WRAPPER} [data-wr-cc]`),
    ).toHaveCount(0);
  });

  test('removes the extras and the colors from the replaced widget after edit mode', async ({
    context,
    page,
  }) => {
    await openFixture(context, page, 'pair');
    await expect(page.locator(`${WRAPPER} [data-wr-extra]`)).toHaveCount(1);
    await enterEditMode(page);
    // Given back, the first widget gets the extras and the colors like any other.
    await expect(page.locator(`${FIRST_WRAPPER} [data-wr-extra]`)).toHaveCount(1);
    await expect(page.locator(`${FIRST_WRAPPER} [data-wr-cc]`).first()).toBeAttached();
    await leaveEditMode(page);
    await expect(page.locator(FIRST_WRAPPER)).toBeHidden();
    await expect(page.locator(`${FIRST_WRAPPER} [data-wr-extra]`)).toHaveCount(0);
    await expect(page.locator(`${FIRST_WRAPPER} [data-wr-cc]`)).toHaveCount(0);
    await expect(page.locator(`${WRAPPER} [data-wr-extra]`)).toHaveCount(1);
  });
});
