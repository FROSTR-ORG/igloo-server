/**
 * Credential management smoke tests – /api/env.
 *
 * GET returns the current credential state.
 * POST with invalid credentials returns 400.
 * We do NOT update valid credentials here to avoid disrupting co-signer timing.
 */

import { test, expect, request } from '@playwright/test';
import { loadState } from '../state.js';

const state = loadState();
const { baseUrl, sessionId } = state;

test.describe('Env / credentials – /api/env', () => {
  test('GET /api/env returns 401 without auth', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/env');
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('GET /api/env with session returns credential metadata', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.get('/api/env', {
      headers: { 'X-Session-ID': sessionId },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // In DB mode the response should indicate that credentials are present
    expect(body).toHaveProperty('hasCredentials', true);
    await api.dispose();
  });

  test('POST /api/env – invalid GROUP_CRED returns 400', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/env', {
      headers: { 'X-Session-ID': sessionId },
      data: {
        GROUP_CRED: 'not-a-valid-bfgroup-credential',
        SHARE_CRED: state.shareCredentials[0],
        RELAYS: [`ws://127.0.0.1:${state.port}`],
      },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('POST /api/env – invalid SHARE_CRED returns 400', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/env', {
      headers: { 'X-Session-ID': sessionId },
      data: {
        GROUP_CRED: state.groupCredential,
        SHARE_CRED: 'not-a-valid-bfshare-credential',
        RELAYS: [`ws://127.0.0.1:${state.port}`],
      },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('POST /api/env – invalid relay URL returns 400', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/env', {
      headers: { 'X-Session-ID': sessionId },
      data: {
        GROUP_CRED: state.groupCredential,
        SHARE_CRED: state.shareCredentials[0],
        RELAYS: ['not-a-websocket-url'],
      },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('POST /api/env – empty RELAYS returns 400', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/env', {
      headers: { 'X-Session-ID': sessionId },
      data: {
        GROUP_CRED: state.groupCredential,
        SHARE_CRED: state.shareCredentials[0],
        RELAYS: [],
      },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('POST /api/env without auth returns 401', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/env', {
      data: { GROUP_CRED: state.groupCredential, SHARE_CRED: state.shareCredentials[0] },
    });
    expect(res.status()).toBe(401);
    await api.dispose();
  });
});
