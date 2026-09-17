package matchingalgorithms

import "testing"

func TestPlaceholder(t *testing.T) {
	if Placeholder() != "matching-algorithms" {
		t.Errorf("expected 'matching-algorithms', got '%s'", Placeholder())
	}
}
