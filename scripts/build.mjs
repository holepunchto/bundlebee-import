import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

fs.rmSync('dist', { recursive: true, force: true })
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' })
fs.writeFileSync('dist/index.cjs', "module.exports = require('./index.js').default\n")
fs.writeFileSync(
  'dist/index.d.cts',
  `import implementation from './index.js'
declare const Import: typeof implementation
declare namespace Import {
  type Store = import('./index.js').Store
  type ReleasePin = import('./index.js').ReleasePin
  type HostProvider = import('./index.js').HostProvider
  type Options = import('./index.js').ImportOptions
  type NetworkOptions = import('./index.js').NetworkOptions
  type ResolveOptions = import('./index.js').ResolveOptions
}
export = Import
`
)
