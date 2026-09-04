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

The package is independently installable as a Host Client plugin and is also bundled locally by the signed [dsh-mobile v1.1.6](https://github.com/NOirBRight/dsh-mobile/releases/tag/v1.1.6) APK. It owns input, popup, and surface interaction adapters only; it does not own provider settings, business mutations, or the mobile root layout.

Latest (version-free):

```sh
dsh plugin --profile web add --force https://github.com/NOirBRight/dsh-mobile/releases/latest/download/dsh-mobile-interaction-operations.tgz
```

Fixed version:

```sh
dsh plugin --profile web add --force https://github.com/NOirBRight/dsh-mobile/releases/download/v1.1.6/dsh-mobile-interaction-operations.tgz
```

Update with the Latest command. Verify with `dsh plugin --profile web list` and `dsh plugin --profile web doctor`; uninstall with `dsh plugin --profile web remove @dsh-mobile/interaction-operations`. The package targets DeepSeek Harness `0.1.2-alpha.4` and has no sibling-repository, `link:`, `workspace:`, or absolute-path dependency. Release bytes and checksums are emitted with the Alpha.4 mobile release. Roll back by rerunning the fixed command, then restart the Web service once after verifying the profile.
