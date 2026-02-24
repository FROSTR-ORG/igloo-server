import { describe, expect, it } from 'bun:test';
import { getValidRelays, normalizeRelayListForEcho } from './utils.js';

function withEnv(key: string, value: string, fn: () => void): void {
  const previous = process.env[key];
  process.env[key] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

describe('getValidRelays', () => {
  it('returns default relay when fallback is enabled and input is empty', () => {
    expect(getValidRelays()).toEqual(['wss://relay.primal.net']);
  });

  it('returns empty array when fallback is disabled and input is empty', () => {
    expect(getValidRelays(undefined, { fallbackToDefault: false })).toEqual([]);
  });

  it('parses explicit relays when fallback is disabled', () => {
    const relays = getValidRelays('["wss://relay.damus.io","wss://relay.primal.net"]', {
      fallbackToDefault: false
    });
    expect(relays).toEqual(['wss://relay.damus.io', 'wss://relay.primal.net']);
  });

  it('filters invalid relays and returns empty when fallback disabled', () => {
    expect(getValidRelays('["not-a-relay","ftp://example.com"]', { fallbackToDefault: false })).toEqual([]);
  });

  it('filters IPv6 localhost relay when localhost relays are disallowed', () => {
    withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://[::1]:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });
  
  it('filters 127.0.0.0/8 localhost relay range when localhost relays are disallowed', () => {
    withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://127.0.0.2:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters localhost hostname relay when localhost relays are disallowed', () => {
    withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://localhost:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });
});

describe('normalizeRelayListForEcho', () => {
  it('filters localhost relays when localhost relays are disallowed', () => {
    withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(
        normalizeRelayListForEcho([
          'ws://127.0.0.1:18002',
          'ws://localhost:18002',
          'wss://relay.example.com'
        ])
      ).toEqual(['wss://relay.example.com']);
    });
  });

  it('keeps localhost relay in echo list when explicitly allowed', () => {
    withEnv('ALLOW_LOCALHOST_RELAY', 'true', () => {
      expect(normalizeRelayListForEcho(['ws://127.0.0.1:18002'])).toEqual(['ws://127.0.0.1:18002']);
    });
  });

  it('keeps localhost hostname in echo list when explicitly allowed', () => {
    withEnv('ALLOW_LOCALHOST_RELAY', 'true', () => {
      expect(normalizeRelayListForEcho(['ws://localhost:18002'])).toEqual(['ws://localhost:18002']);
    });
  });
});
