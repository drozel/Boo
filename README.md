# Boo 👻

A small one-page calendar for booking shared lab resources (test systems,
rigs, anything your team reserves). Rows are resources, the timeline shows
hourly availability in a **week** or **day** view, and clicking or dragging
on a row creates a booking. Bookings carry a primary user plus optional
co-bookers and a free-form note. Weekends, off-hours and the current time
are shaded so the working day is easy to read at a glance.

Resources have a color, an icon (built-in set or an uploaded PNG), an
optional description and links. Everything is persisted to a single JSON
file with icons stored next to it — no database, no external services. The
whole app ships as one small Docker image.

## Run

A [Taskfile](https://taskfile.dev) wraps the common Docker commands:

```sh
task build   # docker build -t boo:local .
task run     # run the container with a named volume on :8181
```

Then open http://localhost:8181.

Plain Docker works too:

```sh
docker build -t boo .
mkdir -p data
docker run --rm -p 8080:8080 -v "$PWD/data:/data" boo
```

### Environment

| Var         | Default             | Purpose                          |
| ----------- | ------------------- | -------------------------------- |
| `DATA_FILE` | `/data/data.json`   | JSON store path (mount a volume) |

Uploaded resource icons are written to `icons/` next to `DATA_FILE`.

## Develop

```sh
go run .        # defaults DATA_FILE to ./data/data.json
```

Everything under `web/` is embedded into the binary at build time — no
frontend toolchain, no bundler.

## API

- `GET /api/state` — `{resources, bookings}`
- `POST /api/resources` / `PATCH /api/resources/{id}` / `DELETE /api/resources/{id}`
- `POST /api/resources/{id}/icon` — multipart `file` field, PNG, resized to 32×32
- `POST /api/bookings` / `PATCH /api/bookings/{id}` / `DELETE /api/bookings/{id}`

A resource is `{name, color, icon, description?, links?}` where each link is
`{url, text}`. A booking is `{resourceId, user, coBookers?, start, end, note?}`
with RFC3339 timestamps. Overlapping bookings on the same resource are
rejected with `409 Conflict`.

> **Note on auth**: Boo has no login layer. If the URL will be reachable by
> anyone, put it behind Cloudflare Access, basic auth at a reverse proxy,
> or a VPN before inviting the team.
