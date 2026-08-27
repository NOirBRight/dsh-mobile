import { installPopupGeometryAdapter } from '../../src/client/popup-geometry-adapter.ts'

function touchPointerDown(target: Element, pointerId: number): void {
  target.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
    pointerId, clientX: 120, clientY: 120,
  }))
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function run(): void {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => { callback(window.performance.now()); return 0 },
  })
  Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: () => {} })
  const trigger = document.createElement('button')
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-expanded', 'true')
  trigger.setAttribute('aria-controls', 'owned-popup')
  trigger.getBoundingClientRect = () => DOMRect.fromRect({ x: 260, y: 24, width: 40, height: 32 })
  const popup = document.createElement('div')
  popup.id = 'owned-popup'
  popup.setAttribute('role', 'menu')
  popup.textContent = 'Picker rows'
  const dismissBeforeClick = (event: MouseEvent): void => {
    if (!popup.contains(event.target as Node)) trigger.setAttribute('aria-expanded', 'false')
  }
  trigger.addEventListener('click', () => {
    trigger.setAttribute('aria-expanded', String(trigger.getAttribute('aria-expanded') !== 'true'))
  })
  document.addEventListener('mousedown', dismissBeforeClick)
  document.body.append(trigger, popup)

  const choiceTrigger = document.createElement('button')
  choiceTrigger.setAttribute('aria-haspopup', 'menu')
  choiceTrigger.setAttribute('aria-expanded', 'true')
  choiceTrigger.setAttribute('aria-controls', 'choice-popup')
  const choice = document.createElement('div')
  choice.id = 'choice-popup'
  choice.setAttribute('role', 'menu')
  choice.setAttribute('aria-hidden', 'true')
  choice.style.width = '320px'
  choice.innerHTML = Array.from({ length: 24 }, (_, index) =>
    '<button style="display:block;width:100%;white-space:normal" role="menuitemradio">' +
    (index % 2 === 0 ? '上下文窗口 272K · 详细中文模型选项' : '1M context window · detailed English model option') +
    '</button>',
  ).join('')
  document.body.append(choiceTrigger, choice)

  const dispose = installPopupGeometryAdapter(document)
  document.body.dataset.choiceNarrowWidth = String(Math.round(choice.getBoundingClientRect().width))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
  window.dispatchEvent(new Event('resize'))
  document.body.dataset.choiceAt360Width = String(Math.round(choice.getBoundingClientRect().width))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  window.dispatchEvent(new Event('resize'))
  document.body.dataset.choiceWideWidth = String(Math.round(choice.getBoundingClientRect().width))
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 412 })
  window.dispatchEvent(new Event('resize'))
  document.body.dataset.choiceAt412Width = String(Math.round(choice.getBoundingClientRect().width))
  document.body.dataset.choiceOverflowY = getComputedStyle(choice).overflowY
  document.body.dataset.choiceOverflowX = getComputedStyle(choice).overflowX
  touchPointerDown(trigger, 1)
  click(trigger)
  document.body.dataset.anchorClosed = String(trigger.getAttribute('aria-expanded') === 'false')
  document.removeEventListener('mousedown', dismissBeforeClick)

  trigger.setAttribute('aria-expanded', 'true')
  const replacement = document.createElement('button')
  replacement.setAttribute('aria-haspopup', 'menu')
  replacement.setAttribute('aria-expanded', 'true')
  replacement.setAttribute('aria-controls', popup.id)
  replacement.getBoundingClientRect = () => DOMRect.fromRect({ x: 20, y: 24, width: 40, height: 32 })
  replacement.addEventListener('click', () => {
    replacement.setAttribute('aria-expanded', String(replacement.getAttribute('aria-expanded') !== 'true'))
  })
  const dismissReplacementBeforeClick = (event: MouseEvent): void => {
    if (!popup.contains(event.target as Node)) replacement.setAttribute('aria-expanded', 'false')
  }
  document.addEventListener('mousedown', dismissReplacementBeforeClick)
  document.body.insertBefore(replacement, trigger)
  touchPointerDown(replacement, 2)
  window.dispatchEvent(new Event('resize'))
  document.body.dataset.replacementAnchorAlign = popup.dataset.dshMobileAlign ?? ''
  document.body.dataset.replacementAnchorPreserved = String(replacement.getAttribute('aria-expanded') === 'true')
  click(replacement)
  document.body.dataset.replacementAnchorClosed = String(replacement.getAttribute('aria-expanded') === 'false')
  document.removeEventListener('mousedown', dismissReplacementBeforeClick)
  trigger.remove()
  replacement.remove()
  popup.remove()

  document.body.dataset.choiceKind = choice.dataset.dshMobilePopup ?? ''
  document.body.dataset.choiceWidth = String(Math.round(choice.getBoundingClientRect().width))
  dispose()
  document.body.dataset.ready = 'true'
}

run()
