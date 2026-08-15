package api

import (
	"net/http"
	"net/url"
	"testing"
)

func TestParseTimeout(t *testing.T) {
	tests := []struct {
		name     string
		timeVal  string
		expected int
	}{
		{
			name:     "no time param",
			timeVal:  "",
			expected: 35,
		},
		{
			name:     "invalid time param",
			timeVal:  "invalid",
			expected: 35,
		},
		{
			name:     "negative time param",
			timeVal:  "-10",
			expected: 35,
		},
		{
			name:     "zero time param",
			timeVal:  "0",
			expected: 35,
		},
		{
			name:     "valid time param under limit",
			timeVal:  "20",
			expected: 22,
		},
		{
			name:     "valid time param over limit",
			timeVal:  "50",
			expected: 32,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u := &url.URL{
				Scheme: "http",
				Host:   "example.com",
			}
			if tt.timeVal != "" {
				q := u.Query()
				q.Set("time", tt.timeVal)
				u.RawQuery = q.Encode()
			}
			req := &http.Request{URL: u}

			result := parseTimeout(req)
			if result != tt.expected {
				t.Errorf("parseTimeout() = %v, expected %v", result, tt.expected)
			}
		})
	}
}
