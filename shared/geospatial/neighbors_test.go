package geospatial

import (
	"math"
	"testing"
)

func TestNeighbors_CountAndLength(t *testing.T) {
	testHashes := []string{
		"u4pruy",  // 6 chars
		"dr5re",   // 5 chars (project standard)
		"9q8yy",   // 5 chars (SF)
		"s",       // 1 char
		"dr5reg4", // 7 chars
	}

	for _, hash := range testHashes {
		t.Run(hash, func(t *testing.T) {
			neighbors, err := Neighbors(hash)
			if err != nil {
				t.Fatalf("Neighbors(%q) returned error: %v", hash, err)
			}

			if len(neighbors) != 8 {
				t.Fatalf("Neighbors(%q) returned %d hashes, want 8", hash, len(neighbors))
			}

			seen := make(map[string]bool, 8)
			for i, n := range neighbors {
				if len(n) != len(hash) {
					t.Errorf("neighbor[%d] %q has length %d, want %d", i, n, len(n), len(hash))
				}
				if n == hash {
					t.Errorf("neighbor[%d] %q is identical to center cell %q", i, n, hash)
				}
				seen[n] = true
			}

			if len(seen) != 8 {
				t.Errorf("expected 8 distinct neighbors for %q, got %d distinct: %v", hash, len(seen), neighbors)
			}
		})
	}
}

func TestNeighbors_BoundingBoxAdjacency(t *testing.T) {
	hash := "dr5re"
	center, err := Decode(hash)
	if err != nil {
		t.Fatalf("Decode(%q) failed: %v", hash, err)
	}

	neighbors, err := Neighbors(hash)
	if err != nil {
		t.Fatalf("Neighbors(%q) failed: %v", hash, err)
	}

	cellHeight := 2.0 * center.LatError
	cellWidth := 2.0 * center.LngError

	for i, n := range neighbors {
		decodedNeighbor, err := Decode(n)
		if err != nil {
			t.Fatalf("Decode neighbor %q failed: %v", n, err)
		}

		latDistRatio := math.Abs(decodedNeighbor.Lat-center.Lat) / cellHeight
		lngDistRatio := math.Abs(decodedNeighbor.Lng-center.Lng) / cellWidth

		// Each neighbor cell center should be offset by approx 0 or 1 cell unit
		// in both latitude and longitude (with small tolerance for floating point rounding).
		isAdjacentLat := math.Abs(latDistRatio-0.0) < 0.01 || math.Abs(latDistRatio-1.0) < 0.01
		isAdjacentLng := math.Abs(lngDistRatio-0.0) < 0.01 || math.Abs(lngDistRatio-1.0) < 0.01

		if !isAdjacentLat || !isAdjacentLng {
			t.Errorf("neighbor[%d] %q is not adjacent to center %q: latDistRatio=%.4f, lngDistRatio=%.4f",
				i, n, hash, latDistRatio, lngDistRatio)
		}
	}
}

func TestNeighbors_BoundaryConditionsNoPanic(t *testing.T) {
	// Near poles and antimeridian, lines of longitude converge and wrap.
	// The function must not panic and must return valid non-empty hashes.
	boundaryHashes := []struct {
		name string
		hash string
	}{
		{"North Pole prefix", "y"},
		{"North Pole precision 5", "zzzzz"},
		{"South Pole prefix", "0"},
		{"South Pole precision 5", "00000"},
		{"Antimeridian East precision 5", "rzzzz"},
		{"Antimeridian West precision 5", "2pbpb"},
	}

	for _, tc := range boundaryHashes {
		t.Run(tc.name, func(t *testing.T) {
			neighbors, err := Neighbors(tc.hash)
			if err != nil {
				t.Fatalf("Neighbors(%q) returned unexpected error: %v", tc.hash, err)
			}
			if len(neighbors) != 8 {
				t.Errorf("Neighbors(%q) returned %d hashes, want 8", tc.hash, len(neighbors))
			}
			for i, n := range neighbors {
				if len(n) != len(tc.hash) {
					t.Errorf("neighbor[%d] %q length mismatch: got %d, want %d", i, n, len(n), len(tc.hash))
				}
			}
		})
	}
}

func TestNeighbors_Invalid(t *testing.T) {
	_, err := Neighbors("")
	if err == nil {
		t.Error("Neighbors(\"\") expected error, got nil")
	}

	_, err = Neighbors("invalid!!")
	if err == nil {
		t.Error("Neighbors(\"invalid!!\") expected error, got nil")
	}
}
