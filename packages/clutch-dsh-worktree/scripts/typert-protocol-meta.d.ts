/**
 * Build-only Typert metadata bridge for an out-of-tree package on DSH rc.7.
 * Runtime code still imports the published protocol package. The rc.7 analyzer
 * recognizes protocol meta symbols through an ambient module, matching its
 * own remote-model fixture.
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
}
