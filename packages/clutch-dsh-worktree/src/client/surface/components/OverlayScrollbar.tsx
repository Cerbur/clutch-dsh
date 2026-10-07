import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import styles from '../../worktree.css';

/** A themed thumb over the native scrollport: the list keeps its full width. */
export function OverlayScrollbar({
  scrollportRef,
}: {
  readonly scrollportRef: RefObject<HTMLDivElement>;
}) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; y: number; scrollTop: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [geometry, setGeometry] = useState({ height: 0, top: 0, range: 0, travel: 0 });

  useLayoutEffect(() => {
    const scrollport = scrollportRef.current;
    const content = scrollport?.firstElementChild;
    if (scrollport === null || content == null) return;
    const measure = () => {
      const viewport = scrollport.clientHeight;
      const range = Math.max(0, scrollport.scrollHeight - viewport);
      const height =
        scrollport.scrollHeight === 0
          ? 0
          : Math.min(viewport, Math.max(24, (viewport * viewport) / scrollport.scrollHeight));
      const travel = viewport - height;
      setGeometry({
        height,
        range,
        travel,
        top: range === 0 ? 0 : Math.min(travel, Math.max(0, (scrollport.scrollTop / range) * travel)),
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scrollport);
    observer.observe(content);
    scrollport.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      scrollport.removeEventListener('scroll', measure);
    };
  }, [scrollportRef]);

  const releaseDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      className={styles.overlayScrollbar}
      hidden={geometry.range === 0}
      aria-hidden="true"
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        const scrollport = scrollportRef.current;
        if (event.button !== 0 || scrollport === null || geometry.travel <= 0) return;
        event.preventDefault();
        if (event.target !== thumbRef.current) {
          const top =
            event.clientY - event.currentTarget.getBoundingClientRect().top - geometry.height / 2;
          scrollport.scrollTop =
            (Math.max(0, Math.min(geometry.travel, top)) / geometry.travel) * geometry.range;
        }
        dragRef.current = {
          pointerId: event.pointerId,
          y: event.clientY,
          scrollTop: scrollport.scrollTop,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        const scrollport = scrollportRef.current;
        if (
          drag === null ||
          drag.pointerId !== event.pointerId ||
          scrollport === null ||
          geometry.travel <= 0
        )
          return;
        scrollport.scrollTop =
          drag.scrollTop + ((event.clientY - drag.y) / geometry.travel) * geometry.range;
      }}
      onPointerUp={releaseDrag}
      onPointerCancel={releaseDrag}
      onLostPointerCapture={() => {
        dragRef.current = null;
        setDragging(false);
      }}
      onWheel={(event) => {
        const scrollport = scrollportRef.current;
        if (scrollport !== null) {
          const unit =
            event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? scrollport.clientHeight : 1;
          scrollport.scrollTop += event.deltaY * unit;
        }
      }}
    >
      <div
        ref={thumbRef}
        className={styles.scrollbarThumb}
        style={{ height: geometry.height, transform: `translateY(${geometry.top}px)` }}
      />
    </div>
  );
}
