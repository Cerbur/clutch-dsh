// Loaded only by scripts/test-dsh-compat.mjs in a disposable Web profile.
import assert from 'node:assert/strict';
import process from 'node:process';
import { rename, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title';

const { AbortController } = globalThis;

async function publishReport(filename, text) {
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, filename);
}

export const inject = [
  'loader',
  'llm',
  'sessions',
  'sessionTitle',
  'settings',
  'sessionPersistence',
];

class MatrixAdapter extends LlmAdapter {
  calls = [];
  outputs = [];
  async resolveModel(provider, model, signal) {
    return {
      ...(await super.resolveModel(provider, model, signal)),
      reasoning: { efforts: [{ id: 'off', name: 'Off' }] },
    };
  }
  async *stream(options) {
    this.calls.push(options);
    const output = this.outputs.shift() ?? '{"type":"功能","desc":"RC compatibility"}';
    if (output instanceof Error) throw output;
    yield { type: 'text-delta', index: 0, text: output };
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function eventually(read) {
  const expires = Date.now() + 10000;
  while (Date.now() < expires) {
    if (await read()) return;
    await delay(20);
  }
  throw new Error('title compatibility condition did not settle');
}

export function apply(ctx) {
  const adapter = new MatrixAdapter();
  ctx.llm.registerAdapter(['title-matrix'], adapter);
  void ctx.loader
    .await()
    .then(async () => {
      const checks = [];
      const check = async (label, run) => {
        await run();
        checks.push(label);
      };
      const settings = (ops) => ctx.settings.mutate('clutch-dsh-title', ops);
      const set = (key, value) => ({ op: 'set', path: [key], value });
      const signal = new AbortController().signal;
      let session;
      try {
        if (process.env.DSH_TITLE_COMPAT_RELOAD === '1') {
          const reader = await ctx.sessionPersistence.open(
            SessionId('title-matrix-session'),
            'read',
          );
          try {
            const persisted = await reader.read();
            assert.equal(foldSessionTitle(persisted.events).title, 'Refreshed title');
          } finally {
            await reader.close();
          }
          assert.equal((await ctx.get('titleRemote').getStats(signal)).totalCalls, 0);
          assert.equal((await ctx.get('titleRemote').getDiagnostics(signal)).totalIncidents, 0);
          await publishReport(
            process.env.DSH_TITLE_COMPAT_REPORT,
            JSON.stringify({
              ok: true,
              checks: ['server restart restores title and persisted resets'],
            }),
          );
          return;
        }
        await check('real Loader activation and settings ownership', () => {
          const entry = [...ctx.loader.entries()].find(
            (row) => row.options.id === 'clutch-dsh-title',
          );
          assert.equal(entry?.fiber?.state, 2); // Cordis ACTIVE is a compile-time enum.
          assert.equal(
            ctx.settings.describe().find((item) => item.ns === 'clutch-dsh-title')?.autoGenerate,
            false,
          );
        });
        await settings([set('enabled', true), set('active', 'default')]);
        await check('automatic structured generation and exact request record', async () => {
          session = ctx.sessions.create(SessionId('title-matrix-session'), {
            meta: { createdAt: Date.UTC(2026, 8, 3, 16), cwd: process.cwd() },
          });
          session.append('turn/start', { turn: 1 });
          session.append(
            'user/message',
            createUserMessage({
              content: [{ type: 'text', text: 'Verify RC title compatibility' }],
              source: { kind: 'user' },
            }),
            { surfaceOp: 'append' },
          );
          session.append('request/header', {
            header: { config: { provider: 'title-matrix', model: 'fixture' } },
            reason: 'initial',
          });
          await eventually(() => ctx.sessionTitle.get(session)?.source.kind === 'provider');
          assert.equal(ctx.sessionTitle.get(session).title, '0904|功能|RC compatibility');
          const event = session
            .snapshotEvents()
            .find((item) => item.type === 'session/title-llm-request');
          assert.equal(event.data.reasoningEffort, adapter.calls[0].reasoningEffort);
          assert.deepEqual(event.data.messages, adapter.calls[0].messages);
        });
        await check('repair preserves the native request and diagnostics', async () => {
          adapter.outputs = ['invalid JSON', '{"type":"功能","desc":"Repaired title"}'];
          const before = adapter.calls.length;
          assert.equal((await ctx.sessionTitle.refresh(session)).title, '0904|功能|Repaired title');
          assert.equal(adapter.calls.length - before, 2);
          assert.equal(adapter.calls.at(-1).messages.length, 1);
          await eventually(
            async () => (await ctx.get('titleRemote').getDiagnostics(signal)).totalRecovered > 0,
          );
        });
        await check('deterministic template makes no model call', async () => {
          await settings([
            set('active', 'matrix'),
            set('templates', { matrix: 'template: Matrix literal' }),
          ]);
          const before = adapter.calls.length;
          assert.equal((await ctx.sessionTitle.refresh(session)).title, 'Matrix literal');
          assert.equal(adapter.calls.length, before);
        });
        await check('disabled templates use the shared plain executor', async () => {
          await settings([set('enabled', false)]);
          adapter.outputs = ['**Plain title**\nextra explanation'];
          assert.equal((await ctx.sessionTitle.refresh(session)).title, 'Plain title');
          assert.equal(adapter.calls.at(-1).maxTokens, 64);
          const event = session
            .snapshotEvents()
            .filter((item) => item.type === 'session/title-llm-request')
            .at(-1);
          assert.equal(event.data.titleProvider, 'clutch-dsh-title');
        });
        await check('manual rename pins and explicit refresh unpins', async () => {
          ctx.sessionTitle.rename(session, 'Pinned title');
          const before = adapter.calls.length;
          session.append(
            'user/message',
            createUserMessage({
              content: [{ type: 'text', text: 'Later message must not replace the pin' }],
              source: { kind: 'user' },
            }),
            { surfaceOp: 'append' },
          );
          await delay(30);
          assert.equal(ctx.sessionTitle.get(session).title, 'Pinned title');
          assert.equal(adapter.calls.length, before);
          adapter.outputs = ['Refreshed title'];
          assert.equal((await ctx.sessionTitle.refresh(session)).title, 'Refreshed title');
        });
        await check('transport failure preserves the accepted title without repair', async () => {
          adapter.outputs = [new Error('matrix transport failure')];
          const before = adapter.calls.length;
          await assert.rejects(ctx.sessionTitle.refresh(session), /matrix transport failure/);
          assert.equal(adapter.calls.length - before, 1);
          assert.equal(ctx.sessionTitle.get(session).title, 'Refreshed title');
        });
        await check('native persistence accepts and reloads title request records', async () => {
          session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
          const handle = await ctx.sessionPersistence.create(session.header);
          try {
            await handle.append(session.snapshotEvents());
            await handle.flush();
          } finally {
            await handle.close();
          }
          const reader = await ctx.sessionPersistence.open(session.id, 'read');
          try {
            const persisted = await reader.read();
            assert.equal(
              persisted.events.filter((item) => item.type === 'session/title').at(-1).data.title,
              'Refreshed title',
            );
            assert.ok(persisted.events.some((item) => item.type === 'session/title-llm-request'));
          } finally {
            await reader.close();
          }
        });
        await eventually(
          async () => (await ctx.get('titleRemote').getStats(signal)).totalCalls >= 5,
        );
        const batch = ctx
          .get('clientModules')
          .graph()
          .batches.find((item) => item.entries.includes('@cerbur/clutch-dsh-title'));
        assert.ok(batch, 'the native browser graph must contain the title plugin');
        await publishReport(
          process.env.DSH_TITLE_COMPAT_REPORT,
          JSON.stringify({ ok: true, checks, browserUrl: batch.url }, null, 2),
        );
      } catch (error) {
        await publishReport(
          process.env.DSH_TITLE_COMPAT_REPORT,
          JSON.stringify({ ok: false, checks, error: error.stack ?? String(error) }, null, 2),
        );
      }
    })
    .catch(async (error) => {
      await publishReport(
        process.env.DSH_TITLE_COMPAT_REPORT,
        JSON.stringify({ ok: false, error: String(error) }),
      );
    });
}
