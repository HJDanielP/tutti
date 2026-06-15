package browser

import (
	"encoding/json"
	"os"
	"strings"
)

// chrome-devtools-mcp launch resolution. The daemon now consumes this command
// directly (it runs the MCP server as its own subprocess) instead of
// advertising it to agent providers. Operator overrides via
// TUTTI_BROWSER_MCP_COMMAND / TUTTI_BROWSER_MCP_ARGS still apply — the desktop's
// resolveBrowserMcpDaemonEnv points these at a vendored binary in packaged
// builds; dev falls back to the pinned npx command below.
const (
	browserMCPCommandOverrideEnv = "TUTTI_BROWSER_MCP_COMMAND"
	browserMCPArgsOverrideEnv    = "TUTTI_BROWSER_MCP_ARGS"

	// browserMCPPinnedVersion pins the chrome-devtools-mcp release for the npx
	// fallback so dev runs are reproducible.
	browserMCPPinnedVersion = "chrome-devtools-mcp@1.2.0"
)

// defaultBrowserMCPCommand / Args launch chrome-devtools-mcp in external-Chrome
// mode (the server manages its own Chrome). --isolated uses an ephemeral
// profile; --no-usage-statistics keeps telemetry off for an agent-driven,
// non-interactive context.
var (
	defaultBrowserMCPCommand = "npx"
	defaultBrowserMCPArgs    = []string{"-y", browserMCPPinnedVersion, "--isolated", "--no-usage-statistics"}
)

// resolveBrowserMCPCommand returns the full command (command + args) used to
// launch the browser MCP server, honoring operator overrides.
func resolveBrowserMCPCommand() []string {
	command := strings.TrimSpace(os.Getenv(browserMCPCommandOverrideEnv))
	if command == "" {
		command = defaultBrowserMCPCommand
	}
	args := append([]string(nil), defaultBrowserMCPArgs...)
	if raw := strings.TrimSpace(os.Getenv(browserMCPArgsOverrideEnv)); raw != "" {
		var override []string
		if err := json.Unmarshal([]byte(raw), &override); err == nil {
			args = override
		}
	}
	return append([]string{command}, args...)
}
