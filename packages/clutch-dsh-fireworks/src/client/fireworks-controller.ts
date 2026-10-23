import {
  FIREWORKS_DURATION_MS,
  FIREWORKS_EVENT_LIMIT,
  FIREWORKS_TOAST_DURATION_MS,
  FIREWORKS_EVENT_TIMEOUT_MS,
  parseFireworksEventBatch,
  type FireworksLaunchEvent,
  type FireworksResumeCursor,
  type FireworksSignal,
} from '../contract/index.js';
import type { AnimationTemplate } from '../animation.js';

export interface FireworksSnapshot {
  readonly preview?: { readonly id: string };
  readonly animation?: AnimationTemplate;
  readonly burst?: FireworksSignal & { readonly sessionId?: string };
  readonly toast?: FireworksLaunchEvent;
}

export type AnimationPreviewStatus = 'ready' | 'done' | 'error' | 'cancelled';
type PreviewListener = (status: AnimationPreviewStatus, message?: string) => void;

interface ActiveCelebration {
  readonly event: FireworksLaunchEvent;
  animation: 'starting' | 'playing' | 'fallback' | 'done';
  toastDone: boolean;
}

export type FireworksStream = (
  query: FireworksResumeCursor,
  signal: AbortSignal,
) => AsyncIterable<unknown>;

/** Own transport and playback outside the selected Session and React render lifecycle. */
export class FireworksController {
  private snapshot: FireworksSnapshot = {};
  private readonly listeners = new Set<() => void>();
  private readonly seen = new Map<string, number>();
  private pending: FireworksLaunchEvent[] = [];
  private burstTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private eventTimer?: ReturnType<typeof setTimeout>;
  private active?: ActiveCelebration;
  private preparation?: AbortController;
  private preparationTimer?: ReturnType<typeof setTimeout>;
  private connection?: AbortController;
  private previewSequence = 0;
  private previewListener?: PreviewListener;

  constructor(
    private readonly request: FireworksStream,
    private readonly now: () => number = Date.now,
    private readonly animation?: (
      signal: AbortSignal,
    ) => AnimationTemplate | Promise<AnimationTemplate>,
  ) {}

  readonly getSnapshot = (): FireworksSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: FireworksSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  accept(events: readonly FireworksLaunchEvent[]): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= this.now()) this.seen.delete(key);
    }
    for (const event of events) {
      const key = JSON.stringify([event.sessionId, event.id]);
      if (event.expiresAt <= this.now() || this.seen.has(key)) continue;
      this.seen.set(key, event.expiresAt);
      this.pending.push(event);
    }
    this.pending = this.pending.slice(-FIREWORKS_EVENT_LIMIT);
    while (this.seen.size > FIREWORKS_EVENT_LIMIT) {
      this.seen.delete(this.seen.keys().next().value!);
    }
    if (!this.active && this.pending.length > 0) this.next();
  }

  private next(): void {
    if (this.active || this.preparation) return;
    let event: FireworksLaunchEvent | undefined;
    do {
      event = this.pending.shift();
    } while (event !== undefined && event.expiresAt <= this.now());
    if (event === undefined) {
      this.publish({});
      return;
    }
    // Reserve the event while Host settings and file bytes are refreshed. Delivery
    // stays independent, and previews cannot take this event's playback slot.
    const preparation = new AbortController();
    this.preparation = preparation;
    this.cancelPreview('任务庆祝已开始，请稍后重新预览。');
    this.publish({});
    if (this.preparation !== preparation) return;
    const deadline = Math.min(this.now() + 5000, event.expiresAt);
    this.preparationTimer = setTimeout(() => {
      if (this.preparation !== preparation) return;
      this.preparation = undefined;
      preparation.abort();
      this.next();
    }, deadline - this.now());
    const start = (animation?: AnimationTemplate) =>
      this.startEvent(event, preparation, deadline, animation);
    try {
      const animation = this.animation?.(preparation.signal);
      if (animation && 'then' in animation) {
        void animation.then(start, () => start());
      } else {
        start(animation);
      }
    } catch {
      // AnimationStore handles settings read failures with default classic/Whale Show.
      // An unexpected resolver throw leaves no template; the renderer uses trusted Emoji.
      start();
    }
  }

  private startEvent(
    event: FireworksLaunchEvent,
    preparation: AbortController,
    deadline: number,
    animation?: AnimationTemplate,
  ): void {
    if (this.preparation !== preparation || preparation.signal.aborted) return;
    clearTimeout(this.preparationTimer);
    this.preparation = undefined;
    if (deadline <= this.now()) {
      preparation.abort();
      this.next();
      return;
    }
    // Only now capture the template and start both rendering branches and their
    // fixed playback deadline. Later settings changes cannot alter this event.
    const active: ActiveCelebration = { event, animation: 'starting', toastDone: false };
    this.active = active;
    this.eventTimer = setTimeout(() => this.finishEvent(active), FIREWORKS_EVENT_TIMEOUT_MS);
    this.play(event, animation, undefined, event);
    this.toastTimer = setTimeout(() => this.dismissToast(event), FIREWORKS_TOAST_DURATION_MS);
  }

  private finishAnimation(burst: NonNullable<FireworksSnapshot['burst']>): void {
    const active = this.active;
    if (!active || this.snapshot.burst !== burst) return;
    clearTimeout(this.burstTimer);
    active.animation = 'done';
    this.publish({ ...this.snapshot, burst: undefined, animation: undefined });
    this.finishIfComplete(active);
  }

  private finishIfComplete(active: ActiveCelebration): void {
    if (active.animation === 'done' && active.toastDone) this.finishEvent(active);
  }

  private finishEvent(active: ActiveCelebration): void {
    if (this.active !== active) return;
    clearTimeout(this.burstTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.eventTimer);
    this.active = undefined;
    // Completion and the fixed deadline both consume the event once; never retry.
    this.next();
  }

  /** All launches enter one burst channel and mount the same rendering surface. */
  private play(
    burst: NonNullable<FireworksSnapshot['burst']>,
    animation?: AnimationTemplate,
    preview?: FireworksSnapshot['preview'],
    toast = this.snapshot.toast,
  ): void {
    clearTimeout(this.burstTimer);
    this.publish({ burst, animation, preview, toast });
    this.burstTimer = setTimeout(
      () =>
        preview
          ? this.reportPreview(preview.id, 'error', '动画预览超时，请重试。')
          : this.finishAnimation(burst),
      (animation?.durationMs ?? FIREWORKS_DURATION_MS) + (animation ? 3000 : 0),
    );
  }

  readonly reportPlayback = (
    burst: NonNullable<FireworksSnapshot['burst']>,
    status: 'ready' | 'done' | 'error',
    message?: string,
  ): void => {
    if (this.snapshot.burst !== burst) return;
    if (this.snapshot.preview) {
      this.reportPreview(this.snapshot.preview.id, status, message);
    } else if (status === 'ready' && this.active?.animation === 'starting') {
      this.active.animation = 'playing';
      // Allow a completion acknowledgement after the first painted frame.
      clearTimeout(this.burstTimer);
      this.burstTimer = setTimeout(
        () => this.finishAnimation(burst),
        (this.snapshot.animation?.durationMs ?? FIREWORKS_DURATION_MS) + 1000,
      );
    } else if (status === 'done') {
      this.finishAnimation(burst);
    } else if (status === 'error' && this.active && this.active.animation !== 'fallback') {
      // The existing trusted fallback is the terminal error presentation, not a retry.
      this.active.animation = 'fallback';
      clearTimeout(this.burstTimer);
      this.burstTimer = setTimeout(() => this.finishAnimation(burst), FIREWORKS_DURATION_MS);
    }
  };

  readonly dismissToast = (toast = this.snapshot.toast): void => {
    if (!toast || this.snapshot.toast !== toast) return;
    clearTimeout(this.toastTimer);
    this.publish({ ...this.snapshot, toast: undefined });
    const active = this.active;
    if (active?.event === toast) {
      active.toastDone = true;
      this.finishIfComplete(active);
    }
  };

  /** Preview drafts through the same root renderer, without a tool event or toast. */
  readonly previewAnimation = (
    animation: AnimationTemplate,
    listener: PreviewListener,
  ): (() => void) => {
    if (this.active || this.preparation) {
      listener('cancelled', '正在播放任务庆祝，请稍后预览。');
      return () => {};
    }
    this.cancelPreview('已开始新的预览。');
    const id = 'clutch_fireworks/preview-' + ++this.previewSequence;
    this.previewListener = listener;
    this.play({ id, message: '动画预览' }, animation, { id });
    return () => this.reportPreview(id, 'cancelled');
  };

  readonly reportPreview = (id: string, status: AnimationPreviewStatus, message?: string): void => {
    if (this.snapshot.preview?.id !== id) return;
    const listener = this.previewListener;
    if (status !== 'ready') {
      clearTimeout(this.burstTimer);
      this.previewListener = undefined;
      this.publish({
        ...this.snapshot,
        burst: undefined,
        animation: undefined,
        preview: undefined,
      });
    }
    listener?.(status, message);
  };

  private cancelPreview(message?: string): void {
    const preview = this.snapshot.preview;
    if (preview) this.reportPreview(preview.id, 'cancelled', message);
  }

  start(): () => void {
    this.stop();
    const connection = new AbortController();
    this.connection = connection;
    void this.listen(connection.signal);
    return () => {
      if (this.connection === connection) this.stop();
    };
  }

  private async listen(signal: AbortSignal): Promise<void> {
    let epoch: string | undefined;
    let cursor: number | undefined;
    while (!signal.aborted) {
      try {
        const query = epoch === undefined ? {} : { epoch, after: cursor };
        for await (const value of this.request(query, signal)) {
          if (signal.aborted) return;
          const batch = parseFireworksEventBatch(value);
          // Fresh/restarted Host baselines stay silent. Reconnects resume the cursor.
          if (epoch === batch.epoch && cursor !== undefined && batch.cursor >= cursor)
            this.accept(batch.events);
          epoch = batch.epoch;
          cursor = batch.cursor;
        }
      } catch {
        // Playback owns its own lifetime; losing transport never stops an active event.
      }
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 1_000);
          signal.addEventListener('abort', finish, { once: true });
        });
      }
    }
  }

  stop(): void {
    this.cancelPreview();
    this.connection?.abort();
    this.connection = undefined;
    const preparation = this.preparation;
    this.preparation = undefined;
    clearTimeout(this.preparationTimer);
    preparation?.abort();
    clearTimeout(this.burstTimer);
    clearTimeout(this.toastTimer);
    clearTimeout(this.eventTimer);
    this.active = undefined;
    this.pending = [];
    this.seen.clear();
    this.publish({});
  }
}
