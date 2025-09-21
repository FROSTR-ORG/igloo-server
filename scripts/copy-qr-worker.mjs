import { copyFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const source = resolve(projectRoot, 'node_modules', 'qr-scanner', 'qr-scanner-worker.min.js')
const destinationDir = resolve(projectRoot, 'static')
const destination = resolve(destinationDir, 'qr-scanner-worker.min.js')

async function main() {
  try {
    await mkdir(destinationDir, { recursive: true })
    await copyFile(source, destination)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[copy-qr-worker] Copied worker to ${destination}`)
    }
  } catch (error) {
    console.error('[copy-qr-worker] Failed to copy qr-scanner worker:', error)
    process.exitCode = 1
  }
}

main()
