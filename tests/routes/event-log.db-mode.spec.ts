import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('Event log routes (DB mode)', () => {
  test('lists entries, paginates by beforeSeq, and filters by types', () => {
    const script = `
      import { mkdtempSync } from 'fs';
      import os from 'os';
      import path from 'path';
      const root = ${JSON.stringify(PROJECT_ROOT)};

      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';

      // Isolate DB for this script (ui-event-log uses the default DB connection).
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'ui-event-log-db-'));
      process.env.DB_PATH = tmp;

      const { appendUiEventLogEntry } = await import(root + 'src/db/ui-event-log.ts');
      const { handleEventLogRoute } = await import(root + 'src/routes/event-log.ts');

      appendUiEventLogEntry({ type: 'info', message: 'one', data: { a: 1 }, timestamp: new Date().toISOString(), id: 'seed1' });
      appendUiEventLogEntry({ type: 'sign', message: 'two', data: { kind: 1 }, timestamp: new Date().toISOString(), id: 'seed2' });
      appendUiEventLogEntry({ type: 'error', message: 'three', data: { ok: false }, timestamp: new Date().toISOString(), id: 'seed3' });

      const context = {} as any;

      const req1 = new Request('http://localhost/api/event-log?limit=2');
      const res1 = await handleEventLogRoute(req1, new URL(req1.url), context, { authenticated: true, userId: 1 });
      const body1 = await res1.json();

      const req2 = new Request('http://localhost/api/event-log?limit=10&beforeSeq=' + body1.nextBeforeSeq);
      const res2 = await handleEventLogRoute(req2, new URL(req2.url), context, { authenticated: true, userId: 1 });
      const body2 = await res2.json();

      const req3 = new Request('http://localhost/api/event-log?limit=10&types=sign');
      const res3 = await handleEventLogRoute(req3, new URL(req3.url), context, { authenticated: true, userId: 1 });
      const body3 = await res3.json();

      console.log('@@RESULT@@' + JSON.stringify({
        status1: res1.status,
        body1,
        status2: res2.status,
        body2,
        status3: res3.status,
        body3,
      }));
      process.exit(0);
    `;

    const out = runRouteScript(script);

    expect(out.status1).toBe(200);
    expect(out.body1?.entries?.length).toBe(2);
    // Descending seq
    expect(Number(out.body1.entries[0].seq)).toBeGreaterThan(Number(out.body1.entries[1].seq));
    expect(typeof out.body1.nextBeforeSeq).toBe('number');

    expect(out.status2).toBe(200);
    expect(out.body2?.entries?.length).toBe(1);

    expect(out.status3).toBe(200);
    expect(out.body3?.entries?.length).toBe(1);
    expect(out.body3.entries[0].type).toBe('sign');
  });

  test('blob endpoint returns payload by hash and 404s for invalid hash', () => {
    const script = `
      import { mkdtempSync } from 'fs';
      import os from 'os';
      import path from 'path';
      const root = ${JSON.stringify(PROJECT_ROOT)};

      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'ui-event-log-blob-'));
      process.env.DB_PATH = tmp;

      const { appendUiEventLogEntry } = await import(root + 'src/db/ui-event-log.ts');
      const { handleEventLogRoute } = await import(root + 'src/routes/event-log.ts');

      const seeded = appendUiEventLogEntry({
        type: 'info',
        message: 'seed',
        data: { hello: 'world' },
        timestamp: new Date().toISOString(),
        id: 'seed'
      });

      const context = {} as any;

      const okReq = new Request('http://localhost/api/event-log/blob/' + seeded.dataHash);
      const okRes = await handleEventLogRoute(okReq, new URL(okReq.url), context, { authenticated: true, userId: 1 });
      const okBody = await okRes.json();

      const badReq = new Request('http://localhost/api/event-log/blob/not-a-hash');
      const badRes = await handleEventLogRoute(badReq, new URL(badReq.url), context, { authenticated: true, userId: 1 });
      const badBody = await badRes.json();

      console.log('@@RESULT@@' + JSON.stringify({
        okStatus: okRes.status,
        okBody,
        badStatus: badRes.status,
        badBody,
      }));
      process.exit(0);
    `;

    const out = runRouteScript(script);
    expect(out.okStatus).toBe(200);
    expect(out.okBody?.hash).toBeDefined();
    expect(out.okBody?.data?.hello).toBe('world');
    expect(typeof out.okBody?.byteLength).toBe('number');

    expect(out.badStatus).toBe(404);
    expect(out.badBody?.error).toContain('Not found');
  });

  test('export endpoint streams NDJSON and respects since/until', () => {
    const script = `
      import { mkdtempSync } from 'fs';
      import os from 'os';
      import path from 'path';
      const root = ${JSON.stringify(PROJECT_ROOT)};

      process.env.NODE_ENV = 'test';
      process.env.HEADLESS = 'false';
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'ui-event-log-export-'));
      process.env.DB_PATH = tmp;

      const { appendUiEventLogEntry } = await import(root + 'src/db/ui-event-log.ts');
      const { handleEventLogRoute } = await import(root + 'src/routes/event-log.ts');

      const e1 = appendUiEventLogEntry({ type: 'info', message: 'one', data: { n: 1 }, timestamp: new Date().toISOString(), id: 'seed1' });
      const e2 = appendUiEventLogEntry({ type: 'sign', message: 'two', data: { n: 2 }, timestamp: new Date().toISOString(), id: 'seed2' });
      const e3 = appendUiEventLogEntry({ type: 'error', message: 'three', data: { n: 3 }, timestamp: new Date().toISOString(), id: 'seed3' });

      const since = e2.seq;
      const until = e3.seq;

      const context = {} as any;
      const req = new Request('http://localhost/api/event-log/export?sinceSeq=' + since + '&untilSeq=' + until);
      const res = await handleEventLogRoute(req, new URL(req.url), context, { authenticated: true, userId: 1 });
      const text = await res.text();
      const lines = text.trim().split('\\n').filter(Boolean);
      const parsed = lines.map(l => JSON.parse(l));

      console.log('@@RESULT@@' + JSON.stringify({
        status: res.status,
        contentType: res.headers.get('Content-Type'),
        count: parsed.length,
        seqs: parsed.map(p => p.seq),
        types: parsed.map(p => p.type),
      }));
      process.exit(0);
    `;

    const out = runRouteScript(script);
    expect(out.status).toBe(200);
    expect(out.contentType).toContain('application/x-ndjson');
    expect(out.count).toBe(2);
    expect(out.seqs[0]).toBeLessThan(out.seqs[1]);
  });
});

