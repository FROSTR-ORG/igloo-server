/**
 * NIP-44 and NIP-04 encrypt/decrypt smoke tests.
 *
 * We use the group pubkey as the "peer" for ECDH operations – the server
 * holds share-0 so it can derive the shared secret with any co-participant.
 */

import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loadState } from '../state.js';
import type { SmokeTestState } from '../state.js';

const state: SmokeTestState = loadState();
const { baseUrl, sessionId, groupPubkeyHex } = state;

const PLAINTEXT = 'Hello from igloo smoke test!';

async function withApi(fn: (api: APIRequestContext) => Promise<void>): Promise<void> {
  const api = await request.newContext({ baseURL: baseUrl });
  try {
    await fn(api);
  } finally {
    await api.dispose();
  }
}

// ─── NIP-44 ──────────────────────────────────────────────────────────────────

test.describe('NIP-44 – /api/nip44', () => {
  test('returns 401 without auth', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/nip44/encrypt', {
        data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
      });
      expect(res.status()).toBe(401);
    });
  });

  test('encrypt returns ciphertext', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/nip44/encrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('result');
      expect(typeof body.result).toBe('string');
      expect(body.result.length).toBeGreaterThan(0);
    });
  });

  test('encrypt then decrypt round-trips plaintext', async () => {
    await withApi(async (api) => {
      const encRes = await api.post('/api/nip44/encrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
      });
      expect(encRes.status()).toBe(200);
      const { result: ciphertext } = await encRes.json();

      const decRes = await api.post('/api/nip44/decrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: groupPubkeyHex, content: ciphertext },
      });
      expect(decRes.status()).toBe(200);
      const { result: plaintext } = await decRes.json();
      expect(plaintext).toBe(PLAINTEXT);
    });
  });

  test('invalid peer_pubkey returns 400', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/nip44/encrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: 'not-a-valid-pubkey', content: PLAINTEXT },
      });
      expect(res.status()).toBe(400);
    });
  });

  test('missing content returns 400', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/nip44/encrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: groupPubkeyHex },
      });
      expect(res.status()).toBe(400);
    });
  });
});

// ─── NIP-04 ──────────────────────────────────────────────────────────────────

test.describe('NIP-04 – /api/nip04', () => {
  test('returns 401 without auth', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/nip04/encrypt', {
        data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
      });
      expect(res.status()).toBe(401);
    });
  });

  test('encrypt returns ciphertext with IV suffix', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/nip04/encrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('result');
      // NIP-04 ciphertext has the form  <base64>?iv=<base64>
      expect(body.result).toMatch(/\?iv=/);
    });
  });

  test('encrypt then decrypt round-trips plaintext', async () => {
    await withApi(async (api) => {
      const encRes = await api.post('/api/nip04/encrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
      });
      expect(encRes.status()).toBe(200);
      const { result: ciphertext } = await encRes.json();

      const decRes = await api.post('/api/nip04/decrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: groupPubkeyHex, content: ciphertext },
      });
      expect(decRes.status()).toBe(200);
      const { result: plaintext } = await decRes.json();
      expect(plaintext).toBe(PLAINTEXT);
    });
  });

  test('invalid peer_pubkey returns 400', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/nip04/encrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: 'not-a-valid-pubkey', content: PLAINTEXT },
      });
      expect(res.status()).toBe(400);
    });
  });

  test('missing content returns 400', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/nip04/encrypt', {
        headers: { 'X-Session-ID': sessionId },
        data: { peer_pubkey: groupPubkeyHex },
      });
      expect(res.status()).toBe(400);
    });
  });
});
