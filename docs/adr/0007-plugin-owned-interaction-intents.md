# Route cross-input interaction intents in an independent plugin

DSH Mobile will adapt touch, platform Back, keyboard policy, and future spatial input in an independently installable client plugin, not in DSH core and not as scattered handlers in the Mobile Layout. The plugin exposes one synchronous dispatch Interface for a small vocabulary of presentation-only Interaction Intents; it resolves formal DSH seams first, plugin-owned semantic anchors second, and version-sensitive semantic DOM compatibility Adapters last. The App Shell may emit cancelable platform intents but retains native capabilities and fallback exit/history behavior.

## Considered options

A broad capability registry was rejected because third-party target registration is not a current source of variation and would make the Interface as complex as its implementation. Per-feature touch patches were rejected because gesture arbitration, teardown, error handling, and upstream drift would remain distributed. Directly invoking workspace/session mutations was rejected because it would duplicate authorization, confirmation, and state ownership from Upstream UI Modules.

## Consequences

Interaction dispatch is synchronous: a target Adapter error returns a blocked outcome and must not fall through to navigation or app exit. The plugin may reveal or activate an upstream control, but Interaction Intents never encode destructive business mutations. XR controllers that synthesize Pointer Events work through the existing Adapter; a dedicated WebXR Adapter is deferred until a real supported runtime creates a second implementation.
