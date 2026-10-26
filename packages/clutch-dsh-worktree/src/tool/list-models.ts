import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text } from './inputs.js';
import * as output from './outputs.js';

const listModelsArgs = z
  .object({
    provider: text
      .optional()
      .describe(
        'Exact provider id; omitted/null lists all. Unknown ids fail; unavailable providers retain diagnostics.',
      ),
  })
  .strict();

export function registerListModels(context: ToolContext): void {
  const { add, agent, options, check, scope } = context;
  add(
    'clutch_list_models',
    'Discover models for explicit requirements or task-based selection, not to confirm inheritance. Returns provider groups, reasoning efforts and failures, plus current/default models separately. Read-only; changes no model or defaults.',
    listModelsArgs,
    output.object(
      {
        current: output.model,
        default: output.model,
        groups: output.array(
          output.object(
            { id: output.string, name: output.string, models: output.array(output.catalogModel) },
            ['id', 'name', 'models'],
          ),
        ),
        failures: output.array(
          output.object({ id: output.string, name: output.string, message: output.string }, [
            'id',
            'message',
          ]),
        ),
      },
      ['current', 'default', 'groups', 'failures'],
    ),
    async (args, exec) => {
      await scope();
      const catalog = await options.sessions.modelCatalog();
      const current = await options.sessions.currentModel(agent.session.id, exec.signal);
      check(exec);
      if (
        args.provider &&
        !catalog.groups.some((group) => group.id === args.provider) &&
        !catalog.failures.some((failure) => failure.id === args.provider)
      )
        throw new Error('Unknown model provider');
      return {
        current,
        default: catalog.default,
        groups: catalog.groups.filter(
          (group) => args.provider === undefined || group.id === args.provider,
        ),
        failures: catalog.failures.filter(
          (failure) => args.provider === undefined || failure.id === args.provider,
        ),
      };
    },
  );
}
