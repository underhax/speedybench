// Package main launches the SpeedyBench HTTP server with graceful shutdown support.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/underhax/speedybench/internal/api"
	"github.com/underhax/speedybench/internal/assets"
	"github.com/underhax/speedybench/internal/updater"
)

// Version indicates the current build version, overwritten during compilation.
var Version = "dev"

func defaultUpdate(ctx context.Context, client *http.Client, currentVersion string) error {
	if err := updater.Update(ctx, client, currentVersion); err != nil {
		return fmt.Errorf("updater: %w", err)
	}
	return nil
}

var executeUpdate = defaultUpdate
var executeHealthcheck = runHealthcheck
var cleanupWindows = updater.CleanupWindowsOldFiles
var stdout io.Writer = os.Stdout

func defaultSubFS(fsys fs.FS, dir string) (fs.FS, error) {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		return nil, fmt.Errorf("sub fs error: %w", err)
	}
	return sub, nil
}

var subFS = defaultSubFS

func defaultWithTimeout(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, timeout)
}

var withTimeout = defaultWithTimeout

func defaultShutdownServer(ctx context.Context, srv *http.Server) error {
	if err := srv.Shutdown(ctx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}

var shutdownServer = defaultShutdownServer
var runFunc = run
var logFatalf = log.Fatalf

func main() {
	cleanupWindows()
	if err := runFunc(os.Args[1:], os.Getenv, os.Interrupt, syscall.SIGTERM); err != nil {
		logFatalf("Fatal error: %v", err)
	}
}

type appConfig struct {
	host        string
	port        string
	healthcheck bool
	inDocker    bool
	debug       bool
	maxConns    int
}

func checkCommands(args []string, out io.Writer) (bool, error) {
	if len(args) == 0 {
		return false, nil
	}

	switch args[0] {
	case "update":
		ctx, cancel := withTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := executeUpdate(ctx, http.DefaultClient, Version); err != nil {
			return true, fmt.Errorf("update failed: %w", err)
		}
		return true, nil
	case "help", "-h", "--help", "-help":
		printUsage(out)
		return true, nil
	case "version", "-v", "--version", "-version":
		if _, err := fmt.Fprintln(out, Version); err != nil {
			return true, fmt.Errorf("print version: %w", err)
		}
		return true, nil
	}

	return false, nil
}

func parseOptionalBool(getenv func(string) string, name string) (bool, error) {
	value := getenv(name)
	if value == "" {
		return false, nil
	}

	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("parse %s: %w", name, err)
	}
	return parsed, nil
}

func parseHost(getenv func(string) string) (string, error) {
	host := getenv("SPEEDYBENCH_HOST")
	switch host {
	case "":
		return "127.0.0.1", nil
	case "all":
		return "", nil
	default:
		if net.ParseIP(host) == nil {
			return "", errors.New("invalid SPEEDYBENCH_HOST - must be 'all' or a valid IP address")
		}
		return host, nil
	}
}

func parsePort(getenv func(string) string) (string, error) {
	port := getenv("SPEEDYBENCH_PORT")
	if port == "" {
		port = "8989"
	}
	portNum, portErr := strconv.Atoi(port)
	if portErr != nil || portNum <= 1024 || portNum > 65535 {
		return "", errors.New("invalid SPEEDYBENCH_PORT - must be a number between 1025 and 65535")
	}
	return port, nil
}

func parseConfig(args []string, getenv func(string) string) (cfg appConfig, err error) {
	flags := flag.NewFlagSet("speedybench", flag.ContinueOnError)
	hc := flags.Bool("healthcheck", false, "Run healthcheck against the local server")

	if parseErr := flags.Parse(args); parseErr != nil {
		return cfg, fmt.Errorf("parse flags: %w", parseErr)
	}
	cfg.healthcheck = *hc

	cfg.port, err = parsePort(getenv)
	if err != nil {
		return cfg, err
	}

	cfg.host, err = parseHost(getenv)
	if err != nil {
		return cfg, err
	}

	inDocker, err := parseOptionalBool(getenv, "SPEEDYBENCH_IN_DOCKER")
	if err != nil {
		return cfg, fmt.Errorf("invalid SPEEDYBENCH_IN_DOCKER - must be a boolean: %w", err)
	}
	cfg.inDocker = inDocker

	debug, err := parseOptionalBool(getenv, "SPEEDYBENCH_DEBUG")
	if err != nil {
		return cfg, fmt.Errorf("invalid SPEEDYBENCH_DEBUG - must be a boolean: %w", err)
	}
	cfg.debug = debug

	cfg.maxConns = 100
	maxConnsStr := getenv("SPEEDYBENCH_MAX_CONNS")
	if maxConnsStr != "" {
		maxConns, parseErr := strconv.Atoi(maxConnsStr)
		if parseErr != nil || maxConns < 6 || maxConns > 65535 {
			return cfg, errors.New("invalid SPEEDYBENCH_MAX_CONNS - must be an integer between 6 and 65535")
		}
		cfg.maxConns = maxConns
	}

	return cfg, nil
}

func run(args []string, getenv func(string) string, sigs ...os.Signal) error {
	if handled, err := checkCommands(args, stdout); handled {
		return err
	}

	cfg, err := parseConfig(args, getenv)
	if err != nil {
		return err
	}

	if cfg.healthcheck {
		ctx, cancel := withTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if checkErr := executeHealthcheck(ctx, cfg.port, http.DefaultClient); checkErr != nil {
			return fmt.Errorf("healthcheck failed: %w", checkErr)
		}
		return nil
	}

	mux := http.NewServeMux()

	fSys, err := subFS(assets.Assets, "dist")
	if err != nil {
		return fmt.Errorf("failed to initialize embedded frontend assets: %w", err)
	}

	apiHandler := api.NewHandlerWithDebug(fSys, cfg.maxConns, cfg.debug)
	apiHandler.RegisterRoutes(mux)

	secureMux := securePathMiddleware(mux)

	server := &http.Server{
		Addr:              net.JoinHostPort(cfg.host, cfg.port),
		Handler:           secureMux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       35 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errChan := make(chan error, 1)
	go func() {
		log.Printf("Starting server on %s (Version: %s)", server.Addr, Version)
		if !cfg.inDocker {
			fmt.Println("Press Ctrl+C to exit")
		}
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errChan <- fmt.Errorf("server failed: %w", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	if len(sigs) > 0 {
		signal.Notify(quit, sigs...)
	}

	select {
	case err := <-errChan:
		return err
	case <-quit:
		log.Println("Shutting down server...")
	}

	ctx, cancel := withTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := shutdownServer(ctx, server); err != nil {
		return fmt.Errorf("server forced to shutdown: %w", err)
	}

	log.Println("Server exiting")
	return nil
}

func runHealthcheck(ctx context.Context, portStr string, client *http.Client) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1/api/ip", http.NoBody)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.URL.Host = net.JoinHostPort("127.0.0.1", portStr)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("Healthcheck body close error: %v", closeErr)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unhealthy status code: %d", resp.StatusCode)
	}
	return nil
}

func securePathMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		if len(path) > 256 {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}

		if strings.Contains(r.RequestURI, "//") || strings.Contains(r.RequestURI, "..") {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}

		for i := range path {
			c := path[i]
			valid := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '/' || c == '-' || c == '.' || c == '_'
			if !valid {
				http.Error(w, "Bad Request", http.StatusBadRequest)
				return
			}
		}

		next.ServeHTTP(w, r)
	})
}
