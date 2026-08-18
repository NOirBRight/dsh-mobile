# Quick Tunnel Signaling Spike

Date: 2026-08-16

## Question

Can DSH Mobile pair without an owned domain by putting an account-less Cloudflare Quick Tunnel URL in the v3 direct offer, while Cloudflare carries SDP signaling only and never application traffic?

## Scope

This was a throwaway spike. It did not modify or restart the live DSH process, replace the production signaling endpoint, deploy TURN, or add a data-relay fallback. A separate local instance of the existing strict signaling server listened on port 18787.

Cloudflare documents Quick Tunnels as testing/development functionality with no uptime guarantee; they create a random `trycloudflare.com` hostname and are not a production availability mechanism ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).

## Environment

- `cloudflared 2026.8.2`, downloaded from the official release and verified against SHA-256 `fcfb02b575a52ca1af2e3267af4e1517bcdeb30ac48c834c69abaed3c0576ad2`.
- Account-less Quick Tunnel forwarding to `http://127.0.0.1:18787`.
- Forced `--protocol http2`: cloudflared's preflight reported Cloudflare QUIC/UDP failure under the current desktop FlClash path, while TCP/HTTP2 and the Cloudflare API passed.
- Physical OPPO Android device with the installed DSH Mobile APK.

## Results

| Check | Result |
|---|---|
| Public `/healthz` through random Quick Tunnel hostname | Pass |
| Host/client WSS connection through Quick Tunnel | Pass |
| Valid SDP offer forwarded as text | Pass |
| Valid SDP answer forwarded as text | Pass |
| Binary frame rejected with close 4400 | Pass |
| Application-phase frame rejected with close 4400 | Pass |
| v3 `mode: direct` offer with random WSS address | Pass |
| `dsh-mobile://pair#offer=...` generation | Pass, 396-byte Deep Link |
| QR SVG generation for that Deep Link | Pass |
| Android receives Deep Link and sends SDP offer through Quick Tunnel | Pass; one 1,518-byte SDP text envelope reached the isolated signaling server |
| Tunnel restart changes hostname | Pass |
| Old hostname after tunnel stop | Failed as expected with HTTP 530 |
| New hostname after restart | Pass for health, WSS SDP forwarding, and strict rejection |

The Android test used a throwaway raw host listener to capture and validate the client's SDP offer. It intentionally did not answer or run NaCl/DataChannel authentication. Therefore this spike proves dynamic Quick Tunnel signaling and Android offer dispatch, not a complete authenticated tunnel over the Quick Tunnel endpoint. The existing signaling implementation was separately shown to reject non-SDP traffic through Cloudflare.

## Verdict

An account-less Quick Tunnel is technically feasible as an **ephemeral signaling adapter without an owned domain**:

1. Start the strict local signaling server.
2. Start cloudflared over HTTP/2 and wait for its random hostname.
3. Put the resulting WSS base URL in `PairingOffer.addr`.
4. Generate the QR only after the signaling lease exists.
5. Keep cloudflared alive while initial pairing, ICE restart, or reconnect needs signaling.

It is not suitable as the default production rendezvous endpoint:

- Restarting cloudflared rotates the hostname.
- Old QR codes and persisted offers become unusable immediately.
- A valid device token cannot discover the new endpoint; the user must rescan.
- Cloudflare gives account-less tunnels no uptime guarantee.
- Quick Tunnel does not improve IPv4/IPv6 ICE reachability and cannot replace TURN.

If retained, Quick Tunnel should be an explicitly temporary/manual mode. The app must label the offer ephemeral and fail with “signaling endpoint expired; rescan” rather than retrying silently or relaying application data.

## Production seam if adopted later

Keep the existing offer `addr` seam. A future Quick Tunnel adapter should return one short-lived signaling lease containing only its WSS URL and lifecycle; pairing generation consumes that lease. DataChannel, NaCl authentication, HTTP/WebSocket tunneling, and ICE policy remain independent.

No production implementation should begin until the remaining data-plane spike determines the direct candidate strategy: IPv6, IPv4 STUN, desktop UDP bypass, and fixed/mapped IPv4 UDP port.
