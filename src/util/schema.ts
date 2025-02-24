import { z } from 'zod'

export const zod   = z
export const big   = z.bigint()
export const bool  = z.boolean()
export const date  = z.date()
export const num   = z.number()
export const uint  = z.number().max(Number.MAX_SAFE_INTEGER)
export const str   = z.string()
export const stamp = z.number().min(500_000_000).max(Number.MAX_SAFE_INTEGER)
export const tags  = z.string().array()
export const url   = z.string().url()
export const any   = z.any()

export const hex = z.string()
  .regex(/^[0-9a-fA-F]*$/)
  .refine(e => e.length % 2 === 0)

export const literal = z.union([ z.string(), z.number(), z.boolean(), z.null() ])
export const hex16   = hex.refine((e) => e.length === 32)
export const hex20   = hex.refine((e) => e.length === 40)
export const hex32   = hex.refine((e) => e.length === 64)
export const hex64   = hex.refine((e) => e.length === 128)
export const base58  = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]+$/)
export const base64  = z.string().regex(/^[a-zA-Z0-9+/]+={0,2}$/)
export const b64url  = z.string().regex(/^[a-zA-Z0-9\-_]+={0,2}$/)
export const bech32  = z.string().regex(/^[a-z]+1[023456789acdefghjklmnpqrstuvwxyz]+$/)
