import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const name = 'clutch-dsh-office';
export const inject = ['connection'];
export const OFFICE_ASSET_PATH = '/api/clutch-dsh-office/assets';

interface AssetRecord {
  assetId: string;
  sha256: string;
  bytes: number;
  path: string;
  mime: string;
}

/** Build output is the only file allowlist; requests never select filesystem paths. */
export function createOfficeAssetHandler(index: unknown, packageRoot: URL) {
  const table = new Map<string, AssetRecord>();
  const parsed = index as { schemaVersion?: number; assets?: AssetRecord[] };
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.assets))
    throw new Error('Office: invalid asset index');
  for (const asset of parsed.assets) {
    if (
      !asset ||
      typeof asset.assetId !== 'string' ||
      !/^(models|lighting)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(glb|png|bin)$/.test(
        asset.assetId,
      ) ||
      asset.path !== 'assets/' + asset.assetId ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0 ||
      table.has(asset.assetId) ||
      asset.mime !==
        (asset.path.endsWith('.glb')
          ? 'model/gltf-binary'
          : asset.path.endsWith('.png')
            ? 'image/png'
            : 'application/octet-stream')
    )
      throw new Error('Office: invalid asset index entry');
    table.set(asset.assetId, asset);
  }
  return async (request: Request): Promise<Response> => {
    const base = {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const reject = (status: number) => new Response(null, { status, headers: base });
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response(null, {
        status: 405,
        headers: { ...base, Allow: 'GET, HEAD' },
      });
    const url = new URL(request.url);
    if (url.pathname !== OFFICE_ASSET_PATH) return reject(404);
    if (
      [...url.searchParams.keys()].some((key) => key !== 'assetId' && key !== 'sha256') ||
      url.searchParams.getAll('assetId').length !== 1 ||
      url.searchParams.getAll('sha256').length !== 1
    )
      return reject(400);
    const asset = table.get(url.searchParams.get('assetId')!);
    if (!asset || url.searchParams.get('sha256') !== asset.sha256) return reject(404);
    let bytes: Awaited<ReturnType<typeof readFile>>;
    try {
      bytes = await readFile(new URL(asset.path, packageRoot), {
        signal: request.signal,
      });
    } catch (error) {
      return reject((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 503);
    }
    if (
      bytes.length !== asset.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== asset.sha256
    )
      return reject(503);
    const headers = {
      'Content-Type': asset.mime,
      'Content-Length': String(asset.bytes),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      ETag: '"' + asset.sha256 + '"',
    };
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers });
  };
}

/** Connection authenticates owner requests before dispatching this exact binary route. */
export async function apply(ctx: Context): Promise<void> {
  const packageRoot = new URL('../', import.meta.url);
  const index: unknown = JSON.parse(
    await readFile(new URL('asset-index.json', import.meta.url), 'utf8'),
  );
  const fetch = createOfficeAssetHandler(index, packageRoot);
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: OFFICE_ASSET_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch,
      }),
    'office:assets',
  );
}

export { projectOffices } from './office/project.js';
export { planAction, advancePosition } from './office/actions.js';
export type * from './office/types.js';
