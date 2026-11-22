// Run against a local DSH Web test profile with this checkout's built plugin enabled.
import assert from 'node:assert/strict';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.DSH_WEB_URL, 'Set DSH_WEB_URL to the test profile URL');
assert.ok(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to the installed playwright/index.mjs');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
try {
  const page = await browser.newPage({
    locale: 'en-US',
    viewport: { width: 400, height: 730 },
    reducedMotion: 'no-preference',
  });
  await page.goto(process.env.DSH_WEB_URL);
  const drawer = page.locator('[data-sidebar-drawer][data-sidebar-collapsed]');
  await drawer.waitFor({ state: 'attached' });
  const toggle = page.locator('[data-shell-leading] button').first();
  const notice = page.getByRole('button', { name: 'Continue', exact: true });
  // A fresh Web profile may cover the sidebar with its initial preview notice.
  await page.addLocatorHandler(notice, () => notice.click());
  const guide = page.locator('[data-worktree-entry-guide]');
  const marker = () => page.evaluate(() => globalThis.localStorage.getItem('clutch-dsh-worktree.entry-guide-seen'));
  assert.equal(await guide.count(), 0);
  assert.equal(await marker(), null);
  await toggle.click();
  await guide.waitFor({ state: 'visible' });
  const centers = await page.locator('[data-worktree-view-switch="header"]').evaluate(async (entry) => {
    // The drawer translates an ancestor. Its motion does not resize the window or the button.
    for (let element = entry; element; element = element.parentElement) {
      await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    }
    await new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
    const arrow = entry.ownerDocument.querySelector('[data-worktree-entry-guide] [aria-hidden="true"]');
    function center(element) {
      const rect = element.getBoundingClientRect();
      return rect.left + rect.width / 2;
    }
    return { button: center(entry), arrow: center(arrow) };
  });
  assert.ok(Math.abs(centers.button - centers.arrow) <= 2, JSON.stringify(centers));
  assert.equal(await marker(), 'shown');
  const entry = page.locator('[data-worktree-view-switch="header"]');
  await entry.click({ trial: true });
  const options = page.getByRole('button', { name: 'View options', exact: true });
  await options.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible' });
  assert.ok(await options.evaluate(el => el === el.ownerDocument.activeElement));
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert.ok(await guide.isVisible(), 'the native menu receives Escape before the guide');
  await entry.focus();
  const dismiss = guide.getByRole('button', { name: 'Got it', exact: true });
  const drawerDialog = entry.locator('xpath=ancestor::*[@aria-modal="true"][1]');
  const buttonCount = await drawerDialog.getByRole('button').count();
  for (let i = 0; i <= buttonCount && !await dismiss.evaluate(el => el === el.ownerDocument.activeElement); i++) {
    await page.keyboard.press('Tab');
  }
  assert.ok(await dismiss.evaluate(el => el === el.ownerDocument.activeElement), 'drawer Tab reaches Got it');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const link = guide.getByRole('link');
  assert.ok(await link.evaluate(el => el === el.ownerDocument.activeElement), 'Tab reaches the attribution link');
  await page.keyboard.press('Escape');
  await link.waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');
  await guide.waitFor({ state: 'detached' });
  assert.ok(await entry.isVisible(), 'Escape dismissed the guide and kept the drawer open');
  await page.reload();
  await page.locator('[data-sidebar-drawer]').waitFor({ state: 'attached' });
  if (await drawer.count()) await toggle.click();
  await entry.waitFor({ state: 'visible' });
  assert.equal(await guide.count(), 0);
  assert.equal(await marker(), 'shown');
} finally {
  await browser.close();
}
