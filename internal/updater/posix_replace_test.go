package updater

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReplacePOSIXSuccess(t *testing.T) {
	tempDir := t.TempDir()
	execPath := filepath.Join(tempDir, "speedybench")
	if err := os.WriteFile(execPath, []byte("old-binary"), 0o600); err != nil {
		t.Fatal(err)
	}

	archive := createDummyTarGz(t, "speedybench", "posix-binary-content")
	if err := replacePOSIX(bytes.NewReader(archive), execPath); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	cleanPath := filepath.Clean(execPath)
	content, err := os.ReadFile(cleanPath)
	if err != nil || string(content) != "posix-binary-content" {
		t.Fatalf("replace failed, content: %q, err: %v", string(content), err)
	}
}

func TestReplacePOSIXErrors(t *testing.T) {
	t.Run("gzip_error", func(t *testing.T) {
		err := replacePOSIX(bytes.NewReader([]byte("not-gzip")), "/path")
		if err == nil || !strings.Contains(err.Error(), "failed to initialize gzip reader") {
			t.Fatalf("expected gzip error, got %v", err)
		}
	})

	t.Run("tar_read_error", func(t *testing.T) {
		var buf bytes.Buffer
		gw := gzip.NewWriter(&buf)
		if _, err := gw.Write([]byte("not a tar payload")); err != nil {
			t.Fatal(err)
		}
		if err := gw.Close(); err != nil {
			t.Fatal(err)
		}

		err := replacePOSIX(bytes.NewReader(buf.Bytes()), "/path")
		if err == nil || !strings.Contains(err.Error(), "failed to read tar archive") {
			t.Fatalf("expected tar read error, got %v", err)
		}
	})

	t.Run("binary_not_in_archive", func(t *testing.T) {
		archive := createDummyTarGz(t, "other-binary", "content")
		err := replacePOSIX(bytes.NewReader(archive), "/path")
		if err == nil || !strings.Contains(err.Error(), "executable not found in archive") {
			t.Fatalf("expected missing binary error, got %v", err)
		}
	})

	t.Run("create_temp_permission_denied", func(t *testing.T) {
		origCreateTemp := osCreateTemp
		osCreateTemp = func(_, _ string) (*os.File, error) {
			return nil, os.ErrPermission
		}
		defer func() { osCreateTemp = origCreateTemp }()

		archive := createDummyTarGz(t, "speedybench", "content")
		err := replacePOSIX(bytes.NewReader(archive), "/path/speedybench")
		if err == nil || !strings.Contains(err.Error(), "permission denied") {
			t.Fatalf("expected permission error, got %v", err)
		}
	})

	t.Run("create_temp_generic_error", func(t *testing.T) {
		origCreateTemp := osCreateTemp
		osCreateTemp = func(_, _ string) (*os.File, error) {
			return nil, errors.New("disk full")
		}
		defer func() { osCreateTemp = origCreateTemp }()

		archive := createDummyTarGz(t, "speedybench", "content")
		err := replacePOSIX(bytes.NewReader(archive), "/path/speedybench")
		if err == nil || !strings.Contains(err.Error(), "failed to create temporary file") {
			t.Fatalf("expected generic create error, got %v", err)
		}
	})
}

func TestReplacePOSIXSwapErrors(t *testing.T) {
	t.Run("chmod_error", func(t *testing.T) {
		origChmod := osChmod
		osChmod = func(_ string, _ os.FileMode) error {
			return errors.New("chmod failed")
		}
		defer func() { osChmod = origChmod }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyTarGz(t, "speedybench", "new")
		err := replacePOSIX(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to make new binary executable") {
			t.Fatalf("expected chmod error, got %v", err)
		}
	})

	t.Run("rename_permission_denied", func(t *testing.T) {
		origRename := osRename
		osRename = func(_, _ string) error {
			return os.ErrPermission
		}
		defer func() { osRename = origRename }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyTarGz(t, "speedybench", "new")
		err := replacePOSIX(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "permission denied replacing executable") {
			t.Fatalf("expected permission rename error, got %v", err)
		}
	})

	t.Run("rename_generic_error", func(t *testing.T) {
		origRename := osRename
		osRename = func(_, _ string) error {
			return errors.New("busy")
		}
		defer func() { osRename = origRename }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyTarGz(t, "speedybench", "new")
		err := replacePOSIX(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to replace current executable") {
			t.Fatalf("expected generic rename error, got %v", err)
		}
	})
}

func TestReplacePOSIXCopyAndCloseErrors(t *testing.T) {
	t.Run("copy_error", func(t *testing.T) {
		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		err := performAtomicSwap(errReader{}, execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to write new binary") {
			t.Fatalf("expected copy error, got %v", err)
		}
	})

	t.Run("temp_close_error", func(t *testing.T) {
		origClose := tempFileClose
		tempFileClose = func(_ *os.File) error {
			return errors.New("mock close error")
		}
		defer func() { tempFileClose = origClose }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		err := performAtomicSwap(strings.NewReader("dummy"), execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to close temp file") {
			t.Fatalf("expected close error, got %v", err)
		}
	})

	t.Run("gzip_close_error", func(t *testing.T) {
		origNewGzip := newGzipReader
		newGzipReader = func(r io.Reader) (io.ReadCloser, error) {
			gzr, err := defaultNewGzipReader(r)
			if err != nil {
				return nil, err
			}
			return errorClosingReader{gzr}, nil
		}
		defer func() { newGzipReader = origNewGzip }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyTarGz(t, "speedybench", "content")
		if err := replacePOSIX(bytes.NewReader(archive), execPath); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("remove_temp_error_in_defer", func(t *testing.T) {
		origRemove := osRemove
		osRemove = func(name string) error {
			if strings.Contains(name, ".speedybench-new-") {
				return errors.New("cannot remove temp")
			}
			return origRemove(name)
		}
		defer func() { osRemove = origRemove }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		err := performAtomicSwap(errReader{}, execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to write new binary") {
			t.Fatalf("expected copy error, got %v", err)
		}
	})

	t.Run("copy_error_close_error", func(t *testing.T) {
		origClose := tempFileClose
		tempFileClose = func(_ *os.File) error {
			return errors.New("mock close error on copy fail")
		}
		defer func() { tempFileClose = origClose }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		err := performAtomicSwap(errReader{}, execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to close temp file after copy error") {
			t.Fatalf("expected close error after copy error, got %v", err)
		}
	})
}

func TestDefaultNewGzipReader(t *testing.T) {
	rc, err := defaultNewGzipReader(bytes.NewReader(createDummyTarGz(t, "test", "content")))
	if err != nil {
		t.Fatalf("expected no error from valid gzip, got %v", err)
	}
	if cErr := rc.Close(); cErr != nil {
		t.Logf("close error: %v", cErr)
	}

	_, err = defaultNewGzipReader(strings.NewReader("not-gzip"))
	if err == nil {
		t.Fatalf("expected error from invalid gzip, got nil")
	}
}

func TestDefaultTempFileClose(t *testing.T) {
	tempFile, err := os.CreateTemp(t.TempDir(), "test-close-*")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	if err := defaultTempFileClose(tempFile); err != nil {
		t.Fatalf("expected successful close, got %v", err)
	}

	if err := defaultTempFileClose(tempFile); err == nil {
		t.Fatalf("expected error closing already closed file, got nil")
	}
}
