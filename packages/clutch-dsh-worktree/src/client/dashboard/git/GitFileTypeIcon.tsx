import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import type { ReactNode } from 'react';

export interface GitFileTypeIconProps {
  readonly path: string;
  readonly className?: string;
  readonly size?: number;
}

function FallbackFileIcon({ className, size = 16 }: { className?: string; size?: number }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 2h6l4 4v8H3V2z" />
      <path d="M9 2v4h4" />
    </svg>
  );
}

/**
 * Standard DSH file type icon with fallback.
 * Uses FileTypeIcon from @deepseek-ai/dsh-client-ui-primitives when available,
 * and falls back to a clean SVG file glyph in older runtimes.
 */
export function GitFileTypeIcon({ path, className, size = 16 }: GitFileTypeIconProps): ReactNode {
  const FileTypeIcon = (primitives as Record<string, unknown>).FileTypeIcon as
    | ((props: { kind: string; size?: number; className?: string }) => ReactNode)
    | undefined;
  const classifyFileType = (primitives as Record<string, unknown>).classifyFileType as
    | ((targetPath: string) => string)
    | undefined;

  if (typeof FileTypeIcon === 'function' && typeof classifyFileType === 'function') {
    const kind = classifyFileType(path);
    return <FileTypeIcon kind={kind} size={size} className={className} />;
  }

  return <FallbackFileIcon className={className} size={size} />;
}
