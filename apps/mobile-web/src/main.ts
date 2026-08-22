/** Android-first shell bootstrap with Host Profiles and vaulted credentials. */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { parseOffer, TunnelError, type TunnelState } from '@dsh-mobile/e2e-tunnel'
import { AppLinkInbox } from './app-links.ts'
import { resolveClientDeviceName } from './client-device-name.ts'
import { createBackgroundConnectionControl, readBackgroundConnectionPreference, writeBackgroundConnectionPreference } from './background-connection.ts'
import { BrowserCredentialVault, NativeCredentialVault, purgeLegacyAndroidWebCredentials, type NativeCredentialVaultBridge, type ReadableCredentialVault } from './credential-vault.ts'
import { claimShellNativeBridges, concealShellNativeBridges, installSystemBarThemeSync } from './native-bridges.ts'
import { installCompatibilityNotice, loadSameOriginMobileBootManifest, NARROW_LAYOUT_BREAKPOINT, officialNarrowContractAvailable, readViewportWidth, selectResponsiveBootManifest, setProtectedCacheScope, setSameOriginHostBridgeCapability, type BootManifest, type ResponsiveBootSelection } from './manifest.ts'
import { scanPairingQr } from './pairing-scanner.ts'
import { prepareProfileConnection, type PreparedProfileConnection } from './profile-connection.ts'
import { activateHostProfile, completeProfileOnboarding, removeHostProfile } from './profile-lifecycle.ts'
import { enhancementDisclosure, readSessionEnhancementPreference, writeSessionEnhancementPreference } from './enhancement-preference.ts'
import { prepareSessionHydration, type PreparedSessionHydration } from './session-hydration.ts'
import { connectionRecoveryDecision, endpointRefreshRequired } from './reconnect-recovery.ts'
import { BrowserProfileStorage, ProfileRepository } from './profiles.ts'
import { prepareDshClientBoot } from './dsh-boot.ts'
import { connectionRecoveryNotice, connectionRouteLabel, coreLiveDataReadiness, hydrateBootManifestFromCache, installBadge, installProfileAction, installShims, injectBootManifestFromTunnel, shouldInstallTunnelShims, supportsLiveDataReadiness, TunnelManager, TunnelManagerSlot, type LiveDataReadiness, type TunnelManagerActivity } from './tunnel.ts'
import { HostSession } from './host-session.ts'
import { mountFirstRunScreen } from './first-run-screen.ts'
import { mountHostProfileMenu, type DeviceConnectionSummary } from './host-profile-menu.ts'
import type { ScanSurface } from './scan-surface.ts'

const root = document.getElementById('root')
if (root === null) throw new Error('mobile-web app: missing #root')
const el: HTMLElement = root
document.documentElement.dataset.dshSurface = 'mobile'
let webEntry: AppWebEntry | null = null

async function bootDshShell(selection: ResponsiveBootSelection | null): Promise<void> {
  await webEntry?.dispose()
  webEntry = null
  if (selection !== null) await prepareDshClientBoot(selection.manifest)
  el.replaceChildren()
  if (selection !== null) installCompatibilityNotice(selection.compatibility)
  concealShellNativeBridges()
  webEntry = new AppWebEntry(el)
  await webEntry.run()
}

function validOfferUrl(value: string): string | null {
  try { parseOffer(value); return value } catch { return null }
}

async function waitForScanRetry(message: string): Promise<void> {
  el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">' +
    message + '<br/><button id="scan-pairing" style="margin-top:1.5em;padding:.8em 1.4em">重新扫码</button></div>'
  await new Promise<void>(resolve => document.getElementById('scan-pairing')?.addEventListener('click', () => resolve(), { once: true }))
}

const rootScanSurface: ScanSurface = {
  show(message, retryLabel) {
    if (retryLabel === undefined) {
      el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">' + message + '</div>'
      return
    }
    return waitForScanRetry(message)
  },
}

async function scanUntilPaired(surface: ScanSurface = rootScanSurface): Promise<string> {
  let automatic = true
  while (true) {
    await surface.show('正在打开相机扫描配对二维码…')
    try { return await scanPairingQr() } catch {
      await surface.show(
        automatic ? '没有识别到有效的 DSH 配对二维码' : '扫码失败，请对准 Host 二维码重试',
        '重新扫码',
      )
      automatic = false
    }
  }
}

function createVault(native: boolean, bridge: NativeCredentialVaultBridge | null): ReadableCredentialVault {
  if (!native || bridge === null) return new BrowserCredentialVault()
  return new NativeCredentialVault(bridge)
}

function offerFromCurrentHash(): string | undefined {
  return /#offer=/.test(location.hash) && validOfferUrl(location.href) !== null ? location.href : undefined
}

let queuedRuntimeOffer: string | undefined
let runtimeOfferHandler: ((offerUrl: string) => void) | undefined

/** Route new offers into the resident HostSession; queue only during bootstrap. */
function routeRuntimeOffer(offerUrl: string): void {
  history.replaceState(null, '', location.pathname + location.search)
  if (runtimeOfferHandler === undefined) queuedRuntimeOffer = offerUrl
  else runtimeOfferHandler(offerUrl)
}

async function showProfileMenu(
  repository: ProfileRepository,
  onActiveHostChanged: () => Promise<void>,
  onProfilesEmpty: () => Promise<void>,
  onEnhancementChange: (preference: import('./manifest.ts').SessionEnhancementPreference) => Promise<void>,
  onBackgroundConnectionChange: (enabled: boolean) => Promise<void>,
  onPairOffer: (offerUrl: string) => Promise<void>,
  connection: () => DeviceConnectionSummary,
): Promise<void> {
  if (document.querySelector('[data-dsh-profile-menu]') !== null) return
  const [profiles, active] = await Promise.all([repository.list(), repository.getActive()])
  let menu: ReturnType<typeof mountHostProfileMenu> | undefined
  menu = mountHostProfileMenu({
    profiles,
    active,
    connection: connection(),
    enhancement: connection().enhancement,
    backgroundConnection: connection().backgroundConnection,
    onEnhancementChange,
    onBackgroundConnectionChange,
    onActivate: hostId => activateHostProfile(hostId, {
      setActive: id => repository.setActiveHost(id),
      reconnect: onActiveHostChanged,
    }),
    onPolicyChange: async (profile, policy) => {
      await repository.upsert({ ...profile, connectionPolicy: policy, updatedAt: new Date().toISOString() })
      if (profile.hostId === active?.hostId) await onActiveHostChanged()
    },
    onRemove: async (profile) => {
      if (!window.confirm('移除此设备的本地配对信息？这不会撤销 Host 上的设备。')) return
      await removeHostProfile(profile.hostId, active?.hostId, {
        remove: async hostId => {
          await repository.remove(hostId)
          menu?.close()
        },
        count: async () => (await repository.list()).length,
        reconnect: onActiveHostChanged,
        onboarding: onProfilesEmpty,
      })
    },
    onScan: async (surface) => {
      const offer = await scanUntilPaired(surface)
      await onPairOffer(offer)
    },
  })
}

void (async () => {
  const disposers: Array<() => void | Promise<void>> = []
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    const pending = disposers.splice(0).reverse().map(disposer => Promise.resolve().then(disposer))
    void Promise.allSettled(pending)
  }
  const own = (disposer: () => void | Promise<void>): void => {
    if (disposed) void Promise.resolve().then(disposer)
    else disposers.push(disposer)
  }
  window.addEventListener('pagehide', dispose, { once: true })

  const appLinks = new AppLinkInbox(validOfferUrl, routeRuntimeOffer)
  const appUrlListener = await App.addListener('appUrlOpen', ({ url }) => appLinks.capture(url))
  own(() => appUrlListener.remove())

  const native = Capacitor.isNativePlatform()
  if (native) purgeLegacyAndroidWebCredentials(localStorage)
  const bridges = claimShellNativeBridges(native)
  const clientDeviceName = await resolveClientDeviceName(bridges.deviceIdentity)
  own(installSystemBarThemeSync(bridges.systemBars))
  const backgroundConnection = createBackgroundConnectionControl(bridges.backgroundConnection)
  let backgroundConnectionEnabled = native && readBackgroundConnectionPreference(localStorage)
  const vault = createVault(native, bridges.vault)
  const repository = new ProfileRepository(new BrowserProfileStorage(), vault)
  let sessionEnhancementPreference = readSessionEnhancementPreference(localStorage)
  let hydration: PreparedSessionHydration | null = null
  let enhancementState: NonNullable<ResponsiveBootSelection['enhancement']> = { status: 'core' }
  let scannedOffer = offerFromCurrentHash()
  let sameOriginBoot = false
  setSameOriginHostBridgeCapability(false)
  let sameOriginManifest: BootManifest | null = null
  let responsiveSelection: ResponsiveBootSelection | null = null

  if (!native && scannedOffer === undefined) {
    try {
      const manifest = await loadSameOriginMobileBootManifest()
      if (manifest !== null) {
        sameOriginManifest = manifest
        responsiveSelection = selectResponsiveBootManifest(manifest, {
          viewportWidth: readViewportWidth(),
          narrowContractAvailable: officialNarrowContractAvailable(manifest),
        })
        ;(window as unknown as { __DSH_BOOT__: unknown }).__DSH_BOOT__ = responsiveSelection.manifest
        setSameOriginHostBridgeCapability(true)
        sameOriginBoot = true
      }
    } catch (error) {
      el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">无法加载 Custom Endpoint Host bridge</div>'
      throw error
    }
  }

  const launch = native ? await App.getLaunchUrl() : undefined
  scannedOffer ??= appLinks.takeInitial(launch?.url)
  appLinks.arm()

  const acknowledgeIdentityChange = (): boolean => window.confirm(
    '安全警告：此 Endpoint 的 Host Identity 已改变。仅在你确认 Host 已重置时继续；否则取消并检查连接。',
  )
  let prepared: PreparedProfileConnection | null = null
  let initialOnboardingError: string | undefined
  if (!sameOriginBoot) {
    if (scannedOffer !== undefined) {
      try {
        prepared = await prepareProfileConnection({ repository, vault, offerUrl: scannedOffer, acknowledgeIdentityChange })
        history.replaceState(null, '', location.pathname + location.search)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error'
        if (!native) {
          el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">配对失败：' + reason + '</div>'
          return
        }
        initialOnboardingError = '配对失败：' + reason + '。请检查二维码后重试'
        scannedOffer = undefined
      }
    }
    if (prepared === null && scannedOffer === undefined) {
      try {
        prepared = await prepareProfileConnection({ repository, vault })
      } catch (error) {
        if (!native) {
          el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">请用 DSH Mobile 应用扫描 Host 配对二维码</div>'
          return
        }
        const firstRun = mountFirstRunScreen(el)
        prepared = await completeProfileOnboarding({
          surface: firstRun,
          ...initialOnboardingError === undefined ? {} : { initialError: initialOnboardingError },
          scan: () => scanUntilPaired(firstRun),
          prepare: offerUrl => prepareProfileConnection({ repository, vault, offerUrl, acknowledgeIdentityChange }),
        })
      }
    }
  }

  try {
    await backgroundConnection.setEnabled(prepared !== null && backgroundConnectionEnabled)
  } catch {
    backgroundConnectionEnabled = false
    writeBackgroundConnectionPreference(localStorage, false)
  }

  const slot = new TunnelManagerSlot()
  if (shouldInstallTunnelShims(sameOriginBoot)) installShims(slot)
  let session: HostSession | null = null
  own(async () => {
    session?.stop()
    await hydration?.dispose()
    await webEntry?.dispose()
  })
  let shellMounted = false

  if (prepared !== null) {
    let activeConnection = prepared
    setProtectedCacheScope(activeConnection.profile.hostId)
    let lastError = ''
    let state: TunnelState = 'connecting'
    let activity: TunnelManagerActivity = { phase: 'connecting', attempt: 1, reconnecting: false, route: null }
    let route = ''
    let endpointRefreshAvailable = false
    // A successful HostSession.connect() is stronger than a stale error from
    // an earlier tunnel generation. Keep this separate so the cached shell can
    // paint before the first ready callback without pinning a false notice.
    let transportReady = false
    // Transport readiness and authoritative session-data freshness are
    // intentionally separate: the cached shell remains usable between them.
    let liveDataReady: LiveDataReadiness = 'pending'
    const updateBadge = installBadge()
    own(() => updateBadge.dispose())
    // Cached shell may paint before TunnelManager emits its first callback.
    updateBadge(activity, route, shellMounted, liveDataReady)
    const handleLiveDataState = (event: Event): void => {
      const state = (event as CustomEvent<{ state?: unknown }>).detail?.state
      if (state !== 'pending' && state !== 'ready' && state !== 'error') return
      liveDataReady = state
      updateBadge(activity, route, shellMounted, liveDataReady)
    }
    const handleLiveDataReady = (): void => {
      liveDataReady = 'ready'
      updateBadge(activity, route, shellMounted, liveDataReady)
    }
    document.addEventListener('dsh:live-data-state', handleLiveDataState)
    document.addEventListener('dsh:live-data-ready', handleLiveDataReady)
    own(() => document.removeEventListener('dsh:live-data-state', handleLiveDataState))
    own(() => document.removeEventListener('dsh:live-data-ready', handleLiveDataReady))
    own(installProfileAction(() => {
      void showProfileMenu(repository, reconnectActiveHost, enterOnboardingAfterRemoval, async preference => {
        writeSessionEnhancementPreference(localStorage, preference)
        sessionEnhancementPreference = preference
        await reconnectActiveHost()
      }, async enabled => {
        await backgroundConnection.setEnabled(enabled)
        backgroundConnectionEnabled = enabled
        writeBackgroundConnectionPreference(localStorage, enabled)
      }, connectPairingOffer, () => ({
        state,
        route,
        profile: activeConnection.profile,
        enhancement: {
          preference: sessionEnhancementPreference,
          disclosure: enhancementDisclosure(enhancementState),
        },
        ...(native ? { backgroundConnection: { enabled: backgroundConnectionEnabled } } : {}),
      }))
    }))
    const setTopbarNotice = (
      message: string | null,
      detail = '',
      action?: { label: string; run: () => void },
    ): void => {
      const title = document.querySelector<HTMLElement>('[data-mobile-session-title]')
      const notice = document.querySelector<HTMLElement>('[data-mobile-topbar-notice]')
      const text = document.querySelector<HTMLElement>('[data-mobile-topbar-notice-text]')
      const button = document.querySelector<HTMLButtonElement>('[data-mobile-topbar-notice-action]')
      if (title === null || notice === null || text === null || button === null) return
      if (message === null) {
        title.hidden = false
        notice.hidden = true
        notice.removeAttribute('title')
        text.textContent = ''
        button.hidden = true
        button.onclick = null
        return
      }
      // The notice is a floating layer, not part of the topbar flex row.
      // Keep the session title visible while the connection state is transient.
      title.hidden = false
      notice.hidden = false
      notice.title = detail
      text.textContent = message
      if (action === undefined) {
        button.hidden = true
        button.onclick = null
      } else {
        button.hidden = false
        button.textContent = action.label
        button.disabled = false
        button.onclick = () => action.run()
      }
    }
    const render = (): void => {
      const recoveryKind = endpointRefreshAvailable
        ? 'endpoint'
        : connectionRecoveryDecision(activeConnection.profile.endpoint.kind, activity.phase, lastError)
      const recoveryNotice = connectionRecoveryNotice(recoveryKind, lastError)
      const needsRecovery = recoveryNotice !== null
      // A later successful transport state clears any stale error from an older attempt.
      // transportReady also covers the case where HostSession.connect() completed
      // before the tunnel callback reached this render closure.
      if (shellMounted && (state === 'open' || transportReady)) {
        lastError = ''
        endpointRefreshAvailable = false
        document.getElementById('endpoint-refresh-banner')?.remove()
        document.getElementById('mobile-reconnecting-banner')?.remove()
        setTopbarNotice(null)
        return
      }
      document.getElementById('endpoint-refresh-banner')?.remove()
      document.getElementById('mobile-reconnecting-banner')?.remove()
      if (shellMounted) {
        if (recoveryNotice !== null) {
          setTopbarNotice(recoveryNotice.message, recoveryNotice.detail, {
            label: recoveryNotice.actionLabel,
            run: () => {
              const button = document.querySelector<HTMLButtonElement>('[data-mobile-topbar-notice-action]')
              if (button !== null) button.disabled = true
              session?.stop()
              shellMounted = false
              void (async () => {
                const offerUrl = await scanUntilPaired()
                try {
                  activeConnection = await prepareProfileConnection({ repository, vault, offerUrl, acknowledgeIdentityChange })
                  setProtectedCacheScope(activeConnection.profile.hostId)
                  await session?.connect(activeConnection)
                  markTransportReady()
                } catch (error) {
                  lastError = 'Endpoint Refresh: ' + (error instanceof Error ? error.message : 'unknown error')
                  render()
                }
              })()
            },
          })
        } else {
          // Transient failures have one owner: the floating connection status.
          setTopbarNotice(null)
        }
        return
      }
      setTopbarNotice(null)
      if (state === 'open' && !needsRecovery) return
      const wrap = document.createElement('div')
      wrap.style.cssText = 'padding:2em;text-align:center;font-family:sans-serif'
      const title = document.createElement('div')
      title.textContent = '正在连接 ' + activeConnection.profile.displayName + '…'
      wrap.append(title)
      if (route !== '') {
        const routeLine = document.createElement('div')
        routeLine.style.marginTop = '.5em'
        routeLine.textContent = '当前路径：' + route
        wrap.append(routeLine)
      }
      if (lastError !== '') {
        const diagnostic = document.createElement('pre')
        diagnostic.style.cssText = 'white-space:pre-wrap;color:#b91c1c'
        diagnostic.textContent = /credential is missing/i.test(lastError)
          ? '登录凭证已丢失，请重新扫描 Host 二维码配对。'
          : lastError
        wrap.append(diagnostic)
      }
      if (endpointRefreshAvailable) {
        const box = document.createElement('div')
        box.style.marginTop = '1.5em'
        const hint = document.createElement('div')
        hint.textContent = 'Host 的临时 Public Endpoint 可能已轮换。'
        const refresh = document.createElement('button')
        refresh.id = 'endpoint-refresh'
        refresh.style.cssText = 'margin-top:.8em;padding:.8em 1.4em'
        refresh.textContent = '扫描 Endpoint Refresh'
        box.append(hint, refresh)
        wrap.append(box)
      }
      el.replaceChildren(wrap)
      document.getElementById('endpoint-refresh')?.addEventListener('click', async event => {
        const button = event.currentTarget as HTMLButtonElement
        button.disabled = true
        session?.stop()
        const offerUrl = await scanUntilPaired()
        el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">正在更新临时 Endpoint…</div>'
        try {
          activeConnection = await prepareProfileConnection({ repository, vault, offerUrl, acknowledgeIdentityChange })
          setProtectedCacheScope(activeConnection.profile.hostId)
          await session?.connect(activeConnection)
          markTransportReady()
        } catch (error) {
          lastError = 'Endpoint Refresh: ' + (error instanceof Error ? error.message : 'unknown error')
          render()
        }
      }, { once: true })
    }
    const markTransportReady = (): void => {
      transportReady = true
      state = 'open'
      activity = { phase: 'open', attempt: activity.attempt, route: activity.route }
      // Core Runtime has no authoritative readiness contract; transport-open
      // must not be presented as proof that live session baselines refreshed.
      if (!supportsLiveDataReadiness(document.documentElement.dataset)) {
        liveDataReady = coreLiveDataReadiness(transportReady, shellMounted)
      }
      lastError = ''
      endpointRefreshAvailable = false
      updateBadge(activity, route, shellMounted, liveDataReady)
      render()
    }

    async function enterOnboardingAfterRemoval(): Promise<void> {
      session?.stop()
      await webEntry?.dispose()
      webEntry = null
      shellMounted = false
      transportReady = false
      liveDataReady = 'pending'
      state = 'closed'
      route = ''
      activity = { phase: 'terminal', attempt: activity.attempt, route: null, error: 'no Active Host Profile' }
      updateBadge(activity, route, shellMounted, liveDataReady)
      setTopbarNotice(null)
      const firstRun = mountFirstRunScreen(el)
      const offerUrl = await completeProfileOnboarding({
        surface: firstRun,
        scan: () => scanUntilPaired(firstRun),
        prepare: async scanned => {
          await prepareProfileConnection({ repository, vault, offerUrl: scanned, acknowledgeIdentityChange })
          return scanned
        },
      })
      await connectPairingOffer(offerUrl)
    }

    async function connectPairingOffer(offerUrl: string): Promise<void> {
      const next = await prepareProfileConnection({ repository, vault, offerUrl, acknowledgeIdentityChange })
      activeConnection = next
      setProtectedCacheScope(next.profile.hostId)
      await session?.connect(next)
      markTransportReady()
    }

    async function reconnectActiveHost(): Promise<void> {
      session?.stop()
      document.getElementById('endpoint-refresh-banner')?.remove()
      try {
        const next = await prepareProfileConnection({ repository, vault, acknowledgeIdentityChange })
        activeConnection = next
        setProtectedCacheScope(next.profile.hostId)
        await session?.connect(next)
        markTransportReady()
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        if (lastError === 'no Active Host Profile') {
          await enterOnboardingAfterRemoval()
          return
        }
        render()
      }
    }
    session = new HostSession({
      slot,
      createManager(next) {
        return new TunnelManager({
          offerUrl: next.offerUrl,
          connectionPolicy: next.profile.connectionPolicy,
          deviceLabel: clientDeviceName,
          clientType: 'android',
          deferHeartbeat: true,
          loadCredentials: next.loadCredentials,
          async onHostMetadata({ displayName }) {
            try {
              const renamed = await repository.updateDisplayName(next.profile.hostId, displayName)
              next.profile.displayName = renamed.displayName
              if (activeConnection?.profile.hostId === renamed.hostId) activeConnection.profile.displayName = renamed.displayName
              render()
            } catch (error) {
              console.warn('[mobile-shell] could not persist Host Display Name', error)
            }
          },
          onActivity(nextActivity) {
            activity = nextActivity
            route = connectionRouteLabel(nextActivity.route, next.profile.endpoint.kind, next.profile.connectionPolicy)
            state = nextActivity.phase === 'open'
              ? 'open'
              : nextActivity.phase === 'connecting'
                ? 'connecting'
                : 'closed'
            transportReady = nextActivity.phase === 'open'
            if (nextActivity.phase !== 'open') liveDataReady = 'pending'
            else if (!supportsLiveDataReadiness(document.documentElement.dataset)) {
              liveDataReady = coreLiveDataReadiness(transportReady, shellMounted)
            }
            if (nextActivity.phase === 'open') {
              lastError = ''
              endpointRefreshAvailable = false
            } else if ('error' in nextActivity && typeof nextActivity.error === 'string') {
              lastError = nextActivity.error
              const recovery = connectionRecoveryDecision(next.profile.endpoint.kind, nextActivity.phase, lastError)
              endpointRefreshAvailable ||= recovery === 'endpoint'
              if (nextActivity.phase === 'retry-wait' && recovery !== null) {
                session?.stop()
                activity = { phase: 'terminal', attempt: nextActivity.attempt, route: nextActivity.route, error: lastError }
                state = 'closed'
              }
            }
            updateBadge(activity, route, shellMounted, liveDataReady)
            render()
          },
        })
      },
      async injectBoot(client, next) {
        const expectedOfficialLayoutRevision = typeof next.profile.presentation.officialLayoutRevision === 'string'
          ? next.profile.presentation.officialLayoutRevision
          : undefined
        const selection = await injectBootManifestFromTunnel(client, {
          viewportWidth: readViewportWidth(),
          expectedOfficialLayoutRevision,
          localizePlugins: native,
          hostId: next.profile.hostId,
          sessionEnhancementPreference,
        })
        if (selection.officialLayoutRevision !== expectedOfficialLayoutRevision) {
          const latest = await repository.getActive() ?? next.profile
          await repository.upsert({
            ...latest,
            presentation: { ...latest.presentation, officialLayoutRevision: selection.officialLayoutRevision },
            updatedAt: new Date().toISOString(),
          })
        }
        return selection
      },
      async hydrateBoot(next) {
        return hydrateBootManifestFromCache(next.profile.hostId, {
          viewportWidth: readViewportWidth(),
          localizePlugins: native,
          sessionEnhancementPreference,
        })
      },
      async mount(selection, hostId) {
        responsiveSelection = selection
        enhancementState = selection.enhancement ?? { status: 'core' }
        await hydration?.dispose()
        hydration = null
        delete (globalThis as typeof globalThis & { __DSH_MOBILE_SESSION_HYDRATION__?: unknown }).__DSH_MOBILE_SESSION_HYDRATION__
        if (enhancementState.status === 'enabled') {
          const preparedHydration = await prepareSessionHydration({
            hostId,
            legacyStorage: localStorage,
            allowLegacyMigration: (await repository.list()).length === 1,
          })
          hydration = preparedHydration
          ;(globalThis as typeof globalThis & { __DSH_MOBILE_SESSION_HYDRATION__?: unknown }).__DSH_MOBILE_SESSION_HYDRATION__ = {
            adapter: preparedHydration.adapter,
            dispose: () => preparedHydration.dispose(),
          }
        }
        await bootDshShell(selection)
        shellMounted = true
        if (!supportsLiveDataReadiness(document.documentElement.dataset)) {
          liveDataReady = coreLiveDataReadiness(transportReady, shellMounted)
        }
        updateBadge(activity, route, shellMounted, liveDataReady)
        // The tunnel can report open before the WebView shell exists. Repaint
        // now so a ready state cannot leave a stale recovery notice behind.
        render()
      },
    })
    own(backgroundConnection.subscribeWake(() => { void session?.probeNow() }))
    runtimeOfferHandler = offerUrl => { void connectPairingOffer(offerUrl).catch(error => {
      lastError = error instanceof Error ? error.message : String(error)
      render()
    }) }
    if (queuedRuntimeOffer !== undefined) {
      const offerUrl = queuedRuntimeOffer
      queuedRuntimeOffer = undefined
      await connectPairingOffer(offerUrl)
    }
    shellMounted = await session.hydrate(activeConnection)
    render()
    const handleOnline = (): void => { void session?.probeNow() }
    window.addEventListener('online', handleOnline)
    own(() => window.removeEventListener('online', handleOnline))
    const appStateListener = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void session?.probeNow()
    })
    own(() => appStateListener.remove())
    try {
      await session.connect(activeConnection)
      markTransportReady()
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      endpointRefreshAvailable ||= endpointRefreshRequired(activeConnection.profile.endpoint.kind, lastError)
      render()
    }
  }

  const media = matchMedia('(max-width: ' + (NARROW_LAYOUT_BREAKPOINT - 1) + 'px)')
  const handleViewportChange = (): void => {
    if (sameOriginManifest !== null) {
      const selection = selectResponsiveBootManifest(sameOriginManifest, {
        viewportWidth: readViewportWidth(),
        narrowContractAvailable: officialNarrowContractAvailable(sameOriginManifest),
      })
      ;(window as unknown as { __DSH_BOOT__: unknown }).__DSH_BOOT__ = selection.manifest
      responsiveSelection = selection
      void bootDshShell(selection)
      return
    }
    void session?.remount()
  }
  media.addEventListener('change', handleViewportChange)
  own(() => media.removeEventListener('change', handleViewportChange))
  if (!shellMounted) {
    await bootDshShell(responsiveSelection)
  }
})()
