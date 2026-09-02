# Host-owned Public Endpoint deployment

DSH Mobile has no Discovery Service, TURN server, runtime CDN, or maintainer-domain dependency. It supports Host-owned Public Endpoints and explicitly selected regional Official Relays. A Relay forwards only opaque binary sealed frames and never reaches a Host or port 3080. One Host process still owns a loopback-only Gateway for Quick/Custom Endpoint mode. Product UI assets ship in the Android APK; neither Gateway nor Relay serves a browser shell.

## Build and install local artifacts

```bash
npm ci
DSH_HOME="$DSH_HOME" npm run build
```

`npm run build` prepares the official checkout and compiles the mobile-owned e2e-tunnel, interaction-operations, ui-layout-mobile, and mobile web shell used by the Android package. It does not build or install the published Host Pairing package or a Host-side browser shell. The mobile shell must compile against the pinned Host-compatible client checkout selected by `DSH_UPSTREAM` (default: the repository `.dsh-upstream` checkout). The verifier requires the official `dsh-v0.1.2-alpha.4` tag and revision before building.

Install the published Pairing package separately when a Host needs the Host plugin and `dsh-pair-mux` executable:

```bash
npm install --global github:NOirBRight/dsh-mobile-pairing#v0.1.11
command -v dsh-pair-mux
```

Build the Android package with `npm run android:sync -w @dsh-mobile/mobile-web` followed by `npm run android:debug -w @dsh-mobile/mobile-web`. The debug APK is written to `apps/mobile-web/android/app/build/outputs/apk/debug/app-debug.apk`. Signed release builds use `npm run android:release -w @dsh-mobile/mobile-web`; operator keystore and `signing.properties` live under `~/.config/dsh-mobile/` (see `apps/mobile-web/android/signing.properties.example`).

Install `cloudflared` from Cloudflare's official distribution when using Temporary Endpoint mode. No Cloudflare account or provider API credential is used. Set `cloudflaredPath` explicitly when it is not on `PATH`.

## Pairing plugin configuration

Quick Tunnel is the product default:

```yaml
- id: dsh-mobile-pairing
  name: '@dsh-mobile/pairing'
  config:
    dshHost: 127.0.0.1
    dshPort: 3082
    endpointMode: quick
    gatewayBind: 127.0.0.1
    gatewayPort: 0
    cloudflaredPath: cloudflared
```

For an operator-provisioned endpoint, use `endpointMode: custom` and `customEndpointUrl: https://operator.example`. For an Official or self-hosted Relay, use `endpointMode: relay` and `relayUrl: wss://relay.example`. Relay health is checked separately and does not pretend to own a Host Identity. Custom Endpoint provisioning must preserve HTTPS and WebSocket upgrades for the Gateway and pass the staged identity, protocol, capability, and `/signal/check` checks. Provisioning DNS, certificates, accounts, and reverse proxies is deliberately manual. The maintainer-specific APK in this checkout additionally migrates the configured Host Identity `c2ChEHucjWVwG7FnAF3xqfVXuIJnvoyY2kIiJHyiWmI` from a saved Quick Tunnel to `https://pair.noirbright.top`; general builds still follow the QR offer endpoint.

The Host settings page is `/pair/ui` on whichever profile owns the plugin (`http://127.0.0.1:3080/pair/ui` for the daily profile or `http://127.0.0.1:3082/pair/ui` for lab). It shows the current endpoint and Host Identity, produces an Android QR offer, lists authorized devices, creates room-preserving Endpoint Refresh offers, and performs Host-side revocation. The Public Endpoint itself does **not** expose `/pair`, token exchange, credential minting, generic proxy targets, or raw DSH ports. If both profiles install the plugin, keep their Host identities, Gateway ports, and Public Endpoint hostnames separate.

## Connection and lifecycle behavior

- Automatic starts the encrypted Tunnel immediately. Direct may race in a short grace window; a late Direct must not steal an already-open Tunnel. Direct Only and Tunnel Only remain per-Host Profile options.
- Authorization errors and Host Identity mismatches are terminal; they never trigger hidden fallback.
- Temporary Endpoint hostname rotation requires a new Endpoint Refresh QR. Native clients retain the existing Host Profile and device token because Host Identity, not hostname, is authoritative.
- Android secret keys, pairing codes, and device tokens stay in the Android Keystore-backed app vault. Only non-secret Host Profile metadata is stored by the WebView.

## Personal recovery surfaces

Any existing personal domains, reverse SSH paths, or VPS signaling experiments are separate operator recovery infrastructure. They are not defaults, dependencies, or product topology, and this deployment does not stop or reconfigure them.
