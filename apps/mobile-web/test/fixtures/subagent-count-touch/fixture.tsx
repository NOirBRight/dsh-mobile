import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
// Real device-SDK component: the phone APK drives this exact upstream build.
import { SubagentHeaderLineage } from '../../../../../.dsh-upstream/packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx'
// Real mobile-owned adapters under test (production behavior, unmodified).
import { InteractionOperations } from '../../../../../packages/interaction-operations/src/client/operations.ts'
import { createDomTargetAdapter } from '../../../../../packages/interaction-operations/src/client/dom-target-adapter.ts'
import { installTouchInputAdapter } from '../../../../../packages/interaction-operations/src/client/touch-input-adapter.ts'

const PARENT = 'parent'
const CHILD = 'child-1'

function t(key: string, vars?: Record<string, string | number>): string {
  const dict: Record<string, string> = {
    'tree.aria': '\u5b50\u4ee3\u7406\u4f1a\u8bdd',
    'count.total.one': '{count} \u4e2a\u5b50\u4ee3\u7406',
    'count.total.other': '{count} \u4e2a\u5b50\u4ee3\u7406',
    'count.running.one': '{count} \u4e2a\u5b50\u4ee3\u7406\uff0c\u6b63\u5728\u8fd0\u884c',
    'count.running.other': '{count} \u4e2a\u5b50\u4ee3\u7406\uff0c\u6b63\u5728\u8fd0\u884c',
    'switcher.aria': '\u5207\u6362\u5b50\u4ee3\u7406\uff1a{title}',
    'mode.continuable': '\u53ef\u7ee7\u7eed',
    'mode.oneShot': '\u4e00\u6b21\u6027',
    'activity.running': '\u6b63\u5728\u8fd0\u884c',
    'activity.inactive': '\u5f53\u524d\u672a\u8fd0\u884c',
  }
  let out = dict[key] ?? key
  for (const [k, v] of Object.entries(vars ?? {})) out = out.replace(`{${k}}`, String(v))
  return out
}

// One completed continuable child: the exact post-completion seat from the lab report.
const catalog = {
  entries: [{
    kind: 'child', id: CHILD, mode: 'continuable', label: 'Child QA acceptance task',
    activity: 'inactive', hasChildren: false,
  }],
  parentAvailable: true,
  state: 'ready',
  error: null,
}

const listState = {
  ids: [CHILD],
  current: PARENT,
  phase: 'ready',
  byId: {
    [PARENT]: { id: PARENT, displayTitle: 'Parent', running: false, blank: false, updatedAt: 1 },
    [CHILD]: {
      id: CHILD, displayTitle: 'Child QA acceptance task', title: 'Child QA acceptance task',
      running: false, blank: false, updatedAt: 2, parentId: PARENT, origin: 'subagent',
    },
  },
  subagentsByParent: { [PARENT]: catalog },
  jobsBySession: {},
  currentAddress: undefined,
}

function useSessions<T>(select: (snapshot: typeof listState) => T): T {
  return select(listState)
}

const openChildCalls: unknown[] = []
const setCatalogOpenCalls: unknown[] = []

function lineageProps(extra?: { openTitle?: () => void }) {
  return {
    useSessions: useSessions as never,
    openChild: (address: unknown) => { openChildCalls.push(address) },
    refresh: () => {},
    setCatalogOpen: (parentSessionId: unknown, open: boolean) => { setCatalogOpenCalls.push([parentSessionId, open]) },
    t: t as never,
    ...extra,
  }
}

// Ancestor crumb: openTitle models real navigation by re-rooting the seat onto
// the parent, which unmounts the previous switcher catalog (keyed dropdown).
function AncestorSeat() {
  const [id, setId] = useState<string>(CHILD)
  return (
    <div id="ancestor-seat" data-seat={id}>
      <SubagentHeaderLineage
        lineageSessionId={id as never}
        displayTitle={id === CHILD ? 'Child QA acceptance task' : 'Parent'}
        {...(id === CHILD
          ? {
            openTitle: () => {
              document.body.dataset.ancestorNav = 'true'
              setId(PARENT)
            },
          }
          : {})}
        {...lineageProps()}
      />
    </div>
  )
}

function App() {
  useEffect(() => {
    const operations = new InteractionOperations([createDomTargetAdapter({}, document)])
    const disposeTouch = installTouchInputAdapter(operations, document, window)
    const dataset = document.body.dataset
    const query = (sel: string): HTMLElement => document.querySelector<HTMLElement>(sel)!
    const trees = (): number => document.querySelectorAll('div[role="tree"]').length
    const step = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))
    const touchTap = (target: Element): void => {
      target.dispatchEvent(new PointerEvent('pointerdown', {
        pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: 100, clientY: 20,
      }))
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    }
    const pressEscape = (): void => {
      const focused = document.activeElement as HTMLElement | null
      focused?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    }
    void (async () => {
      await step(60)
      const countBtn = query('#parent-seat button[aria-haspopup="tree"]') as HTMLButtonElement
      dataset.countAria = countBtn.getAttribute('aria-label') ?? ''
      const switcher = query('#child-seat button[aria-haspopup="tree"]') as HTMLButtonElement
      dataset.switcherAria = switcher.getAttribute('aria-label') ?? ''
      // 1. Plain mouse click: upstream wires no onClick for the count variant.
      countBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await step(60)
      dataset.clickExpanded = countBtn.getAttribute('aria-expanded') ?? ''
      dataset.clickTrees = String(trees())
      // 2. Public keyboard opener from upstream source.
      countBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
      await step(60)
      dataset.arrowExpanded = countBtn.getAttribute('aria-expanded') ?? ''
      dataset.arrowTrees = String(trees())
      dataset.arrowRow = document.querySelector('div[role="tree"] [role="treeitem"]')?.getAttribute('aria-label') ?? ''
      pressEscape()
      await step(60)
      dataset.afterEscapeTrees = String(trees())
      // 3. Genuine touch tap opens the same catalog without any Core change.
      touchTap(countBtn.querySelector('span') ?? countBtn)
      await step(100)
      dataset.touchExpanded = countBtn.getAttribute('aria-expanded') ?? ''
      dataset.touchTrees = String(trees())
      dataset.touchRow = document.querySelector('div[role="tree"] [role="treeitem"]')?.getAttribute('aria-label') ?? ''
      // 4. The official row handler navigates with the exact child address.
      const row = document.querySelector('div[role="tree"] [role="treeitem"]') as HTMLElement | null
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await step(60)
      dataset.openChild = JSON.stringify(openChildCalls[0] ?? null)
      dataset.afterRowTrees = String(trees())
      // 5. Current-child switcher carries no openTitle, so touch opens its menu
      // through the same public ArrowDown path (existing behavior).
      touchTap(switcher.querySelector('span') ?? switcher)
      await step(100)
      dataset.switcherExpanded = switcher.getAttribute('aria-expanded') ?? ''
      dataset.switcherTrees = String(trees())
      dataset.switcherRow = document.querySelector('div[role="tree"] [role="treeitem"]')?.getAttribute('aria-label') ?? ''
      pressEscape()
      await step(60)
      dataset.afterSwitcherEscapeTrees = String(trees())
      // 6. Ancestor switcher tap navigates: the seat re-roots onto the parent
      // and the previous switcher catalog unmounts with it.
      const ancestorSwitcher = query('#ancestor-seat button[aria-haspopup="tree"]') as HTMLButtonElement
      touchTap(ancestorSwitcher.querySelector('span') ?? ancestorSwitcher)
      await step(100)
      dataset.ancestorNav = dataset.ancestorNav ?? 'false'
      dataset.ancestorSeat = query('#ancestor-seat').dataset.seat ?? ''
      dataset.ancestorSeatAria = query('#ancestor-seat button[aria-haspopup="tree"]')?.getAttribute('aria-label') ?? ''
      dataset.afterAncestorTrees = String(trees())
      dataset.openChildCount = String(openChildCalls.length)
      dataset.setCatalogOpenCalls = JSON.stringify(setCatalogOpenCalls)
      dataset.ready = 'true'
    })()
    return () => { disposeTouch() }
  }, [])
  return (
    <>
      <div id="parent-seat">
        <SubagentHeaderLineage
          lineageSessionId={PARENT as never}
          displayTitle="Parent"
          {...lineageProps()}
        />
      </div>
      <div id="child-seat">
        <SubagentHeaderLineage
          lineageSessionId={CHILD as never}
          displayTitle="Child QA acceptance task"
          {...lineageProps()}
        />
      </div>
      <AncestorSeat />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
