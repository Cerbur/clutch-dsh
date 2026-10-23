/** Browser/DSH DOM contract adapter shared by component and preflight tests. */
export function animationThemeHost({ theme = 'light', osDark = false } = {}) {
  const observers = new Set();
  const mediaListeners = new Set();
  const windowListeners = new Map();
  const element = () => ({
    attributes: new Map(),
    style: {},
    backgroundColor: 'rgba(0, 0, 0, 0)',
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    hasAttribute(name) {
      return this.attributes.has(name);
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
  });
  const root = element();
  root.style.colorScheme = theme;
  root.setAttribute('data-ds-theme-source', theme);
  const body = element();
  const frames = [];
  const window = {
    matchMedia: () => ({
      matches: osDark,
      addEventListener: (_type, listener) => mediaListeners.add(listener),
      removeEventListener: (_type, listener) => mediaListeners.delete(listener),
    }),
    addEventListener(name, listener) {
      if (!windowListeners.has(name)) windowListeners.set(name, new Set());
      windowListeners.get(name).add(listener);
    },
    removeEventListener: (name, listener) => windowListeners.get(name)?.delete(listener),
  };
  const createFrame = () => {
    const frame = element();
    frame.removed = false;
    const listeners = new Set();
    frame.messages = [];
    frame.contentWindow = {
      postMessage(data, targetOrigin) {
        frame.messages.push({ data, targetOrigin });
        frame.sandbox?.receive(data);
      },
    };
    frame.addEventListener = (name, listener) => {
      if (name === 'load') listeners.add(listener);
    };
    frame.removeEventListener = (name, listener) => {
      if (name === 'load') listeners.delete(listener);
    };
    frame.load = () => {
      for (const listener of listeners) listener();
    };
    frame.remove = () => {
      frame.removed = true;
    };
    frame.listeners = listeners;
    frames.push(frame);
    return frame;
  };
  const document = {
    documentElement: root,
    body,
    createElement: createFrame,
    querySelector: () => ({}),
  };
  body.append = () => {};
  const globals = {
    window,
    document,
    getComputedStyle: (element) => ({
      colorScheme: element.style.colorScheme ?? 'normal',
      backgroundColor: element.backgroundColor,
    }),
    MutationObserver: class {
      constructor(update) {
        this.update = update;
        this.targets = [];
        observers.add(this);
      }
      observe(target, options) {
        this.targets.push({ target, options });
      }
      disconnect() {
        observers.delete(this);
      }
    },
  };
  return {
    ...globals,
    globals,
    root,
    body,
    frames,
    observers,
    mediaListeners,
    windowListeners,
    createFrame,
    mutate(target, name) {
      for (const observer of observers)
        if (
          observer.targets.some(
            (entry) => entry.target === target && entry.options.attributeFilter.includes(name),
          )
        )
          observer.update();
    },
    setTheme(theme) {
      root.style.colorScheme = theme;
      root.setAttribute('data-ds-theme-source', theme);
      if (theme === 'dark') body.setAttribute('data-ds-dark-theme', '');
      else body.removeAttribute('data-ds-dark-theme');
      this.mutate(root, 'style');
    },
    setOsDark(value) {
      osDark = value;
      for (const listener of mediaListeners) listener();
    },
    report(frame, type, overrides = {}) {
      const token = JSON.parse(frame.srcdoc.match(/"token":("[^"]+")/)[1]);
      for (const listener of [...(windowListeners.get('message') ?? [])])
        listener({
          source: frame.contentWindow,
          data: { token, type: 'clutch_fireworks/' + type, message: 'broken' },
          ...overrides,
        });
    },
  };
}

export function installAnimationThemeHost(t, options) {
  const host = animationThemeHost(options);
  const previous = new Map(
    Object.keys(host.globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, host.globals);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  return host;
}
