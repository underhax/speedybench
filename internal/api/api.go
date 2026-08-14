// Package api provides HTTP handlers for bandwidth throughput testing,
// including download/upload endpoints and client IP detection behind reverse proxies.
package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"html/template"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// Handler manages throughput testing endpoints and coordinates memory pooling for zero-allocation payload generation.
type Handler struct {
	garbagePool sync.Pool
	assetFS     fs.FS
	cspHeader   string
}

// NewHandler initializes a pre-allocated sync.Pool to prevent garbage collection spikes during high-concurrency download tests.
func NewHandler(assetFS fs.FS) *Handler {
	csp := "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"

	if indexBytes, err := fs.ReadFile(assetFS, "index.html"); err == nil {
		hashes := extractScriptHashes(string(indexBytes))
		if len(hashes) > 0 {
			scriptSrc := "script-src 'self' '" + strings.Join(hashes, "' '") + "'"
			csp = "default-src 'self'; " + scriptSrc + "; style-src 'self'; img-src 'self' data:; connect-src 'self'"
		}
	}

	return &Handler{
		garbagePool: sync.Pool{
			New: func() any {
				b := make([]byte, 1024*1024)
				_, _ = rand.Read(b)
				return &b
			},
		},
		assetFS:   assetFS,
		cspHeader: csp,
	}
}

var scriptRegex = regexp.MustCompile(`(?is)<script([^>]*)>(.*?)</script>`)

func extractScriptHashes(html string) []string {
	var hashes []string
	matches := scriptRegex.FindAllStringSubmatch(html, -1)
	for _, match := range matches {
		if len(match) > 2 {
			attrs := match[1]
			content := match[2]
			if !strings.Contains(attrs, "src=") && strings.TrimSpace(content) != "" {
				hash := sha256.Sum256([]byte(content))
				hashBase64 := base64.StdEncoding.EncodeToString(hash[:])
				hashes = append(hashes, "sha256-"+hashBase64)
			}
		}
	}
	return hashes
}

// RegisterRoutes binds throughput and metadata endpoints to the provided multiplexer for integration into the main server lifecycle.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/", h.handleIndex)
	mux.HandleFunc("/api/garbage", h.handleGarbage)
	mux.HandleFunc("/api/empty", h.handleEmpty)
	mux.HandleFunc("/api/ip", h.handleIP)
	mux.HandleFunc("/assets/", h.handleCompressedAsset)
}

var encodings = []struct {
	name string
	ext  string
}{
	{"br", ".br"},
	{"gzip", ".gz"},
}

func (h *Handler) handleCompressedAsset(w http.ResponseWriter, r *http.Request) {
	h.setSecurityHeaders(w)

	cleaned := filepath.Clean(r.URL.Path)
	fsPath := strings.TrimPrefix(cleaned, "/")
	if fsPath == "" || fsPath == "." {
		http.NotFound(w, r)
		return
	}

	accept := r.Header.Get("Accept-Encoding")
	for _, enc := range encodings {
		if !strings.Contains(accept, enc.name) {
			continue
		}

		compressedPath := fsPath + enc.ext
		info, err := fs.Stat(h.assetFS, compressedPath)
		if err != nil || info.IsDir() {
			continue
		}

		contentType := mime.TypeByExtension(filepath.Ext(fsPath))
		if contentType == "" {
			contentType = "application/octet-stream"
		}

		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Encoding", enc.name)
		w.Header().Set("Vary", "Accept-Encoding")
		r.URL.Path = "/" + compressedPath
		http.FileServer(http.FS(h.assetFS)).ServeHTTP(w, r)
		return
	}

	r.URL.Path = "/" + fsPath
	if r.URL.Path == "/index.html" {
		r.URL.Path = "/"
	}
	http.FileServer(http.FS(h.assetFS)).ServeHTTP(w, r)
}

func (h *Handler) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		r.URL.Path = "/index.html"
	}
	h.handleCompressedAsset(w, r)
}

func (h *Handler) handleGarbage(w http.ResponseWriter, r *http.Request) {
	h.setSecurityHeaders(w)
	h.setNoCacheHeaders(w)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Description", "File Transfer")
	w.Header().Set("Content-Disposition", "attachment; filename=random.dat")
	w.Header().Set("Content-Transfer-Encoding", "binary")

	ckSizeStr := r.URL.Query().Get("ckSize")
	if ckSizeStr == "" {
		ckSizeStr = "100"
	}

	ckSize, err := strconv.Atoi(ckSizeStr)
	if err != nil || ckSize <= 0 {
		ckSize = 100
	}

	if ckSize > 1024 {
		ckSize = 1024
	}

	bufPtr, ok := h.garbagePool.Get().(*[]byte)
	if !ok || bufPtr == nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer h.garbagePool.Put(bufPtr)

	buf := *bufPtr

	flusher, hasFlusher := w.(http.Flusher)

	for range ckSize {
		if err := r.Context().Err(); err != nil {
			break
		}
		if _, writeErr := w.Write(buf); writeErr != nil {
			break
		}
		if hasFlusher {
			flusher.Flush()
		}
	}
}

func (h *Handler) handleEmpty(w http.ResponseWriter, r *http.Request) {
	h.setSecurityHeaders(w)
	h.setNoCacheHeaders(w)
	w.Header().Set("Connection", "keep-alive")

	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 2*1024*1024*1024)

	_, err := io.Copy(io.Discard, r.Body)
	if err != nil {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, io.ErrUnexpectedEOF) {
			log.Printf("Error draining body: %v", err)
		}
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) handleIP(w http.ResponseWriter, r *http.Request) {
	h.setSecurityHeaders(w)
	h.setNoCacheHeaders(w)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	ip := h.getClientIP(r)
	if _, err := io.WriteString(w, template.HTMLEscapeString(ip)); err != nil {
		log.Printf("Failed to write IP response: %v", err)
	}
}

func (h *Handler) getClientIP(r *http.Request) string {
	if xRealIP := r.Header.Get("X-Real-IP"); xRealIP != "" {
		return xRealIP
	}
	if xForwardedFor := r.Header.Get("X-Forwarded-For"); xForwardedFor != "" {
		first, _, _ := strings.Cut(xForwardedFor, ",")
		return strings.TrimSpace(first)
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (h *Handler) setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	w.Header().Set("Content-Security-Policy", h.cspHeader)
}

func (h *Handler) setNoCacheHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
}
