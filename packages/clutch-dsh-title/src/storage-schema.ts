import type { DomainGlobalSpec } from '@deepseek-ai/dsh-storage-domain';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';

export interface GlobalStorageSpec<Name extends string, Value> {
  readonly name: Name;
  readonly version: 1;
  readonly global: DomainGlobalSpec<Value>;
  readonly tables: Record<string, never>;
}

/** Bridge the storage host's Zod types at its global-record parsing boundary. */
export function defineGlobalStorageDomain<Name extends string, Value>(
  name: Name,
  schema: {
    parse(value: unknown): Value;
    safeParse(value: unknown): { success: boolean };
  },
  initial: NoInfer<Value>,
): GlobalStorageSpec<Name, Value> {
  // Supported storage hosts use parse() to read records and safeParse(null) to check
  // the unset sentinel. Their declarations also require version-specific Zod internals.
  return defineDomain({
    name,
    version: 1,
    global: { schema: schema as DomainGlobalSpec<Value>['schema'], initial },
    tables: {},
  });
}
