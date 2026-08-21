/** Android-first shell bootstrap with Host Profiles and vaulted credentials. */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { parseOffer, TunnelError, type ConnectionStatus, type TunnelState } from '@dsh-mobile/e2e-tunnel'
import { AppLinkInbox } from './app-links.ts'
import { BrowserCredentialVault, NativeCredentialVault, purgeLegacyAndroidWebCredentials, type NativeCredentialVaultBridge, type ReadableCredentialVault } from './credential-vault.ts'
import { claimShellNativeBridges, concealShellNativeBridges } from './native-bridges.ts'
import { installCompatibilityNotice, loadSameOriginMobileBootManifest, NARROW_LAYOUT_BREAKPOINT, officialNarrowContractAvailable, readViewportWidth, selectResponsiveBootManifest, setSameOriginHostBridgeCapability, type BootManifest, type ResponsiveBootSelection } from './manifest.ts'
import { scanPairingQr } from './pairing-scanner.ts'
import { prepareProfileConnection, type PreparedProfileConnection } from './profile-connection.ts'
import { endpointRefreshRequired } from './reconnect-recovery.ts'
import { BrowserProfileStorage, ProfileRepository } from './profiles.ts'
import { prepareDshClientBoot } from './dsh-boot.ts'
import { hydrateBootManifestFromCache, installBadge, installShims, injectBootManifestFromTunnel, shouldInstallTunnelShims, TunnelManager, TunnelManagerSlot } from './tunnel.ts'
import { HostSession } from './host-session.ts'

const root = document.getElementById('root')
if (root === null) throw new Error('mobile-web app: missing #root')
const el: HTMLElement = root
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

async function scanUntilPaired(): Promise<string> {
  let automatic = true
  while (true) {
    el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">正在打开相机扫描配对二维码…</div>'
    try { return await scanPairingQr() } catch {
      await waitForScanRetry(automatic ? '没有识别到有效的 DSH 配对二维码' : '扫码失败，请对准 Host 二维码重试')
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

async function showProfileMenu(repository: ProfileRepository, onActiveHostChanged: () => Promise<void>): Promise<void> {
  if (document.getElementById('dsh-profile-menu') !== null) return
  const [profiles, active] = await Promise.all([repository.list(), repository.getActive()])
  const overlay = document.createElement('div')
  overlay.id = 'dsh-profile-menu'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0008;display:flex;align-items:flex-end;justify-content:center;font:14px system-ui,sans-serif'
  const panel = document.createElement('section')
  panel.style.cssText = 'box-sizing:border-box;width:min(100%,560px);max-height:82vh;overflow:auto;background:#171717;color:#fff;border-radius:16px 16px 0 0;padding:18px'
  const heading = document.createElement('h2'); heading.textContent = 'Host Profiles'; panel.append(heading)
  for (const profile of profiles) {
    const row = document.createElement('div')
    row.style.cssText = 'border-top:1px solid #ffffff24;padding:12px 0;display:grid;gap:8px'
    const label = document.createElement('strong'); label.textContent = (profile.hostId === active?.hostId ? '● ' : '') + profile.displayName; row.append(label)
    const endpoint = document.createElement('small'); endpoint.textContent = profile.endpoint.url; endpoint.style.opacity = '.7'; row.append(endpoint)
    const policy = document.createElement('select')
    for (const [value, text] of [['automatic', 'Automatic'], ['direct-only', 'Direct Only'], ['tunnel-only', 'Tunnel Only']] as const) { const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = profile.connectionPolicy === value; policy.append(option) }
    policy.onchange = async () => { await repository.upsert({ ...profile, connectionPolicy: policy.value as typeof profile.connectionPolicy, updatedAt: new Date().toISOString() }); if (profile.hostId === active?.hostId) { overlay.remove(); await onActiveHostChanged() } }
    row.append(policy)
    const actions = document.createElement('div')
    if (profile.hostId !== active?.hostId) { const activate = document.createElement('button'); activate.textContent = 'Set Active'; activate.onclick = async () => { await repository.setActiveHost(profile.hostId); overlay.remove(); await onActiveHostChanged() }; actions.append(activate) }
    const remove = document.createElement('button'); remove.textContent = 'Remove locally'; remove.style.marginLeft = '8px'; remove.onclick = async () => { if (!confirm('Remove this Host Profile and its local credential? This does not revoke the device on Host.')) return; await repository.remove(profile.hostId); overlay.remove(); await onActiveHostChanged() }; actions.append(remove)
    row.append(actions); panel.append(row)
  }
  const add = document.createElement('button'); add.textContent = 'Scan Host / Endpoint Refresh'; add.onclick = async () => { const offer = await scanUntilPaired(); location.replace(location.pathname + location.search + new URL(offer).hash) }; panel.append(add)
  const close = document.createElement('button'); close.textContent = 'Close'; close.style.marginLeft = '8px'; close.onclick = () => overlay.remove(); panel.append(close)
  overlay.onclick = event => { if (event.target === overlay) overlay.remove() }
  overlay.append(panel); document.body.append(overlay)
}

void (async () => {
  const appLinks = new AppLinkInbox(validOfferUrl, url => {
    const hash = new URL(url).hash
    location.replace(location.pathname + location.search + hash)
  })
  await App.addListener('appUrlOpen', ({ url }) => appLinks.capture(url))

  const native = Capacitor.isNativePlatform()
  if (native) purgeLegacyAndroidWebCredentials(localStorage)
  const bridges = claimShellNativeBridges(native)
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
        await waitForScanRetry('配对失败：' + reason + '。请刷新 Host 二维码后重试')
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
        while (prepared === null) {
          const offerUrl = await scanUntilPaired()
          el.innerHTML = '<div style="padding:2em;text-align:center;font-family:sans-serif">二维码已识别，正在保存 Host Profile…</div>'
          try {
            prepared = await prepareProfileConnection({ repository, vault, offerUrl, acknowledgeIdentityChange })
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error'
            await waitForScanRetry('配对失败：' + reason + '。请刷新 Host 二维码后重试')
          }
        }
      }
    }
  }

  const slot = new TunnelManagerSlot()
  if (shouldInstallTunnelShims(sameOriginBoot)) installShims(slot)
  let session: HostSession | null = null
  let shellMounted = false

  if (prepared !== null) {
    let activeConnection = prepared
    let lastError = ''
    let state: TunnelState = 'connecting'
    let route = ''
    let endpointRefreshAvailable = false
    const updateBadge = installBadge(() => { void showProfileMenu(repository, reconnectActiveHost) })
    const render = (): void => {
      if (shellMounted) return
      if (state === 'open') return
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
          await session?.connect(activeConnection)
        } catch (error) {
          lastError = 'Endpoint Refresh: ' + (error instanceof Error ? error.message : 'unknown error')
          render()
        }
      }, { once: true })
    }
    const onConnectionStatus = (status: ConnectionStatus): void => {
      route = status.route === 'direct' ? 'WebRTC Direct' : status.route === 'tunnel' ? 'Tunnel Fallback' : ''
      updateBadge(state, route)
      render()
    }
    async function reconnectActiveHost(): Promise<void> {
      const next = await prepareProfileConnection({ repository, vault, acknowledgeIdentityChange })
      activeConnection = next
      await session?.connect(next)
    }
    session = new HostSession({
      slot,
      createManager(next) {
        return new TunnelManager({
          offerUrl: next.offerUrl,
          connectionPolicy: next.profile.connectionPolicy,
          deviceLabel: next.profile.displayName,
          clientType: 'android',
          deferHeartbeat: true,
          loadCredentials: next.loadCredentials,
          onConnectionStatus,
          onState(nextState) { state = nextState; updateBadge(state, route); render() },
          onError(message) {
            lastError = message
            endpointRefreshAvailable ||= endpointRefreshRequired(next.profile.endpoint.kind, message)
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
        })
      },
      async mount(selection) {
        responsiveSelection = selection
        await bootDshShell(selection)
        shellMounted = true
      },
    })
    render()
    window.addEventListener('online', () => { void session?.probeNow() })
    await App.addListener('appStateChange', ({ isActive }) => { if (isActive) void session?.probeNow() })
    await session.connect(activeConnection)
  }

  const media = matchMedia('(max-width: ' + (NARROW_LAYOUT_BREAKPOINT - 1) + 'px)')
  media.addEventListener('change', () => {
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
  })
  if (!shellMounted) {
    await bootDshShell(responsiveSelection)
  }
})()
