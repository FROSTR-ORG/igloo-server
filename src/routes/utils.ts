import { promises as fs } from 'fs';

// Binary helpers
/**
 * Convert a Uint8Array or ArrayBuffer to a lowercase hex string without mutating the input.
 */
export function bytesToHex(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const hex: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    hex[i] = (v < 16 ? '0' : '') + v.toString(16);
  }
  return hex.join('');
}

/**
 * Converts binary data (Uint8Array or Buffer) to a lowercase hex string.
 * Returns null and logs a warning if input is invalid or empty.
 */
export function binaryToHex(data: Uint8Array | Buffer): string | null {
  if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) {
    console.warn('Invalid binary data: expected Uint8Array or Buffer');
    return null;
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length === 0) {
    console.warn('Invalid binary data: empty array');
    return null;
  }
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return hex.toLowerCase();
}

// Helper function to get valid relay URLs
export function getValidRelays(envRelays?: string): string[] {
  // Use single default relay as requested
  const defaultRelays = ['wss://relay.primal.net'];
  
  if (!envRelays) {
    return defaultRelays;
  }
  
  try {
    let relayList: string[] = [];
    
    // Try to parse as JSON first
    if (envRelays.startsWith('[')) {
      relayList = JSON.parse(envRelays);
    } else {
      // Handle comma-separated or space-separated strings
      relayList = envRelays
        .split(/[,\s]+/)
        .map(relay => relay.trim())
        .filter(relay => relay.length > 0);
    }
    
    // Validate each relay URL and exclude localhost to avoid conflicts
    const validRelays = relayList.filter(relay => {
      try {
        const url = new URL(relay);
        // Exclude localhost relays to avoid conflicts with our server
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          console.warn(`Excluding localhost relay to avoid conflicts: ${relay}`);
          return false;
        }
        return url.protocol === 'ws:' || url.protocol === 'wss:';
      } catch {
        return false;
      }
    });
    
    // If no valid relays, use default
    if (validRelays.length === 0) {
      console.warn('No valid relays found, using default relay');
      return defaultRelays;
    }
    
    // Respect user's relay configuration exactly as they set it
    return validRelays;
  } catch (error) {
    console.warn('Error parsing relay URLs, using default:', error);
    return defaultRelays;
  }
}

// Helper functions for .env file management
const ENV_FILE_PATH = '.env';

// Security: Whitelist of allowed environment variable keys (for write/validation)
// IMPORTANT: SESSION_SECRET must NEVER be included here - it's strictly server-only
const ALLOWED_ENV_KEYS = new Set([
  'SHARE_CRED',         // Share credential for signing
  'GROUP_CRED',         // Group credential for signing
  'RELAYS',             // Relay URLs configuration
  'GROUP_NAME',         // Display name for the signing group
  'CREDENTIALS_SAVED_AT', // Timestamp when credentials were last saved
  // Advanced settings - server configuration
  'SESSION_TIMEOUT',    // Session timeout in seconds
  'RATE_LIMIT_ENABLED', // Enable/disable rate limiting
  'RATE_LIMIT_WINDOW',  // Rate limit time window in seconds
  'RATE_LIMIT_MAX',     // Maximum requests per window
  'NODE_RESTART_DELAY', // Initial delay before node restart attempts
  'NODE_MAX_RETRIES',   // Maximum node restart attempts
  'NODE_BACKOFF_MULTIPLIER', // Exponential backoff multiplier
  'NODE_MAX_RETRY_DELAY', // Maximum delay between retry attempts
  'INITIAL_CONNECTIVITY_DELAY', // Initial delay before connectivity check
  'ALLOWED_ORIGINS'     // CORS allowed origins configuration
  // SESSION_SECRET explicitly excluded - must never be exposed via API
]);

// Public environment variable keys that can be exposed through GET endpoints
// Only include non-sensitive keys. Do NOT include signing credentials.
const PUBLIC_ENV_KEYS = new Set([
  'RELAYS',             // Relay URLs configuration
  'GROUP_NAME',         // Display name for the signing group
  'CREDENTIALS_SAVED_AT', // Timestamp when credentials were last saved
  // Advanced settings - safe to expose for configuration UI
  'SESSION_TIMEOUT',    // Session timeout in seconds
  'RATE_LIMIT_ENABLED', // Enable/disable rate limiting
  'RATE_LIMIT_WINDOW',  // Rate limit time window in seconds
  'RATE_LIMIT_MAX',     // Maximum requests per window
  'NODE_RESTART_DELAY', // Initial delay before node restart attempts
  'NODE_MAX_RETRIES',   // Maximum node restart attempts
  'NODE_BACKOFF_MULTIPLIER', // Exponential backoff multiplier
  'NODE_MAX_RETRY_DELAY', // Maximum delay between retry attempts
  'INITIAL_CONNECTIVITY_DELAY', // Initial delay before connectivity check
  'ALLOWED_ORIGINS'     // CORS allowed origins configuration
  // SESSION_SECRET, SHARE_CRED, GROUP_CRED explicitly excluded from public exposure
]);

// Security hardening: forbid sensitive keys from ever being allowed or public
const FORBIDDEN_ENV_KEYS = new Set(['SESSION_SECRET']);

/**
 * Asserts that no forbidden sensitive keys (e.g., SESSION_SECRET) are present
 * in either the allowed or public environment key sets. This runs at module
 * initialization to fail fast during startup if future edits accidentally
 * include forbidden keys. Also exported for explicit startup checks/tests.
 */
export function assertNoSessionSecretExposure(): true {
  for (const forbidden of FORBIDDEN_ENV_KEYS) {
    if (ALLOWED_ENV_KEYS.has(forbidden) || PUBLIC_ENV_KEYS.has(forbidden)) {
      throw new Error(
        `SECURITY VIOLATION: Forbidden env key "${forbidden}" must never be included in ALLOWED_ENV_KEYS or PUBLIC_ENV_KEYS.`
      );
    }
  }
  return true;
}

// Execute the assertion at module initialization time
assertNoSessionSecretExposure();

// Validate environment variable keys against whitelist
export function validateEnvKeys(keys: string[]): { validKeys: string[]; invalidKeys: string[] } {
  // Always reject forbidden keys, even if a future change mistakenly whitelists them
  const sanitizedKeys = keys.filter(key => !FORBIDDEN_ENV_KEYS.has(key));
  const validKeys = sanitizedKeys.filter(key => ALLOWED_ENV_KEYS.has(key));
  const invalidKeys = keys.filter(key => !validKeys.includes(key));
  return { validKeys, invalidKeys };
}

// Filter environment object to only include whitelisted keys (for validation/write operations)
export function filterEnvObject(env: Record<string, string>): { 
  filteredEnv: Record<string, string>; 
  rejectedKeys: string[] 
} {
  const filteredEnv: Record<string, string> = {};
  const rejectedKeys: string[] = [];
  
  for (const [key, value] of Object.entries(env)) {
    // Explicitly reject forbidden keys
    if (FORBIDDEN_ENV_KEYS.has(key)) {
      rejectedKeys.push(key);
      continue;
    }
    if (ALLOWED_ENV_KEYS.has(key)) {
      filteredEnv[key] = value;
    } else {
      rejectedKeys.push(key);
    }
  }
  
  return { filteredEnv, rejectedKeys };
}

// Filter environment object for public exposure (excludes sensitive keys like SESSION_SECRET)
export function filterPublicEnvObject(env: Record<string, string>): Record<string, string> {
  const publicEnv: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(env)) {
    if (FORBIDDEN_ENV_KEYS.has(key)) {
      // Never expose forbidden keys, even if present in env
      continue;
    }
    if (PUBLIC_ENV_KEYS.has(key)) {
      publicEnv[key] = value;
    }
  }
  
  return publicEnv;
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim();
        const value = trimmed.substring(equalIndex + 1).trim();
        env[key] = value;
      }
    }
  }
  
  return env;
}

function stringifyEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
}

export async function readEnvFile(): Promise<Record<string, string>> {
  try {
    await fs.access(ENV_FILE_PATH);
    const content = await fs.readFile(ENV_FILE_PATH, 'utf-8');
    const fileEnv = parseEnvFile(content);
    
    // Merge with actual environment variables as fallback
    const envVars = getEnvVarsFromProcess();
    return { ...envVars, ...fileEnv }; // File takes precedence over process env
  } catch (error) {
    // If file doesn't exist or other error, fall back to process environment variables
    if ((error as any)?.code === 'ENOENT') {
      return getEnvVarsFromProcess();
    }
    console.error('Error reading .env file:', error);
    return getEnvVarsFromProcess();
  }
}

// Safe wrapper that reads env file and filters out sensitive keys
// Use this in GET/read endpoints to prevent accidental exposure of secrets
export async function readPublicEnvFile(): Promise<Record<string, string>> {
  const env = await readEnvFile();
  return filterPublicEnvObject(env);
}

// Helper function to get environment variables from process.env
function getEnvVarsFromProcess(): Record<string, string> {
  const envVars: Record<string, string> = {};
  
  // Include all allowed keys from process.env (but never forbidden),
  // so HEADLESS deployments can inject secrets without a .env file.
  for (const key of ALLOWED_ENV_KEYS) {
    if (FORBIDDEN_ENV_KEYS.has(key)) continue;
    const value = process.env[key];
    if (value !== undefined) {
      envVars[key] = value;
    }
  }
  
  return envVars;
}

// Get the modification time of the environment file
export async function getEnvFileModTime(): Promise<string | null> {
  try {
    const stats = await fs.stat(ENV_FILE_PATH);
    return stats.mtime.toISOString();
  } catch (error) {
    // File doesn't exist or error accessing it
    return null;
  }
}

// Get the saved timestamp for credentials, with fallback to file modification time
export async function getCredentialsSavedAt(): Promise<string | null> {
  try {
    const env = await readEnvFile();
    
    // First, try to get the explicit saved timestamp
    if (env.CREDENTIALS_SAVED_AT) {
      return env.CREDENTIALS_SAVED_AT;
    }
    
    // Fall back to file modification time if we have credentials but no timestamp
    if (env.SHARE_CRED && env.GROUP_CRED) {
      return await getEnvFileModTime();
    }
    
    return null;
  } catch (error) {
    console.error('Error getting credentials saved time:', error);
    return null;
  }
}

// Enhanced writeEnvFile that automatically sets the save timestamp
export async function writeEnvFileWithTimestamp(env: Record<string, string>): Promise<boolean> {
  try {
    // Add timestamp when saving credentials
    if (env.SHARE_CRED || env.GROUP_CRED) {
      env.CREDENTIALS_SAVED_AT = new Date().toISOString();
    }
    
    const content = stringifyEnvFile(env);
    await fs.writeFile(ENV_FILE_PATH, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Error writing .env file:', error);
    return false;
  }
}

export async function writeEnvFile(env: Record<string, string>): Promise<boolean> {
  try {
    const content = stringifyEnvFile(env);
    await fs.writeFile(ENV_FILE_PATH, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Error writing .env file:', error);
    return false;
  }
}

export function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    case 'webp': return 'image/webp';
    case 'ico': return 'image/x-icon';
    case 'css': return 'text/css';
    case 'js': return 'text/javascript';
    case 'html': return 'text/html';
    case 'json': return 'application/json';
    default: return 'application/octet-stream';
  }
}

// Helper function to safely serialize data with circular reference handling
export function safeStringify(obj: any, maxDepth = 3): string {
  const seen = new WeakSet();
  
  const replacer = (_key: string, value: any, depth = 0): any => {
    if (depth > maxDepth) {
      return '[Max Depth Reached]';
    }
    
    if (value === null || typeof value !== 'object') {
      return value;
    }
    
    if (seen.has(value)) {
      return '[Circular Reference]';
    }
    
    seen.add(value);
    
    if (Array.isArray(value)) {
      return value.map((item, index) => replacer(String(index), item, depth + 1));
    }
    
    const result: any = {};
    for (const [k, v] of Object.entries(value)) {
      // Skip functions and undefined values
      if (typeof v === 'function' || v === undefined) {
        continue;
      }
      // Explicitly skip sensitive binary keys to avoid accidental exposure
      if (k === 'derivedKey') {
        continue;
      }
      result[k] = replacer(k, v, depth + 1);
    }
    
    return result;
  };
  
  try {
    return JSON.stringify(replacer('', obj));
  } catch (error) {
    return JSON.stringify({
      error: 'Failed to serialize object',
      type: typeof obj,
      constructor: obj?.constructor?.name || 'Unknown'
    });
  }
}

// Utility function to get secure CORS headers based on request origin
export function getSecureCorsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};

  // Get allowed origins from environment variable
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  const requestOrigin = req.headers.get('origin');

  if (allowedOriginsEnv && requestOrigin) {
    // Parse allowed origins (comma-separated list)
    const allowedOrigins = allowedOriginsEnv
      .split(',')
      .map(origin => origin.trim())
      .filter(origin => origin.length > 0);

    // Check if request origin is in allowed list
    if (allowedOrigins.includes(requestOrigin) || allowedOrigins.includes('*')) {
      headers['Access-Control-Allow-Origin'] = requestOrigin;
    }
    // If origin is not allowed, don't set the header (CORS will block the request)
  } else if (!allowedOriginsEnv) {
    // If ALLOWED_ORIGINS is not set, fall back to wildcard for development
    // In production, ALLOWED_ORIGINS should always be configured
    headers['Access-Control-Allow-Origin'] = '*';
    if (process.env.NODE_ENV === 'production') {
      console.warn('SECURITY WARNING: ALLOWED_ORIGINS not configured in production. Using wildcard (*) for CORS.');
    }
  }

  return headers;
} 