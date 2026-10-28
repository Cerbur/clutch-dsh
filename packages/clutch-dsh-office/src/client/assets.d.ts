declare module '*.glb?inline' {
  const asset: import('./scene/asset-bytes.js').AssetBytes;
  export default asset;
}

declare module '*.png?inline' {
  const asset: import('./scene/asset-bytes.js').AssetBytes;
  export default asset;
}
declare module '*.bin?inline' {
  const asset: import('./scene/asset-bytes.js').AssetBytes;
  export default asset;
}
declare module '*.json?inline' {
  const base64: string;
  export default base64;
}
