import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('WebSocket Origin policy', () => {
  test('production requires explicit ALLOWED_ORIGINS and matching Origin', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = 'https://app.example.com, https://admin.example.com';
      const { isWebSocketOriginAllowed } = await import(root + 'src/routes/utils.ts');

      const okReq = new Request('http://localhost/api/events', { headers: { origin: 'https://app.example.com' } });
      const badReq = new Request('http://localhost/api/events', { headers: { origin: 'https://evil.example' } });
      const missing = new Request('http://localhost/api/events');

      const ok = isWebSocketOriginAllowed(okReq);
      const bad = isWebSocketOriginAllowed(badReq);
      const miss = isWebSocketOriginAllowed(missing);

      console.log('@@RESULT@@' + JSON.stringify({ ok, bad, miss }));
      process.exit(0);
    `;
    const result = runRouteScript(script);
    expect(result.ok.allowed).toBe(true);
    expect(result.bad.allowed).toBe(false);
    // Missing Origin is allowed to support non-browser WS clients
    expect(result.miss.allowed).toBe(true);
  });

  test('production rejects wildcard ALLOWED_ORIGINS', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'production';
      process.env.ALLOWED_ORIGINS = '*';
      const { isWebSocketOriginAllowed } = await import(root + 'src/routes/utils.ts');
      const req = new Request('http://localhost/api/events', { headers: { origin: 'https://app.example.com' } });
      const out = isWebSocketOriginAllowed(req);
      console.log('@@RESULT@@' + JSON.stringify(out));
      process.exit(0);
    `;
    const out = runRouteScript(script);
    expect(out.allowed).toBe(false);
  });

  test('non-production tolerates missing ALLOWED_ORIGINS and Origin', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      delete process.env.ALLOWED_ORIGINS;
      const { isWebSocketOriginAllowed } = await import(root + 'src/routes/utils.ts');
      const req = new Request('http://localhost/api/events');
      const out = isWebSocketOriginAllowed(req);
      console.log('@@RESULT@@' + JSON.stringify(out));
      process.exit(0);
    `;
    const out = runRouteScript(script);
    expect(out.allowed).toBe(true);
  });
});
