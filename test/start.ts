import PermaFrostServer from '@/index.js'

import {
  decode_group_pkg,
  decode_secret_pkg
} from '@cmdcode/bifrost/lib'

import assert from 'assert'

const GROUP_STR  = process.env['GROUP_STR']
const SECRET_STR = process.env['SECRET_STR']

assert.ok(GROUP_STR  !== undefined, 'GROUP_STR variable is undefined')
assert.ok(SECRET_STR !== undefined, 'SECRET_STR variable is undefined')

const gpkg = decode_group_pkg(GROUP_STR)
const spkg = decode_secret_pkg(SECRET_STR)

console.log('group pkg:', gpkg)
console.log('secret pkg:', spkg)

const server = new PermaFrostServer(gpkg, spkg)

server.listen()
