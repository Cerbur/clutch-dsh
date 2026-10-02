import { Component, createRef, type ReactNode } from 'react';
import styles from '../../worktree.css';

interface Props {
  readonly children: ReactNode;
  readonly className: string;
  readonly ready: boolean;
  readonly resetKey: string;
}

interface Row {
  readonly element: HTMLElement;
  readonly rect: DOMRect;
  readonly opacity: number;
}
type Positions = Map<string, Row>;

/** Plugin-owned equivalent of native keyed-row fades and movement, without importing DSH internals. */
export class AnimatedTree extends Component<Props> {
  private armed = false;
  private readonly list = createRef<HTMLDivElement>();
  private readonly exits = createRef<HTMLDivElement>();
  private readonly movements = new Map<HTMLElement, Animation>();
  private readonly removed = new Map<string, { element: HTMLElement; animation: Animation }>();

  override getSnapshotBeforeUpdate(previous: Props): Positions | null {
    if (
      !this.armed ||
      !previous.ready ||
      !this.props.ready ||
      previous.resetKey !== this.props.resetKey ||
      !this.list.current ||
      typeof this.list.current.animate !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return null;
    return this.positions();
  }

  override componentDidUpdate(_previous: Props, _state: unknown, snapshot: Positions | null): void {
    if (!snapshot) {
      this.clear();
      return;
    }
    const next = this.positions();
    const keys = [...snapshot.keys()];
    const nextKeys = [...next.keys()];
    // Metadata refreshes must not restart an animation already in flight.
    if (keys.length === next.size && keys.every((key, index) => key === nextKeys[index])) return;
    this.cancelMovements();
    const list = this.list.current!;
    const viewport = (list.closest('[data-worktree-scrollport]') ?? list).getBoundingClientRect();
    const visible = (rect: DOMRect) => rect.bottom > viewport.top && rect.top < viewport.bottom;
    for (const [key, row] of next) {
      this.removeExit(key);
      const old = snapshot.get(key);
      if (!visible(row.rect) && (!old || !visible(old.rect))) continue;
      if (!old) {
        this.move(row.element, [{ opacity: 0 }, { opacity: 1 }], 100);
        continue;
      }
      const dx = old.rect.left - row.rect.left;
      const dy = old.rect.top - row.rect.top;
      if (dx === 0 && dy === 0 && old.opacity === 1) continue;
      this.move(
        row.element,
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: old.opacity },
          { transform: 'translate(0, 0)', opacity: 1 },
        ],
        200,
      );
    }
    const overlay = this.exits.current!;
    const origin = overlay.getBoundingClientRect();
    for (const [key, row] of snapshot) {
      if (next.has(key) || !visible(row.rect)) continue;
      this.removeExit(key);
      const clone = row.element.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-worktree-motion-key');
      clone.removeAttribute('id');
      clone.inert = true;
      Object.assign(clone.style, {
        position: 'absolute',
        margin: '0',
        transform: 'none',
        boxSizing: 'border-box',
        left: `${row.rect.left - origin.left}px`,
        top: `${row.rect.top - origin.top}px`,
        width: `${row.rect.width}px`,
        height: `${row.rect.height}px`,
      });
      overlay.append(clone);
      const animation = clone.animate([{ opacity: row.opacity }, { opacity: 0 }], {
        duration: 100,
        easing: 'ease-out',
        fill: 'forwards',
      });
      this.removed.set(key, { element: clone, animation });
      animation.onfinish = () => this.removeExit(key);
    }
  }

  override componentWillUnmount(): void {
    this.clear();
  }

  private positions(): Positions {
    const rows = this.list.current!.querySelectorAll<HTMLElement>('[data-worktree-motion-key]');
    return new Map(
      Array.from(rows, (element) => {
        const workspace =
          element.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId ?? '';
        return [
          JSON.stringify([workspace, element.dataset.worktreeMotionKey]),
          {
            element,
            rect: element.getBoundingClientRect(),
            opacity: this.movements.has(element) ? Number(getComputedStyle(element).opacity) : 1,
          },
        ];
      }),
    );
  }

  private move(element: HTMLElement, frames: Keyframe[], duration: number): void {
    const animation = element.animate(frames, { duration, easing: 'ease-out' });
    this.movements.set(element, animation);
    animation.onfinish = () => {
      this.movements.delete(element);
      animation.cancel();
    };
  }
  private cancelMovements(): void {
    for (const animation of this.movements.values()) {
      animation.onfinish = null;
      animation.cancel();
    }
    this.movements.clear();
  }
  private removeExit(key: string): void {
    const exit = this.removed.get(key);
    if (!exit) return;
    exit.animation.onfinish = null;
    exit.animation.cancel();
    exit.element.remove();
    this.removed.delete(key);
  }
  private clear(): void {
    this.cancelMovements();
    for (const key of this.removed.keys()) this.removeExit(key);
  }

  override render(): ReactNode {
    return (
      <div
        ref={this.list}
        className={this.props.className}
        onPointerDownCapture={() => {
          this.armed = true;
        }}
        onKeyDownCapture={() => {
          this.armed = true;
        }}
      >
        {this.props.children}
        <div ref={this.exits} className={styles.motionExits} aria-hidden="true" />
      </div>
    );
  }
}
