import { resolvePairingManifestDev } from './pairing-artifact-resolver.mjs'
import { runTwoTierCompatibility } from './verification-workflows.mjs'

runTwoTierCompatibility({ mode: 'development', resolvePairing: resolvePairingManifestDev })
