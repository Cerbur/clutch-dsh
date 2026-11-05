import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';

// Normalize line endings: the same CSS must satisfy these rules on any checkout.
const source = (await readFile(new URL('../src/client/worktree.css', import.meta.url), 'utf8'))
  .replace(/\r\n/g, '\n');

/** The tree section owns everything from the indent ruler to the end of the file. */
const tree = source.slice(source.indexOf('/* One indent rhythm for the whole tree'));

function rule(text, selector) {
  const start = text.indexOf(selector);
  assert.notEqual(start, -1, 'missing rule: ' + selector);
  const end = text.indexOf('}', start);
  assert.notEqual(end, -1, 'unterminated rule: ' + selector);
  return text.slice(start, end + 1);
}

function variablePx(name) {
  const declared = [...source.matchAll(new RegExp('^\\s*' + name + ': (\\d+)px;', 'gm'))];
  assert.equal(declared.length, 1, name + ' must be declared exactly once');
  return Number(declared[0][1]);
}

/** Ordered `var(--x)` reads inside one declaration, i.e. the arithmetic it composes. */
function variableReads(declaration) {
  return [...declaration.matchAll(/var\((--[\w-]+)/gu)].map((match) => match[1]);
}

function declaration(ruleText, property) {
  const start = ruleText.indexOf(property);
  assert.notEqual(start, -1, 'missing declaration: ' + property);
  const end = ruleText.indexOf(';', start);
  return ruleText.slice(start, end + 1);
}

test('one indent ruler drives every tree level', () => {
  const step = variablePx('--wt-step');
  const lead = variablePx('--wt-lead');
  const labelPad = variablePx('--wt-label-pad');
  const inset = variablePx('--wt-row-inset');

  assert.ok(step > 0 && step <= 16, 'indent step stays compact: ' + step);
  assert.ok(lead >= 16 && lead <= 24, 'leading cell fits a 16px glyph: ' + lead);
  assert.ok(inset <= 6 && labelPad <= 8, 'row insets stay small');

  // A 280px sidebar keeps the deepest label well inside the first third of the width.
  const deepest = inset + 3 * step + lead + labelPad;
  assert.ok(deepest <= 100, 'depth-3 label column stays compact: ' + deepest);

  // Containers own no horizontal offset, so nesting cannot stack margins.
  const container = rule(tree, '.treeChildren {');
  assert.match(container, /margin-inline-start: 0;/);
  assert.match(container, /border-inline-start: 0;/);
  // Vertical breathing only: the inline component of the shorthand stays zero.
  assert.match(container, /padding: 2px 0 5px;/);
  assert.doesNotMatch(container, /margin-left: \d+px;/);
  assert.doesNotMatch(container, /padding-left: \d+px;/);
});

test('a Session label lands on its group label column', () => {
  const row = rule(tree, '.workspaceRow,\n.worktreeRow {');
  const session = rule(tree, '.treeSessionRow {');

  const groupReads = variableReads(declaration(row, 'padding-inline:'));
  const sessionReads = variableReads(declaration(session, 'padding-inline-start:'));

  // Group rows read the ruler once per side: [start inset, depth, step, end inset].
  assert.deepEqual(groupReads, ['--wt-row-inset', '--wt-depth', '--wt-step', '--wt-row-inset']);

  // A Session row repeats exactly the start prefix, then adds the leading cell and its
  // gap, so both land on the same column for the same depth.
  const startPrefix = groupReads.slice(0, 3);
  assert.deepEqual(sessionReads, [...startPrefix, '--wt-lead', '--wt-label-pad']);
});

test('depth is explicit per nesting level, never a self-referencing property', () => {
  for (const depth of [1, 2, 3]) {
    assert.match(source, new RegExp(`--wt-depth: ${depth};`));
  }
  // `--d: calc(var(--d) + 1)` is a cycle and resolves to invalid, which would silently
  // flatten every level to the same inset.
  assert.doesNotMatch(source, /--wt-depth: calc\(/);
  assert.match(rule(tree, '.workspaceRow,\n.worktreeRow {'), /var\(--wt-depth, 0\)/);
});

test('rows stay full width so hover fills and drop markers share one right edge', () => {
  const session = rule(tree, '.treeSessionRow {');
  assert.match(session, /width: 100%;/);
  assert.match(session, /margin-inline-start: 0;/);
  assert.doesNotMatch(tree, /width: calc\(100% - 20px\);/);
  assert.doesNotMatch(tree, /margin-left: 20px;/);
});

test('navigation rows share the control-band radius token', () => {
  const row = rule(tree, '.workspaceRow,\n.worktreeRow {');
  assert.match(row, /border-radius: var\(--dsw-radius-md\);/);
  assert.match(row, /cursor: pointer;/);
  assert.match(row, /user-select: none;/);
  assert.match(rule(tree, '.treeSessionRow {'), /border-radius: var\(--dsw-radius-md\);/);
});

test('the disclosure overlays its icon cell instead of toggling layout', () => {
  const disclosure = rule(tree, '.disclosureButton {');
  assert.match(disclosure, /position: absolute;/);
  // A 24px hit target remains centered on the 20px leading cell.
  assert.match(disclosure, /width: 24px;/);
  assert.match(disclosure, /height: 24px;/);
  assert.match(disclosure, /- 2px/);

  // The reveal must not switch display, or the label would shift on hover.
  const revealRegion = tree.slice(
    tree.indexOf('.workspaceRow .workspaceDisclosure'),
    tree.indexOf('.disclosureButton {'),
  );
  assert.match(revealRegion, /opacity: 0;/);
  assert.match(revealRegion, /pointer-events: none;/);
  assert.doesNotMatch(revealRegion, /display: none;/);
  assert.doesNotMatch(revealRegion, /display: inline-flex;/);

  // Hover reveal is pointer-only; keyboard users get the same affordance.
  assert.match(
    tree,
    /@media \(hover: hover\)\s*\{[\s\S]*\.worktreeRow:hover \.worktreeDisclosure/,
  );
  assert.match(tree, /\.worktreeRow:focus-within \.worktreeDisclosure/);
  assert.match(
    tree,
    /\.disclosureButton:focus-visible \{[\s\S]*outline: var\(--dsw-focus-ring-width\) solid[\s\S]*--dsw-focus-ring-color/,
  );
  assert.match(tree, /\.disclosureButton:focus-visible \{[\s\S]*outline-offset: 2px;/);
});

test('the disclosure follows the shared motion, press, and touch rules', () => {
  const disclosure = rule(tree, '.disclosureButton {');
  assert.match(disclosure, /font-size: 13px;/);
  assert.match(disclosure, /line-height: 20px;/);

  const arrow = rule(tree, '.disclosureArrow {');
  assert.match(
    arrow,
    /transition: transform var\(--ds-transition-duration\) var\(--ds-ease-in-out\);/,
  );

  assert.match(
    tree,
    /\.disclosureButton:active \{\s*background: var\(--dsw-alias-interactive-bg-active\);/,
  );
  assert.match(
    tree,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.disclosureArrow \{\s*transition: none;/,
  );

  // Hover feedback is pointer-only; touch keeps the switch affordance visible.
  assert.match(tree, /@media \(hover: hover\) \{\s*\.disclosureButton:hover \{/);
  assert.match(
    tree,
    /@media \(hover: none\) \{\s*\.workspaceRow \.workspaceDisclosure,[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto;/,
  );
});

test('the action column sets the title viewport without moving the leading or action cells', () => {
  const row = rule(tree, '.worktreeRow {\n  min-height: 32px;');
  assert.match(row, /grid-template-columns: var\(--wt-lead\) minmax\(0, 1fr\) max-content;/);
  const label = rule(tree, '.worktreeRow > .worktreeLabel {');
  assert.match(label, /grid-area: 1 \/ 2 \/ 2 \/ 4;/);
  assert.match(label, /margin-inline-end: 32px;/);
  const reveal = rule(tree, '.worktreeRow:hover .worktreeLabel,\n.worktreeRow[data-menu-open=');
  assert.match(reveal, /grid-column-end: 3;/);
  assert.match(reveal, /margin-inline-end: 4px;/);
  const rail = rule(tree, '.worktreeRow .treeActionSlot {');
  assert.match(rail, /grid-area: 1 \/ 3;/);
  assert.doesNotMatch(tree, /\.worktreeRow:hover \.treeActionSlot \{/);
});

test('Workspace and Session selection keep regular weight while Main stays emphasized', () => {
  const mainLabel = rule(tree, ".worktreeRow[data-main-group='true'] .worktreeLabel {");
  assert.match(mainLabel, /font-weight: 500;/);
  assert.doesNotMatch(mainLabel, /font-weight: 600;/);
  const currentSession = rule(
    tree,
    ".treeSessionRow[data-session-current='true'] .treeSessionContent {",
  );
  assert.match(currentSession, /font-weight: 400;/);
  assert.doesNotMatch(currentSession, /font-weight: 600;/);
  const openWorkspace = rule(tree, ".workspaceRow[data-workspace-open='true'] .workspaceTitle {");
  assert.match(openWorkspace, /font-weight: 400;/);
});
