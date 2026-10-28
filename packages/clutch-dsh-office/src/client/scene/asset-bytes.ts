export interface AssetDescriptor {
  assetId: string;
  sha256: string;
  bytes: number;
}
export type AssetBytes = string | AssetDescriptor;

/** Cache immutable CPU bytes only; room owners retain all decoded/GPU resources. */
export function createAssetByteLoader(
  fetchBytes: typeof globalThis.fetch = (...args) => globalThis.fetch(...args),
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {},
) {
  const cache = new Map<
    string,
    {
      promise: Promise<ArrayBuffer>;
      abort: AbortController;
      users: number;
      done: boolean;
    }
  >();
  let active = 0;
  const waiting: (() => void)[] = [];
  const turn = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  async function fetchAsset(asset: AssetDescriptor, signal: AbortSignal): Promise<ArrayBuffer> {
    if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    const timeout = new AbortController();
    const combined = AbortSignal.any([signal, timeout.signal]);
    const timer = setTimeout(
      () => timeout.abort(new DOMException('Office asset timed out', 'TimeoutError')),
      timeoutMs,
    );
    let removeAbort = () => {};
    try {
      combined.throwIfAborted();
      const canceled = new Promise<never>((_resolve, reject) => {
        const abort = () => reject(combined.reason);
        combined.addEventListener('abort', abort, { once: true });
        removeAbort = () => combined.removeEventListener('abort', abort);
      });
      return await Promise.race([
        canceled,
        (async () => {
          const query = new URLSearchParams({
            assetId: asset.assetId,
            sha256: asset.sha256,
          });
          // App-owned URLs are document-relative; same-origin cookies carry DSH browser authentication.
          const target = 'api/clutch-dsh-office/assets?' + query;
          const response = await fetchBytes(target, {
            signal: combined,
            credentials: 'same-origin',
          });
          if (!response.ok)
            throw new Error('Office asset HTTP ' + response.status + ': ' + asset.assetId);
          const declared = response.headers.get('content-length');
          if (
            !response.headers.has('content-encoding') &&
            declared !== null &&
            Number(declared) !== asset.bytes
          )
            throw new Error('Office asset length mismatch');
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength !== asset.bytes) throw new Error('Office asset length mismatch');
          combined.throwIfAborted();
          const hash = await crypto.subtle.digest('SHA-256', buffer);
          const hex = Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join(
            '',
          );
          if (hex !== asset.sha256) throw new Error('Office asset checksum mismatch');
          combined.throwIfAborted();
          return buffer;
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      removeAbort();
      turn();
    }
  }
  return async function load(asset: AssetBytes, signal?: AbortSignal): Promise<ArrayBuffer> {
    signal?.throwIfAborted();
    if (typeof asset === 'string') {
      const decoded = atob(asset),
        bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
      return bytes.buffer;
    }
    if (
      !/^(models|lighting)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(glb|png|bin)$/.test(
        asset.assetId,
      ) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes <= 0
    )
      throw new Error('Office: invalid asset descriptor');
    const key = asset.assetId + '/' + asset.sha256 + '/' + asset.bytes;
    let entry = cache.get(key);
    if (!entry) {
      const abort = new AbortController();
      entry = {
        promise: Promise.resolve(new ArrayBuffer(0)),
        abort,
        users: 0,
        done: false,
      };
      const current = entry;
      current.promise = fetchAsset(asset, abort.signal)
        .then((bytes) => {
          current.done = true;
          return bytes;
        })
        .catch((error: unknown) => {
          if (cache.get(key) === current) cache.delete(key);
          throw error;
        });
      cache.set(key, current);
    }
    const current = entry;
    current.users++;
    return new Promise<ArrayBuffer>((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, bytes?: ArrayBuffer) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        current.users--;
        if (!current.users && !current.done) {
          if (cache.get(key) === current) cache.delete(key);
          current.abort.abort();
        }
        if (bytes) resolve(bytes);
        else reject(error);
      };
      const cancel = () => finish(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', cancel, { once: true });
      current.promise.then(
        (bytes) => finish(undefined, bytes),
        (error: unknown) => finish(error),
      );
      if (signal?.aborted) cancel();
    });
  };
}

export const loadAssetBytes = createAssetByteLoader();

let parsing = 0;
const parsers: (() => void)[] = [];
/** Limit full GLB load/parse pipelines as well as binary fetches. */
export async function withAssetSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (parsing >= 2) await new Promise<void>((resolve) => parsers.push(resolve));
  else parsing++;
  try {
    signal.throwIfAborted();
    return await work();
  } finally {
    const next = parsers.shift();
    if (next) next();
    else parsing--;
  }
}
