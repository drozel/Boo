# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/boo . && \
    mkdir /data

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/boo /boo
COPY --chown=65532:65532 --from=build /data /data

ENV PORT=8080 DATA_FILE=/data/data.json

VOLUME ["/data"]

EXPOSE 8080

USER nonroot
ENTRYPOINT ["/boo"]
