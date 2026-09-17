package dynamoclient

import "testing"

func TestPlaceholder(t *testing.T) {
	if Placeholder() != "dynamo-client" {
		t.Errorf("expected 'dynamo-client', got '%s'", Placeholder())
	}
}
