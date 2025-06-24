// Parse RELAYS environment variable more robustly
export const RELAYS: string[] = (() => {
  const relaysEnv = process.env['RELAYS'];
  if (!relaysEnv) return [];
  
  try {
    // Try to parse as JSON first
    if (relaysEnv.startsWith('[')) {
      return JSON.parse(relaysEnv);
    } else {
      // Handle comma-separated strings
      return relaysEnv.split(',').map(url => url.trim()).filter(url => url.length > 0);
    }
  } catch {
    return [];
  }
})();

export const HOST_NAME = process.env['HOST_NAME'] ?? 'localhost'
export const HOST_PORT = process.env['HOST_PORT'] ?? 8002

// Raw credential strings for igloo-core functions - optional to allow server to start without them
export const GROUP_CRED = process.env['GROUP_CRED']
export const SHARE_CRED = process.env['SHARE_CRED']

// Helper function to check if credentials are available
export const hasCredentials = () => GROUP_CRED !== undefined && SHARE_CRED !== undefined
