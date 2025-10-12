import { Database } from 'bun:sqlite';
import { password as BunPassword } from 'bun';
import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync, createHash, timingSafeEqual } from 'node:crypto';
import path from 'path';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { sanitizePeerPolicyEntries, type PeerPolicyRecord } from '../util/peer-policy.js';
import { PBKDF2_CONFIG, AES_CONFIG, SALT_CONFIG, PASSWORD_HASH_CONFIG } from '../config/crypto.js';

// Database configuration
const defaultDbDir = path.join(process.cwd(), 'data');
const envPath = process.env.DB_PATH;
const isEnvPathFile = !!envPath && (envPath.endsWith('.db') || path.extname(envPath) !== '');
const DB_DIR = isEnvPathFile ? path.dirname(envPath as string) : (envPath || defaultDbDir);
const DB_FILE = isEnvPathFile ? (envPath as string) : path.join(DB_DIR, 'igloo.db');

// Ensure data directory exists with secure permissions
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
} else {
  // Enforce secure permissions on existing directory
  chmodSync(DB_DIR, 0o700);
}

/**
 * @security
 * Bun's SQLite implementation does not support the `safeIntegers` option
 * available in `better-sqlite3`. This means that `INTEGER` values exceeding
 * `Number.MAX_SAFE_INTEGER` (2^53 - 1) may suffer from precision loss.
 *
 * For our primary use case with `AUTOINCREMENT` IDs, this is unlikely to be an
 * issue, as it would require over 9 quadrillion records. However, to mitigate
 * potential risks, we have introduced a `MAX_SAFE_ID` constant and an
 * `isSafeId` helper function.
 *
 * If high-precision large integers are required in the future, consider storing
 * them as `TEXT` and implementing custom `BigInt` serialization/deserialization.
 */
// Check for potential integer overflow when retrieving IDs
const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

const db = new Database(DB_FILE);

// Add a helper to check ID safety
export const isSafeId = (id: number | bigint): boolean => {
  // For numbers: check if they're within safe bounds (could have precision loss if > MAX_SAFE_INTEGER)
  // For bigints: check if they could be safely converted to number if needed
  return typeof id === 'number'
    ? id <= MAX_SAFE_ID
    : id <= BigInt(MAX_SAFE_ID);
};

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON');

// User table schema
const createUserTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,  -- Argon2id hash with embedded salt for authentication
      salt TEXT NOT NULL,            -- Separate salt for PBKDF2 encryption key derivation (not for password)
      group_cred_encrypted TEXT,
      share_cred_encrypted TEXT,
      relays TEXT,
      peer_policies TEXT,
      group_name TEXT,
      -- Role-based access control built into the initial schema to avoid migration conflicts
      role TEXT DEFAULT 'user' CHECK (role IN ('admin','user')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Indexes for faster lookups
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)');
};

// Initialize database tables
createUserTable();

// Role column now exists in the base schema (fresh installs).
// Legacy databases will be handled by dedicated migrations; no runtime ALTERs here.

// Ensure legacy databases add the peer_policies column without requiring manual migration
const ensurePeerPoliciesColumn = () => {
  try {
    const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    const hasColumn = columns.some(column => column.name === 'peer_policies');
    if (!hasColumn) {
      db.exec('ALTER TABLE users ADD COLUMN peer_policies TEXT');
    }
  } catch (error) {
    console.error('[db] Failed to ensure peer_policies column exists:', error);
  }
};

ensurePeerPoliciesColumn();

// Legacy bootstrap helpers removed: role column is required going forward

// Ensure sessions table exists via migrations (preferred), but also provide
// defensive creation here for older installs that haven't run migrations yet.
// This mirrors the minimal persisted state we need for authorization.
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_access DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_last_access ON sessions(last_access)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
} catch (e) {
  console.error('[db] Warning: failed to ensure sessions table exists (will rely on migrations):', e);
}

// Dummy hash for timing attack mitigation (Argon2id hash of 'dummy')
// This is used to perform a constant-time verification when user is not found
const TIMING_SAFE_DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=1$2JaKMgrWFzQ8TqnYPmqM8r8I8B3zgc5mz0IFadteOTw$XrSyLD/x6h8N+jnve8Sr0hODpCEUVmQ+qqyfGGXz+JI';

// Shutdown state flag to prevent new operations during cleanup
let isShuttingDown = false;

// Helper function to check shutdown state
const checkShutdown = (): void => {
  if (isShuttingDown) {
    throw new Error('Database is shutting down');
  }
};

// Close database connection (for graceful shutdown)
export const closeDatabase = async (): Promise<void> => {
  isShuttingDown = true;
  console.log('[db] Closing database connection...');
  try {
    db.close();
    console.log('[db] Database closed successfully');
  } catch (error) {
    console.error('[db] Error closing database:', error);
    throw error;
  }
};

// Note: Signal handlers removed - server.ts handles graceful shutdown
// to avoid duplicate handlers and ensure proper cleanup order

// Use centralized crypto constants (AES_CONFIG.IV_LENGTH recommended: 12 bytes for GCM)

// Derive a key from password and salt using PBKDF2
const deriveKey = (password: string, saltHex: string): Buffer => {
  // Convert hex-encoded salt to Buffer
  const saltBuffer = Buffer.from(saltHex, 'hex');
  return pbkdf2Sync(password, saltBuffer, PBKDF2_CONFIG.ITERATIONS, PBKDF2_CONFIG.KEY_LENGTH, PBKDF2_CONFIG.ALGORITHM);
};

// Encrypt text using AES-256-GCM (AEAD)
const encrypt = (text: string, key: string): string => {
  if (!text) return '';
  
  try {
    // Generate random IV
    const iv = randomBytes(AES_CONFIG.IV_LENGTH);
    
    // Derive encryption key from the provided key string and user's salt
    const keyBuffer = Buffer.from(key, 'hex');
    
    // Validate key length for AES-256-GCM
    if (keyBuffer.length !== AES_CONFIG.KEY_LENGTH) {
      throw new Error(
        `Invalid encryption key length: expected ${AES_CONFIG.KEY_LENGTH} bytes for ${AES_CONFIG.ALGORITHM}, ` +
        `got ${keyBuffer.length} bytes`
      );
    }
    
    // Create cipher
    const cipher = createCipheriv(AES_CONFIG.ALGORITHM, keyBuffer, iv);
    
    // Encrypt the text
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final()
    ]);
    
    // Get the authentication tag
    const authTag = cipher.getAuthTag();
    
    // Combine IV, auth tag, and ciphertext
    // Format: base64(iv:authTag:ciphertext)
    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64');
  } catch (error) {
    throw new Error('Encryption failed');
  }
};

// Decrypt text using AES-256-GCM (AEAD)
const decrypt = (ciphertext: string, key: string): string => {
  if (!ciphertext) return '';
  
  try {
    // Try new format first (AES-GCM)
    const combined = Buffer.from(ciphertext, 'base64');
    
    // Extract components
    const iv = combined.subarray(0, AES_CONFIG.IV_LENGTH);
    const authTag = combined.subarray(AES_CONFIG.IV_LENGTH, AES_CONFIG.IV_LENGTH + AES_CONFIG.TAG_LENGTH);
    const encrypted = combined.subarray(AES_CONFIG.IV_LENGTH + AES_CONFIG.TAG_LENGTH);
    
    // Derive decryption key
    const keyBuffer = Buffer.from(key, 'hex');
    
    // Validate key length for AES-256-GCM
    if (keyBuffer.length !== AES_CONFIG.KEY_LENGTH) {
      throw new Error(
        `Invalid decryption key length: expected ${AES_CONFIG.KEY_LENGTH} bytes for ${AES_CONFIG.ALGORITHM}, ` +
        `got ${keyBuffer.length} bytes`
      );
    }
    
    // Create decipher
    const decipher = createDecipheriv(AES_CONFIG.ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);
    
    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error('Decryption failed');
  }
};

// User management functions
export interface User {
  id: number | bigint;
  username: string;
  password_hash: string;        // Argon2id hash with embedded salt for authentication
  salt: string;                 // Encryption salt for PBKDF2 key derivation (NOT the password salt)
  group_cred_encrypted: string | null;
  share_cred_encrypted: string | null;
  relays: string | null;
  peer_policies: string | null;
  group_name: string | null;
  created_at: string;
  updated_at: string;
  role?: string | null;
}

export interface UserCredentials {
  group_cred: string | null;
  share_cred: string | null;
  relays: string[] | null;
  group_name: string | null;
}

export type StoredPeerPolicy = PeerPolicyRecord;

export interface AdminUserListItem {
  id: number | bigint;
  username: string;
  createdAt: string;
  hasCredentials: boolean;
}

// ------------------------------
// Session persistence (minimal)
// ------------------------------

export interface PersistedSessionRow {
  id: string;
  user_id: number | bigint;
  ip_address: string | null;
  created_at: string;
  last_access: string;
}

export function createSessionRecord(
  sessionId: string,
  userId: number | bigint,
  ipAddress?: string | null
): boolean {
  checkShutdown();
  try {
    const stmt = db.prepare(
      `INSERT INTO sessions (id, user_id, ip_address) VALUES (?, ?, ?)`
    );
    stmt.run(sessionId, userId, ipAddress ?? null);
    return true;
  } catch (e) {
    console.error('[db] createSessionRecord failed:', e);
    return false;
  }
}

export function getSessionRecord(sessionId: string): PersistedSessionRow | null {
  checkShutdown();
  try {
    const row = db
      .prepare(
        `SELECT id, user_id, ip_address, created_at, last_access FROM sessions WHERE id = ?`
      )
      .get(sessionId) as PersistedSessionRow | undefined;
    return row ?? null;
  } catch (e) {
    console.error('[db] getSessionRecord failed:', e);
    return null;
  }
}

export function touchSession(sessionId: string): boolean {
  checkShutdown();
  try {
    db.prepare(
      `UPDATE sessions SET last_access = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(sessionId);
    return true;
  } catch (e) {
    console.error('[db] touchSession failed:', e);
    return false;
  }
}

export function deleteSessionRecord(sessionId: string): boolean {
  checkShutdown();
  try {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    return true;
  } catch (e) {
    console.error('[db] deleteSessionRecord failed:', e);
    return false;
  }
}

// Remove sessions that have been inactive longer than ttlMs; returns removed ids
export function cleanupExpiredSessionsDB(ttlMs: number): string[] {
  checkShutdown();
  try {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
    const cutoff = nowSeconds - ttlSeconds;
    const rows = db
      .prepare(
        `SELECT id FROM sessions WHERE CAST(strftime('%s', last_access) AS INTEGER) <= ?`
      )
      .all(cutoff) as { id: string }[];
    if (rows.length === 0) return [];
    const ids = rows.map(r => r.id);
    const del = db.prepare(`DELETE FROM sessions WHERE id IN (${ids.map(() => '?').join(',')})`);
    del.run(...ids);
    return ids;
  } catch (e) {
    console.error('[db] cleanupExpiredSessionsDB failed:', e);
    return [];
  }
}

// Check if database is initialized (has at least one user)
export const isDatabaseInitialized = (): boolean => {
  checkShutdown();
  const result = db.query('SELECT COUNT(*) as count FROM users').get() as { count: number } | null;
  return result ? result.count > 0 : false;
};

// Create a new user
export const createUser = async (
  username: string,
  password: string,
  options?: { role?: 'admin' | 'user' }
): Promise<{ success: boolean; error?: string; userId?: number | bigint }> => {
  checkShutdown();
  try {
    // Hash password using Bun's built-in password API with configured Argon2id parameters
    const passwordHash = await BunPassword.hash(password, PASSWORD_HASH_CONFIG);
    const isFirstUser = !isDatabaseInitialized();
    const desiredRole: 'admin' | 'user' = options?.role ?? (isFirstUser ? 'admin' : 'user');
    
    // Insert user with dual-salt design:
    // - password_hash: Contains Argon2id hash with embedded salt for authentication
    // - salt: Separate salt for PBKDF2 encryption key derivation (stored plaintext by design)
    const stmt = db.query(`
        INSERT INTO users (username, password_hash, salt, role)
        VALUES (?, ?, ?, ?)
      `);
    
    // Generate encryption salt for PBKDF2 key derivation
    // SECURITY NOTE: This salt is intentionally separate from Argon2id's embedded salt.
    // Using different salts for authentication vs encryption is a security best practice.
    // This salt must be stored in plaintext to enable credential decryption.
    const salt = randomBytes(SALT_CONFIG.LENGTH).toString('hex');
    stmt.run(username, passwordHash, salt, desiredRole);
    
    // Get the last inserted ID (returns number or bigint based on size)
    const lastId = db.query('SELECT last_insert_rowid() as id').get() as { id: number | bigint };
    
    if (!isSafeId(lastId.id)) {
      console.warn(`[db] Warning: New user ID ${lastId.id} exceeds Number.MAX_SAFE_INTEGER. Precision may be lost if not handled as BigInt.`);
    }

    // Role is already set via the INSERT above; no redundant UPDATE needed

    return {
      success: true,
      userId: lastId.id
    };
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return { success: false, error: 'Username already exists' };
    }
    console.error('Error creating user:', error);
    return { success: false, error: 'Failed to create user' };
  }
};

// Authenticate user
export const authenticateUser = async (
  username: string,
  password: string
): Promise<{ success: boolean; user?: User; error?: string }> => {
  checkShutdown();
  try {
    const user = db.query('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;

    if (user && !isSafeId(user.id)) {
      console.warn(`[db] Warning: Authenticated user ID ${user.id} exceeds Number.MAX_SAFE_INTEGER. Precision may be lost if not handled as BigInt.`);
    }
    
    if (!user) {
      // Perform dummy verification to prevent timing attacks
      // This ensures the "user not found" path takes similar time as "wrong password" path
      try {
        await BunPassword.verify(password, TIMING_SAFE_DUMMY_HASH);
      } catch {
        // Ignore dummy verification errors
      }
      // This is an expected auth failure, not an error
      return { success: false, error: 'Invalid credentials' };
    }
    
    // Use Bun's password verification (supports both new Argon2id and legacy bcrypt hashes)
    const isValid = await BunPassword.verify(password, user.password_hash);
    
    if (!isValid) {
      // This is an expected auth failure, not an error
      return { success: false, error: 'Invalid credentials' };
    }
    
    return { success: true, user };
  } catch (error: any) {
    // Check for actual database errors
    if (error?.code === 'SQLITE_BUSY' || 
        error?.code === 'SQLITE_LOCKED' || 
        error?.code === 'SQLITE_IOERR' ||
        error?.code === 'SQLITE_CORRUPT' ||
        error?.code === 'SQLITE_FULL') {
      // This is a real database error, re-throw it
      console.error('Database error during authentication:', { 
        code: error.code, 
        message: error.message 
      });
      throw error;
    }
    
    // For other errors (e.g., bcrypt errors), treat as auth failure
    console.error('Unexpected error during authentication (treating as auth failure)');
    return { success: false, error: 'Authentication failed' };
  }
};

// Get user by ID
export const getUserById = (userId: number | bigint): User | null => {
  checkShutdown();
  try {
    const user = db.query('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
    if (user && !isSafeId(user.id)) {
      console.warn(`[db] Warning: Fetched user ID ${user.id} exceeds Number.MAX_SAFE_INTEGER. Precision may be lost if not handled as BigInt.`);
    }
    return user || null;
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
};

// Get user by username
export const getUserByUsername = (username: string): User | null => {
  checkShutdown();
  try {
    const user = db.query('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
    if (user && !isSafeId(user.id)) {
      console.warn(`[db] Warning: Fetched user ID ${user.id} exceeds Number.MAX_SAFE_INTEGER. Precision may be lost if not handled as BigInt.`);
    }
    return user || null;
  } catch (error) {
    console.error('Error getting user by username:', error);
    return null;
  }
};

// Update user credentials (encrypted)
export const updateUserCredentials = (
  userId: number | bigint,
  credentials: Partial<UserCredentials>,
  passwordOrKey: string | Uint8Array | Buffer, // User's password or derived key for encryption
  isDerivedKey: boolean = false // If true, passwordOrKey is already a derived key (accepts hex string or binary)
): boolean => {
  checkShutdown();
  try {
    const user = getUserById(userId);
    if (!user) return false;
    
    // Check if we need encryption (for encrypted fields)
    const needsEncryption = credentials.group_cred !== undefined || credentials.share_cred !== undefined;
    
    // Get encryption key only if needed for encrypted fields
    let key: string = '';
    if (needsEncryption) {
      if (!passwordOrKey || (typeof passwordOrKey === 'string' && passwordOrKey.length === 0)) {
        throw new Error('Password or key required for updating encrypted credentials');
      }
      
      if (isDerivedKey) {
        if (typeof passwordOrKey === 'string') {
          if (!passwordOrKey.match(/^[0-9a-f]{64}$/i)) throw new Error('Invalid derived key format');
          key = passwordOrKey.toLowerCase();
        } else {
          const bytes = passwordOrKey instanceof Uint8Array ? passwordOrKey : new Uint8Array(passwordOrKey);
          if (bytes.length !== 32) throw new Error('Invalid derived key length: expected 32 bytes');
          key = Buffer.from(bytes).toString('hex');
        }
      } else {
        if (typeof passwordOrKey !== 'string') throw new Error('Password must be a string');
        key = deriveKey(passwordOrKey, user.salt).toString('hex'); // Derive from password
      }
    }
    
    // Prepare update fields
    const updates: string[] = [];
    const values: any[] = [];
    
    if (credentials.group_cred !== undefined) {
      updates.push('group_cred_encrypted = ?');
      values.push(credentials.group_cred ? encrypt(credentials.group_cred, key) : null);
    }
    
    if (credentials.share_cred !== undefined) {
      updates.push('share_cred_encrypted = ?');
      values.push(credentials.share_cred ? encrypt(credentials.share_cred, key) : null);
    }
    
    if (credentials.relays !== undefined) {
      updates.push('relays = ?');
      values.push(credentials.relays ? JSON.stringify(credentials.relays) : null);
    }
    
    if (credentials.group_name !== undefined) {
      updates.push('group_name = ?');
      values.push(credentials.group_name);
    }
    
    if (updates.length === 0) return true;
    
    // Add updated_at
    updates.push('updated_at = CURRENT_TIMESTAMP');
    
    // Add user ID for WHERE clause
    values.push(userId);
    
    const stmt = db.query(`
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = ?
    `);
    
    stmt.run(...values);
    return true;
  } catch (error) {
    console.error('Error updating user credentials:', error);
    return false;
  }
};

// Get decrypted user credentials
export const getUserCredentials = (
  userId: number | bigint,
  passwordOrKey: string | Uint8Array | Buffer, // User's password or derived key for decryption
  isDerivedKey: boolean = false // If true, passwordOrKey is already a derived key (accepts hex string or binary)
): UserCredentials | null => {
  checkShutdown();
  try {
    const user = getUserById(userId);
    if (!user) return null;
    
    // Get decryption key - either derive from password or use provided derived key
    let key: string;
    if (isDerivedKey) {
      if (typeof passwordOrKey === 'string') {
        if (!passwordOrKey.match(/^[0-9a-f]{64}$/i)) throw new Error('Invalid derived key format');
        key = passwordOrKey.toLowerCase();
      } else {
        const bytes = passwordOrKey instanceof Uint8Array ? passwordOrKey : new Uint8Array(passwordOrKey);
        if (bytes.length !== 32) throw new Error('Invalid derived key length: expected 32 bytes');
        key = Buffer.from(bytes).toString('hex');
      }
    } else {
      if (typeof passwordOrKey !== 'string') throw new Error('Password must be a string');
      key = deriveKey(passwordOrKey, user.salt).toString('hex'); // Derive from password
    }
    
    // Decrypt credentials
    const groupCred = user.group_cred_encrypted ? decrypt(user.group_cred_encrypted, key) : null;
    const shareCred = user.share_cred_encrypted ? decrypt(user.share_cred_encrypted, key) : null;
    
    // Parse relays
    let relays: string[] | null = null;
    if (user.relays) {
      try {
        relays = JSON.parse(user.relays);
      } catch {
        relays = null;
      }
    }
    
    return {
      group_cred: groupCred,
      share_cred: shareCred,
      relays: relays,
      group_name: user.group_name
    };
  } catch (error) {
    console.error('Error getting user credentials:', error);
    return null;
  }
};

export const getUserPeerPolicies = (userId: number | bigint): StoredPeerPolicy[] => {
  checkShutdown();
  try {
    const user = getUserById(userId);
    if (!user || !user.peer_policies) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(user.peer_policies);
    } catch (error) {
      console.warn('Failed to parse stored peer policies JSON:', error);
      return [];
    }

    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return sanitizePeerPolicyEntries(entries);
  } catch (error) {
    console.error('Error getting user peer policies:', error);
    return [];
  }
};

export const updateUserPeerPolicies = (
  userId: number | bigint,
  policies: StoredPeerPolicy[] | null
): boolean => {
  checkShutdown();
  try {
    let serialized: string | null = null;
    if (policies && policies.length > 0) {
      const sanitized = sanitizePeerPolicyEntries(policies);
      if (sanitized.length > 0) {
        serialized = JSON.stringify(sanitized);
      }
    }

    const stmt = db.query(`
      UPDATE users
      SET peer_policies = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(serialized, userId);
    return true;
  } catch (error) {
    console.error('Error updating user peer policies:', error);
    return false;
  }
};

// Check if a user has stored credentials (without needing password)
export const userHasStoredCredentials = (userId: number | bigint): boolean => {
  checkShutdown();
  try {
    const user = getUserById(userId);
    if (!user) return false;
    
    // Check if BOTH encrypted credentials exist (not just one)
    return !!(user.group_cred_encrypted && user.share_cred_encrypted);
  } catch (error) {
    console.error('Error checking stored credentials:', error);
    return false;
  }
};

// Check if ANY user has stored credentials (for status endpoint in DB mode)
export const anyUserHasStoredCredentials = (): boolean => {
  checkShutdown();
  try {
    const result = db.query(`
      SELECT COUNT(*) as count FROM users 
      WHERE group_cred_encrypted IS NOT NULL 
      AND share_cred_encrypted IS NOT NULL
    `).get() as { count: number } | null;
    return result ? result.count > 0 : false;
  } catch (error) {
    console.error('Error checking any stored credentials:', error);
    return false;
  }
};

// Delete user credentials
export const deleteUserCredentials = (userId: number | bigint): boolean => {
  checkShutdown();
  try {
    const stmt = db.query(`
      UPDATE users 
      SET group_cred_encrypted = NULL,
          share_cred_encrypted = NULL,
          relays = NULL,
          peer_policies = NULL,
          group_name = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(userId);
    return true;
  } catch (error) {
    console.error('Error deleting user credentials:', error);
    return false;
  }
};

// API key constants
const API_KEY_PREFIX_LENGTH = 12;
const API_KEY_TOKEN_BYTES = 32;

const hashApiKey = (token: string): Buffer => {
  return createHash('sha256').update(token, 'utf8').digest();
};

const toSerializableId = (id: number | bigint): number | string => (
  typeof id === 'bigint' ? id.toString() : id
);

const normalizeOptionalId = (id: number | bigint | null): number | string | null => {
  if (id === null || id === undefined) return null;
  return typeof id === 'bigint' ? id.toString() : id;
};

type ApiKeyRow = {
  id: number | bigint;
  prefix: string;
  key_hash: string;
  label: string | null;
  created_by_user_id: number | bigint | null;
  created_by_admin: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
};

export type ApiKeySummary = {
  id: number | string;
  prefix: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdByUserId: number | string | null;
  createdByAdmin: boolean;
};

export type ApiKeyCreationResult = {
  id: number | string;
  token: string;
  prefix: string;
};

type ApiKeyVerificationFailure = 'not_found' | 'revoked' | 'mismatch';

export type ApiKeyVerificationResult =
  | { success: true; apiKeyId: number | string; prefix: string }
  | { success: false; reason: ApiKeyVerificationFailure };

const generateApiKeyToken = (): { token: string; prefix: string } => {
  const token = randomBytes(API_KEY_TOKEN_BYTES).toString('hex');
  const prefix = token.slice(0, API_KEY_PREFIX_LENGTH);
  return { token, prefix };
};

export const createApiKey = (options?: {
  label?: string;
  createdByUserId?: number | bigint | null;
  createdByAdmin?: boolean;
}): ApiKeyCreationResult => {
  checkShutdown();
  const label = options?.label?.trim() || null;
  const createdByUserId = options?.createdByUserId ?? null;
  const createdByAdmin = options?.createdByAdmin === false ? 0 : 1;

  const insertStmt = db.prepare(
    `INSERT INTO api_keys (prefix, key_hash, label, created_by_user_id, created_by_admin)
     VALUES (?, ?, ?, ?, ?)`
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { token, prefix } = generateApiKeyToken();
    const hashBuffer = hashApiKey(token);

    try {
      insertStmt.run(prefix, hashBuffer.toString('hex'), label, createdByUserId, createdByAdmin);
      const idRow = db.query('SELECT last_insert_rowid() as id').get() as { id: number | bigint };
      if (idRow && !isSafeId(idRow.id)) {
        console.warn(`[db] Warning: API key ID ${idRow.id} exceeds Number.MAX_SAFE_INTEGER. Returning as string.`);
      }
      return {
        id: toSerializableId(idRow.id),
        token,
        prefix,
      };
    } catch (error: any) {
      const message = error?.message || '';
      if (message.includes('UNIQUE') && attempt < 4) {
        continue;
      }
      console.error('Error creating API key:', error);
      throw error;
    }
  }

  throw new Error('Failed to generate unique API key prefix');
};

export const listApiKeys = (): ApiKeySummary[] => {
  checkShutdown();
  try {
    const rows = db
      .prepare(`
        SELECT 
          id,
          prefix,
          label,
          created_by_user_id,
          created_by_admin,
          created_at,
          updated_at,
          last_used_at,
          last_used_ip,
          revoked_at,
          revoked_reason
        FROM api_keys
        ORDER BY revoked_at IS NULL DESC, created_at DESC, id DESC
      `)
      .all() as ApiKeyRow[];

    return rows.map(row => {
      if (!isSafeId(row.id)) {
        console.warn(`[db] Warning: API key ID ${row.id} exceeds Number.MAX_SAFE_INTEGER. Returning as string.`);
      }
      const createdByUserId = row.created_by_user_id;
      if (createdByUserId !== null && !isSafeId(createdByUserId)) {
        console.warn(`[db] Warning: API key created_by_user_id ${createdByUserId} exceeds Number.MAX_SAFE_INTEGER.`);
      }
      return {
        id: toSerializableId(row.id),
        prefix: row.prefix,
        label: row.label,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastUsedAt: row.last_used_at,
        lastUsedIp: row.last_used_ip,
        revokedAt: row.revoked_at,
        revokedReason: row.revoked_reason,
        createdByUserId: normalizeOptionalId(createdByUserId),
        createdByAdmin: row.created_by_admin === 1,
      };
    });
  } catch (error) {
    console.error('Error listing API keys:', error);
    return [];
  }
};

export const hasActiveApiKeys = (): boolean => {
  checkShutdown();
  try {
    const row = db
      .prepare('SELECT EXISTS(SELECT 1 FROM api_keys WHERE revoked_at IS NULL LIMIT 1) AS present')
      .get() as { present: number } | undefined;
    return !!row && row.present === 1;
  } catch (error) {
    console.error('Error checking active API keys:', error);
    return false;
  }
};

export const verifyApiKeyToken = (token: string | null | undefined): ApiKeyVerificationResult => {
  checkShutdown();
  if (!token || typeof token !== 'string') {
    return { success: false, reason: 'not_found' };
  }

  const candidate = token.trim();
  if (candidate.length === 0) {
    return { success: false, reason: 'not_found' };
  }

  const prefix = candidate.slice(0, API_KEY_PREFIX_LENGTH);
  if (prefix.length < API_KEY_PREFIX_LENGTH) {
    return { success: false, reason: 'not_found' };
  }

  let row: ApiKeyRow | undefined;
  try {
    row = db
      .prepare('SELECT * FROM api_keys WHERE prefix = ? LIMIT 1')
      .get(prefix) as ApiKeyRow | undefined;
  } catch (error) {
    console.error('Error retrieving API key for verification:', error);
    return { success: false, reason: 'not_found' };
  }

  if (!row) {
    return { success: false, reason: 'not_found' };
  }

  if (row.revoked_at) {

    return { success: false, reason: 'revoked' };

  }

  const providedHash = hashApiKey(candidate);

  const storedHash = Buffer.from(row.key_hash, 'hex');

  const EXPECTED_LENGTH = 32;

  // Fail fast on malformed/corrupted stored hash
  if (storedHash.length !== EXPECTED_LENGTH) {
    return { success: false, reason: 'mismatch' };
  }

  try {
    if (!timingSafeEqual(storedHash, providedHash)) {
      return { success: false, reason: 'mismatch' };
    }
  } catch (error) {
    console.error('Error performing timing-safe comparison for API key:', error);
    return { success: false, reason: 'mismatch' };
  }

  if (!isSafeId(row.id)) {
    console.warn(`[db] Warning: API key ID ${row.id} exceeds Number.MAX_SAFE_INTEGER. Returning as string.`);
  }

  return {
    success: true,
    apiKeyId: toSerializableId(row.id),
    prefix: row.prefix,
  };
};

export const markApiKeyUsed = (apiKeyId: number | string, ip?: string | null): void => {
  checkShutdown();
  try {
    if (ip && ip.trim().length > 0) {
      db.prepare(
        `UPDATE api_keys
         SET last_used_at = CURRENT_TIMESTAMP,
             last_used_ip = ?
         WHERE id = ?`
      ).run(ip, apiKeyId);
    } else {
      db.prepare(
        `UPDATE api_keys
         SET last_used_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(apiKeyId);
    }
  } catch (error) {
    console.error('Error updating API key usage metadata:', error);
  }
};

export const revokeApiKey = (
  apiKeyId: number | bigint,
  reason?: string
): { success: boolean; error?: 'not_found' | 'already_revoked' | 'failed' } => {
  checkShutdown();
  try {
    const stmt = db.prepare(
      `UPDATE api_keys
       SET revoked_at = CURRENT_TIMESTAMP,
           revoked_reason = COALESCE(?, revoked_reason)
       WHERE id = ? AND revoked_at IS NULL`
    );

    stmt.run(reason && reason.trim().length > 0 ? reason.trim() : null, apiKeyId);
    const result = db.query('SELECT changes() AS changes').get() as { changes: number } | null;
    if (result && result.changes > 0) {
      return { success: true };
    }

    const existing = db
      .prepare('SELECT revoked_at FROM api_keys WHERE id = ? LIMIT 1')
      .get(apiKeyId) as { revoked_at: string | null } | undefined;

    if (!existing) {
      return { success: false, error: 'not_found' };
    }
    if (existing.revoked_at) {
      return { success: false, error: 'already_revoked' };
    }
    return { success: false, error: 'failed' };
  } catch (error) {
    console.error('Error revoking API key:', error);
    return { success: false, error: 'failed' };
  }
};

/**
 * Get all users from the database for admin listing
 * @returns Array of users with basic info and credential status
 */
export const getAllUsers = (): AdminUserListItem[] => {
  checkShutdown();
  try {
    const rows = db.prepare(`
      SELECT 
        id, 
        username, 
        created_at,
        (group_cred_encrypted IS NOT NULL AND share_cred_encrypted IS NOT NULL) AS hasCredentials
      FROM users
      ORDER BY created_at ASC, id ASC
    `).all() as { id: number | bigint; username: string; created_at: string; hasCredentials: 0 | 1 }[];
    
    return rows.map(r => {
      if (!isSafeId(r.id)) {
        console.warn(`[db] Warning: User ID ${r.id} exceeds Number.MAX_SAFE_INTEGER. Precision may be lost if not handled as BigInt.`);
      }
      return { 
        id: r.id,
        username: r.username,
        createdAt: r.created_at,
        hasCredentials: !!r.hasCredentials 
      };
    });
  } catch (error) {
    console.error('Error fetching all users:', error);
    return [];
  }
};

/**
 * Delete a user with an atomic last-admin guard.
 * A user is considered an admin if they have both encrypted credentials stored.
 * The function prevents deleting the last such admin user via a transaction.
 */
export const deleteUserSafely = (
  userId: number | bigint
): { success: boolean; error?: string } => {
  checkShutdown();
  try {
    db.exec('BEGIN IMMEDIATE');

    const row = db
      .prepare(
        `SELECT id, (group_cred_encrypted IS NOT NULL AND share_cred_encrypted IS NOT NULL) AS isAdmin
         FROM users WHERE id = ?`
      )
      .get(userId) as { id: number | bigint; isAdmin: 0 | 1 } | undefined;

    if (row && !isSafeId(row.id)) {
      console.warn(`[db] Warning: User ID ${row.id} in deleteUserSafely exceeds Number.MAX_SAFE_INTEGER.`);
    }

    if (!row) {
      db.exec('ROLLBACK');
      return { success: false, error: 'User not found' };
    }

    const countRow = db
      .query(
        `SELECT COUNT(*) as cnt FROM users WHERE group_cred_encrypted IS NOT NULL AND share_cred_encrypted IS NOT NULL`
      )
      .get() as { cnt: number } | null;
    const adminCount = countRow?.cnt ?? 0;

    if (row.isAdmin === 1 && adminCount <= 1) {
      db.exec('ROLLBACK');
      return { success: false, error: 'Cannot delete the last admin user' };
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    const changes = db.query('SELECT changes() as changes').get() as { changes: number } | null;
    if (!changes || changes.changes === 0) {
      db.exec('ROLLBACK');
      return { success: false, error: 'User not found or deletion failed' };
    }

    db.exec('COMMIT');
    return { success: true };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('Error deleting user (safe):', e);
    return { success: false, error: 'Deletion failed' };
  }
};

// Export database instance for advanced operations
export default db;
