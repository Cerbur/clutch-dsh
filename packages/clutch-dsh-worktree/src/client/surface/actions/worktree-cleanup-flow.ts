export interface WorktreeCleanupFlowInput {
  readonly clean: () => Promise<void>;
  readonly onCommitted: () => void;
  readonly refresh: () => Promise<void>;
  readonly isCurrent: () => boolean;
  readonly onFollowUpError: (stage: 'refresh', error: unknown) => void;
}

export async function runWorktreeCleanupFlow(input: WorktreeCleanupFlowInput): Promise<void> {
  await input.clean();
  if (!input.isCurrent()) return;
  input.onCommitted();
  const follow = async (stage: 'refresh', operation: () => Promise<void>): Promise<void> => {
    if (!input.isCurrent()) return;
    try {
      await operation();
    } catch (error) {
      if (input.isCurrent()) input.onFollowUpError(stage, error);
    }
  };
  await follow('refresh', input.refresh);
}
