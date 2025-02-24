import { EventEmitter }  from 'node:events'
import { Nostr, Schema } from '../util/index.js'

import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { EventFilter, SignedEvent }          from '../util/index.js'

/* ================ [ Interfaces ] ================ */

type ClientWebSocket = ServerWebSocket<RelaySession>

interface NostrRelayConfig {
  purge_ival : number
  debug      : boolean
  info       : boolean
}

interface Subscription {
  filters  : EventFilter[]
  instance : RelaySession, 
  sub_id   : string
}

/* ================ [ Schema ] ================ */

const sub_schema = Schema.zod.tuple([ Schema.str ]).rest(Nostr.filter_schema)

/* ================ [ Class ] ================ */

const DEFAULT_CONFIG : NostrRelayConfig = {
  purge_ival : 30,
  debug      : false,
  info       : true,
}

export class NostrRelay extends EventEmitter {

  private readonly _config   : NostrRelayConfig
  private readonly _subs     : Map<string, Subscription>

  private _cache : SignedEvent[]

  public conn : number

  constructor (options : Partial<NostrRelayConfig> = {}) {
    super()
    this._cache    = []
    this._config   = { ...DEFAULT_CONFIG, ...options }
    this._subs     = new Map()
    this.conn      = 0
  }

  get cache () {
    return this._cache
  }

  get config () {
    return this._config
  }

  get log () {
    return {
      debug  : (...msg : any[]) => this.config.debug && console.log(`[ debug  ]`, ...msg),
      info   : (...msg : any[]) => this.config.info  && console.log(`[ info   ]`, ...msg),
    }
  }

  get subs () {
    return this._subs
  }

  handler () : WebSocketHandler<RelaySession> {
    return {
      open: (ws: ClientWebSocket) => {
        ws.data = new RelaySession(this, ws)
        this.conn += 1
      },
      message: (ws, msg: string | Buffer) => {
        ws.data._handler(msg.toString())
      },
      close: (ws, code: number) => {
        ws.data._cleanup(code)
      }
    }
  }

  async start () {
    this.log.info('[ relay ] output mode:', this.config.debug ? 'debug' : this.config.info ? 'info' : 'silent')

    return new Promise(res => {
      this.log.info(`[ relay ] purging events every ${this.config.purge_ival} seconds`)
      setInterval(() => {
        this._cache = []
      }, this.config.purge_ival * 1000)
      this.emit('ready')
      res(this)
    })
  }

  store (event : SignedEvent) {
    this._cache = this._cache.concat(event).sort((a, b) => a > b ? -1 : 1)
  }
}

/* ================ [ Instance Class ] ================ */

class RelaySession {

  private readonly _sid    : string
  private readonly _relay  : NostrRelay
  private readonly _socket : ClientWebSocket
  private readonly _subs   : Set<string>

  constructor (
    relay  : NostrRelay,
    socket : ClientWebSocket
  ) {
    this._relay  = relay
    this._sid    = Math.random().toString().slice(2, 8)
    this._socket = socket
    this._subs   = new Set()

    this.log.client('client connected')
  }

  get sid () {
    return this._sid
  }

  get relay () {
    return this._relay
  }

  get socket () {
    return this._socket
  }

  _cleanup (code : number) {
    this.socket.close()
    for (const subId of this._subs) {
      this.remSub(subId)
    }
    this.relay.conn -= 1
    this.log.client(`[ ${this._sid} ]`, 'client disconnected with code:', code)
  }

  _handler (message : string) {
    let verb : string, payload : any

    try {
      [ verb, ...payload ] = JSON.parse(message)
      assert(typeof verb === 'string')

      switch (verb) {
        case 'REQ':
          const [ id, ...filters ] = sub_schema.parse(payload)
          return this._onreq(id, filters)
        case 'EVENT':
          const event = Nostr.parse_event(payload.at(0), this.relay.config.debug)
          if (event === null) return
          return this._onevent(event)
        case 'CLOSE':
          const subid = Schema.str.parse(payload.at(0))
          return this._onclose(subid)
        default:
          this.log.info('unable to handle message type:', verb)
          this.send(['NOTICE', '', 'Unable to handle message'])
      }
    } catch (e) {
      this.log.debug('failed to parse message:\n\n', message)
      return this.send(['NOTICE', '', 'Unable to parse message'])
    }
  }

  _onclose (sub_id : string) {
    this.log.info('closed subscription:', sub_id)
    this.remSub(sub_id)
  }

  _onerr (err : Error) {
    this.log.info('socket encountered an error:\n\n', err)
  }

  _onevent (event : SignedEvent) {
    this.log.client('received event id:', event.id)
    this.log.debug('event:', event)

    if (!Nostr.verify_event(event)) {
      this.log.debug('event failed validation:', event)
      this.send([ 'OK', event.id, false, 'event failed validation' ])
      return
    }

    this.send([ 'OK', event.id, true, '' ])
    this.relay.store(event)

    for (const { filters, instance, sub_id } of this.relay.subs.values()) {
      for (const filter of filters) {
        if (Nostr.match_filter(event, filter)) {
          instance.log.client(`event matched subscription: ${sub_id}`)
          instance.send(['EVENT', sub_id, event])
        }
      }
    }
  }

  _onreq (
    sub_id  : string,
    filters : EventFilter[]
  ) : void {
    this.log.client('received subscription request:', sub_id)
    this.log.debug('filters:', filters)
    // Add the subscription to our set.
    this.addSub(sub_id, filters)
    // For each filter:
    for (const filter of filters) {
      // Set the limit count, if any.
      let limit_count = filter.limit
      // For each event in the cache:
      for (const event of this.relay.cache) {
        // If there is no limit, or we are above the limit:
        if (limit_count === undefined || limit_count > 0) {
          // If the event matches the current filter:
          if (Nostr.match_filter(event, filter)) {
            // Send the event to the client.
            this.send(['EVENT', sub_id, event])
            this.log.client(`event matched in cache: ${event.id}`)
            this.log.client(`event matched subscription: ${sub_id}`)
          }
          // Update the limit count.
          if (limit_count !== undefined) limit_count -= 1
        } 
      }
    }
    // Send an end of subscription event.
    this.log.debug('sending EOSE for subscription:', sub_id)
    this.send(['EOSE', sub_id])
  }

  get log () {
    return {
      client : (...msg : any[]) => this.relay.config.info  && console.log(`[ client ][ ${this._sid} ]`, ...msg),
      debug  : (...msg : any[]) => this.relay.config.debug && console.log(`[ debug  ][ ${this._sid} ]`, ...msg),
      info   : (...msg : any[]) => this.relay.config.info  && console.log(`[ info   ][ ${this._sid} ]`, ...msg),
    }
  }

  addSub (
    sub_id     : string,
    ...filters : EventFilter[]
  ) {
    const uid = `${this.sid}/${sub_id}`
    this.relay.subs.set(uid, { filters, instance: this, sub_id })
    this._subs.add(sub_id)
  }

  remSub (subId : string) {
    this.relay.subs.delete(subId)
    this._subs.delete(subId)
  }

  send (message : any[]) {
    this._socket.send(JSON.stringify(message))
  }
}

/* ================ [ Methods ] ================ */

function assert (value : unknown) : asserts value {
  if (value === false) throw new Error('assertion failed!')
}
