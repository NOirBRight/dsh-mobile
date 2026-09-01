# Published DSH plugin coupling review — 2026-08-26

## Scope and fixed point

This is a current-state architecture review, not a branch diff. The release fixed point is the exact production graph in `/home/noirbright/.dsh/profiles/web/package.json` and the artifacts currently installed beneath that profile:

| Published plugin | Version |
|---|---:|
| `@dsh-mobile/pairing` | 0.1.7 |
| `dsh-codex-sidebar` | 0.3.22 |
| `dsh-llm-codex` | 0.3.1 |
| `dsh-llm-commandcode` | 0.1.1 |
| `dsh-llm-cursor` | 0.2.7 |
| `dsh-llm-grok` | 0.3.1 |
| `dsh-llm-ollama` | 0.6.8 |
| `dsh-llm-opencode-go` | 0.1.8 |
| `dsh-model-switch` | 0.3.11 |
| `dsh-usage-monitor` | 0.2.2 |
| `dshmarket` | 1.15.0 |

The production boot manifest exposes all eleven entries. The official rc.2 staging and runtime checkouts remain clean at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

Additional lab-only or superseded candidates were reviewed separately: `dsh-external-agents`, `dsh-composer-picker`, `dsh-llm-assistant`, `dsh-buddy`, and `dsh-ainvestor`. They are not counted as production-published entries.

## Executive verdict

**The official DSH Core boundary is still intact, but the published plugin graph is not fully decoupled.** No released artifact carries a Core source patch. The remaining coupling is concentrated in four clusters:

1. Six provider plugins jointly implement one shared Settings page by copying a first-installed owner.
2. Codex and Sidebar mutate Host objects or module-global state instead of crossing a public registration seam.
3. Model Switch embeds dormant ownership and structural assumptions about External Agents, mobile interaction operations, and session internals.
4. Release gates do not detect several broken package exports, undeclared runtime imports, or stale lab composition.

Release status: **NO-GO for another coordinated promotion until P1 findings are fixed or explicitly waived in ADRs.** Current production can continue running; this review does not recommend editing DSH Core or restarting production.

## Standards axis

### P1 — Provider Settings has six competing owners

Released Codex, Cursor, Grok, Ollama, Command Code, and OpenCode Go each ship their own `ProvidersSection`, claim `settings.section` id `providers`, declare `settings.provider.item`, and hard-code sibling order. Evidence includes:

- `~/.dsh/profiles/web/node_modules/dsh-llm-codex/lib/client.js:974-1081`
- `dsh-llm-commandcode/lib/client.js:373,626-633`
- `dsh-llm-cursor/lib/client.js:646-753`
- `dsh-llm-grok/lib/client.js:705-812`
- `dsh-llm-ollama/lib/client.js:583-690`
- `dsh-llm-opencode-go/lib/client.js:557-664`

The first installed plugin becomes page owner; owner implementations and known-order lists already differ. Some versions dynamically append unknown cards, while Command Code renders only its static list. Loader order therefore changes behavior.

**Solution seam:** introduce one `dsh-provider-settings` owner module. It alone registers the Settings section, locale, icon adapter, and keyed child slot. Provider plugins only contribute a typed card descriptor through a small public interface. If the owner is absent, a provider either contributes to the official plugin settings tab or explicitly disables its aggregate card; it must not race to become owner.

**Acceptance:** pack all six providers plus the owner; test every owner/provider load and unload order; assert one nav row, one page implementation, all registered cards, deterministic ordering, and no duplicate-error parsing.

### P1 — Codex mutates the running Host's session-event vocabulary

The released Codex artifact resolves `@deepseek-ai/dsh-session` from `process.argv[1]`, imports that second Host copy, and mutates `KNOWN_SESSION_EVENT_TYPES`:

- `dsh-llm-codex/lib/index.js:2477-2503`

This depends on CLI layout, module identity, a mutable exported Set, and process-global side effects. It is not equivalent to a normal public package import.

**Solution seam:** add or consume a typed `sessions.registerEventType(name, decoder) -> dispose` interface. Until an official release provides it, keep the search request in a plugin-owned store or omit the durable custom event; fail closed rather than resolving the Host package by CLI path.

**Acceptance:** isolated packed install under alternate launchers and package managers, duplicate module copies, missing event registration capability, unload/reload, and replay of old logs.

### P1 — Sidebar monkey-patches Host services and private DOM

The released Sidebar reassigns `workspaces.openPath` and `layout.openDetails`, with `Object.defineProperty` fallback, and traverses official layout markers:

- `dsh-codex-sidebar/lib/client.js:1005-1022`
- `dsh-codex-sidebar/lib/client.js:1326-1348`
- `dsh-codex-sidebar/lib/client.js:15716-16002`

The public methods are legitimate dependencies; replacing their implementations is not. It creates order-dependent wrappers, incomplete disposal, and breakage when the official object becomes frozen or changes identity.

**Solution seam:** a plugin-owned command/interception registry, such as `workspaceOpenHandlers.register(handler)` and `detailsRevealHandlers.register(handler)`, with explicit priority and disposer. Keep DOM compatibility in one versioned Adapter only for features with no public seam.

**Acceptance:** frozen Host service objects, two interceptors in both orders, unload/reload, official fallback, and rc.2/next-tag fixtures.

### P1 — Published package contracts contain broken exports

Five provider manifests export `./src/*` while their installed artifacts contain no `src` directory:

- Codex package.json:32 versus files:35-45
- Cursor package.json:32 versus files:35-44
- Grok package.json:32 versus files:35-41
- Ollama package.json:32 versus files:35-41
- OpenCode Go package.json:12 versus files:15-23

The installed Sidebar also declares `./client` types at `lib/types/client/index.d.ts`, but that file is absent.

**Solution:** remove source exports from released manifests, or intentionally ship source with stable declarations. Generate and validate every `exports` target from the packed tarball, never from the checkout.

**Acceptance:** extract tarball, resolve/import every runtime and types target in a strict temporary consumer, and reject undeclared or dangling targets.

### P1 — dshmarket's optional dependency is statically required

Released dshmarket 1.15.0 statically imports `@deepseek-ai/dsh-settings` and `@deepseek-ai/schemastery` at `lib/settings.js:35-36`. Its manifest marks Settings as an optional peer and declares no Schemastery runtime dependency (package.json:37-44,100-103). A strict isolated install can fail before optional capability detection runs.

**Solution:** either make both imports required peers/dependencies, or move the Settings implementation behind a dynamic optional Adapter that is not imported when the service is absent.

**Acceptance:** strict isolated install with Settings present and absent; both paths must boot deterministically.

### P2 — Settings navigation icons are private DOM adapters

Model Switch, Usage Monitor, and all six providers scan `nav button`, match localized text, replace `svg.innerHTML`, and watch the official DOM. Examples:

- `dsh-model-switch/lib/client.js:2503-2525`
- `dsh-usage-monitor/lib/client.js:1722-1751`
- provider bundles at Codex:573-594, Cursor:245-266, Grok:304-325, Ollama:204-225, OpenCode Go:178-199, Command Code:406-426

This is a known compatibility Adapter, not a Core patch, but it is coupled to labels and markup.

**Solution:** first centralize the six provider copies in the provider-settings owner. Separately propose a generic `settings.section.icon` field upstream. Until released, one well-tested DOM Adapter per owned section is acceptable.

### P2 — Cross-plugin version declarations do not match the installed graph

Codex and Grok publish a typed optional `dsh-model-switch/adapter-registry` integration and inject the `modelSwitch` service, but both declare optional peer `dsh-model-switch: ^0.2.0` while production installs 0.3.11. The seam itself is valid; compatibility metadata and a combined packed gate are stale.

**Solution:** version the Adapter interface explicitly and publish provider releases whose peer ranges include the tested Model Switch line. Prefer a tiny contract-only export with semver guarantees over structural casts.

**Acceptance:** provider standalone, Model Switch standalone, and both combined in both load orders, using only packed published artifacts.

### P2 — Release validation is not self-contained

Command Code's current release verifier hard-codes four `/home/noirbright/Workstation/...` sibling checkouts and requires pre-staged tarballs. The lab profile also currently has a broken `dsh-llm-codex` link targeting the removed `dsh-llm-codex-v0.3.0` directory. Lab links are allowed by policy, but broken links invalidate acceptance.

**Solution:** fixtures must be immutable tarballs or registry/GitHub commit artifacts supplied by environment/manifest, never maintainer checkout paths. Keep a separate lab profile, but generate a release-candidate profile containing exact versions and SHA-256 values.

### Controlled adapters, not violations

- Ordinary Cordis `insert` rows are valid plugin registration, not Core patches.
- Public `@deepseek-ai/*` package imports and documented `/client` exports are valid.
- Pairing's `@dsh-mobile/e2e-tunnel#v0.1.3` dependency is explicit and versioned.
- Model Switch's exact rc.2 Subagent Loader replacement is a controlled, version-pinned compatibility Adapter. It must remain isolated, fail closed outside the tested tag, and be replaced by an upstream Subagent route-policy seam when one exists.
- dshmarket's explicitly documented Desktop Adapter is capability-gated and is not itself a Core coupling defect.

## Spec axis — issue #3 ownership and clean-Core rules

### P1 — Model Switch inverts the agreed Plan owner

Model Switch publishes the plugin-owned child slot `external-agents.plan-review.continue-in-dsh`, but also sets its own top-level Plan owner priority to `-7`, explicitly beating External Agents at `-6`:

- `dsh-model-switch/lib/client.js:2033,2417-2483`
- `dsh-model-switch/PRODUCT.md:27-29`
- canonical ownership: [enhancement seams](./enhancement-seams.md)

The defect is dormant in today's production profile because External Agents is not installed there, but it breaks the published combined contract and makes the child slot ineffective.

**Solution:** keep Model Switch's standalone Plan owner at the lower-precedence picker priority (the previous `-5` pattern), so External Agents `-6` wins when present. Model Switch continues to register the child Adapter. Do not remove standalone Plan Review.

**Acceptance:** Model Switch-only owns one Plan card; External-only owns one; combined in both load orders has External as the only top-level owner and Model Switch as the registered child; model commit occurs before response.

### P1 — Canonical evidence still names the superseded package

Model Switch says it replaces `dsh-composer-picker`, but issue #3 evidence and the clean matrix still model Composer Picker as the canonical owner. External Agents compatibility also targets the legacy sibling checkout.

**Solution:** write an ADR that transfers the picker-owner role from Composer Picker to Model Switch without changing the interface. Deprecate Composer Picker releases. Update enhancement seams, evidence, External compatibility, and the matrix atomically.

### P1 — The clean rc.2 matrix has a machine-specific default

The dsh-mobile verification scripts still default to a sibling `/home/noirbright/Workstation/deepseek-harness`; without an explicit `DSH_UPSTREAM`, the compatibility check resolves the wrong revision and fails. This contradicts the clean fixed-baseline acceptance rule.

**Solution:** require an explicit immutable rc.2 input or resolve a managed exact-tag checkout; never silently fall back to a developer sibling. Replace legacy Composer matrix rows with Model Switch rows and add the full production plugin graph.

## Per-plugin release disposition

| Plugin | Core boundary | Residual coupling / release issue | Disposition |
|---|---|---|---|
| Pairing 0.1.7 | Clean | Release-source/mirror equality is manual | Conditional pass; add equality gate |
| Codex Sidebar 0.3.22 | No Core patch | Host method monkey-patches, official DOM, missing client types target | Block next release |
| Codex 0.3.1 | Public peers plus private Host mutation | Session vocabulary mutation; shared provider owner; DOM; dangling source export | Block next release |
| Command Code 0.1.1 | Public peers | Shared provider owner; DOM; machine-specific release verifier | Block next release |
| Cursor 0.2.7 | Public peers | Shared provider owner; DOM; dangling source export | Block next release |
| Grok 0.3.1 | Public peers | Shared provider owner; DOM; dangling source export; stale Model Switch peer | Block next release |
| Ollama 0.6.8 | Public peers | Shared provider owner; DOM; dangling source export | Block next release |
| OpenCode Go 0.1.8 | Public peers | Shared provider owner; DOM; dangling source export/stale-output gate | Block next release |
| Model Switch 0.3.11 | Clean rc.2 Adapter | Plan-owner inversion; private optional structural services; DOM | Block combined promotion |
| Usage Monitor 0.2.2 | Clean | Official nav DOM Adapter only | Conditional pass |
| dshmarket 1.15.0 | Public host services | Static imports defeat optional dependency contract | Block portable release claim |

## Lab-only / superseded candidates

These do not change the production disposition above:

- `dsh-external-agents`: its child slot is a valid public plugin-owned seam, but its compatibility gate and docs still target Composer Picker; Model Switch currently suppresses its top-level owner.
- `dsh-composer-picker`: superseded by Model Switch; deprecate and keep only compatibility/security maintenance.
- `dsh-llm-assistant`: resolves Core modules from CLI `process.argv[1]` and reconstructs runtime shapes; needs typed Host capabilities before release.
- `dsh-buddy`: reconstructs session/agent event contracts and uses EventSource against the WebSocket mux path; lifecycle disposal is incomplete.
- `dsh-ainvestor`: defaults to `~/Workstation/AiInvestor-dsh/backend` and lacks repository/artifact provenance.

## Remediation plan

### Phase 0 — Restore trustworthy validation

1. Repair the broken lab Codex link without touching production.
2. Generate an immutable release-candidate manifest from the production versions and artifact hashes.
3. Add one shared package-contract checker: clean build, exact files allowlist, all exports/types resolve, strict dependency closure, tarball install, clean rc.2 boot.
4. Make dsh-mobile's exact rc.2 input explicit and remove sibling-checkout fallback.

### Phase 1 — Remove duplicated ownership

1. Publish the provider-settings owner and its tiny keyed-card interface.
2. Migrate all six providers in one coordinated release; providers stop claiming the page and stop listing siblings.
3. Restore Model Switch/External Plan priorities and migrate the issue #3 matrix to Model Switch.
4. Deprecate Composer Picker after the combined gate passes.

### Phase 2 — Replace private runtime mutations

1. Codex: remove Host package resolution and global Set mutation.
2. Sidebar: replace method reassignment with a registered interception interface; isolate remaining DOM fallback.
3. dshmarket: correct runtime dependency closure.
4. Correct all dangling exports and stale optional peer ranges.

### Phase 3 — Generic upstream proposals

Propose, independently of plugin releases:

- session event-type registration,
- Settings section icon metadata,
- workspace-open/details-reveal interception,
- typed subagent-session predicate,
- global Subagent route-policy hook.

Plugins must remain functional or explicitly degraded on clean rc.2 without these proposals.

## Release acceptance checklist

- Official checkout is exact `b150a551...` and clean before and after.
- Every artifact is built from a clean tag and installed from tarball/tag, not a checkout alias.
- Every manifest export and declaration resolves from the packed artifact.
- No undeclared static or dynamic runtime import.
- Provider shell has exactly one owner under all provider load/unload orders.
- Model Switch + External Agents pass both load orders with one Plan owner and child commit-before-response.
- Production graph boots in an isolated `DSH_HOME`; uninstalling any plugin restores official behavior without restoring files.
- Lab and production manifests are separately validated; lab links may exist but may not be broken.
