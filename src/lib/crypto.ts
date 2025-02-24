import { Buff } from '@cmdcode/buff'
import { gcm }  from '@noble/ciphers/aes'

export function encrypt_payload (
  secret  : string,
  payload : string,
  iv?     : string
) {
  const cbytes = Buff.str(payload)
  const sbytes = Buff.hex(secret)
  const vector = (iv !== undefined)
    ? Buff.hex(iv, 24)
    : Buff.random(24)
  const encrypted = gcm(sbytes, vector).encrypt(cbytes)
  return Buff.join([ vector, encrypted ]).b64url
}

export function decrypt_payload (
  secret  : string,
  payload : string
) {
  const cbytes    = Buff.b64url(payload)
  const sbytes    = Buff.hex(secret)
  const vector    = cbytes.slice(0, 24)
  const encrypted = cbytes.slice(24)
  const decrypted = gcm(sbytes, vector).decrypt(encrypted)
  return new Buff(decrypted).str
}
