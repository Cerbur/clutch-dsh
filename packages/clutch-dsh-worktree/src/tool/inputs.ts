import { z } from 'zod';
export const text = z.string().trim().min(1);
export const prompt = z
  .string()
  .refine((value) => value.trim().length > 0, 'prompt must not be empty')
  .describe(
    'Required nonempty task/message text, preserved exactly. For delegation include goal, scope, acceptance criteria and checks.',
  );
export const model = z
  .object({
    provider: text.describe(
      'Exact provider group id returned by clutch_list_models, not its display name.',
    ),
    model: text.describe('Exact model id within that provider, returned by clutch_list_models.'),
    reasoningEffort: text
      .optional()
      .describe('Exact supported reasoning effort id for that model; omit to use its default.'),
  })
  .strict()
  .describe(
    'Optional model override as an object {provider, model, reasoningEffort?}, never a string. Omit to inherit the calling Session model and effort.',
  );
export const workspace = z
  .object({
    workspaceId: text
      .optional()
      .describe(
        'Omit to use the calling Session Workspace. If supplied it must be that same Workspace id, not a directory path.',
      ),
  })
  .strict();
