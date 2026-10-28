import manifest from '../../../assets/lighting/kitchen/manifest.json?inline';
import uv from '../../../assets/lighting/kitchen/uv.bin?inline';
import diffuse from '../../../assets/lighting/kitchen/diffuse.png?inline';
import { configureKitchenBake, assertCurrentKitchenSources } from './baked-lighting.js';
import { loadAssetBytes } from './asset-bytes.js';

// One immutable byte bundle; each visible room owns its own decoded GPU atlas.
configureKitchenBake(async () => {
  const parsed = assertCurrentKitchenSources(manifest);
  const [uvBytes, diffuseBytes] = await Promise.all([loadAssetBytes(uv), loadAssetBytes(diffuse)]);
  return { manifest: parsed, uv: uvBytes, diffuse: diffuseBytes };
});
