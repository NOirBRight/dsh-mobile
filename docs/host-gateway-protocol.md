# Host Gateway protocol foundation

The pairing plugin owns a standalone HTTP/WebSocket listener bound only to loopback. The current injected `webServer` service exposes request routes but not upgrade/static-asset ownership, so it is used only for local desktop administration. `cloudflared` or an operator-managed HTTPS reverse proxy targets the dedicated Gateway listener. Raw DSH port 3080 is never a Public Endpoint target.

## Endpoint modes

- `endpointMode: quick` is the product default. After the loopback Gateway listens, the plugin starts `cloudflared tunnel --url http://<loopback>:<port> --no-autoupdate`. Pairing remains unavailable until a `https://*.trycloudflare.com` URL is observed. URL changes are reported as rotation and new offers advertise the new endpoint.
- `endpointMode: custom` requires `customEndpointUrl`. The URL must be HTTPS and contain no credentials. Provisioning DNS, TLS, tunnels, or provider accounts remains operator-owned.
- There is no maintainer domain, outbound signaling service, Discovery Service, TURN service, or project-operated application-data relay in the default path. The old relay connector remains an API compatibility export only.

## Logical HTTP surfaces (protocol 1)

| Method and path | Purpose | Authentication |
| --- | --- | --- |
| `GET /.well-known/dsh-mobile` | Host Identity, protocol and capabilities | Public |
| `GET /healthz`, `GET /capabilities` | Equivalent logical health/capability seam | Public |
| `GET /<packaged asset>` | Serve browser-shell files from the configured package directory | Public |
| `GET /plugins/<id>/…` | Bounded loopback fetch of Host plugin client bundles for the browser shell | Public |

The Public Gateway deliberately has no HTTP route that mints offers, exchanges codes, or accepts bearer device tokens. The loopback-only Host administration route mints QR offers and authorizes their rooms. Android and browser clients claim the code inside the encrypted WebRTC/WebSocket session. Endpoint Refresh is a rescan of a new signed offer for a known Host Identity; native code upserts the existing Profile and reuses its vaulted authorization.

Unknown routes are 404. Asset paths reject traversal, URL-shaped paths, and backslashes. The Gateway has no target URL parameter and no generic HTTP/TCP proxy operation.

## WebSocket surfaces

- `/signal/<room>` accepts text WebRTC signaling envelopes. On a successful RTCDataChannel, the existing `HostFrameTransport` handshake/session bridge connects to the fixed loopback DSH authority.
- `/tunnel/<room>` accepts encrypted binary tunnel frames and attaches the same handshake/session bridge.
- `/signal/check` is an upgrade-only compatibility check used while validating Custom Endpoints; it carries no signaling or application data.

Only 128-bit rooms minted by this Gateway or restored from authorized devices are accepted. A room accepts one live socket per route (`/signal` or `/tunnel`); a second upgrade on the same route receives 409 until that occupant closes. Signal and tunnel may be open together so Automatic can fall back without waiting for the signaling socket to die. WebSocket payloads are bounded. Tunnel requests can address ordinary DSH application paths inside the authenticated encrypted session, but cannot select another host or port and cannot reach Host administration routes under `/pair`.

## Custom Endpoint staged checks

`checkCustomEndpoint` uses injected fetch and WebSocket adapters and reports a precise failing stage: endpoint syntax, TLS/HTTP reachability, Host Identity, protocol, capabilities, or WebSocket upgrade. Unit tests use offline adapters. The Host settings integration must supply production adapters and present these stage names before saving an endpoint.

## Browser shell integration

`browserShellPath` defaults to `<DSH_HOME>/mobile/browser-shell`. Packaging must place an `index.html` and immutable local assets there; the Gateway never fetches a runtime CDN. Native applications continue to use packaged native assets and the same protocol endpoint.

## Remaining application integration

Product Clients already consume v4 offers, apply Endpoint Refresh by Host Identity, and select direct versus tunnel routes. Remaining consumers of this foundation:

- Host settings save Custom Endpoint mode through `POST /pair/endpoint` after staged checks. The live selection is stored in `$DSH_HOME/mobile/public-endpoint.json` and overlays the YAML default.
- `npm run build` copies the packaged browser shell into `DSH_HOME/mobile/browser-shell` when that home is set.

These are not reasons to expose the upstream web server as a Public Endpoint.
