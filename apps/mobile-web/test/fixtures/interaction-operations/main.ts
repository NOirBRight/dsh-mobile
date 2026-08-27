import { installComposerInputAdapter } from '../../../../../packages/interaction-operations/src/client/composer-input-adapter.ts'
import { createDomTargetAdapter } from '../../../../../packages/interaction-operations/src/client/dom-target-adapter.ts'
import { installPopupGeometryAdapter } from '../../../../../packages/interaction-operations/src/client/popup-geometry-adapter.ts'
import { installTouchInputAdapter } from '../../../../../packages/interaction-operations/src/client/touch-input-adapter.ts'
import { InteractionSurfaceStack } from '../../../../../packages/interaction-operations/src/client/surface-stack.ts'
import type { InteractionIntent } from '../../../../../packages/interaction-operations/src/client/operations.ts'

const operations: string[] = []
const frame = document.querySelector<HTMLElement>('#frame')!
const targetAdapter = createDomTargetAdapter({
  layout: {
    toggleSidebar: () => { frame.toggleAttribute('data-drawer-open') },
    closeDetails: () => { frame.removeAttribute('data-details-open') },
  },
})
const dispatcher = {
  dispatch(intent: InteractionIntent) {
    operations.push(intent.type)
    return targetAdapter.handle(intent)
      ? { status: 'handled' as const, adapter: targetAdapter.name }
      : { status: 'unhandled' as const }
  },
}
const disposeComposer = installComposerInputAdapter()
const disposeTouch = installTouchInputAdapter(dispatcher)
const disposePopupGeometry = installPopupGeometryAdapter()

function pointer(target: Element, type: string, init: PointerEventInit): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, ...init }))
}

window.setTimeout(() => {
  const lazyButton = document.createElement('button')
  lazyButton.setAttribute('aria-label', 'Lazy More')
  document.querySelector('#lazy-actions')!.append(lazyButton)
  document.querySelector('#more')!.addEventListener('click', () => { document.body.dataset.contextOpened = 'true' })
  const popup = document.querySelector('#popup')!
  popup.addEventListener('keydown', event => {
    if ((event as KeyboardEvent).key === 'ArrowDown') popup.setAttribute('aria-expanded', 'true')
  })
  popup.addEventListener('click', () => {
    if (popup.getAttribute('aria-expanded') === 'true') popup.setAttribute('aria-expanded', 'false')
  })
  pointer(popup, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 })
  popup.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  window.queueMicrotask(() => {
    document.body.dataset.popupFirstOpened = String(popup.getAttribute('aria-expanded') === 'true')
    pointer(popup, 'pointerdown', { pointerId: 21, clientX: 100, clientY: 100 })
    pointer(popup, 'pointerup', { pointerId: 21, clientX: 100, clientY: 100 })
    popup.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    window.queueMicrotask(() => { document.body.dataset.popupRetracted = String(popup.getAttribute('aria-expanded') === 'false') })
  })

  const frame = document.querySelector('#frame')!
  pointer(frame, 'pointerdown', { pointerId: 2, clientX: 2, clientY: 200 })
  pointer(frame, 'pointerup', { pointerId: 2, clientX: 82, clientY: 202 })

  const leftAnchor = document.querySelector<HTMLElement>('#geo-left > button')!
  const leftMenu = document.querySelector<HTMLElement>('#geo-left [role="menu"]')!
  const rightAnchor = document.querySelector<HTMLElement>('#geo-right > button')!
  const rightMenu = document.querySelector<HTMLElement>('#geo-right [role="menu"]')!
  const richMenu = document.querySelector<HTMLElement>('#geo-rich [role="menu"]')!
  const richScroll = richMenu.querySelector<HTMLElement>('[data-rich-scroll]')!
  const selectCard = document.querySelector<HTMLElement>('#geo-select [data-select-card]')!
  const selectListbox = selectCard.querySelector<HTMLElement>('[role="listbox"]')!
  // Keep geometry active until the final assertion, but exclude these fixtures
  // from semantic Back while the other layered cases run.
  leftMenu.setAttribute('aria-hidden', 'true')
  rightMenu.setAttribute('aria-hidden', 'true')
  richMenu.setAttribute('aria-hidden', 'true')
  selectListbox.setAttribute('aria-hidden', 'true')

  const anchoredTrigger = document.createElement('button')
  anchoredTrigger.setAttribute('aria-haspopup', 'menu')
  anchoredTrigger.setAttribute('aria-expanded', 'true')
  anchoredTrigger.setAttribute('aria-controls', 'anchored-trigger-menu')
  anchoredTrigger.textContent = 'Anchored picker'
  const anchoredMenu = document.createElement('div')
  anchoredMenu.id = 'anchored-trigger-menu'
  anchoredMenu.setAttribute('role', 'menu')
  anchoredMenu.textContent = 'Picker rows'
  const closeAnchoredBeforeClick = (event: MouseEvent): void => {
    if (!anchoredMenu.contains(event.target as Node)) anchoredTrigger.setAttribute('aria-expanded', 'false')
  }
  document.addEventListener('mousedown', closeAnchoredBeforeClick)
  anchoredTrigger.addEventListener('click', () => {
    anchoredTrigger.setAttribute('aria-expanded', String(anchoredTrigger.getAttribute('aria-expanded') !== 'true'))
  })
  document.body.append(anchoredTrigger, anchoredMenu)
  pointer(anchoredTrigger, 'pointerdown', { pointerId: 22, clientX: 180, clientY: 180 })
  anchoredTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  document.body.dataset.anchoredTriggerClosed = String(anchoredTrigger.getAttribute('aria-expanded') === 'false')
  document.removeEventListener('mousedown', closeAnchoredBeforeClick)
  anchoredTrigger.remove()
  anchoredMenu.remove()

  const touchModelRoot = document.createElement('div')
  touchModelRoot.innerHTML = '<button aria-haspopup="menu" aria-expanded="true">Model</button><div role="menu">Models</div>'
  const touchModelMenu = touchModelRoot.querySelector<HTMLElement>('[role="menu"]')!
  const closeTouchModel = (event: MouseEvent): void => {
    if (!touchModelRoot.contains(event.target as Node)) touchModelMenu.remove()
  }
  document.addEventListener('mousedown', closeTouchModel)
  document.body.append(touchModelRoot)
  pointer(frame, 'pointerdown', { pointerId: 20, clientX: 180, clientY: 180 })
  pointer(frame, 'pointerup', { pointerId: 20, clientX: 180, clientY: 180 })
  document.body.dataset.modelTouchOutsideClosed = String(!touchModelMenu.isConnected)
  document.removeEventListener('mousedown', closeTouchModel)
  touchModelRoot.remove()

  const modeButton = document.createElement('button')
  modeButton.textContent = 'Mode'
  document.body.append(modeButton)
  const clickSelectRoot = document.createElement('div')
  clickSelectRoot.innerHTML = '<input aria-label="Search models"><div role="listbox"><div role="option">Model</div></div>'
  const closeClickSelect = (event: PointerEvent): void => {
    if (!clickSelectRoot.contains(event.target as Node)) clickSelectRoot.remove()
  }
  document.addEventListener('pointerdown', closeClickSelect, true)
  document.body.append(clickSelectRoot)
  modeButton.click()
  document.body.dataset.modelModeClickClosed = String(!clickSelectRoot.isConnected)
  document.removeEventListener('pointerdown', closeClickSelect, true)
  clickSelectRoot.remove()
  modeButton.remove()

  const profile = document.createElement('div')
  profile.dataset.dshProfileMenu = ''
  profile.setAttribute('role', 'dialog')
  profile.setAttribute('aria-modal', 'true')
  profile.innerHTML = '<button data-profile-close>Close</button>'
  profile.querySelector('button')!.addEventListener('click', () => { profile.remove() })
  document.body.append(profile)
  targetAdapter.handle({ type: 'back', source: { kind: 'platform' } })
  document.body.dataset.profileBackClosed = String(!profile.isConnected)
  profile.remove()

  const mixedCalls: string[] = []
  const mixedStack = new InteractionSurfaceStack()
  const disposeMixedDrawer = mixedStack.register({ id: 'drawer', kind: 'navigation', dismiss: () => { mixedCalls.push('drawer') } })
  const mixedAdapter = createDomTargetAdapter({ layout: {
    toggleSidebar: () => { mixedCalls.push('drawer-dom') },
    closeDetails: () => { mixedCalls.push('details'); frame.removeAttribute('data-details-open') },
  } }, document, mixedStack)
  frame.setAttribute('data-details-open', '')
  mixedAdapter.handle({ type: 'back', source: { kind: 'platform' } })
  document.body.dataset.mixedBackFirst = mixedCalls.join(',')
  frame.removeAttribute('data-details-open')
  disposeMixedDrawer()

  popup.setAttribute('aria-expanded', 'false')
  const modelRoot = document.createElement('div')
  const modelMenu = document.createElement('div')
  modelMenu.setAttribute('role', 'menu')
  modelMenu.textContent = 'Models'
  modelRoot.append(modelMenu)
  modelRoot.addEventListener('keydown', event => {
    if (event.key === 'Escape') modelMenu.remove()
  })
  document.body.append(modelRoot)
  targetAdapter.handle({ type: 'back', source: { kind: 'platform' } })
  document.body.dataset.modelBackClosed = String(!modelMenu.isConnected)

  modelRoot.remove()
  const question = document.createElement('section')
  question.innerHTML = '<header><button aria-expanded="true">Minimize</button></header><div data-question-scroll></div>'
  const minimize = question.querySelector('button')!
  minimize.addEventListener('click', () => { minimize.setAttribute('aria-expanded', 'false') })
  document.body.append(question)
  targetAdapter.handle({ type: 'back', source: { kind: 'platform' } })
  document.body.dataset.questionBackMinimized = String(minimize.getAttribute('aria-expanded') === 'false')
  question.remove()

  const takeoverModelRoot = document.createElement('div')
  takeoverModelRoot.innerHTML = '<button aria-haspopup="menu" aria-expanded="true">Model</button><div role="menu">Models</div>'
  const takeoverModelMenu = takeoverModelRoot.querySelector<HTMLElement>('[role="menu"]')!
  const closeTakeoverModel = (event: MouseEvent): void => {
    if (!takeoverModelRoot.contains(event.target as Node)) takeoverModelMenu.remove()
  }
  document.addEventListener('mousedown', closeTakeoverModel)
  document.body.append(takeoverModelRoot)
  const takeoverSelectRoot = document.createElement('div')
  takeoverSelectRoot.innerHTML = '<input aria-label="Search models"><div role="listbox"><div role="option">Model</div></div>'
  const closeTakeoverSelect = (event: PointerEvent): void => {
    if (!takeoverSelectRoot.contains(event.target as Node)) takeoverSelectRoot.remove()
  }
  document.addEventListener('pointerdown', closeTakeoverSelect, true)
  document.body.append(takeoverSelectRoot)
  const takeover = document.createElement('section')
  takeover.innerHTML = '<div data-question-scroll>Question</div>'
  document.body.append(takeover)

  const row = document.querySelector('#row')!
  window.queueMicrotask(() => { pointer(row, 'pointerdown', { pointerId: 3, clientX: 100, clientY: 250 }) })

  window.setTimeout(() => {
    document.body.dataset.enterHint = document.querySelector('#composer')!.getAttribute('enterkeyhint') ?? ''
    document.body.dataset.rowMarked = String(document.querySelector('#row')!.hasAttribute('data-dsh-touch-action-row'))
    document.body.dataset.actionsMarked = String(document.querySelector('#actions')!.hasAttribute('data-dsh-touch-action-host'))
    document.body.dataset.lazyRowMarked = String(document.querySelector('#lazy-row')!.hasAttribute('data-dsh-touch-action-row'))
    document.body.dataset.inspectMarked = String(document.querySelector('#inspect')!.hasAttribute('data-dsh-touch-reveal'))
    document.body.dataset.operations = operations.join(',')
    document.body.dataset.drawerOpened = String(frame.hasAttribute('data-drawer-open'))
    document.body.dataset.popupOpened = popup.getAttribute('aria-expanded') ?? ''
    document.body.dataset.modelQuestionClosed = String(!takeoverModelMenu.isConnected)
    document.body.dataset.modelSelectQuestionClosed = String(!takeoverSelectRoot.isConnected)
    document.removeEventListener('pointerdown', closeTakeoverSelect, true)
    document.removeEventListener('mousedown', closeTakeoverModel)
    takeoverModelRoot.remove()
    takeover.remove()
    const leftRect = leftMenu.getBoundingClientRect()
    const rightRect = rightMenu.getBoundingClientRect()
    document.body.dataset.popupSimpleWidth = String(Math.round(leftRect.width))
    document.body.dataset.popupLeftAligned = String(Math.abs(leftRect.left - leftAnchor.getBoundingClientRect().left) < 2)
    const rightDelta = rightRect.right - rightAnchor.getBoundingClientRect().right
    document.body.dataset.popupRightDelta = String(Math.round(rightDelta))
    document.body.dataset.popupRightAligned = String(Math.abs(rightDelta) < 2)
    document.body.dataset.popupRichMaxHeight = getComputedStyle(richMenu).maxHeight
    document.body.dataset.popupRichOverflow = getComputedStyle(richMenu).overflowY
    document.body.dataset.popupRichScrolls = String(richScroll.scrollHeight > richScroll.clientHeight)
    document.body.dataset.popupSelectCardPresented = selectCard.dataset.dshMobilePopup ?? ''
    document.body.dataset.popupSelectListboxPresented = selectListbox.dataset.dshMobilePopup ?? ''
    disposePopupGeometry()
    disposeTouch()
    disposeComposer()
    document.body.dataset.cleanup = [
      document.querySelector('#composer')!.hasAttribute('enterkeyhint'),
      document.querySelector('#row')!.hasAttribute('data-dsh-touch-action-row'),
      document.querySelector('#inspect')!.hasAttribute('data-dsh-touch-reveal'),
    ].join(',')
    document.body.dataset.ready = 'true'
  }, 550)
}, 150)
