import { HEADLESS } from '../const.js'
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js'
import type { RouteContext, RequestAuth } from './types.js'

function parseSeq(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

function parseLimit(value: string | null, fallback = 200): number {
  if (!value) return fallback
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, 1), 500)
}

function parseBeforeSeq(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n
}

function parseTypes(value: string | null): string[] | undefined {
  if (!value) return undefined
  const parts = value.split(',').map(v => v.trim()).filter(Boolean)
  return parts.length ? parts : undefined
}

export async function handleEventLogRoute(
  req: Request,
  url: URL,
  _context: RouteContext,
  _auth: RequestAuth | null
): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/event-log')) return null

  // DB-mode only
  if (HEADLESS) {
    return Response.json({ error: 'UI event log unavailable in headless mode' }, { status: 404 })
  }

  const corsHeaders = getSecureCorsHeaders(req)
  const mergedVary = mergeVaryHeaders(corsHeaders)
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    'Vary': mergedVary,
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })

  // GET /api/event-log?limit=200&beforeSeq=123&types=sign,error
  if (url.pathname === '/api/event-log' && req.method === 'GET') {
    const limit = parseLimit(url.searchParams.get('limit'), 200)
    const beforeSeq = parseBeforeSeq(url.searchParams.get('beforeSeq'))
    const types = parseTypes(url.searchParams.get('types'))

    try {
      const { listUiEventLogEntries } = await import('../db/ui-event-log.js')
      const result = listUiEventLogEntries({ limit, beforeSeq, types })
      return Response.json(result, { headers })
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[event-log] list error:', error)
      }
      return Response.json({ error: 'Failed to list event log entries' }, { status: 500, headers })
    }
  }

  // GET /api/event-log/blob/<hash>
  if (url.pathname.startsWith('/api/event-log/blob/') && req.method === 'GET') {
    const hash = url.pathname.split('/').pop() || ''
    try {
      const { getUiEventLogBlob } = await import('../db/ui-event-log.js')
      const blob = getUiEventLogBlob(hash)
      if (!blob) return Response.json({ error: 'Not found' }, { status: 404, headers })
      return Response.json({ hash, ...blob }, { headers })
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[event-log] blob error:', error)
      }
      return Response.json({ error: 'Failed to fetch event log payload' }, { status: 500, headers })
    }
  }

  // GET /api/event-log/export?sinceSeq=1&untilSeq=9999&types=sign,error
  if (url.pathname === '/api/event-log/export' && req.method === 'GET') {
    const sinceSeq = parseSeq(url.searchParams.get('sinceSeq')) ?? 1
    const untilSeq = parseSeq(url.searchParams.get('untilSeq'))
    const types = parseTypes(url.searchParams.get('types'))

    const exportHeaders = {
      ...corsHeaders,
      'Vary': mergedVary,
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      // Hint browsers to download.
      'Content-Disposition': `attachment; filename="igloo-event-log-${new Date().toISOString().slice(0, 10)}.ndjson"`
    }

    try {
      const { exportUiEventLogChunk } = await import('../db/ui-event-log.js')
      const encoder = new TextEncoder()

      let afterSeq = Math.max(0, sinceSeq - 1)
      let done = false

      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (done) {
              controller.close()
              return
            }

            const chunk = exportUiEventLogChunk({
              afterSeq,
              untilSeq: untilSeq && untilSeq > 0 ? untilSeq : undefined,
              limit: 1000,
              types
            })

            if (!chunk.rows.length) {
              done = true
              controller.close()
              return
            }

            for (const row of chunk.rows) {
              const line = JSON.stringify({
                seq: row.seq,
                timestamp: new Date(row.createdAtMs).toISOString(),
                type: row.type,
                message: row.message,
                dataHash: row.dataHash,
                dataBytes: row.dataBytes,
                data: row.data ?? undefined
              }) + '\n'
              controller.enqueue(encoder.encode(line))
            }

            afterSeq = chunk.rows[chunk.rows.length - 1].seq
            if (chunk.nextAfterSeq === null) {
              done = true
            }
          } catch (err) {
            done = true
            controller.error(err)
          }
        }
      })

      return new Response(stream, { status: 200, headers: exportHeaders })
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[event-log] export error:', error)
      }
      return Response.json({ error: 'Failed to export event log' }, { status: 500, headers })
    }
  }

  return Response.json({ error: 'Not Found' }, { status: 404, headers })
}
