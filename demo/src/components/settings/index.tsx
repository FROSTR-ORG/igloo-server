import { RelayConfig }         from './relays.js'
import { ResetStore }          from './reset.js'
import { SecretConfig }        from './secret.js'
import { NotificationConfig }  from './notifications.js'

export function Settings () {
  return (
    <>
      <SecretConfig />
      <RelayConfig       />
      <NotificationConfig />
      <ResetStore        />
    </>
  )
}
