/**
 * Admin endpoint smoke tests:
 *   - API key creation, listing, revocation
 *   - User listing, whoami
 */

import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loadState } from '../state.js';

const state = loadState();
const { baseUrl, sessionId, adminUsername } = state;

async function withApi(fn: (api: APIRequestContext) => Promise<void>): Promise<void> {
  const api = await request.newContext({ baseURL: baseUrl });
  try {
    await fn(api);
  } finally {
    await api.dispose();
  }
}

test.describe('Admin – API keys', () => {
  test('GET /api/admin/api-keys returns list', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/admin/api-keys', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('apiKeys');
      expect(Array.isArray(body.apiKeys)).toBe(true);
      // At minimum the key created in global setup should be here
      expect(body.apiKeys.length).toBeGreaterThanOrEqual(1);
    });
  });

  test('POST /api/admin/api-keys creates a new key', async () => {
    await withApi(async (api) => {
      let createdKeyId: string | number | null = null;
      try {
        const res = await api.post('/api/admin/api-keys', {
          headers: { 'X-Session-ID': sessionId },
          data: { label: `temp-test-key-${Date.now()}` },
        });
        expect(res.status()).toBe(201);
        const body = await res.json();
        expect(body).toHaveProperty('apiKey');
        expect(body.apiKey).toHaveProperty('token');
        expect(typeof body.apiKey.token).toBe('string');
        expect(body.apiKey.token.length).toBeGreaterThan(20);
        expect(body.apiKey).toHaveProperty('id');
        createdKeyId = body.apiKey.id;
      } finally {
        if (createdKeyId !== null) {
          await api.post('/api/admin/api-keys/revoke', {
            headers: { 'X-Session-ID': sessionId },
            data: { apiKeyId: createdKeyId, reason: 'smoke-test cleanup' },
          }).catch(() => null);
        }
      }
    });
  });

  test('new API key can authenticate', async () => {
    await withApi(async (api) => {
      let createdKeyId: string | number | null = null;
      try {
        // Create key
        const createRes = await api.post('/api/admin/api-keys', {
          headers: { 'X-Session-ID': sessionId },
          data: { label: `auth-test-key-${Date.now()}` },
        });
        expect(createRes.status()).toBe(201);
        const { apiKey } = await createRes.json();
        createdKeyId = apiKey.id;

        // Use key to hit an auth-protected route.
        const authRes = await api.get('/api/event-log', {
          headers: { 'X-API-Key': apiKey.token },
        });
        expect(authRes.status()).toBe(200);
      } finally {
        if (createdKeyId !== null) {
          await api.post('/api/admin/api-keys/revoke', {
            headers: { 'X-Session-ID': sessionId },
            data: { apiKeyId: createdKeyId, reason: 'smoke-test cleanup' },
          }).catch(() => null);
        }
      }
    });
  });

  test('revoked API key returns 401', async () => {
    await withApi(async (api) => {
      // Create a fresh key
      const createRes = await api.post('/api/admin/api-keys', {
        headers: { 'X-Session-ID': sessionId },
        data: { label: 'revoke-test-key' },
      });
      expect(createRes.status()).toBe(201);
      const { apiKey } = await createRes.json();

      // Verify it works on an auth-protected endpoint
      const beforeRes = await api.get('/api/event-log', {
        headers: { 'X-API-Key': apiKey.token },
      });
      expect(beforeRes.status()).toBe(200);

      // Revoke it
      const revokeRes = await api.post('/api/admin/api-keys/revoke', {
        headers: { 'X-Session-ID': sessionId },
        data: { apiKeyId: apiKey.id, reason: 'smoke-test cleanup' },
      });
      expect(revokeRes.status()).toBe(200);

      // Now the revoked key should be rejected
      const afterRes = await api.get('/api/event-log', {
        headers: { 'X-API-Key': apiKey.token },
      });
      expect(afterRes.status()).toBe(401);
    });
  });

  test('GET /api/admin/api-keys without auth returns 401', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/admin/api-keys');
      expect(res.status()).toBe(401);
    });
  });
});

test.describe('Admin – Users', () => {
  test('GET /api/admin/users returns user list', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/admin/users', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('users');
      expect(Array.isArray(body.users)).toBe(true);
      expect(body.users.length).toBeGreaterThanOrEqual(1);
      // Our admin user must be in the list
      const found = body.users.some((u: { username: string }) => u.username === adminUsername);
      expect(found).toBe(true);
    });
  });

  test('GET /api/admin/whoami returns admin identity', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/admin/whoami', {
        headers: { 'X-Session-ID': sessionId },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('userId');
    });
  });

  test('GET /api/admin/users without auth returns 401', async () => {
    await withApi(async (api) => {
      const res = await api.get('/api/admin/users');
      expect(res.status()).toBe(401);
    });
  });
});
