# DSH Mobile Domain Language

## Product Client
The native application or Host-served browser application used to connect to DSH Hosts the user controls. It is independent of the maintainer's personal web endpoints.

## Host
A user-controlled DSH installation that authorizes Product Clients and serves the user's DSH sessions and capabilities. A user may own multiple Hosts.

## Host Identity
The stable cryptographic public-key identity of one Host. It is independent of display name and Public Endpoint and is the key used to recognize an already paired Host.

## Host Profile
The Product Client's persistent record for one Host. It identifies that Host, carries that Host-scoped device authorization, remembers known connection endpoints, and can be selected independently of other Host Profiles. Scanning the same Host Identity updates this Profile instead of creating a duplicate.

## Client Instance
One native app installation paired to a Host. Each Client Instance receives an independent Host-scoped authorization and may be revoked without affecting other Client Instances. Browser Client Instances were retired by ADR 0005.

## Host Gateway
The dedicated protocol entry running beside a Host. It provides WebRTC rendezvous and optional Tunnel Fallback without exposing the raw DSH web port or acting as a general-purpose network proxy.

## Active Host
The one Host Profile currently selected for connection and presentation in the Product Client. Other Host Profiles remain saved but do not imply simultaneous live connections.

## Upstream UI Module
An official DSH UI capability supplied by the Host. It owns feature content and behavior.

## Mobile Layout
A narrow-width recomposition of Upstream UI Modules. It owns phone placement, navigation structure, and compact information presentation, but not replacement feature content or an independent visual design system. Wide surfaces retain the upstream official layout.

## Personal Recovery Surface
A maintainer-only direct web entry to the maintainer's own DSH. It is an operational fallback, not Product Client infrastructure and not a public product dependency. `dshweb` is the frozen official-layout entry on the daily Host; `dshapp` is the same Host with a static Mobile Layout shell. Iterating `dshapp` must not restart the Host process that serves `dshweb`.

## Public Endpoint
The public connection address advertised by one Host. It is part of that Host's configuration rather than a global Product Client setting. A Public Endpoint may be a provider-assigned Temporary Endpoint or an operator-configured Custom Endpoint, and may offer rendezvous plus optional Tunnel Fallback capabilities.

## Temporary Endpoint
A Public Endpoint with a provider-assigned hostname whose continuity is not guaranteed, such as a Cloudflare Quick Tunnel address. A changed Temporary Endpoint requires Endpoint Refresh.

## Custom Endpoint
A stable Public Endpoint configured by the Host operator under a domain they control or another compatible provider. It is never required to use a maintainer-owned domain.

## Rendezvous Endpoint
The capability of a Public Endpoint that exchanges WebRTC signaling metadata so a Product Client and Host can attempt a direct connection. This capability does not carry DSH application frames after direct connection succeeds.

## Tunnel Fallback
An optional data path when direct WebRTC connectivity is unavailable. It may use the Host operator's Quick or Custom Endpoint, or an explicitly selected official/self-hosted Relay Endpoint. In all cases the carrier sees only sealed frames.

## Discovery Service
An optional stable address book that maps a Host lookup capability to that Host's current Rendezvous Endpoint. It helps a Product Client find a rotated temporary endpoint but does not perform rendezvous itself and does not carry DSH application frames.

## Relay Endpoint
An optional endpoint that forwards end-to-end encrypted DSH application frames when direct connectivity is unavailable. It is a separate capability from rendezvous and is not required by the base product.

## Room
A cryptographically random isolation namespace used for one rendezvous or relay context. A Room is not a Host identity and shared infrastructure must never place unrelated Hosts in one Room.

## Pairing
The first authorization of a Product Client by a Host. Pairing creates a Host Profile and Host-scoped device authorization.

## Endpoint Refresh
Updating the known endpoint of an already paired Host without granting new device authorization. This is distinct from Pairing and is needed when a temporary hostname changes.

## Profile Removal
Deleting a Host Profile and its Host-scoped credential from one Product Client. It is a local operation, requires no connection to the Host, and does not revoke any authorization record retained by the Host.

## Device Revocation
Invalidating a device authorization from the Host's device-management surface. It is a Host-side security operation and is not part of Profile Removal.
