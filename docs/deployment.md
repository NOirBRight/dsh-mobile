# Host-owned Public Endpoint deployment

DSH Mobile has no project-operated Relay, Discovery Service, TURN server, runtime CDN, or maintainer-domain dependency. One Host process owns a loopback-only Gateway; the chosen HTTPS/WebSocket Public Endpoint forwards only to that Gateway. The Gateway exposes bounded protocol routes and forwards authenticated DSH traffic only to the configured loopback DSH web port. Product UI assets ship in the Android APK; the Gateway does not serve a browser shell.

## Build and install local artifacts

```bash
npm ci
DSH_HOME="$DSH_HOME" npm run build
```

`npm run build` compiles the pairing plugin and the mobile web shell used by the Android package. It does not install a Host-side browser shell.

Build the Android package with `npm run android:sync -w @dsh-mobile/mobile-web` followed by `npm run android:debug -w @dsh-mobile/mobile-web`. The debug APK is written to `apps/mobile-web/android/app/build/outputs/apk/debug/app-debug.apk`. Release signing remains an operator responsibility.

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

For an operator-provisioned endpoint, use `endpointMode: custom` and `customEndpointUrl: https://operator.example`. The endpoint must preserve HTTPS and WebSocket upgrades for the Gateway and pass the staged identity, protocol, capability, and `/signal/check` checks. Provisioning DNS, certificates, accounts, and reverse proxies is deliberately manual.

The Host settings page is `http://127.0.0.1:3082/pair/ui` on the lab profile. It shows the current endpoint and Host Identity, produces an Android QR offer, lists authorized devices, creates room-preserving Endpoint Refresh offers, and performs Host-side revocation. The Public Endpoint itself does **not** expose `/pair`, token exchange, credential minting, generic proxy targets, or raw DSH port 3080. Do not pair or bind Gateway `:43169` on the 3080 production plane.

## Connection and lifecycle behavior

- Automatic starts the encrypted Tunnel immediately. Direct may race in a short grace window; a late Direct must not steal an already-open Tunnel. Direct Only and Tunnel Only remain per-Host Profile options.
- Authorization errors and Host Identity mismatches are terminal; they never trigger hidden fallback.
- Temporary Endpoint hostname rotation requires a new Endpoint Refresh QR. Native clients retain the existing Host Profile and device token because Host Identity, not hostname, is authoritative.
- Android secret keys, pairing codes, and device tokens stay in the Android Keystore-backed app vault. Only non-secret Host Profile metadata is stored by the WebView.

## Personal recovery surfaces

Any existing personal domains, reverse SSH paths, or VPS signaling experiments are separate operator recovery infrastructure. They are not defaults, dependencies, or product topology, and this deployment does not stop or reconfigure them.
