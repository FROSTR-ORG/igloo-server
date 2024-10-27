import PermaFrostServer       from '@/class/server.js'
import register_sign_note_api from './note.js'

export default function (server : PermaFrostServer) {
  register_sign_note_api(server)
}
