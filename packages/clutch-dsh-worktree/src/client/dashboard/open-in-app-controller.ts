type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

// Official DSH Host open-in-app routes. Keep these URLs relative so requests stay on
// the current DSH host and retain the Host's validation and permission checks.
export const OPEN_IN_APP_APPS_ROUTE = '/open-in-app/apps';
export const OPEN_IN_APP_ICON_ROUTE = '/open-in-app/icon/';
export const OPEN_IN_APP_OPEN_ROUTE = '/open-in-app/open';

export interface OpenInAppAppsPayload {
  readonly apps: readonly string[];
}

export interface OpenInAppOpenPayload {
  readonly app: string;
  readonly path: string;
}

export class OpenInAppController {
  private _apps: readonly string[] | null = null;
  private _choice: string = '';
  private _loading: Promise<void> | undefined;
  private readonly _listeners = new Set<() => void>();

  constructor(private readonly fetcher: Fetch = (input, init) => fetch(input, init)) {}

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
    this.notify();
  }

  iconUrl(appId: string): string {
    return `${OPEN_IN_APP_ICON_ROUTE}${encodeURIComponent(appId)}`;
  }

  async launch(appId: string, path: string): Promise<void> {
    const body: OpenInAppOpenPayload = { app: appId, path };
    const response = await this.fetcher(OPEN_IN_APP_OPEN_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`open failed: HTTP ${String(response.status)}`);
  }

  private async run(): Promise<void> {
    let apps: readonly string[] = [];
    try {
      const response = await this.fetcher(OPEN_IN_APP_APPS_ROUTE, {
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
