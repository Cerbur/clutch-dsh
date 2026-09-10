import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import {
  isProcessAlive,
  readLogTail,
  readProcessState,
  saveProcessState,
  stopWebService,
} from '../src/process.mjs';

test('process module', async (t) => {
  let tmpConfigDir;
  const originalDwmDir = process.env.DWM_DIR;

  before(() => {
    tmpConfigDir = mkdtempSync(path.join(tmpdir(), 'dwm-test-process-'));
    process.env.DWM_DIR = tmpConfigDir;
  });

  after(() => {
    if (originalDwmDir !== undefined) {
      process.env.DWM_DIR = originalDwmDir;
    } else {
      delete process.env.DWM_DIR;
    }
    try {
      rmSync(tmpConfigDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test('isProcessAlive correctly checks process status', () => {
    assert.equal(isProcessAlive(process.pid), true);
    assert.equal(isProcessAlive(null), false);
    assert.equal(isProcessAlive(0), false);
    assert.equal(isProcessAlive(-1), false);
    // PID 999999 is almost certainly not running
    assert.equal(isProcessAlive(99999999), false);
  });

  await t.test('readProcessState detects dead processes and resets state', () => {
    saveProcessState({
      pid: 99999999,
      running: true,
      args: ['--port', '3080'],
    });

    const state = readProcessState();
    assert.equal(state.running, false);
    assert.equal(state.pid, null);
    assert.deepEqual(state.args, ['--port', '3080']);
  });

  await t.test('stopWebService gracefully handles already stopped service', async () => {
    saveProcessState({
      pid: null,
      running: false,
    });

    const result = await stopWebService();
    assert.equal(result.success, true);
    assert.equal(result.stopped, false);
    assert.match(result.message, /not running/);
  });

  await t.test('readLogTail reads last N lines correctly', () => {
    const logFile = path.join(tmpConfigDir, 'test.log');
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    writeFileSync(logFile, lines.join('\n') + '\n', 'utf8');

    const tail = readLogTail(logFile, 5);
    assert.equal(tail.length, 5);
    assert.equal(tail[4], 'line 50');
    assert.equal(tail[0], 'line 46');
  });
});
