import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('Event log routes', () => {
  test('route unavailable in headless mode', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';

      const { handleEventLogRoute } = await import(root + 'src/routes/event-log.ts');
      const context = {
        node: null,
        addServerLog: () => {},
        broadcastEvent: () => {},
        peerStatuses: new Map(),
        eventStreams: new Set(),
        restartState: { blockedByCredentials: false },
      };

      const req = new Request('http://localhost/api/event-log?limit=1');
      const res = await handleEventLogRoute(req, new URL(req.url), context, { authenticated: true, userId: 1 });
      const body = await res.json();
      console.log('@@RESULT@@' + JSON.stringify({ status: res.status, body }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.status).toBe(404);
    expect(result.body?.error).toContain('headless');
  });
});

