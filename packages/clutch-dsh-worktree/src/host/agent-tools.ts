import type { Context } from '@deepseek-ai/cordis';
import type { WorktreeToolSettingsView } from '../contract/tool-settings.js';
import type { Options } from '../tool/types.js';
import type { ForgeSessionGate } from './native-session.js';

/** The dependency scope can stop while ESM evaluation is still pending. */
export function mountAgentTools(ctx: Context, forge: ForgeSessionGate, options: Omit<Options, 'sessions'>,
  publish: (status: Pick<WorktreeToolSettingsView, 'runtime' | 'loadError'>) => void,
): void {
  ctx.inject(['commands', 'tools', 'sessionController', 'sessionQuery', 'agents', 'llm', 'systemPrompt'], (owner) => {
    let active = true;
    owner.effect(() => () => {
      active = false;
      publish({ runtime: 'waiting' });
    });
    publish({ runtime: 'loading' });
    const registration = owner.plugin((scope) => {
      let stopped = false;
      scope.effect(() => () => { stopped = true; });
      const isDisposed = () => stopped || !active || options.isDisposed() || scope.fiber.uid === null;
      const fail = (stage: string, error: unknown) => {
        if (isDisposed()) return;
        stopped = true;
        const detail = error instanceof Error ? error.message : String(error);
        const loadError = stage + ': ' + detail.slice(0, 700);
        publish({ runtime: 'failed', loadError });
        scope.logger.warn('Worktree Agent tools: ' + loadError);
        void registration.dispose();
      };
      let stage = 'import';
      const start = async () => {
        const tools = await import('../tool/index.js');
        if (isDisposed()) return;
        stage = 'registration';
        await tools.registerWorktreeTools(scope, {
          ...options, sessions: tools.createWorktreeToolSessionPort(scope, forge), isDisposed,
          onCommandError: (error) => fail('/cluworktree', error),
        });
        if (!isDisposed()) publish({ runtime: 'ready' });
      };
      void start().catch((error: unknown) => fail(stage, error));
    });
  });
}
