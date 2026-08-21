package main

import (
	"fmt"
	"io"
)

func printUsage(out io.Writer) {
	text := fmt.Sprintf("speedybench - Modern lightweight network speed benchmark (%s)\n\n"+
		"Usage:\n"+
		"  speedybench [command] [options]\n\n"+
		"Commands:\n"+
		"  update        Update speedybench to the latest version\n"+
		"  version       Print the current version\n"+
		"  help, -h      Show this help message\n\n"+
		"Options:\n"+
		"  --healthcheck Run healthcheck against the local server and exit\n"+
		"  -h, --help    Show this help message\n\n"+
		"Environment Variables:\n"+
		"  SPEEDYBENCH_PORT        Server listening port (1025-65535, default: 8989)\n"+
		"  SPEEDYBENCH_HOST        Server listening host IP or 'all' for all interfaces (default: 127.0.0.1)\n"+
		"  SPEEDYBENCH_MAX_CONNS   Maximum concurrent connections (5-65535, default: 100)\n"+
		"  SPEEDYBENCH_DEBUG       Enable debug logging (true/false, default: false)\n"+
		"  SPEEDYBENCH_IN_DOCKER   Running inside Docker container (true/false, default: false)\n", Version)
	if _, err := io.WriteString(out, text); err != nil {
		return
	}
}
