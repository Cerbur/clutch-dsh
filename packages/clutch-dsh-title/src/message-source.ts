/**
 * The producer identity for the messages this plugin contributes to a title request.
 *
 * DSH resolves message producers through the merge-extensible `MessageSourceMap`, and every
 * producer declares its own `kind`. DSH 0.1.7's V4 session format refuses the retired shared
 * `{ kind: 'plugin', plugin }` wrapper, and DSH's own v3-to-v4 lift rewrites this plugin's older
 * rows to the namespaced kind below, so historical and new rows keep one producer identity.
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:clutch-dsh-title': { kind: 'plugin:clutch-dsh-title' };
  }
}

/** Source stamped on every message this plugin contributes to a title request. */
export const TITLE_MESSAGE_SOURCE = { kind: 'plugin:clutch-dsh-title' } as const;
