package matcher

import (
	"context"
	"testing"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

func TestNaiveNearestMatcher_RankingAndCap(t *testing.T) {
	idx := geoindex.NewGeoIndex()
	pickup := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	cellHash, err := geospatial.Encode(pickup.Lat, pickup.Lng, geospatial.StandardPrecision)
	if err != nil {
		t.Fatalf("failed to encode pickup geohash: %v", err)
	}

	// Driver A: closest (~50m away)
	latA, lngA := 37.7753, -122.4194
	idx.UpsertDriver("driver-A", cellHash, "available", latA, lngA)

	// Driver B: second closest (~200m away)
	latB, lngB := 37.7767, -122.4194
	idx.UpsertDriver("driver-B", cellHash, "available", latB, lngB)

	// Driver C: third closest (~500m away)
	latC, lngC := 37.7794, -122.4194
	idx.UpsertDriver("driver-C", cellHash, "available", latC, lngC)

	// Driver D: fourth closest (~1000m away) - should be excluded by the top 3 cap!
	latD, lngD := 37.7839, -122.4194
	idx.UpsertDriver("driver-D", cellHash, "available", latD, lngD)

	// Driver E: busy driver right next to pickup (~10m away) - should be excluded by status!
	idx.UpsertDriver("driver-E", cellHash, "busy", 37.7750, -122.4194)

	matcher := NaiveNearestMatcher{}
	req := models.RideRequest{
		RideID:  "ride-101",
		RiderID: "rider-202",
		Pickup:  pickup,
	}

	candidates, err := matcher.FindMatch(context.Background(), req, idx)
	if err != nil {
		t.Fatalf("unexpected error from FindMatch: %v", err)
	}

	if len(candidates) != 3 {
		t.Fatalf("expected exactly 3 candidates (capped), got %d", len(candidates))
	}

	// Verify nearest-first ranking: Driver A < Driver B < Driver C
	if candidates[0].DriverID != "driver-A" {
		t.Errorf("expected 1st candidate to be driver-A, got %s", candidates[0].DriverID)
	}
	if candidates[1].DriverID != "driver-B" {
		t.Errorf("expected 2nd candidate to be driver-B, got %s", candidates[1].DriverID)
	}
	if candidates[2].DriverID != "driver-C" {
		t.Errorf("expected 3rd candidate to be driver-C, got %s", candidates[2].DriverID)
	}

	// Verify distances are strictly monotonically increasing
	if candidates[0].DistanceMeters >= candidates[1].DistanceMeters ||
		candidates[1].DistanceMeters >= candidates[2].DistanceMeters {
		t.Errorf("expected strictly ascending distances, got: %f, %f, %f",
			candidates[0].DistanceMeters, candidates[1].DistanceMeters, candidates[2].DistanceMeters)
	}
}

func TestNaiveNearestMatcher_ZeroDrivers(t *testing.T) {
	idx := geoindex.NewGeoIndex()
	matcher := NaiveNearestMatcher{}

	req := models.RideRequest{
		RideID:  "ride-101",
		RiderID: "rider-202",
		Pickup:  geospatial.Point{Lat: 37.7749, Lng: -122.4194},
	}

	candidates, err := matcher.FindMatch(context.Background(), req, idx)
	if err != nil {
		t.Fatalf("expected nil error when zero drivers nearby, got: %v", err)
	}
	if candidates != nil {
		t.Fatalf("expected nil candidates slice when zero drivers nearby, got: %+v", candidates)
	}
}

func TestNaiveNearestMatcher_FewerThanThreeDrivers(t *testing.T) {
	idx := geoindex.NewGeoIndex()
	pickup := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	cellHash, _ := geospatial.Encode(pickup.Lat, pickup.Lng, geospatial.StandardPrecision)

	// Only 1 driver available
	idx.UpsertDriver("driver-only", cellHash, "available", 37.7750, -122.4190)

	matcher := NaiveNearestMatcher{}
	req := models.RideRequest{
		RideID:  "ride-101",
		RiderID: "rider-202",
		Pickup:  pickup,
	}

	candidates, err := matcher.FindMatch(context.Background(), req, idx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(candidates) != 1 {
		t.Fatalf("expected 1 candidate, got %d", len(candidates))
	}
	if candidates[0].DriverID != "driver-only" {
		t.Errorf("expected driver-only, got %s", candidates[0].DriverID)
	}
}

func TestNaiveNearestMatcher_ContextCancelled(t *testing.T) {
	idx := geoindex.NewGeoIndex()
	matcher := NaiveNearestMatcher{}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	req := models.RideRequest{
		RideID:  "ride-101",
		RiderID: "rider-202",
		Pickup:  geospatial.Point{Lat: 37.7749, Lng: -122.4194},
	}

	_, err := matcher.FindMatch(ctx, req, idx)
	if err == nil {
		t.Fatalf("expected context cancellation error")
	}
}
