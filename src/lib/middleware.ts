import type { Request } from 'bun'
import * as Session from './session.js'

export type NextFunction = () => Promise<Response> | Response
export type Middleware = (req: Request, next: NextFunction) => Promise<Response> | Response

/**
 * Checks if user is authenticated, serves login page if not
 */
export function requireAuth(index_page: BunFile, admin_page: BunFile): Middleware {
  return (req: Request, next: NextFunction) => {
    const session = Session.get_session(req)
    
    if (session !== null && session.is_auth) {
      return next()
    }

    return new Response(index_page, {
      headers: { "Content-Type": "text/html" },
      status: 200,
    })
  }
}

/**
 * Serves static files from the src/static directory
 */
export function staticFiles(): Middleware {
  return async (req: Request, next: NextFunction) => {
    const url = new URL(req.url)
    
    if (!url.pathname.startsWith('/static/')) {
      return next()
    }

    const path = join('src', url.pathname)
    const file = Bun.file(path)
    const exists = await file.exists()
    
    if (!exists) {
      return new Response('Not Found', { status: 404 })
    }

    const contentType = path.endsWith('.css') 
      ? 'text/css'
      : path.endsWith('.js')
        ? 'text/javascript'
        : 'text/plain'

    return new Response(file, {
      headers: { 'Content-Type': contentType }
    })
  }
} 