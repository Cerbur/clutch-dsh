import type { AnimationTemplate, AnimationRender } from '../animation.js';

/** Runs only inside a CSP-restricted, opaque-origin iframe's dedicated Worker. */
function workerRuntime(render: AnimationRender) {
  let canvas: OffscreenCanvas;
  let ctx: OffscreenCanvasRenderingContext2D;
  const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent) => void;
    postMessage: (value: unknown) => void;
  };
  scope.onmessage = ({ data }) => {
    try {
      if (data.type === 'init') {
        if (typeof render !== 'function') throw new Error('请定义 function render(frame, fx)');
        canvas = data.canvas;
        ctx = canvas.getContext('2d')!;
        if (!ctx) throw new Error('Canvas 2D unavailable');
        scope.postMessage({ type: 'ready' });
        return;
      }
      const { width, height, dpr, seed } = data.frame;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      } else if (typeof ctx.reset === 'function') ctx.reset();
      else canvas.width = pixelWidth;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let randomState = seed >>> 0;
      const paint = (alpha: number, color: string, draw: () => void) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        draw();
        ctx.restore();
      };
      const fx = {
        random() {
          randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
          return randomState / 4294967296;
        },
        clamp: (p: number) => Math.max(0, Math.min(1, p)),
        easeOut: (p: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3),
        circle(x: number, y: number, r: number, color: string, alpha = 1, glow = 0) {
          paint(alpha, color, () => {
            ctx.shadowColor = color;
            ctx.shadowBlur = glow;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
            ctx.fill();
          });
        },
        ring(x: number, y: number, r: number, color: string, lineWidth = 2, alpha = 1) {
          paint(alpha, color, () => {
            ctx.lineWidth = Math.max(0.1, lineWidth);
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
            ctx.stroke();
          });
        },
        line(
          x1: number,
          y1: number,
          x2: number,
          y2: number,
          color: string,
          lineWidth = 2,
          alpha = 1,
        ) {
          paint(alpha, color, () => {
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          });
        },
        star(x: number, y: number, r: number, color: string, alpha = 1, rotation = 0) {
          paint(alpha, color, () => {
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
              const radius = i % 2 === 0 ? r : r * 0.42;
              const angle = (i * Math.PI) / 5 - Math.PI / 2;
              ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
            }
            ctx.closePath();
            ctx.fill();
          });
        },
        emoji(text: string, x: number, y: number, size = 32, alpha = 1, rotation = 0) {
          paint(alpha, '#fff', () => {
            ctx.translate(x, y);
            ctx.rotate(rotation);
            ctx.font = `${size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 0, 0);
          });
        },
      };
      const result: unknown = render({ ...data.frame, ctx }, fx);
      if (result && typeof (result as Promise<unknown>).then === 'function')
        throw new Error('render 必须是同步函数 / render must be synchronous');
      scope.postMessage({ type: 'painted' });
    } catch (error) {
      scope.postMessage({ type: 'error', message: String(error).slice(0, 240) });
    }
  };
}

/** Trusted frame driver: owns resize, frame pacing, watchdog, duration and cleanup. */
function frameRuntime(options: {
  workerSource: string;
  durationMs: number;
  token: string;
  seed: number;
  message: string;
}) {
  const canvas = document.querySelector('canvas')!;
  let worker: Worker;
  let url: string;
  let watchdog: ReturnType<typeof setTimeout>;
  let raf = 0;
  let finished = false;
  let start = 0;
  let last = 0;
  let firstPaint = true;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const report = (type: string, message?: string) =>
    parent.postMessage({ type: 'clutch_fireworks/' + type, token: options.token, message }, '*');
  const stop = () => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    cancelAnimationFrame(raf);
    worker?.terminate();
    if (url) URL.revokeObjectURL(url);
  };
  const fail = (message: string) => {
    stop();
    report('error', message.slice(0, 240));
  };
  const tick = (now: number) => {
    if (finished) return;
    if (!start) start = now;
    const time = reducedMotion
      ? options.durationMs * 0.5
      : Math.min(now - start, options.durationMs);
    if (now - start > options.durationMs) {
      stop();
      report('done');
      return;
    }
    const width = Math.min(innerWidth, 3840);
    const height = Math.min(innerHeight, 2160);
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (width * height)));
    watchdog = setTimeout(() => fail('动画帧超时 / Animation frame timed out'), 750);
    worker.postMessage({
      type: 'frame',
      frame: {
        width,
        height,
        dpr,
        time,
        delta: last ? now - last : 0,
        progress: time / options.durationMs,
        durationMs: options.durationMs,
        seed: options.seed,
        message: options.message,
      },
    });
    last = now;
  };
  try {
    if (!canvas.transferControlToOffscreen) throw new Error('OffscreenCanvas unavailable');
    const offscreen = canvas.transferControlToOffscreen();
    url = URL.createObjectURL(new Blob([options.workerSource], { type: 'text/javascript' }));
    worker = new Worker(url);
    worker.onerror = () => fail('脚本语法或运行错误 / Animation script failed');
    worker.onmessage = ({ data }) => {
      if (finished) return;
      clearTimeout(watchdog);
      if (data.type === 'error') {
        fail(String(data.message));
        return;
      }
      if (data.type === 'painted' && firstPaint) {
        firstPaint = false;
        report('ready');
      }
      if (data.type === 'painted' && reducedMotion) {
        stop();
        report('done');
        return;
      }
      if (data.type === 'ready' || data.type === 'painted') raf = requestAnimationFrame(tick);
    };
    watchdog = setTimeout(() => fail('脚本启动超时 / Animation startup timed out'), 1500);
    worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
    addEventListener('pagehide', stop, { once: true });
  } catch (error) {
    fail(String(error));
  }
}

export function animationDocument(
  template: AnimationTemplate,
  token: string,
  seed: number,
  message = '',
): string {
  const workerSource = `"use strict";\n${template.source}\n;(${workerRuntime.toString()})(typeof render === 'function' ? render : null);`;
  const options = JSON.stringify({
    workerSource,
    durationMs: template.durationMs,
    token,
    seed,
    message,
  }).replaceAll('<', '\\u003c');
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}canvas{width:100%;height:100%;display:block}</style><canvas aria-hidden="true"></canvas><script>(${frameRuntime.toString()})(${options})</script>`;
}
