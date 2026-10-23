import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

const { AbortController, TextEncoder, TextDecoder, setTimeout, clearTimeout, URL } = globalThis;

const source = (name) =>
  `// clutch_fireworks: {"version":1,"name":"${name}","durationMs":500}\nfunction render() {}`;
const a = source('Saved A'),
  b = source('Saved B');

/** Render the actual shipped settings component with a small synchronous hook driver. */
async function harness(t) {
  let plugin,
    Component,
    cursor = 0,
    changed = false,
    tree;
  const hooks = [],
    effects = [],
    disposers = [];
  const snapshot = {
    preferences: { active: 'emoji', scripts: { 'custom-a': a, 'custom-b': b } },
    revision: 1,
    writable: true,
    loaded: true,
  };
  const saves = [];
  let failure;
  const store = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    async load() {},
    async save(preferences, revision) {
      if (failure) throw new Error(failure);
      saves.push({ preferences, revision });
      snapshot.preferences = preferences;
      snapshot.revision++;
    },
  };
  let callback;
  let validationError;
  const validate = async () => {
    if (validationError) throw new Error(validationError);
  };
  const playback = {
    previewAnimation(_template, notify) {
      callback = notify;
      return () => notify('cancelled');
    },
  };
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [
        hooks[index],
        (value) => {
          const next = typeof value === 'function' ? value(hooks[index]) : value;
          if (!Object.is(next, hooks[index])) {
            hooks[index] = next;
            changed = true;
          }
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (hooks[index] ??= { current: initial });
    },
    useMemo: (calculate) => calculate(),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    useEffect(effect, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, i) => value !== hooks[index][i])) {
        hooks[index] = deps;
        effects.push(effect);
      }
    },
  };
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((name) => {
            if (name === 'react') return react;
            if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
            throw new Error(name);
          });
        },
      },
    },
    document: { querySelector: () => ({}), documentElement: { lang: 'zh-CN' } },
    crypto: { randomUUID },
    TextEncoder,
    TextDecoder,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
  });
  const context = {
    remote: {
      $mount: async () => () => {},
      clutch_fireworks: {
        async loadAnimations() {
          return { ok: true, value: snapshot };
        },
        events(_query, signal) {
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  new Promise((resolve) =>
                    signal.addEventListener('abort', () => resolve({ done: true }), { once: true }),
                  ),
              };
            },
            dispose() {},
          };
        },
      },
    },
    uiWorkspace: { openSession() {} },
    effect(effect) {
      const result = effect();
      if (typeof result === 'function') disposers.push(result);
      return result;
    },
    inject: (_deps, register) => register(context),
    slots: {
      inject: (_name, register) => register(),
      register(options, component) {
        if (options.name === 'plugins.bundle.config') Component = component;
      },
    },
  };
  await plugin.apply(context);
  t.after(() => {
    for (const dispose of disposers.reverse()) dispose();
  });
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== 'object') return [];
    return [node, ...nodes(node.props?.children)];
  }
  const text = (node) =>
    Array.isArray(node)
      ? node.map(text).join('')
      : typeof node === 'object' && node
        ? text(node.props?.children)
        : node == null || typeof node === 'boolean'
          ? ''
          : String(node);
  function render() {
    for (let i = 0; i < 15; i++) {
      cursor = 0;
      changed = false;
      tree = Component({ store, playback, validate });
      for (const effect of effects.splice(0)) effect();
      if (!changed) return;
    }
    throw new Error('Settings render did not settle');
  }
  function button(name) {
    const found = nodes(tree).find(
      (node) =>
        node.type === 'button' && (node.props['aria-label'] === name || text(node) === name),
    );
    assert.ok(found, `Button ${name}`);
    return found;
  }
  async function click(name) {
    const node = button(name);
    assert.ok(!node.props.disabled, `${name} must be enabled`);
    await node.props.onClick();
    await setImmediate();
    render();
  }
  async function upload(name, content = source(name)) {
    const input = nodes(tree).find((node) => node.type === 'input' && node.props.type === 'file');
    input.props.onChange({
      target: {
        files: [
          { name: name + '.js', size: Buffer.byteLength(content), text: async () => content },
        ],
        value: '',
      },
    });
    await setImmediate();
    render();
  }
  render();
  return {
    click,
    button,
    upload,
    saves,
    snapshot,
    fail(message) {
      failure = message;
    },
    render,
    nodes: () => nodes(tree),
    validationFail(message) {
      validationError = message;
    },
    buttons: () => nodes(tree).filter((node) => node.type === 'button'),
    text: () => text(tree),
    report(status) {
      callback(status);
      render();
    },
    oldCallback: () => callback,
  };
}

test('selecting a template updates immediately, with no Save or Discard operation', async (t) => {
  const ui = await harness(t);
  await ui.click('Saved A');
  assert.equal(ui.saves.at(-1).preferences.active, 'custom-a');
  await ui.click('Saved B');
  assert.equal(ui.saves.at(-1).preferences.active, 'custom-b');
  assert.equal(ui.saves.at(-1).revision, 2);
  await ui.click('Saved B');
  assert.equal(ui.saves.length, 2, 'clicking the current template is a no-op');
  assert.doesNotMatch(ui.text(), /保存动画设置|放弃修改|Animation Studio|导入先校验/);
});

test('invalid imported headers do not persist or replace the current selection', async (t) => {
  const ui = await harness(t);
  await ui.upload('Invalid', 'function render() {}');
  assert.equal(ui.saves.length, 0);
  assert.equal(ui.snapshot.preferences.active, 'emoji');
  assert.match(ui.text(), /Missing animation header/);
});

test('import stages, previews without writing, then confirms and activates; other previews preserve selection', async (t) => {
  const ui = await harness(t);
  await ui.upload('Imported');
  assert.equal(ui.saves.length, 0);
  assert.equal(ui.snapshot.preferences.active, 'emoji');
  assert.match(ui.text(), /确认添加动画/);
  assert.equal(
    ui.buttons().some((node) => node.props['aria-label'] === '导出 Imported'),
    false,
  );
  await ui.click('预览 Imported');
  ui.report('ready');
  ui.report('done');
  assert.equal(ui.saves.length, 0);
  await ui.click('确认添加');
  assert.equal(ui.saves.length, 1);
  const imported = ui.snapshot.preferences.active;
  assert.match(imported, /^custom-/);
  assert.equal(Object.keys(ui.snapshot.preferences.scripts).length, 3);
  await ui.click('预览 Saved A');
  ui.report('ready');
  ui.report('done');
  assert.equal(ui.saves.length, 1);
  assert.equal(ui.snapshot.preferences.active, imported);
  assert.doesNotMatch(ui.text(), /正在全屏播放|验证中|预览不改变|脚本验证通过/);
});

test('delete is per card, preserves another selection, and deleting the current template falls back to Emoji', async (t) => {
  const ui = await harness(t);
  await ui.click('Saved A');
  await ui.click('删除 Saved B');
  assert.equal(ui.saves.length, 1);
  assert.ok(ui.snapshot.preferences.scripts['custom-b']);
  assert.ok(ui.nodes().find((n) => n.props?.['data-deleting'] === true));
  await ui.click('取消删除 Saved B');
  assert.equal(ui.saves.length, 1);
  assert.ok(!ui.nodes().some((n) => n.props?.['data-deleting'] === true));
  await ui.click('删除 Saved B');
  await ui.click('确认删除 Saved B');
  assert.equal(ui.snapshot.preferences.active, 'custom-a');
  assert.equal(ui.snapshot.preferences.scripts['custom-b'], undefined);
  await ui.click('删除 Saved A');
  await ui.click('确认删除 Saved A');
  assert.equal(ui.snapshot.preferences.active, 'emoji');
  assert.equal(Object.keys(ui.snapshot.preferences.scripts).length, 0);
  assert.equal(
    ui.buttons().filter((node) => node.props['aria-label']?.startsWith('删除 ')).length,
    0,
  );
});

test('failed updates retain the current template and surface errors; stale preview completion cannot alter it', async (t) => {
  const ui = await harness(t);
  await ui.click('预览 Saved A');
  const stale = ui.oldCallback();
  await ui.click('Saved B');
  stale('done');
  ui.fail('SETTINGS_CONFLICT');
  await ui.click('Saved A');
  assert.equal(ui.snapshot.preferences.active, 'custom-b');
  assert.match(ui.text(), /SETTINGS_CONFLICT/);
});

test('cancelled import and rejected sandbox validation never persist', async (t) => {
  const ui = await harness(t);
  await ui.upload('Cancelled');
  await ui.click('预览 Cancelled');
  const stale = ui.oldCallback();
  await ui.click('取消添加');
  stale('done');
  assert.equal(ui.saves.length, 0);
  assert.doesNotMatch(ui.text(), /确认添加动画|脚本验证通过/);
  ui.validationFail('脚本语法或运行错误');
  await ui.upload('Broken');
  assert.match(ui.text(), /动画文件无效/);
  assert.match(ui.text(), /脚本语法或运行错误/);
  assert.doesNotMatch(ui.text(), /确认添加动画/);
  await ui.click('知道了');
  assert.equal(ui.saves.length, 0);
});

test('failed confirmation keeps the pending source for retry without changing selection', async (t) => {
  const ui = await harness(t);
  await ui.upload('Retry');
  ui.fail('SETTINGS_CONFLICT');
  await ui.click('确认添加');
  assert.equal(ui.saves.length, 0);
  assert.equal(ui.snapshot.preferences.active, 'emoji');
  assert.match(ui.text(), /确认添加动画|SETTINGS_CONFLICT/);
  ui.fail(undefined);
  await ui.click('确认添加');
  assert.equal(ui.saves.length, 1);
});

test('known preview failures block adding until a successful retry', async (t) => {
  const ui = await harness(t);
  await ui.upload('Runtime');
  await ui.click('预览 Runtime');
  ui.report('error');
  assert.ok(ui.button('确认添加').props.disabled);
  assert.equal(ui.saves.length, 0);
  await ui.click('预览 Runtime');
  assert.ok(
    ui.button('确认添加').props.disabled,
    'retry must finish before clearing a known failure',
  );
  ui.report('done');
  await ui.click('确认添加');
  assert.equal(ui.saves.length, 1);
});

test('delete confirmation replaces footer actions and puts delete before cancel', async (t) => {
  const ui = await harness(t);
  await ui.click('删除 Saved A');
  assert.doesNotMatch(ui.text(), /确定删除此动画/);
  assert.match(ui.text(), /确定删除？删除取消/);
  assert.equal(
    ui.buttons().some((n) => n.props['aria-label'] === '预览 Saved A'),
    false,
  );
  await ui.click('取消删除 Saved A');
  assert.ok(ui.button('预览 Saved A'));
});

test('preview uses a circular progress control and clears it on cancel/completion', async (t) => {
  const ui = await harness(t);
  await ui.click('预览 Saved A');
  ui.report('ready');
  assert.ok(ui.nodes().some((n) => n.props?.role === 'progressbar'));
  assert.doesNotMatch(ui.text(), /停止预览|正在全屏播放|验证中/);
  await ui.click('停止预览 Saved A');
  assert.equal(
    ui.nodes().some((n) => n.props?.role === 'progressbar'),
    false,
  );
});

test('pending import circular preview keeps a readable stop action for assistive technology', async (t) => {
  const ui = await harness(t);
  await ui.upload('Pending');
  await ui.click('预览 Pending');
  ui.report('ready');
  assert.ok(ui.button('停止预览 Pending'));
  assert.doesNotMatch(ui.text(), /停止预览|正在全屏播放|验证中/);
  await ui.click('停止预览 Pending');
  assert.ok(ui.button('预览 Pending'));
  assert.equal(ui.saves.length, 0);
});

test('broken entries remain visible with delete only and keep healthy scripts while removing the list entry', async (t) => {
  const ui = await harness(t);
  ui.snapshot.preferences = {
    active: 'emoji',
    scripts: { 'custom-b': b },
    unavailable: { 'custom-a': { name: 'Saved A', durationMs: 500 } },
  };
  ui.render();
  assert.match(ui.text(), /本地文件损坏/);
  assert.ok(ui.button('Saved A').props.disabled);
  assert.equal(
    ui
      .buttons()
      .some(
        (n) => n.props['aria-label'] === '预览 Saved A' || n.props['aria-label'] === '导出 Saved A',
      ),
    false,
  );
  await ui.click('删除 Saved A');
  await ui.click('确认删除 Saved A');
  assert.equal(ui.snapshot.preferences.unavailable, undefined);
  assert.equal(ui.snapshot.preferences.scripts['custom-b'], b);
});
