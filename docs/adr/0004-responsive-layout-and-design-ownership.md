# ADR 0004: Responsive layout and official design ownership

- Status: Accepted
- Date: 2026-08-16

## Context

The first mobile root replaced the official DSH root at every viewport width. As a result, desktop browsers also received the custom top bar, overlay drawer, and full-screen details sheet. The replacement used a fixed 300px sidebar owner width while its CSS rendered `min(300px, 84vw)`, so the sidebar occupant could receive a width different from its actual parent. It also relied on deep DOM selectors to move official conversation chrome and used local literal radius and spacing choices.

The current official AppFrame is already responsive within its desktop layout contract. It observes its own width, auto-collapses the sidebar below 1024px, uses a 56px rail, preserves a 640px center when possible, restores panels after re-widening, and uses an official 280px default expanded sidebar. However, it has no dedicated phone composition: below the rail-plus-center floor it squeezes the center, and several conversation metadata surfaces only truncate rather than offer a compact phone presentation.

DSH Mobile must follow upstream feature UI and visual design while changing spatial composition only where phone width requires it. Version drift should degrade visibly but should not unnecessarily block a usable client.

## Decision

1. Wide layouts use the Host's official `@deepseek-ai/dsh-client-ui-layout` unchanged. DSH Mobile must not maintain a parallel desktop composition.
2. The custom layout applies only below the official layout's viable rail-plus-center width. With the current official contract this is `SIDEBAR_COLLAPSED + CENTER_MIN`, or 56px + 640px = 696px. The threshold follows the official contract rather than becoming an unrelated product constant.
3. Above that threshold, all official behavior remains authoritative, including the 1024px sidebar auto-collapse rule, resizable panel widths, concession solver, and restoration on re-widening.
4. Narrow mode replaces only spatial composition: sidebar becomes an overlay drawer, details becomes a phone surface, safe-area placement is added, and content remains supplied by official Host modules.
5. The narrow drawer uses the official expanded sidebar default width, currently 280px, constrained only when the viewport is smaller. The sidebar owner receives the measured rendered width, never a conflicting constant.
6. Compatibility is best effort. A Host/App version mismatch produces a visible, non-blocking update notice while the client continues when the required slot contract is available. If the narrow adapter cannot safely mount, the client falls back to the official layout with a warning instead of rendering a blank page.
7. The official theme and primitive modules own colors, typography, radii, shadows, borders, motion, and other visual tokens. Mobile code consumes published official semantic tokens or official primitives; where no semantic token exists, it is added at the official owner rather than copied as a mobile literal.
8. Mobile code may change narrow-only wording, information priority, truncation, and disclosure patterns, but it must not independently restyle official feature content. Full information remains available through tap, disclosure, sheet, or accessible text.
9. Compact rendering belongs inside the official module that owns the content, preferably through container-aware presentation. The mobile root must not depend on deep global DOM selectors or generated CSS-module class names to rewrite token statistics, per-turn metrics, conversation headers, or composer controls.
10. Responsive behavior is width-driven, not domain-driven, client-type-driven, or maintainer-domain-specific. The same Host-served web shell can show exact official wide layout on a computer and narrow layout on a phone.
11. MVP preserves exact Host-version wide behavior by selecting the official or narrow root before plugin boot. Because the root slot is exclusive and official AppFrame is package-internal, crossing the threshold uses a controlled client reload until upstream exposes a live narrow-adapter seam. DSH Mobile does not copy and maintain a parallel official AppFrame implementation.
12. Existing official leaf-level container adaptation remains authoritative. New compact behavior for statistics or per-turn metadata is added to those owning official leaves rather than generalized into root-level DOM rewrites.
13. Narrow conversation statistics use the ordered visible summary `12轮 · 1204步 · 62 tok/s · 97% · ↑48K ↓8K`: turns, steps, decode throughput, cache-hit percentage, input tokens, and output tokens. Missing readings and their separators collapse cleanly. LLM/tool duration, TTFT, and other detail remain available on tap and through explicit accessible labels.
14. Narrow per-turn metadata uses the ordered visible summary `14:32 · 15s · 62 tok/s`: completion time, run duration, and decode throughput. Missing readings collapse cleanly; TTFT and full labels remain available on tap and through accessible text.
15. Compact statistics are localized for meaning rather than translated to equal character counts. The English bottom form is `12 turns · 1,204 steps · 62 tok/s · 97% · ↑48K ↓8K`; the per-turn numeric form remains `14:32 · 15s · 62 tok/s`. At the official 12px typography these measure approximately 266px and 113px respectively, while the Chinese bottom form measures approximately 225px. Narrow statistics therefore use at most 16px horizontal padding per side so both languages fit a 320px viewport at standard font scale. If localized values or accessibility font scaling exceed one line, the row wraps at group separators to at most two lines rather than hiding data or shrinking official typography.

## Consequences

- Desktop access through Quick Tunnel or a Custom Endpoint remains visually and behaviorally identical to official DSH layout.
- Phone layout changes no longer leak into desktop or wide tablet surfaces.
- The current always-mobile manifest replacement and mobile-only root store need redesign so the official layout remains available as the wide path.
- Crossing the narrow threshold must select the correct root without leaving two root occupants registered; until the official layout exposes a live narrow-adapter seam, a controlled boot-time selection and breakpoint transition may be required.
- The existing 300px/84vw drawer contract, custom hamburger styling, and deep `main header`/composer selectors are migration targets rather than stable interfaces.
- Official conversation modules need semantic compact presentations for the bottom statistics line and per-turn timing/throughput row; ellipsis alone is insufficient on touch devices.
- Version mismatch telemetry and notices distinguish harmless revision drift from an actually missing slot contract.
