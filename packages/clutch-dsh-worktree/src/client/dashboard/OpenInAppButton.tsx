import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  IconChevronDownOutline14,
  Menu,
  type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { WorktreeTranslate } from '../surface/types.js';
import { vscodeFolderUrl } from './vscode-url.js';
import {
  defaultOpenInAppController,
  type OpenInAppController,
} from './open-in-app-controller.js';
import css from './open-in-app.css';
import styles from './dashboard.css';

const APP_NAMES: Record<string, string> = {
  cursor: 'Cursor',
  vscode: 'VS Code',
  vscodeinsiders: 'VS Code Insiders',
  windsurf: 'Windsurf',
  zed: 'Zed',
  sublimetext: 'Sublime Text',
  xcode: 'Xcode',
  androidstudio: 'Android Studio',
  intellij: 'IntelliJ IDEA',
  pycharm: 'PyCharm',
  webstorm: 'WebStorm',
  phpstorm: 'PhpStorm',
  goland: 'GoLand',
  rider: 'Rider',
  rustrover: 'RustRover',
  fork: 'Fork',
  sourcetree: 'Sourcetree',
  github: 'GitHub Desktop',
  tower: 'Tower',
  gitkraken: 'GitKraken',
  smartgit: 'SmartGit',
  sublimemerge: 'Sublime Merge',
  ghostty: 'Ghostty',
  warp: 'Warp',
  iterm: 'iTerm2',
  kitty: 'kitty',
  terminal: 'Terminal',
  finder: 'Finder',
  explorer: 'Explorer',
};

const failedIcons = new Set<string>();

function AppIcon({ id, url, size }: { id: string; url: string; size: number }): ReactNode {
  const [failed, setFailed] = useState(failedIcons.has(id));
  if (failed) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className={css.icon}
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
      </svg>
    );
  }
  return (
    <img
      src={url}
      width={size}
      height={size}
      className={css.icon}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => {
        failedIcons.add(id);
        setFailed(true);
      }}
    />
  );
}

const BUSY_DRESS_DELAY_MS = 250;

export function OpenInAppButton({
  path,
  t,
  controller = defaultOpenInAppController,
}: {
  readonly path: string;
  readonly t: WorktreeTranslate;
  readonly controller?: OpenInAppController;
}): ReactNode {
  useEffect(() => {
    void controller.load();
  }, [controller]);

  const appsSnapshot = useSyncExternalStore(
    (onStoreChange) => controller.subscribe(onStoreChange),
    () => controller.apps,
    () => null,
  );

  const choiceSnapshot = useSyncExternalStore(
    (onStoreChange) => controller.subscribe(onStoreChange),
    () => controller.choice,
    () => '',
  );

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'busy' | 'error'>('idle');
  const inFlight = useRef(false);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(busyTimer.current);
      clearTimeout(errorTimer.current);
    },
    [],
  );

  // If host has no apps or request failed, fallback to native vscode:// link
  if (appsSnapshot === null || appsSnapshot.length === 0) {
    return (
      <a
        className={styles.dashboardButton}
        href={vscodeFolderUrl(path)}
        data-dashboard-action="open-editor"
      >
        {t('dashboard.openEditor')}
      </a>
    );
  }

  const validApps = appsSnapshot;
  const currentAppId =
    validApps.find((appId) => appId === choiceSnapshot) ?? validApps[0] ?? 'vscode';
  const currentAppName = APP_NAMES[currentAppId] ?? currentAppId;
  const buttonLabel = t('dashboard.openIn', { app: currentAppName });

  const launch = (appId: string): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    clearTimeout(errorTimer.current);
    clearTimeout(busyTimer.current);
    busyTimer.current = setTimeout(() => {
      setPhase('busy');
    }, BUSY_DRESS_DELAY_MS);

    controller
      .launch(appId, path)
      .then(() => {
        inFlight.current = false;
        clearTimeout(busyTimer.current);
        setPhase('idle');
      })
      .catch(() => {
        inFlight.current = false;
        clearTimeout(busyTimer.current);
        setPhase('error');
        clearTimeout(errorTimer.current);
        errorTimer.current = setTimeout(() => {
          setPhase('idle');
        }, 2000);
      });
  };

  const menuItems: MenuItem[] = validApps.map((appId) => ({
    id: appId,
    label: APP_NAMES[appId] ?? appId,
    icon: <AppIcon id={appId} url={controller.iconUrl(appId)} size={16} />,
  }));

  return (
    <Menu
      open={open}
      align="end"
      dense
      onClose={() => {
        setOpen(false);
      }}
      items={menuItems}
      selectedId={currentAppId}
      onSelect={(id) => {
        setOpen(false);
        if (inFlight.current) return;
        controller.choose(id);
        launch(id);
      }}
      anchor={
        <div className={css.split} data-dashboard-action="open-editor">
          <button
            type="button"
            className={css.main}
            data-state={phase}
            disabled={phase === 'busy'}
            aria-label={buttonLabel}
            title={buttonLabel}
            onClick={() => {
              launch(currentAppId);
            }}
          >
            <AppIcon id={currentAppId} url={controller.iconUrl(currentAppId)} size={16} />
            <span>{buttonLabel}</span>
          </button>
          {validApps.length > 1 && (
            <button
              type="button"
              className={css.chevron}
              aria-expanded={open}
              aria-haspopup="menu"
              aria-label="Toggle editor menu"
              onClick={() => {
                setOpen((prev) => !prev);
              }}
            >
              <IconChevronDownOutline14 size={12} />
            </button>
          )}
        </div>
      }
    />
  );
}
