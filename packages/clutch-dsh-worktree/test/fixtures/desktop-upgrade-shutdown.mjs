// Isolated IPC child: real plugin/Cordis and upstream shutdown controller,
// with only the native Workspace/Session roster replaced. No installed profile.
import { once } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { WorktreeRemoteService } from '../../lib/host/service.js';

const [source, home, root] = process.argv.slice(2);
const { createProcessShutdown } = await import(pathToFileURL(path.join(source, 'apps/cli/src/process-shutdown.ts')).href);
const ctx = new Context();
const workspace = { id: 'ws', path: root, sessionIds: [] };
ctx.provide('workspaceRegistry', { get: () => workspace, list: () => [workspace] });
ctx.provide('sessions', { get: () => undefined, list: () => [] });
ctx.provide('sessionPersistence', { list: async () => [] });
await ctx.plugin(WorktreeRemoteService, { dshHome: home });
const lock = ctx.get('worktreeManager').manager.context.sidecar.persistence.mutationLock;
const stopping = once(process, 'message');
const reclaim = lock.reclaimIfDead.bind(lock);
let notified = false;
lock.reclaimIfDead = async (...args) => {
  await reclaim(...args);
  if (!notified) {
    notified = true;
    process.send({ type: 'ready' });
  }
};
await stopping;
// Preserve the real 5000ms force-exit default. A timed-out dispose exits 0
// before the acknowledgement, which Desktop correctly refuses for installation.
await createProcessShutdown(() => ctx.fiber.dispose()).shutdown(0);
await new Promise((resolve, reject) => process.send({ type: 'shutdown-complete' }, (error) => error ? reject(error) : resolve()));
process.disconnect();
process.exit();
