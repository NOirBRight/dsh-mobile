import type { ConnectionPolicy, HostProfile } from './profiles.ts'
import type { ScanSurface } from './scan-surface.ts'
import { runHostProfileSwitch } from './profile-lifecycle.ts'
import { mountProgressScreen } from './progress-screen.ts'
import { MOBILE_PLATFORM_BACK_EVENT } from './platform-back.ts'

const STYLE_ID = 'dsh-mobile-profile-menu-style'
const POLICY_OPTIONS: readonly [ConnectionPolicy, string][] = [
  ['automatic', '自动选择'],
  ['direct-only', '仅直连'],
  ['tunnel-only', '仅隧道'],
]

const REMOVE_ICON = `
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M5 3.5h6M3.5 5.5h9M6.5 5.5V12M9.5 5.5V12M5.5 5.5l.4 7.2h4.2l.4-7.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`.trim()

const SCAN_ICON = `
<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
  <path d="M3 6.5V3.5h3M15 6.5V3.5h-3M3 11.5v3h3M15 11.5v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="6.5" y="6.5" width="5" height="5" rx="0.8" stroke="currentColor" stroke-width="1.3"/>
</svg>
`.trim()

const STYLE = `
[data-dsh-profile-menu] {
  --dsh-profile-top-clearance: max(40px, calc(env(safe-area-inset-top) + 12px));
  --dsh-profile-bottom-clearance: calc(env(safe-area-inset-bottom) + 12px);
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: var(--dsh-profile-top-clearance) 12px var(--dsh-profile-bottom-clearance);
  background: var(--dsw-alias-bg-mask-1, rgb(15 23 42 / 38%));
  backdrop-filter: blur(10px);
  color: var(--dsw-alias-label-primary, CanvasText);
  font-family: var(--ds-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}

[data-dsh-profile-panel] {
  box-sizing: border-box;
  width: min(100%, 560px);
  max-height: calc(100dvh - var(--dsh-profile-top-clearance) - var(--dsh-profile-bottom-clearance));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px 18px 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  border-radius: 26px;
  background: var(--dsw-alias-bg-layer-2, Canvas);
  box-shadow: var(--dsw-shadow-lv3, 0 -14px 44px rgb(15 23 42 / 22%));
}

[data-dsh-profile-panel] [data-profile-handle] {
  flex: none;
  width: 38px;
  height: 4px;
  margin: 0 auto 10px;
  border-radius: 99px;
  background: var(--dsw-alias-border-l2, rgb(127 143 169 / 35%));
}

[data-dsh-profile-panel] [data-profile-header] {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  flex: none;
  margin-bottom: 8px;
}

[data-dsh-profile-panel] [data-profile-heading] {
  flex: 1;
  min-width: 0;
}

[data-dsh-profile-panel] h2 {
  margin: 0;
  font-size: 20px;
  line-height: 28px;
  font-weight: 650;
  letter-spacing: -.02em;
}

[data-dsh-profile-panel] [data-profile-subtitle] {
  margin: 4px 0 0;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-profile-panel] [data-profile-scan-button],
[data-dsh-profile-panel] [data-profile-close] {
  display: grid;
  place-items: center;
  box-sizing: content-box;
  flex: none;
  width: 24px;
  height: 24px;
  margin: -6px -4px 0 0;
  padding: 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #718096);
  font: inherit;
  font-size: 18px;
  line-height: 24px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

[data-dsh-profile-panel] [data-profile-scan-button] {
  color: var(--dsw-alias-label-secondary, #4b5563);
}

[data-dsh-profile-panel] [data-profile-close]:hover,
[data-dsh-profile-panel] [data-profile-close]:active,
[data-dsh-profile-panel] [data-profile-scan-button]:hover,
[data-dsh-profile-panel] [data-profile-scan-button]:active {
  background: transparent !important;
  border-color: transparent !important;
}

[data-dsh-profile-panel] [data-profile-close]:focus:not(:focus-visible),
[data-dsh-profile-panel] [data-profile-scan-button]:focus:not(:focus-visible) {
  outline: none;
}

[data-dsh-profile-panel] [data-profile-close]:focus-visible,
[data-dsh-profile-panel] [data-profile-scan-button]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4e78cc);
  outline-offset: 2px;
}

[data-dsh-profile-menu] [data-profile-scan-button]:disabled {
  cursor: wait;
  opacity: .6;
}

[data-dsh-profile-menu] [data-profile-add-device] {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  margin-top: 6px;
  padding: 14px 12px;
  border: 1px dashed var(--dsw-alias-border-l1, rgb(127 143 169 / 35%));
  border-radius: 16px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

[data-dsh-profile-menu] [data-profile-add-device]:hover,
[data-dsh-profile-menu] [data-profile-add-device]:active {
  background: var(--dsw-alias-bg-layer-1, rgb(127 143 169 / 7%));
}

[data-dsh-profile-menu] [data-profile-add-device]:disabled {
  cursor: wait;
  opacity: .6;
}

[data-dsh-profile-menu] [data-profile-scan-status] {
  flex: none;
  margin: 0 2px 8px;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-profile-menu] [data-profile-scan-status][data-error] {
  color: var(--dsw-alias-state-error-primary, #c2413a);
}

[data-dsh-profile-menu] [data-profile-device-list] {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l2, rgb(127 143 169 / 35%)) transparent;
}

[data-dsh-profile-menu] [data-profile-device-list]::-webkit-scrollbar {
  width: 4px;
}

[data-dsh-profile-menu] [data-profile-device-list]::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: var(--dsw-alias-border-l2, rgb(127 143 169 / 35%));
}

[data-dsh-profile-menu] [data-profile-device-list] > [data-profile-device] {
  flex: none;
}

[data-dsh-profile-menu] [data-profile-settings] {
  flex: none;
  margin-top: 10px;
}

[data-dsh-profile-menu] [data-profile-card] {
  box-sizing: border-box;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  border-radius: 18px;
  background: var(--dsw-alias-bg-layer-1, rgb(127 143 169 / 7%));
}

[data-dsh-profile-menu] [data-profile-status-dot] {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #eab308;
  box-shadow: 0 0 0 3px rgb(234 179 8 / 14%);
}

[data-dsh-profile-menu] [data-profile-status-dot][data-state="open"] {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgb(34 197 94 / 14%);
}

[data-dsh-profile-menu] [data-profile-status-dot][data-state="closed"] {
  background: #ef4444;
  box-shadow: 0 0 0 3px rgb(239 68 68 / 14%);
}

[data-dsh-profile-menu] [data-profile-section-title] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 4px 2px 6px;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: .02em;
}

[data-dsh-profile-menu] [data-profile-chrome-health] {
  margin: 0 2px 8px;
  color: var(--dsw-alias-state-warn-primary, #b45309);
  font-size: 11px;
  line-height: 17px;
}

[data-dsh-profile-menu] [data-profile-device] {
  display: grid;
  gap: 9px;
  margin-top: 8px;
  padding: 13px 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  border-radius: 18px;
  background: var(--dsw-alias-bg-layer-1, rgb(127 143 169 / 7%));
  transition: border-color 160ms ease, background-color 160ms ease;
}

[data-dsh-profile-menu] [data-profile-device][data-active] {
  border-color: var(--dsw-alias-state-business-primary, #4e78cc);
  box-shadow: none;
}

[data-dsh-profile-menu] [data-profile-device]:not([data-active]) {
  cursor: pointer;
}

[data-dsh-profile-menu] [data-profile-device]:not([data-active]):hover,
[data-dsh-profile-menu] [data-profile-device]:not([data-active]):active {
  border-color: var(--dsw-alias-border-l2, rgb(127 143 169 / 35%));
  background: var(--dsw-alias-bg-layer-2, Canvas);
}

[data-dsh-profile-menu] [data-profile-device-head] {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
}

[data-dsh-profile-menu] [data-profile-device-head] [data-profile-status-dot] {
  margin-top: 7px;
}

[data-dsh-profile-menu] [data-profile-remove] {
  flex: none;
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #718096);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

[data-dsh-profile-menu] [data-profile-remove]:hover,
[data-dsh-profile-menu] [data-profile-remove]:active {
  background: transparent;
  color: var(--dsw-alias-state-error-primary, #c2413a);
}

[data-dsh-profile-menu] [data-profile-device-name] {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--dsw-alias-label-primary, CanvasText);
  font-size: 16px;
  line-height: 22px;
  font-weight: 650;
  letter-spacing: -.01em;
  white-space: normal;
  overflow-wrap: anywhere;
}

[data-dsh-profile-menu] [data-profile-current] {
  flex: none;
  margin-top: 1px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-tertiary, #e8efff);
  color: var(--dsw-alias-label-primary-bluish, #4165a8);
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
}

[data-dsh-profile-menu] [data-profile-device-endpoint] {
  overflow: hidden;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-dsh-profile-menu] [data-profile-device-connection] {
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 11px;
  line-height: 17px;
}

[data-dsh-profile-menu] [data-profile-policy] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 11px;
  line-height: 17px;
}

[data-dsh-profile-menu] select {
  box-sizing: border-box;
  min-width: 104px;
  height: 36px;
  padding: 0 36px 0 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  border-radius: 10px;
  appearance: none;
  -webkit-appearance: none;
  background-color: var(--dsw-alias-bg-layer-2, Canvas);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='m1 1.5 5 5 5-5' stroke='%23718096' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 12px 8px;
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  font-size: 11px;
}

[data-dsh-profile-menu] select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4e78cc);
  outline-offset: 2px;
}

[data-dsh-profile-menu] select:disabled {
  border-color: var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  background-color: var(--dsw-alias-bg-layer-1, rgb(127 143 169 / 7%));
  color: var(--dsw-alias-label-tertiary, #718096);
  cursor: not-allowed;
  opacity: .65;
}

[data-dsh-profile-menu] [data-profile-empty] {
  padding: 20px 0;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 13px;
  text-align: center;
}

[data-dsh-profile-menu] [data-profile-switch-back] {
  box-sizing: border-box;
  min-height: 40px;
  padding: 8px 18px;
  border: 1px solid var(--dsw-alias-border-l1, ButtonBorder);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  cursor: pointer;
}
`

export interface DeviceConnectionSummary {
  state: 'open' | 'connecting' | 'closed'
  route: string
  profile?: HostProfile
  backgroundConnection?: HostProfileMenuOptions['backgroundConnection']
}

export interface HostProfileMenuOptions {
  profiles: HostProfile[]
  active?: HostProfile
  connection: DeviceConnectionSummary
  onActivate: (hostId: string) => Promise<void>
  /** Stop an in-flight Host switch (timeout or 取消). */
  onAbortSwitch?: () => void
  onPolicyChange: (profile: HostProfile, policy: ConnectionPolicy) => Promise<void>
  backgroundConnection?: { enabled: boolean }
  onBackgroundConnectionChange?: (enabled: boolean) => Promise<void>
  onRemove: (profile: HostProfile) => Promise<void>
  onScan: (surface: ScanSurface) => Promise<void>
  chromeHealth?: { ok: boolean; message: string }
}

export interface HostProfileMenu {
  close(): void
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
}

function endpointLabel(profile: HostProfile): string {
  try { return new URL(profile.endpoint.url).host } catch { return profile.endpoint.url }
}

function stateLabel(state: DeviceConnectionSummary['state']): string {
  return state === 'open' ? '已连接' : state === 'connecting' ? '连接中' : '已断开'
}

function routeLabel(route: string): string {
  if (route === 'direct') return '直连'
  if (route === 'tunnel') return '隧道回退'
  return route === '' ? '等待连接路径' : route
}

function button(label: string, attribute: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.textContent = label
  el.setAttribute(attribute, '')
  return el
}

function isInteractiveControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('button, select, label, a, input') !== null
}

/** Render the device-switch sheet: scan in the header, devices as the body, settings last. */
export function mountHostProfileMenu(options: HostProfileMenuOptions): HostProfileMenu {
  ensureStyle()
  const overlay = document.createElement('div')
  overlay.dataset.dshProfileMenu = ''
  overlay.setAttribute('role', 'presentation')
  const panel = document.createElement('section')
  panel.dataset.dshProfilePanel = ''
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', 'dsh-profile-title')
  overlay.append(panel)

  const handle = document.createElement('div')
  handle.dataset.profileHandle = ''
  const header = document.createElement('header')
  header.dataset.profileHeader = ''
  const heading = document.createElement('div')
  heading.dataset.profileHeading = ''
  const title = document.createElement('h2')
  title.id = 'dsh-profile-title'
  title.textContent = '设备连接'
  const subtitle = document.createElement('p')
  subtitle.dataset.profileSubtitle = ''
  subtitle.textContent = '点列表切换已保存设备，或点「添加设备」扫码连接另一台电脑'
  heading.append(title, subtitle)
  const scanButton = document.createElement('button')
  scanButton.type = 'button'
  scanButton.dataset.profileScanButton = ''
  scanButton.setAttribute('aria-label', '扫码添加或重新配对')
  scanButton.title = '扫码添加或重新配对'
  scanButton.innerHTML = SCAN_ICON
  const closeButton = button('×', 'data-profile-close')
  closeButton.setAttribute('aria-label', '关闭设备连接')
  header.append(heading, scanButton, closeButton)

  const scanStatus = document.createElement('div')
  scanStatus.dataset.profileScanStatus = ''
  scanStatus.setAttribute('role', 'status')
  scanStatus.setAttribute('aria-live', 'polite')
  scanStatus.hidden = true

  const deviceList = document.createElement('div')
  deviceList.dataset.profileDeviceList = ''
  const addDevice = document.createElement('button')
  addDevice.type = 'button'
  addDevice.dataset.profileAddDevice = ''
  addDevice.setAttribute('aria-label', '扫码添加另一台电脑')
  addDevice.textContent = '添加设备'
  deviceList.append(addDevice)

  const settings = document.createElement('div')
  settings.dataset.profileSettings = ''
  const settingsTitle = document.createElement('div')
  settingsTitle.dataset.profileSectionTitle = ''
  settingsTitle.textContent = '设置'
  const backgroundCard = document.createElement('div')
  backgroundCard.dataset.profileCard = ''
  backgroundCard.dataset.profileBackgroundConnection = ''
  backgroundCard.hidden = options.backgroundConnection === undefined
  if (options.backgroundConnection !== undefined) {
    const label = document.createElement('label')
    label.dataset.profilePolicy = ''
    const labelText = document.createElement('span')
    labelText.textContent = '后台连接保护（实验）'
    const select = document.createElement('select')
    select.setAttribute('aria-label', '后台连接保护')
    for (const [value, text] of [['disabled', '关闭'], ['enabled', '开启']] as const) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      option.selected = options.backgroundConnection.enabled === (value === 'enabled')
      select.append(option)
    }
    const disclosure = document.createElement('div')
    disclosure.style.marginTop = '8px'
    disclosure.style.color = 'var(--dsw-alias-label-tertiary, #718096)'
    disclosure.style.fontSize = '12px'
    disclosure.style.lineHeight = '18px'
    disclosure.textContent = '开启后 Android 会显示常驻通知，并使用前台服务减少后台冻结；连接仍由 WebView 管理，系统仍可能终止进程。'
    select.addEventListener('change', () => {
      select.disabled = true
      const prior = options.backgroundConnection?.enabled ?? false
      const enabled = select.value === 'enabled'
      void options.onBackgroundConnectionChange?.(enabled).then(close).catch(error => {
        select.value = prior ? 'enabled' : 'disabled'
        setPanelError(error instanceof Error ? error.message : '后台连接设置保存失败')
      }).finally(() => { select.disabled = false })
    })
    label.append(labelText, select)
    backgroundCard.append(label, disclosure)
  }
  if (options.chromeHealth !== undefined && !options.chromeHealth.ok) {
    const health = document.createElement('div')
    health.dataset.profileChromeHealth = ''
    health.setAttribute('role', 'status')
    health.textContent = options.chromeHealth.message
    settings.append(health)
  }
  if (options.backgroundConnection !== undefined) {
    settings.append(settingsTitle, backgroundCard)
  }
  settings.hidden = settings.childElementCount === 0

  let closed = false
  let retryResolver: (() => void) | null = null
  let scanning = false
  let switching = false
  const close = (): void => {
    if (closed) return
    closed = true
    document.removeEventListener(MOBILE_PLATFORM_BACK_EVENT, onPlatformBack)
    retryResolver?.()
    retryResolver = null
    overlay.remove()
  }
  function onPlatformBack(event: Event): void {
    event.preventDefault()
    close()
  }
  const setScanBusy = (busy: boolean): void => {
    scanButton.disabled = busy
    addDevice.disabled = busy
  }
  const setPanelError = (message: string): void => {
    scanStatus.hidden = false
    scanStatus.dataset.error = ''
    scanStatus.textContent = message
  }
  const showSwitchConnecting = (displayName: string): void => {
    switching = true
    const cancel = button('取消', 'data-profile-switch-cancel')
    cancel.setAttribute('data-mobile-shell-action', '')
    cancel.addEventListener('click', () => {
      options.onAbortSwitch?.()
      close()
    })
    const progress = mountProgressScreen(overlay, {
      title: '正在连接 ' + displayName,
      detail: '正在切换 Host，请稍候…',
      spinning: true,
      action: cancel,
    })
    progress.dataset.profileSwitchProgress = ''
    progress.setAttribute('role', 'status')
    progress.setAttribute('aria-live', 'polite')
    progress.setAttribute('aria-busy', 'true')
  }
  const showSwitchError = (displayName: string, message: string): void => {
    if (closed) return
    const back = button('返回', 'data-profile-switch-back')
    back.setAttribute('data-mobile-shell-action', '')
    back.addEventListener('click', close)
    const progress = mountProgressScreen(overlay, {
      title: '无法连接 ' + displayName,
      detail: 'Host 切换未完成',
      error: message,
      spinning: false,
      action: back,
    })
    progress.dataset.profileSwitchProgress = ''
    progress.setAttribute('role', 'alert')
  }
  const showScanState = (message: string, retryLabel?: string): void | Promise<void> => {
    scanStatus.hidden = false
    scanStatus.removeAttribute('data-error')
    scanStatus.textContent = message
    if (retryLabel === undefined) {
      setScanBusy(true)
      return
    }
    scanStatus.dataset.error = ''
    setScanBusy(false)
    scanStatus.textContent = message + ' · ' + retryLabel
    return new Promise(resolve => { retryResolver = resolve })
  }
  const runScan = async (): Promise<void> => {
    if (closed) return
    if (retryResolver !== null) {
      const resolve = retryResolver
      retryResolver = null
      resolve()
      return
    }
    if (scanning) return
    scanning = true
    setScanBusy(true)
    try {
      await options.onScan({ show: showScanState })
    } catch (error) {
      scanning = false
      setScanBusy(false)
      setPanelError(error instanceof Error ? error.message : '扫码失败，请重试')
    }
  }
  scanButton.addEventListener('click', () => { void runScan() })
  addDevice.addEventListener('click', () => { void runScan() })
  closeButton.addEventListener('click', close)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  document.addEventListener(MOBILE_PLATFORM_BACK_EVENT, onPlatformBack)

  for (const profile of options.profiles) {
    const active = profile.hostId === options.active?.hostId
    const device = document.createElement('article')
    device.dataset.profileDevice = ''
    if (active) device.dataset.active = ''
    const deviceHead = document.createElement('div')
    deviceHead.dataset.profileDeviceHead = ''
    if (active) {
      const statusDot = document.createElement('span')
      statusDot.dataset.profileStatusDot = ''
      statusDot.dataset.state = options.connection.state
      statusDot.title = stateLabel(options.connection.state)
      deviceHead.append(statusDot)
    }
    const name = document.createElement('div')
    name.dataset.profileDeviceName = ''
    name.textContent = profile.displayName
    name.title = profile.displayName
    deviceHead.append(name)
    if (active) {
      const current = document.createElement('span')
      current.dataset.profileCurrent = ''
      current.textContent = '当前连接'
      deviceHead.append(current)
    }
    const endpoint = document.createElement('div')
    endpoint.dataset.profileDeviceEndpoint = ''
    endpoint.textContent = endpointLabel(profile)
    endpoint.title = profile.endpoint.url
    const connection = document.createElement('div')
    connection.dataset.profileDeviceConnection = ''
    connection.textContent = active
      ? stateLabel(options.connection.state) + ' · ' + routeLabel(options.connection.route)
      : '点击卡片切换到此 Host'
    const policy = document.createElement('label')
    policy.dataset.profilePolicy = ''
    const policyText = document.createElement('span')
    policyText.textContent = '连接方式'
    const select = document.createElement('select')
    select.setAttribute('aria-label', profile.displayName + '连接方式')
    for (const [value, label] of POLICY_OPTIONS) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      option.selected = profile.connectionPolicy === value
      select.append(option)
    }
    select.addEventListener('change', () => {
      select.disabled = true
      void options.onPolicyChange(profile, select.value as ConnectionPolicy).catch(error => {
        select.value = profile.connectionPolicy
        setPanelError(error instanceof Error ? error.message : '连接方式保存失败')
      }).finally(() => { select.disabled = false })
    })
    policy.append(policyText, select)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.dataset.profileRemove = ''
    remove.setAttribute('aria-label', '移除' + profile.displayName)
    remove.title = '移除设备'
    remove.innerHTML = REMOVE_ICON
    remove.addEventListener('click', event => {
      event.stopPropagation()
      void options.onRemove(profile)
    })
    deviceHead.append(remove)
    if (!active) {
      device.setAttribute('aria-label', '切换到' + profile.displayName)
      device.addEventListener('click', event => {
        if (switching || isInteractiveControl(event.target)) return
        device.setAttribute('aria-busy', 'true')
        void runHostProfileSwitch(profile, options.onActivate, {
          showConnecting: showSwitchConnecting,
          showError: message => { showSwitchError(profile.displayName, message) },
          close,
          abort: options.onAbortSwitch,
        })
      })
    }
    device.append(deviceHead, endpoint, connection, policy)
    deviceList.append(device)
  }
  if (options.profiles.length === 0) {
    const empty = document.createElement('div')
    empty.dataset.profileEmpty = ''
    empty.textContent = '还没有已保存设备'
    deviceList.append(empty)
  }

  panel.append(handle, header, scanStatus, deviceList, settings)
  document.body.append(overlay)
  closeButton.focus({ preventScroll: true })
  return { close }
}
