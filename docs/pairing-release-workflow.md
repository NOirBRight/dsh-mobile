# Pairing / e2e-tunnel release workflow

This workflow keeps the production profile read-only while evolving the two independent published packages. The mobile repository owns the artifact integration and verification for the published inputs it consumes.

## Release order

1. **@dsh-mobile/e2e-tunnel**: in the e2e-tunnel checkout run `npm test` and `npm run build`; publish/tag (current candidate: **v0.1.5**).
2. **@dsh-mobile/pairing**: in the pairing checkout bump the dependency to `github:NOirBRight/dsh-e2e-tunnel#v0.1.5`; run `npm run build`, tests, `npm run verify:packed`, and `test/published-e2e-contract.test.mjs`; publish/tag (current candidate: **v0.1.14**).
3. **Lab validation**: keep `~/.dsh-lab/profiles/web` on the published tags for release validation and restart **3082**. Local iteration may use a temporary checkout, but committed manifests must not contain `link:` or Workstation-absolute paths.

No build output is copied into `~/.dsh`; production changes only through an explicit promote operation.

## Production import/export contract

At runtime: `imports(@dsh-mobile/pairing Host lib) ⊆ exports(@dsh-mobile/e2e-tunnel published tag)`.

The test is `test/published-e2e-contract.test.mjs` in the pairing checkout. It parses built Host imports and the selected published `e2e-tunnel/lib/index.js` exports without executing dependencies.

Old-tag audit:

~~~sh
DSH_E2E_TUNNEL_MODULE=/path/to/v0.1.0/lib/index.js node --test test/published-e2e-contract.test.mjs
~~~

That command must fail while the Host imports a symbol absent from v0.1.0; the same command pointed at the v0.1.5 build must pass.

## Source of truth

- `dsh-mobile-pairing` is the only source of truth for `@dsh-mobile/pairing`.
- `dsh-mobile` consumes the published package via an immutable tarball (`MOBILE_PAIRING_TARBALL`) and its expected lowercase SHA-256 digest (`MOBILE_PAIRING_SHA256`) for release verification; it does not maintain a second source mirror or sibling fallback.
- Verify the packed artifact with `npm run verify:packed` in the pairing checkout and `npm run verify:pairing` / `npm run verify:clean-alpha4-mobile-matrix` in `dsh-mobile` using the same immutable input and digest. Strict verification requires both variables, checks the digest before reading the tarball, and rechecks it after use. No `link:` or Workstation-absolute paths appear in committed manifests or docs.

```sh
MOBILE_PAIRING_TARBALL=/path/to/pairing.tgz \
MOBILE_PAIRING_SHA256=$(sha256sum /path/to/pairing.tgz | cut -d' ' -f1) \
npm run verify:pairing
```

- Local iteration may use an explicit `MOBILE_PAIRING_ROOT` with `npm run verify:pairing:dev` or `npm run verify:clean-alpha4-mobile-matrix:dev`; that path prints that its locally packed result is not release evidence and is never called by `verify:release`.

## Official baseline

Compatibility checks inspect the pinned official **dsh-v0.1.2-alpha.4** provenance checkout (`4e84901e6471b79ec0338099867ebb4606d12bb5`) via `DSH_UPSTREAM`; the tag, commit, remote, and clean worktree must match exactly. The mobile matrix copies only regular files and directories into an isolated temporary directory, skips source links, recreates ignored dependencies with offline frozen `pnpm install --ignore-scripts`, then runs `pnpm run clean` and `pnpm run build` there. It hashes the resulting regular CLI and executes only that copied CLI. Mobile owns only its own interaction-operations and ui-layout-mobile workspaces; those are packed from source inside this repository.

## Host Connection seam

The pairing Host plugin uses the official `HostConnectionHandle` from `@deepseek-ai/dsh-client-connection` (`0.1.2-alpha.4`) via a type-only import. When the Host connection capability is absent (fixtures or older compositions), the plugin logs a warning and continues without the loopback browser-session cookie; pairing and tunnels remain usable.

## 3082 acceptance

- Cold-start `DSH_HOME=~/.dsh-lab dsh web --port 3082` without import errors.
- Settings → Remote shows Relay mode UI, QR rotation, and device list.
- `/pair` carries Host Display Name metadata; sealed handshake carries the same presentation name.

3080 and `~/.dsh` are read-only unless the user explicitly requests a production promote.
