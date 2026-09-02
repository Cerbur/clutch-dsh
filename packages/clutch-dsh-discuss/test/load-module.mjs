import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export async function loadPackageModule(name) {
  const root =
    process.env.CLUTCH_DSH_DISCUSS_TEST_LIB ?? path.resolve(import.meta.dirname, '../src');
  const extension = process.env.CLUTCH_DSH_DISCUSS_TEST_LIB === undefined ? '.ts' : '.js';
  return import(pathToFileURL(path.join(root, `${name}${extension}`)).href);
}
