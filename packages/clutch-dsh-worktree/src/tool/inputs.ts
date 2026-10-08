import { z } from 'zod';
export const text = z.string().trim().min(1);
export const prompt = z
  .string()
  .refine((value) => value.trim().length > 0, 'prompt must not be empty');
export const model = z
  .object({ provider: text, model: text, reasoningEffort: text.optional() })
  .strict();
export const workspace = z.object({ workspaceId: text.optional() }).strict();
