import { useLayoutEffect, useState } from 'react';
import type { WorkspaceSeat } from './sidebar-workspace-slot.js';

/** Measure only the plugin-owned seat for popover readiness, never for placement. */
export function useWorkspaceRegionGeometry(seat: WorkspaceSeat | undefined) {
  const [measured, setMeasured] = useState<{ element: HTMLElement; height: number }>();
  useLayoutEffect(() => {
    if (!seat) return;
    const element = seat.element;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const rect = element.getBoundingClientRect();
      const height = element.isConnected && Number.isFinite(rect.height) && rect.width > 0
        ? Math.max(0, rect.height) : 0;
      setMeasured((previous) => previous?.element === element && previous.height === height
        ? previous : { element, height });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => { disposed = true; observer?.disconnect(); };
  }, [seat]);
  const collapsed = seat?.wide !== true;
  const height = measured?.element === seat?.element ? measured?.height ?? 0 : 0;
  return { collapsed, bounds: { ready: !collapsed && height > 0, top: 0, height } };
}
