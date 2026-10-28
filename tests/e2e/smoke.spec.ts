import { expect, test } from './support/extension';

test('the side panel page renders in a tab', async ({ page, extensionUrl }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(extensionUrl('sidepanel.html'));

  await expect(page.locator('#app')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('the welcome page opens on install, and the side panel does not', async ({
  context,
  extensionUrl,
}) => {
  const welcomeUrl = extensionUrl('welcome.html');
  const isWelcome = (url: string): boolean => url === welcomeUrl;
  const welcome =
    context.pages().find((tab) => isWelcome(tab.url())) ??
    (await context.waitForEvent('page', { predicate: (tab) => isWelcome(tab.url()) }));

  await expect(welcome.getByRole('heading', { level: 1 })).toHaveText(/^Welcome to /);
  expect(context.pages().filter((tab) => tab.url().endsWith('/sidepanel.html'))).toEqual([]);
});
