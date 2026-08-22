# dsh-mobile Official Relay

This service is an untrusted, multi-user sealed-frame Relay. It forwards only
opaque binary frames between one Host and one Client in each independent random
room. It never opens NaCl frames, stores application data, serves DSH assets, or
proxies HTTP/WebSocket traffic to a Host.

- HTTP: GET /healthz
- WebSocket: /r/<32 lowercase-hex room>?role=host|client
- one Host and one Client seat per room; many rooms per Relay
- duplicate role: close 4409
- text frames: close 4400
- frame cap: 256 KiB by default
- idle empty rooms are garbage-collected; no queue or replay

Use the parameterized Docker/Caddy stack in deploy/. The same image is used for
the domestic and overseas official instances, and any operator can deploy it.
