# @dsh-mobile/interaction-operations

Independent DSH client plugin that normalizes mobile/coarse-pointer input into presentation-only Interaction Intents. It does not patch DSH core and does not own Host feature mutations.

The Android Product Client packages this client bundle into its local boot roster on both narrow and wide surfaces. The same package can be published and installed as a normal DSH plugin; it is inert on the Host and contributes only its `dsh.client` browser half.

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
