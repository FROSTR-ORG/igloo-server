/**
 * NIP-44 and NIP-04 encrypt/decrypt smoke tests.
 *
 * We use the group pubkey as the "peer" for ECDH operations – the server
 * holds share-0 so it can derive the shared secret with any co-participant.
 */

import { test, expect, request } from '@playwright/test';
import { loadState } from '../state.js';

const state = loadState();
const { baseUrl, sessionId, groupPubkeyHex } = state;

const PLAINTEXT = 'Hello from igloo smoke test!';

// ─── NIP-44 ──────────────────────────────────────────────────────────────────

test.describe('NIP-44 – /api/nip44', () => {
  test('returns 401 without auth', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/nip44/encrypt', {
      data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
    });
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('encrypt returns ciphertext', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/nip44/encrypt', {
      headers: { 'X-Session-ID': sessionId },
      data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('result');
    expect(typeof body.result).toBe('string');
    expect(body.result.length).toBeGreaterThan(0);
    await api.dispose();
  });

  test('encrypt then decrypt round-trips plaintext', async () => {
    const api = await request.newContext({ baseURL: baseUrl });

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

    await api.dispose();
  });

  test('invalid peer_pubkey returns 400', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/nip44/encrypt', {
      headers: { 'X-Session-ID': sessionId },
      data: { peer_pubkey: 'not-a-valid-pubkey', content: PLAINTEXT },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('missing content returns 400', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/nip44/encrypt', {
      headers: { 'X-Session-ID': sessionId },
      data: { peer_pubkey: groupPubkeyHex },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });
});

// ─── NIP-04 ──────────────────────────────────────────────────────────────────

test.describe('NIP-04 – /api/nip04', () => {
  test('returns 401 without auth', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/nip04/encrypt', {
      data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
    });
    expect(res.status()).toBe(401);
    await api.dispose();
  });

  test('encrypt returns ciphertext with IV suffix', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/nip04/encrypt', {
      headers: { 'X-Session-ID': sessionId },
      data: { peer_pubkey: groupPubkeyHex, content: PLAINTEXT },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('result');
    // NIP-04 ciphertext has the form  <base64>?iv=<base64>
    expect(body.result).toMatch(/\?iv=/);
    await api.dispose();
  });

  test('encrypt then decrypt round-trips plaintext', async () => {
    const api = await request.newContext({ baseURL: baseUrl });

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

    await api.dispose();
  });

  test('invalid peer_pubkey returns 400', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/nip04/encrypt', {
      headers: { 'X-Session-ID': sessionId },
      data: { peer_pubkey: 'not-a-valid-pubkey', content: PLAINTEXT },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });

  test('missing content returns 400', async () => {
    const api = await request.newContext({ baseURL: baseUrl });
    const res = await api.post('/api/nip04/encrypt', {
      headers: { 'X-Session-ID': sessionId },
      data: { peer_pubkey: groupPubkeyHex },
    });
    expect(res.status()).toBe(400);
    await api.dispose();
  });
});
