import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeThirdPartyBundle } from './generate-third-party-notices.mjs'

// Keep the upstream generator unchanged; only Electron is supplied by Arch.
export async function writeArchNotices(options = {}) {
  const config = JSON.parse(
    await readFile(
      new URL('./third-party-notices.config.json', import.meta.url),
      'utf8'
    )
  )
  config.externalComponents = config.externalComponents.filter(
    (entry) => entry.id !== 'electron'
  )
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'motrix-arch-notices-')
  )
  try {
    const configFile = path.join(directory, 'config.json')
    await writeFile(configFile, JSON.stringify(config))
    return await writeThirdPartyBundle({ ...options, configFile })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
