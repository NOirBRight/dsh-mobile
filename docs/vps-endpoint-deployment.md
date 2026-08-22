# VPS Custom Endpoint deployment

This is the primary production Public Endpoint per [ADR 0005](adr/0005-vps-endpoint-tunnel-first-app-only.md). Most of the infrastructure already exists on the Aliyun VPS (`120.26.124.92`, `noirbright.top`, ICP-filed): the gap is that the Host still runs `endpointMode: quick` and the Host-side service lifecycle is fragile. Quick Tunnel (`docs/deployment.md`) remains available for development only.

## Existing topology (verified 2026-08-18)

```text
Android APK ── wss://pair.noirbright.top ──> VPS: Docker Caddy :443 (Let's Encrypt)
                                               │ reverse_proxy 172.18.0.1:31424
                                             VPS: sshd remote-forward listener 172.18.0.1:31424
                                               ▲ outbound ssh -R (dsh-gateway-vps-tunnel.service on AM01S)
                                             AM01S: Host Gateway 127.0.0.1:43170 (pairing plugin on daily 3080)
                                               │ loopback only
                                             AM01S: DSH daily 127.0.0.1:3080 (DSH_HOME=~/.dsh)
                                             AM01S: DSH lab 127.0.0.1:3082 + Gateway 43169 (separate test process)
```

- Caddy runs in Docker (`infodigest-caddy`) with the `pair.noirbright.top` site block already present: no basic_auth, capability-gated inside the Gateway, never proxies raw :3080.
- The return path is the restricted SSH reverse tunnel unit `dsh-gateway-vps-tunnel.service` (`ssh -N -R 172.18.0.1:31424:127.0.0.1:43170 vps-aliyun`). The public Pair endpoint intentionally terminates at the daily 3080 Host; this is not a lab/3082 mismatch.
- DNS A records for `pair`/`dsh`/`dshapp`/`relay.noirbright.top` all point at the VPS.
- `frps` also runs on the VPS (`:7000`, `/opt/frp/frps.toml`) and can replace the SSH tunnel later; it is not required for this migration.
- `dsh.noirbright.top` / `dshapp.noirbright.top` / `relay.noirbright.top` are maintainer personal recovery surfaces (`docs/dual-domain-deployment.md`), not product topology.

Both the phone and the Host only make outbound connections; no NAT traversal or inbound Host firewall rule is involved. The VPS never sees plaintext DSH frames; sessions stay sealed end-to-end with NaCl against the Host Identity key.

## Measured link budget (2026-08-18, home LAN to VPS)

- RTT ~19 ms, 0% loss.
- VPS egress ~4.4 Mbps measured (~540 KB/s), well above the nominal 1 Mbps plan figure and ample for sealed protocol frames (streaming chat is ~1–10 KB/s; session-history bursts of a few hundred KB take about a second).
- Not sufficient for asset serving or bulk file transfer: shell assets stay packaged in the APK, plugin bundles are content-hash cached on-device.

## Migration gaps (why the "stable site" still failed)

1. **The public Pair mapping is intentionally the daily 3080 Host.** `pair.noirbright.top` returns the daily Host Identity and forwards to Gateway 43170. Do not redirect it to the lab 3082 process. The lab 3082 endpoint can be tested separately with its own custom URL/Relay selection.
2. **The daily DSH is the public Pair owner.** Keep `dsh-web.service`/daily 3080 and Gateway 43170 healthy for `pair.noirbright.top`. The lab 3082/43169 process remains an independent test plane and must not claim the daily Pair DNS.
3. **Tunnel unit lifecycle.** `dsh-vps-tunnel.service` uses `BindsTo=dsh-web.service` and dies with it; the ad-hoc `dsh-vps-tunnel-dev` unit duplicates it. Consolidate: one gateway tunnel unit with `Restart=always`, `ExitOnForwardFailure=yes`, `ServerAliveInterval=30`, wanted by `default.target` (it is harmless while the Gateway is down and heals the path the moment the Gateway returns).
4. **Fixed ports are required end to end.** The daily Pair Gateway must keep `gatewayPort: 43170` (never the default `0`), matching the `-R` forward and the Caddy site block. Lab test Gateway 43169 remains separate.

## Verification checklist

1. `curl https://pair.noirbright.top/.well-known/dsh-mobile` returns `{ protocol: 1, hostIdentity, capabilities }` through Caddy and the tunnel.
2. `/pair/status` on the Host shows `endpointMode: custom` and the `pair.noirbright.top` endpoint; minted offers embed it.
3. Pair a real device on LTE/5G, confirm the active route shows Tunnel, and hold the session past several heartbeat cycles with no stale classification.
4. Restart `dsh-lab.service`, the tunnel unit, and Docker Caddy one at a time; the app must reconnect with the existing device token and no re-pairing. Do not restart `dsh-web.service` to test mobile.
5. Reboot AM01S; systemd brings lab DSH and the tunnel back without operator action and the endpoint recovers.

## Non-goals

- Multi-endpoint Host Profiles are out of scope; the overseas VPS gets its own self-host-stack instance (PLAN wave 8) rather than a second URL on existing profiles.
- The VPS must not proxy raw DSH :3080 on the product endpoint, host the browser shell, or serve any static assets for the product client.
- Replacing the SSH reverse tunnel with frp on this maintainer instance is optional; the packaged self-host stack (PLAN wave 8) standardizes on Caddy + frps/frpc for new deployments.
