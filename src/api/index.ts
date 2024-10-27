import PermaFrostServer  from '@/class/server.js'
import register_sign_api from './sign/index.js'

export default function (server : PermaFrostServer) {
  register_sign_api(server)
}
