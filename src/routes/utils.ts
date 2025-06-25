import { promises as fs } from 'fs';

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

// Security: Whitelist of allowed environment variable keys
const ALLOWED_ENV_KEYS = new Set([
  'SHARE_CRED',         // Share credential for signing
  'GROUP_CRED',         // Group credential for signing
  'RELAYS',             // Relay URLs configuration
  'CREDENTIALS_SAVED_AT' // Timestamp when credentials were last saved
]);

// Validate environment variable keys against whitelist
export function validateEnvKeys(keys: string[]): { validKeys: string[]; invalidKeys: string[] } {
  const validKeys = keys.filter(key => ALLOWED_ENV_KEYS.has(key));
  const invalidKeys = keys.filter(key => !ALLOWED_ENV_KEYS.has(key));
  return { validKeys, invalidKeys };
}

// Filter environment object to only include whitelisted keys
export function filterEnvObject(env: Record<string, string>): { 
  filteredEnv: Record<string, string>; 
  rejectedKeys: string[] 
} {
  const filteredEnv: Record<string, string> = {};
  const rejectedKeys: string[] = [];
  
  for (const [key, value] of Object.entries(env)) {
    if (ALLOWED_ENV_KEYS.has(key)) {
      filteredEnv[key] = value;
    } else {
      rejectedKeys.push(key);
    }
  }
  
  return { filteredEnv, rejectedKeys };
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
    return parseEnvFile(content);
  } catch (error) {
    // If file doesn't exist or other error, return empty object
    if ((error as any)?.code === 'ENOENT') {
      return {};
    }
    console.error('Error reading .env file:', error);
    return {};
  }
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
  
  const replacer = (key: string, value: any, depth = 0): any => {
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