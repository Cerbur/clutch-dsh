import { existsSync } from 'node:fs';
import path from 'node:path';

/** TypeScript preserves relative CSS imports but does not copy their source files. */
export function resolveClientCssPath(packageDirectory, source, importer) {
  const emitted = path.resolve(
    importer === undefined ? packageDirectory : path.dirname(importer),
    source,
  );
  if (existsSync(emitted)) return emitted;
  const relative = path.relative(path.join(packageDirectory, 'lib'), emitted);
  if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    return path.join(packageDirectory, 'src', relative);
  }
  return path.resolve(packageDirectory, 'src/client', source.replace(/^\.\//, ''));
}
