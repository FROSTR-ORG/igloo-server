import { Buff }   from '@cmdcode/buff'
import { gcm }    from '@noble/ciphers/aes'
import { sha256 } from '@noble/hashes/sha256'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { PBKDF2_CONFIG, SALT_CONFIG } from '../config/crypto.js'

export function derive_secret (
  password  : string,
  rand_salt : string
) {
  const pass_bytes = Buff.str(password).digest
  
  // Strict salt validation: expect SALT_CONFIG.LENGTH bytes as hex
  const EXPECTED_HEX_LENGTH = SALT_CONFIG.LENGTH * 2; // 32 bytes = 64 hex chars
  if (rand_salt.length !== EXPECTED_HEX_LENGTH) {
    throw new Error(
      `Invalid salt length: expected ${SALT_CONFIG.LENGTH} bytes (${EXPECTED_HEX_LENGTH} hex chars), got ${rand_salt.length} chars`
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(rand_salt)) {
    throw new Error('Invalid salt format: must be hexadecimal string');
  }
  
  const salt_bytes = Buffer.from(rand_salt, 'hex')
  
  // Use proper iteration count and key length from config
  const options    = { c: PBKDF2_CONFIG.ITERATIONS, dkLen: PBKDF2_CONFIG.KEY_LENGTH }
  const secret     = pbkdf2(sha256, pass_bytes, salt_bytes, options)
  return new Buff(secret).hex
}

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
