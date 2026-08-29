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

The URL is a capability minted by the Host. The Relay does not receive the
pairing code. A later join for the same role replaces the previous occupant
(the previous socket is closed 4409) so a phone can reopen without waiting
for a zombie TCP session to die. Public deployments additionally enforce
connection, room, byte, and backpressure limits.

## Frames

The only accepted room payload is a WebSocket binary message. The Relay copies
its bytes and ordering to the opposite seat without parsing or logging them.
Peers keep legacy sealed frames through 256 KiB raw and split larger sealed frames
into marked sub-256 KiB messages; reassembly is end-to-end and invisible to the
Relay. Messages are dropped when the opposite seat is absent. There is no
buffering, storage, replay, or migration between rooms.

Text frames, unknown roles, and malformed room paths are rejected. Duplicate
seats are not denied: the latest join sits. WebSocket ping keeps NAT mappings
alive and never evicts a seated socket. The current default frame cap is
256 KiB, with per-connection byte budgets and bounded global room/connection
counts.

## Deployment boundary

The Relay image contains only the broker. It must not import the pairing plugin,
NaCl implementation, DSH client, frps, frpc, or any Host upstream. Caddy
terminates TLS and reverse-proxies only to the private Relay container. See
the Docker deployment README in deploy/.
