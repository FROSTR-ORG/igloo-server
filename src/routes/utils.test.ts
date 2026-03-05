import { describe, expect, it } from 'bun:test';
import { getValidRelays, normalizeRelayListForEcho } from './utils.js';

async function withEnv<T>(key: string, value: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env[key];
  process.env[key] = value;
  try {
    return await fn();
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

  it('filters IPv6 localhost relay when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://[::1]:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });
  
  it('filters 127.0.0.0/8 localhost relay range when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://127.0.0.2:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters localhost hostname relay when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://localhost:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters localhost hostname with trailing dot when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://localhost.:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters localhost subdomain relay when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://relay.localhost:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters IPv4-mapped IPv6 relay when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://[::ffff:127.0.0.1]:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters IPv4-mapped IPv6 hex relay when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://[::ffff:7f00:1]:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters IPv4-mapped IPv6 ::ffff:0: relay when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://[::ffff:0:7f00:1]:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters expanded IPv6 loopback relay when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://[0:0:0:0:0:0:0:1]:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('filters expanded IPv4-mapped IPv6 relay when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(getValidRelays('["ws://[0:0:0:0:0:ffff:7f00:1]:18002"]', { fallbackToDefault: false })).toEqual([]);
    });
  });

  it('keeps localhost relay when localhost relays are explicitly allowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'true', () => {
      expect(getValidRelays('["ws://127.0.0.1:18002"]', { fallbackToDefault: false }))
        .toEqual(['ws://127.0.0.1:18002']);
    });
  });
});

describe('normalizeRelayListForEcho', () => {
  it('filters localhost relays when localhost relays are disallowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'false', () => {
      expect(
        normalizeRelayListForEcho([
          'ws://127.0.0.1:18002',
          'ws://[::1]:18002',
          'ws://[::ffff:127.0.0.1]:18002',
          'ws://localhost:18002',
          'wss://relay.example.com'
        ])
      ).toEqual(['wss://relay.example.com']);
    });
  });

  it('keeps localhost relay in echo list when explicitly allowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'true', () => {
      expect(normalizeRelayListForEcho(['ws://127.0.0.1:18002'])).toEqual(['ws://127.0.0.1:18002']);
    });
  });

  it('keeps localhost hostname in echo list when explicitly allowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'true', () => {
      expect(normalizeRelayListForEcho(['ws://localhost:18002'])).toEqual(['ws://localhost:18002']);
    });
  });

  it('keeps IPv6 localhost relay in echo list when explicitly allowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'true', () => {
      expect(normalizeRelayListForEcho(['ws://[::1]:18002'])).toEqual(['ws://[::1]:18002']);
    });
  });

  it('keeps IPv4-mapped IPv6 relay in echo list when explicitly allowed', async () => {
    await withEnv('ALLOW_LOCALHOST_RELAY', 'true', () => {
      expect(normalizeRelayListForEcho(['ws://[::ffff:127.0.0.1]:18002'])).toEqual(['ws://[::ffff:127.0.0.1]:18002']);
    });
  });
});
