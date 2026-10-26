import { z } from 'zod';

export const optionalInputGuidance =
  'Omit optional fields for defaults. At execution, JSON null also means omission; empty strings and the string "null" do not. Empty instructions are allowed.';

const supported = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'description',
  'title',
  'default',
  'examples',
]);

function node(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Worktree tool parameters must use object schema nodes');
  return value as Record<string, unknown>;
}

/** anyOf and oneOf are equivalent only when the alternatives cannot overlap. */
function disjointObjects(alternatives: unknown[]): boolean {
  return (
    alternatives.length >= 2 &&
    alternatives.every((value, index) => {
      const left = node(value);
      if (left.type !== 'object' || left.additionalProperties !== false) return false;
      const leftProperties = node(left.properties);
      return alternatives.slice(index + 1).every((other) => {
        const right = node(other);
        if (right.type !== 'object' || right.additionalProperties !== false) return false;
        const rightProperties = node(right.properties);
        return (
          Array.isArray(left.required) &&
          Array.isArray(right.required) &&
          left.required.some(
            (key) => typeof key === 'string' && !Object.hasOwn(rightProperties, key),
          ) &&
          right.required.some(
            (key) => typeof key === 'string' && !Object.hasOwn(leftProperties, key),
          )
        );
      });
    })
  );
}

function project(value: unknown): Record<string, unknown> {
  const source = node(value);
  const result: Record<string, unknown> = {};
  const limits: string[] = [];
  for (const [key, field] of Object.entries(source)) {
    if (key === '$schema') continue;
    if (key === 'minLength' || key === 'maxLength') {
      if (source.type !== 'string' || !Number.isInteger(field) || (field as number) < 0)
        throw new Error(`Unsupported Worktree tool string constraint: ${key}`);
      limits.push(
        key === 'minLength' && field === 1
          ? 'Nonempty.'
          : `${key === 'minLength' ? 'Minimum' : 'Maximum'} length: ${field} UTF-16 units.`,
      );
      continue;
    }
    if (key === 'anyOf') {
      if (!Array.isArray(field) || !disjointObjects(field))
        throw new Error('Worktree tool anyOf requires disjoint closed object alternatives');
      result.oneOf = field.map(project);
      continue;
    }
    if (!supported.has(key)) throw new Error(`Unsupported Worktree tool schema keyword: ${key}`);
    if (key === 'additionalProperties' && typeof field !== 'boolean')
      throw new Error('Worktree tool additionalProperties must be a boolean');
    if (key === 'type' && typeof field !== 'string')
      throw new Error('Worktree tool schema type must be a single type string');
    if (key === 'properties') {
      result.properties = Object.fromEntries(
        Object.entries(node(field)).map(([name, child]) => [name, project(child)]),
      );
    } else if (key === 'oneOf') {
      if (!Array.isArray(field)) throw new Error('Worktree tool oneOf must be an array');
      result.oneOf = field.map(project);
    } else if (key === 'items') {
      result.items = project(field);
    } else {
      result[key] = field;
    }
  }
  if (limits.length) result.description = [source.description, ...limits].filter(Boolean).join(' ');
  return result;
}

/** Provider strict adapters represent omitted optional keys as null.
 * Only declared optional properties normalize to omission. Required values and
 * wrong container types survive for Zod. Closed-object unknown keys reject here,
 * including __proto__, which Zod's object parser otherwise silently ignores.
 * This is transport normalization/closure, not provider schema conversion.
 */
export function normalizeOptionalNulls(
  value: unknown,
  parameters: Record<string, unknown>,
  path: (string | number)[] = [],
): unknown {
  if (parameters.type === 'array' && Array.isArray(value) && parameters.items)
    return value.map((item, index) => normalizeOptionalNulls(item, node(parameters.items), [...path, index]));
  if (parameters.type !== 'object' || value === null || typeof value !== 'object' || Array.isArray(value))
    return value;
  const properties = node(parameters.properties ?? {});
  const unknown = Object.keys(value).filter((key) => !Object.hasOwn(properties, key));
  if (parameters.additionalProperties === false && unknown.length)
    throw new z.ZodError([{ code: 'unrecognized_keys', keys: unknown, path, message: `Unknown fields: ${unknown.join(', ')}` }]);
  const required = new Set(Array.isArray(parameters.required) ? parameters.required : []);
  return Object.fromEntries(Object.entries(value).flatMap(([key, field]) => {
    if (!Object.hasOwn(properties, key)) return [[key, field]];
    if (field === null && !required.has(key)) return [];
    return [[key, normalizeOptionalNulls(field, node(properties[key]), [...path, key])]];
  }));
}

/** DSH's native/PTC catalog uses a smaller schema vocabulary than Zod emits.
 * Length constraints remain enforced by the original Zod parser at execution.
 * Unsupported future constructs fail registration instead of hiding fields as unknown.
 */
export function toolParameters(schema: z.ZodType): Record<string, unknown> {
  const parameters = project(z.toJSONSchema(schema, { io: 'input' }));
  parameters.description = [parameters.description, optionalInputGuidance].filter(Boolean).join(' ');
  return parameters;
}
