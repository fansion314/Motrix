// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { writeArchNotices } from '../../scripts/generate-arch-notices.mjs'
import {
  parseArchTag,
  renderArchPkgbuild,
} from '../../scripts/prepare-arch-release.mjs'
import { validateArchEntries } from '../../scripts/verify-arch-package.mjs'

describe('Arch release contract', () => {
  it('generates application notices without requiring bundled system runtime licenses', async () => {
    const outputDir = await mkdtemp(
      path.join(os.tmpdir(), 'arch-notices-test-')
    )
    const bundle = await writeArchNotices({ outputDir }).finally(() =>
      rm(outputDir, { recursive: true, force: true })
    )
    const sbom = JSON.parse(bundle.files['sbom.spdx.json'])
    expect(
      sbom.packages.some((pkg: { name: string }) => pkg.name === 'Electron')
    ).toBe(false)
    expect(
      sbom.packages.some((pkg: { name: string }) => pkg.name === 'aria2')
    ).toBe(true)
    expect(
      sbom.packages.some(
        (pkg: { name: string }) => pkg.name === 'better-sqlite3'
      )
    ).toBe(true)
  })
  it('accepts an independent packaging revision and rejects mismatched versions', () => {
    expect(parseArchTag('arch-v2.0.0-beta.39-2', '2.0.0-beta.39')).toEqual({
      version: '2.0.0-beta.39',
      pkgver: '2.0.0beta.39',
      pkgrel: '2',
    })
    for (const tag of [
      'v2.0.0-beta.39',
      'arch-v2.0.0-beta.38-1',
      'arch-v2.0.0-beta.39-0',
      'arch-v2.0.0-beta.39-1;echo bad',
    ]) {
      expect(() => parseArchTag(tag, '2.0.0-beta.39')).toThrow()
    }
  })

  it('pins the binary checksum and compatible system Electron generation', async () => {
    const template = await readFile('aur/motrix2-bin/PKGBUILD', 'utf8')
    const output = renderArchPkgbuild(
      template,
      parseArchTag('arch-v2.0.0-beta.40-3', '2.0.0-beta.40'),
      'a'.repeat(64),
      45
    )
    expect(output).toContain('pkgver=2.0.0beta.40')
    expect(output).toContain('pkgrel=3')
    expect(output).toContain("'electron>=1:45' 'electron<1:46'")
    expect(output).toContain(`sha256sums=('${'a'.repeat(64)}')`)
    expect(() => renderArchPkgbuild(template, {}, 'SKIP', 45)).toThrow()
  })

  it('rejects bundled system runtimes and incomplete distribution archives', () => {
    for (const entry of [
      '/usr/lib/electron',
      '/usr/lib/chrome-sandbox',
      '/usr/../etc/passwd',
      '/etc/passwd',
    ]) {
      expect(() => validateArchEntries([entry])).toThrow()
    }
    expect(() => validateArchEntries(['/usr'])).toThrow(/Missing/)
  })

  it('bootstraps a packaged app without changing the system Electron executable', async () => {
    const code = await readFile('build/arch/entry.cjs', 'utf8')
    const paths: Record<string, string> = {}
    const app = {
      setPath: (name: string, value: string) => {
        paths[name] = value
      },
      setDesktopName: (name: string) => {
        paths.desktop = name
      },
    }
    const process = {
      versions: { modules: '149' },
      resourcesPath: '/usr/lib/electron44/resources',
    }
    let mainLoaded = false
    const context = {
      __dirname: '/usr/lib/motrix2/app.asar',
      app,
      process,
      require: (name: string) => {
        if (name === 'node:path') return { dirname: () => '/usr/lib/motrix2' }
        if (name === 'electron') return { app }
        if (name === './arch-build.json') return { electronAbi: '149' }
        if (name === './dist/main/index.cjs') {
          mainLoaded = true
          return {}
        }
        throw new Error(`Unexpected import: ${name}`)
      },
    }
    vm.runInNewContext(code, context)
    expect(mainLoaded).toBe(true)
    expect(process.resourcesPath).toBe('/usr/lib/motrix2')
    expect(paths.exe).toBe('/usr/bin/motrix')
    expect(paths.desktop).toBe('motrix.desktop')
    expect(Object.getOwnPropertyDescriptor(app, 'isPackaged')?.value).toBe(true)
    context.process = {
      versions: { modules: '150' },
      resourcesPath: '/usr/lib/electron45/resources',
    }
    expect(() => vm.runInNewContext(code, { ...context })).toThrow(
      /rebuild or upgrade/
    )
  })
})
