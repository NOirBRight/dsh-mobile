# @dsh-mobile/interaction-operations

Independent DSH client plugin that normalizes mobile/coarse-pointer input into presentation-only Interaction Intents. It does not patch DSH core and does not own Host feature mutations.

The Android Product Client packages this client bundle into its local boot roster on both narrow and wide surfaces. The same package can be published and installed as a normal DSH plugin; it is inert on the Host and contributes only its `dsh.client` browser half.

Its popup presenter preserves the official model root's authored picker width while keeping unrelated short menus compact.

## Interface

```ts
ctx.interactionOperations.dispatch(intent)
```

The Interface resolves synchronously to `handled`, `unhandled`, or `blocked`. See [Mobile Interaction Operations](../../docs/mobile-interaction-operations.md) and [ADR 0007](../../docs/adr/0007-plugin-owned-interaction-intents.md).

## Build and test

```sh
npm run build -w @dsh-mobile/interaction-operations
npm test -w @dsh-mobile/interaction-operations
```


## Release installation

The package is independently installable as a Host Client plugin and is also bundled locally by the signed [dsh-mobile v1.1.12-015rc1e](https://github.com/NOirBRight/dsh-mobile/releases/tag/v1.1.12-015rc1e) APK. It owns input, popup, and surface interaction adapters only; it does not own provider settings, business mutations, or the mobile root layout.

Latest (version-free):

The 0.1.5-rc.1 release (`v1.1.12-015rc1e`) ships this adapter inside the APK only. Do not add it to a desktop WebUI profile.

Verify with `dsh plugin --profile web list` and `dsh plugin --profile web doctor`; uninstall with `dsh plugin --profile web remove @dsh-mobile/interaction-operations`. The package targets DeepSeek Harness `0.1.5-rc.1` and has no sibling-repository, `link:`, `workspace:`, or absolute-path dependency. Release bytes and checksums are emitted with the 0.1.5-rc.1 mobile release. Roll back by restoring the prior APK, then restart the Web service once after verifying the profile.
