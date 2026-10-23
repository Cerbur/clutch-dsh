import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const css = await readFile(new URL('../src/client/fireworks.css', import.meta.url), 'utf8');
const rule = (selector) => css.slice(css.indexOf(selector + ' {')).split('}')[0];

test('toast alone accepts input, with a noninteractive blur material and theme-aware keyboard focus', () => {
  assert.match(rule('.overlay'), /pointer-events: none/);
  assert.match(rule('.toast'), /pointer-events: auto/);
  assert.match(rule('.toast::before'), /pointer-events: none/);
  assert.match(rule('.animationFrame'), /pointer-events: none/);
  assert.match(rule('.dismiss:focus-visible'), /outline: 2px solid currentColor/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('toast uses neutral menu tokens with an opaque no-filter fallback in both themes', () => {
  assert.doesNotMatch(css, /gradient\(/);
  const toast = rule('.toast');
  assert.match(toast, /background: var\(--dsw-alias-bg-layer-3,/);
  assert.match(toast, /--dsw-elevation-prominent/);
  assert.match(toast, /--dsw-alias-border-l1/);
  assert.match(rule('body[data-ds-dark-theme] .toast'), /--dsw-alias-border-l3/);
  assert.match(
    css,
    /@supports \(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)/,
  );
  const material = rule('.toast::before');
  assert.match(material, /--dsw-menu-surface-fill/);
  assert.match(material, /--dsw-menu-backdrop-filter/);
  assert.match(material, /background: var\(--fireworks-toast-fill\)/);
});

function rgb(hex) {
  return hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16));
}
function luminance(channels) {
  return channels
    .map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('token-free light/dark fallbacks keep normal-text contrast over black and white content', () => {
  for (const selector of ['.toast', 'body[data-ds-dark-theme] .toast']) {
    const theme = rule(selector);
    const label = rgb(theme.match(/--fireworks-toast-label: (#[a-f\d]+)/i)[1]);
    const surface = rgb(theme.match(/--fireworks-toast-surface: (#[a-f\d]+)/i)[1]);
    const [, r, g, b, alpha] = theme.match(
      /--fireworks-toast-fill: rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/,
    );
    assert.ok(contrast(label, surface) >= 4.5, selector + ' opaque fallback');
    for (const backdrop of [0, 255]) {
      const fill = [r, g, b].map(
        (value) => Number(value) * Number(alpha) + backdrop * (1 - Number(alpha)),
      );
      assert.ok(contrast(label, fill) >= 4.5, selector + ' translucent fallback');
    }
  }
});

test('native DSH light/dark palette retains text contrast with the denser menu blend', () => {
  // Read-only reference: DSH ui-theme/styles/design-platform.css.
  // This is a numerical palette check, not browser compositing acceptance.
  for (const { label, base, menu, alpha } of [
    { label: [15, 17, 21], base: [255, 255, 255], menu: [248, 249, 250], alpha: 0.58 },
    { label: [249, 250, 251], base: [53, 54, 56], menu: [67, 69, 74], alpha: 0.45 },
  ]) {
    assert.ok(contrast(label, base) >= 4.5);
    for (const backdrop of [0, 255]) {
      const fill = base.map(
        (value, index) => value * 0.75 + menu[index] * alpha * 0.25 + backdrop * (1 - alpha) * 0.25,
      );
      assert.ok(contrast(label, fill) >= 4.5);
    }
  }
});
