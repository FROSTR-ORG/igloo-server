import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('rate limiter lifecycle', () => {
  test('starts cleanup when running headless with the in-memory fallback', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';

      const mod = await import(root + 'src/utils/rate-limiter.ts?headless_cleanup');
      const limiter = new mod.PersistentRateLimiter();
      const cleanupStarted = Boolean(limiter.cleanupTimer);
      limiter.stopCleanup();

      console.log('@@RESULT@@' + JSON.stringify({ cleanupStarted }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.cleanupStarted).toBe(true);
  });
});
