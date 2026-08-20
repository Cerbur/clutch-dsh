export interface RectLike {
  readonly top: number;
  readonly bottom: number;
}

export interface OverlayBounds {
  readonly ready: boolean;
  readonly top: number;
  readonly height: number;
}

export function computeOverlayBounds(
  frame: RectLike,
  newSession: RectLike | undefined,
  footer: RectLike | undefined,
): OverlayBounds {
  if (newSession === undefined || footer === undefined) {
    return { ready: false, top: 0, height: 0 };
  }
  const top = Math.max(0, newSession.top - frame.top);
  const footerTop = Math.max(top, footer.top - frame.top);
  return { ready: true, top, height: footerTop - top };
}
