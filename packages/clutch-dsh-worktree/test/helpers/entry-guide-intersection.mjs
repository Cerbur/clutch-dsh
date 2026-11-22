// jsdom has no layout. Drive the same visibility notifications as a native scrollport.
export function installEntryIntersection(win, initialRatio = 1) {
  let ratio = initialRatio;
  const observers = new Set();
  // With no overlay in the fixture, a pointer hits the observed entry button.
  win.document.elementFromPoint = () => [...observers][0]?.target ?? null;
  win.IntersectionObserver = class {
    constructor(notify) { this.notify = notify; }
    observe(target) {
      this.target = target;
      observers.add(this);
      this.notify([{ target, intersectionRatio: ratio }]);
    }
    disconnect() { observers.delete(this); }
  };
  return (nextRatio) => {
    ratio = nextRatio;
    for (const observer of observers) observer.notify([{ target: observer.target, intersectionRatio: ratio }]);
  };
}
