import type { AnimationTheme } from '../animation.js';

/** Read the layout presenter's resolved DOM projection, never the opaque child. */
export function readAnimationTheme(): AnimationTheme {
  const root = document.documentElement;
  const body = document.body;
  const scheme = getComputedStyle(root)
    .colorScheme.replace(/^only\s+/, '')
    .trim();
  if (scheme === 'light' || scheme === 'dark') return scheme;
  const source = root.getAttribute('data-ds-theme-source');
  if (source === 'light' || source === 'dark') return source;
  if (body.hasAttribute('data-ds-dark-theme')) return 'dark';
  // Older shells may publish only the rendered background. Ignore transparency.
  for (const element of [body, root]) {
    const color = getComputedStyle(element).backgroundColor;
    const match =
      /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(color);
    if (match && (match[4] === undefined || Number(match[4]) === 1)) {
      const luminance =
        Number(match[1]) * 0.2126 + Number(match[2]) * 0.7152 + Number(match[3]) * 0.0722;
      return luminance < 128 ? 'dark' : 'light';
    }
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Only this resolved enum crosses the sandbox boundary; no settings or DOM. */
export function connectAnimationTheme(frame: HTMLIFrameElement, token: string): () => void {
  let theme = readAnimationTheme();
  const send = () =>
    frame.contentWindow?.postMessage({ type: 'clutch_fireworks/theme', token, theme }, '*');
  const update = () => {
    const next = readAnimationTheme();
    if (next === theme) return;
    theme = next;
    send();
  };
  const observer = new MutationObserver(update);
  const options = {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-ds-theme-source', 'data-ds-dark-theme'],
  };
  observer.observe(document.documentElement, options);
  observer.observe(document.body, options);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  frame.addEventListener('load', send);
  send();
  return () => {
    observer.disconnect();
    media.removeEventListener('change', update);
    frame.removeEventListener('load', send);
  };
}
