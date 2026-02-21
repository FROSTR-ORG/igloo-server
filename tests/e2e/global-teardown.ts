/**
 * Playwright global teardown – kills the server + co-signer and cleans up
 * the temp directory created by global-setup.
 */

import fs from 'fs';
import type { FullConfig } from '@playwright/test';

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const stateFile = process.env.SMOKE_STATE_FILE;
  if (!stateFile || !fs.existsSync(stateFile)) {
    console.warn('[teardown] No state file found – nothing to clean up.');
    return;
  }

  let state: { serverPid?: number; cosignerPid?: number; tmpDir?: string };
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
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

  if (state.tmpDir) {
    try {
      fs.rmSync(state.tmpDir, { recursive: true, force: true });
      console.log('[teardown] Removed temp dir', state.tmpDir);
    } catch (err) {
      console.warn('[teardown] Could not remove temp dir:', err);
    }
  }
}
