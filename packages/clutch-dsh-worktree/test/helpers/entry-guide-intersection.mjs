// jsdom has no layout. Drive the same visibility notifications as a native scrollport.
export function installEntryIntersection(win, initialRatio = 1) {
  let ratio = initialRatio;
  const observers = new Set();
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
