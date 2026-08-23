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
  PAIRING_QR_PRESENTATION,
  PAIRING_OFFER_TTL_MS,
  PAIRING_QR_ROTATE_MS,
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
  qrAlt: '配对二维码', qrLoading: '正在生成二维码…', qrLoadFailed: '二维码生成失败', retryQr: '重试生成',
  devices: '已配对设备', noDevices: '还没有设备。扫下面的码即可添加。',
  phone: '手机', web: '浏览器', unknownType: '设备', lastSeen: '最近在线', justNow: '刚刚',
  minutesAgo: '{n} 分钟前', hoursAgo: '{n} 小时前', revoke: '撤销', rename: '重命名',
  renamePrompt: '设备名称', revokeConfirm: '撤销后这台设备需要重新扫码。', refreshAddress: '更新地址',
  closeRefresh: '关闭', access: '访问方式',
  scanTitle: '扫码连接', scanHint: '用 App 扫码。二维码约 5 分钟有效，画面会自动换新码。',
  qrExpired: '二维码已过期，点这里换一张',
  currentAddress: '连接地址', copyHint: '点击复制', addressLoading: '正在生成连接地址…', addressFailed: '连接地址生成失败',
  qrPendingSave: '填写地址并生成后，二维码会显示在下面。',
  temporarySetup: '地址和二维码会一起自动生成。地址变化后，已配对设备可点「更新地址」。',
  temporary: '自动生成', temporaryHint: '自动生成连接地址，无需配置',
  relay: '填写地址', relayHint: '使用你获得或自行部署的服务地址', relayUrl: '连接地址', relayPlaceholder: 'wss://你的服务地址', relayHelp: '如何自行部署连接服务',
  notReady: '尚未生成连接信息', qrNotReady: '先生成连接地址，再显示二维码', copied: '已复制',
  save: '生成二维码', saving: '正在检查并生成…', saved: '二维码已生成',
  stageEndpoint: '地址格式不对', stageTls: '打不开这个地址', stageIdentity: '不是这台电脑',
  stageProtocol: '协议不匹配', stageCapabilities: '能力不匹配', stageWebsocket: '无法建立连接', stageRelay: '连接服务不可用',
}
const en = {
  nav: 'Remote', title: 'Remote', intro: 'Scan with the app or the phone camera to connect this computer.',
  loading: 'Loading…', retry: 'Retry', loadFailed: 'Could not load remote settings.',
  qrAlt: 'Pairing code', qrLoading: 'Generating code…', qrLoadFailed: 'Could not generate the code', retryQr: 'Try again',
  devices: 'Paired devices', noDevices: 'No devices yet. Scan the code below.',
  phone: 'Phone', web: 'Browser', unknownType: 'Device', lastSeen: 'Last seen', justNow: 'Just now',
  minutesAgo: '{n} min ago', hoursAgo: '{n} hr ago', revoke: 'Revoke', rename: 'Rename',
  renamePrompt: 'Device name', revokeConfirm: 'This device will need to scan again.', refreshAddress: 'Update address',
  closeRefresh: 'Close', access: 'Access mode',
  scanTitle: 'Scan to connect', scanHint: 'Scan with the app. Codes last about five minutes and refresh automatically.',
  qrExpired: 'This code expired. Tap to mint a new one',
  currentAddress: 'Connection address', copyHint: 'Click to copy', addressLoading: 'Generating a connection address…', addressFailed: 'Could not generate a connection address',
  qrPendingSave: 'Enter an address and generate to show the code below.',
  temporarySetup: 'The address and code are generated together. If it changes, paired devices can use Update address.',
  temporary: 'Generate automatically', temporaryHint: 'Create a connection address with no setup',
  relay: 'Enter an address', relayHint: 'Use a service address you received or deployed', relayUrl: 'Connection address', relayPlaceholder: 'wss://your-service.example', relayHelp: 'How to deploy your own connection service',
  notReady: 'Connection details have not been generated', qrNotReady: 'Generate a connection address to show the code', copied: 'Copied',
  save: 'Generate code', saving: 'Checking and generating…', saved: 'Code generated',
  stageEndpoint: 'Invalid address', stageTls: 'Address unreachable', stageIdentity: 'Wrong computer',
  stageProtocol: 'Protocol mismatch', stageCapabilities: 'Capabilities mismatch', stageWebsocket: 'Could not connect', stageRelay: 'Connection service unavailable',
}

const page: CSSProperties = { display: 'grid', gap: 16, minWidth: 0, color: 'var(--dsw-alias-label-primary)' }
const heading: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px' }
const muted: CSSProperties = { margin: '6px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px' }
const card: CSSProperties = {
  display: 'grid', gap: 10, padding: 12, borderRadius: 14,
  background: 'var(--dsw-alias-bg-layer-1)', boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
}
const action: CSSProperties = {
  minHeight: 32, border: 'none', borderRadius: 10, padding: '6px 12px',
  background: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-primary)',
  font: 'inherit', fontSize: 13, cursor: 'pointer',
}
const danger: CSSProperties = { ...action, color: '#dc2626' }
const input: CSSProperties = {
  width: '100%', minHeight: 40, boxSizing: 'border-box', border: 'none', borderRadius: 10, padding: '8px 12px',
  background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-label-primary)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-border-l2)', font: 'inherit', fontSize: 13, outline: 'none',
}
const qrBox: CSSProperties = {
  width: PAIRING_QR_PRESENTATION.size, maxWidth: '100%', aspectRatio: '1', boxSizing: 'border-box',
  display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: 12,
}

function QrPlaceholder({ text, loading = false, error = false, t, onRetry }: { text: string; loading?: boolean; error?: boolean; t: Translate; onRetry?: () => void }) {
  return <div role={loading ? 'status' : error ? 'alert' : 'img'} aria-label={text} aria-live={loading || error ? 'polite' : undefined} style={{
    ...qrBox, gap: 8, alignContent: 'center', border: '1px dashed var(--dsw-alias-border-l2)',
    color: error ? '#dc2626' : 'var(--dsw-alias-label-tertiary)', textAlign: 'center', padding: 12,
  }}>
    {loading ? <span className="dsh-mobile-qr-spinner" aria-hidden /> : <strong style={{ fontSize: 34, letterSpacing: '.12em' }}>QR</strong>}
    <span style={{ fontSize: 12 }}>{text}</span>
    {error && onRetry ? <button type="button" style={action} onClick={onRetry}>{t('retryQr')}</button> : null}
  </div>
}

function PairingQr({ src, alt, t, onRetry }: { src: string; alt: string; t: Translate; onRetry: () => void }) {
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    setImageState('loading')
    setExpired(false)
    const mintedAt = Date.now()
    const timer = window.setInterval(() => {
      if (Date.now() - mintedAt >= PAIRING_OFFER_TTL_MS) {
        setExpired(true)
        window.clearInterval(timer)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [src])
  if (expired) return <QrPlaceholder text={t('qrExpired')} error t={t} onRetry={onRetry} />
  if (imageState === 'error') return <QrPlaceholder text={t('qrLoadFailed')} error t={t} onRetry={onRetry} />
  return <div style={qrBox}>
    <img src={src} alt={alt} onLoad={() => setImageState('ready')} onError={() => setImageState('error')} style={{
      gridArea: '1 / 1', boxSizing: 'border-box', width: '100%', height: '100%', objectFit: 'contain',
      padding: PAIRING_QR_PRESENTATION.padding, background: '#fff', visibility: imageState === 'ready' ? 'visible' : 'hidden',
    }} />
    {imageState === 'loading' ? <div style={{ gridArea: '1 / 1' }}><QrPlaceholder text={t('qrLoading')} loading t={t} /></div> : null}
  </div>
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
  const [mode, setMode] = useState<'quick' | 'custom' | 'relay'>('quick')
  const [relayUrl, setRelayUrl] = useState('')
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
        setRelayUrl(decoded.relayUrl ?? '')
        hydrated.current = true
      }
      const decodedDevices = devicesResponse.ok ? decodePairedDevices(await devicesResponse.json()) : []
      setDevices(livePairedDevices(decodedDevices ?? []))
    } catch { setStatus(null); setFailed(true) }
  }

  async function saveEndpoint(nextMode: 'quick' | 'relay') {
    const request = buildEndpointSaveRequest(nextMode, '', relayUrl)
    if ('error' in request) { setSaveMessage(null); setSaveError(t('relayUrl')); return }
    setSaving(true); setSaveMessage(null); setSaveError(null)
    try {
      const response = await fetch('/pair/endpoint', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
      const decoded = decodeEndpointSaveResult(await response.json())
      if (decoded === null) throw new Error('invalid save response')
      if (!decoded.ok) {
        setSaveError(t(({ endpoint: 'stageEndpoint', tls: 'stageTls', identity: 'stageIdentity', protocol: 'stageProtocol', capabilities: 'stageCapabilities', websocket: 'stageWebsocket', relay: 'stageRelay' } as const)[decoded.stage]))
        return
      }
      setMode(nextMode)
      setSaveMessage(t('saved'))
      setRevision(current => current + 1)
      await loadAll()
    } catch { setSaveError(t('loadFailed')) } finally { setSaving(false) }
  }

  async function selectMode(next: 'quick' | 'relay') {
    setMode(next)
    setSaveMessage(null)
    setSaveError(null)
    if (next === 'relay' && status?.endpointMode !== 'relay') setRelayUrl('')
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
  const dirty = status ? endpointDraftDirty(mode, status.customEndpointUrl ?? '', status, relayUrl) : false
  const endpointReady = status?.endpoint !== null && !dirty
  const addressLoading = saving || (mode === 'quick' && status?.endpointMode === 'quick' && status.endpointState === 'loading')
  const addressFailed = !saving && mode === 'quick' && status?.endpointMode === 'quick' && status.endpointState === 'error'

  useEffect(() => {
    if (!endpointReady) return
    const bump = () => setRevision(current => current + 1)
    const timer = window.setInterval(bump, PAIRING_QR_ROTATE_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [endpointReady, endpointUrl])

  return <section className="dsh-mobile-remote-page" style={page}>
    <style>{`
      .dsh-mobile-remote-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .dsh-mobile-remote-modes button { font: inherit; }
      .dsh-mobile-remote-page button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, var(--dsw-alias-label-primary)); outline-offset: 2px; }
      .dsh-mobile-remote-page button:disabled { cursor: not-allowed !important; opacity: .55; }
      .dsh-mobile-text-input:focus-visible { box-shadow: inset 0 0 0 1.5px var(--dsw-alias-label-primary) !important; }
      .dsh-mobile-qr-spinner { width: 30px; height: 30px; box-sizing: border-box; border: 3px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-label-primary); border-radius: 50%; animation: dsh-mobile-qr-spin .8s linear infinite; }
      @keyframes dsh-mobile-qr-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .dsh-mobile-qr-spinner { animation-duration: 1.8s; } }
    `}</style>
    <header style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 12px' }}>
      <h2 style={heading}>{t('title')}</h2>
      <p style={{ ...muted, margin: 0 }}>{t('intro')}</p>
    </header>

    {status === undefined && !failed ? <p style={muted}>{t('loading')}</p> : null}
    {failed ? <div style={card}><p style={muted}>{t('loadFailed')}</p><button type="button" style={action} onClick={() => void loadAll()}>{t('retry')}</button></div> : null}

    {status ? <>
      <div style={{ ...card, gap: 10 }}>
        <div>
          <h3 style={heading}>{t('access')}</h3>
          <div className="dsh-mobile-remote-modes" role="radiogroup" aria-label={t('access')} style={{ marginTop: 10 }}>
            {([
              ['quick', 'temporary', 'temporaryHint'],
              ['relay', 'relay', 'relayHint'],
            ] as const).map(([value, title, hint]) => <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => void selectMode(value)} style={{
              minHeight: 48, textAlign: 'left', border: 'none', borderRadius: 12, padding: '10px 12px', cursor: 'pointer',
              background: mode === value ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
              boxShadow: mode === value ? 'inset 0 0 0 1.5px var(--dsw-alias-label-primary)' : 'inset 0 0 0 1px var(--dsw-alias-border-l2)',
              color: 'var(--dsw-alias-label-primary)',
            }}>
              <strong style={{ display: 'block', fontSize: 14 }}>{t(title)}</strong>
              <span style={{ display: 'block', marginTop: 2, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{t(hint)}</span>
            </button>)}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' }}>
          <h3 style={heading}>{t('currentAddress')}</h3>
          {mode === 'relay' ? <form style={{ display: 'grid', gap: 8 }} onSubmit={event => { event.preventDefault(); void saveEndpoint('relay') }}>
            <label style={{ ...muted, margin: 0 }} htmlFor="dsh-mobile-relay-url">{t('relayUrl')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
              <input id="dsh-mobile-relay-url" className="dsh-mobile-text-input" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={relayUrl} placeholder={t('relayPlaceholder')} onChange={event => { setRelayUrl(event.target.value); setSaveMessage(null); setSaveError(null) }} style={input} />
              <button type="submit" style={action} disabled={saving || relayUrl.trim() === '' || !dirty}>{saving ? t('saving') : t('save')}</button>
            </div>
            <p style={{ ...muted, margin: 0 }}><a href="https://github.com/NOirBRight/dsh-mobile/tree/master/relay/deploy" target="_blank" rel="noreferrer">{t('relayHelp')}</a></p>
            {dirty ? <p style={{ ...muted, margin: 0 }}>{t('qrPendingSave')}</p> : null}
          </form> : <>
            {endpointReady && endpointUrl ? <button type="button" onClick={() => void copyUrl(endpointUrl)} style={{
              ...action, display: 'grid', gap: 2, width: '100%', minHeight: 48, textAlign: 'left', padding: '8px 10px',
              background: 'var(--dsw-alias-bg-layer-1)',
            }}>
              <code style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 13 }}>{endpointUrl}</code>
              <span style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }}>{copied ? t('copied') : t('copyHint')}</span>
            </button> : <p role={addressFailed ? 'alert' : 'status'} style={{ ...muted, margin: 0, color: addressFailed ? '#dc2626' : undefined }}>{addressFailed ? t('addressFailed') : t('addressLoading')}</p>}
            <p style={{ ...muted, margin: 0 }}>{t('temporarySetup')}</p>
          </>}
          {saveMessage ? <p role="status" style={{ ...muted, margin: 0 }}>{saveMessage}</p> : null}
          {saveError ? <p role="alert" style={{ ...muted, margin: 0, color: '#dc2626' }}>{saveError}</p> : null}
        </div>

        <div style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: 12, borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2px 12px', width: '100%' }}>
            <h3 style={heading}>{t('scanTitle')}</h3>
            <p style={{ ...muted, margin: 0 }}>{t('scanHint')}</p>
          </div>
          {addressLoading ? <QrPlaceholder text={t('qrLoading')} loading t={t} />
            : addressFailed ? <QrPlaceholder text={t('addressFailed')} error t={t} onRetry={() => void saveEndpoint('quick')} />
              : endpointReady && endpointUrl ? <PairingQr key={revision} src={pairingQrUrl('android', revision)} alt={t('qrAlt')} t={t} onRetry={() => setRevision(current => current + 1)} />
                : <QrPlaceholder text={t('qrNotReady')} t={t} />}
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
