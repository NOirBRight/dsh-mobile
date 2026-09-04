import { resolvePairingManifestDev } from './pairing-artifact-resolver.mjs'
import { runCleanAlpha4MobileMatrix } from './verification-workflows.mjs'

await runCleanAlpha4MobileMatrix({ mode: 'development', resolvePairing: resolvePairingManifestDev })
