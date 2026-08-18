# Direct Network Path Spike

Date: 2026-08-16

## Question

Which direct-only network paths can support DSH Mobile across heterogeneous networks without TURN or an application-data relay?

## Scope

This spike measured the existing werift configuration, a real Android 5G-to-home IPv6 connection, desktop FlClash UDP behavior, and the two-layer home IPv4 NAT. It made no production code changes. Temporary routes and NAT-PMP mappings were removed immediately after each probe.

## Werift capability

werift 0.24.4 already exposes the required configuration:

- `iceUseIpv4` defaults to `true`.
- `iceUseIpv6` defaults to `true`.
- `icePortRange` supports a deterministic UDP range.
- `iceInterfaceAddresses` and `iceAdditionalHostAddresses` can constrain or supplement candidate gathering.

The current pairing implementation relies on the dual-stack defaults but does not expose the deterministic port range or interface policy.

## IPv6 result

A fresh physical-device test succeeded end to end:

- Android used China Telecom 5G global IPv6 (`240e:46c:…`).
- The host used the delegated home prefix (`240e:b8f:…`).
- Bidirectional UDP ran directly on host interface `wlp3s0`.
- ICE checks, DTLS/SCTP, DataChannel traffic, and larger DSH tunnel frames were visible between those two global addresses.
- The Android badge reported `隧道已连接`.
- The selected path did not traverse the desktop FlClash interface or the VPS data plane.

**Verdict:** IPv6 is a proven preferred direct path, not merely a theoretical candidate.

## Desktop FlClash IPv4 result

A normal host STUN probe followed the desktop FlClash path and reported a proxy egress IPv4. The same literal STUN request, temporarily routed through the physical main table under an isolated UID, reported the actual China Telecom public IPv4 instead. The temporary policy rule was removed and verified absent.

**Verdict:** current host IPv4 WebRTC UDP is materially changed by FlClash. A production direct path needs a UDP-only DIRECT policy. Matching only the STUN hostname is insufficient because peer ICE destinations are dynamic IP/port pairs.

A temporary broad user route is not acceptable because it would bypass proxying for unrelated applications. The narrow choices are:

1. FlClash logical rule `AND,((NETWORK,UDP),(PROCESS-NAME,node)),DIRECT` as an initial deployment constraint; or
2. a uniquely named WebRTC helper process, allowing only that process's UDP to be DIRECT.

The unique helper is cleaner if the product must configure policy precisely; the Node rule is smaller and currently does not affect Codex because its observed network traffic is native-process TCP, not Node UDP.

## Home IPv4 topology

Measured path:

```text
Host 192.168.50.75
  → R7000 LAN 192.168.50.1
  → R7000 WAN 192.168.71.29
  → upstream optical modem/router
  → China Telecom public IPv4
```

The R7000 WAN address is private, so the home network currently has double NAT. A physical-route STUN probe showed a public China Telecom IPv4, indicating that the upstream edge is publicly addressed rather than carrier-grade NAT for this connection.

### Mapping capability

- R7000 NAT-PMP external-address request: pass.
- R7000 PCP announce: pass.
- Temporary R7000 UDP mapping on port 45678: create and delete both pass.
- Upstream gateway NAT-PMP: no response.
- Upstream gateway PCP: no response.
- Upstream admin endpoint from the inner LAN: not reachable in this probe.

Automatic mapping on the R7000 alone reaches only its private WAN address and is insufficient for Internet IPv4 reachability. One of these upstream changes is still required:

1. Put the optical modem in bridge mode so the R7000 receives the public IPv4; or
2. Put `192.168.71.29` in the optical modem DMZ, then map the fixed UDP range on the R7000; or
3. Forward the same UDP range on both the optical modem and R7000.

## Direction supported by evidence

Use standard dual-stack ICE and keep the data plane direct-only:

1. Gather IPv6 and IPv4 candidates concurrently; let ICE select the working pair.
2. Keep STUN-only IPv4 for compatible NAT combinations.
3. Route only the Host WebRTC UDP process DIRECT around desktop FlClash.
4. Configure a small deterministic werift `icePortRange`.
5. Use NAT-PMP/PCP on the R7000 when the upstream topology permits it, with documented manual bridge/DMZ/double-forward alternatives.
6. If no candidate pair succeeds, report `direct-unreachable`; do not fall back to VPS or Cloudflare application-data relay.

Quick Tunnel remains independent of this decision: it can temporarily provide the WSS signaling address without an owned domain, but it does not improve ICE reachability.

## IPv4-only fixed-port result

A later isolated physical-device run completed the missing IPv4-only test without modifying the live DSH process:

- The Android client used 5G IPv4 and the production signaling protocol.
- A throwaway werift Host set `iceUseIpv4: true`, `iceUseIpv6: false`, and `icePortRange: [47000, 47015]`.
- All 16 ports were temporarily mapped one-to-one through R7000 NAT-PMP.
- The isolated Host process bypassed desktop FlClash through a temporary UID route; packet capture proved STUN and ICE left the physical `wlp3s0` interface.
- STUN responses returned to the fixed Host ports successfully.
- The Host repeatedly sent ICE connectivity checks to both the phone's carrier-private and server-reflexive IPv4 candidates.
- No phone ICE packet reached the Host fixed ports, the peer remained `connecting`, and the DataChannel timed out.
- All NAT-PMP leases, routes, ACLs, fixtures, and packet-capture processes were removed afterward.

**Verdict:** R7000 fixed-port mapping plus physical UDP routing is not sufficient through the current inaccessible optical-modem NAT and this cellular NAT combination. IPv4 remains best-effort STUN for other network combinations. Reliable IPv4 here requires removing or configuring the upstream NAT, or relaxing the no-relay constraint; neither Quick Tunnel nor a different signaling server changes this result.
