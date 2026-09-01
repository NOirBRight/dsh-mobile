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

This package is shipped as part of the signed [dsh-mobile v1.1.3](https://github.com/NOirBRight/dsh-mobile/releases/tag/v1.1.3) APK and matching Host release. Download https://github.com/NOirBRight/dsh-mobile/releases/download/v1.1.3/dsh-mobile.apk, verify SHA-256 from SHA256SUMS, and install the Host pairing artifact separately from the dsh-mobile-pairing release.
