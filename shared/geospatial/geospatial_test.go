package geospatial

import "testing"

func TestPlaceholder(t *testing.T) {
	if Placeholder() != "geospatial" {
		t.Errorf("expected 'geospatial', got '%s'", Placeholder())
	}
}
