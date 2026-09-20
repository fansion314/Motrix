#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function parseArchTag(tag, version) {
  const match = /^arch-v(\d+\.\d+\.\d+(?:-beta\.\d+)?)-([1-9]\d*)$/.exec(tag)
  assert(
    match && match[1] === version,
    'Arch tag must match arch-v<package.json version>-<pkgrel>'
  )
  return { version, pkgver: version.replace('-', ''), pkgrel: match[2] }
}

export function renderArchPkgbuild(template, metadata, digest, major) {
  let result = template
    .replace(/^pkgver=.*$/m, `pkgver=${metadata.pkgver}`)
    .replace(/^pkgrel=.*$/m, `pkgrel=${metadata.pkgrel}`)
    .replace(/^_version=.*$/m, `_version=${metadata.version}`)
  if (digest) {
    assert(/^[a-f0-9]{64}$/.test(digest), 'Invalid release SHA-256')
    result = result.replace(/^sha256sums=.*$/m, `sha256sums=('${digest}')`)
  }
  if (major !== undefined) {
    assert(Number.isInteger(major) && major > 0, 'Invalid Electron major')
    result = result.replace(
      /'electron>=1:\d+' 'electron<1:\d+'/,
      `'electron>=1:${major}' 'electron<1:${major + 1}'`
    )
  }
  return result
}

async function main() {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const metadata = parseArchTag(process.env.ARCH_TAG, pkg.version)
  const archive = process.argv[2]
  if (!archive) {
    const major = Number(
      execFileSync(
        '/usr/bin/electron',
        ['-p', 'process.versions.electron.split(".")[0]'],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          encoding: 'utf8',
        }
      ).trim()
    )
    for (const name of ['motrix2', 'motrix2-bin']) {
      const file = `aur/${name}/PKGBUILD`
      await writeFile(
        file,
        renderArchPkgbuild(
          await readFile(file, 'utf8'),
          metadata,
          undefined,
          major
        )
      )
    }
    return
  }
  const bytes = await readFile(archive)
  const { extractFile } = await import('@electron/asar')
  const digest = createHash('sha256').update(bytes).digest('hex')
  // Read the build metadata from the staged app matching the verified payload.
  const appBytes = extractFile(archive, 'usr/lib/motrix2/app.asar')
  await mkdir('release', { recursive: true })
  const inner = 'release/metadata-app.asar'
  await writeFile(inner, appBytes)
  const build = JSON.parse(extractFile(inner, 'arch-build.json'))
  await rm(inner)
  assert.equal(build.version, metadata.version)
  assert.equal(build.pkgrel, metadata.pkgrel)
  const major = Number(build.electron.split('.')[0])
  await rm('release/aur', { recursive: true, force: true })
  for (const name of ['motrix2', 'motrix2-bin']) {
    const directory = `release/aur/${name}`
    await mkdir(directory, { recursive: true })
    await writeFile(
      `${directory}/PKGBUILD`,
      renderArchPkgbuild(
        await readFile(`aur/${name}/PKGBUILD`, 'utf8'),
        metadata,
        name.endsWith('-bin') ? digest : undefined,
        major
      )
    )
    const srcinfo = execFileSync('makepkg', ['--printsrcinfo'], {
      cwd: directory,
      encoding: 'utf8',
    })
    await writeFile(`${directory}/.SRCINFO`, srcinfo)
  }
  execFileSync(
    'tar',
    [
      '-czf',
      `motrix2-${metadata.version}-${metadata.pkgrel}-aur.tar.gz`,
      'aur',
    ],
    { cwd: 'release' }
  )
  const aurName = `motrix2-${metadata.version}-${metadata.pkgrel}-aur.tar.gz`
  const aurDigest = createHash('sha256')
    .update(await readFile(`release/${aurName}`))
    .digest('hex')
  await writeFile(
    'release/SHA256SUMS',
    `${digest}  ${path.basename(archive)}\n${aurDigest}  ${aurName}\n`
  )
  await writeFile(
    'release/notes.md',
    `Arch Linux x86_64 package based on Motrix ${metadata.version}.\n\n` +
      `Uses system Electron ${build.electron} (ABI ${build.electronAbi}) and the pinned Motrix aria2 fork. ` +
      'No Electron runtime is bundled. The ASAR contains the application, its native helpers and desktop resources.\n\n' +
      'Settings → Appearance supports custom interface scaling and light/dark Linux tray icons. Changes apply immediately and persist across restarts.\n\n' +
      'The AUR source archive contains motrix2 and motrix2-bin PKGBUILDs with .SRCINFO; motrix2-bin pins the ASAR SHA-256. ' +
      'Install updates through pacman/your AUR helper. No AUR upload is performed by this workflow.\n'
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await main()
