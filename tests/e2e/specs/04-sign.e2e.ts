/**
 * Signing smoke tests – requires the igloo-cli co-signer launched in global setup.
 *
 * sign timeout: 5 s (FROSTR_SIGN_TIMEOUT env set in global-setup for smoke runs).
 * Test timeout overridden to 30 s to accommodate the signing round-trip.
 */

import { test, expect, request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loadState } from '../state.js';
import type { SmokeTestState } from '../state.js';

type SignEventPayload = {
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
};

const state: SmokeTestState = loadState();
const { baseUrl, sessionId, groupPubkeyHex } = state;

// Valid 32-byte hex event IDs for signing
const EVENT_ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EVENT_ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

async function withApi(fn: (api: APIRequestContext) => Promise<void>): Promise<void> {
  const api = await request.newContext({ baseURL: baseUrl });
  try {
    await fn(api);
  } finally {
    await api.dispose();
  }
}

test.describe('Sign – /api/sign', () => {
  // Explicit per-suite timeout for signing flows; global timeout is also 30_000.
  test.setTimeout(30_000);

  test('returns 401 without auth', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/sign', {
        data: { message: EVENT_ID_A },
      });
      expect(res.status()).toBe(401);
    });
  });

  test('returns 400 for invalid (non-hex) message', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/sign', {
        headers: { 'X-Session-ID': sessionId },
        data: { message: 'not-hex' },
      });
      expect(res.status()).toBe(400);
    });
  });

  test('returns 400 for message shorter than 32 bytes', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/sign', {
        headers: { 'X-Session-ID': sessionId },
        data: { message: 'deadbeef' }, // only 4 bytes
      });
      expect(res.status()).toBe(400);
    });
  });

  test('returns 400 for missing body', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/sign', {
        headers: { 'X-Session-ID': sessionId },
        data: {},
      });
      expect(res.status()).toBe(400);
    });
  });

  test('signs a 32-byte hex message and returns signature', async () => {
    await withApi(async (api) => {
      const res = await api.post('/api/sign', {
        headers: { 'X-Session-ID': sessionId },
        data: { message: EVENT_ID_A },
      });
      expect(res.status()).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('id', EVENT_ID_A);
      expect(body).toHaveProperty('signature');
      expect(typeof body.signature).toBe('string');
      // Schnorr signature = 64 bytes = 128 hex chars
      expect(body.signature).toMatch(/^[0-9a-f]{128}$/i);
    });
  });

  test('signs a full event object and returns signature', async () => {
    await withApi(async (api) => {
      // Use the group pubkey as the event author pubkey
      const event: SignEventPayload = {
        pubkey: groupPubkeyHex,
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        content: 'igloo smoke test',
        tags: [],
      };
      const res = await api.post('/api/sign', {
        headers: { 'X-Session-ID': sessionId },
        data: { event },
      });
      expect(res.status()).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('signature');
      expect(body.signature).toMatch(/^[0-9a-f]{128}$/i);
    });
  });

  test('signing works with API key auth', async () => {
    test.skip(!state.apiKey, 'No API key available');
    await withApi(async (api) => {
      const res = await api.post('/api/sign', {
        headers: { 'X-API-Key': state.apiKey! },
        data: { message: EVENT_ID_B },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.signature).toMatch(/^[0-9a-f]{128}$/i);
    });
  });

  test('event with invalid pubkey returns 400', async () => {
    await withApi(async (api) => {
      const invalidEvent: SignEventPayload = {
        pubkey: 'not-64-hex',
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        content: 'bad',
        tags: [],
      };
      const res = await api.post('/api/sign', {
        headers: { 'X-Session-ID': sessionId },
        data: {
          event: invalidEvent,
        },
      });
      expect(res.status()).toBe(400);
    });
  });
});
