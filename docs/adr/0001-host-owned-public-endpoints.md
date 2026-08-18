# ADR 0001: Host-owned public endpoints and tunnel fallback

- Status: Accepted
- Date: 2026-08-16

## Context

DSH Mobile needs to reach a user-controlled Host from restrictive mobile networks. Direct WebRTC is preferred, but IPv4 double NAT can prevent it. The product must work for users without domains as well as users with their own stable domains, while avoiding a required project-operated relay or discovery service. Maintainer-only web domains are operational recovery surfaces and are not product infrastructure.

Cloudflare Quick Tunnel can expose an HTTP/WebSocket Host Gateway at a temporary provider hostname. A user-controlled domain can expose the same Gateway through a named tunnel, reverse proxy, or compatible provider. These addressing choices do not need different application protocols.

## Decision

1. Every Host advertises one Public Endpoint owned or selected by that Host operator.
2. MVP offers two endpoint modes:
   - an automatically created Temporary Endpoint using Cloudflare Quick Tunnel;
   - a manually provisioned Custom Endpoint entered by the operator and validated by the product.
3. Custom endpoint provisioning remains outside MVP. The product accepts and tests the URL but does not log into provider accounts, change DNS, or store provider API tokens.
4. Both endpoint modes expose the same local Host Gateway. The Gateway provides WebRTC rendezvous and may provide an end-to-end encrypted Tunnel Fallback data path.
5. WebRTC RTCDataChannel remains the preferred data path. Tunnel Fallback is used only when enabled and direct connectivity fails, or when the operator explicitly selects it.
6. Tunnel Fallback reuses the Host's Public Endpoint. MVP has no separate project-operated public Relay Endpoint, TURN service, or Discovery Service.
7. A changed Temporary Endpoint is repaired through a signed Endpoint Refresh flow without re-pairing the device.
8. Host identity and device authorization are independent of endpoint hostname. Multiple Host Profiles each retain their own endpoint and credentials.
9. Long-lived WebRTC and WebSocket transports implement heartbeat, stale-connection detection, and foreground-resume reconnection.
10. The MVP exposes three connection policies: Automatic, Direct Only, and Tunnel Only. Automatic is the default; it tries WebRTC first and uses Tunnel Fallback only after direct failure.
11. The active route is always visible to the user as WebRTC Direct or Tunnel.
12. The same Public Endpoint serves both the Host-owned Mobile Web shell and the native App protocol. Browser support therefore requires neither a project website nor a user-operated VPS.
13. A browser using a rotated Temporary Endpoint reopens the new URL and pairs again because browser credentials are origin-scoped. The native App retains its Host Profile and performs Endpoint Refresh instead.
14. A Custom Endpoint may use a named tunnel without a VPS and provides a stable browser origin suitable for persistent credentials and optional PWA installation.
15. The Host Gateway exposes only bounded DSH Mobile protocol operations. It never publicly exposes raw DSH port 3080 and never becomes a general-purpose proxy.

## Consequences

- Users without domains or VPS access can start with Quick Tunnel and open the generated address in either the native App or a browser.
- Users with domains can configure a stable endpoint, such as a named tunnel under their own domain, without requiring a VPS.
- A rotated Quick Tunnel hostname requires browser re-pairing because the new hostname is a new web origin; this is accepted MVP behavior.
- The project does not pay for or operate user application-data relay infrastructure in MVP.
- Direct failures can still be recovered through the operator's own tunnel when Tunnel Fallback is enabled.
- Quick Tunnel has no uptime guarantee; after hostname rotation, users must perform Endpoint Refresh because MVP has no discovery service.
- Custom-domain users must provision their DNS/tunnel/reverse proxy themselves and ensure WebSocket support.
- When Tunnel Fallback is active, encrypted application traffic traverses the selected tunnel provider, so the UI must show the active connection path.
- The Gateway and clients need separate policy, rate limits, and tests for short-lived signaling traffic and long-lived encrypted data traffic even though both share one Public Endpoint.
