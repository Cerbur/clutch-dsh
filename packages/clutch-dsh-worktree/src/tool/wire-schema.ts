import { z } from 'zod';

/** Explicit provider transport projection; never used by the registry or SDK. */
export function nullableToolParameters(schema: z.ZodType): Record<string, unknown> {
  const convert = (source: Record<string, unknown>): Record<string, unknown> => {
    const result = { ...source };
    delete result.$schema;
    if (source.type === 'object') {
      const properties = source.properties as Record<string, Record<string, unknown>>;
      const required = new Set(source.required as string[] | undefined);
      result.properties = Object.fromEntries(Object.entries(properties).map(([key, child]) => {
        const projected = convert(child);
        return [key, required.has(key) ? projected : { anyOf: [projected, { type: 'null' }] }];
      }));
      result.required = Object.keys(properties);
      result.additionalProperties = false;
    } else if (source.type === 'array') {
      result.items = convert(source.items as Record<string, unknown>);
    }
    return result;
  };
  return convert(z.toJSONSchema(schema, { io: 'input' }));
}
