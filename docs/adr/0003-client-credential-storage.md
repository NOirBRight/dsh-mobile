# ADR 0003: Client credential storage and isolation

- Status: Accepted
- Date: 2026-08-16

## Context

A Product Client may retain permanent-until-revoked authorizations for multiple Hosts and may execute UI modules supplied by an Active Host. Storing every Host token in browser localStorage would let any code running in the shared native WebView origin read credentials for unrelated Hosts. Browser storage, meanwhile, is inherently scoped to the current web origin and cannot survive a rotating Quick Tunnel hostname.

## Decision

1. Native Host-scoped credentials and private key material are stored through Android system-backed secure storage, not Web localStorage.
2. The native connection module reads credentials internally and exposes an authenticated transport for only the Active Host. UI modules never receive raw credentials.
3. Non-secret Host Profile metadata may be stored in the application database, but secrets are referenced through opaque vault identifiers.
4. Browser credentials remain scoped to the browser origin that paired them. A stable Custom Endpoint can retain them; a rotated Temporary Endpoint requires browser re-pairing.
5. Browser and native credentials are independent and are never implicitly copied between surfaces.
6. MVP provides no cloud synchronization, plaintext export, URL embedding, or UI-module access for credentials.
7. Existing prototype credentials in localStorage require an explicit migration or re-pairing path before production release.
8. UI modules installed by the active Host may run in both the native and browser clients so Host capabilities are not silently removed.
9. Host UI modules receive only DSH UI/runtime interfaces and the mediated Active Host transport. Android camera, secure storage, filesystem, deep-link handling, and other native capabilities remain private to the App Shell and are not exposed as a general plugin bridge.

## Consequences

- A UI module for one Active Host cannot directly read authorization material for another saved Host.
- Native multi-Host profiles can survive endpoint changes without exposing credentials to the WebView.
- Clearing browser site data removes that browser origin's authorization.
- Quick Tunnel browser users pair again after hostname rotation, while the native App performs Endpoint Refresh.
- Backup and cross-device synchronization are outside MVP; users pair each Client Instance independently.
- The native transport seam must mediate authenticated operations rather than implementing authentication entirely in page JavaScript.
