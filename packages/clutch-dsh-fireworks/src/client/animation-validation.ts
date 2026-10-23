import type { AnimationTemplate } from '../animation.js';
import { animationDocument } from './animation-sandbox.js';
import { connectAnimationTheme, readAnimationTheme } from './animation-theme.js';

/** Compile and paint one frame in the same restricted Worker used for playback. */
export function validateAnimation(template: AnimationTemplate, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    const token = crypto.randomUUID();
    let disconnectTheme = () => {};
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:fixed;width:640px;height:480px;visibility:hidden;pointer-events:none';
    const finish = (error?: string) => {
      disconnectTheme();
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      signal.removeEventListener('abort', abort);
      frame.remove();
      if (error) reject(new Error(error));
      else resolve();
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token) return;
      if (event.data.type === 'clutch_fireworks/ready') finish();
      if (event.data.type === 'clutch_fireworks/error') finish(String(event.data.message));
    };
    const abort = () => finish('校验已取消');
    const timeout = setTimeout(() => finish('动画校验超时，请检查脚本'), 4000);
    window.addEventListener('message', receive);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    frame.srcdoc = animationDocument(template, token, 1, '', true, readAnimationTheme());
    disconnectTheme = connectAnimationTheme(frame, token);
    document.body.append(frame);
  });
}
