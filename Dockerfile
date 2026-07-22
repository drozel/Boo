# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build

WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .

# .dockerignore keeps .git out of the context, so there's no VCS stamp to read —
# the version shown in the UI has to be passed in.
ARG COMMIT=""
ARG BUILD_DATE=""

RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags="-s -w -X main.buildCommit=${COMMIT} -X main.buildDate=${BUILD_DATE}" \
      -o /out/boo . && \
    mkdir /data

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/boo /boo
COPY --chown=65532:65532 --from=build /data /data

ENV PORT=8080 DATA_FILE=/data/data.json

VOLUME ["/data"]

EXPOSE 8080

USER nonroot
ENTRYPOINT ["/boo"]
