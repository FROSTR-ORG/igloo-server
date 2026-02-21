/**
 * Status and peers smoke tests.
 */

import { test, expect, request } from '@playwright/test';
import { loadState } from '../state.js';

const state = loadState();
const { baseUrl, sessionId } = state;

test.describe('Status – /api/status', () => {
  test('GET /api/status is publicly accessible without auth', async () => {
    // /api/status intentionally allows unauthenticated health checks
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/status');
    expect(res.status()).toBe(200);
    await api.dispose();
  });

  test('GET /api/status returns 200 with node info', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
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
    await api.dispose();
  });

  test('GET /api/status has valid health object', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/status', {
      headers: { 'X-Session-ID': sessionId },
    });
    const body = await res.json();
    expect(body.health).toHaveProperty('isConnected');
    expect(typeof body.health.isConnected).toBe('boolean');
    expect(body.health).toHaveProperty('consecutiveConnectivityFailures');
    await api.dispose();
  });
});

test.describe('Peers – /api/peers', () => {
  test('GET /api/peers returns 401 without auth', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/peers');
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('GET /api/peers returns peer list', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/peers', {
      headers: { 'X-Session-ID': sessionId },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('peers');
    expect(Array.isArray(body.peers)).toBe(true);
    // 2-of-3 keyset: 2 remote peers (self filtered out)
    expect(body.peers.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.total).toBe('number');
    expect(typeof body.online).toBe('number');
    await api.dispose();
  });

  test('GET /api/peers/group returns group pubkey', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/peers/group', {
      headers: { 'X-Session-ID': sessionId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('pubkey');
    expect(body.pubkey).toBe(state.groupPubkeyHex);
    expect(typeof body.threshold).toBe('number');
    await api.dispose();
  });

  test('GET /api/peers/self returns own share pubkey', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/peers/self', {
      headers: { 'X-Session-ID': sessionId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('pubkey');
    expect(typeof body.pubkey).toBe('string');
    await api.dispose();
  });
});
