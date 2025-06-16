import { serve }                from 'bun'
import { createAndConnectNode } from '@frostr/igloo-core'
import { NostrRelay }           from './class/relay.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

import * as CONST   from './const.js'

// Load static files into memory
const index_page  = Bun.file('static/index.html')
const style_file  = Bun.file('static/style.css')
const script_file = Bun.file('static/app.js')

const relays = [ ...CONST.RELAYS, 'ws://localhost:8002' ]
const relay  = new NostrRelay()

// Create and connect the Bifrost node using igloo-core
const node = await createAndConnectNode({
  group: CONST.GROUP_CRED,
  share: CONST.SHARE_CRED,
  relays
})

// Helper functions for .env file management
const ENV_FILE_PATH = '.env'

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  const lines = content.split('\n')
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const equalIndex = trimmed.indexOf('=')
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim()
        const value = trimmed.substring(equalIndex + 1).trim()
        env[key] = value
      }
    }
  }
  
  return env
}

function stringifyEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n'
}

function readEnvFile(): Record<string, string> {
  try {
    if (existsSync(ENV_FILE_PATH)) {
      const content = readFileSync(ENV_FILE_PATH, 'utf-8')
      return parseEnvFile(content)
    }
    return {}
  } catch (error) {
    console.error('Error reading .env file:', error)
    return {}
  }
}

function writeEnvFile(env: Record<string, string>): boolean {
  try {
    const content = stringifyEnvFile(env)
    writeFileSync(ENV_FILE_PATH, content, 'utf-8')
    return true
  } catch (error) {
    console.error('Error writing .env file:', error)
    return false
  }
}

// HTTP Server
serve({
  port      : 8002,
  websocket : relay.handler(),
  fetch     : async (req, server) => {
    if (server.upgrade(req)) return
    const url = new URL(req.url)

    // API endpoints for .env management
    if (url.pathname.startsWith('/api/env')) {
      // Set CORS headers
      const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }

      // Handle preflight OPTIONS request
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers })
      }

      try {
        switch (url.pathname) {
          case '/api/env':
            if (req.method === 'GET') {
              const env = readEnvFile()
              return Response.json(env, { headers })
            }
            
            if (req.method === 'POST') {
              const body = await req.json()
              const env = readEnvFile()
              
              // Update environment variables
              Object.assign(env, body)
              
              if (writeEnvFile(env)) {
                return Response.json({ success: true, message: 'Environment variables updated' }, { headers })
              } else {
                return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers })
              }
            }
            break

          case '/api/env/delete':
            if (req.method === 'POST') {
              const { keys } = await req.json()
              const env = readEnvFile()
              
              // Delete specified keys
              for (const key of keys) {
                delete env[key]
              }
              
              if (writeEnvFile(env)) {
                return Response.json({ success: true, message: 'Environment variables deleted' }, { headers })
              } else {
                return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers })
              }
            }
            break
        }
        
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers })
      } catch (error) {
        console.error('API Error:', error)
        return Response.json({ error: 'Internal server error' }, { status: 500, headers })
      }
    }

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

// Note: No need to call node.connect() as createAndConnectNode handles the connection
