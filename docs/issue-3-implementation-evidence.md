# Issue #3 implementation evidence

This record preserves filenames and acceptance results, not a replayable DSH Core patch.

## Pinned upstream

- Tag: `dsh-v0.1.1-rc.2`
- Commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Required origin: `deepseek-ai/deepseek-harness`

Both official checkouts ended at the pinned commit with empty `git status --porcelain`:

- `/home/noirbright/Workstation/dsh-question-lab`
- `/home/noirbright/.local/opt/dsh-staging/dsh-v0.1.1-rc.2-b150a551b8d4`

## Pre-restore tracked file inventory

The question lab had these 18 modified files:

~~~text
packages/client/connection/src/client/fixture.ts
packages/client/runtime/src/client/sessions/session.ts
packages/client/runtime/tests/manager.client.spec.ts
packages/client/runtime/tests/session.client.spec.ts
packages/client/ui-user-questions/src/client/PlanReviewPanel.module.css
packages/client/ui-user-questions/src/client/PlanReviewPanel.tsx
packages/client/ui-user-questions/src/client/QuestionComposer.module.css
packages/client/ui-user-questions/src/client/QuestionComposer.tsx
packages/client/ui-user-questions/src/client/contract/slots.ts
packages/client/ui-user-questions/src/client/index.ts
packages/client/ui-user-questions/tests/browser-plugin.client.spec.ts
packages/client/ui-user-questions/tests/plan-review-panel.client.spec.tsx
packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx
packages/host/apiproxy/src/api-proxy.ts
packages/host/apiproxy/src/api/events.schema.ts
packages/host/apiproxy/src/api/events.ts
packages/host/apiproxy/tests/api-proxy-question.spec.ts
packages/host/apiproxy/tests/rpc-schemas.spec.ts
~~~

Staging had the same 18 files plus:

~~~text
packages/plan/plan-mode/src/index.ts
packages/plan/plan-mode/tests/plan-mode.spec.ts
~~~

The directories documented in `enhancement-seams.md` were restored from `HEAD`; no patch file or replay bundle was retained.

## Rebuild and stock-surface evidence

- `pnpm run build:official` completed with exit 0 in both official checkouts.
- `http://127.0.0.1:3080/` returned HTTP 200 after restoration.
- The served stock `@deepseek-ai/dsh-client-ui-user-questions` bundle contained none of:
  - `conversation.composer.plan-review.execution-model`
  - `setApprovalPreparation`
- A clean rc.2 lab boot on 3082 returned HTTP 200 and its boot manifest contained both plugin entries. Served bundles used `external-agents.plan-review.continue-in-dsh`, exposed the fail-closed explanation, and contained neither the old Core slot nor `EXTERNAL_PLAN_HANDOFF_SENTINEL`.

The repeatable release gate now replaces the one-off 3082 observation:

~~~sh
DSH_UPSTREAM=/home/noirbright/.local/opt/dsh-staging/dsh-v0.1.1-rc.2-b150a551b8d4 \
  npm run verify:release
~~~

## Packed clean-rc.2 matrix

`npm run verify:clean-rc2-matrix` completed with exit 0. It packed current plugin artifacts, installed them into fresh temporary `DSH_HOME` profiles, booted each profile through the pinned official CLI, fetched the served artifacts, and removed the profiles afterward.

| profile | observed boot entries |
|---|---|
| composer-only | `dsh-composer-picker` exactly once |
| external-only | `dsh-external-agents` exactly once |
| combined | both entries exactly once |
| mobile | `@dsh-mobile/pairing`, `@dsh-mobile/interaction-operations`, and `@dsh-mobile/ui-layout-mobile` exactly once each |

Before packing, the gate runs composer/external `check`, dsh-mobile typecheck/tests/architecture audit/build, and standalone pairing typecheck/tests/build. Installs use fresh profiles and a pre-populated local pnpm content store in offline mode; this avoids network variance but does not claim bit-for-bit dependency resolution without a future profile lockfile. Commands, HTTP requests, and shutdown all have bounded timeouts. Every produced tarball is then opened and scanned for source maps/source paths, checkout aliases, Core patches, vendored official packages, and fork-only runtime/declaration contracts.

The packed external-only run initially exposed a missing runtime dependency on `@deepseek-ai/dsh-sdk-protocol`; the dependency is now explicit and the matrix passes.

## Test evidence

- `dsh-composer-picker`: public package-root Plan Review contract, priority `-5`, rendered pending/error/enabled retry behavior, commit-before-answer, external child Adapter, build, full tests, and pack gate.
- `dsh-external-agents`: priority `-6`, public child-slot contract, rendered external-only disabled targets, rendered combined single card/selector/approval with commit-before-response, fail-closed RPC without side effects, foreground/background delegation, Job settlement/cancellation, build, full tests, and pack gate.
- `dsh-mobile`: typecheck, full tests, architecture audit, exact clean-rc.2 compatibility gate, clean-rc.2 build, and packed profile matrix.
