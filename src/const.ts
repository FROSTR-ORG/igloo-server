// Parse RELAYS environment variable more robustly
export const RELAYS: string[] = (() => {
  const relaysEnv = process.env['RELAYS'];
  if (!relaysEnv) return [];
  
  try {
    // Try to parse as JSON first
    if (relaysEnv.startsWith('[')) {
      const parsed = JSON.parse(relaysEnv);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
        return parsed;
      } else {
        // Not a valid array of strings
        return [];
      }
    } else {
      // Handle comma-separated strings
      return relaysEnv.split(',').map(url => url.trim()).filter(url => url.length > 0);
    }
  } catch {
    return [];
  }
})();

export const HOST_NAME = process.env['HOST_NAME'] ?? 'localhost'
export const HOST_PORT = parseInt(process.env['HOST_PORT'] ?? '8002', 10)

// Raw credential strings for igloo-core functions - optional to allow server to start without them
export const GROUP_CRED = process.env['GROUP_CRED']
export const SHARE_CRED = process.env['SHARE_CRED']

// Admin secret for initial onboarding - treat empty/whitespace and sentinel value as absent
export const ADMIN_SECRET = (() => {
  const secret = process.env['ADMIN_SECRET'];
  if (!secret) return undefined;
  const trimmed = secret.trim();
  // Treat the env.example sentinel value as unset
  if (trimmed === 'REQUIRED_ADMIN_SECRET_NOT_SET') return undefined;
  return trimmed.length > 0 ? trimmed : undefined;
})();

// Headless mode - parse boolean flexibly (case-insensitive)
export const HEADLESS = (() => {
  const value = process.env['HEADLESS'];
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
})();

// Helper function to check if credentials are available
export const hasCredentials = () => GROUP_CRED !== undefined && SHARE_CRED !== undefined
