# Mobile Interaction Operations

Status: interaction repair campaign implemented for `@dsh-mobile/interaction-operations`. This document is the compatibility inventory and extension contract. DSH core is reference-only and must not be modified.

## Problem and seam

Desktop DSH assumes hover, right click, HTML drag/drop, wheel input, and browser keyboard conventions in several places. A narrow layout alone cannot repair those assumptions. The chosen seam is between an input Adapter and an **Interaction Intent**: a modality-independent presentation request. Feature mutations stay behind the official UI that already owns confirmation, permissions, state, and errors.

The Module has one outward Interface:

```ts
interactionOperations.dispatch(intent):
  | { status: 'handled'; adapter: string }
  | { status: 'unhandled' }
  | { status: 'blocked'; adapter: string; error: unknown }

interactionOperations.registerSurface({ id, kind, dismiss }): () => void
```

Current intents are `back`, `open-navigation`, `close-navigation`, `open-context-actions`, and `open-popup`. They are presentation operations, not rename/delete/archive/send operations.

### Invariants

1. Resolution is synchronous so native Back can safely choose whether to fall through.
2. The first accepting target Adapter wins.
3. Adapter failure is `blocked`, never `unhandled`; a broken modal must not turn Back into app exit.
4. A compatibility Adapter may reveal or activate an official control, but never reproduce a Host mutation.
5. Every global listener, style, marker, timer, and native listener has one teardown owner.
6. Missing semantic anchors degrade the enhancement and produce no destructive fallback.
7. Plain trusted Enter in an editable mobile composer means newline. Synthetic Enter from the explicit send bridge and Ctrl/Command Enter remain upstream-owned; IME and open selection popups retain their own Enter behavior.

## Dependency classification

| Dependency | Class | Treatment |
|---|---|---|
| Pointer/keyboard recognition and intent routing | in-process | hidden inside the plugin |
| Capacitor Android Back | local-substitutable | App Shell emits a cancelable DOM event; native bridge is never exposed |
| Official slots and `ctx.layout` | formal in-process seam | preferred target Adapter |
| Mobile Layout data attributes | plugin-owned semantic seam | stable across upstream versions |
| ARIA/role DOM discovery | version-sensitive compatibility Adapter | centralized, feature-detected, retractable |
| WebXR session/controller | unavailable/speculative | no dedicated Adapter until a supported runtime exists |

## Back precedence

1. Dismiss the visible IME/editable layer.
2. Close one modal, including the Product Client Host Profile surface.
3. Minimize one question takeover.
4. Dispatch Escape to the actual top official menu, listbox, picker, dialog, or expanded subagent tree.
5. Close the mobile details surface.
6. Close the mobile navigation drawer.
7. Return `unhandled`. The App Shell then uses browser history when available, otherwise native exit.

Plugin-owned surfaces register only a closed semantic kind (modal, takeover, popup, details, or navigation). Kind precedence is policy-owned; callers cannot provide arbitrary priorities. Same-kind registrations are LIFO and every registration disposer owns teardown.

The App Shell does not decide UI state and the plugin does not receive `App.exitApp` or any other native capability.

## Interaction inventory

### P0: included in the first slice

| Desktop assumption | Upstream evidence | Mobile replacement |
|---|---|---|
| Workspace/session row actions exist only on hover | `ui-workspace/src/client/rows/Rows.module.css` hides row action hosts until `:hover` | semantic row annotator makes the official action host visible on coarse/no-hover devices; long press opens the trailing official Menu anchor |
| Tool and Skill Inspect controls are fully transparent until hover/focus | `ui-tool/.../ToolRow.module.css` and `ui-skill/.../SkillRow.module.css` | reveal laid-out, focusable buttons whose computed opacity is zero; never reveal elements removed from layout |
| Subagent catalog opens on mouse hover; some trigger variants have no click-open path | `ui-subagent/src/client/SubagentHeaderLineage.tsx` | after a touch tap remains mounted and collapsed, dispatch the existing ArrowDown keyboard seam |
| Android Back has no DSH surface arbitration | App Shell previously listened only for URL and app-state events | cancelable `dsh-mobile:platform-back` request; plugin consumes handled/blocked outcomes, shell owns history/exit fallback |
| Navigation has buttons but no phone gesture | Mobile Layout drawer state is already exposed by plugin-owned attributes | conservative 24px left-edge swipe opens; horizontal swipe inside the open drawer closes; 56px distance, angle, time, and primary-touch gates avoid vertical-scroll claims |
| Plain Enter sends from the official composer | `InputBar.tsx` submits after its IME/Shift arbitration | trusted plain Enter is stopped before React without `preventDefault`, so the textarea inserts a newline; `enterkeyhint=enter` is installed and restored on teardown |
| The two-row model root is shorter than generic rich-choice heuristics | `ModelSelect.tsx` keeps a 240px root menu for labels, current values, and chevrons | the semantic model trigger classifies its owned root as rich, preserving the authored width and one-line labels without widening unrelated short menus |

### P1: next compatibility slice

| Gap | Why not globally synthesized now | Proposed Adapter |
|---|---|---|
| JSON copy-mode menu is right-click-only | ordinary tap intentionally performs default copy | long press only on `[data-json-copy-button]` dispatches `contextmenu`; preserve tap-to-copy |
| HoverCard preview/copy content is unavailable | long press may conflict with row context actions and text selection | add only on anchors with an explicit semantic marker; otherwise keep optional preview unavailable |
| Small target sizes remain below 44px in specialist surfaces | a global button-size rule breaks dense tables | per-semantic-surface coarse-pointer styles |
| Bottom-sheet/details swipe-to-dismiss | details may be a bottom sheet or Codex right drawer | Mobile Layout registers or exposes the surface axis; recognizer maps down/right to `back` only inside that surface |

### P2 or owner-required

| Gap | Decision |
|---|---|
| Workspace HTML drag/drop reorder | Do not synthesize DragEvent/DataTransfer globally. Add a move intent only when an official workspace move seam or a stable plugin-owned list Adapter exists. |
| Trajectory timeline uses wheel zoom and right-button pan | Specialist two-dimensional interaction; requires an owner Adapter with pinch/pan semantics, not global gesture takeover. |
| Hover-only informational timestamps/previews | Make essential information visible where layout permits; do not convert every decorative hover into a gesture. |
| Gaze dwell / WebXR controller events | Browser-generated click/Pointer Events already work. A WebXR Adapter is justified only when the Product Client supports an actual XR runtime. |

## Gesture arbitration

- Recognize only primary touch pointers; pen/mouse keep their native semantics.
- Long press is limited to already-annotated action rows and excludes links, controls, editable content, and text input.
- Movement beyond 10px cancels long press.
- Edge swipe starts only inside 24px and never claims the full conversation surface.
- A swipe needs at least 56px horizontal movement, 1.4:1 horizontal dominance, and completion within 800ms.
- The recognizer observes rather than globally disabling browser panning; Android system-edge navigation is allowed to win.
- The synthetic click following a completed long press is suppressed, while the official Menu anchor click used to open actions is allowed.

## Why this Module is deep

The Interface is one method and five stable presentation intents. Behind it sit ordering, native fallback safety, gesture thresholds, hover capability adaptation, semantic discovery, keyboard/IME policy, compatibility failure, and teardown. Deleting the Module would spread those rules back across MobileFrame, ComposerAttach, the App Shell, and per-feature selectors.

A broad capability registry is deliberately not exposed. Production evidence now requires one narrow active-surface registration seam, recorded in ADR 0008: callers register only a closed semantic kind and a dismiss operation, while this Module owns precedence and LIFO ordering. Recognizers, arbitrary priorities, and Host business mutations remain internal or upstream-owned.

## Verification matrix

- Unit: first-wins routing, unhandled outcome, failure blocks fall-through, Enter/IME/modifier policy.
- Browser fixture: semantic action markers, transparent action reveal, subagent popup fallback, edge swipe, long press, `enterkeyhint`, complete teardown.
- Shell: handled Back, history Back, and root exit paths.
- Manifest: the packaged plugin is present on both narrow and wide Product Client roots, de-duplicates a Host-installed copy, and is never fetched through the tunnel.
- Upgrade: audit official ARIA roles and row structure for every pinned DSH revision; missing optional adapters must not block shell boot.
