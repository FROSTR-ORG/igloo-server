import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('Rate limit buckets', () => {
  test('env-write bucket limits writes', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'true';
      process.env.AUTH_ENABLED = 'true';
      process.env.API_KEY = 'k';
      process.env.RATE_LIMIT_ENV_WRITE_MAX = '3';
      process.env.RATE_LIMIT_ENV_WRITE_WINDOW = '60';
      const { handleEnvRoute } = await import(root + 'src/routes/env.ts');
      const ctx = { node: null, addServerLog: () => {}, broadcastEvent: () => {}, peerStatuses: new Map(), eventStreams: new Set(), restartState: { blockedByCredentials: false }, updateNode: () => {}, clientIp: '10.0.0.1' };
      async function attempt(i){
        const headers = new Headers({ 'x-api-key': 'k' });
        // Update a non-relay, non-credential key to avoid node restarts
        const req = new Request('http://localhost/api/env', { method: 'POST', headers, body: JSON.stringify({ RATE_LIMIT_MAX: String(100 + i) }) });
        const res = await handleEnvRoute(req, new URL(req.url), ctx, null);
        return res.status;
      }
      const statuses = [];
      for (let i=0;i<4;i++) statuses.push(await attempt(i));
      console.log('@@RESULT@@' + JSON.stringify({ statuses }));
      process.exit(0);
    `;
    const out = runRouteScript(script);
    expect(out.statuses.slice(0,3).every((s:number)=>s<429)).toBe(true);
    expect(out.statuses[3]).toBe(429);
  });

  test('recovery bucket limits attempts', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      process.env.NODE_ENV = 'test';
      process.env.AUTH_ENABLED = 'true';
      process.env.RATE_LIMIT_RECOVERY_MAX = '2';
      process.env.RATE_LIMIT_RECOVERY_WINDOW = '60';
      const { handleRecoveryRoute } = await import(root + 'src/routes/recovery.ts');
      const ctx = { node: null, addServerLog: () => {}, broadcastEvent: () => {}, peerStatuses: new Map(), eventStreams: new Set(), restartState: { blockedByCredentials: false }, clientIp: '10.0.0.2' };
      async function attempt(){
        const req = new Request('http://localhost/api/recover/validate', { method: 'POST', body: JSON.stringify({ type: 'group', credential: 'bogus' }) });
        const res = await handleRecoveryRoute(req, new URL(req.url), ctx, { authenticated: true });
        return res.status;
      }
      const statuses = [await attempt(), await attempt(), await attempt()];
      console.log('@@RESULT@@' + JSON.stringify({ statuses }));
      process.exit(0);
    `;
    const out = runRouteScript(script);
    expect(out.statuses[0]).toBeLessThan(429);
    expect(out.statuses[1]).toBeLessThan(429);
    expect(out.statuses[2]).toBe(429);
  });
});
