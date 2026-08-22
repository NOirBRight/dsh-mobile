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
unknown roles, invalid rooms, and a second occupant for the same role are
rejected. Empty rooms are garbage-collected; no frame queue or replay exists.

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
