/**
 * Centralized cryptographic configuration constants
 * Ensures consistency across all modules using encryption/hashing
 */

// PBKDF2 Configuration for Key Derivation
export const PBKDF2_CONFIG = {
  ITERATIONS: 200000,      // Number of iterations (higher = more secure but slower)
  KEY_LENGTH: 32,          // 256 bits
  ALGORITHM: 'sha256',     // Hash algorithm
} as const;

// AES-256-GCM Configuration for Encryption
export const AES_CONFIG = {
  ALGORITHM: 'aes-256-gcm',
  IV_LENGTH: 12,           // 96 bits (recommended for GCM)
  TAG_LENGTH: 16,          // 128 bits
  KEY_LENGTH: 32,          // 256 bits (must match PBKDF2_CONFIG.KEY_LENGTH)
} as const;

// Salt Configuration
export const SALT_CONFIG = {
  LENGTH: 32,              // 256 bits for salt generation
} as const;

// Password Hashing Configuration (Argon2id via Bun.password)
export const PASSWORD_HASH_CONFIG = {
  algorithm: 'argon2id' as const,
  memoryCost: 65536,       // 64MB memory cost in KB
  timeCost: 3,             // Iterations
} as const;

// Validation Constants
export const VALIDATION = {
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,   // Prevent DoS from extremely long passwords
  MAX_USERNAME_LENGTH: 50,
  MIN_USERNAME_LENGTH: 3,
  // Regex for password validation: uppercase, lowercase, digit, special char (length checked separately)
  // Restricts to safe character set: letters, digits, and specific special characters
  PASSWORD_REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[a-zA-Z\d@$!%*?&]+$/,
} as const;

// Export type-safe config objects
export type PBKDF2Config = typeof PBKDF2_CONFIG;
export type AESConfig = typeof AES_CONFIG;
export type SaltConfig = typeof SALT_CONFIG;
export type PasswordHashConfig = typeof PASSWORD_HASH_CONFIG;
export type ValidationConfig = typeof VALIDATION;

/**
 * Validates a password against length and pattern requirements.
 * Checks both min/max length constraints and character class requirements.
 *
 * @param pwd - Password string to validate
 * @returns True if the password meets all requirements (length and pattern)
 */
export function isPasswordValid(pwd: string): boolean {
  if (pwd.length < VALIDATION.MIN_PASSWORD_LENGTH || pwd.length > VALIDATION.MAX_PASSWORD_LENGTH) {
    return false;
  }
  return VALIDATION.PASSWORD_REGEX.test(pwd);
}