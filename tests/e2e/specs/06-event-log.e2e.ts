/**
 * UI event-log smoke tests.
 * This suite seeds its own event-log entries in beforeAll.
 */

import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loadState } from '../state.js';
import type { SmokeTestState } from '../state.js';

const state: SmokeTestState = loadState();
const { baseUrl, sessionId } = state;

async function withApi(fn: (api: APIRequestContext) => Promise<void>): Promise<void> {
  const api = await request.newContext({ baseURL: baseUrl });
  try {
    await fn(api);
  } finally {
    await api.dispose();
  }
}

test.describe('Event log – /api/event-log', () => {
  test.beforeAll(async () => {
    await withApi(async (api) => {
      const runUniqueHex = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padStart(64, 'b').slice(0, 64);
      const seedRes = await api.post('/api/sign', {
        headers: { 'X-Session-ID': sessionId },
        data: { message: runUniqueHex },
      });
      if (!seedRes.ok()) {
        throw new Error(`Failed to seed event log via /api/sign: ${seedRes.status()} ${await seedRes.text()}`);
      }
    });
  });

  test('returns 401 without auth', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/event-log');
      expect(res.status()).toBe(401);
    });
  });

  test('GET /api/event-log returns entries array', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/event-log', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('entries');
      expect(Array.isArray(body.entries)).toBe(true);
    });
  });

  test('entries have expected shape', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/event-log', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThan(0);
      const entry = body.entries[0];
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('message');
      expect(entry).toHaveProperty('timestamp');
    });
  });

  test('pagination params are accepted', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/event-log?limit=5', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.entries.length).toBeLessThanOrEqual(5);
    });
  });

  test('GET /api/event-log/export returns NDJSON', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/event-log/export', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);

      // Export returns newline-delimited JSON (application/x-ndjson), not a JSON array
      const contentType = res.headers()['content-type'] ?? '';
      expect(contentType).toContain('ndjson');

      const text = await res.text();
      // Each non-empty line must be valid JSON
      const lines = text.trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });
  });

  test('export without auth returns 401', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/event-log/export');
      expect(res.status()).toBe(401);
    });
  });
});
