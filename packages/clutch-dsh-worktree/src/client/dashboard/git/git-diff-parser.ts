export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export type DiffLine =
  | {
      readonly type: 'context';
      readonly oldLine: number;
      readonly newLine: number;
      readonly text: string;
    }
  | {
      readonly type: 'add';
      readonly newLine: number;
      readonly text: string;
    }
  | {
      readonly type: 'delete';
      readonly oldLine: number;
      readonly text: string;
    };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

/** Parse only the small unified-diff subset needed by the V1 plain-text renderer. */
export function parseUnifiedDiff(patch: string): readonly DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current:
    | {
        readonly oldStart: number;
        readonly oldLines: number;
        readonly newStart: number;
        readonly newLines: number;
        readonly lines: DiffLine[];
      }
    | undefined;
  let oldLine = 0;
  let newLine = 0;

  const flush = (): void => {
    if (current === undefined) return;
    hunks.push({
      oldStart: current.oldStart,
      oldLines: current.oldLines,
      newStart: current.newStart,
      newLines: current.newLines,
      lines: current.lines,
    });
    current = undefined;
  };

  for (const rawLine of patch.split(/\r?\n/u)) {
    const header = HUNK_HEADER.exec(rawLine);
    if (header !== null) {
      flush();
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      current = {
        oldStart: oldLine,
        oldLines: Number(header[2] ?? '1'),
        newStart: newLine,
        newLines: Number(header[4] ?? '1'),
        lines: [],
      };
      continue;
    }
    if (current === undefined || rawLine === '\\ No newline at end of file') continue;
    const marker = rawLine[0];
    const text = rawLine.slice(1);
    if (marker === ' ') {
      current.lines.push({ type: 'context', oldLine, newLine, text });
      oldLine += 1;
      newLine += 1;
    } else if (marker === '+') {
      current.lines.push({ type: 'add', newLine, text });
      newLine += 1;
    } else if (marker === '-') {
      current.lines.push({ type: 'delete', oldLine, text });
      oldLine += 1;
    }
  }
  flush();
  return hunks;
}
