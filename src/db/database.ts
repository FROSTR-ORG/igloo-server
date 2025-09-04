import { Database } from 'bun:sqlite';
import bcrypt from 'bcrypt';
import CryptoJS from 'crypto-js';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';

// Database configuration
const DB_DIR = process.env.DB_PATH || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'igloo.db');

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
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
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

// Encryption utilities
const deriveKey = (password: string, salt: string): string => {
  // Use PBKDF2-like key derivation with CryptoJS
  return CryptoJS.PBKDF2(password, salt, { keySize: 256/32, iterations: 10000 }).toString();
};

const encrypt = (text: string, key: string): string => {
  if (!text) return '';
  return CryptoJS.AES.encrypt(text, key).toString();
};

const decrypt = (ciphertext: string, key: string): string => {
  if (!ciphertext) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Decryption error:', error);
    return '';
  }
};

// User management functions
export interface User {
  id: number;
  username: string;
  password_hash: string;
  salt: string;
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
    // Generate salt and hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);
    
    // Insert user
    const stmt = db.query(`
      INSERT INTO users (username, password_hash, salt)
      VALUES (?, ?, ?)
    `);
    
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
      return { success: false, error: 'Invalid credentials' };
    }
    
    const isValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isValid) {
      return { success: false, error: 'Invalid credentials' };
    }
    
    return { success: true, user };
  } catch (error) {
    console.error('Error authenticating user:', error);
    return { success: false, error: 'Authentication failed' };
  }
};

// Get user by ID
export const getUserById = (userId: number): User | null => {
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
  userId: number,
  credentials: Partial<UserCredentials>,
  password: string // User's password for encryption key derivation
): boolean => {
  try {
    const user = getUserById(userId);
    if (!user) return false;
    
    // Derive encryption key from password
    const key = deriveKey(password, user.salt);
    
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
  userId: number,
  password: string // User's password for decryption
): UserCredentials | null => {
  try {
    const user = getUserById(userId);
    if (!user) return null;
    
    // Derive decryption key from password
    const key = deriveKey(password, user.salt);
    
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

// Delete user credentials
export const deleteUserCredentials = (userId: number): boolean => {
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

// Close database connection (for graceful shutdown)
export const closeDatabase = () => {
  db.close();
};

// Export database instance for advanced operations
export default db;