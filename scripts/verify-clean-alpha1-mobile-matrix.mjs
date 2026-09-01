import { resolvePairingManifestStrict } from './pairing-artifact-resolver.mjs'
import { runCleanAlpha1MobileMatrix } from './verification-workflows.mjs'

await runCleanAlpha1MobileMatrix({ mode: 'strict', resolvePairing: resolvePairingManifestStrict })
