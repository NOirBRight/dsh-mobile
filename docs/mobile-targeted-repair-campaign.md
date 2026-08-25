# DSH Mobile Targeted Repair Campaign

Status: **Implemented and automatically validated; physical-device matrix pending**. The audit and interaction contract were confirmed on 2026-08-24. Implementation remains inside DSH Mobile and does not modify DSH core.

## Objective

Restore phone-width operability and continuity without changing DSH core. DSH Mobile may recompose presentation, adapt input modalities, and preserve user-visible client state, but every Host mutation remains owned by the Upstream UI Module that already implements it.

## Scope

1. Popup/menu width and edge alignment.
2. Touch selection in the slash-command candidate list.
3. Composer-level and per-turn statistics presentation.
4. User-expanded earlier history surviving live repair/reconnect.
5. One-layer Android Back semantics.
6. User-question takeover footer at phone widths.

Desktop/wide layout behavior is out of scope and must remain unchanged.

## Audit findings

### 1. Popup and menu geometry

The narrow client currently exposes at least **15 dropdown or list-selection surfaces**:

- twelve instances of the shared Menu family (eleven Upstream owners plus DSH Mobile ComposerAttach);
- the custom ModelSelect menu;
- the slash/input-trigger listbox;
- the command popupSelect listbox.

Modal dialogs are a separate geometry class and are not included in this count.

The shared Menu card has a desktop minimum width of 218px. At least ten of its mobile uses are simple action/selection menus whose labels do not justify that width. Rich preset and workspace rosters need a wider class rather than forcing every menu to the same width.

Confirmed alignment violations:

- workspace-row and session-row action menus open from a right-edge trigger but use start alignment;
- PermissionSelect is a right-side composer control but uses an in-place start-aligned menu;
- DSH Mobile overrides ModelSelect to a centered 240px card, so neither edge aligns to the trigger;
- anchorless/context menus can only be viewport-clamped unless the opening pointer/trigger is captured.

The current mobile rule covers only an in-place menu immediately following a composer trigger. It does not cover portaled Menu cards, row action menus, settings selectors, or rich listboxes. This cannot be solved reliably with one more selector.

### 2. Slash-command touch selection

The failure path is deterministic from the event contracts:

- the official slash candidate option selects in its React onMouseDown handler so the textarea keeps focus;
- ComposerAttach installs a document capture mousedown handler;
- composerControlButton currently classifies every button under data-composer-card as a toolbar control;
- a slash option is a button inside the composer card's listbox, so capture calls stopImmediatePropagation before the official onMouseDown can run;
- the official candidate has no click fallback, therefore the tap cannot pick it.

The focus-suppression adapter owns too broad a target set. Popup/listbox/menu/dialog descendants must remain owned by their feature module.

### 3. Statistics

Two different information surfaces exist and must not be conflated:

- **Session summary** under the composer: the mobile CompactStatsLine is a first implementation, but its copy is hard-coded Chinese, can wrap unpredictably, omits official cache-hit information, and duplicates context occupancy that already has a ContextMeter home.
- **Turn summary** after each assistant turn: Upstream already computes clock, run duration, TTFT, and decode throughput. Current mobile CSS only constrains the whole text span to 52vw/220px and applies ellipsis. It hides information instead of presenting it compactly.

The campaign needs an explicit content contract before choosing whether the context percentage remains in the session line and whether a turn line may wrap.

### 4. Earlier-history continuity

The reported symptom matches a concrete window replacement path:

1. Session.loadOlder prepends an earlier page.
2. A later live sequence gap or reconnect invokes repairGap.
3. repairGap fetches the tail page and calls installWindow.
4. installWindow replaces the expanded conversation window, so manually loaded older rows disappear.
5. Browser scroll clamping leaves the reader at the bottom of the smaller window.

This is a client-window reset, not deletion of Host history. DSH core remains reference-only.

The public SessionFace already provides subscribe/getSnapshot/loadOlder. A mobile continuity adapter can remember a per-session boundary only after the window moves earlier, detect a later shrink, and restore pages until that user-expanded boundary is present again. It must never prefetch earlier history merely because a session opened.

### 5. Back semantics

The current adapter scans for a transient role and dispatches Escape on document. That is insufficient:

- ModelSelect handles Escape on its React root. An event targeted at document does not bubble through that root, so Back is reported handled while the picker stays open.
- ModelSelect itself has two levels: Escape first backs out of a drilled model/effort pane, then closes the menu.
- visibility checks inspect only the candidate element, so an off-surface or ancestor-hidden popup can mask the drawer;
- drawer/details closure depends on a late ctx.layout lookup and has no registered surface identity;
- there is no LIFO surface ledger, so DOM order is being used as a proxy for interaction depth.

### 6. User-question footer

At phone width the footer is one non-wrapping flex row containing pager, feedback, Skip, and Next/Submit. The <=720px rule changes alignment but not layout. At 320px, the pager and two action buttons exceed the footer's available inner width even when feedback is empty, so clipping is deterministic.

## Proposed interaction contract

### A. Interaction Surface

An **Interaction Surface** is a presentation layer that can consume Back by moving exactly one level toward its parent. It never performs a Host business mutation.

Kinds are closed and policy-owned rather than caller-defined numeric priorities:

1. editable/IME dismissal when the native callback still observes an active phone keyboard;
2. modal;
3. takeover (for example a user-question panel, subject to the decision below);
4. popup (menu, listbox, non-modal dialog, or one drilled picker pane);
5. details;
6. navigation drawer;
7. browser history;
8. native exit.

Within one kind, the most recently opened active surface wins. One Back press produces at most one transition.

The existing interactionOperations Interface is deepened with a narrow registration operation for plugin-owned surfaces. Callers provide id, closed kind, isActive, and dismiss; callers do not choose arbitrary priorities. This new variation is now justified by multiple production owners: Mobile Layout drawer/details and product-owned transient surfaces. Upstream surfaces that cannot register continue through one compatibility adapter.

Compatibility Escape must be dispatched at the selected surface (or its controlling trigger), not at document. A surface counts as visible only when its ancestor chain and rendered client rect are visible. Existence alone is insufficient.

### B. Mobile Popup Geometry

Every non-modal popup has an Anchor when one can be resolved. After placement, one popup edge must align with the corresponding Anchor edge:

- anchor center in the left half: start edge;
- anchor center in the right half: end edge;
- explicit owner alignment may override the automatic choice when it remains in the viewport;
- unresolved anchors receive viewport clamping only, never fabricated centering.

All popup cards keep a 12px viewport gutter. Positioning is recomputed on open, content resize, window/visualViewport resize, and scroll. Centering by translateX is prohibited for anchored menus.

Geometry classes:

- **simple menu**: content-fit width, minimum 144px, maximum min(280px, viewport minus 24px);
- **rich menu**: width derived from anchor/content, minimum 220px, maximum min(320px, viewport minus 24px);
- **composer listbox**: uses the composer's available width, never exceeds the viewport gutter;
- **modal**: retains modal layout and is not resized by popup policy.

Touch row height remains owned by the surface, but essential actions must be at least 40px and must not require hover.

### C. Composer Event Ownership

The mobile focus adapter may suppress focus-taking events only for the direct composer toolbar controls it adapts. It must not intercept an event whose target is inside menu, listbox, dialog, or another feature-owned interactive surface.

A tap on a command candidate must:

1. call the official pick route exactly once;
2. update the textarea/selection through the official owner;
3. keep or restore the intended composer focus without reopening an unrelated popup;
4. remain neutral on desktop.

### D. Expanded History Boundary

An **Expanded History Boundary** is the earliest session sequence the current Product Client has observed after an explicit history prepend during this app lifetime.

Rules:

- session-scoped and memory-only;
- never created by initial session open;
- never causes generic prefetch;
- after a tail-window replacement, restores only as far as the remembered boundary;
- resets when the session binding is disposed, not when a live repair occurs;
- preserves the reader's semantic row and pixel offset while restoration runs;
- terminates safely when no older page exists, the session changes, or progress stops.

### E. Statistics

Session and turn statistics are separate contracts:

- session statistics use durable projections and remain stable when the visible history window changes;
- turn statistics use the already-derived turn metrics and remain attached to that turn;
- both are localized;
- neither may silently ellipsize essential values;
- the session main line is one non-expandable line: average TTFT · aggregate decode throughput · cache-hit rate · input tokens · output tokens;
- canonical compact example: `TTFT 9.9s · 68 tok/s · 缓存命中率 80% · ↑120K ↓9.2K`;
- no expanded statistics row or tap disclosure is rendered;
- every assistant turn tail keeps its independent compact line: clock · run duration · turn TTFT · turn decode throughput.

### F. Question Takeover Footer

At <=480px the footer becomes a grid:

- row 1: previous, progress, next-page controls;
- optional feedback row: full width;
- final row: Skip and Next/Submit as two equal-width buttons;
- all controls remain within the card at 320px and while the IME changes visualViewport height;
- the option body alone scrolls; header and footer remain reachable.

## Red-capable acceptance tests

### Popup geometry

At 320/360/390/412px, in Chinese and English:

- representative left and right triggers;
- in-place and portaled simple menus;
- model rich menu and command listbox;
- assert 12px viewport gutter;
- assert start-edge or end-edge Anchor alignment;
- assert simple menus shrink below the current 218px floor when content allows;
- assert content resize and orientation change re-place the same open surface.

### Command selection

Render the real command MenuView inside a data-composer-card with the mobile capture adapter. Replay pointerdown, mousedown, mouseup, click. The current code must fail because onPick is not called; the repair passes with exactly one call and the expected inserted command.

### Back

Build a stack containing drawer, details, model picker root/drilled pane, menu, and modal. Repeated platform-back events must close exactly one level in contract order. Hidden/off-surface role elements must not consume Back. Only an empty stack reaches history/exit.

### History

Start with a tail window, prepend two pages, simulate a repairGap tail replacement, then verify the adapter restores the remembered earliest sequence and the same semantic row remains within 1px of its saved top. A session never manually expanded must make zero loadOlder calls.

### Statistics

Snapshot tests cover zero/missing groups, long counts, both locales, and projection stability across a visible-window replacement. Browser tests assert that every primary value is visible at 320px and turn-tail actions remain reachable.

### Question footer

Render the official QuestionComposer at all target widths and both locales. Skip, Next/Submit, pager, and feedback bounds must remain inside the card; action buttons must not shrink or overlap; the option body must remain the only scroll region.

## Delivery gates

1. **Audit/contract gate — passed:** contract confirmed.
2. **P0 operability — automated passed:** command ownership, one-layer Back stack, and question footer.
3. **P0 continuity — automated passed:** explicit expanded-history boundary, restore cancellation, and semantic anchoring adapter.
4. **P1 geometry — automated passed:** width classes, nearest-edge alignment, vertical gutters, unresolved clamp, and resize recomputation.
5. **P1 information — automated passed:** approved non-expandable session copy and visible per-turn metrics.
6. **Lab acceptance — partially passed:** signed/versioned APK and public artifact are verified; the 3082 service is live, while the human checklist in [mobile-targeted-repair-physical-matrix.md](mobile-targeted-repair-physical-matrix.md) remains to be executed on a physical device.

Gate 1 is approved. Confirmed decisions: automatic Anchor-edge alignment; simple/rich/listbox width classes; non-expandable session statistics line; every assistant turn tail keeps a compact line; Back dismisses the IME then minimizes the question takeover; every user-opened history page is restored across in-app session switches, but the boundary is not persisted across a cold app restart.

## Implementation outcome (2026-08-24)

- `@dsh-mobile/interaction-operations` now owns a closed-kind Interaction Surface Stack, surface-targeted Back, and the mobile popup geometry presenter.
- Mobile Layout registers drawer/details surfaces, leaves slash/listbox descendants upstream-owned, renders the approved statistics line and compact turn tail, restores the Expanded History Boundary, and grids question actions at phone widths.
- Asset revisions are `mobile-layout-0.1.30` and `mobile-interactions-0.1.6`.
- Repository validation passed: interaction tests 17/17, mobile-web tests 196/196, pairing tests 115/115, relay tests, all workspace typechecks, architecture audit, and two-tier compatibility verification.
- Signed APK `1.1.1-test.20260824.9` (`versionCode 11`) is v2-signed. SHA-256: `56682bee16d22dee180c1806a0462374decf2f7f55ffed70b8f85bc720162670`.
