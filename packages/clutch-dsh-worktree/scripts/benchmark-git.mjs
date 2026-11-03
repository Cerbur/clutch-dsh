import { execFile } from 'node:child_process';
import process from 'node:process';

// Separate command and cleanup deadlines: execFile's timeout alone waits for
// close, which a surviving descendant holding stdout open can prevent forever.
export function runBenchmarkGit(args, cwd, {
  timeoutMs = 30_000,
  cleanupTimeoutMs = 5_000,
  maxOutputBytes = 16 * 1024 * 1024,
  execute = execFile,
  platform = process.platform,
  kill = process.kill.bind(process),
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let killer;
    let cleanup;
    let settled = false;
    let timeoutError;
    let treeCleanupPending = false;
    let childClosed = false;
    const release = (handle) => {
      handle?.stdin?.destroy();
      handle?.stdout?.destroy();
      handle?.stderr?.destroy();
      handle?.unref();
    };
    const finish = (error, stdout) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(cleanup);
      if (killer) {
        try { killer.kill('SIGKILL'); } catch { /* best effort */ }
        release(killer);
      }
      if (error) reject(error);
      else resolve(stdout);
    };
    const deadline = setTimeout(() => {
      timeoutError = Object.assign(new Error('Benchmark Git command timed out'), { code: 'ETIMEDOUT' });
      cleanup = setTimeout(() => {
        release(child);
        finish(Object.assign(timeoutError, { processTreeDidNotExit: true }));
      }, cleanupTimeoutMs);
      // POSIX commands own a process group; Windows taskkill targets the tree.
      // Neither path invokes a shell, and taskkill is bounded by cleanup too.
      try {
        if (child.pid && platform === 'win32') {
          treeCleanupPending = true;
          killer = execute('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
            cwd, shell: false, windowsHide: true, timeout: cleanupTimeoutMs,
            killSignal: 'SIGKILL', maxBuffer: maxOutputBytes,
          }, (error) => {
            treeCleanupPending = false;
            if (error) timeoutError.processTreeDidNotExit = true;
            if (childClosed) finish(timeoutError);
          });
        } else if (child.pid) {
          kill(-child.pid, 'SIGKILL');
        }
      } catch {
        // The process may already be gone; still enforce the cleanup deadline.
        treeCleanupPending = false;
        timeoutError.processTreeDidNotExit = true;
      }
      if (!treeCleanupPending) {
        try { child.kill('SIGKILL'); } catch { /* best effort */ }
      }
    }, timeoutMs);
    try {
      child = execute('git', args, {
        cwd, encoding: 'utf8', shell: false, windowsHide: true,
        detached: platform !== 'win32', maxBuffer: maxOutputBytes,
        killSignal: 'SIGKILL',
      }, (error, stdout) => {
        childClosed = true;
        if (!treeCleanupPending) finish(timeoutError ?? error, stdout);
      });
      child.stdin?.end();
    } catch (error) {
      finish(error);
    }
  });
}
