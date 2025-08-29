import { useClient } from '@/demo/hooks/useClient.js'

import {
  createContext,
  useContext
} from 'react'

import type { ReactNode } from 'react'

import type {
  ClientController
} from '@/demo/types/index.js'

interface ProviderProps {
  children : ReactNode
}

const Context = createContext<ClientController | null>(null)

export function ClientProvider ({ children }: ProviderProps): JSX.Element {
  const client = useClient()

  return (
    <Context.Provider value={client}>
      {children}
    </Context.Provider>
  )
}

export function useClientCtx () {
  const ctx = useContext(Context)
  if (ctx === null) {
    throw new Error('useNode must be used within a NodeProvider')
  }
  return ctx
}
