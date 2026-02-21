/**
 * Playwright global teardown – kills the server + co-signer and cleans up
 * the temp directory created by global-setup.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FullConfig } from '@playwright/test';

function findLatestStateFile(): string | null {
  const tmpRoot = os.tmpdir();
  let latestFile: string | null = null;
  let latestMtime = 0;

  for (const entry of fs.readdirSync(tmpRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('igloo-smoke-test')) continue;
    const candidate = path.join(tmpRoot, entry.name, 'state.json');
    if (!fs.existsSync(candidate)) continue;
    const mtime = fs.statSync(candidate).mtimeMs;
    if (mtime > latestMtime) {
      latestMtime = mtime;
      latestFile = candidate;
    }
  }

  return latestFile;
}

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const stateFile = process.env.SMOKE_STATE_FILE;
  const resolvedStateFile =
    stateFile && fs.existsSync(stateFile)
      ? stateFile
      : findLatestStateFile();

  if (!resolvedStateFile || !fs.existsSync(resolvedStateFile)) {
    console.warn('[teardown] No state file found – nothing to clean up.');
    return;
  }

  let state: { serverPid?: number; cosignerPid?: number; tmpDir?: string };
  try {
    state = JSON.parse(fs.readFileSync(resolvedStateFile, 'utf8'));
  } catch {
    console.warn('[teardown] Could not parse state file.');
    return;
  }

  for (const [label, pid] of [['co-signer', state.cosignerPid], ['server', state.serverPid]] as const) {
    if (!pid) continue;
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[teardown] Sent SIGTERM to ${label} (pid ${pid})`);
    } catch (err: unknown) {
      // ESRCH = process already gone, which is fine
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        console.warn(`[teardown] Could not kill ${label} (pid ${pid}):`, err);
      }
    }
  }

  // Brief pause to let processes flush logs
  await new Promise(r => setTimeout(r, 500));

  const tmpDir = state.tmpDir || path.dirname(resolvedStateFile);
  if (tmpDir) {
    try {
      const resolvedTmp = path.resolve(tmpDir);
      const tempRoot = path.resolve(os.tmpdir());
      const relToTempRoot = path.relative(tempRoot, resolvedTmp);
      const isInsideTemp =
        relToTempRoot.length > 0 &&
        relToTempRoot !== '.' &&
        !relToTempRoot.startsWith('..') &&
        !path.isAbsolute(relToTempRoot);

      if (!isInsideTemp) {
        console.warn('[teardown] Skipping temp dir removal outside os.tmpdir():', resolvedTmp);
      } else {
        fs.rmSync(resolvedTmp, { recursive: true, force: true });
        console.log('[teardown] Removed temp dir', resolvedTmp);
      }
    } catch (err) {
      console.warn('[teardown] Could not remove temp dir:', err);
    }
  }
}
