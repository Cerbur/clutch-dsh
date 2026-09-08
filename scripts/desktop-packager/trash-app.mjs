import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** Move an installed application into the current user's macOS Trash. */
export function moveAppToTrash(path, trashDirectory = join(homedir(), '.Trash')) {
  mkdirSync(trashDirectory, { recursive: true, mode: 0o700 });
  const name = basename(path).replace(/\.app$/u, '');
  const timestamp = new Date().toISOString().replaceAll(':', '.');
  const destination = join(trashDirectory, `${name} ${timestamp} ${randomUUID().slice(0, 8)}.app`);
  const result = spawnSync('/bin/mv', [path, destination], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `local app: could not move previous application to Trash: ${result.stderr.trim() || result.signal || result.status}`,
    );
  }
  return destination;
}
