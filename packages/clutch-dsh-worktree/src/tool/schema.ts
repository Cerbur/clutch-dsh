import { z } from 'zod';

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
        `${key === 'minLength' ? 'Minimum' : 'Maximum'} length: ${field} characters (checked by the tool).`,
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

/** DSH's native/PTC catalog uses a smaller schema vocabulary than Zod emits.
 * Length constraints remain enforced by the original Zod parser at execution.
 * Unsupported future constructs fail registration instead of hiding fields as unknown.
 */
export function toolParameters(schema: z.ZodType): Record<string, unknown> {
  return project(z.toJSONSchema(schema, { io: 'input' }));
}
