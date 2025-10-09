import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner.ts';

describe('Docs routes', () => {
  test('serves OpenAPI JSON', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';

      const { handleDocsRoute } = await import(root + 'src/routes/docs.ts');
      const req = new Request('http://localhost/api/docs/openapi.json');
      const res = await handleDocsRoute(req, new URL(req.url));
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body: { openapi: body.openapi, info: body.info?.title } }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(200);
    expect(result.body?.openapi).toBeDefined();
  });

  test('serves HTML shell', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};

      const { handleDocsRoute } = await import(root + 'src/routes/docs.ts');
      const req = new Request('http://localhost/api/docs');
      const res = await handleDocsRoute(req, new URL(req.url));
      const text = await res.text();
      const snippet = text.trimStart().slice(0, 14).toLowerCase();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, snippet }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(200);
    expect(result.snippet).toContain('<!doctype html');
  });
});
