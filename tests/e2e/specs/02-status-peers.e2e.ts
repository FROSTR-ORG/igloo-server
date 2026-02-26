/**
 * Status and peers smoke tests.
 */

import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loadState } from '../state.js';
import type { SmokeTestState } from '../state.js';

let state: SmokeTestState;
let baseUrl = '';
let sessionId = '';
let groupPubkeyHex = '';

async function withApi(fn: (api: APIRequestContext) => Promise<void>): Promise<void> {
  const api = await request.newContext({ baseURL: baseUrl });
  try {
    await fn(api);
  } finally {
    await api.dispose();
  }
}

test.beforeAll(() => {
  state = loadState();
  baseUrl = state.baseUrl;
  sessionId = state.sessionId;
  groupPubkeyHex = state.groupPubkeyHex;
});

test.describe('Status – /api/status', () => {
  test('GET /api/status is publicly accessible without auth', async () => {
    // /api/status intentionally allows unauthenticated health checks
    await withApi(async (api) => {
      const res = await api.get('/api/status');
      expect(res.status()).toBe(200);
    });
  });

  test('GET /api/status returns 200 with node info', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/status', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);

      const body = await res.json();
      expect(body.serverRunning).toBe(true);
      expect(body.nodeActive).toBe(true);
      expect(body).toHaveProperty('health');
      expect(body).toHaveProperty('relayCount');
      expect(body).toHaveProperty('timestamp');
    });
  });

  test('GET /api/status has valid health object', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/status', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.health).toHaveProperty('isConnected');
      expect(typeof body.health.isConnected).toBe('boolean');
      expect(body.health).toHaveProperty('consecutiveConnectivityFailures');
    });
  });
});

test.describe('Peers – /api/peers', () => {
  test('GET /api/peers returns 401 without auth', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/peers');
      expect(res.status()).toBe(401);
    });
  });

  test('GET /api/peers returns peer list', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/peers', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('peers');
      expect(Array.isArray(body.peers)).toBe(true);
      // 2-of-2 keyset: 1 remote peer (self filtered out)
      expect(body.peers.length).toBeGreaterThanOrEqual(1);
      expect(typeof body.total).toBe('number');
      expect(typeof body.online).toBe('number');
    });
  });

  test('GET /api/peers/group returns group pubkey', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/peers/group', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('pubkey');
      expect(body.pubkey).toBe(groupPubkeyHex);
      expect(typeof body.threshold).toBe('number');
    });
  });

  test('GET /api/peers/self returns own share pubkey', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/peers/self', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('pubkey');
      expect(typeof body.pubkey).toBe('string');
    });
  });
});
