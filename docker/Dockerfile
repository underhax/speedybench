FROM --platform=$BUILDPLATFORM node:26-alpine3.24@sha256:ef24c5053d50fdc3e4e56eb4e7ddb7861874ab0fdc797046ba897581deb8e868 AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix frontend ci --ignore-scripts
COPY frontend/ frontend/
RUN npm --prefix frontend run build

FROM --platform=$BUILDPLATFORM golang:1.27.1-alpine3.24@sha256:cf6fca6641884b8433441b2b0652976f975e1d0fdd26d177eaaf8596087f3125 AS backend-builder
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=frontend-builder /app/internal/assets/dist internal/assets/dist/
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -ldflags="-w -s -X main.Version=${VERSION}" -o speedybench ./cmd/speedybench

FROM scratch
WORKDIR /app
COPY --from=backend-builder /app/speedybench /app/speedybench
USER 65534:65534
ENV SPEEDYBENCH_HOST=all
ENV SPEEDYBENCH_PORT=8989
ENV SPEEDYBENCH_IN_DOCKER=true
ENV SPEEDYBENCH_MAX_CONNS=100
EXPOSE 8989
ENTRYPOINT ["/app/speedybench"]
