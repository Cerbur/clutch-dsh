import assert from 'node:assert/strict';
import vm from 'node:vm';
import { animationDocument } from '../../lib/client/animation-sandbox.js';

export function sandboxHarness(
  template,
  {
    reducedMotion = false,
    width = 500,
    height = 300,
    dpr = 1,
    validationOnly = false,
    seed = 42,
    theme = 'dark',
    html: suppliedHtml,
  } = {},
) {
  let workerSource;
  let worker;
  const listeners = new Map();
  let terminated = 0;
  let revoked = 0;
  let raf;
  let now = 0;
  const timers = new Map();
  const reports = [];
  const html =
    suppliedHtml ??
    animationDocument(
      template,
      'playback-token',
      seed,
      '</script><script>bad()</script>',
      validationOnly,
      theme,
    );
  const runtime = html.split('<script>')[1].split('</script>')[0];
  const environment = {
    document: { querySelector: () => ({ transferControlToOffscreen: () => ({}) }) },
    Blob: class {
      constructor(parts) {
        workerSource = parts.join('');
      }
    },
    URL: {
      createObjectURL: () => 'blob:opaque-origin',
      revokeObjectURL: () => {
        revoked++;
      },
    },
    Worker: class {
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Expose the fake worker so the test can deliver its messages.
        worker = this;
        this.sent = [];
      }
      postMessage(value) {
        this.sent.push(value);
      }
      terminate() {
        terminated++;
      }
    },
    parent: { postMessage: (value) => reports.push(value) },
    addEventListener: (name, listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener: (name, listener) => listeners.get(name)?.delete(listener),
    setTimeout: (listener, delay) => {
      const id = {};
      timers.set(id, { listener, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (listener) => {
      raf = listener;
      return 1;
    },
    cancelAnimationFrame: () => {
      raf = undefined;
    },
    innerWidth: width,
    matchMedia: () => ({ matches: reducedMotion }),
    innerHeight: height,
    devicePixelRatio: dpr,
    performance: { now: () => now },
  };
  vm.runInNewContext(runtime, environment);
  return {
    html,
    workerSource,
    reports,
    worker,
    timers,
    resize: (width, height, dpr) => {
      environment.innerWidth = width;
      environment.innerHeight = height;
      environment.devicePixelRatio = dpr;
    },
    frame: (time) => {
      now = time;
      const callback = raf;
      raf = undefined;
      callback(time);
    },
    receive: (data, source = environment.parent) => {
      for (const listener of listeners.get('message') ?? []) listener({ data, source });
    },
    listeners,
    hide: () => {
      for (const listener of [...(listeners.get('pagehide') ?? [])]) listener();
    },
    get terminated() {
      return terminated;
    },
    get revoked() {
      return revoked;
    },
  };
}

export function connectSandboxWorker(
  harness,
  context = (target) =>
    new Proxy(
      { fillRect: (...args) => target.push(args) },
      { get: (target, key) => target[key] ?? (() => {}) },
    ),
) {
  const draws = [];
  const hidden = [];
  const drawing = context(draws);
  const canvas = { getContext: () => drawing };
  const privateCanvases = [];
  const runtime = vm.createContext({
    postMessage: (data) => harness.worker.onmessage({ data }),
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        this.drawing = context(hidden);
        privateCanvases.push(this);
      }
      getContext(type) {
        assert.equal(type, '2d');
        return this.drawing;
      }
    },
  });
  vm.runInContext(harness.workerSource, runtime);
  let delivered = harness.worker.sent.length;
  const dispatch = (data) => {
    runtime.pendingMessage = data;
    vm.runInContext('onmessage({ data: pendingMessage })', runtime, { timeout: 1000 });
  };
  dispatch({ type: 'init', canvas });
  const step = () => dispatch(harness.worker.sent[delivered++]);
  const flush = () => {
    while (delivered < harness.worker.sent.length) step();
  };
  return { canvas, draws, hidden, privateCanvases, step, flush, render: dispatch };
}
