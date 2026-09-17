package geospatial

import (
	"math"
	"testing"
)

func TestEncode_KnownReference(t *testing.T) {
	tests := []struct {
		name      string
		lat       float64
		lng       float64
		precision int
		expected  string
	}{
		{
			name:      "public reference u4pruy (Jutland, Denmark)",
			lat:       57.64911,
			lng:       10.40744,
			precision: 6,
			expected:  "u4pruy",
		},
		{
			name:      "standard precision 5 (New York / Manhattan)",
			lat:       40.7128,
			lng:       -74.0060,
			precision: 5,
			expected:  "dr5re",
		},
		{
			name:      "origin (0, 0)",
			lat:       0.0,
			lng:       0.0,
			precision: 5,
			expected:  "s0000",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Encode(tt.lat, tt.lng, tt.precision)
			if err != nil {
				t.Fatalf("Encode(%v, %v, %d) returned unexpected error: %v", tt.lat, tt.lng, tt.precision, err)
			}
			if got != tt.expected {
				t.Errorf("Encode(%v, %v, %d) = %q; want %q", tt.lat, tt.lng, tt.precision, got, tt.expected)
			}
		})
	}
}

func TestRoundTrip(t *testing.T) {
	tests := []struct {
		name      string
		lat       float64
		lng       float64
		precision int
	}{
		{name: "Low precision 1 - San Francisco", lat: 37.7749, lng: -122.4194, precision: 1},
		{name: "Standard precision 5 - San Francisco", lat: 37.7749, lng: -122.4194, precision: 5},
		{name: "High precision 9 - San Francisco", lat: 37.7749, lng: -122.4194, precision: 9},
		{name: "Standard precision 5 - Sydney", lat: -33.8688, lng: 151.2093, precision: 5},
		{name: "Standard precision 5 - London", lat: 51.5074, lng: -0.1278, precision: 5},
		{name: "Precision 9 - Tokyo", lat: 35.6762, lng: 139.6503, precision: 9},
		{name: "Precision 1 - Equator", lat: 0.123, lng: 0.456, precision: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hash, err := Encode(tt.lat, tt.lng, tt.precision)
			if err != nil {
				t.Fatalf("Encode returned error: %v", err)
			}
			if len(hash) != tt.precision {
				t.Fatalf("encoded hash length %d != precision %d", len(hash), tt.precision)
			}

			decoded, err := Decode(hash)
			if err != nil {
				t.Fatalf("Decode(%q) returned error: %v", hash, err)
			}

			latDiff := math.Abs(decoded.Lat - tt.lat)
			lngDiff := math.Abs(decoded.Lng - tt.lng)

			if latDiff > decoded.LatError {
				t.Errorf("latDiff %f exceeds LatError %f (original lat: %f, decoded: %f)",
					latDiff, decoded.LatError, tt.lat, decoded.Lat)
			}
			if lngDiff > decoded.LngError {
				t.Errorf("lngDiff %f exceeds LngError %f (original lng: %f, decoded: %f)",
					lngDiff, decoded.LngError, tt.lng, decoded.Lng)
			}
		})
	}
}

func TestPrecisionDecreasesError(t *testing.T) {
	lat := 37.7749
	lng := -122.4194

	var prevLatErr, prevLngErr float64

	for p := 1; p <= 10; p++ {
		hash, err := Encode(lat, lng, p)
		if err != nil {
			t.Fatalf("Encode failed at precision %d: %v", p, err)
		}
		decoded, err := Decode(hash)
		if err != nil {
			t.Fatalf("Decode failed at precision %d: %v", p, err)
		}

		if p > 1 {
			if decoded.LatError >= prevLatErr {
				t.Errorf("precision %d LatError %f not smaller than precision %d LatError %f",
					p, decoded.LatError, p-1, prevLatErr)
			}
			if decoded.LngError >= prevLngErr {
				t.Errorf("precision %d LngError %f not smaller than precision %d LngError %f",
					p, decoded.LngError, p-1, prevLngErr)
			}
		}

		prevLatErr = decoded.LatError
		prevLngErr = decoded.LngError
	}
}

func TestEdgeCases(t *testing.T) {
	edgeCoordinates := []struct {
		name string
		lat  float64
		lng  float64
	}{
		{"North Pole", 90.0, 0.0},
		{"South Pole", -90.0, 0.0},
		{"Date Line East", 0.0, 180.0},
		{"Date Line West", 0.0, -180.0},
		{"Null Island", 0.0, 0.0},
		{"Corner Top Right", 90.0, 180.0},
		{"Corner Bottom Left", -90.0, -180.0},
	}

	for _, tc := range edgeCoordinates {
		t.Run(tc.name, func(t *testing.T) {
			hash, err := Encode(tc.lat, tc.lng, StandardPrecision)
			if err != nil {
				t.Fatalf("Encode at edge coordinate (%f, %f) failed: %v", tc.lat, tc.lng, err)
			}
			if len(hash) != StandardPrecision {
				t.Fatalf("expected hash length %d, got %d", StandardPrecision, len(hash))
			}

			decoded, err := Decode(hash)
			if err != nil {
				t.Fatalf("Decode at edge coordinate failed: %v", err)
			}

			if math.Abs(decoded.Lat-tc.lat) > decoded.LatError {
				t.Errorf("decoded lat out of bounds for %s: got %f, want %f ± %f",
					tc.name, decoded.Lat, tc.lat, decoded.LatError)
			}
			if math.Abs(decoded.Lng-tc.lng) > decoded.LngError {
				t.Errorf("decoded lng out of bounds for %s: got %f, want %f ± %f",
					tc.name, decoded.Lng, tc.lng, decoded.LngError)
			}
		})
	}
}

func TestInvalidInput(t *testing.T) {
	invalidCases := []struct {
		name      string
		lat       float64
		lng       float64
		precision int
	}{
		{"Latitude above 90", 91.0, 0.0, 5},
		{"Latitude below -90", -90.5, 0.0, 5},
		{"Longitude above 180", 0.0, 180.1, 5},
		{"Longitude below -180", 0.0, -181.0, 5},
		{"Precision 0", 10.0, 10.0, 0},
		{"Negative precision", 10.0, 10.0, -1},
	}

	for _, tc := range invalidCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Encode(tc.lat, tc.lng, tc.precision)
			if err == nil {
				t.Errorf("Encode(%f, %f, %d) expected error, got nil", tc.lat, tc.lng, tc.precision)
			}
		})
	}
}

func TestDecode_Invalid(t *testing.T) {
	invalidHashes := []struct {
		name string
		hash string
	}{
		{"Empty string", ""},
		{"Invalid characters !!!", "!!!"},
		{"Contains invalid letters a, i, l, o", "u4prua"},
		{"Contains invalid punctuation", "dr5-e"},
	}

	for _, tc := range invalidHashes {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Decode(tc.hash)
			if err == nil {
				t.Errorf("Decode(%q) expected error, got nil", tc.hash)
			}
		})
	}
}
