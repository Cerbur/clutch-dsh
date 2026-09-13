/** Encode path segments while retaining Windows drive and directory separators. */
export function vscodeFolderUrl(absolutePath: string): string {
  const windowsPath = /^[a-z]:[\\/]/i.test(absolutePath) || absolutePath.startsWith('\\\\');
  const path = windowsPath ? absolutePath.replaceAll('\\', '/') : absolutePath;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const withDrive = windowsPath ? encoded.replace(/^([a-z])%3A/i, '$1:') : encoded;
  return `vscode://file${withDrive.startsWith('/') ? '' : '/'}${withDrive}`;
}
