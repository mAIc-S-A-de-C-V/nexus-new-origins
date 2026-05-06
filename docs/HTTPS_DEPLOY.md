# HTTPS deploy via Caddy + Let's Encrypt

This sets up automatic TLS for the platform with zero ongoing maintenance. The
Elastic IP stays the same — we just put a hostname in front of it.

## One-time prerequisites

1. **Pick a hostname** pointing at your EC2 Elastic IP (e.g. `app.maic.ai → 52.202.36.168`).
   Use a registrar's DNS console, Cloudflare, Route 53, or a free DDNS.
   - Type: `A`, Name: `app` (or your subdomain), Value: `<your EIP>`
   - TTL: 5-10 min while bringing this up; bump to 1 hour or 1 day when stable
2. **AWS Security Group inbound** — open `tcp/80` and `tcp/443` from `0.0.0.0/0`.
   Leave the per-service ports (3000, 8001-8026, 9000-9001) open for now;
   close them later once HTTPS works.
3. Confirm DNS:
   ```
   dig +short app.maic.ai   # should print your EIP
   ```

## Deploy

On the EC2 host:

```bash
cd nexus-new-origins
git pull
cp https.env.example .env.production
# Edit .env.production → replace `app.maic.ai` everywhere with your hostname.

# Source the env vars and rebuild only what changed.
# (docker compose reads `.env` automatically; rename or use --env-file)
mv .env.production .env
docker compose up -d --build frontend caddy
```

That's it. Caddy boots, sees `DOMAIN=app.maic.ai`, hits Let's Encrypt's HTTP-01
challenge on port 80, gets a cert, and starts serving HTTPS on 443. First
issuance takes ~10 seconds. Renewals are automatic (every 60 days; nothing
for you to do).

Verify:

```bash
curl -sI https://app.maic.ai/ | head -5
# expect: HTTP/2 200, server: Caddy
```

## What broke / common gotchas

- **`dig` returns nothing for the hostname** — DNS hasn't propagated yet. Wait
  60 seconds and try again. If still nothing after 5 minutes, double-check the
  A record was saved at the registrar.
- **Caddy logs `tls.issuance.acme: HTTP-01 challenge failed`** — port 80 isn't
  reachable from the public internet. Check the SG inbound rule, then check
  that nothing else is bound to host port 80 (`sudo ss -tlnp | grep ':80'`).
- **Browser shows "not secure" / cert warning** — DNS is right but Caddy hasn't
  finished issuing. `docker logs nexus-new-origins-caddy-1 | grep -i certificate`
  will show progress.
- **Frontend loads but API calls fail with CORS** — `ALLOWED_ORIGIN_EC2` env
  var didn't propagate to the backend services. Restart them:
  `docker compose up -d --force-recreate connector-service ontology-service ...`
  or just `docker compose up -d` to restart everything that picked up the new env.
- **Frontend assets 404** — the frontend image was built with stale `VITE_*_URL`
  baked in. Rebuild: `docker compose up -d --build frontend`.

## Closing the per-service ports (optional, recommended)

Once HTTPS is working, in the AWS Security Group inbound rules, **remove**:
- `3000` (frontend was direct-accessed)
- `8001–8026`, `9000–9001` (per-service direct access)

Leave `80` and `443` (and `22` for SSH). Everything still works through the
proxy because Docker keeps the services reachable on `nexus-net` internally.

The `ports: - "8004:8004"` mappings in `docker-compose.yml` still bind the
host ports to the container, but with the SG closed, only the host loopback
can reach them — which is what backfill scripts and `docker exec` queries
need.

## Reverting to HTTP only

If you need to roll back temporarily:

```bash
docker compose stop caddy
# Browser hits to https://app.maic.ai will fail until DNS TTL expires or
# you delete the A record. Direct http://<eip>:3000 keeps working.
```

## How the routing works

```
https://app.maic.ai/                 → frontend:3000
https://app.maic.ai/apps             → frontend:3000        (SPA route)
https://app.maic.ai/api/connector/*  → connector-service:8001  (prefix stripped)
https://app.maic.ai/api/ontology/*   → ontology-service:8004   (prefix stripped)
…
```

Backend services keep mounting at root (`POST /connectors/{id}/test` etc.) —
the `handle_path` directive in the Caddyfile strips the `/api/<slug>/` prefix
before proxying. Frontend `VITE_*_URL` build args point to the prefixed paths
so all `fetch()` calls resolve to the public hostname.
