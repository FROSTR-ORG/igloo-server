# Credential Storage and Encryption (Database Mode)

Last verified: 2026-02-05

## Scope
This document captures how Igloo Server stores, encrypts, and retrieves user credentials in database mode, including key derivation, crypto configuration, and data-model choices.

## Key Files
- `src/db/database.ts` (schema, encryption, credential CRUD)
- `src/config/crypto.ts` (PBKDF2, AES-GCM, salt, Argon2id config)
- `src/routes/user.ts` (credential API usage and update flows)
- `src/routes/auth.ts` (derived-key generation for sessions)

## Data Model
- Credentials are stored in SQLite in the `users` table.
- Encrypted fields:
- `group_cred_encrypted` and `share_cred_encrypted` store ciphertext (AES-256-GCM, base64).
- Plaintext fields:
- `relays` and `group_name` are stored as plain JSON/string (not encrypted).
- `salt` is stored in plaintext and used only for PBKDF2 key derivation.
- `password_hash` stores an Argon2id hash with embedded salt for authentication.

## Crypto Configuration
Defined in `src/config/crypto.ts`:
- PBKDF2: `sha256`, 200000 iterations, 32-byte key length.
- AES-GCM: 256-bit key, 12-byte IV, 16-byte tag.
- Salt length: 32 bytes (256 bits).
- Password hashing: Argon2id via `Bun.password` with 64MB memory cost and 3 iterations.

## Dual-Salt Design
- Authentication uses Argon2id hashes that include their own salt.
- Encryption uses a separate per-user salt stored in `users.salt`.
- This separation is intentional so authentication and encryption salts are not shared.

## Key Derivation
- For password-based operations, `deriveKey(password, user.salt)` uses PBKDF2 and returns 32 bytes.
- The derived key is hex-encoded and used directly as the AES-256-GCM key.
- Derived keys can also be passed directly as 32-byte binary or 64-char hex for session-based flows.

## Ciphertext Format
- AES-256-GCM encrypts with a random 12-byte IV per operation.
- Stored format is `base64(iv || authTag || ciphertext)`.
- Decryption reverses this layout and validates key length before use.

## Credential Write Path
Function: `updateUserCredentials(userId, credentials, passwordOrKey, isDerivedKey)`
- Only `group_cred` and `share_cred` require encryption.
- If neither encrypted field is updated, no key is required and relays/group_name can be updated without a password.
- If `isDerivedKey=true`, the key must be 32 bytes (binary) or 64 hex chars.
- If `isDerivedKey=false`, a PBKDF2 key is derived from the plaintext password and `users.salt`.
- Encrypted fields are replaced atomically in a single `UPDATE`.

## Credential Read Path
Function: `getUserCredentials(userId, passwordOrKey, isDerivedKey)`
- Requires either password or derived key to decrypt encrypted fields.
- Uses the same key format validation as the write path.
- Returns `{ group_cred, share_cred, relays, group_name }` or `null` on failure.
- Decryption errors are logged and treated as a failed read.

## Derived Key Integration
- In session-based flows, a derived key may be generated during login and stored only in memory.
- `updateUserCredentials` and `getUserCredentials` accept derived keys to avoid re-deriving per request.
- Derived keys are never stored in the database.

## Credential Presence Checks
- `userHasStoredCredentials` and `anyUserHasStoredCredentials` require both encrypted fields to be non-null.
- Admin user listing includes `hasCredentials` derived from the same check.

## Deletion Semantics
- `deleteUserCredentials` clears encrypted credentials and related plaintext fields.
- The operation also nulls `relays`, `peer_policies`, and `group_name` to avoid stale state.

## Admin Guard Note
- `deleteUserSafely` considers a user an admin if both encrypted credentials are present.
- This guard prevents deletion of the last credential-bearing user.

## Implementation Notes
- Encrypted credential updates are fail-closed: missing or invalid key formats cause a write to fail.
- Password hashing and credential encryption are intentionally separate concerns with separate salts.
- Relays are stored plaintext and can be updated without a key when no encrypted fields are touched.
