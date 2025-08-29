import { DBController } from '@/demo/class/controller.js'

import {
  DEFAULT_STORE,
  STORE_KEY
} from '@/demo/const.js'

import {
  createContext,
  useContext,
  useState,
  useEffect
} from 'react'

import type { AppStore }  from '@/demo/types/index.js'
import type { ReactNode } from 'react'

interface StoreAPI <T> {
  data   : T
  update : (store: Partial<T>) => void
  reset  : () => void
}

interface StoreProviderProps {
  children : ReactNode
}

function createStoreProvider<T> (
  controller : DBController<T>
) {

  const Context = createContext<StoreAPI<T> | null>(null)

  const StoreProvider = ({ children }: StoreProviderProps): JSX.Element => {
    const [ _store, _setStore ] = useState<T>(() => controller.get())

    // Subscribe to controller changes to keep React state in sync
    useEffect(() => {
      const unsubscribe = controller.subscribe(() => {
        _setStore(controller.get())
      })

      // Sync initial state in case controller changed before subscription
      _setStore(controller.get())

      return unsubscribe
    }, [])

    const reset = () => {
      controller.reset()
      // No need to manually update React state - subscription will handle it
    }

    const update = (store: Partial<T>) => {
      // Use controller's update method instead of set to get proper merging
      controller.update(store)
      // No need to manually update React state - subscription will handle it
    }

    return (
      <Context.Provider value={{ data : _store, reset, update }}>
        {children}
      </Context.Provider>
    )
  }

  const useStore = () => {
    const ctx = useContext(Context)
    if (ctx === null) {
      throw new Error('useStore must be used within a StoreProvider')
    }
    return ctx
  }

  return {
    StoreProvider,
    useStore
  }

}

export const StoreDB = new DBController<AppStore>(STORE_KEY, DEFAULT_STORE)
export const { StoreProvider, useStore } = createStoreProvider(StoreDB)
