export interface WorktreeCleanupFlowInput {
  readonly clean: () => Promise<void>;
  readonly onCommitted: () => void;
  readonly refresh: () => Promise<void>;
  readonly normalize: () => Promise<void>;
  readonly isCurrent: () => boolean;
  readonly onFollowUpError: (stage: 'refresh' | 'permission', error: unknown) => void;
}

export async function runWorktreeCleanupFlow(input: WorktreeCleanupFlowInput): Promise<void> {
  await input.clean();
  if (!input.isCurrent()) return;
  input.onCommitted();
  const follow = async (stage: 'refresh' | 'permission', operation: () => Promise<void>): Promise<void> => {
    if (!input.isCurrent()) return;
    try {
      await operation();
    } catch (error) {
      if (input.isCurrent()) input.onFollowUpError(stage, error);
    }
  };
  await Promise.all([follow('refresh', input.refresh), follow('permission', input.normalize)]);
}
