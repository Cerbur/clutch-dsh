import { Mesh, Texture, type Object3D, type Source } from 'three';

export interface TextureBudgetOptions {
  maxSize?: number;
  disposed?: () => boolean;
}

export interface TextureBudgetStats {
  /** Unique decoded bitmaps, not texture or material references. */
  images: number;
  resized: number;
  failed: number;
  pixelsBefore: number;
  pixelsAfter: number;
}

function isBitmap(image: unknown): image is ImageBitmap {
  if (!image || typeof image !== 'object') return false;
  const bitmap = image as Partial<ImageBitmap>;
  return (
    typeof bitmap.close === 'function' &&
    typeof bitmap.width === 'number' &&
    typeof bitmap.height === 'number' &&
    Number.isFinite(bitmap.width) &&
    Number.isFinite(bitmap.height) &&
    bitmap.width > 0 &&
    bitmap.height > 0
  );
}

/**
 * Run once on a privately parsed GLB, before Models.ownObject/GPU upload.
 * Sources/images shared outside this parsed object must not be passed here.
 * Always hand the object to Models afterwards, including after late disposal.
 */
export async function limitObjectTextures(
  root: Object3D,
  { maxSize = 1024, disposed = () => false }: TextureBudgetOptions = {},
): Promise<TextureBudgetStats> {
  if (!Number.isInteger(maxSize) || maxSize < 1)
    throw new RangeError('Texture maxSize must be a positive integer');

  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      for (const value of Object.values(material))
        if (value instanceof Texture) textures.add(value);
  });
  const sources = new Set([...textures].map((texture) => texture.source));
  const images = new Map<ImageBitmap, Source[]>();
  for (const source of sources) {
    if (!isBitmap(source.data)) continue;
    const users = images.get(source.data) ?? [];
    users.push(source);
    images.set(source.data, users);
  }
  const pixelsBefore = [...images.keys()].reduce(
    (pixels, image) => pixels + image.width * image.height,
    0,
  );
  const stats = {
    images: images.size,
    resized: 0,
    failed: 0,
    pixelsBefore,
    pixelsAfter: pixelsBefore,
  };

  for (const [image, users] of images) {
    if (disposed()) break;
    const scale = maxSize / Math.max(image.width, image.height);
    if (scale >= 1 || typeof createImageBitmap !== 'function') continue;
    let resized: ImageBitmap;
    try {
      resized = await createImageBitmap(image, {
        resizeWidth: Math.max(1, Math.round(image.width * scale)),
        resizeHeight: Math.max(1, Math.round(image.height * scale)),
        resizeQuality: 'high',
        imageOrientation: 'none',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
    } catch {
      stats.failed++;
      continue;
    }
    if (disposed()) {
      resized.close();
      break;
    }
    // Replace every Source referencing this bitmap before closing it. Different
    // texture instances (including GLTF clones) may share a Source or only data.
    let replaced = false;
    for (const source of users) {
      if (source.data !== image) continue;
      source.data = resized;
      replaced = true;
    }
    if (!replaced) {
      resized.close();
      continue;
    }
    for (const texture of textures) if (texture.source.data === resized) texture.needsUpdate = true;
    if (![...sources].some((source) => source.data === image)) image.close();
    stats.resized++;
  }

  const remaining = new Set([...sources].map((source) => source.data as unknown).filter(isBitmap));
  stats.pixelsAfter = [...remaining].reduce(
    (pixels, image) => pixels + image.width * image.height,
    0,
  );
  return stats;
}
