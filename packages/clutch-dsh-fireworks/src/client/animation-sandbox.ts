import type { AnimationTemplate, AnimationRender } from '../animation.js';

/** Runs only inside a CSP-restricted, opaque-origin iframe's dedicated Worker. */
function workerRuntime(render: AnimationRender) {
  let canvas: OffscreenCanvas;
  let validationCanvas: OffscreenCanvas | undefined;
  // Per-playback sprites avoid re-rasterizing changing emoji fonts and blurred particles.
  const sprites = new Map<string, OffscreenCanvas>();
  let spritePixels = 0;
  let spriteDpr = 0;
  const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent) => void;
    postMessage: (value: unknown) => void;
  };
  scope.onmessage = ({ data }) => {
    try {
      if (data.type === 'init') {
        if (typeof render !== 'function') throw new Error('请定义 function render(frame, fx)');
        canvas = data.canvas;
        if (!canvas.getContext('2d')) throw new Error('Canvas 2D unavailable');
        scope.postMessage({ type: 'ready' });
        return;
      }
      const { width, height, dpr, seed } = data.frame;
      // Retain the visible canvas for midpoint redraws after validation has begun.
      const target =
        data.type === 'validate' ? (validationCanvas ??= new OffscreenCanvas(1, 1)) : canvas;
      const ctx = target.getContext('2d')!;
      if (!ctx) throw new Error('Canvas 2D unavailable');
      if (spriteDpr !== dpr) {
        sprites.clear();
        spritePixels = 0;
        spriteDpr = dpr;
      }
      const sprite = (
        key: string,
        width: number,
        height: number,
        draw: (context: OffscreenCanvasRenderingContext2D) => void,
      ) => {
        const cached = sprites.get(key);
        if (cached) return cached;
        const w = Math.ceil(width * dpr);
        const h = Math.ceil(height * dpr);
        if (
          typeof OffscreenCanvas !== 'function' ||
          !Number.isFinite(w * h) ||
          w <= 0 ||
          h <= 0 ||
          sprites.size >= 128 ||
          spritePixels + w * h > 2_000_000
        )
          return;
        const image = new OffscreenCanvas(w, h);
        const context = image.getContext('2d');
        if (!context) return;
        context.setTransform(dpr, 0, 0, dpr, w / 2, h / 2);
        draw(context);
        sprites.set(key, image);
        spritePixels += w * h;
        return image;
      };
      // Round down so integer backing dimensions cannot exceed the pixel budget.
      const pixelWidth = Math.floor(width * dpr);
      const pixelHeight = Math.floor(height * dpr);
      if (target.width !== pixelWidth || target.height !== pixelHeight) {
        target.width = pixelWidth;
        target.height = pixelHeight;
      } else if (typeof ctx.reset === 'function') ctx.reset();
      else target.width = pixelWidth;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let randomState = seed >>> 0;
      const paint = (alpha: number, color: string, draw: () => void) => {
        if (alpha <= 0 && ctx.globalCompositeOperation === 'source-over') return;
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
            const radius = Math.max(0, r);
            const image =
              glow > 0
                ? sprite(
                    JSON.stringify(['circle', radius, color, glow]),
                    (radius + glow * 2) * 2,
                    (radius + glow * 2) * 2,
                    (context) => {
                      context.fillStyle = color;
                      context.shadowColor = color;
                      context.shadowBlur = glow;
                      context.beginPath();
                      context.arc(0, 0, radius, 0, Math.PI * 2);
                      context.fill();
                    },
                  )
                : undefined;
            if (image) {
              const w = image.width / dpr;
              const h = image.height / dpr;
              ctx.shadowBlur = 0;
              ctx.shadowColor = 'transparent';
              ctx.drawImage(image, x - w / 2, y - h / 2, w, h);
              return;
            }
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
            // Rasterize at one stable resolution, then scale the bitmap with the particle.
            // A DPR-specific cache keeps retina displays sharp without a font per frame.
            const rasterSize = size <= 64 ? 64 : 128;
            ctx.font = `${rasterSize}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`;
            const key = JSON.stringify(['emoji', text, rasterSize]);
            const image =
              size > 0 && size <= 128
                ? (sprites.get(key) ??
                  sprite(
                    key,
                    ctx.measureText(text).width + rasterSize,
                    rasterSize * 2,
                    (context) => {
                      context.font = ctx.font;
                      context.fillStyle = '#fff';
                      context.textAlign = 'center';
                      context.textBaseline = 'middle';
                      context.fillText(text, 0, 0);
                    },
                  ))
                : undefined;
            if (image) {
              const w = (image.width / dpr) * (size / rasterSize);
              const h = (image.height / dpr) * (size / rasterSize);
              ctx.drawImage(image, -w / 2, -h / 2, w, h);
              return;
            }
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
  let start: number | undefined;
  let last = 0;
  let firstPaint = true;
  let finalFrame = false;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastDpr = 0;
  let validateAfterRedraw: (() => void) | undefined;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const report = (type: string, message?: string) =>
    parent.postMessage({ type: 'clutch_fireworks/' + type, token: options.token, message }, '*');
  const stop = () => {
    if (finished) return;
    finished = true;
    validateAfterRedraw = undefined;
    clearTimeout(watchdog);
    cancelAnimationFrame(raf);
    worker?.terminate();
    if (url) URL.revokeObjectURL(url);
  };
  const fail = (message: string) => {
    if (finished) return;
    stop();
    report('error', message.slice(0, 240));
  };
  const tick = (now: number) => {
    if (finished) return;
    if (!firstPaint && start === undefined) start = now;
    const time = Math.min(start === undefined ? 0 : now - start, options.durationMs);
    const width = innerWidth;
    const height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (width * height)));
    const frame = {
      width,
      height,
      dpr,
      time,
      delta: last ? now - last : 0,
      progress: time / options.durationMs,
      durationMs: options.durationMs,
      seed: options.seed,
      message: options.message,
    };
    const sendFrame = (midpoint: boolean) => {
      finalFrame = !midpoint && time === options.durationMs;
      watchdog = setTimeout(() => fail('动画帧超时 / Animation frame timed out'), 750);
      worker.postMessage({
        type: reducedMotion && !midpoint ? 'validate' : 'frame',
        frame: midpoint
          ? { ...frame, time: options.durationMs * 0.5, progress: 0.5, delta: 0 }
          : frame,
      });
    };
    if (
      reducedMotion &&
      !firstPaint &&
      (width !== lastWidth || height !== lastHeight || dpr !== lastDpr)
    ) {
      // Acknowledge the redraw before validating this tick, without restarting its clock.
      validateAfterRedraw = () => sendFrame(false);
      sendFrame(true);
    } else sendFrame(reducedMotion && firstPaint);
    lastWidth = width;
    lastHeight = height;
    lastDpr = dpr;
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
        // Reduced motion validates from time zero on its first offscreen frame.
        start = reducedMotion ? undefined : performance.now();
        report('ready');
      }
      if (data.type === 'painted' && validateAfterRedraw) {
        const validate = validateAfterRedraw;
        validateAfterRedraw = undefined;
        validate();
        return;
      }
      if (data.type === 'painted' && finalFrame) {
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
