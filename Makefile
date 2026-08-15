VERSION ?= dev

.PHONY: frontend-install frontend-check frontend-biome frontend-biome-fix frontend-test frontend-coverage backend-check backend-test backend-coverage backend-vulncheck docker-lint security-trivy verify build

frontend-install:
	npm --prefix frontend ci --ignore-scripts

frontend-biome:
	cd frontend && biome check src

frontend-biome-fix:
	cd frontend && biome check --write src

frontend-check:
	npm --prefix frontend ci --ignore-scripts
	npm --prefix frontend exec -- tsc --project frontend/tsconfig.json --noEmit
	npm --prefix frontend ls --all
	npm --prefix frontend audit
	npm --prefix frontend audit --omit=dev
	output_dir=$$(mktemp -d); \
	trap 'rm -rf "$$output_dir"' EXIT; \
	cd frontend && npx --no-install vite build --outDir "$$output_dir" --emptyOutDir

frontend-test:
	npm --prefix frontend ci --ignore-scripts
	npm --prefix frontend test

frontend-coverage:
	npm --prefix frontend ci --ignore-scripts
	npm --prefix frontend run coverage

backend-check:
	@test -z "$$(gofmt -s -l .)" || (echo "Unformatted files found. Run 'gofmt -s -w .' to fix them." && false)
	golangci-lint run ./...
	go build ./...

backend-test:
	go test -v -race ./...

backend-coverage:
	go test -v -race -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

backend-vulncheck:
	govulncheck ./...

docker-lint:
	hadolint docker/Dockerfile

security-trivy:
	trivy fs --severity CRITICAL,HIGH .

verify: frontend-check frontend-biome frontend-test backend-check backend-vulncheck backend-test security-trivy docker-lint

build:
	npm --prefix frontend ci --ignore-scripts
	npm --prefix frontend run build
	go build -ldflags "-s -w -X main.Version=$(VERSION)" -o speedybench ./cmd/speedybench
