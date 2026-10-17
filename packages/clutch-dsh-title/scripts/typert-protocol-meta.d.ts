/**
 * Build-only Typert metadata bridge for this out-of-tree Host analysis.
 * Runtime code imports the published protocol package. The analyzer recognizes
 * protocol meta symbols through this ambient module, matching DSH remote-model fixtures.
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  export abstract class TypertRemoteService {
    readonly typertRemote: {
      readonly service: TypertRemoteService;
      readonly serviceKey: string;
      readonly namespace: string;
    };

    protected constructor(
      ctx: unknown,
      serviceKey: string,
      options?: { readonly namespace?: string },
    );
  }

  export function Remote<This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ): void;

  export function Remote(
    exportName: string,
  ): <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void;

  export interface TypertLookup<Host = unknown, Wire = unknown> {
    readonly host: Host;
    readonly wire: Wire;
  }
}
