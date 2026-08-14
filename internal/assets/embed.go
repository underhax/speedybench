// Package assets provides embedded static files for the speedybench frontend.
package assets

import "embed"

// Assets contains the embedded frontend distribution files.
//
//go:embed dist/*
var Assets embed.FS
