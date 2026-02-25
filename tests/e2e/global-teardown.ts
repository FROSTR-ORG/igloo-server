/**
 * Playwright global teardown – kills the server + co-signer and cleans up
 * the temp directory created by global-setup.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FullConfig } from '@playwright/test';
import type { SmokeTestState } from './state.js';

const MAX_STATE_AGE_MS = 10 * 60 * 1000;

function parsePositivePid(raw: unknown, fieldName: string): number | null {
  if (raw == null || raw === 0) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    console.warn(`[teardown] Invalid ${fieldName}; expected positive integer PID, got:`, raw);
    return null;
  }
  return raw;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

function resolveSafeTmpDir(rawTmpDir: unknown): string | null {
  if (typeof rawTmpDir !== 'string' || rawTmpDir.trim().length === 0) {
    console.warn('[teardown] Invalid tmpDir in state; skipping temp cleanup.');
    return null;
  }
  const resolvedTmp = path.resolve(rawTmpDir);
  const tempRoot = path.resolve(os.tmpdir());
  const relToTempRoot = path.relative(tempRoot, resolvedTmp);
  const isInsideTemp =
    relToTempRoot.length > 0 &&
    relToTempRoot !== '.' &&
    !relToTempRoot.startsWith('..') &&
    !path.isAbsolute(relToTempRoot);
  if (!isInsideTemp) {
    console.warn('[teardown] Skipping temp dir removal outside os.tmpdir():', resolvedTmp);
    return null;
  }
  if (!path.basename(resolvedTmp).startsWith('igloo-smoke-test-')) {
    console.warn('[teardown] Refusing to remove unexpected temp dir name:', resolvedTmp);
    return null;
  }
  try {
    if (!fs.existsSync(resolvedTmp)) {
      console.warn('[teardown] tmpDir does not exist; skipping temp cleanup:', resolvedTmp);
      return null;
    }
    if (!fs.statSync(resolvedTmp).isDirectory()) {
      console.warn('[teardown] tmpDir is not a directory; skipping temp cleanup:', resolvedTmp);
      return null;
    }
  } catch (error) {
    console.warn('[teardown] Could not validate tmpDir; skipping temp cleanup:', error);
    return null;
  }
  return resolvedTmp;
}

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const stateFile = process.env.SMOKE_STATE_FILE;
  if (!stateFile || stateFile.trim().length === 0) {
    throw new Error('[teardown] SMOKE_STATE_FILE is required; refusing to guess a state file.');
  }

  const resolvedStateFile = path.resolve(stateFile);
  console.log('[teardown] Resolved state file:', resolvedStateFile);

  if (!fs.existsSync(resolvedStateFile)) {
    throw new Error(`[teardown] State file does not exist: ${resolvedStateFile}`);
  }

  let skipTempCleanup = false;
  try {
    const ageMs = Date.now() - fs.statSync(resolvedStateFile).mtimeMs;
    if (ageMs > MAX_STATE_AGE_MS) {
      console.warn(
        `[teardown] State file is stale (${Math.round(ageMs / 1000)}s old); ` +
        'skipping temp cleanup, but continuing process teardown to avoid leaks.'
      );
      skipTempCleanup = true;
    }
  } catch (error) {
    console.warn('[teardown] Could not stat state file; skipping cleanup for safety:', error);
    return;
  }

  let parsedState: Partial<SmokeTestState>;
  try {
    parsedState = JSON.parse(fs.readFileSync(resolvedStateFile, 'utf8')) as Partial<SmokeTestState>;
  } catch (error) {
    console.warn('[teardown] Could not parse state file; skipping cleanup for safety:', error);
    return;
  }

  const cosignerPid = parsePositivePid(parsedState.cosignerPid, 'cosignerPid');
  const serverPid = parsePositivePid(parsedState.serverPid, 'serverPid');
  const safeTmpDir = skipTempCleanup ? null : resolveSafeTmpDir(parsedState.tmpDir);

  for (const [label, pid] of [['co-signer', cosignerPid], ['server', serverPid]] as const) {
    if (!pid) continue;
    if (!isProcessRunning(pid)) {
      console.warn(`[teardown] ${label} pid ${pid} is not running; skipping SIGTERM.`);
      continue;
    }
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[teardown] Sent SIGTERM to ${label} (pid ${pid})`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        console.warn(`[teardown] Could not kill ${label} (pid ${pid}):`, err);
      }
    }
  }

  await new Promise(r => setTimeout(r, 500));

  if (skipTempCleanup) {
    console.warn('[teardown] Skipping temp dir removal because state file is stale.');
    return;
  }

  if (!safeTmpDir) {
    console.warn('[teardown] Skipping temp dir removal due to invalid tmpDir state.');
    return;
  }

  try {
    fs.rmSync(safeTmpDir, { recursive: true, force: true });
    console.log('[teardown] Removed temp dir', safeTmpDir);
  } catch (err) {
    console.warn('[teardown] Could not remove temp dir:', err);
  }
}
