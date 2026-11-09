/** Verifies that the shared helper settles a delayed slot scroll before a control click. */
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS, type Settings } from '../../src/features/weekly-list/model/types';
import {
  addCsrfCookie,
  expect,
  inpageList,
  openCanvasPage,
  saveSettings,
  serveScenario,
  settledList,
  settleSlotCard,
  test,
} from './support/weekrow';

const MONTH: Settings = { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 30 } };

interface Gate {
  hold: boolean;
  blocked: boolean;
  seen: string[];
}

async function doneTop(page: Page): Promise<{ top: number; height: number; x: number }> {
  return page.evaluate(() => {
    const root = document.querySelector('#weekrow-inpage > weekrow-list')!.shadowRoot!;
    const box = root.querySelector('.wr-pinned [data-group="done"] input')!.getBoundingClientRect();
    return { top: box.top, height: box.height, x: box.left + box.width / 2 };
  });
}

for (const catchUpFirst of [false, true]) {
  test(
    catchUpFirst
      ? 'control: a press after the card caught up with the page scroll selects Done'
      : 'the shared helper waits for a delayed slot move before selecting Done',
    async ({ context, page, background }) => {
      await saveSettings(background, MONTH);
      const { canvas } = await serveScenario(context, [{ path: '/', page: 'dashboard-widgets' }]);
      await page.setViewportSize({ width: 1280, height: 800 });
      await addCsrfCookie(context, canvas.origin);
      // The gate sits before the listener of the card on the window, so it can hold the scroll back.
      await page.addInitScript(() => {
        const gate: Gate = { hold: false, blocked: false, seen: [] };
        Object.assign(window, { gate });
        window.addEventListener(
          'scroll',
          (event) => {
            if (gate.hold && !gate.blocked && event.isTrusted) {
              gate.blocked = true;
              event.stopImmediatePropagation();
            }
          },
          true,
        );
        for (const type of ['pointerdown', 'mouseup', 'click'])
          window.addEventListener(
            type,
            (event) => {
              const first = event.composedPath()[0] as HTMLElement;
              const done = first.closest?.('[data-group="done"]') ? '(done)' : '';
              gate.seen.push(`${type}:${first.tagName}${done}`);
              if (type === 'pointerdown' && gate.hold) {
                gate.hold = false;
                window.dispatchEvent(new Event('scroll'));
              }
            },
            true,
          );
      });
      await openCanvasPage(page, canvas.origin);
      const done = inpageList(page).locator('.wr-pinned [data-group="done"] input');
      await expect(done).toBeVisible();
      await settledList(page);

      // Start where the card sits at the top of its slot, with the Done part in the window.
      await page.evaluate(() => window.scrollTo(0, 188));
      await page.evaluate(
        () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))),
      );
      const before = await doneTop(page);
      await page.evaluate(() => {
        (window as unknown as { gate: Gate }).gate.seen.length = 0;
      });

      // Scroll the page by 300 px. The card must then move 134 px in its slot.
      await page.evaluate((hold) => {
        (window as unknown as { gate: Gate }).gate.hold = hold;
        window.scrollBy(0, 300);
      }, !catchUpFirst);

      if (catchUpFirst) {
        await expect
          .poll(async () => (await doneTop(page)).top)
          .toBeGreaterThan(before.top - 300 + 100);
      } else {
        // The card has not moved: the Done part is still where the scroll put it.
        await page.evaluate(
          () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))),
        );
        expect((await doneTop(page)).top).toBeCloseTo(before.top - 300, 0);
      }
      await settleSlotCard(page);
      const box = await doneTop(page);
      await page.mouse.move(box.x, box.top + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();

      const seen = await page.evaluate(() => (window as unknown as { gate: Gate }).gate.seen);
      // The press went to the input of the Done part.
      expect(seen[0]).toBe('pointerdown:INPUT(done)');
      // The student pressed on Done, so Done must be on.
      await expect(done).toBeChecked({ timeout: 3000 });
    },
  );
}
