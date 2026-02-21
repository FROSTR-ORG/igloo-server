import { describe, expect, it } from 'bun:test';
import { getValidRelays, normalizeRelayListForEcho } from './utils.js';

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
    const previous = process.env.ALLOW_LOCALHOST_RELAY;
    process.env.ALLOW_LOCALHOST_RELAY = 'false';
    try {
      expect(getValidRelays('["ws://[::1]:18002"]', { fallbackToDefault: false })).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LOCALHOST_RELAY;
      else process.env.ALLOW_LOCALHOST_RELAY = previous;
    }
  });

  it('keeps localhost relay in echo list when explicitly allowed', () => {
    const previous = process.env.ALLOW_LOCALHOST_RELAY;
    process.env.ALLOW_LOCALHOST_RELAY = 'true';
    try {
      expect(normalizeRelayListForEcho(['ws://127.0.0.1:18002'])).toEqual(['ws://127.0.0.1:18002']);
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LOCALHOST_RELAY;
      else process.env.ALLOW_LOCALHOST_RELAY = previous;
    }
  });
});
