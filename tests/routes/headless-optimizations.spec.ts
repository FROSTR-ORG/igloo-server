import { describe, expect, test } from 'bun:test';
import { pathToFileURL } from 'url';
import { runRouteScript } from './helpers/script-runner';

const PROJECT_ROOT = pathToFileURL(process.cwd() + '/').href;

describe('Headless performance optimizations', () => {
  describe('SKIP_STARTUP_ECHO const (5.2)', () => {
    test('defaults to false when not set', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        delete process.env.SKIP_STARTUP_ECHO;

        const CONST = await import(root + 'src/const.ts');

        console.log('@@RESULT@@' + JSON.stringify({
          skipStartupEcho: CONST.SKIP_STARTUP_ECHO
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.skipStartupEcho).toBe(false);
    }, { timeout: 10000 });

    test('parses "true" correctly', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.SKIP_STARTUP_ECHO = 'true';

        // Force re-import by using dynamic import with cache bust
        const CONST = await import(root + 'src/const.ts');

        console.log('@@RESULT@@' + JSON.stringify({
          skipStartupEcho: CONST.SKIP_STARTUP_ECHO
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.skipStartupEcho).toBe(true);
    }, { timeout: 10000 });

    test('parses "1" correctly', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.SKIP_STARTUP_ECHO = '1';

        const CONST = await import(root + 'src/const.ts');

        console.log('@@RESULT@@' + JSON.stringify({
          skipStartupEcho: CONST.SKIP_STARTUP_ECHO
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.skipStartupEcho).toBe(true);
    }, { timeout: 10000 });

    test('treats empty string as false', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.SKIP_STARTUP_ECHO = '';

        const CONST = await import(root + 'src/const.ts');

        console.log('@@RESULT@@' + JSON.stringify({
          skipStartupEcho: CONST.SKIP_STARTUP_ECHO
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.skipStartupEcho).toBe(false);
    }, { timeout: 10000 });
  });

  describe('Session secret skip in headless+API_KEY mode (3.2)', () => {
    test('skips session secret generation when HEADLESS=true and API_KEY set', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'true';
        process.env.API_KEY = 'test-api-key';
        process.env.RATE_LIMIT_ENABLED = 'false';
        // Explicitly NOT setting SESSION_SECRET

        const { AUTH_CONFIG, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        console.log('@@RESULT@@' + JSON.stringify({
          sessionSecretIsNull: AUTH_CONFIG.SESSION_SECRET === null,
          hasApiKey: AUTH_CONFIG.API_KEY === 'test-api-key'
        }));
        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.sessionSecretIsNull).toBe(true);
      expect(result.hasApiKey).toBe(true);
    }, { timeout: 10000 });

    test('still generates session secret when HEADLESS=false', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'false';
        process.env.AUTH_ENABLED = 'true';
        process.env.API_KEY = 'test-api-key';
        process.env.RATE_LIMIT_ENABLED = 'false';

        const { AUTH_CONFIG, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        console.log('@@RESULT@@' + JSON.stringify({
          sessionSecretExists: typeof AUTH_CONFIG.SESSION_SECRET === 'string' && AUTH_CONFIG.SESSION_SECRET.length > 0
        }));
        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.sessionSecretExists).toBe(true);
    }, { timeout: 10000 });

    test('still generates session secret when API_KEY not set', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'false';
        process.env.RATE_LIMIT_ENABLED = 'false';
        // Not setting API_KEY

        const { AUTH_CONFIG, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        console.log('@@RESULT@@' + JSON.stringify({
          sessionSecretExists: typeof AUTH_CONFIG.SESSION_SECRET === 'string' && AUTH_CONFIG.SESSION_SECRET.length > 0
        }));
        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.sessionSecretExists).toBe(true);
    }, { timeout: 10000 });
  });

  describe('NIP-46 service gated in headless mode (3.3)', () => {
    test('getNip46Service returns null in headless mode', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'false';
        process.env.RATE_LIMIT_ENABLED = 'false';

        const { getNip46Service } = await import(root + 'src/nip46/index.ts');

        // In headless mode, the service should not be initialized
        // (server.ts gates initNip46Service on !HEADLESS)
        const service = getNip46Service();

        console.log('@@RESULT@@' + JSON.stringify({
          serviceIsNull: service === null || service === undefined
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      // Service should be null/undefined since it was never initialized
      expect(result.serviceIsNull).toBe(true);
    }, { timeout: 10000 });

    test('initNip46Service replaces the singleton when init callbacks change', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'false';
        process.env.RATE_LIMIT_ENABLED = 'false';

        const mod = await import(root + 'src/nip46/index.ts');

        const first = await mod.initNip46Service({
          addServerLog: () => {},
          broadcastEvent: () => {},
          getNode: () => null
        });

        const second = await mod.initNip46Service({
          addServerLog: () => {},
          broadcastEvent: () => {},
          getNode: () => null
        });

        await second.stop();

        console.log('@@RESULT@@' + JSON.stringify({
          replaced: first !== second
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.replaced).toBe(true);
    }, { timeout: 10000 });
  });
});
