import type { FireworksRemote } from './fireworks-stream.js';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import {
  DEFAULT_ANIMATION_PREFERENCES,
  parseAnimationPreferences,
  type AnimationPreferences,
  type AnimationSettingsValue,
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
  constructor(
    private readonly remote: Pick<
      FireworksRemote['clutch_fireworks'],
      'loadAnimations' | 'saveAnimations'
    >,
  ) {}
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
  private async call(
    invoke: (signal: AbortSignal) => Promise<RemoteResult<AnimationSettingsValue>>,
    signal?: AbortSignal,
  ) {
    if (this.disposed) throw new Error('Animation settings disposed');
    signal?.throwIfAborted();
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    this.requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 5000);
    try {
      const result = await invoke(abort.signal);
      abort.signal.throwIfAborted();
      if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
      return result.value;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      this.requests.delete(abort);
    }
  }
  load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.read()
      .then(() => {})
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
  /** A playback needs a new Host/file read, even if a settings-page load is pending. */
  refresh(signal: AbortSignal): Promise<AnimationPreferences> {
    return this.read(signal);
  }
  private async read(signal?: AbortSignal): Promise<AnimationPreferences> {
    try {
      const value = await this.call(
        (requestSignal) => this.remote.loadAnimations(requestSignal),
        signal,
      );
      const preferences = parseAnimationPreferences(value.preferences);
      this.publish({
        ...value,
        preferences,
        loaded: true,
      });
      return preferences;
    } catch (error) {
      signal?.throwIfAborted();
      // Settings read failures use default classic/Whale Show in memory; an
      // unavailable selected template is recovered separately by the Host as Emoji.
      this.publish({
        preferences: DEFAULT_ANIMATION_PREFERENCES,
        writable: false,
        loaded: true,
        error: String(error),
      });
      return DEFAULT_ANIMATION_PREFERENCES;
    }
  }
  async save(preferences: AnimationPreferences, revision: number | undefined): Promise<void> {
    const value = parseAnimationPreferences(preferences);
    if (revision === undefined || !this.snapshot.writable)
      throw new Error('当前配置不可写 / Settings are read-only');
    const baseline =
      this.snapshot.revision === revision && !this.snapshot.error
        ? this.snapshot.preferences
        : undefined;
    try {
      const write = (expectedRevision: number) =>
        this.call((signal) =>
          this.remote.saveAnimations({ preferences: value, expectedRevision }, signal),
        );
      let saved: AnimationSettingsValue;
      try {
        saved = await write(revision);
      } catch (error) {
        if (!baseline || !String(error).includes('SETTINGS_CONFLICT')) throw error;
        const fresh = await this.call((signal) => this.remote.loadAnimations(signal));
        const current = parseAnimationPreferences(fresh.preferences);
        if (
          !fresh.writable ||
          fresh.error ||
          fresh.revision === revision ||
          current.active !== baseline.active ||
          Object.keys(current.scripts).length !== Object.keys(baseline.scripts).length ||
          JSON.stringify(current.unavailable ?? {}) !==
            JSON.stringify(baseline.unavailable ?? {}) ||
          Object.entries(baseline.scripts).some(([id, source]) => current.scripts[id] !== source)
        )
          throw error;
        // Host lifecycle can advance revisions without changing animation bytes.
        // Retry once only after exact content comparison, still using Host CAS.
        saved = await write(fresh.revision);
      }
      this.publish({
        ...saved,
        preferences: parseAnimationPreferences(saved.preferences),
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
