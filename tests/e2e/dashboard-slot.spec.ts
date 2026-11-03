import path from 'node:path';
import {
  expect,
  doneBox,
  inpageList,
  openCanvasPage,
  serveScenario,
  settledList,
  test,
} from './support/weekrow';

const WRAPPER = '[data-testid="widget-container-course-work-combined-widget"]';
const SECTION = '[data-testid="widget-course-work-combined-widget"]';
const HOST = '#weekrow-inpage > weekrow-list';

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
    await page.locator(SECTION).evaluate((node) => node.replaceWith(node.cloneNode(true)));
    await expect(page.locator(WRAPPER)).toBeHidden();
    expect((await card.boundingBox())!.height).toBeCloseTo(height, 0);
    await page.locator(SECTION).evaluate((node) => {
      (node as HTMLElement).style.height = '1200px';
    });
    await page.setViewportSize({ width: size.width - 50, height: 600 });
    expect((await card.boundingBox())!.height).toBeCloseTo(height, 0);
    await page.locator(WRAPPER).evaluate((node) => node.replaceWith(node.cloneNode(true)));
    await expect(page.locator(WRAPPER)).toBeHidden();
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
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.dataset.testid = 'save-customize-button';
      document.getElementById('content')!.append(button);
    });
    await expect(page.locator(WRAPPER)).toBeVisible();
    await expect(page.locator('#weekrow-inpage')).toBeHidden();
    await page
      .locator(WRAPPER)
      .evaluate((node) => document.querySelector('[data-testid="widget-column-2"]')!.append(node));
    await page.getByTestId('save-customize-button').evaluate((node) => node.remove());
    await expect(page.locator(WRAPPER)).toBeHidden();
    await expect(page.locator(HOST)).toBeVisible();
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
