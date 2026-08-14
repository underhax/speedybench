package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"syscall"
	"testing"
	"time"
)

type mockTransport struct {
	roundTripFunc func(req *http.Request) (*http.Response, error)
}

func (m *mockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return m.roundTripFunc(req)
}

type errReader struct{}

func (errReader) Read(_ []byte) (n int, err error) {
	return 0, errors.New("read error")
}
func (errReader) Close() error {
	return errors.New("close error")
}

func TestRunHealthcheck(t *testing.T) {
	t.Run("healthy", func(t *testing.T) {
		client := &http.Client{
			Transport: &mockTransport{
				roundTripFunc: func(_ *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusOK,
						Body:       io.NopCloser(bytes.NewReader(nil)),
					}, nil
				},
			},
		}
		if err := runHealthcheck(context.Background(), "8989", client); err != nil {
			t.Errorf("expected no error, got %v", err)
		}
	})

	t.Run("unhealthy_status", func(t *testing.T) {
		client := &http.Client{
			Transport: &mockTransport{
				roundTripFunc: func(_ *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusInternalServerError,
						Body:       io.NopCloser(bytes.NewReader(nil)),
					}, nil
				},
			},
		}
		if err := runHealthcheck(context.Background(), "8989", client); err == nil {
			t.Errorf("expected error, got nil")
		}
	})

	t.Run("client_error", func(t *testing.T) {
		client := &http.Client{
			Transport: &mockTransport{
				roundTripFunc: func(_ *http.Request) (*http.Response, error) {
					return nil, errors.New("network error")
				},
			},
		}
		if err := runHealthcheck(context.Background(), "8989", client); err == nil {
			t.Errorf("expected error, got nil")
		}
	})

	t.Run("close_error", func(t *testing.T) {
		client := &http.Client{
			Transport: &mockTransport{
				roundTripFunc: func(_ *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusOK,
						Body:       errReader{},
					}, nil
				},
			},
		}
		if err := runHealthcheck(context.Background(), "8989", client); err != nil {
			t.Errorf("expected no error, got %v", err)
		}
	})

	t.Run("req_error", func(t *testing.T) {
		var nilCtx context.Context
		if err := runHealthcheck(nilCtx, "8989", &http.Client{}); err == nil {
			t.Errorf("expected error, got nil")
		}
	})
}

func TestRun(t *testing.T) {
	t.Run("invalid_flag", func(t *testing.T) {
		err := run([]string{"-invalid-flag"}, func(_ string) string { return "" })
		if err == nil {
			t.Errorf("expected error for invalid flag")
		}
	})

	t.Run("invalid_port", func(t *testing.T) {
		err := run([]string{}, func(_ string) string { return "invalid" })
		if err == nil {
			t.Errorf("expected error for invalid port")
		}
	})

	t.Run("invalid_port_range", func(t *testing.T) {
		err := run([]string{}, func(_ string) string { return "99999" })
		if err == nil {
			t.Errorf("expected error for out of range port")
		}
	})

	t.Run("healthcheck_fail", func(t *testing.T) {
		err := run([]string{"-healthcheck"}, func(_ string) string { return "8989" })
		if err == nil {
			t.Errorf("expected error since server is not actually running on 8989 in this test environment")
		}
	})

	t.Run("graceful_shutdown", func(t *testing.T) {
		done := make(chan bool)
		go func() {
			select {
			case <-time.After(100 * time.Millisecond):
				if err := syscall.Kill(syscall.Getpid(), syscall.SIGTERM); err != nil {
					panic(err)
				}
			case <-done:
			}
		}()
		defer close(done)

		err := run([]string{}, func(s string) string {
			if s == "SPEEDYBENCH_PORT" {
				return "54321"
			}
			return ""
		}, syscall.SIGTERM)
		if err != nil {
			t.Errorf("expected graceful shutdown without error, got %v", err)
		}
	})

	t.Run("server_fail", func(t *testing.T) {
		lc := net.ListenConfig{}
		ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:54322")
		if err == nil {
			defer func() {
				if closeErr := ln.Close(); closeErr != nil {
					t.Logf("close error: %v", closeErr)
				}
			}()
		}
		err = run([]string{}, func(s string) string {
			if s == "SPEEDYBENCH_HOST" {
				return "127.0.0.1"
			}
			return "54322"
		})
		if err == nil {
			t.Errorf("expected error due to port already in use, got nil")
		}
	})
}

func TestRunEdgeCases(t *testing.T) {
	t.Run("healthcheck_success", func(t *testing.T) {
		oldExecuteHealthcheck := executeHealthcheck
		defer func() { executeHealthcheck = oldExecuteHealthcheck }()
		executeHealthcheck = func(_ context.Context, _ string, _ *http.Client) error {
			return nil
		}
		err := run([]string{"-healthcheck"}, func(_ string) string { return "8989" })
		if err != nil {
			t.Errorf("expected no error for successful healthcheck, got %v", err)
		}
	})

	t.Run("fssub_error", func(t *testing.T) {
		oldSubFS := subFS
		defer func() { subFS = oldSubFS }()
		subFS = func(_ fs.FS, _ string) (fs.FS, error) {
			return nil, errors.New("mock subfs error")
		}
		err := run([]string{}, func(_ string) string { return "8989" })
		if err == nil || err.Error() != "failed to initialize embedded frontend assets: mock subfs error" {
			t.Errorf("expected subfs error, got %v", err)
		}
	})

	t.Run("shutdown_error", func(t *testing.T) {
		oldShutdownServer := shutdownServer
		defer func() { shutdownServer = oldShutdownServer }()
		shutdownServer = func(_ context.Context, _ *http.Server) error {
			return errors.New("mock shutdown error")
		}

		done := make(chan bool)
		go func() {
			select {
			case <-time.After(100 * time.Millisecond):
				if err := syscall.Kill(syscall.Getpid(), syscall.SIGTERM); err != nil {
					panic(err)
				}
			case <-done:
			}
		}()
		defer close(done)

		err := run([]string{}, func(s string) string {
			if s == "SPEEDYBENCH_PORT" {
				return "54330"
			}
			return ""
		}, syscall.SIGTERM)
		if err == nil || err.Error() != "server forced to shutdown: mock shutdown error" {
			t.Errorf("expected mock shutdown error, got %v", err)
		}
	})
}

func TestParseConfig(t *testing.T) {
	t.Run("default_port_and_all_host", func(t *testing.T) {
		host, port, healthcheck, err := parseConfig([]string{}, func(s string) string {
			if s == "SPEEDYBENCH_HOST" {
				return "all"
			}
			return ""
		})
		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}
		if host != "" {
			t.Errorf("expected host to be empty, got %q", host)
		}
		if port != "8989" {
			t.Errorf("expected port to be 8989, got %q", port)
		}
		if healthcheck != false {
			t.Errorf("expected healthcheck to be false, got %v", healthcheck)
		}
	})
}

type dummyFS struct{}

func (dummyFS) Open(_ string) (fs.File, error) {
	return nil, errors.New("not implemented")
}

func TestDefaultSubFS(t *testing.T) {
	_, err := defaultSubFS(dummyFS{}, "../invalid")
	if err == nil {
		t.Errorf("expected error for invalid dir, got nil")
	}
}

type oneConnListener struct {
	conn net.Conn
	done chan struct{}
}

func newOneConnListener(conn net.Conn) *oneConnListener {
	return &oneConnListener{conn: conn, done: make(chan struct{})}
}

func (l *oneConnListener) Accept() (net.Conn, error) {
	if l.conn != nil {
		c := l.conn
		l.conn = nil
		return c, nil
	}
	<-l.done
	return nil, errors.New("listener closed")
}

func (l *oneConnListener) Close() error {
	close(l.done)
	return nil
}

func (l *oneConnListener) Addr() net.Addr {
	return &net.TCPAddr{}
}

func TestDefaultShutdownServer(t *testing.T) {
	accepted := make(chan struct{}, 1)
	srv := &http.Server{
		ReadHeaderTimeout: time.Second,
		ConnState: func(_ net.Conn, state http.ConnState) {
			if state == http.StateNew {
				select {
				case accepted <- struct{}{}:
				default:
				}
			}
		},
	}

	client, server := net.Pipe()
	defer func() {
		if closeErr := client.Close(); closeErr != nil {
			t.Logf("close err: %v", closeErr)
		}
	}()

	ln := newOneConnListener(server)

	go func() {
		if serveErr := srv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			panic(serveErr)
		}
	}()

	<-accepted

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := defaultShutdownServer(ctx, srv)
	if err == nil || !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestMainFunc(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		oldRunFunc := runFunc
		defer func() { runFunc = oldRunFunc }()
		runFunc = func(_ []string, _ func(string) string, _ ...os.Signal) error {
			return nil
		}

		oldLogFatalf := logFatalf
		defer func() { logFatalf = oldLogFatalf }()
		fatalCalled := false
		logFatalf = func(_ string, _ ...any) {
			fatalCalled = true
		}

		main()
		if fatalCalled {
			t.Errorf("expected logFatalf not to be called")
		}
	})

	t.Run("error", func(t *testing.T) {
		oldRunFunc := runFunc
		defer func() { runFunc = oldRunFunc }()
		runFunc = func(_ []string, _ func(string) string, _ ...os.Signal) error {
			return errors.New("mock error")
		}

		oldLogFatalf := logFatalf
		defer func() { logFatalf = oldLogFatalf }()
		fatalCalled := false
		logFatalf = func(_ string, _ ...any) {
			fatalCalled = true
		}

		main()
		if !fatalCalled {
			t.Errorf("expected logFatalf to be called")
		}
	})
}
