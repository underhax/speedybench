package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
)

func TestNewHandler(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.assetFS == nil {
		t.Error("assetFS is nil")
	}
	bufPtr, ok := h.garbagePool.Get().(*[]byte)
	if !ok || bufPtr == nil || len(*bufPtr) != 1024*1024 {
		t.Error("garbagePool did not allocate correctly")
	}
	h.garbagePool.Put(bufPtr)
}

func TestNewHandler_WithScripts(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html": {Data: []byte(`<script>console.log("hello");</script>`)},
	}
	h := NewHandler(fsys)
	if !strings.Contains(h.cspHeader, "sha256-") {
		t.Errorf("expected cspHeader to contain sha256 hash, got %s", h.cspHeader)
	}
}

func TestRegisterRoutes(t *testing.T) {
	mux := http.NewServeMux()
	h := NewHandler(fstest.MapFS{})
	h.RegisterRoutes(mux)

	tests := []struct {
		path string
	}{
		{"/"},
		{"/api/garbage"},
		{"/api/empty"},
		{"/api/ip"},
	}

	for _, tt := range tests {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, tt.path, http.NoBody)
		_, pattern := mux.Handler(req)
		if pattern == "" {
			t.Errorf("route not registered: %s", tt.path)
		}
	}
}

func TestHandleIndex(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html": {Data: []byte("<html><body>SpeedyBench</body></html>")},
	}
	h := NewHandler(fsys)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", http.NoBody)
	rr := httptest.NewRecorder()

	h.handleIndex(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
	}
	if got := rr.Body.String(); got != "<html><body>SpeedyBench</body></html>" {
		t.Errorf("body: got %q want %q", got, "<html><body>SpeedyBench</body></html>")
	}

	req404 := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/notfound", http.NoBody)
	rr404 := httptest.NewRecorder()
	h.handleIndex(rr404, req404)
	if rr404.Code != http.StatusNotFound {
		t.Errorf("404 status: got %d want %d", rr404.Code, http.StatusNotFound)
	}
}

func TestHandleGarbage(t *testing.T) {
	h := NewHandler(fstest.MapFS{})

	tests := []struct {
		name         string
		query        string
		expectedCode int
		expectedSize int
	}{
		{"default", "", http.StatusOK, 100 * 1024 * 1024},
		{"valid_size", "?size=5", http.StatusOK, 5 * 1024 * 1024},
		{"fallback_ckSize", "?ckSize=5", http.StatusOK, 5 * 1024 * 1024},
		{"invalid", "?size=abc", http.StatusBadRequest, 0},
		{"negative", "?size=-10", http.StatusBadRequest, 0},
		{"too_large", "?size=1001", http.StatusBadRequest, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/garbage"+tt.query, http.NoBody)
			dw := &discardResponseWriter{}
			h.handleGarbage(dw, req)

			status := dw.code
			if status == 0 {
				status = http.StatusOK
			}
			if status != tt.expectedCode {
				t.Errorf("handler returned wrong status code: got %v want %v", status, tt.expectedCode)
			}
			if tt.expectedCode == http.StatusOK && dw.size != tt.expectedSize {
				t.Errorf("handler returned wrong body size: got %v want %v", dw.size, tt.expectedSize)
			}
		})
	}
}

type discardResponseWriter struct {
	header http.Header
	code   int
	size   int
}

func (w *discardResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *discardResponseWriter) Write(b []byte) (int, error) {
	w.size += len(b)
	return len(b), nil
}

func (w *discardResponseWriter) WriteHeader(statusCode int) {
	w.code = statusCode
}

func (w *discardResponseWriter) Flush() {}

func TestHandleGarbageContextCancel(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/garbage?ckSize=10", http.NoBody)

	rr := httptest.NewRecorder()
	h.handleGarbage(rr, req)

	if len(rr.Body.Bytes()) > 0 {
		t.Errorf("handler aborted but got body size %v", len(rr.Body.Bytes()))
	}
}

type errWriter struct{}

func (e *errWriter) Write(_ []byte) (int, error) {
	return 0, io.ErrClosedPipe
}

func (e *errWriter) Header() http.Header {
	return http.Header{}
}

func (e *errWriter) WriteHeader(_ int) {}
func (e *errWriter) Flush()            {}

func TestHandleGarbageWriteError(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/garbage?ckSize=10", http.NoBody)
	ew := &errWriter{}
	h.handleGarbage(ew, req)
	t.Log("handleGarbage returned after write error")
}

func TestHandleEmpty(t *testing.T) {
	h := NewHandler(fstest.MapFS{})

	tests := []struct {
		body         io.Reader
		name         string
		method       string
		expectedCode int
	}{
		{bytes.NewBufferString("test data"), "valid_post", http.MethodPost, http.StatusOK},
		{http.NoBody, "valid_head", http.MethodHead, http.StatusOK},
		{http.NoBody, "invalid_method", http.MethodGet, http.StatusMethodNotAllowed},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), tt.method, "/api/empty", tt.body)
			rr := httptest.NewRecorder()
			h.handleEmpty(rr, req)

			if status := rr.Code; status != tt.expectedCode {
				t.Errorf("handler returned wrong status code: got %v want %v", status, tt.expectedCode)
			}
		})
	}
}

type mockErrReader struct {
	err error
}

func (m *mockErrReader) Read(_ []byte) (n int, err error) {
	return 0, m.err
}

func TestHandleEmptyReadError(t *testing.T) {
	h := NewHandler(fstest.MapFS{})

	tests := []struct {
		err  error
		name string
	}{
		{context.Canceled, "context_canceled"},
		{io.ErrUnexpectedEOF, "unexpected_eof"},
		{errors.New("generic read error"), "generic_error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/empty", &mockErrReader{err: tt.err})
			rr := httptest.NewRecorder()
			h.handleEmpty(rr, req)

			if rr.Code != http.StatusOK {
				t.Errorf("handler returned wrong status code: got %v want %v", rr.Code, http.StatusOK)
			}
		})
	}
}

func TestGetClientIP(t *testing.T) {
	h := NewHandler(fstest.MapFS{})

	tests := []struct {
		headers    map[string]string
		name       string
		remoteAddr string
		expected   string
	}{
		{
			headers:    map[string]string{"X-Real-IP": "203.0.113.1"},
			name:       "x_real_ip",
			remoteAddr: "192.0.2.1:1234",
			expected:   "203.0.113.1",
		},
		{
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.2"},
			name:       "x_forwarded_for_single",
			remoteAddr: "192.0.2.2:5678",
			expected:   "203.0.113.2",
		},
		{
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.3, 198.51.100.1"},
			name:       "x_forwarded_for_multiple",
			remoteAddr: "192.0.2.3:9012",
			expected:   "203.0.113.3",
		},
		{
			headers:    map[string]string{},
			name:       "fallback_remote_addr_with_port",
			remoteAddr: "192.0.2.4:3456",
			expected:   "192.0.2.4",
		},
		{
			headers:    map[string]string{},
			name:       "fallback_remote_addr_no_port",
			remoteAddr: "192.0.2.5",
			expected:   "192.0.2.5",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/ip", http.NoBody)
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			req.RemoteAddr = tt.remoteAddr

			rr := httptest.NewRecorder()
			h.handleIP(rr, req)

			if rr.Body.String() != tt.expected {
				t.Errorf("got %v want %v", rr.Body.String(), tt.expected)
			}
		})
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	rr := httptest.NewRecorder()
	h.setSecurityHeaders(rr)

	expectedHeaders := map[string]string{
		"X-Content-Type-Options":    "nosniff",
		"X-Frame-Options":           "DENY",
		"Strict-Transport-Security": "max-age=31536000; includeSubDomains",
		"Content-Security-Policy":   "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
	}

	for k, v := range expectedHeaders {
		if got := rr.Header().Get(k); got != v {
			t.Errorf("header %s: got %v want %v", k, got, v)
		}
	}
}

func TestHandleGarbageBadPool(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	h.garbagePool = sync.Pool{
		New: func() any { return nil },
	}
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/garbage?ckSize=1", http.NoBody)
	rr := httptest.NewRecorder()
	h.handleGarbage(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}
}

func TestGetClientIPEmptyRemote(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/ip", http.NoBody)
	req.RemoteAddr = ""

	rr := httptest.NewRecorder()
	h.handleIP(rr, req)
	t.Log("handleIP returned for empty RemoteAddr")
}

func TestHandleIPWriteError(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/ip", http.NoBody)
	ew := &errWriter{}
	h.handleIP(ew, req)
	t.Log("handleIP returned after write error")
}

func TestHandleCPU(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/cpu", http.NoBody)
	rr := httptest.NewRecorder()
	h.handleCPU(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status OK, got %v", rr.Code)
	}

	body := rr.Body.String()
	cpus, err := strconv.Atoi(body)
	if err != nil || cpus <= 0 {
		t.Errorf("expected valid cpu count, got %v", body)
	}
}

func TestHandleCPUWriteError(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/cpu", http.NoBody)
	ew := &errWriter{}
	h.handleCPU(ew, req)
	t.Log("handleCPU returned after write error")
}

func TestHandleCompressedAsset(t *testing.T) {
	fsys := fstest.MapFS{
		"assets/index.js":    {Data: []byte("original-js-content")},
		"assets/index.js.br": {Data: []byte("brotli-compressed")},
		"assets/index.js.gz": {Data: []byte("gzip-compressed")},
	}
	h := NewHandler(fsys)

	tests := []struct {
		name           string
		acceptEncoding string
		expectedBody   string
		expectedEnc    string
	}{
		{"serves_brotli", "br, gzip", "brotli-compressed", "br"},
		{"serves_gzip", "gzip, deflate", "gzip-compressed", "gzip"},
		{"serves_original", "", "original-js-content", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/assets/index.js", http.NoBody)
			if tt.acceptEncoding != "" {
				req.Header.Set("Accept-Encoding", tt.acceptEncoding)
			}
			rr := httptest.NewRecorder()
			h.handleCompressedAsset(rr, req)

			if rr.Code != http.StatusOK {
				t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
			}
			if got := rr.Body.String(); got != tt.expectedBody {
				t.Errorf("body: got %q want %q", got, tt.expectedBody)
			}
			if tt.expectedEnc != "" {
				if got := rr.Header().Get("Content-Encoding"); got != tt.expectedEnc {
					t.Errorf("Content-Encoding: got %q want %q", got, tt.expectedEnc)
				}
				if got := rr.Header().Get("Vary"); got != "Accept-Encoding" {
					t.Errorf("Vary: got %q want %q", got, "Accept-Encoding")
				}
			}
		})
	}
}

func TestHandleCompressedAssetNotFound(t *testing.T) {
	h := NewHandler(fstest.MapFS{})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/assets/nonexistent.js", http.NoBody)
	rr := httptest.NewRecorder()
	h.handleCompressedAsset(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusNotFound)
	}
}

func TestHandleCompressedAssetEdgeCases(t *testing.T) {
	fsys := fstest.MapFS{
		"assets/dirtest":    {Data: []byte("fallback")},
		"assets/dirtest.br": {Data: []byte("ignored-as-dir"), Mode: fs.ModeDir | 0o755},
		"assets/noext":      {Data: []byte("noext-orig")},
		"assets/noext.br":   {Data: []byte("noext-br")},
	}
	h := NewHandler(fsys)

	t.Run("is_dir_fallback", func(t *testing.T) {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/assets/dirtest", http.NoBody)
		req.Header.Set("Accept-Encoding", "br")
		rr := httptest.NewRecorder()
		h.handleCompressedAsset(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
		}
		if got := rr.Body.String(); got != "fallback" {
			t.Errorf("body: got %q want %q", got, "fallback")
		}
	})

	t.Run("unknown_content_type", func(t *testing.T) {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/assets/noext", http.NoBody)
		req.Header.Set("Accept-Encoding", "br")
		rr := httptest.NewRecorder()
		h.handleCompressedAsset(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
		}
		if rr.Header().Get("Content-Type") != "application/octet-stream" {
			t.Errorf("Content-Type: got %q want %q", rr.Header().Get("Content-Type"), "application/octet-stream")
		}
	})

	t.Run("empty_path", func(t *testing.T) {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", http.NoBody)
		rr := httptest.NewRecorder()

		h.handleCompressedAsset(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Errorf("status: got %d want %d", rr.Code, http.StatusNotFound)
		}
	})
}
