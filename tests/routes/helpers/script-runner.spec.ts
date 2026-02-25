import { describe, expect, test } from 'bun:test';
import {
  buildScriptEnv,
  ISOLATED_ENV_KEYS,
  ISOLATED_ENV_PREFIXES,
} from './script-runner';

describe('buildScriptEnv', () => {
  test('keeps forced values and blocks reserved override keys', () => {
    const env = buildScriptEnv(
      {
        NODE_ENV: 'production',
        DB_PATH: '/tmp/attacker.db',
        ENV_FILE_PATH: '/tmp/attacker.env',
        ADMIN_SECRET: 'nope',
        CUSTOM_FLAG: '1',
      },
      {
        dbPath: '/tmp/forced.db',
        envFilePath: '/tmp/forced.env',
      }
    );

    expect(env.NODE_ENV).toBe('test');
    expect(env.DB_PATH).toBe('/tmp/forced.db');
    expect(env.ENV_FILE_PATH).toBe('/tmp/forced.env');
    expect(env.ADMIN_SECRET).toBeUndefined();
    expect(env.CUSTOM_FLAG).toBe('1');
  });

  test('blocks override keys that match isolated prefixes', () => {
    const reservedPrefix = ISOLATED_ENV_PREFIXES[0];
    const env = buildScriptEnv(
      {
        [`${reservedPrefix}WINDOW`]: '123',
        [`${reservedPrefix}MAX`]: '999',
        SAFE_KEY: 'ok',
      },
      {
        dbPath: '/tmp/forced.db',
        envFilePath: '/tmp/forced.env',
      }
    );

    expect(env[`${reservedPrefix}WINDOW`]).toBeUndefined();
    expect(env[`${reservedPrefix}MAX`]).toBeUndefined();
    expect(env.SAFE_KEY).toBe('ok');
  });

  test('removes reserved keys inherited from process.env', () => {
    const forcedKeys = new Set(['NODE_ENV', 'DB_PATH', 'ENV_FILE_PATH']);
    const reservedKey = ISOLATED_ENV_KEYS.find((key) => !forcedKeys.has(key));
    expect(reservedKey).toBeDefined();
    if (!reservedKey) throw new Error('Expected at least one reserved key other than NODE_ENV');
    const preserved = process.env[reservedKey];
    process.env[reservedKey] = 'should-not-leak';
    try {
      const env = buildScriptEnv(
        {},
        {
          dbPath: '/tmp/forced.db',
          envFilePath: '/tmp/forced.env',
        }
      );
      expect(env[reservedKey]).toBeUndefined();
    } finally {
      if (preserved === undefined) delete process.env[reservedKey];
      else process.env[reservedKey] = preserved;
    }
  });
});
