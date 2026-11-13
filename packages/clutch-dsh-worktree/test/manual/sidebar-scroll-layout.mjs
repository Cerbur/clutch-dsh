// Real Chromium geometry using the installed rc.2 CSS and native wheel handoff.
// DSH_NATIVE_SOURCE=/path/to/dsh PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node test/manual/sidebar-scroll-layout.mjs
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import ts from 'typescript';

assert.ok(process.env.DSH_NATIVE_SOURCE, 'Set DSH_NATIVE_SOURCE to the rc.2 source checkout');
assert.ok(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to an installed playwright/index.mjs');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const packageRoot = new URL('../../', import.meta.url);
const css = await readFile(new URL('src/client/worktree.css', packageRoot), 'utf8');
const nativeRoot = new URL('./', import.meta.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json'));
const sidebarRoot = new URL('./', import.meta.resolve('@deepseek-ai/dsh-client-ui-sidebar/package.json'));
const workspaceCss = await readFile(new URL('src/client/rows/WorkspaceBrowser.module.css', nativeRoot), 'utf8');
const sidebarCss = await readFile(new URL('src/client/SidebarRoot.module.css', sidebarRoot), 'utf8');
const scrollbarCss = await readFile(resolve(process.env.DSH_NATIVE_SOURCE, 'packages/client/ui-theme/src/styles/scrollbar.css'), 'utf8');
const handoff = ts.transpileModule(await readFile(new URL('src/client/scroll-handoff.ts', sidebarRoot), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const prefix = (source, name) => source.replace(/\.([a-zA-Z_][\w-]*)/g, `.${name}_$1`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const scenarios = [200, 280, 400].flatMap(width =>
    [0, 2, 60].flatMap(rows => [3, 5].map(scrollbarWidth => ({ width, rows, scrollbarWidth }))));
  for (const { width, rows, scrollbarWidth } of scenarios) {
    await page.setContent(`<style>
      ${prefix(sidebarCss, 'shell')}
      ${prefix(workspaceCss, 'native')}
      ${css}
      ${scrollbarCss}
      body { margin: 0; display: flex; --dsh-scrollbar-width: ${scrollbarWidth}px; --dsw-alias-scrollbar-bg-l1: #888; --dsw-alias-scrollbar-hover-l1: #555; }
      .shell_root { width: ${width}px; height: 400px; }
      .fixtureRow { height: 34px; flex: none; box-sizing: border-box; background: #ddd; }
      .fixtureHeader { height: 36px; flex: none; }
    </style>${['native', 'plugin'].map(mode => `
      <aside id="${mode}" class="shell_root">
        <div class="shell_scrollRegion"><div class="shell_scrollArea">
          <div class="shell_panelList" style="height:120px">Navigation</div>
          <div class="shell_regionArea">${mode === 'native' ? `
            <div class="native_root"><div class="fixtureHeader">Workspace</div>
              <div class="native_listArea"><div class="native_list">${'<div class="fixtureRow">Workspace row</div>'.repeat(rows)}</div></div>
            </div>` : `
            <div class="workspaceSeat" data-worktree-section-scroller="true"><section class="surface">
              <div class="fixtureHeader">Worktree</div><div class="scrollFrame">
                <div class="content" data-worktree-native-scroll tabindex="0"><div class="scrollContent">${'<div class="fixtureRow">Worktree row</div>'.repeat(rows)}</div></div>
              </div>
            </section></div>`}
          </div></div></div>
      </aside>`).join('')}`);
    await page.addScriptTag({ content: `(() => { const exports = {}; ${handoff}
      for (const mode of ['native', 'plugin']) {
        const root = globalThis.document.getElementById(mode);
        const h = exports.createScrollHandoff();
        h.bindViewportRef(root.querySelector('.shell_scrollArea'));
        h.useSectionScroller().bindScrollerRef(root.querySelector(mode === 'native' ? '.native_listArea' : '.content'));
      } })();` });
    const measure = () => page.evaluate(() => Object.fromEntries(['native', 'plugin'].map(mode => {
      const root = globalThis.document.getElementById(mode);
      const row = root.querySelector(mode === 'native' ? '.native_list' : '.scrollContent').getBoundingClientRect();
      const scroller = root.querySelector(mode === 'native' ? '.native_listArea' : '.content');
      const viewport = root.querySelector('.shell_scrollArea');
      const s = globalThis.getComputedStyle(scroller);
      return [mode, { left: row.left - root.getBoundingClientRect().left,
        right: root.getBoundingClientRect().right - row.right, width: row.width,
        height: scroller.clientHeight, scrollHeight: scroller.scrollHeight,
        outer: viewport.scrollTop, inner: scroller.scrollTop,
        paddingRight: s.paddingRight, gutter: scroller.offsetWidth - scroller.clientWidth,
        scrollbarDisplay: globalThis.getComputedStyle(scroller, '::-webkit-scrollbar').display,
        scrollbarGutter: s.scrollbarGutter,
        overflowY: s.overflowY, horizontalOverflow: scroller.scrollWidth > scroller.clientWidth,
        railRight: root.getBoundingClientRect().right - scroller.getBoundingClientRect().right }];
    })));
    await page.evaluate(() => new Promise(r => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(r))));
    const before = await measure();
    console.log(JSON.stringify({ width, rows, scrollbarWidth, before }));
    assert.equal(before.plugin.right, before.native.right, 'Worktree rows must share the native right edge');
    assert.equal(before.plugin.left, before.native.left, 'Worktree rows must share the native left edge');
    assert.equal(before.plugin.railRight, 2, 'native scrollbar reaches the native sidebar edge');
    assert.equal(before.plugin.gutter, before.native.gutter);
    assert.equal(before.plugin.gutter, scrollbarWidth);
    assert.equal(before.plugin.paddingRight, before.native.paddingRight);
    assert.equal(before.plugin.scrollbarGutter, 'stable');
    assert.equal(before.plugin.scrollbarDisplay, before.native.scrollbarDisplay);
    assert.notEqual(before.plugin.scrollbarDisplay, 'none');
    assert.equal(before.plugin.horizontalOverflow, false);
    assert.equal(before.plugin.height, before.native.height);
    if (rows > 2) {
      assert.equal(before.plugin.overflowY, before.native.overflowY);
      assert.ok(before.plugin.scrollHeight > before.plugin.height, 'long content has a bounded inner scrollport');
      await page.evaluate(() => {
        for (const mode of ['native', 'plugin']) globalThis.document.querySelector(`#${mode} .fixtureRow`)
          .dispatchEvent(new globalThis.WheelEvent('wheel', { deltaY: 220, bubbles: true, cancelable: true }));
      });
      await page.evaluate(() => new Promise(r => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(r))));
      const down = await measure();
      console.log(JSON.stringify({ width, rows, down }));
      assert.ok(down.plugin.outer > 0 && down.plugin.inner > 0, 'one wheel crosses the navigation boundary');
      assert.equal(down.plugin.outer + down.plugin.inner, 220);
      assert.equal(down.plugin.overflowY, 'auto');
      assert.equal(down.plugin.gutter, before.plugin.gutter, 'native gutter survives scroll-state changes');
      const exposed = await page.locator('#plugin .content').evaluate(el => {
        const r = el.getBoundingClientRect();
        return globalThis.document.elementFromPoint(r.right - 2, r.top + 2) === el;
      });
      assert.ok(exposed, 'native scrollbar is not clipped by seat or surface');
      await page.evaluate(() => {
        for (const mode of ['native', 'plugin']) globalThis.document.querySelector(`#${mode} .fixtureRow`)
          .dispatchEvent(new globalThis.WheelEvent('wheel', { deltaY: -220, bubbles: true, cancelable: true }));
      });
      const up = await measure();
      assert.equal(up.plugin.outer, 0);
      assert.equal(up.plugin.inner, 0);
      await page.locator('#plugin .content').hover();
      await page.mouse.wheel(0, 220);
      await page.waitForFunction(() => {
        const root = globalThis.document.getElementById('plugin');
        return root.querySelector('.shell_scrollArea').scrollTop + root.querySelector('.content').scrollTop >= 220;
      });
      await page.locator('#plugin .content').focus();
      await page.keyboard.press('End');
      await page.waitForFunction(() => {
        const el = globalThis.document.querySelector('#plugin .content');
        return el.scrollHeight - el.clientHeight - el.scrollTop < 1;
      });
    }
    // DSH's quietBars changes only the native thumb skin, never list geometry.
    await page.locator('.shell_root').evaluateAll(roots => roots.forEach(el => el.classList.add('shell_quietBars')));
    const quiet = await page.locator('#plugin .content').evaluate(el => ({
      thumb: globalThis.getComputedStyle(el, '::-webkit-scrollbar-thumb').backgroundColor,
      gutter: el.offsetWidth - el.clientWidth,
    }));
    assert.equal(quiet.thumb, 'rgba(0, 0, 0, 0)');
    assert.equal(quiet.gutter, scrollbarWidth);
    await page.locator('.shell_root').evaluateAll(roots => roots.forEach(el => el.classList.remove('shell_quietBars')));
    // Capability-free layout retains its existing inset and clipping.
    await page.locator('.workspaceSeat').evaluate(el => {
      el.removeAttribute('data-worktree-section-scroller');
      el.querySelector('.content').removeAttribute('data-worktree-native-scroll');
    });
    const legacy = await measure();
    assert.equal(legacy.plugin.right, 18);
    assert.equal(legacy.plugin.paddingRight, '10px');
    assert.equal(legacy.plugin.gutter, 0);
    assert.equal(legacy.plugin.scrollbarDisplay, 'none');
    assert.equal(legacy.plugin.overflowY, 'auto');
    await page.locator('.workspaceSeat').evaluate(el => {
      el.setAttribute('data-worktree-section-scroller', 'true');
      el.querySelector('.content').setAttribute('data-worktree-native-scroll', 'true');
    });
    if (process.env.SCREENSHOT_DIR && width === 280 && scrollbarWidth === 5) {
      await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(process.env.SCREENSHOT_DIR, `sidebar-${rows}.png`) });
    }
  }
} finally { await browser.close(); }
