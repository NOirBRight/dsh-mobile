# Remote P2P Pairing Without a Relay: Feasibility

## 1. Current architecture

The QR flow is **not serverless**. Android and Host join a WSS room that carries only bounded SDP envelopes; authentication and application traffic then use a reliable, ordered `RTCDataChannel` directly between peers ([project overview](../README.md), [pairing flow](https://github.com/NOirBRight/dsh-mobile-pairing#readme), [deployment contract](deployment.md)). The client gathers ICE candidates non-trickle, sends an offer over WSS, waits for an answer, keeps WSS open for possible renegotiation/ICE restart, and reports ICE failure rather than retrying through a relay ([client signaling](../packages/e2e-tunnel/src/signal.ts)). The Host accepts only `stun:` URLs and explicitly throws for TURN/TURNS; therefore no TURN candidate or application-data fallback can exist ([Host implementation](https://github.com/NOirBRight/dsh-mobile-pairing/blob/master/src/webrtc-host.ts)). This matches WebRTC's model: signaling is application-provided, while `RTCPeerConnection` may send arbitrary data to a remote peer ([WebRTC §4.1](https://www.w3.org/TR/webrtc/#peer-to-peer-connections)).

**Verdict:** it can work remotely **without an application-data relay** on compatible networks, but the current design cannot work remotely **without any servers** because it depends on WSS rendezvous and a STUN service.

## 2. TryCloudflare is not a serverless production answer

A Quick Tunnel runs `cloudflared`, creates a random `trycloudflare.com` hostname, and proxies requests through Cloudflare to localhost. Cloudflare labels it testing/development only, gives no SLA or uptime guarantee, caps it at 200 in-flight requests, and does not support SSE ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)). It could temporarily expose a local signaling service if the generated URL were supplied to both peers, but it is still a Cloudflare-dependent proxy, its random URL complicates reconnect, and it does not supply an ICE UDP path or TURN capability. A managed Cloudflare Tunnel is more stable, but `cloudflared` still makes outbound connections to Cloudflare and bidirectional traffic traverses Cloudflare's network ([Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)). Thus neither option proves direct peer reachability; Quick Tunnels should be limited to development experiments.

## 3. Three distinct server/relay concepts

The goals are not equivalent: **no data relay** permits signaling and STUN infrastructure; **no self-hosted server** can still depend on public Cloudflare/WSS/STUN/TURN services; **no public infrastructure** permits neither and therefore requires nearby/manual signaling plus a directly reachable network path.

1. **Signaling/rendezvous:** WSS introduces peers and exchanges SDP/ICE information. WebRTC deliberately leaves this channel unspecified and commonly expects an application/server channel ([WebRTC §4.1](https://www.w3.org/TR/webrtc/#peer-to-peer-connections)). It carries control data here, not tunnel payload.
2. **NAT-traversal discovery/coordination:** ICE gathers candidate addresses and runs connectivity checks; STUN supplies server-reflexive candidates revealing a NAT mapping ([ICE overview and candidate gathering](https://www.rfc-editor.org/rfc/rfc8445.html#section-2)). STUN is a server dependency but is not the selected application-data relay.
3. **Traffic relay/proxy:** TURN allocates a relayed transport address and relays packets when direct candidate pairs do not work ([TURN overview](https://www.rfc-editor.org/rfc/rfc8656.html#section-1)). Cloudflare Tunnel likewise carries proxied traffic through Cloudflare. Both differ from this project's signaling-only VPS; TURN is intentionally rejected by the current code.

## 4. NAT and reconnect feasibility

STUN-only ICE succeeds when the peers can validate a host or server-reflexive candidate pair. ICE's connectivity checks account for NAT behavior, but the specification notes that direct communication is not always possible and introduces relayed candidates for that case ([ICE overview](https://www.rfc-editor.org/rfc/rfc8445.html#section-2)); TURN exists specifically when a direct path cannot be found ([TURN §1](https://www.rfc-editor.org/rfc/rfc8656.html#section-1)). Consequently, same-LAN and permissive home-NAT cases should often connect, while carrier-grade, address/port-dependent, enterprise, double-NAT, or UDP-blocking combinations must be treated as expected failures—not bugs—with STUN only. After direct ICE fails, connectivity requires a relay or another reachable path, such as permitted end-to-end IPv6 or an explicit router port mapping.

A new network, NAT rebinding, expired mapping, sleep, or process restart can invalidate the selected pair. ICE supports restart by changing ICE credentials ([ICE restart](https://www.rfc-editor.org/rfc/rfc8445.html#section-9)), but this implementation needs the WSS channel to exchange new SDP and currently has no automatic relay fallback. If the signaling endpoint or a random Quick Tunnel URL is gone, token possession alone cannot reconnect: arbitrary-NAT remote reconnect cannot be guaranteed without rendezvous.

## 5. Options and tradeoffs

| Option | Removes VPS? | Carries app data on a relay? | Tradeoff |
|---|---:|---:|---|
| Keep WSS signaling + public STUN (current) | No | No | Small, auditable server role; direct-only failures remain. |
| Self-host signaling on Host with public IP/TLS or manual port forwarding | Yes | No | Still a reachable server endpoint; router, firewall, DNS, certificate, and dynamic-address operations move to the user. |
| Quick/managed Cloudflare Tunnel for signaling | VPS only | Signaling only if scoped correctly | Easier inbound exposure, but depends on Cloudflare; Quick Tunnel is random, non-SLA, and development-only. |
| PCP or NAT-PMP mapping | Potentially | No | A supporting gateway can create explicit inbound mappings, but support and policy vary; leases expire and gateway/public-address changes require renewal. PCP defines controlled mappings through a PCP server ([RFC 6887](https://www.rfc-editor.org/rfc/rfc6887.html)); NAT-PMP lets a host request public-address and port mappings from its NAT gateway ([RFC 6886](https://www.rfc-editor.org/rfc/rfc6886.html)). This needs new Host-side discovery, security, renewal, and signaling design and does not help networks the user cannot administer. |
| Two-way QR/BLE SDP exchange (not the current one-way QR flow) | Yes | No | Works only while peers are nearby enough to return both offer and answer; it must be repeated after ICE restarts and still cannot overcome incompatible NATs. |
| Optional Cloudflare application proxy or TURN fallback | No | **Yes** | Improves availability by carrying application packets when direct ICE cannot; this is a disclosed data relay and contradicts the direct-only contract. TURN is the ICE-native choice. |

IPv6 and PCP/NAT-PMP can improve direct reachability, but none guarantees it across arbitrary firewall, gateway, carrier, and peer combinations.

## 6. Recommendation

Keep the present **signaling-only WSS + STUN-only direct data plane**, and describe the guarantee precisely as “no server carries session/application traffic,” not “no servers.” Do not use TryCloudflare for production. Improve failure telemetry (candidate type, ICE state, signaling reachability) and reconnect/ICE-restart behavior, and evaluate native IPv6 plus PCP-assisted mappings before considering server removal; these paths can improve but not guarantee availability. If broad mobile reliability is mandatory, make authenticated TURN an explicit, opt-in product decision with clear relay disclosure; otherwise accept and document a measurable direct-connect failure envelope. PCP/NAT-PMP can be an advanced Host experiment, not the default, because they cannot control carrier or enterprise NATs.

## 7. Network test matrix

Record signaling success, gathered candidate types, selected candidate pair, setup time, DataChannel continuity, failure code, and reconnect result for every case.

| Host network | Android network | Expected with current design | Required test |
|---|---|---|---|
| Same Wi-Fi/LAN | Same Wi-Fi/LAN | Usually direct host candidate | Pair, transfer data, sleep/wake, reconnect. |
| Home NAT | Different home NAT | Often server-reflexive direct; not guaranteed | Test common routers, then restart both routers and retry. |
| Home NAT/double NAT | LTE/5G CGNAT | Variable; common hard case | Test each carrier, IPv4-only and IPv6-capable plans. |
| Public IPv6 + firewall | Public IPv6 + firewall | Direct only if policy permits UDP | Test allowed and blocked inbound UDP policies. |
| Enterprise/hotel Wi-Fi | LTE/5G or another enterprise | Likely failure when UDP/NAT policy is restrictive | Confirm explicit `ice-failed`; verify no payload reaches WSS. |
| Any | Network blocks UDP | Expected failure without TURN/TCP relay | Confirm bounded timeout and actionable UI. |
| Connected, then Android changes Wi-Fi ↔ cellular | Any | Existing candidate pair may die | Verify ICE restart/re-signaling or clean failure and token reconnect. |
| Any compatible pair | WSS unavailable after initial session | Current session may continue; renegotiation/reconnect cannot | Drop WSS during transfer, then force ICE restart and reconnect. |
| Any | Quick Tunnel signaling restarted | Old random URL should fail | Verify URL rotation handling; never count this as production availability. |
