import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import {
  ANIMATION_FILES_DIRECTORY,
  MAX_SCRIPT_BYTES,
  isAnimationFilePath,
  parseAnimation,
} from './animation.js';

const hash = (source: string) => createHash('sha256').update(source).digest('hex');
class CorruptAnimationFileError extends Error {}

/** Private, immutable content-addressed files. No public file-serving endpoint. */
export class AnimationFiles {
  constructor(private readonly home: string) {}

  private async directory(create: boolean): Promise<string> {
    if (create) await mkdir(this.home, { recursive: true, mode: 0o700 });
    let directory = await realpath(this.home);
    for (const segment of ANIMATION_FILES_DIRECTORY.split('/')) {
      directory = join(directory, segment);
      if (create) {
        try {
          await mkdir(directory, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('Unsafe animation directory');
    }
    return directory;
  }

  async read(path: string, id: string, signal?: AbortSignal): Promise<string> {
    if (!isAnimationFilePath(path)) throw new Error('Invalid animation file reference');
    signal?.throwIfAborted();
    const directory = await this.directory(false);
    const file = await open(
      join(directory, path.slice(ANIMATION_FILES_DIRECTORY.length + 1)),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error('Invalid animation file type');
      if (info.size > MAX_SCRIPT_BYTES)
        throw new CorruptAnimationFileError('Invalid animation file size');
      const bytes = Buffer.alloc(MAX_SCRIPT_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_SCRIPT_BYTES)
        throw new CorruptAnimationFileError('Animation exceeds 64 KiB');
      const source = bytes.subarray(0, length).toString('utf8');
      if (path !== `${ANIMATION_FILES_DIRECTORY}/${hash(source)}.js`)
        throw new CorruptAnimationFileError('Animation file checksum mismatch');
      parseAnimation(source, id);
      signal?.throwIfAborted();
      return source;
    } finally {
      await file.close();
    }
  }

  async write(source: string, id: string, signal?: AbortSignal): Promise<string> {
    parseAnimation(source, id);
    signal?.throwIfAborted();
    const path = `${ANIMATION_FILES_DIRECTORY}/${hash(source)}.js`;
    try {
      await this.read(path, id, signal);
      return path;
    } catch (error) {
      // Re-importing identical source can repair damaged bytes at its hash path.
      // A valid existing file is reused above; symlinks/type errors remain refused.
      if (
        !(error instanceof CorruptAnimationFileError) &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      )
        throw error;
    }
    const directory = await this.directory(true);
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(source, 'utf8');
      await file.sync();
      await file.close();
      signal?.throwIfAborted();
      await rename(temporary, join(directory, `${hash(source)}.js`));
      return path;
    } finally {
      await file.close();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  /** Delete only an explicitly removed hash, after checking persisted profiles. */
  async removeUnreferenced(path: string): Promise<void> {
    if (!isAnimationFilePath(path)) throw new Error('Invalid animation file reference');
    const references = (value: unknown): boolean => {
      if (typeof value === 'string')
        return (
          value === path ||
          (value.startsWith('// clutch_fireworks: ') &&
            `${ANIMATION_FILES_DIRECTORY}/${hash(value)}.js` === path)
        );
      if (!value || typeof value !== 'object') return false;
      return Object.values(value).some(references);
    };
    const documents: string[] = [];
    const collect = async (directory: string) => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (/^cordis(?:\.patch)?\.ya?ml$/.test(entry.name))
          documents.push(join(directory, entry.name));
      }
    };
    await collect(this.home);
    const profiles = join(this.home, 'profiles');
    let entries;
    try {
      entries = await readdir(profiles, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const entry of entries ?? []) {
      if (entry.isDirectory() || entry.isSymbolicLink()) await collect(join(profiles, entry.name));
    }
    for (const document of documents) {
      const parsed = parseDocument(await readFile(document, 'utf8'), {
        customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
      });
      if (parsed.errors.length) throw new Error('Cannot verify animation references: ' + document);
      if (references(parsed.toJS({ maxAliasCount: 100 }))) return;
    }
    try {
      const directory = await this.directory(false);
      // Unlink never follows the final symlink; directories remain refused.
      await unlink(join(directory, path.slice(ANIMATION_FILES_DIRECTORY.length + 1)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
