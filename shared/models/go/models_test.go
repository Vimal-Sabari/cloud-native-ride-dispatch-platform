package models

import "testing"

func TestPlaceholder(t *testing.T) {
	if Placeholder() != "models" {
		t.Errorf("expected 'models', got '%s'", Placeholder())
	}
}
