import { getEventHash } from 'nostr-tools'
import { get_record }   from '@cmdcode/bifrost/util'

import {
  create_psig_pkg,
  get_session_ctx,
  verify_psig_pkg
} from '@cmdcode/bifrost/lib'

import PermaFrostServer from '@/class/server.js'

export default function (server : PermaFrostServer) {

  server.app.post('/api/sign/note', (req, res) => {
    const { method, body } = req
  
    console.log('body:', body)
  
    if (method !== 'POST' || body === undefined) {
      console.log('invalid request')
      res.status(400).json({ error: 'invalid request' })
    }
    
    const { event, psig }       = body
    const { group_pk, commits } = server.group
    const msg    = getEventHash(event)
    console.log('msg:', msg)
    const ctx    = get_session_ctx(group_pk, commits, msg)
    console.log('ctx:', ctx)
    const commit = get_record(commits, psig.idx)
    console.log('commit:', commit)
  
    if (!verify_psig_pkg(ctx, psig)) {
      console.log('invalid parital signature')
      res.status(400).json({ error: 'invalid parital signature' })
      return
    }
  
    const psig2 = create_psig_pkg(ctx, server.share)
    if (!verify_psig_pkg(ctx, psig)) {
      console.log('invalid parital signature')
      res.status(400).json({ error: 'invalid parital signature' })
      return
    }
  
    res.json(psig2)
  })
}