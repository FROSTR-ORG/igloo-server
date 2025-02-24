import { Nostr } from '../util/index.js'

import type { SignedEvent } from '../util/index.js'

/**
 * Parses cookies from the request header.
 * @param cookie_str   Cookie string.
 * @returns            Cookies object.
 */
export function parse_cookies(cookie_str: string) {
  // Initialize an empty object to store cookies.
  const cookies : Record<string, string> = {}
  // Split the cookie string by the semicolon character.
  cookie_str.split(';').forEach(pair => {
    // Split the key-value pairs by the equals sign.
    const [ name, value ] = pair.trim().split('=')
    // If the name and value are present, add them to the cookies object.
    if (typeof name === 'string' && typeof value === 'string') {
      cookies[name] = value
    }
  })
  // Return the cookies object.
  return cookies
}

/**
 * Parses a challenge event from the request body.
 * @param req   Request object.
 * @returns     Signed event or null if invalid.
 */
export async function parse_challenge (
  req : Request
) : Promise<SignedEvent | null> {
  try {
    const body  = await req.json()
    const event = Nostr.parse_event(body)
    return (event !== null && Nostr.verify_event(event))
      ? event
      : null
  } catch (err) {
    return null
  }
}
