import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';

import {
  FaceModelEmitter,
  WorkspaceAnalyzer,
} from '@deepseek-ai/dsh-typert-generator';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = path.join(packageDirectory, 'lib');
const manifest = JSON.parse(
  await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
);
const packageName = manifest.name;

assertExport('./typert', {
  types: './lib/typert.host.d.ts',
  default: './lib/typert.host.js',
});
assertExport('./remote', {
  types: './lib/typert.remote-client.d.ts',
  default: './lib/typert.remote-client.js',
});

const workspace = new WorkspaceAnalyzer({
  root: workspaceRoot,
  hostConfig: 'packages/clutch-dsh-worktree/tsconfig.host.json',
  faces: ['host'],
  packages: [packageName],
}).analyze();
const face = workspace.faces.find((candidate) => candidate.face === 'host');
if (face === undefined) throw new Error('Typert did not discover the Host face');
const artifact = new FaceModelEmitter(face).emit(packageName);
if (artifact.remote === undefined) {
  throw new Error('Typert did not generate a Remote contribution');
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, 'typert.host.js'), artifact.js),
  writeFile(path.join(outputDirectory, 'typert.host.d.ts'), artifact.dts),
  writeFile(path.join(outputDirectory, 'typert.remote-client.js'), artifact.remote.js),
  writeFile(path.join(outputDirectory, 'typert.remote-client.d.ts'), artifact.remote.dts),
  writeFile(
    path.join(outputDirectory, 'typert.remote-client.d.ts.map'),
    artifact.remote.dtsMap,
  ),
]);

function assertExport(subpath, expected) {
  const actual = manifest.exports?.[subpath];
  if (
    actual?.types !== expected.types ||
    (actual.default ?? actual.import) !== expected.default
  ) {
    throw new Error(
      `${subpath} must publish ${JSON.stringify(expected)} for Typert generation`,
    );
  }
}
