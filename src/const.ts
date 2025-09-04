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

// Admin secret for initial onboarding
export const ADMIN_SECRET = process.env['ADMIN_SECRET']

// Headless mode - when true, uses env-based configuration instead of database
export const HEADLESS = process.env['HEADLESS'] === 'true'

// Helper function to check if credentials are available
export const hasCredentials = () => GROUP_CRED !== undefined && SHARE_CRED !== undefined
