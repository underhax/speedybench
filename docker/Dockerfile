FROM --platform=$BUILDPLATFORM node:26-alpine3.24@sha256:b4fea132199070b0c8ea9ac66f363fe2cd6d1e4f994e61d8c87976c2157a1b8a AS frontend-builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix frontend ci --ignore-scripts
COPY frontend/ frontend/
RUN npm --prefix frontend run build

FROM --platform=$BUILDPLATFORM golang:1.26.6-alpine3.24@sha256:af8d6740070b8906d12eae1c3e3ea0957fb63f492051ea05e354c38ef9fe88df AS backend-builder
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
