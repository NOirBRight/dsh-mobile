# Pairing / e2e-tunnel release workflow

This workflow keeps the production profile read-only while evolving the two independent published packages.

## Release order

1. **@dsh-mobile/e2e-tunnel**: run `npm test` and `npm run build` in `/home/noirbright/Workstation/dsh-e2e-tunnel`; publish/tag (current: **v0.1.2**).
2. **@dsh-mobile/pairing**: bump the published dependency to `github:NOirBRight/dsh-e2e-tunnel#v0.1.2`; run full `tsc && tsdown`, tests, and `test/published-e2e-contract.test.mjs`; publish/tag (current: **v0.1.5**).
3. **Lab validation**: keep `~/.dsh-lab/profiles/web` on `link:` to the monorepo checkout while iterating. For release validation, switch only the lab profile to the two GitHub tags and restart **3082**.

No build output is copied into `~/.dsh`; production changes only through an explicit promote operation.

## Production import/export contract

At runtime: `imports(@dsh-mobile/pairing Host lib) ⊆ exports(@dsh-mobile/e2e-tunnel published tag)`.

The test is `test/published-e2e-contract.test.mjs` in the published pairing checkout (mirrored in the monorepo lab tree). It parses built Host imports and the selected published `e2e-tunnel/lib/index.js` exports without executing dependencies.

Old-tag audit:

```sh
DSH_E2E_TUNNEL_MODULE=/path/to/v0.1.0/lib/index.js node --test test/published-e2e-contract.test.mjs
```

That command must fail while the Host imports a symbol absent from v0.1.0; the same command pointed at the v0.1.2 build must pass.

## Source of truth and synchronization

- `/home/noirbright/Workstation/dsh-mobile-pairing` is the release source of truth for the published Host package.
- `/home/noirbright/Workstation/dsh-mobile/plugins/pairing` is the monorepo lab/integration mirror. Every released Host change must be mirrored into the release checkout `src/` before tagging.
- Build both repositories from their own source with the full build command. Never synchronize by copying `lib/`.
- Before a pairing tag, compare `src/` trees, then run the contract test against the declared dependency tag.

## 3082 acceptance

- Cold-start `DSH_HOME=~/.dsh-lab dsh web --port 3082` without import errors.
- Settings → Remote shows Relay mode UI, QR rotation, and device list.
- `/pair` carries Host Display Name metadata; sealed handshake carries the same presentation name.

3080 and `~/.dsh` are read-only unless the user explicitly requests a production promote.
