import { resolvePairingManifestDev } from './pairing-artifact-resolver.mjs'
import { runPairingArtifactVerification } from './verification-workflows.mjs'

await runPairingArtifactVerification({ mode: 'development', resolvePairing: resolvePairingManifestDev })
