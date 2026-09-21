/** Normalize Windows extended drive and UNC paths to VS Code's file URI input form. */
function normalizeWindowsPath(absolutePath: string): string {
  if (
    absolutePath.length >= 4 &&
    absolutePath.charCodeAt(0) === 92 &&
    absolutePath.charCodeAt(1) === 92 &&
    absolutePath[2] === '?' &&
    absolutePath.charCodeAt(3) === 92
  ) {
    const extendedPath = absolutePath.slice(4);
    if (extendedPath.slice(0, 4).toLowerCase() === 'unc\\') {
      return '\\\\' + extendedPath.slice(4);
    }
    if (/^[a-z]:[\\/]/i.test(extendedPath)) return extendedPath;
  }
  return absolutePath;
}

/** Encode path segments while retaining Windows drive and directory separators. */
export function vscodeFolderUrl(absolutePath: string): string {
  const normalizedPath = normalizeWindowsPath(absolutePath);
  const windowsPath = /^[a-z]:[\\/]/i.test(normalizedPath) || normalizedPath.startsWith('\\\\');
  const path = windowsPath ? normalizedPath.replaceAll('\\', '/') : normalizedPath;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const withDrive = windowsPath ? encoded.replace(/^([a-z])%3A/i, '$1:') : encoded;
  return 'vscode://file' + (withDrive.startsWith('/') ? '' : '/') + withDrive;
}
