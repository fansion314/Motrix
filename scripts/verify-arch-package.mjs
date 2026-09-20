#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractAll, extractFile, listPackage, statFile } from '@electron/asar'

export function validateArchEntries(entries) {
  for (const entry of entries) {
    const name = entry.replace(/^\//, '')
    assert(!name.split('/').includes('..'), `Unsafe archive entry: ${entry}`)
    assert(
      name === 'usr' || name.startsWith('usr/'),
      `Unexpected archive entry: ${entry}`
    )
    assert(
      !/(^|\/)(electron|chrome-sandbox|app-update\.yml)$/.test(name),
      `Bundled system runtime: ${entry}`
    )
  }
  for (const required of [
    'usr/lib/motrix2/app.asar',
    'usr/lib/motrix2/bin/motrix-native-host',
    'usr/lib/motrix2/bin/motrix-finalize-fs',
    'usr/bin/motrix',
    'usr/bin/motrix2',
    'usr/share/applications/motrix.desktop',
    'usr/lib/motrix2/extra/aria2.conf',
    'usr/lib/motrix2/extra/linux/x64/aria2c',
  ]) {
    assert(entries.includes(`/${required}`), `Missing ${required}`)
  }
}

export async function verifyArchPackage(archive, { smoke = false } = {}) {
  archive = path.resolve(archive)
  validateArchEntries(listPackage(archive))
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'motrix-arch-'))
  try {
    extractAll(archive, temporary)
    const resources = path.join(temporary, 'usr/lib/motrix2')
    const appArchive = path.join(resources, 'app.asar')
    const metadata = JSON.parse(extractFile(appArchive, 'arch-build.json'))
    const manifest = JSON.parse(extractFile(appArchive, 'package.json'))
    assert.equal(manifest.main, 'entry.cjs')
    assert.equal(manifest.version, metadata.version)
    assert.equal(metadata.arch, 'x86_64')
    assert(
      !listPackage(appArchive).some((name) =>
        /node_modules\/electron\//.test(name)
      )
    )
    for (const name of [
      'dist/main/index.cjs',
      'dist/preload/preload.cjs',
      'dist/core/plugin/host/quick-js-worker.cjs',
      'dist/renderer/index.html',
    ]) {
      assert(statFile(appArchive, name).size > 0, `Missing app output: ${name}`)
    }
    assert(
      existsSync(
        `${appArchive}.unpacked/node_modules/better-sqlite3/prebuilds/linux-x64.node`
      )
    )
    const seeds = await readdir(path.join(resources, 'builtin-plugins'))
    assert(seeds.length > 0, 'No builtin plugins')
    const ariaBinary = path.join(resources, 'extra/linux/x64/aria2c')
    const engine = JSON.parse(
      await readFile(new URL('./engine.lock.json', import.meta.url), 'utf8')
    )
    assert.equal(
      createHash('sha256')
        .update(await readFile(ariaBinary))
        .digest('hex'),
      engine.assets['linux-x64'].binarySha256
    )
    const engineVersion = execFileSync(ariaBinary, ['--version'], {
      encoding: 'utf8',
    })
    assert(
      engineVersion.includes(engine.version),
      'Incorrect bundled Motrix aria2 version'
    )
    assert(
      engineVersion.includes('SQLite3-Persistence'),
      'Missing Motrix SQLite persistence'
    )
    execFileSync(
      '/usr/bin/electron',
      [
        '-e',
        `
      const assert = require('node:assert/strict');
      assert.equal(process.versions.modules, ${JSON.stringify(metadata.electronAbi)});
      const Database = require(${JSON.stringify(`${appArchive}/node_modules/better-sqlite3`)});
      const db = new Database(':memory:');
      assert.equal(db.prepare('select 42 as result').get().result, 42);
      db.close();
    `,
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
    )
    if (smoke) {
      const { _electron } = await import('playwright')
      const userData = path.join(temporary, 'user-data')
      await mkdir(userData)
      // Same isolated first-run fixture as upstream's packaged smoke test.
      // Keep browser manifests, downloads, updates and ports out of the host.
      await writeFile(
        path.join(userData, 'settings.json'),
        JSON.stringify({
          version: 8,
          onboarding: { disclaimerAccepted: true },
          app: {
            uiScale: 125,
            trayIconTheme: 'light',
            browserBridgeEnabled: false,
            checkForUpdatesOnLaunch: false,
            warnBeforeQuit: false,
          },
          nat: { enabled: false },
        })
      )
      const rpcPort = await new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port
          server.close((error) => (error ? reject(error) : resolve(port)))
        })
      })
      const env = {
        ...process.env,
        MOTRIX_USER_DATA: userData,
        MOTRIX_RPC_PORT: String(rpcPort),
        MOTRIX_DEFAULT_SAVE_DIR: path.join(temporary, 'downloads'),
      }
      delete env.ELECTRON_RUN_AS_NODE
      const application = await _electron.launch({
        executablePath: '/usr/bin/electron',
        // Container smoke tests lack Chromium namespace privileges. The shipped
        // launcher keeps Chromium's sandbox enabled.
        args: [...(process.env.CI ? ['--no-sandbox'] : []), appArchive],
        env,
        timeout: 60_000,
      })
      try {
        const window = await application.firstWindow({ timeout: 60_000 })
        await window.waitForLoadState('domcontentloaded')
        await window
          .locator('#root > :not(script)')
          .first()
          .waitFor({ timeout: 60_000 })
        const packaged = await application.evaluate(({ app }) => app.isPackaged)
        assert.equal(packaged, true)
        assert.equal(
          await application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()
          ),
          1.25
        )
        // Prove that the application launched the exact verified Motrix engine.
        let owner
        for (let attempt = 0; attempt < 60; attempt++) {
          try {
            owner = JSON.parse(
              await readFile(path.join(userData, 'aria2-owner.json'), 'utf8')
            )
            if (owner.pid) break
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        assert(owner?.pid, 'Application did not start aria2')
        assert.equal(
          await realpath(`/proc/${owner.pid}/exe`),
          await realpath(ariaBinary)
        )
      } catch (error) {
        console.error(
          await readFile(path.join(userData, 'logs/motrix.log'), 'utf8').catch(
            () => 'No application log was produced'
          )
        )
        throw error
      } finally {
        await application.close()
      }
    }
    console.log(
      `Verified Arch ASAR ${metadata.version}: Electron ${metadata.electron}, ABI ${metadata.electronAbi}`
    )
    return metadata
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--')
  const archive = args.find((arg) => !arg.startsWith('--'))
  if (!archive)
    throw new Error('Usage: verify-arch-package.mjs <archive.asar> [--smoke]')
  await verifyArchPackage(archive, { smoke: args.includes('--smoke') })
}
