import type { CallingAgent } from './types.js';
import { createHash } from 'node:crypto';

export interface ReportToken {
  readonly parentSessionId: string;
  active: boolean;
  attempt?: { requestId: string; message: string; pending: boolean };
}
interface Route {
  agent: CallingAgent;
  parentSessionId?: string;
  ancestors?: ReadonlySet<string>;
  token?: ReportToken;
  dispatchBlocked: boolean;
  humanInput: boolean;
}
interface Delivery {
  from: string;
  to: string;
  kind: 'task' | 'message';
  signature: string;
  token?: ReportToken;
}
function reject(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

/** Runtime authority follows admitted input identities, never model-written report text. */
export class DelegationControl {
  private readonly routes = new Map<string, Route>();
  private readonly deliveries = new Map<string, Delivery>();
  private readonly disposed = new WeakSet<CallingAgent>();

  assertAlive(agent: CallingAgent): void {
    if (this.disposed.has(agent)) reject('AGENT_DISPOSED', 'The calling Agent has been disposed.');
  }

  register(agent: CallingAgent): void {
    this.assertAlive(agent);
    const existing = this.routes.get(agent.session.id);
    if (existing?.agent === agent) return;
    if (existing && existing.agent !== agent) this.dispose(existing.agent);
    this.routes.set(agent.session.id, {
      agent, dispatchBlocked: false, humanInput: false,
    });
  }

  dispose(agent: CallingAgent): void {
    this.disposed.add(agent);
    this.release(agent);
  }

  /** Scope rollback releases state without retiring a still-live native Agent. */
  release(agent: CallingAgent): void {
    const id = agent.session.id;
    const route = this.routes.get(id);
    if (route?.agent !== agent) return;
    if (route.token) this.close(route.token);
    for (const child of this.routes.values()) {
      if (child.token?.parentSessionId === id) this.close(child.token);
    }
    this.routes.delete(id);
    for (const [requestId, delivery] of this.deliveries) {
      if (delivery.from === id || delivery.to === id) this.deliveries.delete(requestId);
    }
  }

  clear(): void {
    for (const route of this.routes.values()) {
      this.disposed.add(route.agent);
      if (route.token) this.close(route.token);
    }
    this.routes.clear();
    this.deliveries.clear();
  }

  token(agent: CallingAgent): ReportToken | undefined {
    const route = this.routes.get(agent.session.id);
    return route?.agent === agent ? route.token : undefined;
  }

  child(parent: CallingAgent, sessionId: string): CallingAgent | undefined {
    const route = this.routes.get(sessionId);
    return route?.parentSessionId === parent.session.id ? route.agent : undefined;
  }

  assertDispatch(agent: CallingAgent, target?: string): void {
    this.assertAlive(agent);
    if (this.routes.get(agent.session.id)?.dispatchBlocked)
      reject('DELEGATION_CALLBACK_BLOCKED', 'A report or ordinary plugin message cannot trigger another dispatch. Wait for new human input.');
    if (target === agent.session.id || (target !== undefined && this.routes.get(agent.session.id)?.ancestors?.has(target)))
      reject('DELEGATION_CYCLE', 'Do not message yourself or an ancestor Session; use the active one-shot result report.');
  }

  prepareTask(parent: CallingAgent, child: CallingAgent, requestId: string, prompt: string, mode: string): void {
    this.assertDispatch(parent, child.session.id);
    this.assertAlive(child);
    const route = this.routes.get(child.session.id)!;
    if (route.parentSessionId !== undefined && route.parentSessionId !== parent.session.id)
      reject('DELEGATION_CYCLE', 'An existing delegated Session cannot be assigned another parent.');
    const signature = this.signature(prompt, mode);
    const previous = this.deliveries.get(requestId);
    if (previous) {
      this.assertIdentity(previous, parent.session.id, child.session.id, signature, 'task');
      return;
    }
    if (route.token?.attempt)
      reject('REPORT_RETRY_REQUIRED', 'Resolve uncertain result admission using its original requestId before dispatching more work.');
    const token = route.token ?? {
      parentSessionId: parent.session.id, active: false,
    };
    const ancestors = new Set([parent.session.id, ...(this.routes.get(parent.session.id)?.ancestors ?? [])]);
    if (ancestors.size > 64) reject('DELEGATION_CAPACITY', 'Delegation ancestry exceeds the runtime depth limit.');
    this.remember(requestId, { from: parent.session.id, to: child.session.id, kind: 'task', signature, token });
    route.parentSessionId = parent.session.id;
    route.ancestors = ancestors;
    route.token = token;
  }

  trackMessage(agent: CallingAgent, target: string, requestId: string, prompt: string, mode: string): void {
    this.assertDispatch(agent, target);
    const signature = this.signature(prompt, mode);
    const previous = this.deliveries.get(requestId);
    if (previous) this.assertIdentity(previous, agent.session.id, target, signature, 'message');
    else this.remember(requestId, { from: agent.session.id, to: target, kind: 'message', signature });
  }

  assertRetry(requestId: string): void {
    if (!this.deliveries.has(requestId))
      reject('DELEGATION_RETRY_EXPIRED', 'The original dispatch retry is no longer retained. Do not reuse an unknown requestId or automatically redispatch.');
  }

  private signature(prompt: string, mode: string): string {
    return createHash('sha256').update(JSON.stringify([prompt, mode])).digest('hex');
  }

  private remember(requestId: string, delivery: Delivery): void {
    // Pending task inputs cannot be evicted: losing their provenance would
    // revoke valid authority. Reject overflow when all retained slots are live.
    if (this.deliveries.size >= 512) {
      const evictable = [...this.deliveries].find(([, value]) => !value.token);
      if (!evictable) reject('DELEGATION_CAPACITY', 'Too many pending dispatch inputs. Wait for existing tasks to finish.');
      this.deliveries.delete(evictable[0]);
    }
    this.deliveries.set(requestId, delivery);
  }

  private assertIdentity(delivery: Delivery, from: string, to: string, signature: string, kind: Delivery['kind']): void {
    if (delivery.from !== from || delivery.to !== to || delivery.signature !== signature || delivery.kind !== kind)
      reject('DELEGATION_RETRY_MISMATCH', 'A requestId can retry only the identical message to the original destination.');
  }

  assertReport(agent: CallingAgent, token = this.token(agent)): ReportToken {
    this.assertAlive(agent);
    if (!token || this.token(agent) !== token)
      reject('REPORT_TASK_CLOSED', 'This delegated task has ended. Later user work must not report to the former parent.');
    if (!token.active)
      reject('REPORT_TASK_NOT_STARTED', 'The delegated prompt must be consumed before reporting its result.');
    return token;
  }

  claimReport(agent: CallingAgent, token: ReportToken, requestId: string, message: string): void {
    this.assertReport(agent, token);
    const attempt = token.attempt;
    if (attempt && (attempt.requestId !== requestId || attempt.message !== message))
      reject('REPORT_RETRY_REQUIRED', 'Retry only the identical report using the original requestId.');
    if (attempt?.pending) reject('REPORT_IN_PROGRESS', 'This task already has a report admission in flight.');
    token.attempt = { requestId, message, pending: true };
  }

  close(token: ReportToken): void {
    token.active = false;
    token.attempt = undefined;
    for (const route of this.routes.values()) if (route.token === token) route.token = undefined;
    // Keep only bounded hashes for dispatch retry safety; never retain spent
    // tokens or report payloads through the provenance/retry registry.
    for (const delivery of this.deliveries.values()) if (delivery.token === token) delivery.token = undefined;
  }

  /** Only newly appended user-role inputs affect authority; replay/compaction does not. */
  event(sessionId: string, event: { type: string; data: unknown; surfaceOp?: string }): void {
    const route = this.routes.get(sessionId);
    if (!route) return;
    if (event.type === 'turn/start') {
      route.humanInput = false;
      return;
    }
    if (event.type !== 'user/message' || (event.surfaceOp !== undefined && event.surfaceOp !== 'append')) return;
    const source = (event.data as { source?: { kind?: string; rpcId?: string } } | null)?.source;
    if (source?.kind !== 'user') return;
    const delivery = source.rpcId === undefined ? undefined : this.deliveries.get(source.rpcId);
    if (delivery?.to === sessionId) {
      if (delivery.kind === 'task' && delivery.token && delivery.token === route.token && !route.humanInput) {
        delivery.token.active = true;
        route.dispatchBlocked = false;
      } else if (!route.humanInput) {
        route.dispatchBlocked = true;
      }
      if (delivery.kind === 'message' && route.token) this.close(route.token);
      return;
    }
    // Native prompt IDs retain this prefix after plugin/Agent restart. Unknown
    // plugin admissions never become a human authorization to start a callback.
    if (source.rpcId?.startsWith('clutch-worktree:') || source.rpcId?.startsWith('clutch-worktree-report:')) {
      if (!route.humanInput) route.dispatchBlocked = true;
      return;
    }
    route.humanInput = true;
    route.dispatchBlocked = false;
    if (route.token) this.close(route.token);
  }
}
