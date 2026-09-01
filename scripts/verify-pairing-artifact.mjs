import { resolvePairingManifestStrict } from './pairing-artifact-resolver.mjs'
import { runPairingArtifactVerification } from './verification-workflows.mjs'

await runPairingArtifactVerification({ mode: 'strict', resolvePairing: resolvePairingManifestStrict })
