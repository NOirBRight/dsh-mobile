# Official sealed-frame Relay deployment

This stack runs the same opaque DSH Mobile Relay in any region. It supports many
independent rooms; each room has one Host seat and one Client seat. Frames are
forwarded as binary bytes only. The Relay never imports DSH, stores rooms, opens
NaCl frames, serves a shell, or proxies HTTP to a Host.

## Bring up one region

1. Point an owned DNS name at the VPS.
2. Copy the environment file and set the public name:

   ~~~sh
   cp .env.example .env
   # edit RELAY_HOST=relay.example.com
   docker compose up -d --build
   ~~~

3. Verify TLS and health:

   ~~~sh
   curl -fsS https://relay.example.com/healthz
   ~~~

The public WebSocket route is:

~~~text
wss://relay.example.com/r/<32-lowercase-hex-room>?role=host|client
~~~

Only binary sealed tunnel frames are accepted on the room route. Text frames,
unknown roles, and invalid rooms are rejected. A later join for the same role
replaces the previous occupant so a phone can reopen onto a live Host seat.
WebSocket ping keeps NAT mappings alive and never evicts a seated socket.
Empty rooms are garbage-collected; no frame queue or replay exists.

## Maintainer regions

- Domestic: relay.noirbright.top on ssh vps-aliyun (120.26.124.92).
- Overseas: relay-overseas.noirbright.top on ssh vps (192.3.44.244:58022).

The same image and Compose stack are used in both places. Only DNS, TLS,
region, and resource limits differ. Neither hostname is compiled into the APK;
the Host pairing profile chooses the WSS URL and includes it in the QR offer.

## Host configuration

On a Host that uses the managed Relay:

~~~yaml
endpointMode: relay
relayUrl: wss://relay.example.com
~~~

The Host opens one outbound Relay socket per authorized room. A new device gets
a fresh random room. Endpoint refresh preserves that room. Re-scanning from the
same Client Instance updates the endpoint/room authorization without creating a
second device row.

The Relay is deliberately not the Caddy+frps Custom Endpoint recipe in
deploy/self-host/; that recipe serves one operator's Host Gateway. This stack
must not be pointed at :3080 or a Host Gateway.

## Self-hosted relay checklist (same opaque behavior, no token wall)

A self-hosted Relay is no harder than the official one because it never sees
DSH credentials. To keep devices reconnecting without a rescan after a Host
restart, verify all of the following:

1. Caddy (or the edge) reverse-proxies **only** the Relay container's WSS route
   (`/r/*` and `/healthz`). Never proxy :3080/:3082, the Host Gateway, or any
   DSH web route behind the same hostname.
2. No `basic_auth`, Cloudflare Access, or HTTP login sits in front of `/r/*`:
   the phone must reach the room WebSocket with no credential exchange. The
   Room ID is the capability; a login wall would silently break reconnect
   after every Host restart.
3. Do not append `?token=` or any DSH launch token to the relay URL in the
   pairing profile; the DSH browser cookie is minted and injected by the Host
   pairing plugin on the loopback hop, never by the Relay.
4. Keep `flush_interval -1` (or equivalent) so WebSocket upgrade and binary
   frames are not buffered by the edge.
5. Host profile uses `endpointMode: relay` + `relayUrl: wss://<your-domain>`;
   after a Host restart the plugin revives campaigns for `liveRooms()` and the
   already-paired device reconnects with its Device Token — no rescan.
