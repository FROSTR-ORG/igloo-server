import { concurrently } from 'concurrently'

const SERVE_HOST = 'http://localhost'
const SERVE_PORT = 3002

concurrently([
  `tsx scripts/build.ts --watch`,
  `serve dist -p ${SERVE_PORT}`
])

console.log(`webserver running at ${SERVE_HOST}:${SERVE_PORT}`)
