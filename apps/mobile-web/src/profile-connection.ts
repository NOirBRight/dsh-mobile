import { b64urlEncode, generateClientKeypair, parseOffer, type ClientKeypair, type PublicEndpointOffer, type RelayOffer } from '@dsh-mobile/e2e-tunnel'
import type { ReadableCredentialVault } from './credential-vault.ts'
import { HOST_PROFILE_SCHEMA_VERSION, HostIdentityMismatchError, type HostProfile, type ProfileRepository } from './profiles.ts'
import { decodeSessionCredential, encodeSessionCredential } from './session-credentials.ts'

export interface LoadedProfileCredentials {
  clientKeypair: ClientKeypair
  deviceToken?: string
  onDeviceToken(token: string): Promise<void>
  dispose(): void
}

export interface PreparedProfileConnection {
  readonly profile: HostProfile
  readonly offerUrl: string
  loadCredentials(): Promise<LoadedProfileCredentials>
}

export interface PrepareProfileConnectionOptions {
  repository: ProfileRepository
  vault: ReadableCredentialVault
  offerUrl?: string
  generateKeypair?: () => ClientKeypair
  now?: () => Date
  acknowledgeIdentityChange?: (conflict: HostIdentityMismatchError) => boolean | Promise<boolean>
}

/**
 * Convert a scanned v4 offer or saved Active Host into connection inputs.
 * Secret key, pairing code, and device token cross only the private vault seam.
 */
export async function prepareProfileConnection(options: PrepareProfileConnectionOptions): Promise<PreparedProfileConnection> {
  const now = options.now ?? (() => new Date())
  let profile: HostProfile
  let connectionOffer: string
  let parsedOffer: PublicEndpointOffer | RelayOffer | undefined
  let normalizeExistingTokenOffer = false

  if (options.offerUrl !== undefined) {
    const parsed = parseOffer(options.offerUrl)
    if (parsed.mode !== 'public' && parsed.mode !== 'relay') throw new Error('Host Profiles require a Public Endpoint or Official Relay offer')
    parsedOffer = parsed
    const existingListed = (await options.repository.list()).find(item => item.hostId === parsed.pubkey)
    let existing = existingListed
    if (existing !== undefined) {
      try {
        await readCredential(options.vault, existing.credentialRef)
      } catch (error) {
        if (!isMissingCredential(error)) throw error
        await options.repository.remove(existing.hostId)
        existing = undefined
      }
    }
    if (existing !== undefined) {
      const stored = await readCredential(options.vault, existing.credentialRef)
      try {
        if (stored.deviceToken !== undefined) {
          normalizeExistingTokenOffer = true
          profile = await options.repository.upsert(profileFromOffer(parsed, existing.credentialRef, now(), existing))
        } else {
          const refreshed = encodeSessionCredential({ clientKeypair: stored.clientKeypair, pairingCode: parsed.code })
          try {
            await options.vault.replace(existing.credentialRef, refreshed)
            profile = await options.repository.upsert(profileFromOffer(parsed, existing.credentialRef, now(), { ...existing, room: parsed.room }))
          } finally {
            refreshed.fill(0)
          }
        }
      } finally {
        wipeCredential(stored)
      }
    } else {
      const generated = (options.generateKeypair ?? generateClientKeypair)()
      const secret = encodeSessionCredential({ clientKeypair: generated, pairingCode: parsed.code })
      let ref: string | null = null
      try {
        ref = await options.vault.store(secret)
        const replacement = profileFromOffer(parsed, ref, now())
        try {
          profile = await options.repository.upsert(replacement)
        } catch (error) {
          const acknowledged = error instanceof HostIdentityMismatchError
            && await options.acknowledgeIdentityChange?.(error) === true
          if (!acknowledged) throw error
          profile = await options.repository.acknowledgeIdentityChange(error, replacement)
        }
      } catch (error) {
        if (ref !== null) await options.vault.delete(ref)
        throw error
      } finally {
        secret.fill(0); generated.publicKey.fill(0); generated.secretKey.fill(0)
      }
    }
    await options.repository.setActiveHost(profile.hostId)
    connectionOffer = normalizeExistingTokenOffer && parsedOffer !== undefined
      ? offerFromProfile(profile, parsedOffer.code, now())
      : options.offerUrl
  } else {
    const active = await options.repository.getActive()
    if (active === undefined) throw new Error('no Active Host Profile')
    profile = active
    const stored = await readCredential(options.vault, profile.credentialRef)
    try {
      connectionOffer = offerFromProfile(profile, stored.pairingCode ?? '000000', now())
    } finally {
      wipeCredential(stored)
    }
  }

  const preparedProfile = profile
  return {
    profile: preparedProfile,
    offerUrl: connectionOffer,
    async loadCredentials(): Promise<LoadedProfileCredentials> {
      const stored = await readCredential(options.vault, profile.credentialRef)
      const publicKey = stored.clientKeypair.publicKey.slice()
      const secretKey = stored.clientKeypair.secretKey.slice()
      let disposed = false
      return {
        clientKeypair: stored.clientKeypair,
        ...(stored.deviceToken === undefined ? {} : { deviceToken: stored.deviceToken }),
        async onDeviceToken(token: string): Promise<void> {
          if (token === stored.deviceToken) return
          if (disposed) throw new Error('Host Profile credential is missing; re-pair this Host')
          const encoded = encodeSessionCredential({
            clientKeypair: { publicKey: publicKey.slice(), secretKey: secretKey.slice() },
            deviceToken: token,
          })
          let pairedRoom = profile.room
          try {
            const parsed = parseOffer(connectionOffer, { allowExpired: true })
            if (parsed.mode === 'public') pairedRoom = parsed.room
          } catch { /* keep the Profile room if the connection offer cannot be reparsed */ }
          try {
            await options.vault.replace(profile.credentialRef, encoded)
            stored.deviceToken = token
            profile = await options.repository.upsert({ ...profile, room: pairedRoom, updatedAt: now().toISOString() })
            preparedProfile.room = profile.room
            preparedProfile.updatedAt = profile.updatedAt
          } finally {
            encoded.fill(0)
          }
        },
        dispose() {
          disposed = true
          wipeCredential(stored)
          publicKey.fill(0)
          secretKey.fill(0)
        },
      }
    },
  }
}

function profileFromOffer(offer: PublicEndpointOffer | RelayOffer, credentialRef: string, now: Date, existing?: HostProfile): HostProfile {
  const timestamp = now.toISOString()
  const relay = offer.mode === 'relay'
  const endpointUrl = relay ? offer.addr : offer.endpoint
  return {
    schemaVersion: HOST_PROFILE_SCHEMA_VERSION,
    hostId: offer.pubkey,
    displayName: existing?.displayName ?? new URL(endpointUrl).hostname,
    endpoint: { url: endpointUrl, kind: relay ? 'relay' : offer.endpointKind },
    capabilities: relay ? ['tunnel'] : Object.entries(offer.capabilities).filter(([, enabled]) => enabled).map(([name]) => name),
    credentialRef,
    room: existing?.room ?? offer.room,
    ice: relay ? [] : [...(offer.ice ?? [])],
    connectionPolicy: existing?.connectionPolicy ?? 'automatic',
    presentation: existing?.presentation ?? {},
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
}

function offerFromProfile(profile: HostProfile, code: string, now: Date): string {
  const exp = Math.floor(now.getTime() / 1000) + 300
  if (profile.endpoint.kind === 'relay') {
    const offer: RelayOffer = { v: 2, mode: 'relay', addr: profile.endpoint.url, room: profile.room, pubkey: profile.hostId, code, exp }
    return 'dsh-mobile://pair#offer=' + b64urlEncode(new TextEncoder().encode(JSON.stringify(offer)))
  }
  const enabled = new Set(profile.capabilities)
  const offer: PublicEndpointOffer = {
    v: 4, mode: 'public', protocol: 1,
    endpoint: profile.endpoint.url, endpointKind: profile.endpoint.kind,
    room: profile.room, pubkey: profile.hostId, code, exp,
    ice: [...profile.ice],
    capabilities: {
      browser: enabled.has('browser'), direct: enabled.has('direct'),
      tunnel: enabled.has('tunnel'), endpointRefresh: enabled.has('endpointRefresh'),
    },
  }
  return 'dsh-mobile://pair#offer=' + b64urlEncode(new TextEncoder().encode(JSON.stringify(offer)))
}

/** Confirmed vault miss — the only credential error that may drop a Host Profile. */
export class MissingCredentialError extends Error {
  constructor() {
    super('Host Profile credential is missing; re-pair this Host')
    this.name = 'MissingCredentialError'
  }
}

async function readCredential(vault: ReadableCredentialVault, ref: string) {
  const bytes = await vault.read(ref)
  if (bytes === undefined) throw new MissingCredentialError()
  try { return decodeSessionCredential(bytes) } finally { bytes.fill(0) }
}

function isMissingCredential(error: unknown): boolean {
  return error instanceof MissingCredentialError
}

function wipeCredential(value: { clientKeypair: ClientKeypair }): void {
  value.clientKeypair.publicKey.fill(0)
  value.clientKeypair.secretKey.fill(0)
}
