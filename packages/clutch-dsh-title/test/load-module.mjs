import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const libraryRoot =
  process.env.CLUTCH_DSH_TITLE_TEST_LIB ?? path.resolve(import.meta.dirname, '../lib');

export async function loadPackageModule(name) {
  return import(pathToFileURL(path.join(libraryRoot, `${name}.js`)).href);
}
