/**
 * Auth smoke tests – login, logout, session auth, API-key auth, 401 enforcement.
 */

import { test, expect, request } from '@playwright/test';
import { loadState } from '../state.js';

const state = loadState();
const { baseUrl, sessionId, apiKey, adminUsername, adminPassword } = state;

test.describe('Auth – /api/auth', () => {
  test('GET /api/auth/status returns enabled methods', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/auth/status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
    await api.dispose();
  });

  test('POST /api/auth/login – valid credentials return sessionId', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/auth/login', {
      data: { username: adminUsername, password: adminPassword },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sessionId');
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(8);
    await api.dispose();
  });

  test('POST /api/auth/login – wrong password returns 401', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/auth/login', {
      data: { username: adminUsername, password: 'WrongPass@1' },
    });
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('POST /api/auth/login – unknown user returns 401', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/auth/login', {
      data: { username: 'nobody', password: 'WrongPass@1' },
    });
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('GET /api/peers – no auth returns 401', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/peers');
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('GET /api/status – valid session returns 200', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/status', {
      headers: { 'X-Session-ID': sessionId },
    });
    expect(res.status()).toBe(200);
    await api.dispose();
  });

  test('GET /api/status – valid API key (X-API-Key) returns 200', async () => {
    test.skip(!apiKey, 'No API key available');
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/status', {
      headers: { 'X-API-Key': apiKey! },
    });
    expect(res.status()).toBe(200);
    await api.dispose();
  });

  test('GET /api/status – valid API key (Bearer) returns 200', async () => {
    test.skip(!apiKey, 'No API key available');
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/status', {
      headers: { Authorization: `Bearer ${apiKey!}` },
    });
    expect(res.status()).toBe(200);
    await api.dispose();
  });

  test('GET /api/peers – invalid API key returns 401', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/peers', {
      headers: { 'X-API-Key': 'totally-invalid-key' },
    });
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('POST /api/auth/logout – returns 200 and clears session', async () => {
    // Log in fresh so we don't burn the shared session
    const api = await request.newContext({ baseURL: baseUrl });
    const loginRes = await api.post('/api/auth/login', {
      data: { username: adminUsername, password: adminPassword },
    });
    const { sessionId: tempSession } = await loginRes.json();

    const logoutRes = await api.post('/api/auth/logout', {
      headers: { 'X-Session-ID': tempSession },
    });
    expect(logoutRes.status()).toBe(200);

    // The session should now be invalid
    const afterRes = await api.get('/api/peers', {
      headers: { 'X-Session-ID': tempSession },
    });
    expect(afterRes.status()).toBe(401);
    await api.dispose();
  });
});
