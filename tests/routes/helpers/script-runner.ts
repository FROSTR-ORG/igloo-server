import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

export const PROJECT_ROOT = pathToFileURL(process.cwd() + '/').href;

const ISOLATED_ENV_KEYS = [
  'NODE_ENV',
  'HEADLESS',
  'AUTH_ENABLED',
  'API_KEY',
  'BASIC_AUTH_USER',
  'BASIC_AUTH_PASS',
  'GROUP_CRED',
  'SHARE_CRED',
  'GROUP_NAME',
  'RELAYS',
  'PEER_POLICIES',
  'DB_PATH',
  'ADMIN_SECRET',
  'SESSION_SECRET',
  'ALLOWED_ORIGINS',
  'TRUST_PROXY',
  'AUTO_ADMIN_SECRET',
  'SKIP_ADMIN_SECRET_VALIDATION',
  'ENV_FILE_PATH',
] as const;

const ISOLATED_ENV_PREFIXES = [
  'RATE_LIMIT_',
] as const;

function buildScriptEnv(overrides: Record<string, string>): Record<string, string> {
  const nextEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      nextEnv[key] = value;
    }
  }

  for (const key of ISOLATED_ENV_KEYS) {
    delete nextEnv[key];
  }

  for (const key of Object.keys(nextEnv)) {
    if (ISOLATED_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
      delete nextEnv[key];
    }
  }

  return {
    ...nextEnv,
    NODE_ENV: 'test',
    ...overrides,
  };
}

/**
 * Runs route code in an isolated Bun subprocess and returns the parsed @@RESULT@@ JSON payload.
 * Uses T=any by default so callers without an explicit type can access result properties (e.g. out.status).
 */
export function runRouteScript<T = any>(code: string, env: Record<string, string> = {}): T {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-route-'));
  try {
    const runner = path.join(tmpDir, 'runner.ts');
    writeFileSync(runner, code, 'utf8');

    const isolatedEnv = buildScriptEnv({
      ENV_FILE_PATH: path.join(tmpDir, '.env'),
      DB_PATH: path.join(tmpDir, 'igloo.db'),
      ...env
    });

    const result = Bun.spawnSync({
      cmd: ['bun', '--no-env-file', 'run', runner],
      cwd: process.cwd(),
      env: isolatedEnv,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15000,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `route script failed: status=${result.exitCode} stderr="${result.stderr.toString()}" stdout="${result.stdout.toString()}"`
      );
    }

    const marker = '@@RESULT@@';
    const stdout = result.stdout.toString().trim();
    const line = stdout.split('\n').findLast(l => l.includes(marker));
    if (!line) {
      throw new Error(`route script missing result marker: ${stdout}`);
    }
    const rawJson = line.slice(line.indexOf(marker) + marker.length);
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      return parsed as T;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`route script returned invalid JSON marker payload: ${detail}; raw="${rawJson}"; stdout="${stdout}"`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
