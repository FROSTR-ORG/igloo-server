import { z }    from 'zod'
import { Buff } from '@cmdcode/buff'
import { now }  from './helpers.js'

import * as Crypto from './crypto.js'
import * as Schema from './schema.js'

export interface EventConfig {
  content    : string
  created_at : number
  kind       : number
  tags       : string[][]
}

export interface EventFilter {
  ids     ?: string[]
  authors ?: string[]
  kinds   ?: number[]
  since   ?: number
  until   ?: number
  limit   ?: number
  [ key : string ] : any | undefined
}

export interface EventTemplate extends EventConfig {
  pubkey : string
}

export interface SignedEvent extends EventTemplate {
  id  : string
  sig : string
}

export const event_schema = z.object({
  content    : Schema.str,
  created_at : Schema.stamp,
  id         : Schema.hex32,
  kind       : Schema.num,
  pubkey     : Schema.hex32,
  sig        : Schema.hex64,
  tags       : Schema.tags.array()
})

export const filter_schema = z.object({
  ids     : Schema.hex32.array().optional(),
  authors : Schema.hex32.array().optional(),
  kinds   : Schema.num.array().optional(),
  since   : Schema.stamp.optional(),
  until   : Schema.stamp.optional(),
  limit   : Schema.num.optional(),
}).catchall(Schema.tags)

/**
 * Creates a signed event envelope containing encrypted message content.
 * @param config   Event configuration
 * @param content  String content to encrypt and send
 * @param peer_pk  Recipient's public key
 * @param seckey   Sender's secret key in hex format
 * @returns        Signed Nostr event containing the encrypted message
 */
export function create_event (
  pubkey  : string,
  options : Partial<EventConfig>
) : EventTemplate {
  //
  const content = options.content ?? ''
  //
  const created_at = options.created_at ?? now()
  //
  const kind = options.kind ?? 1
  //
  const tags = options.tags ?? []
  // Return the event template.
  return { pubkey, content, created_at, kind, tags }
}

/**
 * Calculates a unique event ID based on the event template properties.
 * Creates a hash of the stringified array containing event details.
 * @param template  Nostr event template containing event properties
 * @returns        Hexadecimal hash string representing the event ID
 */
export function get_event_id (template : EventTemplate) {
  const preimg = JSON.stringify([
    0,
    template.pubkey,
    template.created_at,
    template.kind,
    template.tags,
    template.content,
  ])
  return Buff.str(preimg).digest.hex
}

/**
 * Signs a Nostr event with the provided secret key.
 * @param seckey    Secret key in hex format
 * @param template  Event template to sign
 * @returns         Signed event with ID and signature
 */
export function sign_event (
  seckey   : string,
  template : EventTemplate
) : SignedEvent {
  const id  = get_event_id(template)
  const sig = Crypto.sign_msg(seckey, id)
  return { ...template, id, sig }
}

/**
 * Parses an event from an unknown type to a SignedEvent.
 * @param event   Event to parse.
 * @returns       Signed event or null if invalid.
 */
export function parse_event (
  event : unknown,
  debug : boolean = false
) : SignedEvent | null{
  const parsed = event_schema.safeParse(event)
  if (debug && !parsed.success) {
    console.log(parsed.error)
  }
  return (parsed.success)
    ? parsed.data
    : null
}

/**
 * Verifies a signed Nostr event's integrity and signature.
 * @param event    Signed event to verify
 * @returns        True if valid, false otherwise
 */
export function verify_event (
  event : SignedEvent
) : boolean {
  const { id, sig, ...template } = event
  const vid = get_event_id(template)
  return (id === vid) && Crypto.verify_sig(id, event.pubkey, sig)
}


export function match_filter (
  event  : SignedEvent,
  filter : EventFilter = {}
) : boolean {
  const { authors, ids, kinds, since, until, limit, ...rest } = filter

  const tag_filters : string[][] = Object.entries(rest)
    .filter(e => e[0].startsWith('#'))
    .map(e => [ e[0].slice(1, 2), ...e[1] ])

  if (ids !== undefined && !ids.includes(event.id)) {
    return false
  } else if (since   !== undefined && event.created_at < since) {
    return false
  } else if (until   !== undefined && event.created_at > until) {
    return false
  } else if (authors !== undefined && !authors.includes(event.pubkey)) {
    return false
  } else if (kinds   !== undefined && !kinds.includes(event.kind)) {
    return false
  } else if (tag_filters.length > 0) {
    return match_tags(tag_filters, event.tags)
  } else {
    return true
  }
}

export function match_tags (
  filters : string[][],
  tags    : string[][]
) : boolean {
  for (const [ key, ...terms ] of filters) {
    for (const [ tag, ...params ] of tags) {
      if (tag === key) {
        for (const term of terms) {
          if (!params.includes(term)) {
            return false
          }
        }
      }
    }
  }
  return true
}
