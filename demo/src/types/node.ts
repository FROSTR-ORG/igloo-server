import type { SignerClient, SimpleSigner } from '@/source'

export type LogType      = 'info' | 'error' | 'warning' | 'success' | 'sign' | 'req' | 'res' | 'ready'
export type ClientStatus = 'online' | 'offline' | 'locked' | 'connecting' | 'loading'

export interface ClientState {
  client  : SignerClient
  signer  : SimpleSigner
}

export interface ClientController extends ClientState {
  status  : ClientStatus
  lock    : () => void
  unlock  : (password : string) => void
  reset   : () => void
}

export interface LogEntry {
  source    : string
  timestamp : number
  message   : string
  type      : string
  payload?  : any
}

export interface PeerStatus {
  pubkey  : string
  status  : 'online' | 'offline' | 'checking'
  updated : number
}

export interface RelayPolicy {
  url   : string
  read  : boolean
  write : boolean
}
