/**
 * Starts Vite, waits for it, then starts Electron against it.
 *
 * This used to be a `concurrently` one-liner, but arguments passed through
 * `npm start -- --scan D:\Dev` landed after the quoted sub-commands and never
 * reached Electron. Doing it here means whatever you type after `--` is handed
 * straight to the app.
 */
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const HOST = '127.0.0.1'
const PORT = 5173
const READY_TIMEOUT_MS = 60_000

const forwarded = process.argv.slice(2)
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

let shuttingDown = false
const children = []

function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...options })
  children.push(child)
  return child
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  children.forEach((child) => {
    try {
      child.kill()
    } catch {
      /* it may already be gone */
    }
  })
  process.exit(code)
}

/** Resolves once something is listening, so Electron never loads a dead URL. */
function waitForPort() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: HOST, port: PORT })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) reject(new Error(`Vite did not come up on ${HOST}:${PORT}`))
        else setTimeout(attempt, 200)
      })
    }
    attempt()
  })
}

const vite = run(npx, ['vite', '--host', HOST])
vite.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`\n[reclaim] the dev server exited (${code})`)
    shutdown(code ?? 1)
  }
})

waitForPort().
then(() => {
  const electron = run(npx, ['electron', '.', ...forwarded], {
    env: { ...process.env, VITE_DEV_SERVER_URL: `http://${HOST}:${PORT}` },
  })
  electron.on('exit', (code) => shutdown(code ?? 0))
}).
catch((error) => {
  console.error(`[reclaim] ${error.message}`)
  shutdown(1)
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
