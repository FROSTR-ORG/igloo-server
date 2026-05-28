# Testing Conventions

Patterns and helpers for unit and integration tests in this codebase.

## runRouteScript helper

The `runRouteScript` test helper is the canonical way to exercise internal service methods (including TypeScript `private` methods) without standing up a full HTTP server. It spawns a Bun process that imports the service/module and calls the target method directly. This is useful for unit-testing service internals that are not exposed through public APIs.

Example usage:
```typescript
// tests/routes/nip46.spec.ts
runRouteScript({
  script: `import { Nip46Service } from './src/nip46/service.ts'; ...`,
  // calls service.handleNip44Encrypt or service.handleNip44Decrypt directly
});
```

## NIP-44 interop test fixtures

When writing NIP-44 interoperability tests, use these fixture builders to simulate a standards-compliant peer without exposing real signing credentials:

- `buildNip46PeerFixture` (in `tests/routes/nip46.spec.ts`) — creates an independent peer keypair and uses `@noble/curves/secp256k1` for ECDH plus `nostr-tools` as the NIP-44 oracle.
- `buildCrossSurfaceFixture` (in `tests/routes/protected.api.spec.ts`) — same pattern but shared across HTTP and NIP-46 cross-surface tests.

Both patterns derive the conversation key externally via `nostr-tools` `getConversationKey(...)` and use the resulting key to encrypt/decrypt ciphertext that the Igloo server must be able to decrypt/encrypt. This lets tests simulate threshold ECDH without needing real FROSTR credentials.
