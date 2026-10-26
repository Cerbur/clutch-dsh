import { z } from 'zod';
export const text = z.string().trim().min(1);
export const prompt = z
  .string()
  .refine((value) => value.trim().length > 0, 'prompt must not be empty')
  .describe('Nonblank message text, delivered verbatim.');
export const model = z
  .object({
    provider: text.describe(
      'Exact provider id from clutch_list_models, not a display name.',
    ),
    model: text.describe('Exact model id within that provider.'),
    reasoningEffort: text
      .optional()
      .describe('Supported effort id; omitted/null uses this model’s default.'),
  })
  .strict()
  .describe(
    'Provider/model override object, never a string; omitted/null inherits the caller’s selection. For inheritance omit the entire object; do not supply empty provider/model fields.',
  );
export const workspace = z
  .object({
    workspaceId: text
      .optional()
      .describe(
        'Calling Workspace id; omitted/null uses it. Other Workspaces and paths are rejected.',
      ),
  })
  .strict();
