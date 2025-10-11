import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner.ts';

describe('NIP-46 routes', () => {
  test('route unavailable in headless mode', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';

      const { handleNip46Route } = await import(root + 'src/routes/nip46.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
        updateNode: () => {},
      };

      const req = new Request('http://localhost/api/nip46/transport');
      const res = await handleNip46Route(req, new URL(req.url), context, { authenticated: true, userId: 1 });
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(404);
    expect(result.body?.error).toContain('NIP-46 persistence unavailable');
  });
});
