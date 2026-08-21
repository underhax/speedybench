package updater

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReplaceWindowsSuccess(t *testing.T) {
	tempDir := t.TempDir()
	execPath := filepath.Join(tempDir, "speedybench.exe")
	if err := os.WriteFile(execPath, []byte("old-binary"), 0o600); err != nil {
		t.Fatal(err)
	}

	archive := createDummyZip(t, "speedybench.exe", "win-binary-content")
	if err := replaceWindows(bytes.NewReader(archive), execPath); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	cleanPath := filepath.Clean(execPath)
	content, err := os.ReadFile(cleanPath)
	if err != nil || string(content) != "win-binary-content" {
		t.Fatalf("replace failed, content: %q, err: %v", string(content), err)
	}
}

func TestReplaceWindowsErrors(t *testing.T) {
	t.Run("read_body_error", func(t *testing.T) {
		err := replaceWindows(errReader{}, "/path")
		if err == nil || !strings.Contains(err.Error(), "failed to read zip body") {
			t.Fatalf("expected read zip body error, got %v", err)
		}
	})

	t.Run("zip_init_error", func(t *testing.T) {
		err := replaceWindows(bytes.NewReader([]byte("not-zip")), "/path")
		if err == nil || !strings.Contains(err.Error(), "failed to initialize zip reader") {
			t.Fatalf("expected zip init error, got %v", err)
		}
	})

	t.Run("binary_not_in_zip", func(t *testing.T) {
		archive := createDummyZip(t, "other.exe", "content")
		err := replaceWindows(bytes.NewReader(archive), "/path")
		if err == nil || !strings.Contains(err.Error(), "speedybench.exe not found in archive") {
			t.Fatalf("expected missing binary error, got %v", err)
		}
	})

	t.Run("zip_open_error", func(t *testing.T) {
		origZipOpen := zipOpen
		zipOpen = func(_ *zip.File) (io.ReadCloser, error) {
			return nil, errors.New("zip open failed")
		}
		defer func() { zipOpen = origZipOpen }()

		archive := createDummyZip(t, "speedybench.exe", "content")
		err := replaceWindows(bytes.NewReader(archive), "/path/speedybench.exe")
		if err == nil || !strings.Contains(err.Error(), "failed to open speedybench.exe in zip") {
			t.Fatalf("expected zip open error, got %v", err)
		}
	})

	t.Run("zip_close_error", func(t *testing.T) {
		origZipOpen := zipOpen
		zipOpen = func(f *zip.File) (io.ReadCloser, error) {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			return errorClosingReader{rc}, nil
		}
		defer func() { zipOpen = origZipOpen }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyZip(t, "speedybench.exe", "content")
		err := replaceWindows(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "close zip entry") {
			t.Fatalf("expected zip close error, got %v", err)
		}
	})
}

func TestReplaceWindowsRenameErrors(t *testing.T) {
	t.Run("rename_permission_denied", func(t *testing.T) {
		origRename := osRename
		osRename = func(_, _ string) error {
			return os.ErrPermission
		}
		defer func() { osRename = origRename }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyZip(t, "speedybench.exe", "new")
		err := replaceWindows(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "permission denied. Please run with Administrator privileges") {
			t.Fatalf("expected permission rename error, got %v", err)
		}
	})

	t.Run("rename_access_denied_string", func(t *testing.T) {
		origRename := osRename
		osRename = func(_, _ string) error {
			return errors.New("win32 error: Access is denied")
		}
		defer func() { osRename = origRename }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyZip(t, "speedybench.exe", "new")
		err := replaceWindows(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "permission denied. Please run with Administrator privileges") {
			t.Fatalf("expected permission rename error, got %v", err)
		}
	})

	t.Run("rename_generic_error", func(t *testing.T) {
		origRename := osRename
		osRename = func(_, _ string) error {
			return errors.New("rename busy")
		}
		defer func() { osRename = origRename }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyZip(t, "speedybench.exe", "new")
		err := replaceWindows(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to rename current executable") {
			t.Fatalf("expected generic rename error, got %v", err)
		}
	})
}

func TestReplaceWindowsWriteErrors(t *testing.T) {
	t.Run("write_permission_denied", func(t *testing.T) {
		origWriteFile := osWriteFile
		osWriteFile = func(_ string, _ []byte, _ os.FileMode) error {
			return os.ErrPermission
		}
		defer func() { osWriteFile = origWriteFile }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyZip(t, "speedybench.exe", "new")
		err := replaceWindows(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "permission denied while writing new binary") {
			t.Fatalf("expected write permission error, got %v", err)
		}
	})

	t.Run("write_generic_error", func(t *testing.T) {
		origWriteFile := osWriteFile
		osWriteFile = func(_ string, _ []byte, _ os.FileMode) error {
			return errors.New("generic write error")
		}
		defer func() { osWriteFile = origWriteFile }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		archive := createDummyZip(t, "speedybench.exe", "new")
		err := replaceWindows(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to write new binary") {
			t.Fatalf("expected generic write error, got %v", err)
		}
	})
}

func TestReplaceWindowsRollbackErrors(t *testing.T) {
	t.Run("remove_old_error", func(t *testing.T) {
		origRemove := osRemove
		osRemove = func(_ string) error {
			return errors.New("cannot remove old")
		}
		defer func() { osRemove = origRemove }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		archive := createDummyZip(t, "speedybench.exe", "new")
		err := replaceWindows(bytes.NewReader(archive), execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to remove old binary") {
			t.Fatalf("expected remove old error, got %v", err)
		}
	})

	t.Run("read_archive_error_rollback_success", func(t *testing.T) {
		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		err := performWindowsReplace(errReader{}, execPath)
		if err == nil || !strings.Contains(err.Error(), "failed to read new binary from archive") {
			t.Fatalf("expected read error, got %v", err)
		}
	})

	t.Run("read_archive_error_rollback_fail", func(t *testing.T) {
		origRename := osRename
		osRename = func(old, _ string) error {
			if strings.HasSuffix(old, ".old") {
				return errors.New("rollback failed")
			}
			return nil
		}
		defer func() { osRename = origRename }()

		err := performWindowsReplace(errReader{}, "/test/speedybench.exe")
		if err == nil || !strings.Contains(err.Error(), "failed to restore executable") {
			t.Fatalf("expected restore error, got %v", err)
		}
	})

	t.Run("write_archive_error_rollback_fail", func(t *testing.T) {
		origWrite := osWriteFile
		origRename := osRename
		osWriteFile = func(_ string, _ []byte, _ os.FileMode) error {
			return errors.New("write fail")
		}
		osRename = func(old, _ string) error {
			if strings.HasSuffix(old, ".old") {
				return errors.New("rollback failed")
			}
			return nil
		}
		defer func() {
			osWriteFile = origWrite
			osRename = origRename
		}()

		err := performWindowsReplace(strings.NewReader("content"), "/test/speedybench.exe")
		if err == nil || !strings.Contains(err.Error(), "failed to restore executable") {
			t.Fatalf("expected restore error, got %v", err)
		}
	})
}

func TestCleanupWindowsOldFiles(t *testing.T) {
	t.Run("skip_on_non_windows", func(_ *testing.T) {
		origOS := osGOOS
		osGOOS = "freebsd"
		defer func() { osGOOS = origOS }()
		CleanupWindowsOldFiles()
	})

	t.Run("windows_cleanup_success", func(t *testing.T) {
		origOS := osGOOS
		osGOOS = osWindows
		defer func() { osGOOS = origOS }()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench.exe")
		if err := os.WriteFile(execPath, []byte("running"), 0o600); err != nil {
			t.Fatal(err)
		}
		oldPath := execPath + ".old"
		if err := os.WriteFile(oldPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		origExec := osExecutable
		osExecutable = func() (string, error) {
			return execPath, nil
		}
		defer func() { osExecutable = origExec }()

		CleanupWindowsOldFiles()
		if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
			t.Fatalf("expected .old file to be removed, err: %v", err)
		}
	})

	t.Run("windows_cleanup_exec_error", func(_ *testing.T) {
		origOS := osGOOS
		osGOOS = osWindows
		defer func() { osGOOS = origOS }()

		origExec := osExecutable
		osExecutable = func() (string, error) {
			return "", errors.New("exec error")
		}
		defer func() { osExecutable = origExec }()

		CleanupWindowsOldFiles()
	})

	t.Run("windows_cleanup_symlink_error", func(_ *testing.T) {
		origOS := osGOOS
		osGOOS = osWindows
		defer func() { osGOOS = origOS }()

		origExec := osExecutable
		osExecutable = func() (string, error) {
			return "/fake/path", nil
		}
		origEval := filepathEvalSymlinks
		filepathEvalSymlinks = func(_ string) (string, error) {
			return "", errors.New("symlink error")
		}
		defer func() {
			osExecutable = origExec
			filepathEvalSymlinks = origEval
		}()

		CleanupWindowsOldFiles()
	})

	t.Run("windows_cleanup_remove_error", func(_ *testing.T) {
		origOS := osGOOS
		osGOOS = osWindows
		origRemove := osRemove
		osRemove = func(_ string) error {
			return errors.New("cannot remove")
		}
		origExec := osExecutable
		osExecutable = func() (string, error) {
			return "/fake/path", nil
		}
		origEval := filepathEvalSymlinks
		filepathEvalSymlinks = func(s string) (string, error) {
			return s, nil
		}
		defer func() {
			osOS := origOS
			_ = osOS
			osGOOS = origOS
			osRemove = origRemove
			osExecutable = origExec
			filepathEvalSymlinks = origEval
		}()

		CleanupWindowsOldFiles()
	})
}

func TestDefaultZipOpen(t *testing.T) {
	validArchive := createDummyZip(t, "test.exe", "content")
	zrValid, err := zip.NewReader(bytes.NewReader(validArchive), int64(len(validArchive)))
	if err != nil {
		t.Fatalf("failed to initialize zip reader: %v", err)
	}
	rc, err := defaultZipOpen(zrValid.File[0])
	if err != nil {
		t.Fatalf("expected no error from valid zip open, got %v", err)
	}
	if cErr := rc.Close(); cErr != nil {
		t.Logf("close error: %v", cErr)
	}

	invalidArchive := make([]byte, len(validArchive))
	copy(invalidArchive, validArchive)
	idx := bytes.Index(invalidArchive, []byte{0x50, 0x4b, 0x03, 0x04})
	if idx != -1 {
		invalidArchive[idx+8] = 99
		invalidArchive[idx+9] = 0
	}
	idx = bytes.Index(invalidArchive, []byte{0x50, 0x4b, 0x01, 0x02})
	if idx != -1 {
		invalidArchive[idx+10] = 99
		invalidArchive[idx+11] = 0
	}
	zrInvalid, err := zip.NewReader(bytes.NewReader(invalidArchive), int64(len(invalidArchive)))
	if err != nil {
		t.Fatalf("failed to init zip reader: %v", err)
	}
	_, err = defaultZipOpen(zrInvalid.File[0])
	if err == nil {
		t.Fatalf("expected error from corrupted zip open, got nil")
	}
}
