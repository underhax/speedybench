# SpeedyBench Development Guide

## Prerequisites

Ensure the following dependencies are installed prior to local development:
- Git
- Go 1.26
- Node.js 26 and npm
- GNU Make
- Docker (required for building the minimal scratch container)
- Biome (required for strict frontend linting and formatting)
- golangci-lint (required for Go code linting)
- trivy (required for container and filesystem security scanning)
- govulncheck (required for Go vulnerability checking)
- hadolint (required for Dockerfile linting)

## Repository Initialization

1. **Clone the repository:**
   ```sh
   git clone https://github.com/underhax/speedybench
   cd speedybench
   ```

2. **Install Biome:**
   Biome must be installed prior to executing local code validation. Please refer to the official documentation for supported installation methods: [https://biomejs.dev/guides/getting-started/#installation](https://biomejs.dev/guides/getting-started/#installation).

3. **Install Go and Security Tooling:**
   Install the required Go linter, vulnerability checker, and security scanners using any convenient method for your platform. These tools are utilized in our CI pipeline and are highly recommended for local code validation prior to submission:
   - **golangci-lint**: [https://golangci-lint.run/docs/welcome/install/](https://golangci-lint.run/docs/welcome/install/)
   - **trivy**: [https://trivy.dev/docs/latest/getting-started/](https://trivy.dev/docs/latest/getting-started/)
   - **govulncheck**: `go install golang.org/x/vuln/cmd/govulncheck@latest`
   - **hadolint**: [https://github.com/hadolint/hadolint#install](https://github.com/hadolint/hadolint#install)

4. **Install frontend dependencies:**
   Prior to local development, execute the following command to securely install frontend dependencies:
   ```sh
   make frontend-install
   ```

## Code Validation & Testing

The project enforces strict code quality standards utilizing multiple tools (e.g., `Biome`, `tsc`, `golangci-lint`, and `gofmt`). All validation steps are centralized in the `Makefile`.

1. **Frontend Linting & Formatting:**
   To execute strict frontend code validation via Biome:
   ```sh
   make frontend-biome
   ```

2. **Vulnerability & Security Scanning:**
   To execute Go vulnerability checks and container/filesystem security scans:
   ```sh
   make backend-vulncheck
   make security-trivy
   ```

3. **Docker Validation:**
   To validate Dockerfile best practices:
   ```sh
   make docker-lint
   ```
   If you have Docker Compose installed locally, you can also manually validate the syntax of your compose files:
   ```sh
   docker compose -f docker/docker-compose.yaml config -q
   docker compose -f docker/docker-compose.dev.yaml config -q
   ```

4. **Code Coverage:**
   To execute the test suites and generate coverage reports for both frontend and backend:
   ```sh
   make coverage
   ```
   Alternatively, you can run coverage individually for each component:
   ```sh
   # Frontend Vitest coverage:
   make frontend-coverage

   # Backend Go test coverage:
   make backend-coverage
   ```

5. **Project Verification:**
   Prior to submitting any pull request, you must execute the primary validation and test suite for both the frontend and backend:
   ```sh
   make verify
   ```

## Build Workflow

The Go backend utilizes the `embed` package to serve compiled frontend assets directly from the `internal/assets/dist` directory. Consequently, the frontend must be compiled before the Go binary is built. The `make build` command automatically orchestrates both processes.

1. **Compile the application:**
   ```sh
   make build
   ```
   This command compiles the production frontend assets via Vite and subsequently builds the Go backend, yielding a standalone `speedybench` executable in the repository root.

2. **Compile with a specific version flag (Optional):**
   A specific version identifier can be injected into the compiled binary via the `VERSION` variable:
   ```sh
   make build VERSION=1.2.3
   ```

3. **Cross-compile for other platforms (Optional):**
   You can compile the application for any of the officially supported release targets by specifying the standard Go environment variables (`GOOS` and `GOARCH`):

   **Linux:**
   ```sh
   GOOS=linux GOARCH=amd64 make build
   GOOS=linux GOARCH=arm64 make build
   ```

   **Windows:**
   ```sh
   GOOS=windows GOARCH=amd64 make build
   GOOS=windows GOARCH=arm64 make build
   ```

   **macOS (Darwin):**
   ```sh
   GOOS=darwin GOARCH=amd64 make build
   GOOS=darwin GOARCH=arm64 make build
   ```

4. **Execute the local server:**
   ```sh
   ./speedybench
   ```
   By default, this command initializes the server on `127.0.0.1:8989`. For detailed execution examples and environment variable configuration (such as custom hosts and ports), please refer to the [Configuration section in README](README.md#configuration).

5. **Enable browser debug logging:**
   ```sh
   SPEEDYBENCH_DEBUG=true ./speedybench
   ```
   When enabled, the server exposes its debug state through `GET /api/config`, which the frontend reads on load. Activating this flag turns on `console.debug` logging in the browser console, where you can inspect runtime values such as worker progress messages, sample data, and tooltip interactions.

6. **Build the Docker image locally:**
   The project includes a multi-stage Dockerfile that compiles both the frontend and backend. You can build the Docker image natively for your local architecture:
   ```sh
   docker build -t speedybench:dev --build-arg VERSION=dev -f docker/Dockerfile .
   ```
   To explicitly cross-compile for another architecture on a modern Docker engine with BuildKit:
   ```sh
   # For ARM64 architecture:
   docker build --platform linux/arm64 -t speedybench:dev --build-arg VERSION=dev -f docker/Dockerfile .

   # For AMD64 architecture:
   docker build --platform linux/amd64 -t speedybench:dev --build-arg VERSION=dev -f docker/Dockerfile .
   ```
   After building, you can execute the local container using the full security profile (matching production):
   ```sh
   docker run --rm \
     --name speedybench-dev \
     --hostname speedybench-dev \
     -p 127.0.0.1:8989:8989 \
     --user 65534:65534 \
     --ulimit nofile=65535:65535 \
     --cpus 1.0 \
     --memory 128m \
     --memory-reservation 32m \
     --security-opt no-new-privileges:true \
     --cap-drop ALL \
     --read-only \
     --tmpfs /tmp:mode=1777,noexec,nosuid \
     speedybench:dev
   ```

   **Alternatively, build and run using Docker Compose:**
   You can utilize the provided development compose file to automatically build and start the container natively with all development settings applied:
   ```sh
   # Build natively for your local architecture:
   docker compose -f docker/docker-compose.dev.yaml build

   # Start the container:
   docker compose -f docker/docker-compose.dev.yaml up
   ```

   To explicitly cross-compile for another architecture using Docker Compose (do not run `up` locally if the target architecture differs from your host system):
   ```sh
   # For ARM64 architecture:
   DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose -f docker/docker-compose.dev.yaml build

   # For AMD64 architecture:
   DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose -f docker/docker-compose.dev.yaml build
   ```

## Makefile Targets Reference

| Target | Description |
| --- | --- |
| `make frontend-install` | Installs frontend dependencies without executing lifecycle scripts. |
| `make frontend-check` | Installs dependencies, performs TypeScript type validation, validates dependency trees, audits for vulnerabilities, and verifies a dry-run production build. |
| `make frontend-biome` | Executes Biome strict linting and formatting checks. |
| `make frontend-biome-fix` | Automatically fixes Biome formatting and safely fixable linting issues. |
| `make frontend-test` | Executes the frontend test suite via Vitest. |
| `make frontend-coverage` | Executes the frontend test suite and generates a coverage report. |
| `make backend-check` | Validates Go code formatting, executes `golangci-lint`, and verifies compilation. |
| `make backend-test` | Executes the Go backend test suite with race condition detection enabled. |
| `make backend-coverage` | Executes the Go backend test suite and generates a coverage report. |
| `make coverage` | Sequentially executes frontend and backend coverage targets and generates comprehensive reports. |
| `make backend-vulncheck` | Analyzes Go source code and binaries for known vulnerabilities using `govulncheck`. |
| `make docker-lint` | Lints the `Dockerfile` via `hadolint`. |
| `make security-trivy` | Scans the repository for critical and high severity vulnerabilities using `trivy`. |
| `make verify` | Sequentially executes frontend and backend validation and testing targets. **Must be executed prior to submitting a pull request.** |
| `make build` | Compiles the production frontend assets and the Go backend executable. Accepts an optional `VERSION` variable, as well as standard `GOOS` and `GOARCH` variables for cross-compilation. |
