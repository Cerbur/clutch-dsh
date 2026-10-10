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
  if (
    newSession === undefined ||
    footer === undefined ||
    ![frame.top, frame.bottom, newSession.top, newSession.bottom, footer.top, footer.bottom].every(
      Number.isFinite,
    ) ||
    frame.bottom <= frame.top ||
    newSession.bottom <= newSession.top ||
    footer.bottom <= footer.top
  ) {
    return { ready: false, top: 0, height: 0 };
  }
  const top = Math.max(0, Math.min(frame.bottom, newSession.top) - frame.top);
  const footerTop = Math.max(top, Math.min(frame.bottom, footer.top) - frame.top);
  return { ready: true, top, height: footerTop - top };
}
