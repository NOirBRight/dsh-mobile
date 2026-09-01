# Issue #3 implementation evidence

This record documents the current dsh-mobile release inputs and verification gates. It does not provide or require a replayable DSH Core patch.

## Current official baseline

- Required tag: `dsh-v0.1.2-alpha.1`
- Required commit: `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- Required remote: the official `deepseek-ai/deepseek-harness` repository
- Required checkout state: exact tag and commit with a clean worktree

All active build consumers use the exact official baseline through `DSH_UPSTREAM`; the mobile matrix verifies that clean tagged source, copies only regular files and directories into an isolated temporary directory, skips source links, reinstalls ignored dependencies offline, and runs the official `pnpm run clean` and `pnpm run build` only in that copy. The verifier rejects a different revision, a missing exact tag, a non-official remote, or local changes; the provenance checkout is never written.

## Strict Pairing artifact input

Release verification consumes the published `@dsh-mobile/pairing@0.1.11` tarball. It requires both `MOBILE_PAIRING_TARBALL` and its exact lowercase 64-character SHA-256 digest in `MOBILE_PAIRING_SHA256`; it rejects `MOBILE_PAIRING_ROOT`. The caller path is opened with `O_NOFOLLOW`, validated as a regular file, and copied through the descriptor into private `0600` temporary storage. Manifest inspection, packed-entry checks, hashing, and installation use only that copy. A later caller-path hash check is evidence for TOCTOU detection and is never an execution input; cleanup preserves the primary failure and aggregates secondary errors.

The packed manifest must declare `@dsh-mobile/pairing`, version `0.1.11`, and the exact dependency `github:NOirBRight/dsh-e2e-tunnel#v0.1.4` under `dependencies`. Packed paths, including credential-bearing filenames, entry targets, runtime text, and served bundles reject source aliases, official source copies, Core patches, and fork-only contracts. Pairing's strict pack gate owns runtime dependency closure; the Mobile gate does not claim to prove it.

Run the complete strict gate with the final published tarball and the matching official checkout:

~~~sh
export DSH_UPSTREAM=/absolute/path/to/dsh-v0.1.2-alpha.1
export MOBILE_PAIRING_TARBALL=/absolute/path/to/dsh-mobile-pairing-0.1.11.tgz
export MOBILE_PAIRING_SHA256="$(sha256sum "$MOBILE_PAIRING_TARBALL" | cut -d" " -f1)"
npm run verify:release
~~~

The individual strict gates use the same variables:

~~~sh
npm run verify:pairing
npm run verify:compatibility
npm run verify:clean-alpha1-mobile-matrix
~~~

`verify:release` runs strict compatibility verification and the strict mobile matrix. Development commands with a `:dev` suffix are explicitly non-release checks; they may use an explicit `MOBILE_PAIRING_ROOT`, print `releaseEvidence: false`, and are never called by the release gate.

## Strict mobile matrix

The matrix verifies the exact tagged official source, copies the complete checkout into an isolated temporary directory, runs `pnpm run clean` followed by `pnpm run build` in that copy, records the resulting regular CLI's SHA-256 digest, and requires the same digest before each CLI execution. It creates isolated temporary `DSH_HOME` profiles, runs dsh-mobile typecheck/tests/architecture audit/build, packs the interaction and mobile-layout workspaces, installs the supplied Pairing copy, boots an unmodified official baseline first, and requires the mobile profile to retain its exact ordered `@deepseek-ai/*` roster except for the official root-layout entry replaced by the mobile layout, while adding only the three expected mobile entries. It checks served bundles, removes the copied checkout, and never writes the provenance checkout.

| profile | required entries |
|---|---|
| official-baseline | the nonempty ordered official `@deepseek-ai/*` roster captured from a fresh profile |
| mobile | the baseline roster with `@deepseek-ai/dsh-client-ui-layout` replaced by `@dsh-mobile/ui-layout-mobile`, plus `@dsh-mobile/pairing` and `@dsh-mobile/interaction-operations`, exactly once each |

The final matrix must be run only with the final immutable Pairing tarball, its matching SHA-256 digest, and the exact official checkout above. A source root or automatically discovered sibling artifact is not release evidence.

## Verification performed for this implementation

- `npm test`: all workspace and gate suites passed (215 mobile-web tests; 34 matrix tests).
- `npm run audit:architecture`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Focused official-checkout and mobile-matrix tests: 42 passed.

These checks cover strict input rejection, exact tag and commit selection, Pairing metadata negatives, artifact immutability, temporary profile cleanup, and PATH-based AM01S mux execution. The final release matrix remains a release-only gate rather than a substitute for these source checks.
