# Self-hosted Custom Endpoint

Operator-owned HTTPS front for one Host Gateway. This is **not** a product
default and must never be compiled into the APK.

## Layout

- Caddy terminates TLS for `$ENDPOINT_HOST`.
- frps accepts the Host's outbound `frpc` and publishes the loopback Gateway
  (`127.0.0.1:43169` on the Host) as HTTPS.
- The phone still speaks the sealed DSH Mobile protocol. The VPS is an
  untrusted pipe.

## Bring-up

```bash
export ENDPOINT_HOST=pair.example.com
# put the same token in frps.toml and the Host's frpc.toml
# DNS A/AAAA for $ENDPOINT_HOST must point at this machine before Caddy can issue a certificate.
docker compose up -d
```

On the Host, copy `frpc.toml.example`, set `serverAddr` / token / domain, and
run `frpc -c frpc.toml`. Then set the pairing plugin to

```yaml
endpointMode: custom
customEndpointUrl: https://pair.example.com
```

Budget one instance at about 50 concurrent-active sealed sessions. Run a
second compose stack on another VPS for a second Host; do not share rooms.

Maintainer lab (`pair.noirbright.top`) already uses Caddy plus an SSH reverse
forward instead of frp. This recipe is for new operators.
