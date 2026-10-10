// Intentionally red Market eligibility repro; reads only installed Market code.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { URL, pathToFileURL } from 'node:url';

assert.ok(process.argv[2], 'pass the installed dshmarket lib/hot.js path');
const { parseSimplePatch } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const text = await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8');
const rows = parseSimplePatch(text);
console.log('Market hot-mount rows:', rows);
assert.ok(rows, 'fresh Desktop installation must be eligible for Market hot mounting without restart');
