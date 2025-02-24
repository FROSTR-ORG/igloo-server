import { Buff }               from '@cmdcode/buff'
import { secp256k1, schnorr } from '@noble/curves/secp256k1'
import { mod }                from '@noble/curves/abstract/modular'

/**
 * Generates a new secret key for use with secp256k1.
 * @param secret   Optional seed value to generate deterministic key
 * @returns        Secret key in hex format
 */
export function gen_seckey (
  secret ?: string
) : string {
  let sbig = (secret !== undefined)
    ? Buff.hex(secret).big
    : Buff.random(32).big
  sbig = mod(sbig, secp256k1.CURVE.n)
  return Buff.big(sbig).hex
}

/**
 * Derives a public key from a secret key using schnorr.
 * @param seckey   Secret key in hex format
 * @returns        Public key in hex format
 */
export function get_pubkey (
  seckey : string
) : string {
  const pbytes = schnorr.getPublicKey(seckey)
  return new Buff(pbytes).hex
}

/**
 * Computes a shared secret between two parties using ECDH.
 * @param seckey    Local party's secret key in hex format
 * @param peer_pk   Remote party's public key in hex format
 * @returns         Shared secret in hex format
 */
export function get_shared_secret (
  seckey  : string,
  peer_pk : string
) : string {
  const pubkey = (peer_pk.length === 66)
    ? peer_pk 
    : '02' + peer_pk
  const sbytes = secp256k1.getSharedSecret(seckey, pubkey, true)
  return new Buff(sbytes).slice(1).hex
}

/**
 * Signs a message using Schnorr signature scheme.
 * @param seckey    Secret key in hex format
 * @param message   Message to sign
 * @returns         Signature in hex format
 */
export function sign_msg (
  seckey  : string,
  message : string
) {
  const sig = schnorr.sign(message, seckey)
  return new Buff(sig).hex
}

/**
 * Verifies a Schnorr signature for a message.
 * @param message    Original message that was signed
 * @param pubkey     Signer's public key in hex format
 * @param signature  Signature to verify in hex format
 * @returns         True if signature is valid, false otherwise
 */
export function verify_sig (
  message   : string,
  pubkey    : string,
  signature : string
) {
  return schnorr.verify(signature, message, pubkey)
}
