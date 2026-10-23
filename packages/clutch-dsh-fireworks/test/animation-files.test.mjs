import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnimationFiles } from '../lib/animation-files.js';
import { AnimationLibrary } from '../lib/animation-library.js';
import { parseStoredAnimationPreferences } from '../lib/animation.js';

const { AbortController, structuredClone } = globalThis;

const source =
  '// clutch_fireworks: {"version":1,"name":"File test","durationMs":500}\nfunction render() {}';
const prefs = { active: 'custom-a', scripts: { 'custom-a': source } };
const signal = () => new AbortController().signal;
async function fixture(t, animation = prefs) {
  const home = await mkdtemp(join(tmpdir(), 'fireworks-files-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const files = new AnimationFiles(home);
  let descriptor = {
    ns: 'clutch-dsh-fireworks',
    revision: 3,
    value: { unrelated: 123, animation },
  };
  const settings = {
    writable: true,
    describe: () => [descriptor],
    async mutate(ns, ops, revision) {
      assert.equal(ns, descriptor.ns);
      if (revision !== descriptor.revision) throw new Error('SETTINGS_CONFLICT');
      assert.equal(ops.length, 1);
      assert.deepEqual(ops[0].path, ['animation']);
      descriptor = {
        ...descriptor,
        revision: descriptor.revision + 1,
        value: { ...descriptor.value, animation: ops[0].value },
      };
    },
  };
  return {
    home,
    files,
    settings,
    library: new AnimationLibrary(files, settings),
    descriptor: () => descriptor,
  };
}

test('legacy load never writes; save migrates to relative paths, deduplicates and survives a new Host instance', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.library.load(signal())).preferences, prefs);
  assert.deepEqual(await readdir(f.home), []);
  const saved = await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
  assert.equal(saved.revision, 4);
  const stored = f.descriptor().value.animation;
  assert.equal(stored.version, 2);
  assert.equal(stored.scripts, undefined);
  const path = stored.files['custom-a'];
  assert.match(path, /^clutch-dsh-fireworks\/animations\/[a-f0-9]{64}\.js$/);
  assert.equal(await readFile(join(f.home, path), 'utf8'), source);
  assert.equal((await stat(join(f.home, path))).mode & 0o777, 0o600);
  assert.equal(f.descriptor().value.unrelated, 123);
  const before = (await stat(join(f.home, path))).mtimeMs;
  await f.library.save(
    {
      preferences: { ...prefs, scripts: { ...prefs.scripts, 'custom-b': source } },
      expectedRevision: 4,
    },
    signal(),
  );
  assert.equal((await stat(join(f.home, path))).mtimeMs, before);
  assert.equal((await readdir(join(f.home, 'clutch-dsh-fireworks/animations'))).length, 1);
  const restarted = new AnimationLibrary(new AnimationFiles(f.home), f.settings);
  assert.deepEqual((await restarted.load(signal())).preferences.scripts, {
    'custom-a': source,
    'custom-b': source,
  });
  await restarted.save(
    { preferences: { active: 'emoji', scripts: {} }, expectedRevision: 5 },
    signal(),
  );
  await assert.rejects(readFile(join(f.home, path), 'utf8'), /ENOENT/);
});

test('removing one duplicate keeps its shared hash, removing the last deletes the file', async (t) => {
  const f = await fixture(t);
  const both = { active: 'custom-a', scripts: { 'custom-a': source, 'custom-b': source } };
  await f.library.save({ preferences: both, expectedRevision: 3 }, signal());
  const path = f.descriptor().value.animation.files['custom-a'];
  await f.library.save(
    { preferences: { active: 'custom-b', scripts: { 'custom-b': source } }, expectedRevision: 4 },
    signal(),
  );
  assert.equal(await readFile(join(f.home, path), 'utf8'), source);
  await f.library.save(
    { preferences: { active: 'emoji', scripts: {} }, expectedRevision: 5 },
    signal(),
  );
  await assert.rejects(readFile(join(f.home, path)), /ENOENT/);
});

test('deletion protects another profile reference, including quoted YAML and legacy inline source', async (t) => {
  for (const legacy of [false, true]) {
    const f = await fixture(t);
    await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
    const path = f.descriptor().value.animation.files['custom-a'];
    const profile = join(f.home, 'profiles', 'other');
    await mkdir(profile, { recursive: true });
    const document = join(profile, 'cordis.patch.yml');
    await writeFile(
      document,
      JSON.stringify([
        {
          config: {
            animation: legacy
              ? prefs
              : { version: 2, active: 'custom-a', files: { 'custom-a': path } },
          },
        },
      ]),
    );
    await f.library.save(
      { preferences: { active: 'emoji', scripts: {} }, expectedRevision: 4 },
      signal(),
    );
    assert.equal(await readFile(join(f.home, path), 'utf8'), source);
    await rm(document);
    await f.files.removeUnreferenced(path);
    await assert.rejects(readFile(join(f.home, path)), /ENOENT/);
  }
});

test('a failed settings mutation never deletes removed files; cleanup failures are visible after a successful update', async (t) => {
  const f = await fixture(t);
  await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
  const path = f.descriptor().value.animation.files['custom-a'];
  const mutate = f.settings.mutate;
  f.settings.mutate = async () => {
    throw new Error('SETTINGS_CONFLICT');
  };
  await assert.rejects(
    f.library.save(
      { preferences: { active: 'emoji', scripts: {} }, expectedRevision: 4 },
      signal(),
    ),
    /CONFLICT/,
  );
  assert.equal(await readFile(join(f.home, path), 'utf8'), source);
  f.settings.mutate = mutate;
  f.files.removeUnreferenced = async () => {
    throw new Error('permission denied');
  };
  const updated = await f.library.save(
    { preferences: { active: 'emoji', scripts: {} }, expectedRevision: 4 },
    signal(),
  );
  assert.equal(updated.preferences.active, 'emoji');
  assert.match(updated.error, /File cleanup failed/);
});

test('readonly, stale revisions, invalid scripts and pre-cancelled saves leave disk untouched', async (t) => {
  const f = await fixture(t);
  const save = (preferences = prefs, revision = 3, s = signal()) =>
    f.library.save({ preferences, expectedRevision: revision }, s);
  f.settings.writable = false;
  await assert.rejects(save(), /read-only/);
  f.settings.writable = true;
  await assert.rejects(save(prefs, 2), /CONFLICT/);
  await assert.rejects(save({ active: 'custom-a', scripts: { 'custom-a': 'invalid' } }), /header/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(save(prefs, 3, abort.signal));
  assert.deepEqual(await readdir(f.home), []);
});

test('a concurrent conflict after file creation cannot alter old references or source bytes', async (t) => {
  const f = await fixture(t);
  await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
  const original = structuredClone(f.descriptor());
  f.settings.mutate = async () => {
    throw new Error('SETTINGS_CONFLICT');
  };
  await assert.rejects(
    f.library.save(
      {
        preferences: { ...prefs, scripts: { 'custom-a': source + '\n// changed' } },
        expectedRevision: 4,
      },
      signal(),
    ),
    /CONFLICT/,
  );
  assert.deepEqual(f.descriptor(), original);
  assert.equal(
    await readFile(join(f.home, original.value.animation.files['custom-a']), 'utf8'),
    source,
  );
  assert.deepEqual((await f.library.load(signal())).preferences, prefs);
});

test('missing/corrupt active files persist Emoji, retain metadata and support delete-only cleanup after restart', async (t) => {
  for (const kind of ['missing', 'corrupt']) {
    const f = await fixture(t);
    await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
    const path = f.descriptor().value.animation.files['custom-a'];
    if (kind === 'missing') await rm(join(f.home, path));
    else await writeFile(join(f.home, path), source + 'tampered');
    const loaded = await f.library.load(signal());
    assert.equal(loaded.preferences.active, 'emoji');
    assert.deepEqual(loaded.preferences.scripts, {});
    assert.deepEqual(loaded.preferences.unavailable, {
      'custom-a': { name: 'File test', durationMs: 500 },
    });
    assert.equal(f.descriptor().value.animation.active, 'emoji', 'fallback must be persisted');
    assert.equal(
      f.descriptor().value.animation.files['custom-a'],
      path,
      'retain broken list entry',
    );
    assert.equal(loaded.revision, 5);
    const restarted = new AnimationLibrary(new AnimationFiles(f.home), f.settings);
    assert.deepEqual((await restarted.load(signal())).preferences, loaded.preferences);
    await restarted.save(
      {
        preferences: { active: 'rings', scripts: {}, unavailable: loaded.preferences.unavailable },
        expectedRevision: 5,
      },
      signal(),
    );
    assert.equal(
      f.descriptor().value.animation.files['custom-a'],
      path,
      'switching must retain broken entry',
    );
    const deleted = await restarted.save(
      { preferences: { active: 'rings', scripts: {} }, expectedRevision: 6 },
      signal(),
    );
    assert.equal(deleted.preferences.active, 'rings');
    assert.deepEqual(f.descriptor().value.animation.files, {});
    await assert.rejects(readFile(join(f.home, path)), /ENOENT/);
  }
});

test('stale cached scripts cannot recreate a deleted file; importing a new id remains possible', async (t) => {
  const f = await fixture(t);
  await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
  const path = f.descriptor().value.animation.files['custom-a'];
  await rm(join(f.home, path));
  await assert.rejects(
    f.library.save({ preferences: prefs, expectedRevision: 4 }, signal()),
    /ANIMATION_FILE_UNAVAILABLE/,
  );
  await assert.rejects(readFile(join(f.home, path)), /ENOENT/);
  const loaded = await f.library.load(signal());
  const imported = await f.library.save(
    {
      preferences: {
        ...loaded.preferences,
        active: 'custom-new',
        scripts: { 'custom-new': source },
      },
      expectedRevision: loaded.revision,
    },
    signal(),
  );
  assert.equal(imported.preferences.active, 'custom-new');
  assert.equal(imported.preferences.scripts['custom-new'], source);
});

test('a deletion between save preflight and CAS is not resurrected by unchanged cached source', async (t) => {
  const f = await fixture(t);
  await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
  const path = f.descriptor().value.animation.files['custom-a'];
  const read = f.files.read.bind(f.files);
  let deleted = false;
  f.files.read = async (...args) => {
    const result = await read(...args);
    if (!deleted) {
      deleted = true;
      await rm(join(f.home, path));
    }
    return result;
  };
  const saved = await f.library.save({ preferences: prefs, expectedRevision: 4 }, signal());
  assert.equal(saved.preferences.active, 'emoji');
  assert.ok(saved.preferences.unavailable['custom-a']);
  await assert.rejects(readFile(join(f.home, path)), /ENOENT/);
  assert.equal(f.descriptor().value.animation.active, 'emoji');
});

test('old file-only configs acquire display metadata and readonly recovery does not mutate settings', async (t) => {
  const f = await fixture(t);
  const path = await f.files.write(source, 'custom-a', signal());
  await f.settings.mutate(
    'clutch-dsh-fireworks',
    [
      {
        op: 'set',
        path: ['animation'],
        value: { version: 2, active: 'custom-a', files: { 'custom-a': path } },
      },
    ],
    3,
  );
  const loaded = await f.library.load(signal());
  assert.equal(loaded.revision, 5);
  assert.equal(f.descriptor().value.animation.metadata['custom-a'].name, 'File test');
  f.settings.writable = false;
  await rm(join(f.home, path));
  const fallback = await f.library.load(signal());
  assert.equal(fallback.preferences.active, 'emoji');
  assert.match(fallback.error, /read-only/);
  assert.equal(f.descriptor().value.animation.active, 'custom-a');
});

test('stored references reject unsupported versions, traversal, absolute paths and invalid ids', () => {
  const path = 'clutch-dsh-fireworks/animations/' + 'a'.repeat(64) + '.js';
  const stored = { version: 2, active: 'custom-a', files: { 'custom-a': path } };
  assert.deepEqual(parseStoredAnimationPreferences(stored), stored);
  assert.deepEqual(parseStoredAnimationPreferences(prefs), prefs);
  for (const invalid of [
    '/tmp/test.js',
    '../test.js',
    path + '/../../secret',
    'https://x/a.js',
    path.replaceAll('/', '\\'),
  ])
    assert.throws(() =>
      parseStoredAnimationPreferences({ ...stored, files: { 'custom-a': invalid } }),
    );
  assert.throws(() => parseStoredAnimationPreferences({ ...stored, version: 3 }));
  assert.throws(() => parseStoredAnimationPreferences({ ...stored, active: 'missing' }));
  assert.throws(() => parseStoredAnimationPreferences({ ...stored, files: { __bad: path } }));
  assert.throws(() =>
    parseStoredAnimationPreferences({
      ...stored,
      files: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['custom-' + i, path])),
    }),
  );
});

test('recovery retries a CAS conflict without overriding a newer selection', async (t) => {
  const f = await fixture(t);
  await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
  await rm(join(f.home, f.descriptor().value.animation.files['custom-a']));
  const mutate = f.settings.mutate;
  let conflict = true;
  f.settings.mutate = async (ns, ops, revision) => {
    if (conflict) {
      conflict = false;
      await mutate(
        ns,
        [
          {
            op: 'set',
            path: ['animation'],
            value: { ...f.descriptor().value.animation, active: 'rings' },
          },
        ],
        revision,
      );
      throw new Error('SETTINGS_CONFLICT');
    }
    return mutate(ns, ops, revision);
  };
  const loaded = await f.library.load(signal());
  assert.equal(loaded.preferences.active, 'rings');
  assert.equal(f.descriptor().value.animation.active, 'rings');
  assert.equal(loaded.preferences.unavailable['custom-a'].name, 'File test');
});

test('a failed recovery write still falls back in memory and reports why persistence failed', async (t) => {
  const f = await fixture(t);
  await f.library.save({ preferences: prefs, expectedRevision: 3 }, signal());
  await rm(join(f.home, f.descriptor().value.animation.files['custom-a']));
  f.settings.mutate = async () => {
    throw new Error('permission denied');
  };
  const loaded = await f.library.load(signal());
  assert.equal(loaded.preferences.active, 'emoji');
  assert.match(loaded.error, /permission denied/);
  assert.equal(f.descriptor().value.animation.active, 'custom-a');
});

test('file access rejects symlink files/directories, oversize content, and isolates DSH homes', async (t) => {
  const f = await fixture(t);
  const other = await fixture(t);
  const path = await f.files.write(source, 'custom-a', signal());
  await assert.rejects(other.files.read(path, 'custom-a', signal()), /ENOENT/);
  await rm(join(f.home, path));
  const outside = join(f.home, 'outside.js');
  await writeFile(outside, source);
  await symlink(outside, join(f.home, path));
  await assert.rejects(f.files.read(path, 'custom-a', signal()), /ELOOP/);
  await assert.rejects(f.files.write(source, 'custom-a', signal()), /ELOOP/);
  await rm(join(f.home, path));
  await writeFile(join(f.home, path), 'a'.repeat(65_537));
  await assert.rejects(f.files.read(path, 'custom-a', signal()), /size/);
  await mkdir(join(other.home, 'outside'));
  await symlink(join(other.home, 'outside'), join(other.home, 'clutch-dsh-fireworks'));
  await assert.rejects(other.files.write(source, 'custom-a', signal()), /Unsafe/);
});
