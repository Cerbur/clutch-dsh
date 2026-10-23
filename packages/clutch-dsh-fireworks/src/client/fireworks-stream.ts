import type {
  TypertClientRemote,
  TypertDisposer,
  RemoteStreamHandle,
  RemoteResult,
} from '@deepseek-ai/dsh-typert-protocol';
import { FIREWORKS_REMOTE } from '../remote-contract.js';
import type { AnimationSaveRequest, AnimationSettingsValue } from '../animation.js';
import {
  parseFireworksEventBatch,
  type FireworksResumeCursor,
  type FireworksEventBatch,
} from '../contract/index.js';

export interface FireworksRemote extends Pick<TypertClientRemote, '$mount'> {
  readonly clutch_fireworks: {
    loadAnimations(signal: AbortSignal): Promise<RemoteResult<AnimationSettingsValue>>;
    saveAnimations(
      request: AnimationSaveRequest,
      signal: AbortSignal,
    ): Promise<RemoteResult<AnimationSettingsValue>>;
    events(
      query: FireworksResumeCursor,
      signal: AbortSignal,
    ): RemoteStreamHandle<FireworksEventBatch, never>;
  };
}

/** Mount once per plugin fiber, rather than on each reconnect. */
export function mountFireworksRemote(remote: FireworksRemote): Promise<TypertDisposer> {
  return remote.$mount(FIREWORKS_REMOTE);
}

/** Only a logical Remote stream: no fetch, socket, heartbeat or idle watchdog here. */
export async function* openFireworksStream(
  remote: FireworksRemote,
  query: FireworksResumeCursor,
  signal: AbortSignal,
): AsyncGenerator<FireworksEventBatch> {
  signal.throwIfAborted();
  const handle = remote.clutch_fireworks.events(query, signal);
  try {
    for await (const batch of handle) yield parseFireworksEventBatch(batch);
  } finally {
    handle.dispose();
  }
}
