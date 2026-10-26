export type Activity = 'idle' | 'working' | 'searching' | 'editing' | 'waiting' | 'unknown';
export type Pose = 'idle' | 'cook' | 'search' | 'wait';
export type Station = 'rest' | 'stove' | 'fridge';
export type Position = readonly [x: number, z: number];

/** Normalized facts, independent of DSH transport and Three.js. */
export interface SessionFact {
  readonly id: string;
  readonly label: string;
  readonly activity: Activity;
  readonly eligible: boolean;
}

export interface WorkspaceFact {
  readonly id: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
}

export interface Actor {
  readonly id: string;
  readonly label: string;
  readonly activity: Activity;
  readonly seat: 0 | 1;
}

export interface Office {
  readonly id: string;
  readonly title: string;
  readonly actors: readonly Actor[];
  readonly activeCount: number;
  readonly overflow: number;
}

export interface ActionPlan {
  readonly station: Station;
  readonly pose: Pose;
  readonly target: Position;
}
