import {
  decode_group_pkg,
  decode_share_pkg
} from '@frostr/bifrost/lib'

import type { GroupPackage, SharePackage } from '@frostr/bifrost'

if (process.env['GROUP_CRED'] === undefined) {
  throw new Error('GROUP_CRED is not set')
}

if (process.env['SHARE_CRED'] === undefined) {
  throw new Error('SHARE_CRED is not set')
}

export const RELAYS : string[]= process.env['RELAYS'] !== undefined
  ? process.env['RELAYS'].split(',').filter(url => url.trim() !== '')
  : []

export const HOST_NAME = process.env['HOST_NAME'] ?? 'localhost'
export const HOST_PORT = process.env['HOST_PORT'] ?? 8002

export const GROUP  : GroupPackage = decode_group_pkg(process.env['GROUP_CRED'])
export const SHARE  : SharePackage = decode_share_pkg(process.env['SHARE_CRED'])
