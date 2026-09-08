import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Patch only a literal top-level Electron application menu; reject unknown output. */
export function patchEditMenu(source, ts) {
  const file = ts.createSourceFile(
    'main.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (file.parseDiagnostics.length) throw new Error('edit menu: invalid JavaScript');
  const names = file.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'electron')
      return [];
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    return bindings.elements
      .filter((item) => (item.propertyName ?? item.name).text === 'Menu')
      .map((item) => item.name.text);
  });
  if (names.length !== 1) throw new Error('edit menu: expected one Electron Menu import');
  const isMethod = (node, name) =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === names[0] &&
    node.expression.name.text === name;
  const calls = [];
  const visit = (node) => {
    if (isMethod(node, 'buildFromTemplate')) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (calls.length !== 1) throw new Error('edit menu: expected one Menu.buildFromTemplate call');
  const call = calls[0];
  const array = call.arguments[0];
  if (
    !isMethod(call.parent, 'setApplicationMenu') ||
    call.parent.arguments.length !== 1 ||
    call.arguments.length !== 1 ||
    !array ||
    !ts.isArrayLiteralExpression(array) ||
    array.elements.length === 0 ||
    !array.elements.every(ts.isObjectLiteralExpression)
  ) {
    throw new Error('edit menu: expected literal top-level application menu objects');
  }
  const roles = array.elements.flatMap((item) =>
    item.properties.filter(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name?.text === 'role' &&
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === 'editMenu',
    ),
  );
  if (roles.length > 1) throw new Error('edit menu: duplicate top-level editMenu');
  if (roles.length === 1) {
    if (array.elements[0].properties.includes(roles[0])) {
      throw new Error('edit menu: first macOS menu must remain the application menu');
    }
    return source;
  }
  const offset = array.elements[array.elements.length - 1].end;
  return `${source.slice(0, offset)}, { role: 'editMenu' }${source.slice(offset)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [repo, main] = process.argv.slice(2);
  if (!repo || !main) throw new Error('Usage: node patch-edit-menu.mjs <dsh-repo> <app-main.js>');
  const ts = createRequire(join(resolve(repo), 'package.json'))('typescript');
  const source = readFileSync(main, 'utf8');
  const patched = patchEditMenu(source, ts);
  if (patchEditMenu(patched, ts) !== patched) throw new Error('edit menu: patch is not idempotent');
  if (source !== patched) writeFileSync(main, patched);
  console.log('Verified one top-level Electron editMenu in packaged main.js');
}
