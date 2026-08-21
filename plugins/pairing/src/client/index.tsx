import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { installRemoteNavIcon } from './nav-icon.ts'
import {
  buildEndpointSaveRequest,
  decodeEndpointSaveResult,
  decodePairedDevices,
  decodePairingStatus,
  endpointDraftDirty,
  livePairedDevices,
  pairingQrUrl,
  pairingRefreshQrUrl,
  REMOTE_SETTINGS_SECTION,
  type PairedDevice,
  type PairingStatus,
} from './model.ts'

export const name = 'dsh-mobile-pairing-client'
export const inject = ['slots', 'locale']

type Translate = (key: string) => string
interface ClientContext {
  locale: { register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void; bind(namespace: string): Translate }
  slots: {
    inject(name: string, factory: () => unknown): void
    register(options: Record<string, unknown>, render: (props: { t: Translate }) => JSX.Element): unknown
  }
  effect(effect: () => void | (() => void), label: string): void
}

const zh = {
  nav: '远程', title: '远程', intro: '用手机 App 或相机扫码，连到这台电脑。',
  loading: '正在加载…', retry: '重试', loadFailed: '无法加载远程设置。',
  refreshQr: '换一张码', qrAlt: '配对二维码',
  devices: '已配对设备', noDevices: '还没有设备。扫下面的码即可添加。',
  phone: '手机', web: '浏览器', unknownType: '设备', lastSeen: '最近在线', justNow: '刚刚',
  minutesAgo: '{n} 分钟前', hoursAgo: '{n} 小时前', revoke: '撤销', rename: '重命名',
  renamePrompt: '设备名称', revokeConfirm: '撤销后这台设备需要重新扫码。', refreshAddress: '更新地址',
  closeRefresh: '关闭', access: '访问方式',
  scanTitle: '扫码连接', scanHint: '用 App 或手机相机扫码。',
  currentAddress: '当前地址', copyHint: '点击复制',
  qrPendingSave: '保存后，下面的码会换成新地址。',
  customStep1: '1. 新开一个 HTTPS 子域名，不要用已经有登录页的那个。',
  customStep2: '2. 让它访问这台电脑的 127.0.0.1:43169，不要转到 3080。',
  customStep3: '3. 不要加账号密码，并打开 WebSocket。',
  customStep4: '4. 把 https://子域名 填到上面，点保存。',
  temporarySetup: '这个地址会变。重启后已配对设备点「更新地址」即可。',
  temporary: '临时地址', temporaryHint: '自动分配，不用保存',
  permanent: '固定域名', permanentHint: '用你自己的 HTTPS',
  notReady: '地址还没准备好', copied: '已复制',
  customUrl: '域名', save: '保存', saving: '检查中…', saved: '已保存',
  stageEndpoint: '地址格式不对', stageTls: '打不开这个地址', stageIdentity: '不是这台电脑',
  stageProtocol: '协议不匹配', stageCapabilities: '能力不匹配', stageWebsocket: '无法建立连接',
}
const en = {
  nav: 'Remote', title: 'Remote', intro: 'Scan with the app or the phone camera to connect this computer.',
  loading: 'Loading…', retry: 'Retry', loadFailed: 'Could not load remote settings.',
  refreshQr: 'New code', qrAlt: 'Pairing code',
  devices: 'Paired devices', noDevices: 'No devices yet. Scan the code below.',
  phone: 'Phone', web: 'Browser', unknownType: 'Device', lastSeen: 'Last seen', justNow: 'Just now',
  minutesAgo: '{n} min ago', hoursAgo: '{n} hr ago', revoke: 'Revoke', rename: 'Rename',
  renamePrompt: 'Device name', revokeConfirm: 'This device will need to scan again.', refreshAddress: 'Update address',
  closeRefresh: 'Close', access: 'Access mode',
  scanTitle: 'Scan to connect', scanHint: 'Scan with the app or the phone camera.',
  currentAddress: 'Current address', copyHint: 'Click to copy',
  qrPendingSave: 'Save to update the code below.',
  customStep1: '1. Use a new HTTPS subdomain, not one that already has a login page.',
  customStep2: '2. Point it at 127.0.0.1:43169 on this computer, not port 3080.',
  customStep3: '3. Do not add a password, and allow WebSocket.',
  customStep4: '4. Paste https://your-domain above and save.',
  temporarySetup: 'This address can change. After a restart, paired devices only need Update address.',
  temporary: 'Temporary', temporaryHint: 'Assigned automatically, no save needed',
  permanent: 'Custom domain', permanentHint: 'Your own HTTPS address',
  notReady: 'Address is not ready', copied: 'Copied',
  customUrl: 'Domain', save: 'Save', saving: 'Checking…', saved: 'Saved',
  stageEndpoint: 'Invalid address', stageTls: 'Address unreachable', stageIdentity: 'Wrong computer',
  stageProtocol: 'Protocol mismatch', stageCapabilities: 'Capabilities mismatch', stageWebsocket: 'Could not connect',
}

const page: CSSProperties = { display: 'grid', gap: 28, minWidth: 0, color: 'var(--dsw-alias-label-primary)' }
const heading: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px' }
const muted: CSSProperties = { margin: '6px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px' }
const card: CSSProperties = {
  display: 'grid', gap: 12, padding: 16, borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-1)', boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}
const action: CSSProperties = {
  minHeight: 32, border: 'none', borderRadius: 10, padding: '6px 12px',
  background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)',
  font: 'inherit', fontSize: 13, cursor: 'pointer',
}
const danger: CSSProperties = { ...action, color: '#dc2626' }
const input: CSSProperties = {
  ...action, cursor: 'text', width: '100%', boxSizing: 'border-box',
  background: 'var(--dsw-alias-bg-module-platform)', boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}

function formatSeen(at: number, t: Translate): string {
  const delta = Date.now() - at
  if (delta < 60_000) return t('justNow')
  if (delta < 3_600_000) return t('minutesAgo').replace('{n}', String(Math.max(1, Math.floor(delta / 60_000))))
  if (delta < 86_400_000) return t('hoursAgo').replace('{n}', String(Math.max(1, Math.floor(delta / 3_600_000))))
  return new Date(at).toLocaleString()
}

function deviceKind(device: PairedDevice, t: Translate): string {
  if (device.clientType === 'android') return t('phone')
  if (device.clientType === 'browser') return t('web')
  return t('unknownType')
}

function DshMobileCard({ t }: { t: Translate }) {
  const [status, setStatus] = useState<PairingStatus | null>()
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [revision, setRevision] = useState(0)
  const [failed, setFailed] = useState(false)
  const [mode, setMode] = useState<'quick' | 'custom'>('quick')
  const [customUrl, setCustomUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const hydrated = useRef(false)
  const liveEndpoint = useRef<string | null>(null)

  async function loadAll() {
    setFailed(false)
    try {
      const [statusResponse, devicesResponse] = await Promise.all([
        fetch('/pair/status', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/pair/devices', { credentials: 'same-origin', cache: 'no-store' }),
      ])
      if (!statusResponse.ok) throw new Error('status unavailable')
      const decoded = decodePairingStatus(await statusResponse.json())
      if (decoded === null) throw new Error('invalid status')
      setStatus(decoded)
      const nextUrl = decoded.endpoint?.url ?? null
      if (liveEndpoint.current !== null && nextUrl !== null && nextUrl !== liveEndpoint.current) setRevision(current => current + 1)
      liveEndpoint.current = nextUrl
      if (!hydrated.current) {
        setMode(decoded.endpointMode)
        setCustomUrl(decoded.customEndpointUrl ?? '')
        hydrated.current = true
      }
      const decodedDevices = devicesResponse.ok ? decodePairedDevices(await devicesResponse.json()) : []
      setDevices(livePairedDevices(decodedDevices ?? []))
    } catch { setStatus(null); setFailed(true) }
  }

  async function saveEndpoint(nextMode: 'quick' | 'custom', nextUrl = customUrl) {
    const request = buildEndpointSaveRequest(nextMode, nextUrl)
    if ('error' in request) { setSaveMessage(null); setSaveError(t('customUrl')); return }
    setSaving(true); setSaveMessage(null); setSaveError(null)
    try {
      const response = await fetch('/pair/endpoint', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
      const decoded = decodeEndpointSaveResult(await response.json())
      if (decoded === null) throw new Error('invalid save response')
      if (!decoded.ok) {
        setSaveError(t(({ endpoint: 'stageEndpoint', tls: 'stageTls', identity: 'stageIdentity', protocol: 'stageProtocol', capabilities: 'stageCapabilities', websocket: 'stageWebsocket' } as const)[decoded.stage]))
        return
      }
      setMode(nextMode)
      setSaveMessage(t('saved'))
      setRevision(current => current + 1)
      await loadAll()
    } catch { setSaveError(t('loadFailed')) } finally { setSaving(false) }
  }

  async function selectMode(next: 'quick' | 'custom') {
    setMode(next)
    setSaveMessage(null)
    setSaveError(null)
    if (next === 'quick' && status?.endpointMode !== 'quick') await saveEndpoint('quick')
  }

  async function revoke(id: string) {
    if (!window.confirm(t('revokeConfirm'))) return
    await fetch('/pair/revoke', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
    await loadAll()
  }

  async function rename(device: PairedDevice) {
    const next = window.prompt(t('renamePrompt'), device.label || device.id)
    if (next === null) return
    await fetch('/pair/label', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: device.id, label: next }) })
    await loadAll()
  }

  async function copyUrl(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1600) } catch { /* ignore */ }
  }

  useEffect(() => { void loadAll(); setRevision(current => current + 1) }, [])
  useEffect(() => {
    const timer = window.setInterval(() => { void loadAll() }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  const live = livePairedDevices(devices)
  const endpointUrl = status?.endpoint?.url
  const dirty = status ? endpointDraftDirty(mode, customUrl, status) : false

  return <section style={page}>
    <style>{`
      .dsh-mobile-remote-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    `}</style>
    <header>
      <h2 style={heading}>{t('title')}</h2>
      <p style={muted}>{t('intro')}</p>
    </header>

    {status === undefined && !failed ? <p style={muted}>{t('loading')}</p> : null}
    {failed ? <div style={card}><p style={muted}>{t('loadFailed')}</p><button type="button" style={action} onClick={() => void loadAll()}>{t('retry')}</button></div> : null}

    {status ? <>
      <div style={{ ...card, marginTop: 4, gap: 16 }}>
        <div>
          <h3 style={heading}>{t('access')}</h3>
          <div className="dsh-mobile-remote-modes" role="radiogroup" aria-label={t('access')} style={{ marginTop: 10 }}>
            {([
              ['quick', 'temporary', 'temporaryHint'],
              ['custom', 'permanent', 'permanentHint'],
            ] as const).map(([value, title, hint]) => <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => void selectMode(value)} style={{
              minHeight: 56, textAlign: 'left', border: 'none', borderRadius: 12, padding: '10px 12px', cursor: 'pointer',
              background: mode === value ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
              boxShadow: mode === value ? 'inset 0 0 0 1.5px var(--dsw-alias-label-primary)' : 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
              color: 'var(--dsw-alias-label-primary)',
            }}>
              <strong style={{ display: 'block', fontSize: 14 }}>{t(title)}</strong>
              <span style={{ display: 'block', marginTop: 2, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{t(hint)}</span>
            </button>)}
          </div>
          {mode === 'custom' ? <form style={{ display: 'grid', gap: 8, marginTop: 12 }} onSubmit={event => { event.preventDefault(); void saveEndpoint('custom') }}>
            <label style={{ ...muted, margin: 0 }} htmlFor="dsh-mobile-custom-url">{t('customUrl')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
              <input id="dsh-mobile-custom-url" value={customUrl} onChange={event => setCustomUrl(event.target.value)} placeholder="https://host.example" autoComplete="off" style={input} />
              <button type="submit" style={action} disabled={saving || !dirty}>{saving ? t('saving') : t('save')}</button>
            </div>
            <ol style={{ ...muted, margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
              <li>{t('customStep1')}</li>
              <li>{t('customStep2')}</li>
              <li>{t('customStep3')}</li>
              <li>{t('customStep4')}</li>
            </ol>
            {dirty ? <p style={{ ...muted, margin: 0 }}>{t('qrPendingSave')}</p> : null}
          </form> : <p style={{ ...muted, margin: '10px 0 0' }}>{t('temporarySetup')}</p>}
          {saveMessage ? <p role="status" style={{ ...muted, margin: '8px 0 0' }}>{saveMessage}</p> : null}
          {saveError ? <p role="alert" style={{ ...muted, margin: '8px 0 0', color: '#dc2626' }}>{saveError}</p> : null}
        </div>

        <div style={{ display: 'grid', justifyItems: 'center', gap: 10, padding: 16, borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' }}>
          <h3 style={{ ...heading, justifySelf: 'stretch' }}>{t('scanTitle')}</h3>
          <p style={{ ...muted, margin: 0, justifySelf: 'stretch' }}>{t('scanHint')}</p>
          {endpointUrl ? <>
            <img key={revision} src={pairingQrUrl('android', revision)} alt={t('qrAlt')} style={{ boxSizing: 'border-box', width: 180, maxWidth: '100%', padding: 8, borderRadius: 12, background: '#fff' }} />
            <button type="button" onClick={() => void copyUrl(endpointUrl)} style={{
              ...action, display: 'grid', gap: 4, width: '100%', textAlign: 'left', padding: '10px 12px',
              background: 'var(--dsw-alias-bg-layer-1)',
            }}>
              <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{t('currentAddress')}</span>
              <code style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 13 }}>{endpointUrl}</code>
              <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{copied ? t('copied') : t('copyHint')}</span>
            </button>
            <button type="button" style={action} onClick={() => setRevision(current => current + 1)}>{t('refreshQr')}</button>
          </> : <p style={{ ...muted, margin: 0, textAlign: 'center' }}>{t('notReady')}</p>}
        </div>
      </div>

      <div>
        <h3 style={heading}>{t('devices')}</h3>
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {live.length === 0 ? <div style={card}><p style={{ ...muted, margin: 0 }}>{t('noDevices')}</p></div> : null}
          {live.map(device => <article key={device.id} style={{ ...card, gridTemplateColumns: '1fr auto', alignItems: 'center', minHeight: 72 }}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{device.label || device.id}</strong>
              <p style={{ ...muted, margin: '4px 0 0' }}>{deviceKind(device, t)} · {t('lastSeen')} {formatSeen(device.lastSeenAt, t)}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" style={action} onClick={() => void rename(device)}>{t('rename')}</button>
              {device.room ? <button type="button" style={action} onClick={() => setRefreshingId(refreshingId === device.id ? null : device.id)}>{t('refreshAddress')}</button> : null}
              <button type="button" style={danger} onClick={() => void revoke(device.id)}>{t('revoke')}</button>
            </div>
            {refreshingId === device.id && device.room ? <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 10, justifyItems: 'start' }}>
              <img src={pairingRefreshQrUrl(device.room, revision)} alt={t('refreshAddress')} style={{ width: 160, padding: 8, borderRadius: 12, background: '#fff' }} />
              <button type="button" style={action} onClick={() => setRefreshingId(null)}>{t('closeRefresh')}</button>
            </div> : null}
          </article>)}
        </div>
      </div>
    </> : null}
  </section>
}

export function apply(ctx: ClientContext): void {
  const namespace = 'settings.dsh-mobile'
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-mobile-pairing: settings copy')
  const t = ctx.locale.bind(namespace)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: REMOTE_SETTINGS_SECTION.id,
    order: REMOTE_SETTINGS_SECTION.order,
    label: () => t('nav'),
    locale: namespace,
    inject: () => ({ t }),
  }, DshMobileCard))
  ctx.effect(installRemoteNavIcon, 'dsh-mobile-pairing: settings nav icon')
}
