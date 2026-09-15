import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

const fileTypeIconUrl = new URL('../src/client/dashboard/git/GitFileTypeIcon.tsx', import.meta.url);

function createMockHarness(sourceCode, primitivesMock = {}) {
  const { outputText: output } = ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const jsx = (type, props) => (typeof type === 'function' ? type(props) : { type, props });
  const exports = {};
  new Function('require', 'exports', output)(
    (name) => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesMock;
      return {};
    },
    exports,
  );
  return exports;
}

test('GitFileTypeIcon delegates to FileTypeIcon and classifyFileType when available', async () => {
  const source = await readFile(fileTypeIconUrl, 'utf8');
  const primitivesMock = {
    FileTypeIcon: ({ kind, size, className }) => ({
      type: 'span',
      props: { 'data-kind': kind, 'data-size': size, className },
    }),
    classifyFileType: (path) => (path.endsWith('.ts') ? 'code' : 'markdown'),
  };

  const { GitFileTypeIcon } = createMockHarness(source, primitivesMock);
  const node = GitFileTypeIcon({ path: 'src/main.ts', className: 'custom-class' });

  assert.equal(node.props['data-kind'], 'code');
  assert.equal(node.props['data-size'], 16);
  assert.equal(node.props['className'], 'custom-class');
});

test('GitFileTypeIcon falls back to svg when primitives are not available', async () => {
  const source = await readFile(fileTypeIconUrl, 'utf8');
  const { GitFileTypeIcon } = createMockHarness(source, {});
  const node = GitFileTypeIcon({ path: 'src/main.ts' });

  assert.equal(node.type, 'svg');
  assert.equal(node.props.width, 16);
  assert.equal(node.props.height, 16);
});
