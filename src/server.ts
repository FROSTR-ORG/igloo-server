import { serve }       from 'bun'
import { BifrostNode } from '@frostr/bifrost'
import { NostrRelay }  from './class/relay.js'

import * as CONST   from './const.js'

// Load static files into memory
const index_page  = Bun.file('static/index.html')
const style_file  = Bun.file('static/style.css')
const script_file = Bun.file('static/app.js')

const relays = [ ...CONST.RELAYS, 'ws://localhost:8002' ]
const node   = new BifrostNode(CONST.GROUP, CONST.SHARE, relays)
const relay  = new NostrRelay()

// HTTP Server
serve({
  port      : 8002,
  websocket : relay.handler(),
  fetch     : async (req, server) => {
    if (server.upgrade(req)) return
    const url = new URL(req.url)

    // Serve static files
    switch (url.pathname) {
      case '/style.css':
        return new Response(style_file, {
          headers: { 'Content-Type': 'text/css' }
        })

      case '/app.js':
        return new Response(script_file, {
          headers: { 'Content-Type': 'text/javascript' }
        })

      default:
        return new Response(index_page, {
          headers: { 'Content-Type': 'text/html' }
        })
    }
  }
})

console.log(`Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`)

node.on('*', (event : any) => {
  if (event !== 'message') {
    console.log('[ bifrost ]', event)
  }
})

node.connect()
