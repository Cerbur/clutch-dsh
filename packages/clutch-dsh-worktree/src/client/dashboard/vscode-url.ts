import { stripExtendedWindowsPrefix } from '../../contract/windows-path.js';

/** Encode path segments while retaining Windows drive and directory separators. */
export function vscodeFolderUrl(absolutePath: string): string {
  const normalizedPath = stripExtendedWindowsPrefix(absolutePath);
  const windowsPath = /^[a-z]:[\\/]/i.test(normalizedPath) ||
    normalizedPath.startsWith('\\\\') || normalizedPath.startsWith('//');
  const path = windowsPath ? normalizedPath.replaceAll('\\', '/') : normalizedPath;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const withDrive = windowsPath ? encoded.replace(/^([a-z])%3A/i, '$1:') : encoded;
  return 'vscode://file' + (withDrive.startsWith('/') ? '' : '/') + withDrive;
}
