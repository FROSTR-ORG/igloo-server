import { Buff }   from '@vbyte/buff'
import { nip19 }  from 'nostr-tools'
import { gcm }    from '@noble/ciphers/aes'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha2' 
import { Assert } from '@vbyte/micro-lib/assert'
import { B64url } from '@vbyte/micro-lib/encode'

const PKDF_OPT = { c: 100000, dkLen: 32 }

export function create_encryption_key (
  password : string,
  salt     : Uint8Array
) : Uint8Array {
  const encoder = new TextEncoder()
  const pbytes  = encoder.encode(password)
  Assert.ok(salt.length >= 16, 'salt must be at least 16 bytes')
  return pbkdf2(sha256, pbytes, salt, PKDF_OPT)
}

export function decode_secret (secret: string) : Uint8Array | null {
  try {
    if (secret.startsWith('nsec1')) {
      const decoded = nip19.decode(secret).data as Uint8Array
      return Buff.bytes(decoded)
    } else if (Buff.is_hex(secret) && secret.length === 64) {
      return Buff.bytes(secret)
    } else {
      return null
    }
  } catch {
    return null
  }
}

export function encode_nsec (seckey: string) : string | null {
  try {
    const sbytes = Buff.bytes(seckey)
    return nip19.nsecEncode(sbytes)
  } catch {
    return null
  }
}

export function encrypt_secret (
  secret   : string | Uint8Array,
  password : string
) : string {
  const sbytes  = Buff.bytes(secret)
  const vector  = Buff.random(24)
  const enc_key = create_encryption_key(password, vector)
  const payload = gcm(enc_key, vector).encrypt(sbytes)
  return B64url.encode(new Buff(payload)) + '?iv=' + B64url.encode(vector)
}

export function decrypt_secret (
  content  : string,
  password : string
) : Uint8Array {
  Assert.ok(content.includes('?iv='), 'encrypted content must include iv')
  const [ payload, iv ] = content.split('?iv=')
  const pbytes  = B64url.decode(payload)
  const vector  = B64url.decode(iv)
  const enc_key = create_encryption_key(password, vector)
  const seckey  = gcm(enc_key, vector).decrypt(pbytes)
  return new Buff(seckey)
}
