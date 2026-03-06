import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

export const PROJECT_ROOT = pathToFileURL(process.cwd() + '/').href;

export const ISOLATED_ENV_KEYS = [
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

export const ISOLATED_ENV_PREFIXES = [
  'RATE_LIMIT_',
] as const;

const ERROR_PREVIEW_MAX_CHARS = 200;
const PASSTHROUGH_ENV_KEYS = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'TZ'] as const;

function isBlockedEnvKey(key: string): boolean {
  return ISOLATED_ENV_KEYS.includes(key as (typeof ISOLATED_ENV_KEYS)[number]) ||
    ISOLATED_ENV_PREFIXES.some(prefix => key.startsWith(prefix));
}

function toSafePreview(raw: string, maxChars = ERROR_PREVIEW_MAX_CHARS): string {
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return '(empty)';
  const redacted = compact
    .replace(
      /(["']?(?:admin_secret|session_secret|derived[_-]?key|encryption[_-]?key|password|api[_-]?key|token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,"'\s}]+)/ig,
      '$1<redacted>'
    )
    .replace(/((?:bearer|basic)\s+)[a-z0-9._~+/=-]+/ig, '$1<redacted>');
  return redacted.length > maxChars ? `${redacted.slice(0, maxChars)}...(truncated)` : redacted;
}

function sanitizeOverrides(overrides: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (isBlockedEnvKey(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export function buildScriptEnv(
  overrides: Record<string, string>,
  forced: { dbPath: string; envFilePath: string }
): Record<string, string> {
  const nextEnv: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = process.env[key];
    if (typeof value === 'string') {
      nextEnv[key] = value;
    }
  }

  const sanitizedOverrides = sanitizeOverrides(overrides);

  return {
    ...nextEnv,
    ...sanitizedOverrides,
    NODE_ENV: 'test',
    DB_PATH: forced.dbPath,
    ENV_FILE_PATH: forced.envFilePath,
  };
}

/**
 * Runs route code in an isolated Bun subprocess and returns the parsed @@RESULT@@ JSON payload.
 */
export function runRouteScript<T = Record<string, unknown>>(code: string, env: Record<string, string> = {}): T {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-route-'));
  try {
    const runner = path.join(tmpDir, 'runner.ts');
    writeFileSync(runner, code, 'utf8');

    const isolatedEnv = buildScriptEnv(env, {
      envFilePath: path.join(tmpDir, '.env'),
      dbPath: path.join(tmpDir, 'igloo.db'),
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
      const stderrPreview = toSafePreview(result.stderr.toString());
      const stdoutPreview = toSafePreview(result.stdout.toString());
      throw new Error(
        `route script failed: status=${result.exitCode} stderr_preview="${stderrPreview}" stdout_preview="${stdoutPreview}"`
      );
    }

    const marker = '@@RESULT@@';
    const stdout = result.stdout.toString().trim();
    const line = stdout.split('\n').reverse().find(l => l.includes(marker));
    if (!line) {
      throw new Error(`route script missing result marker; stdout_preview="${toSafePreview(stdout)}"`);
    }
    const rawJson = line.slice(line.indexOf(marker) + marker.length);
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      return parsed as T;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `route script returned invalid JSON marker payload: ${detail}; ` +
        `raw_preview="${toSafePreview(rawJson)}"; stdout_preview="${toSafePreview(stdout)}"`
      );
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
