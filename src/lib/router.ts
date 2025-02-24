import type { Request } from 'bun'
import * as Session from './session.js'

type RouteHandler = (req: Request) => Promise<Response> | Response

export class Router {
  private routes: Map<string, Record<string, RouteHandler>>

  constructor() {
    this.routes = new Map()
  }

  get(path: string, handler: RouteHandler) {
    this.addRoute('GET', path, handler)
  }

  post(path: string, handler: RouteHandler) {
    this.addRoute('POST', path, handler)
  }

  private addRoute(method: string, path: string, handler: RouteHandler) {
    const handlers = this.routes.get(path) || {}
    handlers[method] = handler
    this.routes.set(path, handlers)
  }

  async handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url)
    const handlers = this.routes.get(url.pathname)

    if (!handlers) {
      return null
    }

    const handler = handlers[req.method]
    if (!handler) {
      return new Response('Method not allowed', { status: 405 })
    }

    return handler(req)
  }
}

// Create and configure router
export function createRouter(admin_page: BunFile) {
  const router = new Router()

  // Auth routes
  router.get('/login', () => Session.create_session())
  router.post('/login', (req) => Session.verify_session(req))
  router.get('/logout', () => Session.clear_session())

  // Admin page
  router.get('/admin', () => {
    return new Response(admin_page, {
      headers: { "Content-Type": "text/html" },
      status: 200,
    })
  })

  return router
}