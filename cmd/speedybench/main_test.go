package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
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

func getFreePort(t *testing.T) string {
	t.Helper()
	lc := net.ListenConfig{}
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to get free port: %v", err)
	}
	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("expected *net.TCPAddr, got %T", ln.Addr())
	}
	port := strconv.Itoa(tcpAddr.Port)
	if closeErr := ln.Close(); closeErr != nil {
		t.Logf("failed to close free port listener: %v", closeErr)
	}
	return port
}

func TestRun(t *testing.T) {
	portHealthcheckFail := getFreePort(t)
	portGraceful := getFreePort(t)
	portServerFail := getFreePort(t)

	tests := []struct {
		setup   func(t *testing.T) (teardown func())
		name    string
		port    string
		host    string
		args    []string
		sigs    []os.Signal
		wantErr bool
	}{
		{
			name:    "invalid_flag",
			args:    []string{"-invalid-flag"},
			wantErr: true,
		},
		{
			name:    "invalid_port",
			port:    "invalid",
			wantErr: true,
		},
		{
			name:    "invalid_port_range",
			port:    "99999",
			wantErr: true,
		},
		{
			name:    "healthcheck_fail",
			args:    []string{"-healthcheck"},
			port:    portHealthcheckFail,
			wantErr: true,
		},
		{
			name: "graceful_shutdown",
			port: portGraceful,
			setup: func(_ *testing.T) func() {
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
				return func() { close(done) }
			},
			sigs:    []os.Signal{syscall.SIGTERM},
			wantErr: false,
		},
		{
			name: "server_fail",
			port: portServerFail,
			setup: func(t *testing.T) func() {
				lc := net.ListenConfig{}
				ln, err := lc.Listen(context.Background(), "tcp", net.JoinHostPort("localhost", portServerFail))
				if err != nil {
					t.Fatalf("listen error: %v", err)
				}
				return func() {
					if closeErr := ln.Close(); closeErr != nil {
						t.Logf("close error: %v", closeErr)
					}
				}
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				teardown := tt.setup(t)
				defer teardown()
			}
			err := run(tt.args, func(s string) string {
				if s == "SPEEDYBENCH_PORT" {
					return tt.port
				}
				if s == "SPEEDYBENCH_HOST" {
					return tt.host
				}
				return ""
			}, tt.sigs...)
			if tt.wantErr && err == nil {
				t.Errorf("expected error, got nil")
			} else if !tt.wantErr && err != nil {
				t.Errorf("expected no error, got %v", err)
			}
		})
	}
}

func TestRunEdgeCases(t *testing.T) {
	portShutdownError := getFreePort(t)

	tests := []struct {
		setup    func(t *testing.T) func()
		checkErr func(t *testing.T, err error)
		name     string
		port     string
		args     []string
		sigs     []os.Signal
	}{
		{
			name: "healthcheck_success",
			args: []string{"-healthcheck"},
			port: "8989",
			setup: func(_ *testing.T) func() {
				oldExecuteHealthcheck := executeHealthcheck
				executeHealthcheck = func(_ context.Context, _ string, _ *http.Client) error {
					return nil
				}
				return func() { executeHealthcheck = oldExecuteHealthcheck }
			},
			checkErr: func(t *testing.T, err error) {
				if err != nil {
					t.Errorf("expected no error for successful healthcheck, got %v", err)
				}
			},
		},
		{
			name: "fssub_error",
			port: "8989",
			setup: func(_ *testing.T) func() {
				oldSubFS := subFS
				subFS = func(_ fs.FS, _ string) (fs.FS, error) {
					return nil, errors.New("mock subfs error")
				}
				return func() { subFS = oldSubFS }
			},
			checkErr: func(t *testing.T, err error) {
				if err == nil || err.Error() != "failed to initialize embedded frontend assets: mock subfs error" {
					t.Errorf("expected subfs error, got %v", err)
				}
			},
		},
		{
			name: "shutdown_error",
			port: portShutdownError,
			setup: func(_ *testing.T) func() {
				oldShutdownServer := shutdownServer
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
				return func() {
					shutdownServer = oldShutdownServer
					close(done)
				}
			},
			sigs: []os.Signal{syscall.SIGTERM},
			checkErr: func(t *testing.T, err error) {
				if err == nil || err.Error() != "server forced to shutdown: mock shutdown error" {
					t.Errorf("expected mock shutdown error, got %v", err)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				teardown := tt.setup(t)
				defer teardown()
			}
			err := run(tt.args, func(s string) string {
				if s == "SPEEDYBENCH_PORT" {
					return tt.port
				}
				return ""
			}, tt.sigs...)
			if tt.checkErr != nil {
				tt.checkErr(t, err)
			}
		})
	}
}

func TestParseConfig(t *testing.T) {
	tests := []struct {
		name         string
		hostEnv      string
		dockerEnv    string
		maxConnsEnv  string
		wantHost     string
		wantMaxConns int
		wantDocker   bool
		wantError    bool
	}{
		{
			name:      "default_port_and_all_host",
			hostEnv:   "all",
			wantHost:  "",
			wantError: false,
		},
		{
			name:      "invalid_host",
			hostEnv:   "!!!garbage!!!",
			wantError: true,
		},
		{
			name:      "valid_host_ip",
			hostEnv:   "192.168.1.1",
			wantHost:  "192.168.1.1",
			wantError: false,
		},
		{
			name:      "invalid_hostname",
			hostEnv:   "my-server.local",
			wantError: true,
		},
		{
			name:       "valid_docker_env",
			hostEnv:    "0.0.0.0",
			dockerEnv:  "true",
			wantHost:   "0.0.0.0",
			wantDocker: true,
			wantError:  false,
		},
		{
			name:         "invalid_docker_env",
			hostEnv:      "10.0.0.1",
			dockerEnv:    "not_a_bool",
			wantMaxConns: 100,
			wantError:    true,
		},
		{
			name:         "valid_max_conns_edge",
			maxConnsEnv:  "6",
			wantMaxConns: 6,
			wantError:    false,
		},
		{
			name:         "valid_max_conns",
			maxConnsEnv:  "150",
			wantMaxConns: 150,
			wantError:    false,
		},
		{
			name:         "invalid_max_conns_under_limit",
			maxConnsEnv:  "5",
			wantMaxConns: 100,
			wantError:    true,
		},
		{
			name:         "invalid_max_conns_over_limit",
			maxConnsEnv:  "65536",
			wantMaxConns: 100,
			wantError:    true,
		},
		{
			name:         "invalid_max_conns_string",
			maxConnsEnv:  "not_a_number",
			wantMaxConns: 100,
			wantError:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := parseConfig([]string{}, func(s string) string {
				if s == "SPEEDYBENCH_HOST" {
					return tt.hostEnv
				}
				if s == "SPEEDYBENCH_IN_DOCKER" {
					return tt.dockerEnv
				}
				if s == "SPEEDYBENCH_MAX_CONNS" {
					return tt.maxConnsEnv
				}
				return ""
			})
			if tt.wantError {
				if err == nil {
					t.Errorf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Errorf("expected no error, got %v", err)
			}
			expectedHost := tt.wantHost
			if tt.hostEnv == "" {
				expectedHost = "127.0.0.1"
			}
			if cfg.host != expectedHost {
				t.Errorf("expected host %q, got %q", expectedHost, cfg.host)
			}
			if cfg.port != "8989" {
				t.Errorf("expected port to be 8989, got %q", cfg.port)
			}
			if cfg.healthcheck != false {
				t.Errorf("expected healthcheck to be false, got %v", cfg.healthcheck)
			}
			if cfg.inDocker != tt.wantDocker {
				t.Errorf("expected inDocker to be %v, got %v", tt.wantDocker, cfg.inDocker)
			}
			expectedMaxConns := tt.wantMaxConns
			if expectedMaxConns == 0 {
				expectedMaxConns = 100
			}
			if cfg.maxConns != expectedMaxConns {
				t.Errorf("expected maxConns to be %v, got %v", expectedMaxConns, cfg.maxConns)
			}
		})
	}
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

func TestSecurePathMiddleware(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		requestURI string
		wantStatus int
	}{
		{
			name:       "valid_root",
			path:       "/",
			requestURI: "/",
			wantStatus: http.StatusOK,
		},
		{
			name:       "valid_api",
			path:       "/api/ip",
			requestURI: "/api/ip",
			wantStatus: http.StatusOK,
		},
		{
			name:       "valid_assets",
			path:       "/assets/main-123_abc.js",
			requestURI: "/assets/main-123_abc.js",
			wantStatus: http.StatusOK,
		},
		{
			name:       "double_slash",
			path:       "//api/ip",
			requestURI: "//api/ip",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "directory_traversal",
			path:       "/assets/../main.js",
			requestURI: "/assets/../main.js",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "null_byte",
			path:       "/api/ip\x00",
			requestURI: "/api/ip\x00",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid_char_space",
			path:       "/api/ip ",
			requestURI: "/api/ip ",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "invalid_char_quotes",
			path:       "/api/\"ip\"",
			requestURI: "/api/\"ip\"",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "path_too_long",
			path:       "/" + string(make([]byte, 257)),
			requestURI: "/" + string(make([]byte, 257)),
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := securePathMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))

			req := &http.Request{
				URL: &url.URL{
					Path: tt.path,
				},
				RequestURI: tt.requestURI,
			}

			rw := &mockResponseWriter{
				header: make(http.Header),
			}

			handler.ServeHTTP(rw, req)

			if rw.statusCode != tt.wantStatus {
				t.Errorf("expected status %d, got %d", tt.wantStatus, rw.statusCode)
			}
		})
	}
}

type mockResponseWriter struct {
	header     http.Header
	statusCode int
}

func (m *mockResponseWriter) Header() http.Header {
	return m.header
}

func (m *mockResponseWriter) Write(b []byte) (int, error) {
	return len(b), nil
}

func (m *mockResponseWriter) WriteHeader(statusCode int) {
	m.statusCode = statusCode
}
