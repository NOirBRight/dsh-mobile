# DSH Mobile MVP implementation plan

GitHub issue #1 is the complete implementation specification. `CONTEXT.md` and ADR 0001–0004 are the architecture and domain-language authority. This file records execution order and non-negotiable constraints only.

## Product constraints

1. Android-first Capacitor application with packaged shell/layout/assets and no runtime CDN.
2. The same Host-owned Public Endpoint serves Android protocol access and a browser UI.
3. Public Endpoint modes are automatic Cloudflare Quick Tunnel or an operator-provisioned Custom Endpoint; neither requires a VPS.
4. Automatic connection policy tries WebRTC RTCDataChannel first and uses the same endpoint's encrypted Tunnel Fallback after direct failure. Direct Only and Tunnel Only remain available.
5. MVP has no Discovery Service, TURN, project-operated application-data Relay, hidden fallback, provider-account automation, or maintainer-domain dependency.
6. Pairing offers are five-minute single-use capabilities. Host-scoped device authorization lasts until Host revocation/reset. Host Identity is independent of endpoint hostname.
7. Native clients store multiple Host Profiles, keep one Active Host connection, and place credentials in Android system-backed secure storage.
8. Wide surfaces use the Host's exact official layout. Mobile Layout applies only below the accepted 696px narrow threshold. Official modules and design tokens remain authoritative.
9. Host-installed UI modules may use DSH UI/runtime and the mediated Active Host transport, but never camera, credential vault, filesystem, or other native shell capabilities.
10. Personal recovery domains are maintained separately and must never become product defaults or dependencies.

## Existing seams

- Client `FrameTransport` and Host `HostFrameTransport` are the data-plane seam. RTCDataChannel and Gateway WebSocket adapters must pass one conformance suite.
- The pairing plugin evolves into the bounded Host Gateway: browser/bootstrap, pairing/refresh, direct signaling, tunnel fallback, endpoint status, and the loopback DSH bridge.
- Product Client profile and secret persistence sit behind `ProfileRepository` and `CredentialVault`; UI modules receive only an Active Host transport.
- Root layout selection occurs before plugin boot so the exclusive root slot contains either the Host official layout or Mobile Layout, never both.

## Execution waves

1. Protect the dirty baseline and converge stale documentation/config defaults.
2. Define offer v4, Host Profile, Gateway, connection-state, heartbeat, and compatibility contracts test-first.
3. In parallel, implement Host Gateway/Public Endpoints, Profile/Vault, responsive root, and official compact metric leaves.
4. In parallel, implement ConnectionManager fallback/reconnect, Host endpoint settings/device management, and Product Client Host switching/bootstrap.
5. Integrate shared entry points and migrate legacy localStorage state without losing recoverable data.
6. Run transport, Gateway, real-browser, localization, accessibility, Android, and security test matrices.
7. Verify real Quick Tunnel and Custom Endpoint flows before producing APK/checksums; keep all personal recovery surfaces online.

## Verification gates

Every wave must leave affected package tests and typechecks green. Final acceptance requires root test/typecheck/build, affected official DSH UI tests/build, Android sync/debug assemble, real Chrome width/locale checks, real device camera/deep-link checks, WebRTC success and forced Tunnel Fallback, endpoint rotation, and architecture grep proving no forbidden dependencies.
