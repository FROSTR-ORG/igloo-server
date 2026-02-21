/**
 * UI event-log smoke tests.
 * Signing operations performed in 04-sign.spec.ts will have produced log entries.
 */

import { test, expect, request } from '@playwright/test';
import { loadState } from '../state.js';

const state = loadState();
const { baseUrl, sessionId } = state;

test.describe('Event log – /api/event-log', () => {
  test('returns 401 without auth', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/event-log');
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('GET /api/event-log returns entries array', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/event-log', {
      headers: { 'X-Session-ID': sessionId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
    await api.dispose();
  });

  test('entries have expected shape', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/event-log', {
      headers: { 'X-Session-ID': sessionId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // If there are entries from sign tests, validate their shape
    if (body.entries.length > 0) {
      const entry = body.entries[0];
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('message');
      expect(entry).toHaveProperty('timestamp');
    }
    await api.dispose();
  });

  test('pagination params are accepted', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/event-log?limit=5', {
      headers: { 'X-Session-ID': sessionId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeLessThanOrEqual(5);
    await api.dispose();
  });

  test('GET /api/event-log/export returns NDJSON', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
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
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    await api.dispose();
  });

  test('export without auth returns 401', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/event-log/export');
    expect(res.status()).toBe(401);
    await api.dispose();
  });
});
