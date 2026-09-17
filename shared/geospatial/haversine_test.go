package geospatial

import (
	"math"
	"testing"
)

func TestHaversineDistanceMeters_KnownAirportDistances(t *testing.T) {
	tests := []struct {
		name                 string
		from                 Point
		to                   Point
		expectedMeters       float64
		maxAllowedErrorRatio float64 // 0.5% tolerance
	}{
		{
			name:                 "JFK (New York) to LHR (London Heathrow)",
			from:                 Point{Lat: 40.6413, Lng: -73.7781},
			to:                   Point{Lat: 51.4700, Lng: -0.4543},
			expectedMeters:       5540000.0, // ~5,540 km great-circle distance
			maxAllowedErrorRatio: 0.005,     // 0.5%
		},
		{
			name:                 "LAX (Los Angeles) to JFK (New York)",
			from:                 Point{Lat: 33.9416, Lng: -118.4085},
			to:                   Point{Lat: 40.6413, Lng: -73.7781},
			expectedMeters:       3983000.0, // ~3,983 km
			maxAllowedErrorRatio: 0.005,
		},
		{
			name:                 "SYD (Sydney) to MEL (Melbourne)",
			from:                 Point{Lat: -33.9461, Lng: 151.1772},
			to:                   Point{Lat: -37.6690, Lng: 144.8410},
			expectedMeters:       706000.0, // ~706 km
			maxAllowedErrorRatio: 0.005,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := HaversineDistanceMeters(tt.from, tt.to)
			errRatio := math.Abs(got-tt.expectedMeters) / tt.expectedMeters

			if errRatio > tt.maxAllowedErrorRatio {
				t.Errorf("HaversineDistanceMeters(%+v, %+v) = %f meters; want %f meters (error ratio: %.4f, max allowed: %.4f)",
					tt.from, tt.to, got, tt.expectedMeters, errRatio, tt.maxAllowedErrorRatio)
			}
		})
	}
}

func TestHaversineDistanceMeters_ZeroDistance(t *testing.T) {
	points := []Point{
		{Lat: 0.0, Lng: 0.0},
		{Lat: 40.7128, Lng: -74.0060},
		{Lat: -90.0, Lng: 0.0},
		{Lat: 51.5074, Lng: -0.1278},
	}

	for _, p := range points {
		dist := HaversineDistanceMeters(p, p)
		if dist != 0.0 {
			t.Errorf("HaversineDistanceMeters(%+v, %+v) = %f; want exactly 0.0", p, p, dist)
		}
	}
}

func TestHaversineDistanceMeters_SmallPreciseDistance(t *testing.T) {
	// At the equator, 1 second of arc (1/3600 degree) latitude is approx 30.87 meters.
	// 0.0009 degrees of latitude is ~100.08 meters (6371000 * 0.0009 * pi / 180 = ~100.08 meters).
	p1 := Point{Lat: 0.0, Lng: 0.0}
	p2 := Point{Lat: 0.0009, Lng: 0.0}

	expected := EarthRadiusMeters * (0.0009 * math.Pi / 180.0)
	got := HaversineDistanceMeters(p1, p2)

	diff := math.Abs(got - expected)
	if diff > 0.01 { // Within 1 cm precision
		t.Errorf("small distance got %f meters; want %f meters (diff: %f)", got, expected, diff)
	}

	// Verify it's approximately 100 meters
	if got < 99.0 || got > 101.0 {
		t.Errorf("expected ~100 meters, got %f meters", got)
	}
}

func TestHaversineDistanceMeters_Symmetry(t *testing.T) {
	testPairs := []struct {
		a Point
		b Point
	}{
		{Point{Lat: 40.7128, Lng: -74.0060}, Point{Lat: 34.0522, Lng: -118.2437}},
		{Point{Lat: -33.8688, Lng: 151.2093}, Point{Lat: 51.5074, Lng: -0.1278}},
		{Point{Lat: 1.3521, Lng: 103.8198}, Point{Lat: -1.2921, Lng: 36.8219}},
	}

	for _, pair := range testPairs {
		distAB := HaversineDistanceMeters(pair.a, pair.b)
		distBA := HaversineDistanceMeters(pair.b, pair.a)

		if math.Abs(distAB-distBA) > 1e-9 {
			t.Errorf("symmetry violated: dist(A, B) = %f, dist(B, A) = %f", distAB, distBA)
		}
	}
}
