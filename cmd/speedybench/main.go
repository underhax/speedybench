// Package main launches the SpeedyBench HTTP server with graceful shutdown support.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/underhax/speedybench/internal/api"
	"github.com/underhax/speedybench/internal/assets"
)

// Version indicates the current build version, overwritten during compilation.
var Version = "dev"

var executeHealthcheck = runHealthcheck

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
	if err := runFunc(os.Args[1:], os.Getenv, os.Interrupt, syscall.SIGTERM); err != nil {
		logFatalf("Fatal error: %v", err)
	}
}

func parseConfig(args []string, getenv func(string) string) (host, port string, healthcheck bool, err error) {
	flags := flag.NewFlagSet("speedybench", flag.ContinueOnError)
	hc := flags.Bool("healthcheck", false, "Run healthcheck against the local server")

	if err := flags.Parse(args); err != nil {
		return "", "", false, fmt.Errorf("parse flags: %w", err)
	}

	port = getenv("SPEEDYBENCH_PORT")
	if port == "" {
		port = "8989"
	}
	if p, err := strconv.Atoi(port); err != nil || p <= 1024 || p > 65535 {
		return "", "", false, errors.New("invalid SPEEDYBENCH_PORT: must be a number between 1025 and 65535")
	}

	host = getenv("SPEEDYBENCH_HOST")
	switch host {
	case "":
		host = "127.0.0.1"
	case "all":
		host = ""
	}

	return host, port, *hc, nil
}

func run(args []string, getenv func(string) string, sigs ...os.Signal) error {
	host, port, healthcheck, err := parseConfig(args, getenv)
	if err != nil {
		return err
	}

	if healthcheck {
		ctx, cancel := withTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if checkErr := executeHealthcheck(ctx, port, http.DefaultClient); checkErr != nil {
			return fmt.Errorf("healthcheck failed: %w", checkErr)
		}
		return nil
	}

	mux := http.NewServeMux()

	fSys, err := subFS(assets.Assets, "dist")
	if err != nil {
		return fmt.Errorf("failed to initialize embedded frontend assets: %w", err)
	}

	apiHandler := api.NewHandler(fSys)
	apiHandler.RegisterRoutes(mux)

	server := &http.Server{
		Addr:         net.JoinHostPort(host, port),
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	errChan := make(chan error, 1)
	go func() {
		log.Printf("Starting server on %s (Version: %s)", server.Addr, Version)
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
