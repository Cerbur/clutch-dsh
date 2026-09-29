/**
 * Typert Host-only projection of the DSH Client Workspace service.
 *
 * The real DSH Workspace UI declaration also imports the API-remotes type
 * assembly. Worktree does not consume that Remote graph; its client uses the
 * existing /api Connection. This projection keeps Typert Host analysis limited
 * to the three Workspace methods used by the plugin.
 *
 * tsconfig.host.json selects this file only for code generation. The regular
 * Client TypeScript check and runtime continue to use the DSH package itself.
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    uiWorkspace: {
      openSession(target: string): void;
      pickDirectory(): Promise<string | null>;
      startSession(workspaceId?: string): void;
    };
  }
}

export {};
