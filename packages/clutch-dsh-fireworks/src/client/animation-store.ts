import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import {
  ANIMATION_NAMESPACE,
  DEFAULT_ANIMATION_PREFERENCES,
  parseAnimationPreferences,
  type AnimationPreferences,
} from '../animation.js';

interface SettingsSnapshot {
  readonly preferences: AnimationPreferences;
  readonly revision?: number;
  readonly loaded: boolean;
  readonly writable: boolean;
  readonly error?: string;
}

/** Host-persisted preferences shared by configuration and global playback. */
export class AnimationStore {
  private snapshot: SettingsSnapshot = {
    preferences: DEFAULT_ANIMATION_PREFERENCES,
    loaded: false,
    writable: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly requests = new Set<AbortController>();
  private loading?: Promise<void>;
  private disposed = false;
  constructor(private readonly rpc: ConnectionHandle['rpc']) {}
  readonly getSnapshot = () => this.snapshot;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: SettingsSnapshot) {
    if (this.disposed) return;
    this.snapshot = value;
    for (const listener of this.listeners) listener();
  }
  private async call(endpoint: string, args: unknown) {
    if (this.disposed) throw new Error('Animation settings disposed');
    const abort = new AbortController();
    this.requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 5000);
    try {
      const result = await this.rpc.call('/api', 'settings/' + endpoint, { args }, abort.signal);
      if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
      return result.value;
    } finally {
      clearTimeout(timeout);
      this.requests.delete(abort);
    }
  }
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.read().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
  private async read() {
    try {
      const value = (await this.call('describe', {})) as {
        writable: boolean;
        namespaces: { ns: string; revision: number; value: { animation?: unknown } }[];
      };
      const descriptor = value.namespaces.find((entry) => entry.ns === ANIMATION_NAMESPACE);
      if (!descriptor)
        throw new Error(
          '动画设置不可用，请重启 DSH 加载新版插件 / Restart DSH to load animation settings',
        );
      this.publish({
        preferences: parseAnimationPreferences(descriptor.value.animation),
        revision: descriptor.revision,
        writable: value.writable,
        loaded: true,
      });
    } catch (error) {
      this.publish({ ...this.snapshot, loaded: true, error: String(error) });
    }
  }
  async save(preferences: AnimationPreferences, revision: number | undefined): Promise<void> {
    const value = parseAnimationPreferences(preferences);
    if (revision === undefined || !this.snapshot.writable)
      throw new Error('当前配置不可写 / Settings are read-only');
    try {
      const descriptor = (await this.call('mutate', {
        ns: ANIMATION_NAMESPACE,
        ops: [{ op: 'set', path: ['animation'], value }],
        expectedRevision: revision,
      })) as { revision: number; value: { animation: unknown } };
      this.publish({
        preferences: parseAnimationPreferences(descriptor.value.animation),
        revision: descriptor.revision,
        writable: true,
        loaded: true,
      });
    } catch (error) {
      // Keep the editor's draft and revision: a conflict must never silently overwrite another page.
      throw new Error(String(error), { cause: error });
    }
  }
  dispose() {
    this.disposed = true;
    for (const request of this.requests) request.abort();
    this.listeners.clear();
  }
}
