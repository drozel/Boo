# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Boo is a single-page calendar for booking shared lab resources (test rigs, systems, anything a team reserves). Rows are resources, the timeline shows hourly availability in week or day view, and clicking/dragging on a row creates a booking. Everything persists to one JSON file on disk — no database, no external services, no auth layer (the README notes it should sit behind a VPN/reverse-proxy auth if publicly reachable).

## Commands

```sh
go run .                 # run locally; defaults DATA_FILE to ./data/data.json, PORT to 8080
go vet ./...              # what CI runs — no test suite exists in this repo
go build ./...
gofmt -l .                 # check formatting (no *_test.go files currently exist)

task build                # docker build -t boo:local .
task run                  # build + run container with a named volume on :8181
```

There are no JS build/lint commands — `web/` is plain ES modules served as static files, no bundler or transpile step.

## Architecture

**Backend (Go, single package `main`, flat files at repo root):**
- `main.go` — HTTP server setup, all route handlers, SSE broker, PNG icon resize/upload. Embeds `web/` into the binary via `//go:embed` so the compiled binary is self-contained.
- `models.go` — `Resource` and `Booking` structs, JSON tags, and their `validate()` methods (defaulting, trimming, link URL normalization, overlap checking).
- `store.go` — `Store`: an in-memory `State` (resources + bookings) guarded by a `sync.RWMutex`, persisted to a single JSON file on every mutation via write-to-`.tmp`-then-`rename` (atomic replace, no partial writes). This is the only persistence mechanism — there's no database.

**Data flow:** every mutating handler in `main.go` calls into `store.go`, which validates, mutates in-memory state, and persists to disk before returning. Booking create/update/delete additionally publish an SSE event (`booking:add`/`booking:update`/`booking:delete`) via the `Broker` in `main.go` so other connected clients' calendars update live (see `GET /api/events` and `connectSSE()` in `app.js`).

**Concurrency safety:** booking overlap checks (`overlaps()` in `models.go`) happen inside the store's write lock, so two concurrent bookings for the same resource/time-slot correctly race to a `409 Conflict` rather than double-booking.

**Frontend (`web/`, vanilla JS ES module, no framework/bundler):**
- `index.html` — all dialogs (name/resource/booking) and inline SVG icon symbols live directly in the markup; `app.js` shows/hides and populates them.
- `app.js` (~1300 lines, single file) — organized into clearly delimited sections via `// ---------- name ----------` comments: utilities, API (`api()` fetch wrapper), rendering, row click/drag-to-create, dialogs, link popover, color picker (HSV, hand-rolled, no dependency), co-booker chips, form submission, wire-up (`init()`), and SSE (`connectSSE()`). Client-side state lives in one `state` object at the top of the file (current view mode/range, loaded resources/bookings, dialog-editing state). The only external dependency is SortableJS, loaded from an esm.sh CDN URL for resource drag-to-reorder.
- `styles.css` — plain CSS, no preprocessor.

**Icons:** resource icons are either one of a fixed built-in SVG set (referenced by name, rendered via `<use href="#i-...">`) or an uploaded PNG resized server-side to 32×32 (`resizePNG` in `main.go`) and served from `/uploads/{id}.png`, stored in `icons/` next to `DATA_FILE`.

## API surface

- `GET /api/state` — `{resources, bookings}` full snapshot
- `GET /api/events` — SSE stream of booking changes
- `POST /api/resources`, `POST /api/resources/order` (reorder), `PATCH /api/resources/{id}`, `DELETE /api/resources/{id}`
- `POST /api/resources/{id}/icon` — multipart `file` field, PNG, resized to 32×32
- `POST /api/bookings`, `PATCH /api/bookings/{id}`, `DELETE /api/bookings/{id}`

A `Booking` is `{resourceId, user, coBookers?, start, end, note?, fullDay?}` with RFC3339 timestamps (stored/compared in UTC). Overlapping bookings on the same resource return `409 Conflict`.

## Environment

`PORT` (default `8080`), `DATA_FILE` (default `./data/data.json` locally, `/data/data.json` in the Docker image). Uploaded icons are written to `icons/` next to `DATA_FILE`.
