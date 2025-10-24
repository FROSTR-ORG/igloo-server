import { describe, expect, it } from 'bun:test';
import { getValidRelays } from './utils.js';

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
});
