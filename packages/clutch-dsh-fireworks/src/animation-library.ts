import {
  ANIMATION_NAMESPACE,
  parseAnimationPreferences,
  parseAnimation,
  type AnimationMetadata,
  parseStoredAnimationPreferences,
  type AnimationSaveRequest,
  type AnimationSettingsValue,
  type StoredAnimationPreferences,
} from './animation.js';
import { AnimationFiles } from './animation-files.js';

/** Narrow port: only the plugin's volatile animation field is ever written. */
export interface AnimationSettingsPort {
  readonly writable: boolean;
  describe(): readonly { ns: string; revision: number; value: unknown }[];
  mutate(
    ns: string,
    ops: readonly { op: 'set'; path: string[]; value: unknown }[],
    expectedRevision: number,
  ): Promise<void>;
}

export class AnimationLibrary {
  private updating: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly files: AnimationFiles,
    private readonly settings: AnimationSettingsPort,
  ) {}
  private descriptor() {
    const descriptor = this.settings.describe().find(({ ns }) => ns === ANIMATION_NAMESPACE);
    if (!descriptor)
      throw new Error('动画设置不可用，请重启 DSH / Restart DSH to load animation settings');
    return descriptor;
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.updating.then(operation);
    this.updating = result.catch(() => {});
    return result;
  }
  load(signal: AbortSignal): Promise<AnimationSettingsValue> {
    return this.enqueue(() => this.read(signal));
  }
  private async read(signal: AbortSignal, retries = 1): Promise<AnimationSettingsValue> {
    signal.throwIfAborted();
    const descriptor = this.descriptor();
    const stored = parseStoredAnimationPreferences(
      (descriptor.value as { animation?: unknown }).animation,
    );
    const base = { revision: descriptor.revision, writable: this.settings.writable };
    if (!('version' in stored)) return { ...base, preferences: stored };
    const scripts: Record<string, string> = {};
    const unavailable: Record<string, AnimationMetadata> = {};
    const metadata: Record<string, AnimationMetadata> = {};
    for (const [id, path] of Object.entries(stored.files)) {
      try {
        scripts[id] = await this.files.read(path, id, signal);
        const template = parseAnimation(scripts[id], id);
        metadata[id] = { name: template.name, durationMs: template.durationMs };
      } catch {
        signal.throwIfAborted();
        metadata[id] = stored.metadata?.[id] ?? { name: '自定义动画 · ' + id.slice(7, 15) };
        unavailable[id] = metadata[id];
      }
    }
    const active = Object.hasOwn(unavailable, stored.active) ? 'emoji' : stored.active;
    const value: AnimationSettingsValue = {
      ...base,
      preferences: { active, scripts, ...(Object.keys(unavailable).length ? { unavailable } : {}) },
    };
    const metadataChanged = Object.entries(metadata).some(
      ([id, item]) =>
        stored.metadata?.[id]?.name !== item.name ||
        stored.metadata?.[id]?.durationMs !== item.durationMs,
    );
    // Preserve the list, repair only the selected id, and cache small display metadata
    // for pre-manifest configurations while the bytes are still readable.
    if (active !== stored.active || metadataChanged) {
      if (!this.settings.writable)
        return active === stored.active
          ? value
          : {
              ...value,
              error:
                '动画文件损坏，已临时使用 Emoji；只读设置无法保存默认动画 / Settings are read-only',
            };
      try {
        signal.throwIfAborted();
        await this.settings.mutate(
          ANIMATION_NAMESPACE,
          [{ op: 'set', path: ['animation'], value: { ...stored, active, metadata } }],
          descriptor.revision,
        );
        return { ...value, revision: this.descriptor().revision };
      } catch (error) {
        signal.throwIfAborted();
        if (retries && String(error).includes('CONFLICT')) return this.read(signal, retries - 1);
        return {
          ...value,
          error: '无法保存动画恢复设置 / Animation recovery failed: ' + String(error),
        };
      }
    }
    return value;
  }
  save(request: AnimationSaveRequest, signal: AbortSignal): Promise<AnimationSettingsValue> {
    return this.enqueue(() => this.update(request, signal));
  }
  private async update(
    request: AnimationSaveRequest,
    signal: AbortSignal,
  ): Promise<AnimationSettingsValue> {
    signal.throwIfAborted();
    const preferences = parseAnimationPreferences(request.preferences);
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)
      throw new Error('Invalid settings revision');
    if (!this.settings.writable) throw new Error('Settings are read-only');
    const descriptor = this.descriptor();
    if (descriptor.revision !== request.expectedRevision)
      throw new Error('SETTINGS_CONFLICT: Settings changed; reload before saving');
    const previous = parseStoredAnimationPreferences(
      (descriptor.value as { animation?: unknown }).animation,
    );
    const files: Record<string, string> = {};
    const metadata: Record<string, AnimationMetadata> = {};
    const previousSources: Record<string, string> = {};
    // A stale browser must not silently restore a physically deleted file using cached JS.
    // Re-import uses a new id; existing unreadable ids are retained only as list entries.
    if ('version' in previous) {
      for (const id of Object.keys(preferences.scripts)) {
        if (!Object.hasOwn(previous.files, id)) continue;
        try {
          previousSources[id] = await this.files.read(previous.files[id], id, signal);
        } catch (error) {
          signal.throwIfAborted();
          throw new Error(
            'ANIMATION_FILE_UNAVAILABLE: 本地文件损坏，请刷新动画列表 / Reload animations',
            { cause: error },
          );
        }
      }
    }
    for (const id of Object.keys(preferences.unavailable ?? {})) {
      if (!('version' in previous) || !Object.hasOwn(previous.files, id))
        throw new Error('Invalid unavailable animation reference');
      files[id] = previous.files[id];
      metadata[id] = previous.metadata?.[id] ?? { name: '自定义动画 · ' + id.slice(7, 15) };
    }
    for (const [id, source] of Object.entries(preferences.scripts)) {
      // Reuse unchanged references directly. Besides avoiding redundant I/O, this
      // cannot recreate bytes deleted between the preflight read and config CAS.
      files[id] =
        'version' in previous && previousSources[id] === source
          ? previous.files[id]
          : await this.files.write(source, id, signal);
      const template = parseAnimation(source, id);
      metadata[id] = { name: template.name, durationMs: template.durationMs };
    }
    signal.throwIfAborted();
    const stored: StoredAnimationPreferences = {
      version: 2,
      active: preferences.active,
      files,
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };
    await this.settings.mutate(
      ANIMATION_NAMESPACE,
      [{ op: 'set', path: ['animation'], value: stored }],
      request.expectedRevision,
    );
    // Config CAS must succeed before removing bytes. Preserve hashes still used
    // by another id, live namespace, or persisted DSH profile.
    const retained = new Set(Object.values(files));
    const failures: string[] = [];
    if ('version' in previous) {
      for (const path of new Set(Object.values(previous.files))) {
        if (retained.has(path)) continue;
        try {
          const live = this.settings.describe().some(({ ns, value }) => {
            if (ns !== ANIMATION_NAMESPACE) return false;
            const animation = (value as { animation?: unknown })?.animation;
            if (!animation) return false;
            const parsed = parseStoredAnimationPreferences(animation);
            return 'version' in parsed && Object.values(parsed.files).includes(path);
          });
          if (!live) await this.files.removeUnreferenced(path);
        } catch (error) {
          failures.push(`${path}: ${String(error)}`);
        }
      }
    }
    const loaded = await this.read(signal);
    return failures.length
      ? {
          ...loaded,
          error: [
            loaded.error,
            `配置已更新，文件清理失败，请检查目录权限 / File cleanup failed:\n${failures.join('\n')}`,
          ]
            .filter(Boolean)
            .join('\n'),
        }
      : loaded;
  }
}
