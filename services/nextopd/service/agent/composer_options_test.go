package agent

import (
	"slices"
	"testing"
)

func TestComposerProviderCapabilitiesDefaults(t *testing.T) {
	t.Parallel()
	claude := composerProviderCapabilities("claude-code")
	for _, want := range []string{"imageInput", "skills", "compact", "tokenUsage", "rateLimits", "planMode", "interrupt"} {
		if !slices.Contains(claude, want) {
			t.Fatalf("claude defaults = %v, missing %q", claude, want)
		}
	}
	codex := composerProviderCapabilities("codex")
	if slices.Contains(codex, "planMode") {
		t.Fatalf("codex defaults must not include planMode: %v", codex)
	}
	if !slices.Contains(codex, "compact") || !slices.Contains(codex, "skills") {
		t.Fatalf("codex defaults = %v", codex)
	}
	if got := composerProviderCapabilities("gemini"); len(got) != 1 || got[0] != "interrupt" {
		t.Fatalf("gemini defaults = %v, want [interrupt]", got)
	}
	if got := composerProviderCapabilities("unknown"); got != nil {
		t.Fatalf("unknown provider defaults = %v, want nil", got)
	}
}
