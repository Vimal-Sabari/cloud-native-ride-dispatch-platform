package matcher

import (
	"math"
	"testing"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

func TestBuildCostMatrix_KnownPositions(t *testing.T) {
	// Reference points based on airport coordinates:
	// JFK: {Lat: 40.6413, Lng: -73.7781}
	// LAX: {Lat: 33.9416, Lng: -118.4085}
	// LHR: {Lat: 51.4700, Lng: -0.4543}
	// SFO: {Lat: 37.6213, Lng: -122.3790}

	requests := []models.RideRequest{
		{
			RideID:  "ride-jfk",
			RiderID: "rider-1",
			Pickup:  geospatial.Point{Lat: 40.6413, Lng: -73.7781},
		},
		{
			RideID:  "ride-lax",
			RiderID: "rider-2",
			Pickup:  geospatial.Point{Lat: 33.9416, Lng: -118.4085},
		},
	}

	drivers := []geoindex.DriverEntry{
		{
			DriverID: "driver-lhr",
			Lat:      51.4700,
			Lng:      -0.4543,
			Status:   "available",
		},
		{
			DriverID: "driver-sfo",
			Lat:      37.6213,
			Lng:      -122.3790,
			Status:   "available",
		},
		{
			DriverID: "driver-jfk",
			Lat:      40.6413,
			Lng:      -73.7781,
			Status:   "available",
		},
	}

	matrix := BuildCostMatrix(requests, drivers)

	if len(matrix) != len(requests) {
		t.Fatalf("expected matrix rows = %d, got %d", len(requests), len(matrix))
	}

	for i := range matrix {
		if len(matrix[i]) != len(drivers) {
			t.Fatalf("row %d: expected cols = %d, got %d", i, len(drivers), len(matrix[i]))
		}
	}

	// Verify each entry matches independent Haversine calculation
	for i, req := range requests {
		for j, d := range drivers {
			expected := geospatial.HaversineDistanceMeters(
				req.Pickup,
				geospatial.Point{Lat: d.Lat, Lng: d.Lng},
			)
			got := matrix[i][j]
			if math.Abs(got-expected) > 1e-6 {
				t.Errorf("matrix[%d][%d] mismatch: got %f, want %f", i, j, got, expected)
			}
		}
	}

	// Check specific known relationships:
	// JFK to JFK driver should be exactly 0
	if matrix[0][2] != 0.0 {
		t.Errorf("expected JFK-to-JFK distance to be 0.0, got %f", matrix[0][2])
	}

	// JFK to LHR is ~5,540 km (~5,540,000 m) within 0.5%
	jfkToLhr := matrix[0][0]
	if math.Abs(jfkToLhr-5540000.0)/5540000.0 > 0.005 {
		t.Errorf("JFK to LHR unexpected value: %f", jfkToLhr)
	}
}

func TestBuildCostMatrix_EmptyInputs(t *testing.T) {
	t.Run("empty requests", func(t *testing.T) {
		matrix := BuildCostMatrix(nil, []geoindex.DriverEntry{{DriverID: "d1"}})
		if len(matrix) != 0 {
			t.Errorf("expected 0 rows, got %d", len(matrix))
		}
	})

	t.Run("empty drivers", func(t *testing.T) {
		reqs := []models.RideRequest{{RideID: "r1"}}
		matrix := BuildCostMatrix(reqs, nil)
		if len(matrix) != 1 {
			t.Fatalf("expected 1 row, got %d", len(matrix))
		}
		if len(matrix[0]) != 0 {
			t.Errorf("expected 0 cols, got %d", len(matrix[0]))
		}
	})
}
