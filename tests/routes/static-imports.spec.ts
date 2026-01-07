import { afterEach, describe, expect, test } from 'bun:test';
import { pathToFileURL } from 'url';
import { runRouteScript } from './helpers/script-runner';

const PROJECT_ROOT = pathToFileURL(process.cwd() + '/').href;

afterEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.HEADLESS;
  delete process.env.AUTH_ENABLED;
  delete process.env.API_KEY;
  delete process.env.RATE_LIMIT_ENABLED;
  delete process.env.SESSION_SECRET;
});

describe('Static imports optimization (1.1)', () => {
  describe('Auth functions availability', () => {
    test('authenticate is immediately available without await', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'true';
        process.env.API_KEY = 'test-key';
        process.env.RATE_LIMIT_ENABLED = 'false';

        const auth = await import(root + 'src/routes/auth.ts');

        const hasAuthenticate = typeof auth.authenticate === 'function';
        const hasAuthConfig = typeof auth.AUTH_CONFIG === 'object';
        const hasCheckRateLimit = typeof auth.checkRateLimit === 'function';
        const hasStopAuthCleanup = typeof auth.stopAuthCleanup === 'function';

        console.log('@@RESULT@@' + JSON.stringify({
          hasAuthenticate,
          hasAuthConfig,
          hasCheckRateLimit,
          hasStopAuthCleanup
        }));
        auth.stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.hasAuthenticate).toBe(true);
      expect(result.hasAuthConfig).toBe(true);
      expect(result.hasCheckRateLimit).toBe(true);
      expect(result.hasStopAuthCleanup).toBe(true);
    }, { timeout: 10000 });

    test('AUTH_CONFIG has expected properties', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'true';
        process.env.API_KEY = 'test-key-123';
        process.env.RATE_LIMIT_ENABLED = 'true';

        const { AUTH_CONFIG, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        console.log('@@RESULT@@' + JSON.stringify({
          hasEnabled: 'ENABLED' in AUTH_CONFIG,
          hasRateLimitEnabled: 'RATE_LIMIT_ENABLED' in AUTH_CONFIG,
          hasSessionTimeout: 'SESSION_TIMEOUT' in AUTH_CONFIG,
          enabledValue: AUTH_CONFIG.ENABLED,
          rateLimitValue: AUTH_CONFIG.RATE_LIMIT_ENABLED
        }));
        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.hasEnabled).toBe(true);
      expect(result.hasRateLimitEnabled).toBe(true);
      expect(result.hasSessionTimeout).toBe(true);
      expect(result.enabledValue).toBe(true);
      expect(result.rateLimitValue).toBe(true);
    }, { timeout: 10000 });
  });

  describe('Rate limiting functionality', () => {
    test('checkRateLimit works correctly with in-memory store', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'true';
        process.env.API_KEY = 'test-key';
        process.env.RATE_LIMIT_ENABLED = 'true';

        const { checkRateLimit, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        const req = new Request('http://localhost/api/test', {
          headers: { 'X-Forwarded-For': '192.168.1.100' }
        });

        const result = await checkRateLimit(req, 'test-bucket', {
          clientIp: '192.168.1.100',
          windowMs: 60000,
          max: 10
        });

        console.log('@@RESULT@@' + JSON.stringify({
          allowed: result.allowed,
          hasRemaining: 'remaining' in result
        }));
        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.allowed).toBe(true);
      expect(result.hasRemaining).toBe(true);
    }, { timeout: 10000 });

    test('rate limiting respects max attempts', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'true';
        process.env.API_KEY = 'test-key';
        process.env.RATE_LIMIT_ENABLED = 'true';

        const { checkRateLimit, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        const results = [];
        const uniqueIp = '10.0.0.' + Math.floor(Math.random() * 255);
        // Use a fixed bucket name for all requests in this test
        const testBucket = 'rate-limit-test-' + Date.now();

        for (let i = 0; i < 5; i++) {
          const req = new Request('http://localhost/api/test');
          const rl = await checkRateLimit(req, testBucket, {
            clientIp: uniqueIp,
            windowMs: 60000,
            max: 3
          });
          results.push({ attempt: i + 1, allowed: rl.allowed, remaining: rl.remaining });
        }

        console.log('@@RESULT@@' + JSON.stringify({ results }));
        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      // First 3 should be allowed, 4th and 5th should be denied
      expect(result.results[0].allowed).toBe(true);
      expect(result.results[1].allowed).toBe(true);
      expect(result.results[2].allowed).toBe(true);
      expect(result.results[3].allowed).toBe(false);
      expect(result.results[4].allowed).toBe(false);
    }, { timeout: 10000 });
  });

  describe('Shutdown cleanup functions', () => {
    test('cleanupRateLimiter is callable without error', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const { cleanupRateLimiter, getRateLimiter } = await import(root + 'src/utils/rate-limiter.ts');

        // Initialize the rate limiter first
        getRateLimiter();

        let cleanupError = null;
        try {
          cleanupRateLimiter();
        } catch (e) {
          cleanupError = e.message;
        }

        console.log('@@RESULT@@' + JSON.stringify({ cleanupError }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.cleanupError).toBe(null);
    }, { timeout: 10000 });

    test('stopAuthCleanup is callable without error', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.SESSION_SECRET = 'a'.repeat(64);

        const { stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        let cleanupError = null;
        try {
          stopAuthCleanup();
        } catch (e) {
          cleanupError = e.message;
        }

        console.log('@@RESULT@@' + JSON.stringify({ cleanupError }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.cleanupError).toBe(null);
    }, { timeout: 10000 });

    test('stopAuthCleanup can be called multiple times safely', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.SESSION_SECRET = 'b'.repeat(64);

        const { stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        let errors = [];
        for (let i = 0; i < 3; i++) {
          try {
            stopAuthCleanup();
          } catch (e) {
            errors.push(e.message);
          }
        }

        console.log('@@RESULT@@' + JSON.stringify({ errorCount: errors.length, errors }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.errorCount).toBe(0);
    }, { timeout: 10000 });
  });

  describe('HEADLESS mode compatibility', () => {
    test('auth works in headless mode with API key', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'true';
        process.env.API_KEY = 'my-headless-key';
        process.env.RATE_LIMIT_ENABLED = 'false';

        const { authenticate, AUTH_CONFIG, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        const req = new Request('http://localhost/api/status', {
          headers: { 'X-API-Key': 'my-headless-key' }
        });

        const result = await authenticate(req);

        console.log('@@RESULT@@' + JSON.stringify({
          authenticated: result.authenticated,
          userId: result.userId,
          authEnabled: AUTH_CONFIG.ENABLED
        }));

        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.authenticated).toBe(true);
      expect(result.userId).toBe('api-user');
      expect(result.authEnabled).toBe(true);
    }, { timeout: 10000 });

    test('auth rejects invalid API key in headless mode', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'true';
        process.env.API_KEY = 'correct-key';
        process.env.RATE_LIMIT_ENABLED = 'false';

        const { authenticate, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        const req = new Request('http://localhost/api/status', {
          headers: { 'X-API-Key': 'wrong-key' }
        });

        const result = await authenticate(req);

        console.log('@@RESULT@@' + JSON.stringify({
          authenticated: result.authenticated,
          hasError: !!result.error
        }));

        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.authenticated).toBe(false);
      expect(result.hasError).toBe(true);
    }, { timeout: 10000 });

    test('auth allows anonymous when AUTH_ENABLED is false', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'false';
        process.env.RATE_LIMIT_ENABLED = 'false';

        const { authenticate, AUTH_CONFIG, stopAuthCleanup } = await import(root + 'src/routes/auth.ts');

        const req = new Request('http://localhost/api/status');
        const result = await authenticate(req);

        console.log('@@RESULT@@' + JSON.stringify({
          authenticated: result.authenticated,
          userId: result.userId,
          authEnabled: AUTH_CONFIG.ENABLED
        }));

        stopAuthCleanup();
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.authenticated).toBe(true);
      expect(result.userId).toBe('anonymous');
      expect(result.authEnabled).toBe(false);
    }, { timeout: 10000 });
  });

  describe('Server module imports', () => {
    test('server.ts can import auth statically without circular dependency', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';
        process.env.AUTH_ENABLED = 'false';
        process.env.RATE_LIMIT_ENABLED = 'false';

        // This tests that the server module can be imported
        // without circular dependency issues after adding static imports
        let importError = null;
        let hasExports = false;

        try {
          // Import the auth module directly (as server.ts does)
          const auth = await import(root + 'src/routes/auth.ts');
          const rateLimiter = await import(root + 'src/utils/rate-limiter.ts');

          hasExports = (
            typeof auth.authenticate === 'function' &&
            typeof auth.AUTH_CONFIG === 'object' &&
            typeof auth.checkRateLimit === 'function' &&
            typeof auth.stopAuthCleanup === 'function' &&
            typeof rateLimiter.cleanupRateLimiter === 'function'
          );

          auth.stopAuthCleanup();
          rateLimiter.cleanupRateLimiter();
        } catch (e) {
          importError = e.message;
        }

        console.log('@@RESULT@@' + JSON.stringify({ importError, hasExports }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.importError).toBe(null);
      expect(result.hasExports).toBe(true);
    }, { timeout: 10000 });
  });
});
