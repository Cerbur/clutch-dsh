import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import * as sessionSelection from '../lib/client/session/session-selection.js';
import * as worktreeContext from '../lib/client/context/worktree-context.js';

async function renderContextComponent(file) {
  const source = await readFile(new URL('../src/client/context/' + file + '.tsx', import.meta.url), 'utf8');
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const dependencies = {
    react: { useCallback: fn => fn, useLayoutEffect() {}, useState: init => [typeof init === 'function' ? {} : init, () => {}] },
    'react-dom': { createPortal: node => node },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@deepseek-ai/dsh-client-ui-primitives': { HoverCard: ({ anchor }) => anchor },
    '../session/session-selection.js': sessionSelection, './worktree-context.js': worktreeContext,
    '../dsh-icons.js': { IconBranchOutline16: () => null }, './worktree-context.css': { default: {} },
  };
  const exports = {};
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  new Function('require', 'exports', outputText)(name => dependencies[name], exports);
  return exports;
}

test('blank and conversation titles follow effective cwd after forget and Continue in the project', async () => {
  const { WorktreeHeroContext } = await renderContextComponent('WorktreeHeroContext');
  const { WorktreeHeaderContext } = await renderContextComponent('WorktreeContext');
  const root = '/repo';
  const linked = root + '/.agents/worktrees/clutch/wt_1';
  const state = { status: 'ready', sessionId: 's', workspaceTitle: 'Workspace',
    value: { kind: 'main', label: 'trunk' },
    checkout: { gitRootPath: root, currentHead: { name: 'trunk' }, linkedHeads: [{ path: linked, label: 'feature' }] } };
  const row = { id: 's', retainedBy: { mainView: 1 }, cwd: root, blank: true, projectionValues: {} };
  const list = { byId: { s: row } };
  const props = { t: (key, args) => args ? key + ' ' + args.name : key, sessionId: 's',
    useSessions: select => select(list), useWorktreeContext: select => select(state),
    useProjection: () => row.projectionValues.workingDirectory };
  for (const [cwd, label, kind] of [[linked + '/app', 'feature', 'worktree'], [root, 'trunk', 'main']]) {
    row.projectionValues.workingDirectory = cwd;
    const hero = WorktreeHeroContext(props).props.children.props;
    assert.equal(hero.children, 'Workspace (' + label + ')');
    assert.equal(hero['aria-label'], 'context.' + kind + ' ' + label);
    const header = WorktreeHeaderContext(props).props;
    assert.equal(header.title, label);
    assert.equal(header['aria-label'], hero['aria-label']);
  }
  delete row.projectionValues.workingDirectory;
  assert.equal(WorktreeHeroContext(props), null, 'header cwd cannot substitute for a missing effective cwd');
  list.byId = {};
  assert.equal(WorktreeHeroContext(props), null, 'a previous Session cannot label a new Hero');
  delete state.sessionId;
  assert.equal(WorktreeHeroContext(props).props.children.props.children, 'Workspace (trunk)');
});

test('keeps the Session header hover card and adds a Hero title overlay', async () => {
  const source = await readFile(new URL('../src/client/context/WorktreeContext.tsx', import.meta.url), 'utf8');
  const heroSource = await readFile(
    new URL('../src/client/context/WorktreeHeroContext.tsx', import.meta.url),
    'utf8',
  );
  const entry = await readFile(new URL('../src/client/entry.ts', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/client/context/worktree-context.css', import.meta.url), 'utf8');

  assert.match(source, /WorktreeHeaderContext/);
  assert.match(source, /conversation\.session\.header\.actions/);
  assert.match(source, /title=\{value\.label\}/);
  assert.match(source, /\bHoverCard\b/);
  assert.match(source, /openDelayMs=\{500\}/);
  assert.match(
    source,
    /content=\{<div className=\{styles\.contextHoverTitle\}>\{value\.label\}<\/div>\}/,
  );
  assert.match(heroSource, /WorktreeHeroContext/);
  assert.match(heroSource, /data-phase/);
  assert.match(heroSource, /querySelector/);
  assert.match(heroSource, /offsetParent/);
  assert.match(heroSource, /previewBadge/);
  assert.match(heroSource, /HoverCard/);
  assert.match(heroSource, /openDelayMs=\{500\}/);
  assert.match(heroSource, /content=\{<div className=\{styles\.contextHoverTitle\}>\{label\}<\/div>\}/);
  assert.match(entry, /WorktreeOverlay/);
  assert.match(entry, /shell\.overlay/);
  assert.match(css, /headerContext/);
  assert.match(css, /heroContext/);
  assert.match(css, /\.contextHoverTitle[\s\S]*overflow-wrap: anywhere;/);
  assert.match(css, /\.heroContext[\s\S]*pointer-events: auto;/);
  assert.match(heroSource, /data-worktree-hero-host/);
  assert.match(
    css,
    /\.heroContextHost[\s\S]*position: absolute;/,
  );
  assert.doesNotMatch(css, /\.heroContext\s*\{[\s\S]*position: absolute;/);
  assert.match(css, /text-overflow: ellipsis/);
});
