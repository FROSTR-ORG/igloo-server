import { timingSafeEqual } from 'crypto';
import { ADMIN_SECRET, HEADLESS } from '../const.js';
import { isDatabaseInitialized, createUser } from '../db/database.js';
import { getSecureCorsHeaders } from './utils.js';
import { RouteContext } from './types.js';

export async function handleOnboardingRoute(
  req: Request,
  url: URL,
  _context: RouteContext // Unused but required for consistent interface
): Promise<Response | null> {
  // Skip onboarding routes in headless mode
  if (HEADLESS) {
    return null;
  }

  if (!url.pathname.startsWith('/api/onboarding')) return null;

  const corsHeaders = getSecureCorsHeaders(req);
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  try {
    switch (url.pathname) {
      case '/api/onboarding/status':
        if (req.method === 'GET') {
          // Check if database is initialized
          const initialized = isDatabaseInitialized();
          const hasAdminSecret = !!ADMIN_SECRET;
          
          return Response.json(
            {
              initialized,
              hasAdminSecret,
              headlessMode: false, // We already checked above
            },
            { headers }
          );
        }
        break;

      case '/api/onboarding/validate-admin':
        if (req.method === 'POST') {
          // Check if already initialized
          if (isDatabaseInitialized()) {
            return Response.json(
              { error: 'Database already initialized' },
              { status: 400, headers }
            );
          }

          // Check if admin secret is configured
          if (!ADMIN_SECRET) {
            return Response.json(
              { error: 'Admin secret not configured' },
              { status: 400, headers }
            );
          }

          const body = await req.json();
          const { adminSecret } = body;

          if (!adminSecret) {
            return Response.json(
              { error: 'Admin secret required' },
              { status: 400, headers }
            );
          }

          // Timing-safe comparison to prevent timing attacks
          const providedSecret = Buffer.from(adminSecret);
          const expectedSecret = Buffer.from(ADMIN_SECRET);

          if (
            providedSecret.length !== expectedSecret.length ||
            !timingSafeEqual(providedSecret, expectedSecret)
          ) {
            return Response.json(
              { error: 'Invalid admin secret' },
              { status: 401, headers }
            );
          }

          // Admin secret is valid, allow setup
          return Response.json(
            { success: true, message: 'Admin secret validated' },
            { headers }
          );
        }
        break;

      case '/api/onboarding/setup':
        if (req.method === 'POST') {
          // Check if already initialized
          if (isDatabaseInitialized()) {
            return Response.json(
              { error: 'Database already initialized' },
              { status: 400, headers }
            );
          }

          // Check if admin secret is configured
          if (!ADMIN_SECRET) {
            return Response.json(
              { error: 'Admin secret not configured' },
              { status: 400, headers }
            );
          }

          const body = await req.json();
          const { adminSecret, username, password } = body;

          if (!adminSecret || !username || !password) {
            return Response.json(
              { error: 'Admin secret, username, and password are required' },
              { status: 400, headers }
            );
          }

          // Validate admin secret again
          const providedSecret = Buffer.from(adminSecret);
          const expectedSecret = Buffer.from(ADMIN_SECRET);

          if (
            providedSecret.length !== expectedSecret.length ||
            !timingSafeEqual(providedSecret, expectedSecret)
          ) {
            return Response.json(
              { error: 'Invalid admin secret' },
              { status: 401, headers }
            );
          }

          // Validate username and password
          if (username.length < 3 || username.length > 50) {
            return Response.json(
              { error: 'Username must be between 3 and 50 characters' },
              { status: 400, headers }
            );
          }

          if (password.length < 8) {
            return Response.json(
              { error: 'Password must be at least 8 characters long' },
              { status: 400, headers }
            );
          }

          // Create the first user
          const result = await createUser(username, password);

          if (!result.success) {
            return Response.json(
              { error: result.error || 'Failed to create user' },
              { status: 400, headers }
            );
          }

          return Response.json(
            {
              success: true,
              message: 'User created successfully',
              userId: result.userId,
            },
            { headers }
          );
        }
        break;
    }

    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers }
    );
  } catch (error) {
    console.error('Onboarding API Error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers }
    );
  }
}