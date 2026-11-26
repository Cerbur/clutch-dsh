import type { Context } from '@deepseek-ai/cordis';
import { createRequire } from 'node:module';
import { features } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { WorktreeToolRuntime } from '../contract/tool-settings.js';
import type { Options } from '../tool/types.js';
import type { ForgeSessionGate } from './native-session.js';

/** The dependency scope can stop while ESM evaluation is still pending. */
export function mountAgentTools(ctx: Context, forge: ForgeSessionGate, options: Omit<Options, 'sessions'>,
  publish: (status: WorktreeToolRuntime) => void,
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
        // The supported Node host can load synchronous ESM during activation. Install
        // declarations before DSH snapshots the first turn, even on a cold import.
        const url = import.meta.resolve('../tool/index.js');
        let tools: typeof import('../tool/index.js');
        if (features.require_module && url.startsWith('file:')) {
          try {
            tools = createRequire(import.meta.url)(fileURLToPath(url)) as typeof tools;
          } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== 'ERR_REQUIRE_ASYNC_MODULE') throw error;
            tools = await import(url);
          }
        } else {
          tools = await import(url);
        }
        if (isDisposed()) return;
        stage = 'registration';
        await tools.registerWorktreeTools(scope, {
          ...options, sessions: tools.createWorktreeToolSessionPort(scope, forge), isDisposed,
          onRegistrationError: fail,
        });
        if (!isDisposed()) publish({ runtime: 'ready' });
      };
      void start().catch((error: unknown) => fail(stage, error));
    });
  });
}
