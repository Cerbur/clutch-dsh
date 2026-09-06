import { decodeTemplates, templateMutation } from '../templates.js';
import type { TemplateAction, TemplateOp, TemplateState } from '../templates.js';

export interface SettingsSnapshot {
  writable: boolean;
  revision: number;
  raw: unknown;
}
export interface TemplateOperations {
  read(): Promise<SettingsSnapshot>;
  write(ops: TemplateOp[], revision: number): Promise<void>;
}
export interface PageState {
  status: 'idle' | 'ready' | 'error';
  busy: boolean;
  writable: boolean;
  revision: number;
  templates: TemplateState;
  error?: string;
}

export class TemplateStore {
  private state: PageState = {
    status: 'idle',
    busy: false,
    writable: false,
    revision: 0,
    templates: decodeTemplates(),
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  constructor(private operations: TemplateOperations) {}
  getSnapshot = (): PageState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<PageState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    try {
      const snapshot = await this.operations.read();
      if (generation !== this.generation) return;
      this.update({
        status: 'ready',
        writable: snapshot.writable,
        revision: snapshot.revision,
        templates: decodeTemplates(snapshot.raw),
        error: undefined,
      });
    } catch (error) {
      if (generation === this.generation)
        this.update({
          status: 'error',
          writable: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }
  async write(action: TemplateAction, revision: number): Promise<void> {
    if (!this.state.writable || this.state.busy) throw new Error('Settings are read-only or busy.');
    const ops = templateMutation(this.state.templates, action);
    this.update({ busy: true });
    try {
      await this.operations.write(ops, revision);
      await this.load();
    } finally {
      this.update({ busy: false });
    }
  }
}
