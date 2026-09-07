/** Full-viewport status screens for pairing, connecting, and recovery. */

const STYLE_ID = 'dsh-mobile-progress-style'

const STYLE = `
html, body, #root {
  min-height: 100%;
  margin: 0;
}

[data-mobile-progress] {
  position: fixed;
  inset: 0;
  z-index: 20;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom));
  background: var(--dsw-alias-bg-base, #f7f8fb);
  color: var(--dsw-alias-label-primary, #1f2937);
  font-family: var(--ds-font-family, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}

[data-mobile-progress] .dsh-progress-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(100%, 360px);
  text-align: center;
}

[data-mobile-progress] .dsh-progress-spinner {
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  margin-bottom: 18px;
  border: 3px solid var(--dsw-alias-border-l1, #dfe5ef);
  border-top-color: var(--dsw-alias-state-business-primary, #4e78cc);
  border-radius: 50%;
  animation: dsh-progress-spin .8s linear infinite;
}

[data-mobile-progress] .dsh-progress-spinner[data-determinate] {
  animation: none;
  border-color: transparent;
  background: conic-gradient(
    var(--dsw-alias-state-business-primary, #4e78cc) var(--dsh-progress-arc, 0deg),
    var(--dsw-alias-border-l1, #dfe5ef) 0
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0);
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0);
}

[data-mobile-progress] .dsh-progress-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -.02em;
}

[data-mobile-progress] .dsh-progress-detail {
  margin: 10px 0 0;
  color: var(--dsw-alias-label-tertiary, #718096);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}

[data-mobile-progress] .dsh-progress-error {
  margin: 12px 0 0;
  color: var(--dsw-alias-state-error-primary, #c2413a);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  text-align: center;
}

[data-mobile-progress] .dsh-progress-action {
  margin-top: 22px;
}

@keyframes dsh-progress-spin {
  to { transform: rotate(360deg); }
}
`

export interface ProgressScreenOptions {
  title: string
  detail?: string
  error?: string
  spinning?: boolean
  /** 0–1 plugin-load fraction. When set, the ring is determinate and is not remounted on each tick. */
  ratio?: number
  action?: HTMLElement
}

export function installProgressScreenStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  ;(document.head ?? document.documentElement).append(style)
}

function showSpinner(options: ProgressScreenOptions): boolean {
  if (options.error === undefined) return options.spinning !== false
  return options.spinning === true
}

function applyProgress(root: HTMLElement, options: ProgressScreenOptions): void {
  const card = root.firstElementChild as HTMLElement
  let spinner = card.querySelector<HTMLElement>('.dsh-progress-spinner')
  if (showSpinner(options)) {
    if (spinner === null) {
      spinner = document.createElement('div')
      spinner.className = 'dsh-progress-spinner'
      spinner.setAttribute('aria-hidden', 'true')
      card.prepend(spinner)
    }
    if (options.ratio === undefined) {
      spinner.removeAttribute('data-determinate')
      spinner.style.removeProperty('--dsh-progress-arc')
    } else {
      const ratio = Number.isFinite(options.ratio) ? Math.min(1, Math.max(0, options.ratio)) : 0
      spinner.dataset.determinate = ''
      spinner.style.setProperty('--dsh-progress-arc', String(Math.round(ratio * 360)) + 'deg')
    }
  } else {
    spinner?.remove()
  }
  let title = card.querySelector<HTMLElement>('.dsh-progress-title')
  if (title === null) {
    title = document.createElement('p')
    title.className = 'dsh-progress-title'
    card.append(title)
  }
  title.textContent = options.title
  let detail = card.querySelector<HTMLElement>('.dsh-progress-detail')
  if (options.detail !== undefined && options.detail !== '') {
    if (detail === null) {
      detail = document.createElement('p')
      detail.className = 'dsh-progress-detail'
      card.append(detail)
    }
    detail.textContent = options.detail
  } else {
    detail?.remove()
  }
}

/** Replace the shell root with a centered progress or recovery screen. */
export function mountProgressScreen(container: HTMLElement, options: ProgressScreenOptions): HTMLElement {
  installProgressScreenStyles()
  const reuse = options.error === undefined && options.action === undefined
    ? container.querySelector<HTMLElement>('[data-mobile-progress]')
    : null
  if (reuse !== null && reuse.querySelector('.dsh-progress-error') === null && reuse.querySelector('.dsh-progress-action') === null) {
    applyProgress(reuse, options)
    return reuse
  }
  const root = document.createElement('div')
  root.dataset.mobileProgress = ''
  const card = document.createElement('div')
  card.className = 'dsh-progress-card'
  root.append(card)
  applyProgress(root, options)
  if (options.error !== undefined && options.error !== '') {
    const error = document.createElement('pre')
    error.className = 'dsh-progress-error'
    error.textContent = options.error
    card.append(error)
  }
  if (options.action !== undefined) {
    const action = document.createElement('div')
    action.className = 'dsh-progress-action'
    action.append(options.action)
    card.append(action)
  }
  container.replaceChildren(root)
  return root
}
