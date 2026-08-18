# ADR 0002: Pairing and Host Profile lifecycle

- Status: Accepted
- Date: 2026-08-16

## Context

DSH Mobile must make first use simple while supporting long-term reconnect, changing temporary endpoints, and multiple user-controlled Hosts. Requiring periodic re-pairing would break remote access when the user is away from the Host. Treating endpoint hostname as identity would create duplicate Hosts whenever a Quick Tunnel rotates. Coupling local profile deletion to remote revocation would make deletion fail precisely when a Host is unreachable.

## Decision

1. A pairing offer is single-use and expires five minutes after issuance.
2. Successful pairing creates a Host-scoped device authorization that remains valid until the Host revokes it or resets its Host Identity. It has no periodic expiry in MVP.
3. Host Identity is the Host's stable cryptographic public-key identity and is independent of endpoint hostname and display name.
4. The Product Client stores a collection of Host Profiles keyed by Host Identity. Each Profile owns its endpoint, Host-scoped credential, connection policy, capabilities, and local presentation state.
5. Scanning the same Host Identity updates the existing Profile's endpoint and capabilities rather than creating a duplicate. A matching endpoint with a different Host Identity must never silently replace the existing Profile.
6. MVP keeps at most one Active Host connection. With one Profile it connects automatically; with multiple Profiles it reconnects the last Active Host and exposes a Host switcher.
7. Profile Removal is local and always available offline. It deletes that Profile and its local Host-scoped credential without contacting the Host.
8. Device Revocation is a separate Host-side security operation. It is not part of Profile Removal.
9. Re-pairing after local removal creates the Profile again from the scanned Host Identity and current endpoint.
10. A Host supports multiple independently authorized Client Instances, including native apps and browser origins, and may serve them simultaneously. Each Client Instance receives its own credential and revocation affects only that Instance.
11. The Host device-management surface records a user-facing label, client type, pairing time, and last-seen time for each authorization. MVP imposes no ordinary user-facing device count limit, while retaining a high defensive limit against pairing abuse.

## Consequences

- Native users normally scan once and reconnect indefinitely.
- Quick Tunnel rotation updates an existing native Host Profile instead of creating a second Host.
- A clean browser on a rotated Quick Tunnel origin pairs again because browser storage cannot cross origins.
- Removing a Host is immediate even when the Host is unreachable.
- Local removal can leave an unused authorization record on the Host; the Host device-management surface is responsible for reviewing and revoking such records.
- Multiple saved Hosts do not imply multiple background sockets, heartbeat loops, or simultaneous active sessions.
- One Host may nevertheless serve multiple independently authorized native or browser clients at the same time.
- Resetting Host Identity is treated as a new Host and requires explicit re-pairing.
