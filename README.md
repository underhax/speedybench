# SpeedyBench

SpeedyBench is a lightweight, self-hosted network speed test application. It provides an intuitive interface to accurately measure your network's ping, jitter, download, and upload speeds.

The backend is built with Go for maximum performance and minimal resource footprint, while the frontend is a modern, responsive single-page application built with TypeScript and Vite.

## Features

- **Accurate Metrics**: Measures ping, jitter, download, and upload bandwidth.
- **Lightweight**: Distributed as a single, self-contained binary with embedded frontend assets.
- **Self-Hosted**: Perfect for home labs, private networks, or public servers to test routing and connectivity.
- **Cross-Platform**: Runs seamlessly on Linux, macOS, and Windows.
- **Secure by Default**: Containerized environments run as non-root with read-only filesystems and dropped capabilities.

## Installation

You can run SpeedyBench using a pre-compiled binary or via Docker.

### Option 1: Binary Release

1. Download the latest binary for your operating system and architecture from the [Releases](https://github.com/underhax/speedybench/releases) page.
2. Extract the archive and make the binary executable (Linux/macOS):
   ```bash
   chmod 500 speedybench
   ```
3. Run the application:
   ```bash
   ./speedybench
   ```
4. Access the web interface at `http://127.0.0.1:8989` (or your server's IP address).

#### Configuration

SpeedyBench can be configured using the following environment variables:

- `SPEEDYBENCH_HOST`: If not provided, the server listens on localhost (`127.0.0.1`) by default for security reasons. If set to `all`, it will listen on all available interfaces. Alternatively, you can explicitly specify an IP address to bind to a specific interface.
- `SPEEDYBENCH_PORT`: The port for the web server to listen on (default: `8989`). For security reasons, the port must be strictly within the restricted range of `1025` to `65535` to prevent binding to privileged ports. *(Note: When using Docker, you do not need to change this variable; simply map your desired host port to the container's default `8989` port, e.g., `-p 9090:8989`).*

##### Examples

**1. Localhost and standard port:**
```bash
# By default, the server binds to 127.0.0.1:8989
./speedybench

# Which is exactly equivalent to:
SPEEDYBENCH_HOST=127.0.0.1 SPEEDYBENCH_PORT=8989 ./speedybench
```

**2. Local IP and non-standard port:**
```bash
SPEEDYBENCH_HOST=192.168.1.100 SPEEDYBENCH_PORT=9090 ./speedybench
```

**3. Listening on all interfaces and standard port:**
```bash
SPEEDYBENCH_HOST=all ./speedybench
```

### Option 2: Docker / Docker Compose

You can easily deploy SpeedyBench using Docker Compose. A production-ready `docker-compose.yaml` is provided in the repository.

1. Define your base directory and download the `docker-compose.yaml` file:
   ```bash
   export BASE_DIR="/opt/speedybench"
   mkdir -p "${BASE_DIR}"
   curl -sSL -o "${BASE_DIR}/docker-compose.yaml" https://raw.githubusercontent.com/underhax/speedybench/main/docker/docker-compose.yaml
   ```
2. Start the container:
   ```bash
   docker compose -f "${BASE_DIR}/docker-compose.yaml" up -d
   ```
3. Access the web interface at `http://127.0.0.1:8989`.

To stop and remove the container, run:
```bash
docker compose -f "${BASE_DIR}/docker-compose.yaml" down
```

Alternatively, you can run the image directly with `docker run`:

```bash
docker run -d \
  --name speedybench \
  --hostname speedybench \
  -p 127.0.0.1:8989:8989 \
  --restart always \
  --user 65534:65534 \
  --cpus 1.0 \
  --memory 128m \
  --memory-reservation 32m \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --read-only \
  --tmpfs /tmp:mode=1777,noexec,nosuid \
  --health-cmd "/app/speedybench -healthcheck" \
  --health-interval 30s \
  --health-timeout 5s \
  --health-retries 3 \
  --health-start-period 10s \
  ghcr.io/underhax/speedybench:latest
```

## Reverse Proxy (Nginx)

If you are running SpeedyBench behind an Nginx reverse proxy, you can use the following configuration block:

```nginx
server {
    listen 443 ssl;
    server_name speedybench.example.com;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Security recommendations for TLS
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Disable HTTP/2 for accurate speedybench results on high-speed links
    # (HTTP/2 multiplexing flow control can artificially limit single-stream throughput)
    http2 off;

    location / {
        proxy_pass http://127.0.0.1:8989;

        # SpeedyBench specific optimizations
        client_max_body_size 35m;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_max_temp_file_size 0;

        # Standard proxy headers
        proxy_redirect      off;
        proxy_set_header    X-Real-IP           $remote_addr;
        proxy_set_header    X-Forwarded-For     $proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto   $scheme;
        proxy_set_header    Host                $http_host;
        proxy_set_header    X-NginX-Proxy       true;

        # Optimize keep-alive connections to the backend
        proxy_http_version  1.1;
        proxy_set_header    Connection          "";
    }
}
```

### Hosting on a Non-Root Path (Sub-directory)

If you want to host SpeedyBench under a specific path (e.g., `https://example.com/speedybench/`), you **must** use a trailing slash in the `proxy_pass` directive to strip the prefix before it reaches the backend.

```nginx
    location /speedybench/ {
        proxy_pass http://127.0.0.1:8989/;

        client_max_body_size 35m;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_max_temp_file_size 0;

        proxy_redirect      off;
        proxy_set_header    X-Real-IP           $remote_addr;
        proxy_set_header    X-Forwarded-For     $proxy_add_x_forwarded_for;
        proxy_set_header    X-Forwarded-Proto   $scheme;
        proxy_set_header    Host                $http_host;
        proxy_set_header    X-NginX-Proxy       true;

        proxy_http_version  1.1;
        proxy_set_header    Connection          "";
    }

    location = /speedybench {
        return 301 /speedybench/;
    }
```

## Development

For instructions on how to set up the development environment, build the project from source, or run the test suite, please refer to [DEVELOPMENT](DEVELOPMENT.md).
