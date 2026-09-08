import { readFile, readdir } from 'node:fs/promises';
import { URL } from 'node:url';
import ts from 'typescript';

async function surfaceFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const name = prefix + entry.name;
      return entry.isDirectory()
        ? surfaceFiles(new URL(entry.name + '/', directory), name + '/')
        : /\.tsx?$/.test(entry.name)
          ? [name]
          : [];
    }),
  );
  return files.flat();
}

/** Read canonical production modules for source-contract assertions. */
export async function readSurfaceSource(selected) {
  const directory = new URL('../src/client/surface/', import.meta.url);
  const files = selected ?? [
    '../WorktreeSurface.tsx',
    ...(await surfaceFiles(directory))
      .filter(
        (file) =>
          !['components/rows.tsx', 'components/dialogs.tsx', 'types.ts'].includes(file),
      )
      .sort(),
  ];
  return (await Promise.all(files.map((file) => readFile(new URL(file, directory), 'utf8')))).join(
    '\n',
  );
}

export async function readSurfaceDeclaration(file, name) {
  const source = await readSurfaceSource([file]);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) return node;
    return ts.forEachChild(node, find);
  }
  const node = find(ast);
  if (!node) throw new Error('Missing production declaration: ' + file + ':' + name);
  return node.getText(ast);
}

export async function readSurfaceGroupRow(file, kind) {
  const source = await readSurfaceSource([file]);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function find(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(ast) === 'WorktreeGroupRow' &&
      node.attributes.properties.some(
        (attr) =>
          ts.isJsxAttribute(attr) && attr.name.text === 'kind' && attr.initializer?.text === kind,
      )
    )
      return node;
    return ts.forEachChild(node, find);
  }
  const node = find(ast);
  if (!node) throw new Error('Missing production group row: ' + file + ':' + kind);
  return node.getText(ast);
}
