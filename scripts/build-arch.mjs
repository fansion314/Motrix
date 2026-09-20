#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPackage, createPackageWithOptions } from '@electron/asar'
import { writeArchNotices } from './generate-arch-notices.mjs'
import { stageElectronApp } from './stage-electron-app.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('Arch packages support Linux x86_64 only')
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const pkgrel = process.env.MOTRIX_ARCH_PKGREL || '1'
if (!/^[1-9]\d*$/.test(pkgrel)) throw new Error('Invalid Arch pkgrel')
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options })
const versions = JSON.parse(
  execFileSync(
    '/usr/bin/electron',
    ['-p', 'JSON.stringify(process.versions)'],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
    }
  )
)
run('node', [
  'scripts/fetch-engine.mjs',
  '--platform',
  'linux',
  '--arch',
  'x64',
])
// better-sqlite3 13 skips compilation while a vendor N-API prebuild exists.
// Stage our system-Electron build in the runtime contract's selected slot.
const sqlitePrebuild = 'node_modules/better-sqlite3/prebuilds/linux-x64.node'
await rm(sqlitePrebuild, { force: true })
run('pnpm', [
  'exec',
  'electron-rebuild',
  '--force',
  '--only',
  'better-sqlite3',
  '--version',
  versions.electron,
  '--build-from-source',
])
await cp(
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  sqlitePrebuild
)
run('/usr/bin/electron', ['scripts/ensure-native-abi.mjs', '--probe'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
run('pnpm', ['run', 'build:builtin'])
// Use Arch's native GNU toolchain rather than upstream's musl cross target.
for (const name of ['native-host', 'finalize-fs']) {
  run('cargo', [
    'build',
    '--release',
    '--locked',
    '--manifest-path',
    `packages/${name}/Cargo.toml`,
    '--bin',
    `motrix-${name}`,
  ])
}
await writeArchNotices()
for (const target of ['main', 'preload', 'worker', 'renderer']) {
  run('pnpm', ['exec', 'vite', 'build', '--config', `vite.${target}.config.ts`])
}
const { stageRoot } = await stageElectronApp({
  platform: 'linux',
  arch: 'x64',
  strict: true,
})
const metadata = {
  version: pkg.version,
  pkgrel,
  electron: versions.electron,
  electronAbi: versions.modules,
  arch: 'x86_64',
}
await writeFile(
  path.join(stageRoot, 'arch-build.json'),
  `${JSON.stringify(metadata, null, 2)}\n`
)
await cp('build/arch/entry.cjs', path.join(stageRoot, 'entry.cjs'))
const appManifestPath = path.join(stageRoot, 'package.json')
const appManifest = JSON.parse(await readFile(appManifestPath, 'utf8'))
appManifest.main = 'entry.cjs'
await writeFile(appManifestPath, `${JSON.stringify(appManifest, null, 2)}\n`)
const payload = path.join(root, 'dist/arch-root')
await rm(payload, { recursive: true, force: true })
const resources = path.join(payload, 'usr/lib/motrix2')
await mkdir(resources, { recursive: true })
await createPackageWithOptions(stageRoot, path.join(resources, 'app.asar'), {
  unpack: '**/*.node',
  unpackDir: 'dist/renderer',
})
const copy = async (from, to, mode) => {
  const destination = path.join(payload, to)
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(from, destination, { recursive: true })
  if (mode) await chmod(destination, mode)
}
for (const name of ['native-host', 'finalize-fs']) {
  await copy(
    `packages/${name}/target/release/motrix-${name}`,
    `usr/lib/motrix2/bin/motrix-${name}`,
    0o755
  )
}
await copy('extra/aria2.conf', 'usr/lib/motrix2/extra/aria2.conf')
await copy(
  'extra/linux/x64/aria2c',
  'usr/lib/motrix2/extra/linux/x64/aria2c',
  0o755
)
for (const name of await readdir('extra/tray')) {
  if (name.endsWith('.png'))
    await copy(`extra/tray/${name}`, `usr/lib/motrix2/extra/tray/${name}`)
}
await copy('dist/builtin-plugins', 'usr/lib/motrix2/builtin-plugins')
await copy('build/legal', 'usr/lib/motrix2/legal')
for (const name of ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.zh-CN.md']) {
  await copy(name, `usr/lib/motrix2/${name}`)
}
await copy('THIRD_PARTY_LICENSES', 'usr/lib/motrix2/THIRD_PARTY_LICENSES')
await copy('LICENSE', 'usr/share/licenses/motrix2/LICENSE')
await copy(
  'build/256x256.png',
  'usr/share/icons/hicolor/256x256/apps/motrix.png'
)
await copy('build/arch/motrix.desktop', 'usr/share/applications/motrix.desktop')
await copy('build/arch/motrix', 'usr/bin/motrix', 0o755)
await copy('build/arch/motrix', 'usr/bin/motrix2', 0o755)
await mkdir('release', { recursive: true })
const artifact = `release/motrix2-${pkg.version}-${pkgrel}-x86_64.asar`
await createPackage(payload, artifact)
console.log(`Built ${artifact} using system Electron ${versions.electron}`)
