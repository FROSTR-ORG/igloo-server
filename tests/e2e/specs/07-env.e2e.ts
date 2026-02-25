/**
 * Credential management smoke tests – /api/env.
 *
 * GET returns the current credential state.
 * POST with invalid credentials returns 400.
 * We do NOT update valid credentials here to avoid disrupting co-signer timing.
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

test.describe('Env / credentials – /api/env', () => {
  test('GET /api/env returns 401 without auth', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/env');
      expect(res.status()).toBe(401);
    });
  });

  test('GET /api/env with session returns credential metadata', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/env', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      // In DB mode the response should indicate that credentials are present
      expect(body).toHaveProperty('hasCredentials', true);
    });
  });

  test('POST /api/env – invalid GROUP_CRED returns 400', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/env', {
        headers: { 'X-Session-ID': sessionId },
        data: {
          GROUP_CRED: 'not-a-valid-bfgroup-credential',
          SHARE_CRED: state.shareCredentials[0],
          RELAYS: [`ws://127.0.0.1:${state.port}`],
        },
      });
      expect(res.status()).toBe(400);
    });
  });

  test('POST /api/env – invalid SHARE_CRED returns 400', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/env', {
        headers: { 'X-Session-ID': sessionId },
        data: {
          GROUP_CRED: state.groupCredential,
          SHARE_CRED: 'not-a-valid-bfshare-credential',
          RELAYS: [`ws://127.0.0.1:${state.port}`],
        },
      });
      expect(res.status()).toBe(400);
    });
  });

  test('POST /api/env – invalid relay URL returns 400', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/env', {
        headers: { 'X-Session-ID': sessionId },
        data: {
          GROUP_CRED: state.groupCredential,
          SHARE_CRED: state.shareCredentials[0],
          RELAYS: ['not-a-websocket-url'],
        },
      });
      expect(res.status()).toBe(400);
    });
  });

  test('POST /api/env – empty RELAYS returns 400', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/env', {
        headers: { 'X-Session-ID': sessionId },
        data: {
          GROUP_CRED: state.groupCredential,
          SHARE_CRED: state.shareCredentials[0],
          RELAYS: [],
        },
      });
      expect(res.status()).toBe(400);
    });
  });

  test('POST /api/env without auth returns 401', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/env', {
        data: { GROUP_CRED: state.groupCredential, SHARE_CRED: state.shareCredentials[0] },
      });
      expect(res.status()).toBe(401);
    });
  });
});
