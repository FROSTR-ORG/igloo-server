type Subscriber = () => void

export class DBController<T> {
  private readonly _defaults  : T
  private readonly _store_key : string
  private readonly _subs      : Set<Subscriber> = new Set()
  private _pending_update     : boolean = false

  constructor (
    store_key : string,
    defaults  : T
  ) {
    this._defaults  = defaults
    this._store_key = store_key
  }

  get_defaults () : T {
    return this._defaults
  }

  get () : T {
    try {
      const item = localStorage.getItem(this._store_key)
      console.log('fetching from local storage:', item)
      return item ? JSON.parse(item) : this._defaults
    } catch (error) {
      console.error('error fetching from local storage:', error)
      return this._defaults
    }
  }

  reset () : void {
    this._atomic_set(this._defaults)
  }

  set (value : T ) : void {
    this._atomic_set(value)
  }

  subscribe (callback : Subscriber) : () => void {
    this._subs.add(callback)
    return () => this._subs.delete(callback)
  }

  update (value : Partial<T>) : void {
    // Prevent concurrent updates by queuing them
    if (this._pending_update) {
      setTimeout(() => this.update(value), 0)
      return
    }

    this._pending_update = true
    
    try {
      const current = this.get()
      const updated = this._merge(current, value)
      console.log('updating local storage:', updated)
      this._atomic_set(updated)
    } finally {
      this._pending_update = false
    }
  }

  private _atomic_set (value : T) : void {
    try {
      console.log('saving to local storage:', value)
      localStorage.setItem(this._store_key, JSON.stringify(value))
      this._notify_subs()
    } catch (error) {
      console.error('error saving to local storage:', error)
    }
  }

  private _notify_subs(): void {
    this._subs.forEach(subscriber => subscriber())
  }

  private _merge (target: any, source: any): T {
    const output = { ...target }
    
    if (this._is_object(target) && this._is_object(source)) {
      Object.keys(source).forEach(key => {
        if (this._is_object(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] })
          } else {
            output[key] = this._merge(target[key], source[key])
          }
        } else {
          Object.assign(output, { [key]: source[key] })
        }
      })
    }
    return output
  }

  private _is_object(item: any): boolean {
    return (item && typeof item === 'object' && !Array.isArray(item))
  }
}
