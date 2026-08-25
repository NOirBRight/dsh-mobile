# Register plugin-owned interaction surfaces behind the intent router

DSH Mobile will deepen the existing `interactionOperations` Interface with registration for plugin-owned Interaction Surfaces. Callers declare a stable id, a closed surface kind, active-state observation, and one presentation-only dismiss operation. The interaction plugin owns precedence and LIFO resolution; callers cannot supply arbitrary numeric priorities. Official DSH surfaces that cannot register remain behind one semantic DOM compatibility Adapter. Android Back dispatch stays synchronous and falls through to browser history/native exit only when no registered or compatible surface accepts it.

## Context

ADR 0007 rejected a broad capability registry because no second production target implementation existed. The targeted mobile audit established real variation: Mobile Layout owns drawer and details state, the Product Client owns shell surfaces, ModelSelect has a drilled internal Back level, and official menus/listboxes remain compatibility targets. DOM order and document-targeted Escape cannot represent those different parent relationships.

## Considered options

Keeping a fixed Adapter list was rejected because it can only infer plugin-owned state after the fact and has already produced handled-without-dismissal outcomes. A fully open capability/priority registry was rejected because it would leak routing policy to callers and recreate the implementation in the Interface. Per-feature Android Back handlers were rejected because ordering, fallback safety, and teardown would again be distributed.

## Consequences

The registry is intentionally narrow: only presentation dismissal is accepted, kinds are closed, precedence is centralized, and one Back press performs at most one transition. Mobile Layout may formally register drawer/details without exposing its store. Compatibility Escape is targeted at the selected surface rather than `document`, and hidden or off-surface DOM cannot mask a registered layer. The App Shell still owns browser-history and native-exit fallback, and DSH core remains unchanged.
