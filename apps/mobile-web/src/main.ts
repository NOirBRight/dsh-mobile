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
import { COLD_BOOT_PLUGIN_CONCURRENCY, installCompatibilityNotice, loadSameOriginMobileBootManifest, NARROW_LAYOUT_BREAKPOINT, officialNarrowContractAvailable, readViewportWidth, selectResponsiveBootManifest, setProtectedCacheScope, setSameOriginHostBridgeCapability, type BootManifest, type ResponsiveBootSelection } from './manifest.ts'
import { scanPairingQr } from './pairing-scanner.ts'
import { routePlatformBack } from './platform-back.ts'
import { prepareProfileConnection, type PreparedProfileConnection } from './profile-connection.ts'
import { activateHostProfile, completeProfileOnboarding, removeHostProfile } from './profile-lifecycle.ts'
import { connectionRecoveryDecision, endpointRefreshRequired } from './reconnect-recovery.ts'
import { BrowserProfileStorage, ProfileRepository } from './profiles.ts'
import { prepareDshClientBoot } from './dsh-boot.ts'
import { connectionRecoveryNotice, connectionRouteLabel, coreLiveDataReadiness, hydrateBootManifestFromCache, installBadge, installProfileAction, installShims, injectBootManifestFromTunnel, isPassiveConnectionRetry, shouldInstallTunnelShims, supportsLiveDataReadiness, TunnelManager, TunnelManagerSlot, type LiveDataReadiness, type TunnelManagerActivity } from './tunnel.ts'
import { HostSession, isHostSessionStoppedError, transportOpenNeedsBootRefresh } from './host-session.ts'
import { mountProgressScreen } from './progress-screen.ts'
import { mountFirstRunScreen } from './first-run-screen.ts'
import { mountHostProfileMenu, type DeviceConnectionSummary } from './host-profile-menu.ts'
import { inspectChromeAnchors } from './anchors.ts'
import type { ScanSurface } from './scan-surface.ts'

const root = document.getElementById('root')
if (root === null) throw new Error('mobile-web app: missing #root')
const el: HTMLElement = root
document.documentElement.dataset.dshSurface = 'mobile'
let webEntry: AppWebEntry | null = null

const MOBILE_ACTION_STYLE_ID = 'dsh-mobile-shell-action-style'
const MOBILE_ACTION_STYLE = `
[data-mobile-shell-action] {
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 16px;
  border: 1px solid var(--dsw-alias-border-l1, ButtonBorder);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

[data-mobile-shell-action]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, ButtonFace);
}

[data-mobile-shell-action]:disabled {
  cursor: wait;
  opacity: .6;
}

[data-mobile-shell-action]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, Highlight);
  outline-offset: 2px;
}
`

function installMobileActionStyles(): void {
  if (document.getElementById(MOBILE_ACTION_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = MOBILE_ACTION_STYLE_ID
  style.textContent = MOBILE_ACTION_STYLE
  ;(document.head ?? document.documentElement).append(style)
}

/**
 * Depth of in-flight Host shell paints. AppWebEntry mounts into the shell root
 * across many awaits, so any concurrent progress screen would replaceChildren()
 * a half-built shell and leave a spinner over a dead document.
 */
let shellPaintDepth = 0

export function shellRootIsPainting(): boolean {
  return shellPaintDepth > 0
}

async function bootDshShell(selection: ResponsiveBootSelection | null): Promise<ResponsiveBootSelection | null> {
  shellPaintDepth += 1
  try {
    await webEntry?.dispose()
    webEntry = null
    if (selection !== null) await prepareDshClientBoot(selection.manifest)
    el.replaceChildren()
    if (selection !== null) installCompatibilityNotice(selection.compatibility)
    concealShellNativeBridges()
    webEntry = new AppWebEntry(el)
    await webEntry.run()
    const health = inspectChromeAnchors()
    if (!health.ok) console.warn('[dsh-mobile]', health.message, health.missing.join(','))
    return selection
  } catch (error) {
    if (selection?.layout === 'narrow' && selection.fallbackOfficial !== undefined) {
      console.warn('[dsh-mobile] mobile layout failed, falling back to official', error)
      return bootDshShell(selection.fallbackOfficial)
    }
    throw error
  } finally {
    shellPaintDepth -= 1
  }
}

function validOfferUrl(value: string): string | null {
  try { parseOffer(value); return value } catch { return null }
}

async function waitForScanRetry(message: string): Promise<void> {
  installMobileActionStyles()
  const retry = document.createElement('button')
  retry.id = 'scan-pairing'
  retry.dataset.mobileShellAction = ''
  retry.textContent = '重新扫码'
  mountProgressScreen(el, { title: message, spinning: false, action: retry })
  await new Promise<void>(resolve => retry.addEventListener('click', () => resolve(), { once: true }))
}

const rootScanSurface: ScanSurface = {
  show(message, retryLabel) {
    if (retryLabel === undefined) {
      mountProgressScreen(el, { title: message, spinning: true })
      return
    }
    return waitForScanRetry(message)
  },
}

async function scanUntilPaired(surface: ScanSurface = rootScanSurface): Promise<string> {
  let automatic = true
  while (true) {
    await surface.show('正在打开相机扫描配对二维码…')
    try { return await scanPairingQr() } catch (error) {
      const reason = error instanceof Error ? error.message : ''
      await surface.show(
        /过期|expired/i.test(reason)
          ? '二维码已过期，请等电脑画面更新后再扫'
          : automatic ? '没有识别到有效的 DSH 配对二维码' : '扫码失败，请对准 Host 二维码重试',
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
  onActiveHostChanged: (propagateError?: boolean) => Promise<void>,
  onProfilesEmpty: () => Promise<void>,
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
    backgroundConnection: connection().backgroundConnection,
    onBackgroundConnectionChange,
    chromeHealth: inspectChromeAnchors(),
    onActivate: hostId => activateHostProfile(hostId, {
      setActive: id => repository.setActiveHost(id),
      reconnect: () => onActiveHostChanged(true),
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
      menu?.close()
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
  if (native) {
    const backButtonListener = await App.addListener('backButton', ({ canGoBack }) => {
      routePlatformBack(document, canGoBack, {
        historyBack: () => history.back(),
        exitApp: () => App.exitApp(),
      })
    })
    own(() => backButtonListener.remove())
  }
  const viewportWidth = (): number => readViewportWidth(native ? { preferNarrow: true } : undefined)
  if (native) purgeLegacyAndroidWebCredentials(localStorage)
  const bridges = claimShellNativeBridges(native)
  const clientDeviceName = await resolveClientDeviceName(bridges.deviceIdentity)
  own(installSystemBarThemeSync(bridges.systemBars))
  const backgroundConnection = createBackgroundConnectionControl(bridges.backgroundConnection)
  let backgroundConnectionEnabled = native && readBackgroundConnectionPreference(localStorage)
  const vault = createVault(native, bridges.vault)
  const repository = new ProfileRepository(new BrowserProfileStorage(), vault)
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
          viewportWidth: viewportWidth(),
          narrowContractAvailable: officialNarrowContractAvailable(manifest),
        })
        ;(window as unknown as { __DSH_BOOT__: unknown }).__DSH_BOOT__ = responsiveSelection.manifest
        setSameOriginHostBridgeCapability(true)
        sameOriginBoot = true
      }
    } catch (error) {
      el.innerHTML = ''
      mountProgressScreen(el, { title: '无法加载 Custom Endpoint Host bridge', spinning: false })
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
          mountProgressScreen(el, { title: '配对失败', detail: reason, spinning: false })
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
          mountProgressScreen(el, { title: '请用 DSH Mobile 应用扫描 Host 配对二维码', spinning: false })
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
    await webEntry?.dispose()
  })
  let shellMounted = false
  /** Cold-pairing plugin download progress; null once the shell paints. */
  let bootProgress: { loaded: number; total: number } | null = null

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
      void showProfileMenu(repository, reconnectActiveHost, enterOnboardingAfterRemoval, async enabled => {
        await backgroundConnection.setEnabled(enabled)
        backgroundConnectionEnabled = enabled
        writeBackgroundConnectionPreference(localStorage, enabled)
      }, connectPairingOffer, () => ({
        state,
        route,
        profile: activeConnection.profile,
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
      // AppWebEntry owns the shell root while it boots. A status repaint here
      // would replaceChildren() a half-mounted shell, so the spinner would
      // survive over a document that can never finish booting.
      if (shellRootIsPainting()) return
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
              session?.forgetPaint()
              shellMounted = false
              lastError = ''
              endpointRefreshAvailable = false
              void (async () => {
                const offerUrl = await scanUntilPaired()
                try {
                  activeConnection = await prepareProfileConnection({ repository, vault, offerUrl, acknowledgeIdentityChange })
                  setProtectedCacheScope(activeConnection.profile.hostId)
                  await session?.connect(activeConnection)
                  markTransportReady()
                } catch (error) {
                  if (isHostSessionStoppedError(error)) return
                  lastError = error instanceof Error ? error.message : 'unknown error'
                  endpointRefreshAvailable ||= endpointRefreshRequired(activeConnection.profile.endpoint.kind, lastError)
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
      if (state === 'open' && !needsRecovery) {
        if (shellMounted) return
        const progress = bootProgress === null
          ? '正在拉取 Host 界面…'
          : '正在拉取 Host 界面 ' + bootProgress.loaded + '/' + bootProgress.total + '…'
        const lines = [route === '' ? progress : '当前路径：' + route + '\n' + progress]
        if (bootProgress === null) lines.push('首次配对需要下载全部插件，请稍候')
        mountProgressScreen(el, {
          title: '正在加载 ' + activeConnection.profile.displayName,
          detail: lines.join('\n'),
          spinning: true,
        })
        return
      }
      const retrying = isPassiveConnectionRetry(activity)
        || (activity.phase === 'connecting' && activity.reconnecting)
        || activity.phase === 'retry-wait'
      const showError = lastError !== '' && !retrying
      const details: string[] = []
      if (route !== '') details.push('当前路径：' + route)
      if (retrying) details.push('连接中断，正在自动重试…')
      if (endpointRefreshAvailable) details.push('电脑连接地址已失效，请重新扫码。')
      let refresh: HTMLButtonElement | undefined
      if (endpointRefreshAvailable) {
        installMobileActionStyles()
        refresh = document.createElement('button')
        refresh.id = 'endpoint-refresh'
        refresh.setAttribute('data-mobile-shell-action', '')
        refresh.textContent = '重新扫码'
      }
      mountProgressScreen(el, {
        title: retrying
          ? '正在重连 ' + activeConnection.profile.displayName
          : '正在连接 ' + activeConnection.profile.displayName,
        ...details.length === 0 ? {} : { detail: details.join('\n') },
        ...showError
          ? {
            error: /credential is missing/i.test(lastError)
              ? '登录凭证已丢失，请重新扫描 Host 二维码配对。'
              : lastError,
          }
          : {},
        spinning: activity.phase !== 'terminal',
        ...refresh === undefined ? {} : { action: refresh },
      })
      document.getElementById('endpoint-refresh')?.addEventListener('click', async event => {
        const button = event.currentTarget as HTMLButtonElement
        button.disabled = true
        session?.stop()
        endpointRefreshAvailable = false
        lastError = ''
        const offerUrl = await scanUntilPaired()
        mountProgressScreen(el, { title: '正在更新临时 Endpoint…', spinning: true })
        try {
          activeConnection = await prepareProfileConnection({ repository, vault, offerUrl, acknowledgeIdentityChange })
          setProtectedCacheScope(activeConnection.profile.hostId)
          await session?.connect(activeConnection)
          markTransportReady()
        } catch (error) {
          if (isHostSessionStoppedError(error)) return
          lastError = error instanceof Error ? error.message : 'unknown error'
          endpointRefreshAvailable ||= endpointRefreshRequired(activeConnection.profile.endpoint.kind, lastError)
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
      session?.forgetPaint()
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

    async function reconnectActiveHost(propagateError = false): Promise<void> {
      session?.stop()
      document.getElementById('endpoint-refresh-banner')?.remove()
      try {
        const next = await prepareProfileConnection({ repository, vault, acknowledgeIdentityChange })
        activeConnection = next
        setProtectedCacheScope(next.profile.hostId)
        await session?.connect(next)
        markTransportReady()
      } catch (error) {
        if (isHostSessionStoppedError(error)) return
        lastError = error instanceof Error ? error.message : String(error)
        if (lastError === 'no Active Host Profile') {
          await enterOnboardingAfterRemoval()
          return
        }
        render()
        if (propagateError) throw error
      }
    }
    session = new HostSession({
      slot,
      createManager(next) {
        return new TunnelManager({
          offerUrl: next.offerUrl,
          connectionPolicy: next.profile.connectionPolicy,
          endpointKind: next.profile.endpoint.kind,
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
            const refreshBoot = transportOpenNeedsBootRefresh(activity, nextActivity, shellMounted)
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
            if (nextActivity.phase === 'open' || (nextActivity.phase === 'connecting' && !nextActivity.reconnecting)) {
              lastError = ''
              endpointRefreshAvailable = false
            } else if ('error' in nextActivity && typeof nextActivity.error === 'string') {
              lastError = nextActivity.error
              const recovery = connectionRecoveryDecision(next.profile.endpoint.kind, nextActivity.phase, lastError)
              endpointRefreshAvailable ||= recovery === 'endpoint'
            }
            updateBadge(activity, route, shellMounted, liveDataReady)
            render()
            if (refreshBoot) {
              queueMicrotask(() => {
                void session?.remount().catch(error => {
                  lastError = error instanceof Error ? error.message : String(error)
                  render()
                })
              })
            }
          },
        })
      },
      async injectBoot(client, next) {
        const expectedOfficialLayoutRevision = typeof next.profile.presentation.officialLayoutRevision === 'string'
          ? next.profile.presentation.officialLayoutRevision
          : undefined
        const failedMobileLayoutRevision = typeof next.profile.presentation.mobileLayoutFailedRev === 'string'
          ? next.profile.presentation.mobileLayoutFailedRev
          : undefined
        const selection = await injectBootManifestFromTunnel(client, {
          viewportWidth: viewportWidth(),
          expectedOfficialLayoutRevision,
          failedMobileLayoutRevision,
          localizePlugins: native,
          hostId: next.profile.hostId,
          ...shellMounted ? {} : { pluginConcurrency: COLD_BOOT_PLUGIN_CONCURRENCY },
          onPluginProgress(loaded, total) {
            if (shellMounted) return
            bootProgress = { loaded, total }
            render()
          },
        })
        if (selection.officialLayoutRevision !== expectedOfficialLayoutRevision) {
          const latest = await repository.getActive() ?? next.profile
          await repository.upsert({
            ...latest,
            presentation: {
              ...latest.presentation,
              officialLayoutRevision: selection.officialLayoutRevision,
              mobileLayoutFailedRev: null,
            },
            updatedAt: new Date().toISOString(),
          })
        }
        return selection
      },
      async hydrateBoot(next) {
        const failedMobileLayoutRevision = typeof next.profile.presentation.mobileLayoutFailedRev === 'string'
          ? next.profile.presentation.mobileLayoutFailedRev
          : undefined
        return hydrateBootManifestFromCache(next.profile.hostId, {
          viewportWidth: viewportWidth(),
          localizePlugins: native,
          failedMobileLayoutRevision,
        })
      },
      async mount(selection, _hostId) {
        const booted = await bootDshShell(selection)
        // Claim the shell root before any further await: a status repaint
        // between here and the last await would wipe the shell just painted.
        shellMounted = true
        bootProgress = null
        responsiveSelection = booted
        if (booted?.compatibility === 'layout-load-failed') {
          const latest = await repository.getActive() ?? activeConnection.profile
          await repository.upsert({
            ...latest,
            presentation: { ...latest.presentation, mobileLayoutFailedRev: booted.officialLayoutRevision },
            updatedAt: new Date().toISOString(),
          })
        }
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
      if (isHostSessionStoppedError(error)) return
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
      if (isHostSessionStoppedError(error)) return
      lastError = error instanceof Error ? error.message : String(error)
      endpointRefreshAvailable ||= endpointRefreshRequired(activeConnection.profile.endpoint.kind, lastError)
      render()
    }
  }

  const media = matchMedia('(max-width: ' + (NARROW_LAYOUT_BREAKPOINT - 1) + 'px)')
  const handleViewportChange = (): void => {
    if (sameOriginManifest !== null) {
      const selection = selectResponsiveBootManifest(sameOriginManifest, {
        viewportWidth: viewportWidth(),
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
  if (!shellMounted && responsiveSelection !== null) {
    await bootDshShell(responsiveSelection)
  }
})()
