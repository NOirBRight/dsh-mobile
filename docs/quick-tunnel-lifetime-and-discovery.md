# Quick Tunnel lifetime and endpoint discovery

## Bottom line

Cloudflare does **not** publish a numeric maximum lifetime, maximum session duration, or Quick-Tunnel idle timeout for a random `*.trycloudflare.com` URL. It also explicitly provides **no SLA or uptime guarantee** for TryCloudflare. Quick Tunnels are for testing and development, not production ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).

| Question | What Cloudflare documents |
|---|---|
| Maximum Quick Tunnel / random-URL lifetime | **No number documented.** |
| Quick Tunnel idle timeout | **No number documented.** |
| Maximum Quick Tunnel session duration | **No number documented.** |
| Uptime guarantee | **None.** Cloudflare says it does not guarantee any SLA or uptime for TryCloudflare. |
| Individual proxied WebSocket idle timeout | Cloudflare says an idle WebSocket will be closed, but **does not publish the default period as a number**. Enterprise customers can ask for a custom value. |
| Maximum individual WebSocket lifetime | **No number documented.** Connections can still be terminated by idle handling, either endpoint, network failure, or Cloudflare server restarts. |

## Random URL lifetime is not WebSocket lifetime

These are separate lifecycles:

- **Quick Tunnel URL:** running `cloudflared tunnel --url ...` generates a random `trycloudflare.com` subdomain. Cloudflare's general Quick Tunnel documentation describes generation on launch; its Sandbox Quick Tunnel documentation is explicit that a fresh `cloudflared` process gets a random hostname and that the URL changes on every container restart ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), [Sandbox tunnels](https://developers.cloudflare.com/sandbox/api/tunnels/)). Cloudflare does **not** document a guaranteed minimum life, maximum life, post-stop grace period, or hostname-reuse period. Treat the URL as a per-process, ephemeral address.
- **One WebSocket:** a WebSocket upgraded through that URL is one connection within the currently running tunnel. Cloudflare says it closes a WebSocket after a period with no traffic in either direction, recommends ping/pong heartbeats, and warns that Cloudflare code deployments may restart edge servers and terminate WebSockets. The page gives **no numeric default idle period and no numeric maximum connection age** ([WebSockets](https://developers.cloudflare.com/network/websockets/)). A heartbeat can prevent application idleness; it cannot make the Quick Tunnel hostname stable.

A `cloudflared` restart affects traffic currently being served. Cloudflare explicitly says stopping a `cloudflared` instance drops long-lived HTTP requests such as WebSockets; the next Quick Tunnel launch yields a new random address. Clients holding the old URL therefore need the replacement URL before reconnecting ([Configuration file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/), [Sandbox tunnels](https://developers.cloudflare.com/sandbox/api/tunnels/)). Cloudflare documents no continuity or redirect from the old random hostname.

### Numbers that are not a Quick Tunnel lifetime

- A 2021 Cloudflare engineering post said its cleanup worker removed Quick Tunnels and DNS records after they had been **disconnected for more than five minutes**, while connected tunnels could live for months. That is a historical post-disconnection cleanup detail—not a five-minute URL lifetime, idle-client timeout, maximum lifetime, or current availability promise ([Quick Tunnels: Anytime, Anywhere](https://blog.cloudflare.com/quick-tunnels-anytime-anywhere/)).
- Cloudflare troubleshooting documentation mentions that some long-lived sessions such as SSH may last **up to eight hours**. It does not define that figure as a Quick Tunnel URL lifetime or Quick-Tunnel WebSocket cap, so it should not be applied to either ([Common tunnel errors](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/)).

## Relevant official Quick Tunnel limits

For capacity and streaming behavior, Cloudflare documents:

- at most **200 in-flight requests**; excess requests receive HTTP `429`;
- **Server-Sent Events are unsupported**;
- testing/development use only, with **no SLA or uptime guarantee**;
- Quick Tunnels may not work while a `config.yaml` file is present in the `.cloudflared` directory.

Cloudflare's WebSocket page says it counts the initial upgrade as one HTTP request for request measurement, but Cloudflare does **not** explicitly say how an upgraded WebSocket is accounted against the Quick Tunnel's 200 in-flight-request cap. Cloudflare documents no Quick-Tunnel-specific byte quota, numeric URL expiry, or numeric WebSocket session cap on those pages ([Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), [WebSockets](https://developers.cloudflare.com/network/websockets/)).

## Minimum endpoint-discovery architecture

In plain language, discovery is a **stable address book in front of an unstable tunnel address**:

1. Give each host an opaque, unguessable identifier and credentials.
2. Run a small HTTPS service at a stable URL.
3. After `cloudflared` starts and prints a new random URL, the host authenticates and publishes `identifier -> current tunnel URL`, plus a generation number and short expiry/last-updated time.
4. A client authenticates (or presents an unguessable lookup capability), asks for that identifier immediately before connecting, rejects expired records, and then opens the WebSocket returned by discovery.
5. On every tunnel restart the host replaces the record. The service must authorize writes, rate-limit requests, use TLS, avoid enumerable identifiers, and expire stale mappings. Clients still need normal disconnect detection, heartbeat, and retry logic.

This is an engineering design, not a feature Cloudflare documents as part of Quick Tunnels. Cloudflare does not document a built-in discovery/control-plane API for republishing rotating TryCloudflare URLs. Discovery makes a replacement URL findable; it does **not** add an uptime guarantee or preserve an existing WebSocket.

### Can a user host it under their own domain?

**Yes—the discovery service can be hosted under the user's domain.** Cloudflare does not document attaching that domain directly to the random Quick Tunnel itself; its documented custom-hostname solution is a named tunnel. The separate discovery service can be any user-controlled HTTPS API and small database under a stable domain. On Cloudflare, one minimal managed implementation is a Worker on a custom domain with strongly consistent Durable Object storage. Cloudflare says Worker Custom Domains can attach a Worker to a domain/subdomain in an active Cloudflare zone the user owns, with Cloudflare creating DNS records and certificates; Durable Objects provide private, transactional, strongly consistent storage ([Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [Durable Object storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)).

Workers KV is possible when delayed visibility is acceptable, but Cloudflare documents that KV is eventually consistent and updates may take **60 seconds or more** to become visible elsewhere. That stale-read window is a poor default for immediate tunnel-URL rotation; use strongly consistent storage or design explicit generation/verification handling ([How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)).

If the user already controls a domain in Cloudflare, a **named Cloudflare Tunnel** may be simpler than discovery for the origin itself: a public hostname maps to the tunnel's `<UUID>.cfargotunnel.com` target, and the DNS record remains when the connector stops. Unlike a Quick Tunnel URL, that hostname is stable across connector restarts, though connections still need reconnect handling. Cloudflare specifically recommends a named tunnel when a stable hostname or stricter access control is required ([Tunnel routing](https://developers.cloudflare.com/tunnel/routing/), [Local development tunnels](https://developers.cloudflare.com/workers/local-development/local-dev-tunnels/), [Sandbox tunnels](https://developers.cloudflare.com/sandbox/api/tunnels/)).
