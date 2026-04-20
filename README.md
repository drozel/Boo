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
