import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.AUTH_DERIVED_KEY_MAX_REHYDRATIONS = '2';
process.env.AUTH_ENABLED = 'true';

let auth: typeof import('../../src/routes/auth.ts');

beforeAll(async () => {
  auth = await import('../../src/routes/auth.ts');
});

afterAll(() => {
  auth.stopAuthCleanup();
});

function createTestSession(): string {
  const sessionId = auth.createSession(
    1,
    '127.0.0.1',
    'correct horse battery staple',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  if (!sessionId) {
    throw new Error('Expected session to be created for testing');
  }
  return sessionId;
}

describe('rehydrateSessionDerivedKey', () => {
  test('enforces configurable rehydration quota', () => {
    const sessionId = createTestSession();

    const first = auth.rehydrateSessionDerivedKey(sessionId);
    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).not.toBeUndefined();
    expect(first?.length).toBe(32);

    const second = auth.rehydrateSessionDerivedKey(sessionId);
    expect(second).toBeInstanceOf(Uint8Array);
    expect(second?.length).toBe(32);

    const third = auth.rehydrateSessionDerivedKey(sessionId);
    expect(third).toBeUndefined();

    const vaultValue = auth.vaultGetOnce(sessionId);
    expect(vaultValue).toBeUndefined();

    const logoutReq = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { 'x-session-id': sessionId }
    });
    auth.handleLogout(logoutReq);
  });
});
