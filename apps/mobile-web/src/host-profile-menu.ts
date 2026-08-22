import type { ConnectionPolicy, HostProfile } from './profiles.ts'
import type { ScanSurface } from './scan-surface.ts'

const STYLE_ID = 'dsh-mobile-profile-menu-style'
const POLICY_OPTIONS: readonly [ConnectionPolicy, string][] = [
  ['automatic', '自动选择'],
  ['direct-only', '仅直连'],
  ['tunnel-only', '仅隧道'],
]

const STYLE = `
[data-dsh-profile-menu] {
  --dsh-profile-top-clearance: max(40px, calc(env(safe-area-inset-top) + 12px));
  --dsh-profile-bottom-clearance: calc(env(safe-area-inset-bottom) + 12px);
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: flex-start;
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
  max-height: min(760px, calc(100dvh - var(--dsh-profile-top-clearance) - var(--dsh-profile-bottom-clearance)));
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

[data-dsh-profile-panel][data-profile-multiple] {
  height: min(760px, calc(100dvh - var(--dsh-profile-top-clearance) - var(--dsh-profile-bottom-clearance)));
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
  gap: 10px;
  margin-bottom: 10px;
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

[data-dsh-profile-panel] [data-profile-close] {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  margin-top: 2px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  font-size: 18px;
  line-height: 24px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

[data-dsh-profile-panel] [data-profile-close]:hover,
[data-dsh-profile-panel] [data-profile-close]:active,
[data-dsh-profile-panel] [data-profile-close]:focus {
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
  outline: none;
}

[data-dsh-profile-panel] [data-profile-close]:focus-visible {
  outline: none;
}

[data-dsh-profile-menu] [data-profile-card] {
  box-sizing: border-box;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  border-radius: 18px;
  background: var(--dsw-alias-bg-layer-1, rgb(127 143 169 / 7%));
}

[data-dsh-profile-menu] [data-profile-status-card] {
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 11px;
  align-items: start;
}

[data-dsh-profile-menu] [data-profile-status-dot] {
  width: 10px;
  height: 10px;
  margin-top: 5px;
  border-radius: 50%;
  background: #eab308;
  box-shadow: 0 0 0 4px rgb(234 179 8 / 14%);
}

[data-dsh-profile-menu] [data-profile-status-dot][data-state="open"] {
  background: #22c55e;
  box-shadow: 0 0 0 4px rgb(34 197 94 / 14%);
}

[data-dsh-profile-menu] [data-profile-status-dot][data-state="closed"] {
  background: #ef4444;
  box-shadow: 0 0 0 4px rgb(239 68 68 / 14%);
}

[data-dsh-profile-menu] [data-profile-status-title] {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

[data-dsh-profile-menu] [data-profile-status-detail] {
  margin-top: 3px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-dsh-profile-menu] [data-profile-status-host] {
  margin-top: 6px;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-size: 13px;
  line-height: 19px;
  font-weight: 500;
}

[data-dsh-profile-menu] [data-profile-scan] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

[data-dsh-profile-menu] [data-profile-scan-copy] {
  min-width: 0;
}

[data-dsh-profile-menu] [data-profile-scan-title] {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

[data-dsh-profile-menu] [data-profile-scan-hint] {
  margin: 3px 0 0;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-profile-menu] [data-profile-scan-button],
[data-dsh-profile-menu] [data-profile-switch],
[data-dsh-profile-menu] [data-profile-remove] {
  flex: none;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  border-radius: 11px;
  background: var(--dsw-alias-bg-layer-2, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

[data-dsh-profile-menu] [data-profile-scan-button] {
  min-height: 36px;
  border: 0;
  background: var(--dsw-alias-state-business-primary, #4e78cc);
  color: var(--dsw-alias-label-inverse, #fff);
}

[data-dsh-profile-menu] [data-profile-scan-button]:disabled,
[data-dsh-profile-menu] [data-profile-switch]:disabled {
  cursor: wait;
  opacity: .6;
}

[data-dsh-profile-menu] [data-profile-device-list] {
  min-height: 0;
}

[data-dsh-profile-menu] [data-profile-device-list] > [data-profile-device] {
  flex: none;
}

[data-dsh-profile-menu] [data-profile-multiple] [data-profile-device-list] {
  flex: 1 1 auto;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l2, rgb(127 143 169 / 35%)) transparent;
}

[data-dsh-profile-menu] [data-profile-multiple] [data-profile-device-list]::-webkit-scrollbar {
  width: 4px;
}

[data-dsh-profile-menu] [data-profile-multiple] [data-profile-device-list]::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: var(--dsw-alias-border-l2, rgb(127 143 169 / 35%));
}

[data-dsh-profile-menu] [data-profile-scan-status] {
  margin: 9px 0 0;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 12px;
  line-height: 18px;
}

[data-dsh-profile-menu] [data-profile-scan-status][data-error] {
  color: var(--dsw-alias-state-error-primary, #c2413a);
}

[data-dsh-profile-menu] [data-profile-section-title] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14px 2px 6px;
  color: var(--dsw-alias-label-secondary, #4b5563);
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  letter-spacing: .02em;
}

[data-dsh-profile-menu] [data-profile-count] {
  color: var(--dsw-alias-label-caption, #8a95a8);
  font-weight: 500;
}

[data-dsh-profile-menu] [data-profile-section-hint] {
  margin: -2px 2px 5px;
  color: var(--dsw-alias-label-caption, #8a95a8);
  font-size: 11px;
  line-height: 17px;
}

[data-dsh-profile-menu] [data-profile-device] {
  display: grid;
  gap: 6px;
  margin-top: 6px;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1, rgb(127 143 169 / 7%));
}

[data-dsh-profile-menu] [data-profile-device][data-active] {
  border-color: var(--dsw-alias-state-business-primary, #4e78cc);
  box-shadow: none;
}

[data-dsh-profile-menu] [data-profile-device-head],
[data-dsh-profile-menu] [data-profile-device-actions] {
  display: flex;
  align-items: center;
  gap: 8px;
}

[data-dsh-profile-menu] [data-profile-device-head] {
  min-width: 0;
}

[data-dsh-profile-menu] [data-profile-device-name] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
}

[data-dsh-profile-menu] [data-profile-current] {
  flex: none;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-tertiary, #e8efff);
  color: var(--dsw-alias-label-primary-bluish, #4165a8);
  font-size: 9px;
  line-height: 14px;
  font-weight: 600;
}

[data-dsh-profile-menu] [data-profile-device-endpoint] {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 10px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  min-width: 104px;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgb(127 143 169 / 22%));
  border-radius: 9px;
  outline: none;
  background: var(--dsw-alias-bg-layer-2, Canvas);
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  font-size: 11px;
}

[data-dsh-profile-menu] [data-profile-remove] {
  min-height: 28px;
  padding: 0 9px;
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-weight: 500;
}

[data-dsh-profile-menu] [data-profile-empty] {
  padding: 20px 0;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 13px;
  text-align: center;
}
`

export interface DeviceConnectionSummary {
  state: 'open' | 'connecting' | 'closed'
  route: string
  profile?: HostProfile
}

export interface HostProfileMenuOptions {
  profiles: HostProfile[]
  active?: HostProfile
  connection: DeviceConnectionSummary
  onActivate: (hostId: string) => Promise<void>
  onPolicyChange: (profile: HostProfile, policy: ConnectionPolicy) => Promise<void>
  onRemove: (profile: HostProfile) => Promise<void>
  onScan: (surface: ScanSurface) => Promise<void>
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

/** Render the device-switch surface separately from the status-only green dot. */
export function mountHostProfileMenu(options: HostProfileMenuOptions): HostProfileMenu {
  ensureStyle()
  const overlay = document.createElement('div')
  overlay.dataset.dshProfileMenu = ''
  overlay.setAttribute('role', 'presentation')
  const panel = document.createElement('section')
  panel.dataset.dshProfilePanel = ''
  if (options.profiles.length > 1) panel.dataset.profileMultiple = ''
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
  subtitle.textContent = '上方显示实时连接；下方列出本机保存的配对设备'
  heading.append(title, subtitle)
  const closeButton = button('×', 'data-profile-close')
  closeButton.setAttribute('aria-label', '关闭设备连接')
  header.append(heading, closeButton)

  const statusCard = document.createElement('div')
  statusCard.dataset.profileCard = ''
  statusCard.dataset.profileStatusCard = ''
  const statusDot = document.createElement('span')
  statusDot.dataset.profileStatusDot = ''
  statusDot.dataset.state = options.connection.state
  const statusCopy = document.createElement('div')
  const statusTitle = document.createElement('div')
  statusTitle.dataset.profileStatusTitle = ''
  statusTitle.textContent = '当前连接 · ' + stateLabel(options.connection.state)
  const statusDetail = document.createElement('div')
  statusDetail.dataset.profileStatusDetail = ''
  statusDetail.textContent = routeLabel(options.connection.route)
  const statusHost = document.createElement('div')
  statusHost.dataset.profileStatusHost = ''
  statusHost.textContent = options.connection.profile === undefined
    ? '尚未选择设备'
    : '当前设备：' + options.connection.profile.displayName
  statusCopy.append(statusTitle, statusDetail, statusHost)
  statusCard.append(statusDot, statusCopy)

  const scanCard = document.createElement('div')
  scanCard.dataset.profileCard = ''
  scanCard.dataset.profileScan = ''
  const scanCopy = document.createElement('div')
  scanCopy.dataset.profileScanCopy = ''
  const scanTitle = document.createElement('div')
  scanTitle.dataset.profileScanTitle = ''
  scanTitle.textContent = '添加或切换设备'
  const scanHint = document.createElement('p')
  scanHint.dataset.profileScanHint = ''
  scanHint.textContent = '使用 Host 上的新二维码重新配对'
  scanCopy.append(scanTitle, scanHint)
  const scanButton = button('重新扫码配对', 'data-profile-scan-button')
  scanButton.setAttribute('aria-label', '重新扫码配对')
  scanCard.append(scanCopy, scanButton)
  const scanStatus = document.createElement('div')
  scanStatus.dataset.profileScanStatus = ''
  scanStatus.setAttribute('role', 'status')
  scanStatus.setAttribute('aria-live', 'polite')
  scanStatus.hidden = true
  scanCard.append(scanStatus)

  const deviceSectionTitle = document.createElement('div')
  deviceSectionTitle.dataset.profileSectionTitle = ''
  const deviceSectionLabel = document.createElement('span')
  deviceSectionLabel.textContent = '已配对设备'
  const deviceSectionHint = document.createElement('div')
  deviceSectionHint.dataset.profileSectionHint = ''
  deviceSectionHint.textContent = '列表包含当前设备；标记“当前连接”的就是上方状态对应的设备。'
  const deviceCount = document.createElement('span')
  deviceCount.dataset.profileCount = ''
  deviceCount.textContent = String(options.profiles.length)
  deviceSectionTitle.append(deviceSectionLabel, deviceCount)
  const deviceList = document.createElement('div')
  deviceList.dataset.profileDeviceList = ''

  let closed = false
  let retryResolver: (() => void) | null = null
  let scanning = false
  const close = (): void => {
    if (closed) return
    closed = true
    retryResolver?.()
    retryResolver = null
    overlay.remove()
  }
  const setPanelError = (message: string): void => {
    scanStatus.hidden = false
    scanStatus.dataset.error = ''
    scanStatus.textContent = message
  }
  const showScanState = (message: string, retryLabel?: string): void | Promise<void> => {
    scanStatus.hidden = false
    scanStatus.removeAttribute('data-error')
    scanStatus.textContent = message
    if (retryLabel === undefined) {
      scanButton.disabled = true
      scanButton.textContent = '正在打开相机…'
      return
    }
    scanStatus.dataset.error = ''
    scanButton.disabled = false
    scanButton.textContent = retryLabel
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
    scanButton.disabled = true
    try {
      await options.onScan({ show: showScanState })
    } catch (error) {
      scanning = false
      scanButton.disabled = false
      scanButton.textContent = '重新扫码配对'
      setPanelError(error instanceof Error ? error.message : '扫码失败，请重试')
    }
  }
  scanButton.addEventListener('click', () => { void runScan() })
  closeButton.addEventListener('click', close)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })

  for (const profile of options.profiles) {
    const active = profile.hostId === options.active?.hostId
    const device = document.createElement('article')
    device.dataset.profileDevice = ''
    if (active) device.dataset.active = ''
    const deviceHead = document.createElement('div')
    deviceHead.dataset.profileDeviceHead = ''
    const name = document.createElement('div')
    name.dataset.profileDeviceName = ''
    name.textContent = profile.displayName
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
    const actions = document.createElement('div')
    actions.dataset.profileDeviceActions = ''
    if (!active) {
      const activate = button('切换到此设备', 'data-profile-switch')
      activate.addEventListener('click', async () => {
        activate.disabled = true
        try { await options.onActivate(profile.hostId); close() } catch (error) {
          activate.disabled = false
          setPanelError(error instanceof Error ? error.message : '切换设备失败')
        }
      })
      actions.append(activate)
    }
    const remove = button('移除', 'data-profile-remove')
    remove.addEventListener('click', () => { void options.onRemove(profile) })
    actions.append(remove)
    device.append(deviceHead, endpoint, policy, actions)
    deviceList.append(device)
  }
  if (options.profiles.length === 0) {
    const empty = document.createElement('div')
    empty.dataset.profileEmpty = ''
    empty.textContent = '暂无已保存设备'
    deviceList.append(empty)
  }

  panel.append(handle, header, statusCard, scanCard, deviceSectionTitle, deviceSectionHint, deviceList)
  document.body.append(overlay)
  closeButton.focus({ preventScroll: true })
  return { close }
}
