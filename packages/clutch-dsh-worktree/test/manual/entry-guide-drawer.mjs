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
  assert.equal(await guide.count(), 0);
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
} finally {
  await browser.close();
}
