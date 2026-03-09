import { describe, expect, test } from 'bun:test';
import { pathToFileURL } from 'url';
import { runRouteScript } from './helpers/script-runner';

const PROJECT_ROOT = pathToFileURL(process.cwd() + '/').href;

describe('/api/update route', () => {
  test('uses package.json version and explicit no-store headers when disabled', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';

      const { handleUpdateRoute } = await import(root + 'src/routes/update.ts');
      const req = new Request('http://localhost:8002/api/update');
      const res = await handleUpdateRoute(req, new URL(req.url), {});
      const body = await res.json();

      console.log('@@RESULT@@' + JSON.stringify({
        status: res.status,
        cacheControl: res.headers.get('Cache-Control'),
        currentVersion: body.currentVersion,
        enabled: body.enabled
      }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(200);
    expect(result.cacheControl).toBe('no-store, no-cache, must-revalidate, private');
    expect(result.currentVersion).toBe('1.2.0');
    expect(result.enabled).toBe(false);
  }, { timeout: 10000 });

  test('prefers APP_VERSION override when present', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.APP_VERSION = ' 9.9.9 ';

      const { handleUpdateRoute } = await import(root + 'src/routes/update.ts');
      const req = new Request('http://localhost:8002/api/update');
      const res = await handleUpdateRoute(req, new URL(req.url), {});
      const body = await res.json();

      console.log('@@RESULT@@' + JSON.stringify({
        currentVersion: body.currentVersion
      }));
      process.exit(0);
    `;

    const result = runRouteScript(script, { APP_VERSION: ' 9.9.9 ' });
    expect(result.currentVersion).toBe('9.9.9');
  }, { timeout: 10000 });
});
