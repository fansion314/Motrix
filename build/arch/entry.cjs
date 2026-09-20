const path = require('node:path')
const { app } = require('electron')
const metadata = require('./arch-build.json')

// The system Electron executable considers explicit app paths development apps.
// This entry is only shipped in the independently packaged Arch application.
if (process.versions.modules !== metadata.electronAbi) {
  throw new Error(
    'Electron ABI changed; rebuild or upgrade the motrix2 package'
  )
}
Object.defineProperty(app, 'isPackaged', { value: true })
Object.defineProperty(process, 'resourcesPath', {
  value: path.dirname(__dirname),
})
app.setPath('exe', '/usr/bin/motrix')
app.setDesktopName('motrix.desktop')
require('./dist/main/index.cjs')
