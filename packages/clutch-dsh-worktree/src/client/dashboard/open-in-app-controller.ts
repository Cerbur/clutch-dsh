type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const OPEN_IN_APP_APPS_ROUTE = '/open-in-app/apps';
export const OPEN_IN_APP_OPEN_ROUTE = '/open-in-app/open';

export interface OpenInAppAppsPayload {
  readonly apps: readonly string[];
}

export interface OpenInAppOpenPayload {
  readonly app: string;
  readonly path: string;
}

function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal';
}

const STORAGE_KEY = 'dsh.open-in-app.choice';

export class OpenInAppController {
  private _apps: readonly string[] | null = null;
  private _choice: string = '';
  private _loading: Promise<void> | undefined;
  private readonly _listeners = new Set<() => void>();

  constructor(private readonly fetcher: Fetch = (input, init) => fetch(input, init)) {
    try {
      if (typeof localStorage !== 'undefined') {
        this._choice = localStorage.getItem(STORAGE_KEY) ?? '';
      }
    } catch {
      // Ignore localStorage read errors in restricted contexts
    }
  }

  get apps(): readonly string[] | null {
    return this._apps;
  }

  get choice(): string {
    return this._choice;
  }

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }

  load(): Promise<void> {
    this._loading ??= this.run();
    return this._loading;
  }

  choose(appId: string): void {
    if (this._choice === appId) return;
    this._choice = appId;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, appId);
      }
    } catch {
      // Ignore localStorage write errors
    }
    this.notify();
  }

  iconUrl(appId: string): string {
    return new URL(`/open-in-app/icon/${encodeURIComponent(appId)}`, hostBase()).href;
  }

  async launch(appId: string, path: string): Promise<void> {
    const body: OpenInAppOpenPayload = { app: appId, path };
    const response = await this.fetcher(new URL(OPEN_IN_APP_OPEN_ROUTE, hostBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`open failed: HTTP ${String(response.status)}`);
  }

  private async run(): Promise<void> {
    let apps: readonly string[] = [];
    try {
      const response = await this.fetcher(new URL(OPEN_IN_APP_APPS_ROUTE, hostBase()), {
        headers: { accept: 'application/json' },
      });
      if (response.ok) {
        const payload = (await response.json()) as OpenInAppAppsPayload;
        if (Array.isArray(payload.apps)) {
          apps = payload.apps.filter((id) => typeof id === 'string');
        }
      }
    } catch {
      // Swallows network failures: falls back to empty apps list
    }
    this._apps = apps;
    this.notify();
  }
}

export const defaultOpenInAppController = new OpenInAppController();
