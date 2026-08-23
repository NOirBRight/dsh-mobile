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
  action?: HTMLElement
}

export function installProgressScreenStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  ;(document.head ?? document.documentElement).append(style)
}

/** Replace the shell root with a centered progress or recovery screen. */
export function mountProgressScreen(container: HTMLElement, options: ProgressScreenOptions): HTMLElement {
  installProgressScreenStyles()
  const root = document.createElement('div')
  root.dataset.mobileProgress = ''
  const card = document.createElement('div')
  card.className = 'dsh-progress-card'
  if (options.spinning !== false && options.error === undefined) {
    const spinner = document.createElement('div')
    spinner.className = 'dsh-progress-spinner'
    spinner.setAttribute('aria-hidden', 'true')
    card.append(spinner)
  } else if (options.spinning === true) {
    const spinner = document.createElement('div')
    spinner.className = 'dsh-progress-spinner'
    spinner.setAttribute('aria-hidden', 'true')
    card.append(spinner)
  }
  const title = document.createElement('p')
  title.className = 'dsh-progress-title'
  title.textContent = options.title
  card.append(title)
  if (options.detail !== undefined && options.detail !== '') {
    const detail = document.createElement('p')
    detail.className = 'dsh-progress-detail'
    detail.textContent = options.detail
    card.append(detail)
  }
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
  root.append(card)
  container.replaceChildren(root)
  return root
}
