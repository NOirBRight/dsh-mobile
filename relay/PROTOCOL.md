# DSH Mobile sealed Relay protocol v1

## Trust boundary

The Relay is an untrusted byte broker. It sees the room identifier, connection
metadata, timing, sizes, and ciphertext, but it has no Host private key, device
token, DSH route, or application plaintext. The Host and Client perform the
existing NaCl hello/ack and sequence checks after joining the room.

## Connection

~~~text
wss://relay.example.com/r/<roomId>?role=host|client
~~~

roomId is exactly 16 random bytes encoded as 32 lowercase hexadecimal
characters. Each room has one host seat and one client seat. A Relay can
serve many rooms concurrently; unrelated rooms never share frames.

The URL is a short-lived capability minted by the Host. The Relay does not
receive the pairing code. A guessed room can only cause occupancy denial, so
public deployments additionally enforce connection, room, byte, and backpressure
limits.

## Frames

The only accepted room payload is a WebSocket binary frame. The Relay copies
its bytes and ordering to the opposite seat without parsing or logging them.
Frames are dropped when the opposite seat is absent. There is no buffering,
storage, replay, or migration between rooms.

Text frames, unknown roles, malformed room paths, and duplicate seats are
rejected. The current default frame cap is 256 KiB, with per-connection byte
budgets and bounded global room/connection counts.

## Deployment boundary

The Relay image contains only the broker. It must not import the pairing plugin,
NaCl implementation, DSH client, frps, frpc, or any Host upstream. Caddy
terminates TLS and reverse-proxies only to the private Relay container. See
the Docker deployment README in deploy/.
