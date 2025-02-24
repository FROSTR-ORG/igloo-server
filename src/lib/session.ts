import { Buff } from '@cmdcode/buff'

import { Cipher, Util } from '../util/index.js'

import {
  parse_challenge,
  parse_cookies
} from './util.js'

import * as CONST from '../const.js'

interface SessionCookie {
  id      : string
  is_auth : boolean
  created : number
  expires : number
}

export function create_session () {
  const session : SessionCookie = {
    id      : Buff.random(32).hex,
    is_auth : false,
    created : Util.now(),
    expires : Util.now() + 3600,
  }

  const payload   = JSON.stringify(session)
  const encrypted = Cipher.encrypt_payload(CONST.SESSION_KEY, payload)

  return new Response(session.id, {
    status  : 200,
    headers : { "Set-Cookie": `session=${encrypted}; HttpOnly; Path=/; Max-Age=3600` },
  })
}

export async function verify_session (req: Request) {
  const session = get_session(req)

  if (session === null) {
    return new Response('no session exists', { status: 403 })
  }

  const event = await parse_challenge(req)

  if (event === null) {
    return new Response('invalid request', { status: 400 })
  }

  if (event.content !== session.id) {
    return new Response('invalid request', { status: 400 })
  }

  const payload   = JSON.stringify({ ...session, is_auth: true })
  const encrypted = Cipher.encrypt_payload(CONST.SESSION_KEY, payload)

  return new Response('authentication successful', {
    status  : 200,
    headers : { "Set-Cookie": `session=${encrypted}; HttpOnly; Path=/; Max-Age=3600` },
  })
}

export function get_session (req: Request) : SessionCookie | null {
  try {
    const cookies = parse_cookies(req.headers.get("Cookie") || "")
    if (typeof cookies.session === 'string') {
      const payload = Cipher.decrypt_payload(CONST.SESSION_KEY, cookies.session)
      return JSON.parse(payload)
    } else {
      return null
    }
  } catch (err) {
    return null
  }
}

export function clear_session () {
  return new Response('session cleared', {
    status  : 200,
    headers : { "Set-Cookie": `session=; HttpOnly; Path=/; Max-Age=0` },
  })
}
