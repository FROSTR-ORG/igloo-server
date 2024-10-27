import type { Application }      from 'express'
import type { SignServerConfig } from '@/types.js'

import type {
  GroupPackage,
  SecretPackage
} from '@cmdcode/bifrost'

import express      from 'express'
import register_api from '@/api/index.js'

const DEFAULT_CONFIG : SignServerConfig = {
  port : 8082,
}

export default class PermaFrostServer {

  private _app   : Application
  private _conf  : SignServerConfig
  private _group : GroupPackage
  private _share : SecretPackage

  constructor (
    group_pkg : GroupPackage,
    share_pkg : SecretPackage,
    options   : Partial<SignServerConfig> = {}
  ) {
    this._conf  = { ...DEFAULT_CONFIG, ...options }
    this._group = group_pkg
    this._share = share_pkg
    this._app   = express()

    this._app.use(express.json())

    this._app.get('/api/status', (_, res) => {
      res.json({ status : 'ok' })
    })

    register_api(this)
  }

  get app () {
    return this._app
  }

  get conf () {
    return this._conf
  }

  get group () {
    return this._group
  }

  get share () {
    return this._share
  }

  listen (port? : number) {
    port = port ?? this._conf.port
    this.app.listen(port, () => {
      console.log(`Server running at http://127.0.0.1:${port}`)
    })
  }
}
