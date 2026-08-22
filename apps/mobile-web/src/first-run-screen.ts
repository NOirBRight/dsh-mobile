import type { ScanSurface } from './scan-surface.ts'

const STYLE_ID = 'dsh-mobile-first-run-style'

const STYLE = `
[data-mobile-first-run] {
  position: fixed;
  inset: 0;
  z-index: 1000;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: calc(22px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom));
  background: var(--dsw-alias-bg-base, #f7f8fb);
  color: var(--dsw-alias-label-primary, #1f2937);
  font-family: var(--ds-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}

[data-mobile-first-run]::before,
[data-mobile-first-run]::after {
  position: absolute;
  z-index: -1;
  display: block;
  border-radius: 999px;
  content: "";
  pointer-events: none;
}

[data-mobile-first-run]::before {
  top: 9%;
  right: -30%;
  width: 92vw;
  height: 42vw;
  background: var(--dsw-alias-state-business-tertiary, #e8efff);
  opacity: .75;
  filter: blur(28px);
  transform: rotate(-12deg);
}

[data-mobile-first-run]::after {
  bottom: 18%;
  left: -34%;
  width: 84vw;
  height: 34vw;
  background: var(--dsw-alias-interactive-bg-hover, #edf2fa);
  opacity: .9;
  filter: blur(30px);
  transform: rotate(16deg);
}

[data-mobile-first-run] .dsh-first-run-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 32px;
  color: var(--dsw-alias-label-primary, #1f2937);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .02em;
}

[data-mobile-first-run] .dsh-first-run-brand img {
  width: 30px;
  height: 30px;
  object-fit: contain;
}

[data-mobile-first-run] .dsh-first-run-brand span:last-child {
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 12px;
  font-weight: 500;
}

[data-mobile-first-run] .dsh-first-run-hero {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 20px 0;
}

[data-mobile-first-run] .dsh-first-run-hero-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(100%, 360px);
  text-align: center;
}

[data-mobile-first-run] .dsh-first-run-mark {
  display: grid;
  place-items: center;
  width: 94px;
  height: 94px;
  margin-bottom: 22px;
  border: 1px solid var(--dsw-alias-border-l1, #dfe5ef);
  border-radius: 30px;
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: 0 18px 48px rgb(53 81 130 / 13%);
}

[data-mobile-first-run] .dsh-first-run-mark img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}

[data-mobile-first-run] h1 {
  margin: 0;
  color: var(--dsw-alias-label-primary, #1f2937);
  font-size: clamp(25px, 7vw, 32px);
  line-height: 1.25;
  font-weight: 600;
  letter-spacing: -.03em;
}

[data-mobile-first-run] .dsh-first-run-subtitle {
  max-width: 300px;
  margin: 13px 0 0;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 14px;
  line-height: 1.7;
}

[data-mobile-first-run] .dsh-first-run-status {
  min-height: 22px;
  margin: 20px 0 0;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 13px;
  line-height: 22px;
}

[data-mobile-first-run] .dsh-first-run-status[data-error] {
  color: var(--dsw-alias-state-error-primary, #c2413a);
}

[data-mobile-first-run] .dsh-first-run-footer {
  flex: none;
}

[data-mobile-first-run] .dsh-first-run-scan {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 11px;
  width: 100%;
  min-height: 64px;
  padding: 0 20px;
  border: 0;
  border-radius: 21px;
  background: var(--dsw-alias-state-business-primary, #4e78cc);
  box-shadow: 0 12px 28px rgb(52 92 165 / 22%);
  color: var(--dsw-alias-label-inverse, #fff);
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 160ms ease, opacity 160ms ease;
}

[data-mobile-first-run] .dsh-first-run-scan:active:not(:disabled) {
  transform: scale(.985);
}

[data-mobile-first-run] .dsh-first-run-scan:disabled {
  cursor: wait;
  opacity: .65;
}

[data-mobile-first-run] .dsh-first-run-scan svg {
  flex: none;
  width: 23px;
  height: 23px;
}

[data-mobile-first-run] .dsh-first-run-footnote {
  margin: 12px 0 0;
  color: var(--dsw-alias-label-caption, #8a95a8);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
`

export interface FirstRunScreen extends ScanSurface {
  waitForScan(): Promise<void>
  showError(message: string): void
  destroy(): void
}

function ensureStyle(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ID)
  if (existing instanceof HTMLStyleElement) return existing
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.append(style)
  return style
}

function cameraIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  body.setAttribute('x', '3'); body.setAttribute('y', '6'); body.setAttribute('width', '18'); body.setAttribute('height', '13'); body.setAttribute('rx', '3')
  const lens = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  lens.setAttribute('cx', '12'); lens.setAttribute('cy', '12.5'); lens.setAttribute('r', '3.2')
  const bump = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  bump.setAttribute('d', 'M8 6l1.1-2h5.8L16 6')
  svg.append(body, lens, bump)
  return svg
}

/** Mount the themed first-pairing surface without booting the remote shell. */
export function mountFirstRunScreen(container: HTMLElement): FirstRunScreen {
  ensureStyle()
  const root = document.createElement('main')
  root.dataset.mobileFirstRun = ''
  root.setAttribute('aria-labelledby', 'dsh-first-run-title')

  const brand = document.createElement('div')
  brand.className = 'dsh-first-run-brand'
  const brandMark = document.createElement('img')
  brandMark.src = '/favicon.svg'
  brandMark.alt = ''
  const brandName = document.createElement('span')
  brandName.textContent = 'DSH Mobile'
  const brandState = document.createElement('span')
  brandState.textContent = '首次连接'
  brand.append(brandMark, brandName, brandState)

  const hero = document.createElement('section')
  hero.className = 'dsh-first-run-hero'
  const heroInner = document.createElement('div')
  heroInner.className = 'dsh-first-run-hero-inner'
  const mark = document.createElement('div')
  mark.className = 'dsh-first-run-mark'
  const markImage = document.createElement('img')
  markImage.src = '/favicon.svg'
  markImage.alt = ''
  mark.append(markImage)
  const title = document.createElement('h1')
  title.id = 'dsh-first-run-title'
  title.textContent = '连接你的 DSH Host'
  const subtitle = document.createElement('p')
  subtitle.className = 'dsh-first-run-subtitle'
  subtitle.textContent = '扫描桌面端显示的配对二维码，开始你的第一个会话。'
  const status = document.createElement('p')
  status.className = 'dsh-first-run-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.textContent = '准备好后，点击下方按钮扫码'
  heroInner.append(mark, title, subtitle, status)
  hero.append(heroInner)

  const footer = document.createElement('footer')
  footer.className = 'dsh-first-run-footer'
  const scan = document.createElement('button')
  scan.className = 'dsh-first-run-scan'
  scan.type = 'button'
  scan.dataset.mobileFirstRunScan = ''
  scan.setAttribute('aria-label', '扫码连接设备')
  scan.append(cameraIcon())
  const scanLabel = document.createElement('span')
  scanLabel.textContent = '扫码连接设备'
  scan.append(scanLabel)
  const footnote = document.createElement('p')
  footnote.className = 'dsh-first-run-footnote'
  footnote.textContent = '仅用于配对你的 Host，不会上传二维码内容'
  footer.append(scan, footnote)

  root.append(brand, hero, footer)
  container.replaceChildren(root)

  let waiting: (() => void) | null = null
  let busy = false
  const waitForScan = (): Promise<void> => new Promise(resolve => {
    waiting = resolve
    busy = false
    scan.disabled = false
    scanLabel.textContent = '扫码连接设备'
    scan.setAttribute('aria-label', '扫码连接设备')
  })
  scan.addEventListener('click', () => {
    if (busy || waiting === null) return
    const resolve = waiting
    waiting = null
    busy = true
    scan.disabled = true
    scanLabel.textContent = '正在打开相机…'
    resolve()
  })

  const show = (message: string, retryLabel?: string): void | Promise<void> => {
    status.removeAttribute('data-error')
    status.textContent = message
    if (retryLabel === undefined) {
      busy = true
      waiting = null
      scan.disabled = true
      scanLabel.textContent = '正在打开相机…'
      return
    }
    status.dataset.error = ''
    return waitForScan()
  }

  const showError = (message: string): void => {
    status.dataset.error = ''
    status.textContent = message
    waiting = null
    busy = false
    scan.disabled = false
    scanLabel.textContent = '重新扫码连接'
    scan.setAttribute('aria-label', '重新扫码连接')
  }

  return {
    waitForScan,
    show,
    showError,
    destroy() {
      waiting = null
      container.replaceChildren()
      document.getElementById(STYLE_ID)?.remove()
    },
  }
}
