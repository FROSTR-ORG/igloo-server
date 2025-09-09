import { Database } from 'bun:sqlite';
import { password as BunPassword } from 'bun';
import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

// Database configuration
const defaultDbDir = path.join(process.cwd(), 'data');
const envPath = process.env.DB_PATH;
const isEnvPathFile = !!envPath && (envPath.endsWith('.db') || path.extname(envPath) !== '');
const DB_DIR = isEnvPathFile ? path.dirname(envPath as string) : (envPath || defaultDbDir);
const DB_FILE = isEnvPathFile ? (envPath as string) : path.join(DB_DIR, 'igloo.db');

// Ensure data directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_FILE);

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
      group_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Create index on username for faster lookups
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
};

// Initialize database tables
createUserTable();

// Close database connection (for graceful shutdown)
export const closeDatabase = async (): Promise<void> => {
  db.close();
};

// Register graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('[db] Received SIGINT. Closing database...');
  try {
    await closeDatabase();
    console.log('[db] Database closed successfully');
  } catch (error) {
    console.error('[db] Error closing database:', error);
  }
  // Let the process terminate naturally after cleanup
});

process.on('SIGTERM', async () => {
  console.log('[db] Received SIGTERM. Closing database...');
  try {
    await closeDatabase();
    console.log('[db] Database closed successfully');
  } catch (error) {
    console.error('[db] Error closing database:', error);
  }
  // Let the process terminate naturally after cleanup
});

// Encryption utilities
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 200000; // Optimized for security and performance

// Derive a key from password and salt using PBKDF2
const deriveKey = (password: string, saltHex: string): Buffer => {
  // Convert hex-encoded salt to Buffer
  const saltBuffer = Buffer.from(saltHex, 'hex');
  return pbkdf2Sync(password, saltBuffer, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
};

// Encrypt text using AES-256-GCM (AEAD)
const encrypt = (text: string, key: string): string => {
  if (!text) return '';
  
  try {
    // Generate random IV
    const iv = randomBytes(IV_LENGTH);
    
    // Derive encryption key from the provided key string and user's salt
    const keyBuffer = Buffer.from(key, 'hex');
    
    // Create cipher
    const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);
    
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
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);
    
    // Derive decryption key
    const keyBuffer = Buffer.from(key, 'hex');
    
    // Create decipher
    const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
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
  group_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCredentials {
  group_cred: string | null;
  share_cred: string | null;
  relays: string[] | null;
  group_name: string | null;
}

export interface AdminUserListItem {
  id: number | bigint;
  username: string;
  createdAt: string;
  hasCredentials: boolean;
}

// Check if database is initialized (has at least one user)
export const isDatabaseInitialized = (): boolean => {
  const result = db.query('SELECT COUNT(*) as count FROM users').get() as { count: number } | null;
  return result ? result.count > 0 : false;
};

// Create a new user
export const createUser = async (
  username: string, 
  password: string
): Promise<{ success: boolean; error?: string; userId?: number }> => {
  try {
    // Hash password using Bun's built-in password API (defaults to Argon2id)
    const passwordHash = await BunPassword.hash(password, { algorithm: 'argon2id' });
    
    // Insert user with dual-salt design:
    // - password_hash: Contains Argon2id hash with embedded salt for authentication
    // - salt: Separate salt for PBKDF2 encryption key derivation (stored plaintext by design)
    const stmt = db.query(`
      INSERT INTO users (username, password_hash, salt)
      VALUES (?, ?, ?)
    `);
    
    // Generate encryption salt for PBKDF2 key derivation
    // SECURITY NOTE: This salt is intentionally separate from Argon2id's embedded salt.
    // Using different salts for authentication vs encryption is a security best practice.
    // This salt must be stored in plaintext to enable credential decryption.
    const salt = randomBytes(32).toString('hex');
    stmt.run(username, passwordHash, salt);
    
    // Get the last inserted ID
    const lastId = db.query('SELECT last_insert_rowid() as id').get() as { id: number };
    
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
  try {
    const user = db.query('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
    
    if (!user) {
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
  try {
    const user = db.query('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
    return user || null;
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
};

// Get user by username
export const getUserByUsername = (username: string): User | null => {
  try {
    const user = db.query('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
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
  passwordOrKey: string, // User's password or derived key for encryption
  isDerivedKey: boolean = false // If true, passwordOrKey is already a derived key
): boolean => {
  try {
    const user = getUserById(userId);
    if (!user) return false;
    
    // Get encryption key - either derive from password or use provided derived key
    if (isDerivedKey && !passwordOrKey.match(/^[0-9a-f]{64}$/i)) {
      throw new Error('Invalid derived key format');
    }
    const key = isDerivedKey 
      ? passwordOrKey // Already a derived key from session (hex string)
      : deriveKey(passwordOrKey, user.salt).toString('hex'); // Derive from password
    
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
  passwordOrKey: string, // User's password or derived key for decryption
  isDerivedKey: boolean = false // If true, passwordOrKey is already a derived key
): UserCredentials | null => {
  try {
    const user = getUserById(userId);
    if (!user) return null;
    
    // Get decryption key - either derive from password or use provided derived key
    if (isDerivedKey && !passwordOrKey.match(/^[0-9a-f]{64}$/i)) {
      throw new Error('Invalid derived key format');
    }
    const key = isDerivedKey 
      ? passwordOrKey // Already a derived key from session (hex string)
      : deriveKey(passwordOrKey, user.salt).toString('hex'); // Derive from password
    
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

// Check if a user has stored credentials (without needing password)
export const userHasStoredCredentials = (userId: number | bigint): boolean => {
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
  try {
    const stmt = db.query(`
      UPDATE users 
      SET group_cred_encrypted = NULL,
          share_cred_encrypted = NULL,
          relays = NULL,
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

/**
 * Get all users from the database for admin listing
 * @returns Array of users with basic info and credential status
 */
export const getAllUsers = (): AdminUserListItem[] => {
  try {
    const rows = db.prepare(`
      SELECT 
        id, 
        username, 
        created_at,
        (group_cred_encrypted IS NOT NULL AND share_cred_encrypted IS NOT NULL) AS hasCredentials
      FROM users
      ORDER BY created_at ASC, id ASC
    `).all() as { id: number; username: string; created_at: string; hasCredentials: 0 | 1 }[];
    
    return rows.map(r => ({ 
      id: r.id,
      username: r.username,
      createdAt: r.created_at,
      hasCredentials: !!r.hasCredentials 
    }));
  } catch (error) {
    console.error('Error fetching all users:', error);
    return [];
  }
};

/**
 * Delete a user from the database
 * @param userId - The ID of the user to delete (supports both number and bigint)
 * @returns true if the user was deleted, false otherwise
 */
export const deleteUser = (userId: number | bigint): boolean => {
  try {
    const stmt = db.prepare('DELETE FROM users WHERE id = ?');
    stmt.run(userId);
    // Use SQLite changes() to determine affected rows to avoid relying on run() return shape
    const result = db.query('SELECT changes() as changes').get() as { changes: number } | null;
    return !!result && result.changes > 0;
  } catch (error) {
    console.error('Error deleting user:', error);
    return false;
  }
};

// Export database instance for advanced operations
export default db;