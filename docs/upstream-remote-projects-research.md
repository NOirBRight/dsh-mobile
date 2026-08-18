# Upstream remote-project source research

## Scope and method

This note analyzes the source trees—not merely project descriptions—of the three named repositories at these immutable revisions. Default-branch HEADs were resolved through GitHub’s first-party repository/commit APIs on 2026-08-16:

| Repository | Revision reviewed |
|---|---|
| `Blank-not-black/dsh-Remote` | [`45d59a92707f50a0bf26d53b3cfc53c815c21a77`](https://github.com/Blank-not-black/dsh-Remote/tree/45d59a92707f50a0bf26d53b3cfc53c815c21a77) |
| `BotonJ/dsh-remote-link` | [`baf93d29b1fb2c9dc18770e07aacc6a385f7a29b`](https://github.com/BotonJ/dsh-remote-link/tree/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b) |
| `godchen520/dsh-web-remote` | [`16a32ce23067c4917185095b1bf7459f242c3132`](https://github.com/godchen520/dsh-web-remote/tree/16a32ce23067c4917185095b1bf7459f242c3132) |

“Data relay” below means a network intermediary that carries DSH UI, RPC, event, or file bytes. A host-local adapter between a WebRTC DataChannel and the loopback-only DSH server is still a proxy in implementation terms, but is not a third-party network data relay. Signaling-only infrastructure is likewise distinct from an application-data relay.

## Bottom line

None of the three projects implements WebRTC, ICE, STUN, TURN, NAT hole punching, SDP signaling, or a DataChannel. All three instead expose a host-side HTTP/WebSocket reverse proxy. Therefore none is a direct implementation match for a **no-TURN/no-application-data-relay WebRTC** architecture.

Their remote-access strategies differ materially:

- **`dsh-Remote`** expects ordinary IP reachability to a host gateway: same-LAN addressing or a user-supplied Tailscale address. It has the strongest mobile package and reconnect logic, but its bearer capability is long-lived and copied into URLs/QR data.
- **`dsh-remote-link`** is primarily an authenticated LAN gateway. It contains optional operator scripts for Cloudflare named Tunnel and localtunnel, but the plugin does not perform NAT traversal itself. Its one-time HMAC pairing and per-device revocation are the best authentication ideas to reuse.
- **`dsh-web-remote`** automatically starts a Cloudflare Quick Tunnel. That avoids inbound NAT configuration precisely by putting all public DSH HTTP/WebSocket traffic through Cloudflare. This directly conflicts with a no-data-relay requirement.

Two first-party infrastructure facts remove any ambiguity about those dependencies:

- [Tailscale documents](https://tailscale.com/kb/1257/connection-types) direct UDP, DERP-relayed, and peer-relayed connection types, with relaying used when direct connectivity is unavailable. All remain WireGuard end-to-end encrypted, so Tailscale relay is a privacy-preserving compatibility option—but it still violates a literal no-data-relay policy and the reviewed app does not enforce direct-only operation.
- [Cloudflare documents](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) that a Quick Tunnel creates a random `trycloudflare.com` subdomain and proxies requests through Cloudflare to the localhost web server. It is therefore a full data proxy unless the localhost origin itself exposes only a bounded signaling protocol.

## Comparative topology

| Project | Exact public/mobile path | Does a third party carry app data? | NAT behavior | Host reverse proxy? |
|---|---|---|---|---|
| `dsh-Remote` | Phone app/browser → LAN IP or configured Tailscale IP → `gateway.js:8787` → DSH `127.0.0.1:3080`; files terminate at `gateway.js /fs/*` | Not in the repository’s LAN path. Tailscale is delegated reachability; this source does not prove or enforce a direct, non-relayed overlay path. | No discovery beyond enumerating host IPv4 addresses; no port mapping, punching, or ICE. Same LAN or external overlay/routing must make TCP reachable. | Yes: API HTTP and WebSocket traffic is relayed by the host gateway. |
| `dsh-remote-link` | Phone browser → `0.0.0.0:3081` gateway → complete official UI/API/WS on loopback DSH | No for LAN. Yes when the included Cloudflare/localtunnel operator scripts are used: the tunnel provider is on the data path. No VPS implementation is included. | LAN/mDNS only in the plugin. Optional outbound tunnels bypass inbound NAT by relaying traffic. | Yes: the complete official DSH web surface is proxied. |
| `dsh-web-remote` | Phone browser → `https://*.trycloudflare.com` → Cloudflare Quick Tunnel/`cloudflared` → host HTTP proxy → DSH `127.0.0.1:3080` | **Yes, always for its public mode.** Cloudflare carries UI, API, and WebSocket bytes. LAN mode is direct to the host proxy. No VPS is involved in the repository. | The outbound Cloudflare tunnel sidesteps CGNAT/NAT and requires no inbound mapping; it is not peer-to-peer traversal. LAN mode still requires local TCP reachability. | Yes, before both the LAN listener and Cloudflare tunnel origin. |

## 1. Blank-not-black/dsh-Remote

### Traffic topology and relay boundary

The gateway binds to `0.0.0.0:8787` by default and targets `http://127.0.0.1:3080`; it serves its own mobile static UI, proxies `/api/*`, upgrades event WebSockets, and implements `/fs/*` itself ([gateway constants and role](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L1-L38), [HTTP proxy](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L1217-L1269), [routing and WebSocket proxy](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L1289-L1398)). Thus, even on a direct LAN link, the phone never talks directly to DSH: the host gateway is an authenticated protocol adapter/reverse proxy.

The documented remote choices are LAN TCP and Tailscale; the app can keep several ordinary `http(s)://host:port` addresses and select the fastest ([connection instructions](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/README.md#L40-L47), [remote-access recommendation](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/README.md#L109-L114), [selection code](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/public/app.js#L180-L219)). There is no repository code for NAT mapping or hole punching. Treat Tailscale here as an external routing dependency, not evidence that the resulting data path is always non-relayed.

No Cloudflare or VPS data path is implemented. The only configurable generic HTTP proxy in `gateway.js` is for its GitHub update check, not DSH application traffic ([update-check proxy code](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L268-L348)). The README’s statement that the gateway “does not persist business data” should be read narrowly: `/fs/*` deliberately writes uploads/partial files, while token and device-note state are also persisted and the mobile app caches viewed history ([file dispatch](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L1162-L1215), [README claim](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/README.md#L166-L167)).

### Authentication

- A 24-byte random base64url bearer token is loaded from the environment or persistent `~/.dsh-remote/token`, created with mode `0600` if absent. Authorization accepts either `Authorization: Bearer` or `?token=`; comparison is a direct JavaScript string equality ([token creation and check](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L131-L172)).
- The same bearer guards API HTTP, API WebSocket upgrades, file operations, and admin APIs; static UI and `/health` remain reachable ([route gates](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L1217-L1233), [upgrade gate](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L1319-L1340)).
- Pairing is capability transfer, not a one-time protocol: the QR embeds the reusable token and server address. The app writes that token to local storage; a token initially received in the page query is removed from the visible URL with `history.replaceState`, but it remains the long-lived credential ([local QR construction](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/public/admin.js#L151-L174), [app import/storage](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/public/app.js#L1686-L1705), [query cleanup](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/public/app.js#L1752-L1763)).
- Rotation is global rather than per-device. It changes the file token and forcibly closes non-admin sockets, invalidating every existing client ([rotation path](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/gateway.js#L484-L504)). Device tracking is IP-based, so it is monitoring/kicking rather than cryptographic device identity.

### Reconnect and availability

This project has explicit client recovery: each event stream reconnects after 1.2 seconds; repeated failures trigger endpoint remeasurement; foreground resume and a 15-second watchdog reopen missing streams; endpoints are remeasured every five minutes ([WebSocket lifecycle](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/public/app.js#L276-L323), [resume/watchdogs](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/public/app.js#L341-L358)). The gateway token persists across restarts, and the plugin also documents gateway process self-healing ([persistence/autostart behavior](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/README.md#L30-L38)).

### Mobile packaging

This is the only repository of the three with an installable mobile application. It wraps `public/` using Capacitor, builds an Android APK with Gradle, and includes Capacitor Android, App, barcode-scanning, and local-notification dependencies; no iOS project is present in the pinned tree ([build/dependencies](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/package.json#L19-L40), [Capacitor config](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/capacitor.config.json#L1-L7)). Android explicitly permits cleartext HTTP, registers the `dshremote://pair` deep link, and requests Internet, camera, and package-install permissions ([manifest](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/android/app/src/main/AndroidManifest.xml#L4-L55)).

### Reuse versus conflict

**Reuse:** Capacitor packaging, deep-link/QR enrollment plumbing, local QR generation, foreground recovery, multi-endpoint health selection, resumable file-transfer framing, and the host-local API/WS header-sanitizing proxy are practical source patterns.

**Do not reuse unchanged:** the reusable bearer in URL/QR/localStorage, IP-based “device” identity, cleartext LAN HTTP, and global token rotation are weaker than device-bound credentials. Its TCP/Tailscale topology does not establish a WebRTC direct path and cannot enforce the no-data-relay property.

## 2. BotonJ/dsh-remote-link

### Traffic topology and relay boundary

The plugin binds an authenticated gateway (default `0.0.0.0:3081`) and proxies the full official Web UI, RPC, and event WebSocket surface to the loopback DSH server ([plugin topology](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/index.js#L1-L18), [target and listener](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/index.js#L49-L60), [startup](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/index.js#L152-L181)). Its proxy rewrites `Host`, strips public `Origin`/`Referer`, removes hop-by-hop headers, and pipes both HTTP bodies and upgraded WebSockets bidirectionally ([proxy implementation](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/proxy.js#L1-L87)).

The normal mode is LAN access, helped by mDNS advertisement; no NAT mapping or peer negotiation exists ([mDNS setup](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/index.js#L129-L149)). Its troubleshooting guide explicitly acknowledges that NAT/CGNAT prevents cellular direct access ([NAT limitation](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/docs/TROUBLESHOOTING.md#L109-L114)). `publicUrl` only changes URLs encoded in pairing material; it does not create connectivity ([public URL config](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/config.js#L65-L73)).

Two repository scripts can put a relay in front of the gateway: one runs a Cloudflare named tunnel forever and one supervises localtunnel on port 3081 ([Cloudflare script](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/scripts/cf-tunnel.sh#L1-L9), [localtunnel script](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/scripts/tunnel-keepalive.sh#L1-L10)). When either is used, all official UI/API/WS application data passes through that provider. These are operator scripts, not an integrated plugin mode, and there is no VPS server implementation in the repository.

### Authentication

This is the strongest design of the three:

1. A QR contains `/pair#p=sid.secret`, keeping the secret in the URL fragment. The phone requests a one-use nonce and returns `HMAC-SHA256(secret, sid|nonce|ts)`; successful verification sets an HttpOnly, SameSite=Strict cookie ([flow summary](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/README.md#L5-L15), [pairing routes/cookie](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/gateway.js#L65-L131)).
2. Pairings expire after five minutes by default, challenges after 60 seconds, timestamps have a ±300-second window, the nonce is burned on every attempt, and the pairing is deleted after success ([pairing state and challenge](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/pairing.js#L55-L123), [verification](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/pairing.js#L125-L173)).
3. The device registry persists with mode `0600`, while session tokens are held only as SHA-256-indexed in-memory entries. Device revocation deletes its sessions immediately ([storage model](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/pairing.js#L1-L14), [resolution and revocation](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/pairing.js#L176-L225)). Consequently, a gateway restart invalidates all cookies even though registered-device records remain; the advertised 30 days is a maximum for a continuously running process, not durable login.
4. Optional Basic authentication uses timing-safe hashed comparison. Cookie authentication is what makes official browser WebSocket upgrades work without custom headers ([auth implementation](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/auth.js#L1-L74)). Requests and upgrades pass the same auth, rate-limit, and failed-login ban gates ([gateway gates](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/gateway.js#L134-L175)).

A security limitation is explicit in code: the session cookie lacks `Secure`, because the baseline LAN page is HTTP ([cookie construction](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/gateway.js#L123-L127)). A LAN sniffer can therefore capture it. Also note a documentation inconsistency: README line 21 still describes a `?token=` route, while current `auth.js` and `index.js` explicitly say that bypass was removed. The code is authoritative ([README statement](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/README.md#L17-L22), [source statement](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/auth.js#L1-L7)). The pending design document’s “SID numeric projection” description of the six-digit short code is stale too; current code derives it with HMAC ([design text](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/docs/PAIRING-DESIGN.md#L70-L72), [implementation](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/pairing.js#L96-L99)).

### Reconnect and mobile packaging

The plugin owns no mobile client and therefore no client reconnect loop; it depends on the official DSH web client. Its reverse proxy closes paired sockets on error rather than resuming them ([WebSocket teardown](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/proxy.js#L55-L87)). The optional tunnel scripts do restart their tunnel processes after two or three seconds, but this is transport-process supervision rather than session resumption. Because rate limiting keys only `req.socket.remoteAddress`, tunneled users can collapse onto the tunnel’s source address and share one rate-limit/ban identity ([client IP extraction](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/src/gateway.js#L20-L26)). Mobile delivery is a normal browser viewing the official UI; the npm package contains only `src`, patch metadata, README, and license—no Android/iOS wrapper ([package files](https://github.com/BotonJ/dsh-remote-link/blob/baf93d29b1fb2c9dc18770e07aacc6a385f7a29b/package.json#L1-L26)).

### Reuse versus conflict

**Reuse:** one-time fragment-secret pairing, nonce burning, proof time windows, separate pairing/session secrets, per-device registry/revocation, tight pairing rate limits, mDNS discovery, and a mandatory-auth configuration guard are strong patterns. The host-local full-surface proxy is also a useful reference for adapting DataChannel frames to DSH loopback HTTP/WS.

**Adapt rather than copy:** cookie sessions are browser-transport-specific. For WebRTC, bind the enrolled device identity to authenticated signaling and the negotiated DTLS peer/fingerprint or an application handshake over the DataChannel. Persist only revocable credential verifiers if restart-surviving enrollment is required.

**Conflict:** Cloudflare named Tunnel and localtunnel carry application data and therefore violate no-data-relay. The LAN TCP gateway provides no NAT traversal. Stripping Origin/Referer is needed for this reverse proxy but should not become a substitute for explicit end-to-end authorization.

## 3. godchen520/dsh-web-remote

### Traffic topology and NAT behavior

The plugin starts an HTTP and self-signed-HTTPS reverse proxy on `0.0.0.0`; both forward to DSH at `127.0.0.1:targetPort`, including WebSocket upgrades ([proxy construction and listeners](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L160-L225), [HTTP/WS forwarding](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L226-L341)). Text/JSON/JavaScript responses may be gzip-compressed at this proxy.

It then runs:

`cloudflared tunnel --url http://127.0.0.1:<proxy-port> --no-autoupdate`

and extracts the generated `https://*.trycloudflare.com` URL ([tunnel startup](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L886-L917)). Therefore its public topology is unambiguously **phone ↔ Cloudflare ↔ cloudflared ↔ local reverse proxy ↔ DSH**. It solves NAT/CGNAT by an outbound relay tunnel, not direct NAT traversal. Cloudflare carries all public UI, RPC, and event WebSocket data. No VPS component appears in the source.

### Authentication and exposure

- Each proxy start generates an 18-byte random base64url token. A matching query token is converted via 302 into a one-day `dshr_token` cookie marked HttpOnly and SameSite=Lax, but not Secure ([token/auth and cookie](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L162-L205), [redirect](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L232-L251)). WebSockets pass the same auth check ([upgrade gate](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L274-L295)).
- With the default `lanOpen: true`, a non-loopback RFC1918 source bypasses token authentication. The code deliberately excludes loopback because cloudflared arrives locally, so public tunnel traffic still needs the token ([LAN bypass logic](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L168-L204)). This is network-location trust, not device authentication.
- A serious capability-disclosure issue is present: the panel builds a QR target containing the full public URL and token, then sends that string to one of two external QR-image APIs in the image URL ([external QR providers](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L541-L548), [token-bearing QR request](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L634-L653)). Those QR services receive the bearer capability. QQ mode likewise sends the full URL/token through chat when asked for a link ([QQ reply](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L427-L431)). Do not reuse this; generate QR codes locally and avoid transporting durable capabilities through third-party messaging.
- Restart creates a new token and Quick Tunnel URL, invalidating the old link/cookie ([state/start](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L870-L899)).

### Reconnect and mobile packaging

When `cloudflared` exits, the plugin clears the URL and tells the user to stop and start again; it does not automatically respawn or resume the tunnel ([exit handling](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L919-L927)). Manual renewal tears down and recreates proxy/tunnel state, changing the token and public URL ([control flow](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L953-L972)). There is no repository-owned browser event reconnect algorithm beyond whatever the official DSH UI supplies. This is a DSH plugin/browser experience, not a native mobile app; package contents are only the bundled JS, patch, and docs ([package manifest](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/package.json#L1-L32)).

### Reuse versus conflict

**Reuse selectively:** automatic listener lifecycle, free-port selection, HTTP/WS integration tests, tunnel-process state reporting, and local self-signed TLS are useful operational references. If a deployment permits signaling via Cloudflare, the process-management pattern could be repurposed for **signaling only**, with a hard protocol boundary that cannot carry DSH payloads.

**Conflict:** the principal public topology is exactly an application-data relay. Tokenized URL capability sharing, default LAN auth bypass, non-Secure cookie, externally generated QR codes, and manual tunnel recovery are unsuitable security/reliability defaults for the target design. Its cloudflared bootstrap is also unsafe to copy as-is: macOS selects a `.tgz` but the shown download path does not extract it, HTTPS certificate verification is disabled, and downloaded executables have no checksum/signature verification ([download implementation](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/lib/index.mjs#L476-L535)).

## Recommended source reuse for dsh-mobile

### High-value ideas to carry forward

1. **Host-local DSH adapter:** borrow hop-by-hop header filtering, Host rewriting, HTTP body streaming, and bidirectional WebSocket plumbing from `dsh-remote-link`. Put this adapter behind the DataChannel, not on an Internet listener.
2. **Enrollment:** use `dsh-remote-link`’s one-time fragment secret, HMAC challenge, single-use nonce, expiration, rate limit, device registry, and per-device revoke model. Bind the resulting device to signaling and the WebRTC peer rather than issuing only a browser cookie.
3. **Native shell:** use `dsh-Remote`’s Capacitor/Android structure, scanner/deep link, local notifications, foreground recovery, and local QR generation. Do not carry forward cleartext permission as the normal public transport assumption.
4. **Reconnect state machine:** adapt `dsh-Remote`’s visibility recovery and watchdogs, but make recovery WebRTC-aware: reconnect signaling, perform ICE restart/new offer, recreate DataChannels, reauthenticate the device, then resubscribe to DSH streams. A fixed 1.2-second loop should become bounded exponential backoff with jitter.
5. **Discovery and candidates:** mDNS/LAN addresses can be useful direct candidates. Health checks should measure only policy-allowed direct paths and must never silently fail over to a data relay.
6. **Lifecycle observability:** retain explicit states for host adapter, signaling, peer connection, channel, DSH subscriptions, and last failure. `dsh-web-remote`’s prompt invalidation of dead URLs is better than displaying stale connectivity.

### Architectural conflicts to reject

- **Cloudflare Quick/Named Tunnel or localtunnel as the DSH transport:** these relay application bytes.
- **A VPS reverse proxy for DSH HTTP/WS:** also a data relay. A VPS/Cloudflare endpoint is compatible only if it carries bounded signaling messages and cannot accept DataChannel payloads.
- **TURN fallback:** directly violates the stated target. The product must expose “direct path unavailable” instead of silently relaying.
- **Assuming outbound connectivity equals P2P NAT traversal:** all three upstreams use reachable TCP listeners or outbound tunnels; none answers symmetric-NAT/CGNAT peer connectivity without relay.
- **URL bearer as device identity:** URLs leak through history, logs, screenshots, chat, and—as `dsh-web-remote` demonstrates—QR providers. Use short-lived pairing material and revocable device credentials.
- **Network-location authentication:** RFC1918 source checks and IP-based device tracking are not identities.

## Evidence boundaries

- `dsh-remote-link`’s Cloudflare ingress configuration is user-local and absent from the repository, so only the client-side named-tunnel invocation is verifiable here.
- Official DSH UI reconnect behavior is outside `dsh-remote-link` and `dsh-web-remote`; this report does not attribute upstream UI behavior to those plugins.
- None of the repositories supplies NAT success-rate measurements or a candidate-pair audit proving a direct path. External Tailscale, Cloudflare, and localtunnel privacy/TLS properties are not implemented or tested by these source trees.

## Local verification

- `dsh-remote-link`: `node --test test/*.test.js` passed **87/87** tests at the reviewed revision, including pairing replay/expiry, device revocation, rate limiting, HTTP proxy, and WebSocket upgrade paths.
- `dsh-web-remote`: its advertised `node test/test-dist.mjs` did not reach the proxy assertions on this Linux checkout because the fixture writes certificates to the hard-coded Windows path `E:/DeepSeek Harness/.dsh/tools/` ([fixture source](https://github.com/godchen520/dsh-web-remote/blob/16a32ce23067c4917185095b1bf7459f242c3132/test/test-dist.mjs#L34-L41)). Treat its integration coverage as non-portable in the reviewed snapshot.
- `dsh-Remote`: the root package provides syntax-check/build/release scripts but no automated test script ([package scripts](https://github.com/Blank-not-black/dsh-Remote/blob/45d59a92707f50a0bf26d53b3cfc53c815c21a77/package.json#L19-L28)).

## Practical fit verdict

| Upstream | Reuse level | Verdict for no-TURN/no-data-relay WebRTC |
|---|---|---|
| `dsh-Remote` | **High for mobile UX/package and reconnect; medium for host adapter** | Keep client shell and recovery concepts; replace transport and bearer enrollment. |
| `dsh-remote-link` | **High for authentication; high for host-local proxy mechanics** | Best security reference. Adapt identity to WebRTC and omit tunnel scripts from the data plane. |
| `dsh-web-remote` | **Low to medium for lifecycle/testing only** | Public mode is fundamentally incompatible because Cloudflare is the data path. Do not copy QR/auth defaults. |

The central implementation seam should therefore be: **native/web mobile UI ↔ direct WebRTC DataChannel ↔ host-local authenticated adapter ↔ loopback DSH**, with any Cloudflare/VPS service restricted to signaling. If ICE cannot establish a direct candidate pair without TURN, fail closed and explain the NAT limitation rather than switching topology.
