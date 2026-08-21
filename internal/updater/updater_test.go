package updater

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type updateTestCase struct {
	client         *http.Client
	mockExecutable func() (string, error)
	mockEvalSym    func(string) (string, error)
	name           string
	version        string
	errContains    string
	wantErr        bool
}

func TestUpdate(t *testing.T) {
	dummyContent := "new-binary-content"
	validArchivePOSIX := createDummyTarGz(t, "speedybench", dummyContent)
	validArchiveWin := createDummyZip(t, "speedybench.exe", dummyContent)

	digestPOSIX := sha256.Sum256(validArchivePOSIX)
	digestWin := sha256.Sum256(validArchiveWin)
	digestPOSIXHex := "sha256:" + hex.EncodeToString(digestPOSIX[:])
	digestWinHex := "sha256:" + hex.EncodeToString(digestWin[:])

	validJSON := fmt.Sprintf(`{
		"tag_name": "v1.1.0",
		"assets": [
			{"name": "speedybench-linux-amd64.tar.gz", "browser_download_url": "https://example.com/linux-amd64", "digest": "%s"},
			{"name": "speedybench-linux-arm64.tar.gz", "browser_download_url": "https://example.com/linux-arm64", "digest": "%s"},
			{"name": "speedybench-darwin-amd64.tar.gz", "browser_download_url": "https://example.com/darwin-amd64", "digest": "%s"},
			{"name": "speedybench-darwin-arm64.tar.gz", "browser_download_url": "https://example.com/darwin-arm64", "digest": "%s"},
			{"name": "speedybench-windows-amd64.zip", "browser_download_url": "https://example.com/windows-amd64", "digest": "%s"},
			{"name": "speedybench-windows-arm64.zip", "browser_download_url": "https://example.com/windows-arm64", "digest": "%s"}
		]
	}`, digestPOSIXHex, digestPOSIXHex, digestPOSIXHex, digestPOSIXHex, digestWinHex, digestWinHex)

	successClient := newMockClient(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.String(), "releases/latest") {
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(validJSON)),
			}, nil
		}
		if osGOOS == osWindows {
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBuffer(validArchiveWin))}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBuffer(validArchivePOSIX))}, nil
	})

	tests := []updateTestCase{
		{
			name:        "dev_version",
			version:     "dev",
			client:      nil,
			errContains: "",
			wantErr:     false,
		},
		{
			name:    "already_up_to_date",
			version: "v1.1.0",
			client:  successClient,
			wantErr: false,
		},
		{
			name: "api_network_error",
			client: newMockClient(func(_ *http.Request) (*http.Response, error) {
				return nil, errors.New("network error")
			}),
			wantErr:     true,
			errContains: "network error fetching release",
		},
		{
			name: "api_bad_status",
			client: newMockClient(func(_ *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 404, Body: io.NopCloser(bytes.NewBufferString(""))}, nil
			}),
			wantErr:     true,
			errContains: "unexpected status from GitHub API",
		},
		{
			name: "api_invalid_json",
			client: newMockClient(func(_ *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewBufferString("{invalid"))}, nil
			}),
			wantErr:     true,
			errContains: "failed to parse GitHub API response",
		},
		{
			name: "asset_not_found",
			client: newMockClient(func(_ *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: 200,
					Body:       io.NopCloser(bytes.NewBufferString(`{"tag_name": "v1.1.0", "assets": []}`)),
				}, nil
			}),
			wantErr:     true,
			errContains: "not found in the latest release",
		},
		{
			name: "missing_digest",
			client: newMockClient(func(_ *http.Request) (*http.Response, error) {
				platformKey := fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
				assetName := SupportedPlatforms[platformKey]
				jsonStr := fmt.Sprintf(`{"tag_name": "v1.1.0", "assets": [{"name": %q, "browser_download_url": "https://example.com/dl"}]}`, assetName)
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewBufferString(jsonStr))}, nil
			}),
			wantErr:     true,
			errContains: "checksum for",
		},
		{
			name: "download_network_error",
			client: newMockClient(func(req *http.Request) (*http.Response, error) {
				if strings.Contains(req.URL.String(), "releases/latest") {
					return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewBufferString(validJSON))}, nil
				}
				return nil, errors.New("dl network error")
			}),
			wantErr:     true,
			errContains: "network error downloading asset",
		},
		{
			name: "download_bad_status",
			client: newMockClient(func(req *http.Request) (*http.Response, error) {
				if strings.Contains(req.URL.String(), "releases/latest") {
					return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewBufferString(validJSON))}, nil
				}
				return &http.Response{StatusCode: 500, Body: io.NopCloser(bytes.NewBufferString(""))}, nil
			}),
			wantErr:     true,
			errContains: "unexpected status downloading asset",
		},
		{
			name: "checksum_mismatch",
			client: newMockClient(func(req *http.Request) (*http.Response, error) {
				if strings.Contains(req.URL.String(), "releases/latest") {
					return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewBufferString(validJSON))}, nil
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewBufferString("corrupted"))}, nil
			}),
			wantErr:     true,
			errContains: "checksum mismatch",
		},
		{
			name:   "executable_path_error",
			client: successClient,
			mockExecutable: func() (string, error) {
				return "", errors.New("exec error")
			},
			wantErr:     true,
			errContains: "failed to determine executable path",
		},
		{
			name:   "symlink_eval_error",
			client: successClient,
			mockEvalSym: func(_ string) (string, error) {
				return "", errors.New("symlink error")
			},
			wantErr:     true,
			errContains: "failed to evaluate symlinks",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.mockExecutable != nil {
				origExec := osExecutable
				osExecutable = tt.mockExecutable
				defer func() { osExecutable = origExec }()
			}
			if tt.mockEvalSym != nil {
				origEval := filepathEvalSymlinks
				filepathEvalSymlinks = tt.mockEvalSym
				defer func() { filepathEvalSymlinks = origEval }()
			}

			version := "v1.0.0"
			if tt.version != "" {
				version = tt.version
			}

			err := Update(context.Background(), tt.client, version)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.errContains)
				}
				if !strings.Contains(err.Error(), tt.errContains) {
					t.Fatalf("expected error containing %q, got %v", tt.errContains, err)
				}
			} else if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestUpdateUnsupportedPlatform(t *testing.T) {
	origOS := osGOOS
	osGOOS = "plan9"
	defer func() { osGOOS = origOS }()

	err := Update(context.Background(), http.DefaultClient, "v1.0.0")
	if err == nil || !strings.Contains(err.Error(), "unsupported platform") {
		t.Fatalf("expected unsupported platform error, got %v", err)
	}
}

func TestFetchLatestRelease_RequestError(t *testing.T) {
	origURL := EndpointUpdate
	defer func() { EndpointUpdate = origURL }()
	EndpointUpdate = "://invalid-url"

	_, err := fetchLatestRelease(context.Background(), http.DefaultClient)
	if err == nil || !strings.Contains(err.Error(), "failed to create request") {
		t.Fatalf("expected failed to create request, got %v", err)
	}
}

func TestFetchLatestRelease_BodyCloseError(t *testing.T) {
	client := newMockClient(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body: mockBodyCloseError{
				Reader: strings.NewReader(`{"tag_name":"v1.1.0","assets":[]}`),
			},
		}, nil
	})

	_, err := fetchLatestRelease(context.Background(), client)
	if err != nil {
		t.Fatalf("expected no error (body close error is suppressed), got: %v", err)
	}
}

func TestDownloadAndVerifyAsset(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		client         *http.Client
		name           string
		url            string
		expectedDigest string
		errContains    string
	}{
		{
			name:        "request_error",
			url:         "://invalid-url",
			client:      http.DefaultClient,
			errContains: "failed to create download request",
		},
		{
			name:           "read_body_error",
			url:            "http://example.com/asset",
			expectedDigest: "sha256:dummy",
			client: newMockClient(func(_ *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(errReader{}),
				}, nil
			}),
			errContains: "failed to read downloaded asset",
		},
		{
			name:           "checksum_mismatch",
			url:            "http://example.net/asset",
			expectedDigest: "sha256:wronghash",
			client: newMockClient(func(_ *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(bytes.NewBufferString("content")),
				}, nil
			}),
			errContains: "checksum mismatch",
		},
		{
			name: "body_close_error",
			url:  "http://example.org/asset",
			expectedDigest: func() string {
				h := sha256.Sum256([]byte("content"))
				return "sha256:" + hex.EncodeToString(h[:])
			}(),
			client: newMockClient(func(_ *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       mockBodyCloseError{Reader: strings.NewReader("content")},
				}, nil
			}),
			errContains: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := downloadAndVerifyAsset(ctx, tt.client, tt.url, tt.expectedDigest)
			if tt.errContains != "" {
				if err == nil || !strings.Contains(err.Error(), tt.errContains) {
					t.Errorf("expected error containing %q, got %v", tt.errContains, err)
				}
			} else if err != nil {
				t.Errorf("expected no error, got %v", err)
			}
		})
	}
}

func TestUpdateSuccessAndReplaceErrors(t *testing.T) {
	dummyContent := "content"
	validArchivePOSIX := createDummyTarGz(t, "speedybench", dummyContent)
	digestPOSIX := sha256.Sum256(validArchivePOSIX)
	digestPOSIXHex := "sha256:" + hex.EncodeToString(digestPOSIX[:])

	validJSON := fmt.Sprintf(`{
		"tag_name": "v1.1.0",
		"assets": [
			{"name": "speedybench-linux-amd64.tar.gz", "browser_download_url": "https://example.com/linux-amd64", "digest": "%s"}
		]
	}`, digestPOSIXHex)

	client := newMockClient(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.String(), "releases/latest") {
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(validJSON))}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBuffer(validArchivePOSIX))}, nil
	})

	t.Run("posix_success", func(t *testing.T) {
		origOS := osGOOS
		osGOOS = "openbsd"
		origPlat := SupportedPlatforms
		SupportedPlatforms = map[string]string{
			"openbsd/" + runtime.GOARCH: SupportedPlatforms["linux/amd64"],
		}
		origExec := osExecutable
		origEval := filepathEvalSymlinks
		defer func() {
			osGOOS = origOS
			SupportedPlatforms = origPlat
			osExecutable = origExec
			filepathEvalSymlinks = origEval
		}()

		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		osExecutable = func() (string, error) { return execPath, nil }
		filepathEvalSymlinks = func(s string) (string, error) { return s, nil }

		if err := Update(context.Background(), client, "v1.0.0"); err != nil {
			t.Fatalf("unexpected error in posix update: %v", err)
		}
	})

	t.Run("windows_success", func(t *testing.T) {
		validArchiveWin := createDummyZip(t, "speedybench.exe", dummyContent)
		digestWin := sha256.Sum256(validArchiveWin)
		digestWinHex := "sha256:" + hex.EncodeToString(digestWin[:])

		winJSON := fmt.Sprintf(`{
			"tag_name": "v1.1.0",
			"assets": [
				{"name": "speedybench-windows-amd64.zip", "browser_download_url": "https://example.com/windows-amd64", "digest": "%s"}
			]
		}`, digestWinHex)

		winClient := newMockClient(func(req *http.Request) (*http.Response, error) {
			if strings.Contains(req.URL.String(), "releases/latest") {
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBufferString(winJSON))}, nil
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewBuffer(validArchiveWin))}, nil
		})

		origOS := osGOOS
		osGOOS = osWindows
		origPlat := SupportedPlatforms
		SupportedPlatforms = map[string]string{
			"windows/" + runtime.GOARCH: "speedybench-windows-amd64.zip",
		}
		origExec := osExecutable
		origEval := filepathEvalSymlinks
		origRename := osRename
		origWrite := osWriteFile
		origRemove := osRemove
		defer func() {
			osGOOS = origOS
			SupportedPlatforms = origPlat
			osExecutable = origExec
			filepathEvalSymlinks = origEval
			osRename = origRename
			osWriteFile = origWrite
			osRemove = origRemove
		}()

		osExecutable = func() (string, error) { return "/bin/speedybench.exe", nil }
		filepathEvalSymlinks = func(s string) (string, error) { return s, nil }
		osRename = func(_, _ string) error { return nil }
		osWriteFile = func(_ string, _ []byte, _ os.FileMode) error { return nil }
		osRemove = func(_ string) error { return nil }

		if err := Update(context.Background(), winClient, "v1.0.0"); err != nil {
			t.Fatalf("unexpected error in windows update: %v", err)
		}
	})

	t.Run("replace_error", func(t *testing.T) {
		origOS := osGOOS
		osGOOS = "openbsd"
		origPlat := SupportedPlatforms
		SupportedPlatforms = map[string]string{
			"openbsd/" + runtime.GOARCH: SupportedPlatforms["linux/amd64"],
		}
		origExec := osExecutable
		origEval := filepathEvalSymlinks
		defer func() {
			osGOOS = origOS
			SupportedPlatforms = origPlat
			osExecutable = origExec
			filepathEvalSymlinks = origEval
		}()

		osExecutable = func() (string, error) { return "/bin/speedybench", nil }
		filepathEvalSymlinks = func(_ string) (string, error) { return "", errors.New("eval error") }

		err := Update(context.Background(), client, "v1.0.0")
		if err == nil || !strings.Contains(err.Error(), "eval error") {
			t.Fatalf("expected replace error, got %v", err)
		}
	})
}

func TestApplyBinaryReplacement(t *testing.T) {
	origOS := osGOOS
	origExec := osExecutable
	origEval := filepathEvalSymlinks
	defer func() {
		osGOOS = origOS
		osExecutable = origExec
		filepathEvalSymlinks = origEval
	}()

	t.Run("executable_error", func(t *testing.T) {
		osExecutable = func() (string, error) {
			return "", errors.New("mock exec error")
		}
		err := applyBinaryReplacement([]byte("data"))
		if err == nil || !strings.Contains(err.Error(), "failed to determine executable path") {
			t.Fatalf("expected exec error, got %v", err)
		}
	})

	t.Run("symlink_error", func(t *testing.T) {
		osExecutable = func() (string, error) {
			return "/bin/speedybench", nil
		}
		filepathEvalSymlinks = func(_ string) (string, error) {
			return "", errors.New("mock symlink error")
		}
		err := applyBinaryReplacement([]byte("data"))
		if err == nil || !strings.Contains(err.Error(), "failed to evaluate symlinks") {
			t.Fatalf("expected symlink error, got %v", err)
		}
	})

	t.Run("windows_branch", func(t *testing.T) {
		osGOOS = osWindows
		osExecutable = func() (string, error) {
			return "/bin/speedybench.exe", nil
		}
		filepathEvalSymlinks = func(s string) (string, error) {
			return s, nil
		}

		archive := createDummyZip(t, "speedybench.exe", "win-bin")
		origRename := osRename
		origWrite := osWriteFile
		origRemove := osRemove
		osRename = func(_, _ string) error { return nil }
		osWriteFile = func(_ string, _ []byte, _ os.FileMode) error { return nil }
		osRemove = func(_ string) error { return nil }
		defer func() {
			osRename = origRename
			osWriteFile = origWrite
			osRemove = origRemove
		}()

		if err := applyBinaryReplacement(archive); err != nil {
			t.Fatalf("unexpected error in windows branch: %v", err)
		}
	})

	t.Run("posix_branch", func(t *testing.T) {
		osGOOS = "darwin"
		tempDir := t.TempDir()
		execPath := filepath.Join(tempDir, "speedybench")
		if err := os.WriteFile(execPath, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}

		osExecutable = func() (string, error) {
			return execPath, nil
		}
		filepathEvalSymlinks = func(s string) (string, error) {
			return s, nil
		}

		archive := createDummyTarGz(t, "speedybench", "posix-bin")
		if err := applyBinaryReplacement(archive); err != nil {
			t.Fatalf("unexpected error in posix branch: %v", err)
		}
	})
}
