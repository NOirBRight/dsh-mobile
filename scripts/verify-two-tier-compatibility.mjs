import { resolvePairingManifestStrict } from './pairing-artifact-resolver.mjs'
import { runTwoTierCompatibility } from './verification-workflows.mjs'

runTwoTierCompatibility({ mode: 'strict', resolvePairing: resolvePairingManifestStrict })
