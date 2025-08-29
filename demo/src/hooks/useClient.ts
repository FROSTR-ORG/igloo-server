import { useState, useEffect } from 'react'
import { decrypt_secret }      from '@/demo/lib/crypto.js'
import { useLogs }             from '@/demo/context/logs.js'
import { useStore }            from '@/demo/context/store.js'

import {
  CONST,
  SimpleSigner,
  SignerClient
} from '@/source'

import type {
  ClientController,
  ClientStatus,
  LogEntry,
  LogType,
} from '@/demo/types/index.js'

import type { SignerSession, PermissionRequest } from '@/types/index.js'

const SIGN_METHOD = CONST.AUTH_METHOD

export function useClient () : ClientController {
  // Configure the client hook state.
  const [ _status, setStatus ] = useState<ClientStatus>('loading')
  const [ _client, setClient ] = useState<SignerClient | null>(null)
  // Configure the store and logs context.
  const store = useStore()
  const logs  = useLogs()

  const lock = () => {
    setClient(null)
    setStatus('locked')
  }

  // Reset the client.
  const reset = () => {
    // If the client is not initialized, return early.
    if (!_client) return
    // Clear logs when resetting client state.
    logs.clearLogs()
    // Get the relay urls.
    const urls = store.data.relays.map(r => r.url)
    // Subscribe to the relays.
    _client.socket.subscribe(urls)
  }

  const unlock = (password : string) => {
    // If the client is already initialized, return early.
    if (_client) return
    // Clear logs when resetting client state.
    logs.clearLogs()
    // Get the store data.
    const { encrypted, relays, sessions } = store.data
    // Get the relay urls.
    const urls = Array.from(new Set([
      ...relays.map(r => r.url),
      ...sessions.flatMap(s => s.relays)
    ]))
    // If no encrypted secret is provided, return early.
    if (!encrypted) return
    // Get the seckey from the encrypted secret.
    const seckey = decrypt_secret(encrypted, password)
    // Create a new client.
    const client = create_client(urls, seckey, sessions)
      // Handle the ready event.
  const handleReady = () => {
    console.log('client initialized')
    setStatus('online')
  }
  // Handle closed events.
  const handleClosed = () => setStatus('offline')
  // Handle error events.
  const handleError  = () => setStatus('offline')

  // Handle session changes.
  const handleSessionChange = () => {
    const updated = client.session.active ?? []
    store.update({ sessions: updated })
  }

  // Catch-all handler for logging event activity.
  const handleAllEvents = (source : string, event: string, ...rest : any[]) => {
    // Skip note events and message events.
    if (event === 'event')   return
    if (event === 'message') return
    // Log the event and data.
    console.log(`[ ${source} ] '${event}' event:`, ...rest)
    // Get the log entry.
    const log_entry = get_log_entry(source, event, rest)
    // Add log entry using logs context
    logs.addLog(log_entry)
  }

  // Attach all event listeners
  client.socket.on('ready',   handleReady)
  client.socket.on('closed',  handleClosed)
  client.socket.on('error',   handleError)

  client.session.on('active',  handleSessionChange)
  client.session.on('revoked', handleSessionChange)
  client.session.on('updated', handleSessionChange)

  client.request.on('approve', (request)         => request_accept_handler(client, request))
  client.request.on('deny',    (request, reason) => request_deny_handler(client, request, reason))

  client.request.on('*', (event, data, error) => handleAllEvents('request', event, data, error))
  client.session.on('*', (event, data, error) => handleAllEvents('session', event, data, error))
  client.socket.on('*',  (event, data, error) => handleAllEvents('socket', event, data, error))

  if (client.socket.relays.length > 0) {
    client.socket.subscribe()
    setStatus('connecting')
  } else {
    setStatus('offline')
  }
    // Set the client.
    setClient(client)
  }

  // Lock the client when the encrypted secret changes.
  useEffect(() => {
    lock()
  }, [ store.data.encrypted ])

  // Subscribe to new relays when the relay list changes.
  useEffect(() => {
    if (_client) {
      const urls = store.data.relays.map(r => r.url)
      _client.socket.subscribe(urls)
    }
  }, [ store.data.relays ])

  return { client: _client, status: _status, unlock, reset, lock } as ClientController
}

function create_client (
  relays   : string[],
  seckey   : string | Uint8Array,
  sessions : SignerSession[] = []
) : SignerClient {
  // Create a new signing device.
  const signer = new SimpleSigner(seckey)
  // Create a new signer client.
  return new SignerClient(signer, { relays, sessions })
}

async function request_accept_handler (
  client  : SignerClient,
  request : PermissionRequest
) {
  // Get the methods from the signer.
  const methods = client.signer.get_methods()
  // If the method is not supported, return early.
  if (!methods.includes(request.method)) {
    client.request.deny(request, 'method not supported: ' + request.method)
    return
  }
  // Try to handle the request.
  try {
    if (request.method === SIGN_METHOD.SIGN_EVENT) {
      // Get the event.
      const json = request?.params?.at(0)
      // If the event is not a string, return early.
      if (!json) return
      // Parse the event.
      const event  = JSON.parse(json)
      // Sign the event.
      const signed = await client.signer.sign_event(event)
      // Respond to the request.
      client.request.resolve(request, JSON.stringify(signed))
    }
    if (request.method === SIGN_METHOD.NIP04_DECRYPT) {
      const peer_pubkey = request?.params?.at(0)
      const ciphertext  = request?.params?.at(1)
      if (!peer_pubkey || !ciphertext) return
      const decrypted = await client.signer.nip04_decrypt(peer_pubkey, ciphertext)
      client.request.resolve(request, decrypted)
    }
    if (request.method === SIGN_METHOD.NIP04_ENCRYPT) {
      const peer_pubkey = request?.params?.at(0)
      const plaintext   = request?.params?.at(1)
      if (!peer_pubkey || !plaintext) return
      const encrypted = await client.signer.nip04_encrypt(peer_pubkey, plaintext)
      client.request.resolve(request, encrypted)
    }
    if (request.method === SIGN_METHOD.NIP44_DECRYPT) {
      const peer_pubkey = request?.params?.at(0)
      const ciphertext  = request?.params?.at(1)
      if (!peer_pubkey || !ciphertext) return
      const decrypted = await client.signer.nip44_decrypt(peer_pubkey, ciphertext)
      client.request.resolve(request, decrypted)
    }
    if (request.method === SIGN_METHOD.NIP44_ENCRYPT) {
      const peer_pubkey = request?.params?.at(0)
      const plaintext   = request?.params?.at(1)
      if (!peer_pubkey || !plaintext) return
      const encrypted = await client.signer.nip44_encrypt(peer_pubkey, plaintext)
      client.request.resolve(request, encrypted)
    }
  } catch (error) {
    console.error('Error handling request:', error)
    client.request.deny(request, 'error handling request')
  }
}

function request_deny_handler (
  client  : SignerClient,
  request : PermissionRequest,
  reason? : string
) {
  client.request.reject(request, reason ?? 'denied by user')
}

function get_log_entry (
  source : string,
  event  : string,
  ...rest : any[]
) : LogEntry {
  // Define the log type, message, and payload.
  let type    : LogType = 'info'
  let message : string  = String(event)
  let payload : any     = rest.at(0)
  // Determine log type based on event
  if (message.toLowerCase() === 'ready') {
    type    = 'ready'
    message = 'client ready'
    payload = undefined
  } else if (message.startsWith('closed')) {
    type    = 'info'
    message = 'connection closed'
    payload = undefined
  } else if (message.startsWith('subscribed')) {
    type    = 'info'
    message = 'subscribed to relays'
  } else if (message.startsWith('error')) {
    type    = 'error'
    message = 'client error'
  } else if (message.startsWith('bounced')) {
    type    = 'error'
    message = 'message bounced: ' + rest.at(1)
  }

  // Clean up empty payloads
  if (typeof payload === 'object' && payload !== null && Object.keys(payload).length === 0) {
    payload = undefined
  }

  // Create a new log entry.
  return {
    source,
    message   : message,
    payload   : payload,
    timestamp : Date.now(),
    type      : type
  }
}