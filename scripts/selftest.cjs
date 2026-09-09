/**
 * Sandbox tests for the parts that touch the real filesystem.
 *
 * Everything happens inside a throwaway folder under the temp directory — the
 * deletion guard is exercised deliberately, so this must never be pointed at
 * anything real.
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const {
  findProjects,
  measureProject,
  measureTree,
  isRemovable,
  isRootLike,
  removeTarget,
} = require('../electron/scanner.cjs')
const { planMove } = require('../electron/mover.cjs')
const { JobManager } = require('../electron/jobs.cjs')
const { discoverJunk, isJunkPath, emptyJunk } = require('../electron/appJunk.cjs')
const { acceptLeftovers, findLeftovers, removeLeftover, nameTokens } = require('../electron/programs.cjs')

const SANDBOX = path.join(os.tmpdir(), 'reclaim-selftest')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const state = { cancelled: false }

let failures = 0
function check(ok, message) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${message}`)
  if (!ok) failures += 1
}
function section(title) {
  console.log(`\n${title}`)
}

function seedProject(name, { files = 40, withGradle = false } = {}) {
  const root = path.join(SANDBOX, name)
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })

  if (withGradle) fs.writeFileSync(path.join(root, 'build.gradle'), 'plugins {}')
  else fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { vite: '5' } }))

  fs.writeFileSync(path.join(root, 'src', 'index.ts'), Buffer.alloc(1500, 1))
  for (let index = 0; index < files; index += 1) {
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', `m${index}.js`), Buffer.alloc(1000, 2))
  }
  fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), Buffer.alloc(30_000, 3))
  return root
}

async function testScanner() {
  section('scanner')
  const dirs = await findProjects(SANDBOX, state, 4)
  check(dirs.length === 2, `discovery found both projects (${dirs.length})`)

  const project = await measureProject(path.join(SANDBOX, 'alpha'), 'p1', state)
  check(project !== null && project.kind === 'node', `alpha detected as a node project (${project && project.kind})`)

  const nodeModules = project.targets.find((target) => target.folder === 'node_modules')
  check(nodeModules && nodeModules.bytes === 40_000, `node_modules measured exactly (${nodeModules && nodeModules.bytes})`)

  const targetBytes = project.targets.reduce((sum, target) => sum + target.bytes, 0)
  const rest = project.totalBytes - targetBytes
  check(rest > 1500 && rest < 2000, `source counted once, outside the targets (${rest} bytes)`)

  const android = await measureProject(path.join(SANDBOX, 'beta'), 'p2', state)
  check(android !== null && android.kind === 'android', `beta detected as a gradle project (${android && android.kind})`)
}

async function testGuards() {
  section('deletion guards')
  check(!isRemovable(path.join(SANDBOX, 'alpha', 'src')), 'src is refused')
  check(!isRemovable('C:\\Windows'), 'a system folder is refused')
  check(!isRemovable('D:\\node_modules'), 'a shallow path is refused')
  check(!isRemovable('node_modules'), 'a relative path is refused')
  check(isRemovable(path.join(SANDBOX, 'alpha', 'node_modules')), 'a real node_modules is allowed')
  check(isRootLike(process.env.USERPROFILE || 'C:\Users\someone'), 'the user profile is never a project')
  check(isRootLike('D:'), 'a drive root is never a project')
  check(!isRootLike(path.join(SANDBOX, 'alpha')), 'an ordinary folder can be one')
  const profile = await planMove(process.env.USERPROFILE || 'C:\Users\someone', SANDBOX)
  check(profile.ok === false, `moving the profile folder is refused: ${profile.message}`)

  const refused = await removeTarget(path.join(SANDBOX, 'alpha', 'src'), state)
  check(refused.ok === false, `deleting src is refused: ${refused.error}`)
  check(fs.existsSync(path.join(SANDBOX, 'alpha', 'src', 'index.ts')), 'src survived')
}

async function testDeletion() {
  section('deletion')
  const target = path.join(SANDBOX, 'alpha', 'node_modules')
  const before = await measureTree(target, state, null)

  let lastProgress = 0
  const result = await removeTarget(target, state, undefined, before, (done) => {
    lastProgress = done
  })

  check(result.ok === true, `node_modules deleted (${result.error ?? 'no error'})`)
  check(result.bytes === before.bytes, `freed bytes match what was measured (${result.bytes})`)
  check(lastProgress === before.files, `progress reported every file (${lastProgress}/${before.files})`)
  check(!fs.existsSync(target), 'the folder is gone')
  check(fs.existsSync(path.join(SANDBOX, 'alpha', 'package.json')), 'package.json untouched')

  const again = await removeTarget(target, state)
  check(again.ok === true && again.bytes === 0, 'deleting a folder that is already gone is a no-op')
}

async function testLockedFile() {
  section('locked files')
  const target = path.join(SANDBOX, 'beta', 'node_modules')
  const locked = path.join(target, 'pkg', 'held.bin')
  fs.writeFileSync(locked, Buffer.alloc(4096, 7))

  // FileShare.None from PowerShell is a genuine exclusive lock; Node's own
  // open() permits deletion, so it cannot stand in for one here. Stop on error
  // so a holder that failed to take the lock never reports itself ready.
  const script = path.join(SANDBOX, 'holder.ps1')
  fs.writeFileSync(
    script,
    "param([string]$Path)\n" +
      "$ErrorActionPreference = 'Stop'\n" +
      "$s = [System.IO.File]::Open($Path, 'Open', 'ReadWrite', 'None')\n" +
      'Write-Output "LOCKED $PID"\n' +
      '[Console]::Out.Flush()\n' +
      'while ($true) { Start-Sleep -Seconds 1 }\n',
  )

  const holder = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', locked],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
  )

  const ready = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15000)
    holder.stdout.on('data', (chunk) => {
      if (/LOCKED \d+/.test(String(chunk))) {
        clearTimeout(timer)
        resolve(true)
      }
    })
  })

  if (!ready) {
    check(false, 'could not start the file holder')
    holder.kill()
    return
  }

  await sleep(300)
  const result = await removeTarget(target, state)
  check(result.ok === false, 'a locked folder is reported as not fully removed')
  check(result.files > 0, `the unlocked files went anyway (${result.files})`)
  check(result.locked.length > 0, 'the blocking path is reported back')

  holder.kill()
  await sleep(900)
  const retry = await removeTarget(target, state)
  check(retry.ok === true, `retrying once the holder exits succeeds (${retry.error ?? 'no error'})`)
}

async function testJobs() {
  section('background jobs')
  const manager = new JobManager()
  const gamma = seedProject('gamma', { files: 20 })
  const targets = ['node_modules', 'dist'].map((folder) => ({
    id: `gamma::${folder}`,
    path: path.join(gamma, folder),
  }))

  const log = []
  const runner = (ctx) => async () => {
    for (const target of targets) {
      if (ctx.state.cancelled) break
      if (ctx.state.wait) await ctx.state.wait()
      if (ctx.state.cancelled) break
      await removeTarget(target.path, ctx.state, ctx.throttle())
      log.push(target.path)
      await sleep(120)
    }
    return { folders: log.length }
  }

  const undone = manager.create({
    type: 'clean',
    label: 'grace',
    graceMs: 700,
    run: (ctx) => runner(ctx)(),
  })
  check(undone.status === 'grace', 'a deletion starts on the runway, not running')
  await sleep(150)
  const cancelled = manager.cancel(undone.id)
  check(cancelled.undone === true, 'cancelling inside the window reports an undo')
  await sleep(900)
  check(log.length === 0, 'nothing was deleted')
  check(fs.existsSync(targets[0].path), 'the folder survived')

  const committed = manager.create({ type: 'clean', label: 'commit', graceMs: 200, run: (ctx) => runner(ctx)() })
  await new Promise((resolve) => manager.once('job-finished', resolve))
  check(committed.status === 'done', `a deletion past the window runs (${committed.status})`)
  check(!fs.existsSync(targets[0].path), 'the folder is gone')
}

/**
 * The app-cache cleaner never touches anything it did not discover itself.
 * Discovery runs against the real profile (read-only); emptying is exercised
 * on the sandbox by handing it a fake allow-list, which is the only way in.
 */
async function testAppJunk() {
  section('app caches')
  const discovered = await discoverJunk()
  check(Array.isArray(discovered), `discovery answers with a list (${discovered.length} folders)`)
  check(
    discovered.every((entry) => path.isAbsolute(entry.path) && entry.id === entry.path.toLowerCase()),
    'every entry is absolute and keyed by its lower-cased path',
  )
  const nested = discovered.filter((entry) =>
    discovered.some((other) => other !== entry && entry.id.startsWith(`${other.id}${path.sep}`)),
  )
  check(nested.length === 0, `no entry sits inside another (${nested.length})`)
  check(
    discovered.every((entry) => entry.note && entry.label && entry.appLabel && ['safe', 'caution'].includes(entry.safety)),
    'every entry explains itself',
  )

  check(!(await isJunkPath(path.join('C:', 'Windows'), discovered)), 'a system folder is refused')
  check(!(await isJunkPath(SANDBOX, discovered)), 'an undiscovered folder is refused')
  check(!(await isJunkPath('Cache', discovered)), 'a relative path is refused')
  if (discovered.length > 0) {
    const inside = path.join(discovered[0].path, 'child')
    check(!(await isJunkPath(inside, discovered)), 'a path inside a discovered folder is refused')
    check(await isJunkPath(discovered[0].path.toUpperCase(), discovered), 'a discovered folder is allowed whatever its case')
  }

  const target = path.join(SANDBOX, 'delta', 'Cache')
  fs.mkdirSync(path.join(target, 'deeper'), { recursive: true })
  fs.writeFileSync(path.join(target, 'a.bin'), Buffer.alloc(2048, 1))
  fs.writeFileSync(path.join(target, 'deeper', 'b.bin'), Buffer.alloc(4096, 2))

  const refused = await emptyJunk(target, state, undefined, null, null, discovered)
  check(refused.ok === false && fs.existsSync(path.join(target, 'a.bin')), `an undiscovered folder is left alone: ${refused.error}`)

  const allowed = [{ id: target.toLowerCase(), path: target }]
  const emptied = await emptyJunk(target, state, undefined, null, null, allowed)
  check(emptied.ok === true, `an allowed folder is emptied (${emptied.error ?? 'no error'})`)
  check(emptied.bytes === 6144, `freed bytes are what was inside (${emptied.bytes})`)
  check(fs.existsSync(target), 'the folder itself is kept')
  check(fs.readdirSync(target).length === 0, 'and it is empty')
}

/** Leftover deletion is guarded twice: an offer list in main, a structural check in the worker. */
async function testLeftovers() {
  section('program leftovers')
  check(JSON.stringify(nameTokens('Microsoft Visual Studio Code (User)')) === JSON.stringify(['visual', 'studio', 'code']), `name tokens skip noise words (${nameTokens('Microsoft Visual Studio Code (User)').join(',')})`)
  check(nameTokens('Node.js 22.9.0').length === 1 && nameTokens('Node.js 22.9.0')[0] === 'node', 'version numbers are not tokens')

  check(acceptLeftovers('never-offered', [path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'thing')]).length === 0, 'nothing is accepted for a program that was never offered')

  const program = { id: 'test:prog', name: 'Rocket Selftest Widget', publisher: 'Rocket', installLocation: path.join(SANDBOX, 'apps', 'Rocket Selftest Widget') }
  fs.mkdirSync(path.join(program.installLocation, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(program.installLocation, 'bin', 'widget.dll'), Buffer.alloc(3000, 5))
  const offered = await findLeftovers(program)
  check(offered.some((entry) => entry.path.toLowerCase() === program.installLocation.toLowerCase()), 'the surviving install folder is offered as a leftover')
  check(acceptLeftovers(program.id, [program.installLocation.toUpperCase()]).length === 1, 'an offered path is accepted whatever its case')
  check(acceptLeftovers(program.id, [path.join(program.installLocation, 'bin')]).length === 0, 'a path inside an offered folder is refused')
  check(acceptLeftovers(program.id, [path.join('C:', 'Windows')]).length === 0, 'a system folder is refused even for an offered program')

  const refused = await removeLeftover(path.join('C:', 'Users', 'someone', 'Desktop'), state)
  check(refused.ok === false, `a protected folder is refused by the worker guard: ${refused.error}`)
  const removed = await removeLeftover(program.installLocation, state)
  check(removed.ok === true && removed.bytes === 3000, `an offered folder is deleted outright (${removed.bytes} bytes)`)
  check(!fs.existsSync(program.installLocation), 'and it is gone')
}

(async () => {
  console.log(`sandbox: ${SANDBOX}`)
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  seedProject('alpha')
  seedProject('beta', { withGradle: true })

  await testScanner()
  await testGuards()
  await testDeletion()
  await testLockedFile()
  await testJobs()
  await testAppJunk()
  await testLeftovers()

  fs.rmSync(SANDBOX, { recursive: true, force: true })

  console.log('')
  if (failures === 0) {
    console.log('all self-tests passed')
    process.exit(0)
  }
  console.log(`${failures} failed`)
  process.exit(1)
})().catch((error) => {
  console.error('self-test crashed', error)
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true })
  } catch {
    /* the sandbox may already be gone */
  }
  process.exit(1)
})
