import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const upstream = process.env.DSH_UPSTREAM ?? resolve(appRoot, '../../.dsh-upstream')
const connectionBundle = resolve(upstream, 'packages/client/connection/lib/client.js')

// The official checkout is a read-only build input. Rebuilding all Client
// packages here can publish stale ignored lib/types into the live desktop Host.
// prepare-upstream selects a complete DSH distribution; fail loud if its
// Connection artifact is absent instead of mutating that checkout.
await access(connectionBundle)
console.log('using official Host bridge connection:', connectionBundle)
