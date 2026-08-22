# ADR 0006: Regional official sealed-frame Relay

- Status: Accepted
- Date: 2026-08-21
- Supersedes in part: ADR 0005 decision 2 and the no-project-relay clauses

## Context

The Host-owned Custom Endpoint remains useful for operators who control a VPS
or domain, but a published Android client also needs a reliable outbound-only
path for users behind restrictive NATs. A project-operated Relay introduces
bandwidth, abuse, availability, and regional operations costs, so it must be a
separate explicit capability rather than an invisible proxy.

The existing Host Gateway already has the correct deep session seam: a Host
adapter seals and opens DSH frames, while a carrier only transports ordered
bytes. The Relay can therefore remain zero-knowledge and independent of DSH.

## Decision

1. The project operates two official Relay instances using one parameterized
   Docker/Caddy image:
   - domestic: relay.noirbright.top on vps-aliyun;
   - overseas: relay-overseas.noirbright.top on vps.
2. endpointMode: relay is an explicit Host choice. The selected WSS base is
   carried in the QR offer; it is not silently selected by a global APK URL.
3. The Relay accepts only bounded binary frames on
   /r/<room>?role=host|client. It forwards bytes without parsing, storing, or
   logging payloads. Each random 128-bit Room has one Host seat and one Client
   seat; many unrelated Rooms may coexist.
4. The Relay contains no Host key, token store, DSH dependency, generic proxy,
   static shell, frps, frpc, or route to port 3080. NaCl handshake/session
   termination stays in the Host and Android client.
5. Operators may deploy the same Docker stack with their own WSS hostname. The
   two official regions are independent choices, not transparent HA: a Room is
   not replicated or silently moved between regions.
6. Re-scanning the same Client Instance does not create another Host device
   record. The Host preserves the device record identity, rotates/replaces the
   bearer only for an explicit new code, and updates its Room/endpoint metadata.
   The mobile Host Profile is keyed by Host Identity and normalizes a token-backed
   scanned offer to its authorized Room.
7. Pairing UI does not request or display an actual QR until the selected
   endpoint is configured and saved. Before then it displays a stable placeholder.
   The injected and standalone Host pairing screens share the same two-mode
   structure: Temporary and Relay. The old Custom Endpoint form remains only as
   a compatibility path for existing operator overlays.

## Consequences

- Official Relay deployment becomes a real product responsibility with explicit
  per-instance quotas and operational monitoring.
- Relay traffic is end-to-end encrypted, but Relay operators still see network
  metadata and ciphertext sizes; the UI and deployment docs disclose this.
- Users can continue using Quick; existing Custom Endpoint overlays remain compatible but are not a current GUI choice.
- The old signaling-only assumption is removed from the Relay package; direct
  WebRTC signaling and Host Gateway routes remain separately bounded.
- The project can later add region preference or failover only through a new
  decision, because current Host Profiles store one selected Relay URL.
