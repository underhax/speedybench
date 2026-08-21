package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

type helpErrWriter struct{}

func (helpErrWriter) Write(_ []byte) (int, error) {
	return 0, errors.New("write error")
}

func TestPrintUsage(t *testing.T) {
	var buf bytes.Buffer
	printUsage(&buf)

	output := buf.String()
	if !strings.Contains(output, "Modern lightweight network speed benchmark") {
		t.Errorf("expected usage output to contain description, but got:\n%s", output)
	}
	if !strings.Contains(output, "SPEEDYBENCH_IN_DOCKER") {
		t.Errorf("expected usage output to contain docker env var, but got:\n%s", output)
	}

	printUsage(helpErrWriter{})
}
