import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {
  SessionStatusSnapshot,
  UseSessionStatus,
  UseSessions,
} from '@deepseek-ai/dsh-client-ui-session/client';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { projectOffices } from '../office/project.js';
import type { Office } from '../office/types.js';
import { sessionFacts } from './native-facts.js';
import { OfficeDashboard } from './OfficeDashboard.js';
import { en, zh } from './locales.js';
import { OFFICE_CSS } from './styles.js';
import { officePhase } from './readiness.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'clutch.office': keyof typeof en;
  }
}

export const inject = ['slots', 'locale', 'workspaces', 'layout', 'connection'];

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}
const isOnline = () => navigator.onLine;

function OfficeIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 11.5 12 4l9 7.5V21H3zM9 21v-7h6v7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 8V4M16 8V4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

type NativeProps = PropsRuntime<'main'> &
  PropsLocale<'clutch.office'> & {
    source: Context['workspaces']['list'];
    connection: ConnectionHandle;
  };

function NativeOffice({ source, connection, useSessions, useSessionStatus, t }: NativeProps) {
  const online = useSyncExternalStore(subscribeOnline, isOnline);
  const state = useSyncExternalStore(connection.state.subscribe, connection.state.getSnapshot);
  const generation = useSyncExternalStore(
    connection.generation.subscribe,
    connection.generation.getSnapshot,
  );
  const workspace = useSyncExternalStore(
    source.subscribe.bind(source),
    source.getSnapshot.bind(source),
  );
  const list: SessionListState = (useSessions as UseSessions)((value: SessionListState) => value);
  const status: SessionStatusSnapshot = (useSessionStatus as UseSessionStatus)(
    (value: SessionStatusSnapshot) => value,
  );
  const previous = useRef<readonly Office[]>([]);
  const offices = useMemo(() => {
    const projections = new Map(Object.entries(list.projectionsBySession));
    const facts = sessionFacts(list.ids, list.byId, status, workspace.archivedSessionIds, (id) => {
      const title: unknown = Object.entries(projections.get(id)?.values ?? {}).find(
        ([key]) => key === 'title',
      )?.[1];
      return typeof title === 'string' ? title : undefined;
    });
    return projectOffices(
      workspace.items.map((item) => ({
        id: item.workspaceId,
        title: item.title,
        sessionIds: item.sessionIds,
      })),
      facts,
      previous.current,
    );
  }, [workspace, list, status]);
  useLayoutEffect(() => {
    previous.current = offices;
  }, [offices]);
  const phase = officePhase({
    online,
    connection: state,
    generation,
    workspaceState: workspace.state,
    workspacePhase: workspace.phase,
    sessionPhase: list.phase,
  });
  return <OfficeDashboard offices={offices} phase={phase} t={t} />;
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('clutch.office', { en, zh }));
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.clutchOffice = '';
    style.textContent = OFFICE_CSS;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: 'clutch-dsh-office',
        locale: 'clutch.office',
        inject: () => ({
          source: ctx.workspaces.list,
          connection: ctx.get('connection') as ConnectionHandle,
        }),
      },
      NativeOffice,
    ),
  );
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: 'clutch-dsh-office',
        order: 45,
        label: () => ctx.locale.bind('clutch.office')('nav'),
      },
      OfficeIcon,
    ),
  );
}
