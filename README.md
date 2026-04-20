# Boo 👻

A small one-page calendar for booking shared lab resources (test systems,
rigs, anything your team reserves). Rows are resources, the timeline shows
two weeks of hourly availability, and clicking or dragging on a row creates
a booking. Bookings carry a primary user plus optional co-bookers.

Everything is persisted to a single JSON file — no database, no external
services. The whole app ships as one small Docker image.

## Run

```sh
docker build -t boo .
mkdir -p data
docker run --rm -p 8080:8080 -v "$PWD/data:/data" boo
```

Open http://localhost:8080.

### Environment

| Var         | Default             | Purpose                        |
| ----------- | ------------------- | ------------------------------ |
| `PORT`      | `8080`              | HTTP port                      |
| `DATA_FILE` | `/data/data.json`   | JSON store path (mount a volume) |

## Develop

```sh
go run .        # defaults DATA_FILE to ./data/data.json
```

Everything under `web/` is embedded into the binary at build time — no
frontend toolchain, no bundler.

## API

- `GET /api/state` — `{resources, bookings}`
- `POST /api/resources` / `PATCH /api/resources/{id}` / `DELETE /api/resources/{id}`
- `POST /api/bookings` / `PATCH /api/bookings/{id}` / `DELETE /api/bookings/{id}`

A booking is `{resourceId, user, coBookers?, start, end, note?}` with
RFC3339 timestamps. Overlapping bookings on the same resource are rejected
with `409 Conflict`.

## Deploy to Fly.io

`fly.toml` and `.github/workflows/deploy.yml` are configured so every push
to `main` builds the Dockerfile on Fly's remote builder and rolls out a
single machine with `/data` mounted on a persistent volume.

One-time bootstrap (run locally, needs [`flyctl`](https://fly.io/docs/hands-on/install-flyctl/)):

```sh
# 1. Pick a globally-unique name and edit fly.toml's `app = "..."`.
flyctl apps create <your-app-name>

# 2. Create the volume referenced by fly.toml (match the region).
flyctl volumes create boo_data --region iad --size 1

# 3. Mint a deploy token and add it to GitHub.
flyctl tokens create deploy --expiry 8760h
#   → In GitHub: Settings → Secrets and variables → Actions → New secret
#     Name: FLY_API_TOKEN   Value: <paste the token>
```

After that, `git push origin main` triggers a deploy. You can also run it
manually from the Actions tab (`workflow_dispatch`) or from your shell with
`flyctl deploy --remote-only --ha=false`.

> **Note on auth**: Boo has no login layer. If the Fly URL will be
> reachable by anyone, put it behind Cloudflare Access, basic auth at a
> reverse proxy, or a VPN before inviting the team.
