package matcher

import (
	"context"
	"errors"
	"testing"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

// TestBatchMatcher_BatchBeatsNaive demonstrates that global bipartite matching
// achieves a strictly lower total pickup distance than naive greedy sequential matching.
//
// Setup:
// Requests:
//   - R1 at (37.7749, -122.4194)
//   - R2 at (37.7749, -122.3700) (~4.3 km east)
//
// Drivers:
//   - Driver A at (37.7749, -122.4094) (~880m east of R1, ~3520m west of R2)
//   - Driver B at (37.7749, -122.4394) (~1760m west of R1, ~6160m west of R2)
//
// Naive greedy execution (R1 processed first):
//   - R1 chooses nearest: Driver A (880m). Driver A is claimed.
//   - R2 must choose remaining: Driver B (6160m).
//   - Naive Total Distance: 880 + 6160 = 7040m.
//
// Hungarian batch execution:
//   - R1 assigned to Driver B (1760m).
//   - R2 assigned to Driver A (3520m).
//   - Batch Total Distance: 1760 + 3520 = 5280m.
//   - 5280m < 7040m (25% reduction in total pickup distance).
func TestBatchMatcher_BatchBeatsNaive(t *testing.T) {
	ctx := context.Background()

	// 1. Initialize GeoIndex
	index := geoindex.NewGeoIndex()

	r1Pickup := geospatial.Point{Lat: 37.7749, Lng: -122.4100}
	r2Pickup := geospatial.Point{Lat: 37.7749, Lng: -122.3900}

	driverAPos := geospatial.Point{Lat: 37.7749, Lng: -122.4060}
	driverBPos := geospatial.Point{Lat: 37.7749, Lng: -122.4180}

	r1 := models.RideRequest{RideID: "R1", RiderID: "rider-1", Pickup: r1Pickup}
	r2 := models.RideRequest{RideID: "R2", RiderID: "rider-2", Pickup: r2Pickup}

	hashA, err := geospatial.Encode(driverAPos.Lat, driverAPos.Lng, geospatial.StandardPrecision)
	if err != nil {
		t.Fatalf("failed to encode hash for driver A: %v", err)
	}
	hashB, err := geospatial.Encode(driverBPos.Lat, driverBPos.Lng, geospatial.StandardPrecision)
	if err != nil {
		t.Fatalf("failed to encode hash for driver B: %v", err)
	}

	index.UpsertDriver("driver-A", hashA, "available", driverAPos.Lat, driverAPos.Lng)
	index.UpsertDriver("driver-B", hashB, "available", driverBPos.Lat, driverBPos.Lng)

	// Verify both drivers are discoverable from both pickups
	driversForR1, err := index.NearbyAvailableDrivers(r1Pickup, geospatial.StandardPrecision)
	if err != nil || len(driversForR1) < 2 {
		t.Fatalf("expected at least 2 drivers for R1, got %d (err: %v)", len(driversForR1), err)
	}
	driversForR2, err := index.NearbyAvailableDrivers(r2Pickup, geospatial.StandardPrecision)
	if err != nil || len(driversForR2) < 2 {
		t.Fatalf("expected at least 2 drivers for R2, got %d (err: %v)", len(driversForR2), err)
	}

	// 2. Evaluate BatchMatcher
	batchMatcher := BatchMatcher{}
	batchCandidates, err := batchMatcher.FindMatches(ctx, []models.RideRequest{r1, r2}, index)
	if err != nil {
		t.Fatalf("BatchMatcher.FindMatches failed: %v", err)
	}

	r1BatchCandidate := batchCandidates["R1"]
	r2BatchCandidate := batchCandidates["R2"]

	if len(r1BatchCandidate) == 0 || len(r2BatchCandidate) == 0 {
		t.Fatalf("expected candidates for both requests in batch matching")
	}

	// Batch optimal assignment: R1 -> Driver B, R2 -> Driver A
	if r1BatchCandidate[0].DriverID != "driver-B" {
		t.Errorf("expected R1 top candidate to be driver-B, got %s", r1BatchCandidate[0].DriverID)
	}
	if r2BatchCandidate[0].DriverID != "driver-A" {
		t.Errorf("expected R2 top candidate to be driver-A, got %s", r2BatchCandidate[0].DriverID)
	}

	batchTotalDistance := r1BatchCandidate[0].DistanceMeters + r2BatchCandidate[0].DistanceMeters

	// 3. Evaluate Naive Greedy Sequential Matching
	// In sequential assignment, R1 matches first and claims driver A.
	naiveMatcher := NaiveNearestMatcher{}

	r1NaiveCandidates, err := naiveMatcher.FindMatch(ctx, r1, index)
	if err != nil || len(r1NaiveCandidates) == 0 {
		t.Fatalf("Naive matcher failed for R1: %v", err)
	}
	chosenR1Driver := r1NaiveCandidates[0] // Nearest to R1 is driver-A
	if chosenR1Driver.DriverID != "driver-A" {
		t.Fatalf("expected R1 naive nearest to be driver-A, got %s", chosenR1Driver.DriverID)
	}

	// Simulate driver-A being claimed (no longer available for R2)
	index.UpsertDriver("driver-A", hashA, "busy", driverAPos.Lat, driverAPos.Lng)

	r2NaiveCandidates, err := naiveMatcher.FindMatch(ctx, r2, index)
	if err != nil || len(r2NaiveCandidates) == 0 {
		t.Fatalf("Naive matcher failed for R2: %v", err)
	}
	chosenR2Driver := r2NaiveCandidates[0] // Forced to take driver-B
	if chosenR2Driver.DriverID != "driver-B" {
		t.Fatalf("expected R2 naive nearest to be driver-B, got %s", chosenR2Driver.DriverID)
	}

	naiveTotalDistance := chosenR1Driver.DistanceMeters + chosenR2Driver.DistanceMeters

	// 4. Assert batch total distance is strictly lower than naive greedy total distance
	t.Logf("Comparative matching results: Batch Total = %.2f m, Naive Total = %.2f m (Savings: %.2f m / %.1f%%)",
		batchTotalDistance, naiveTotalDistance, naiveTotalDistance-batchTotalDistance,
		(naiveTotalDistance-batchTotalDistance)/naiveTotalDistance*100.0)

	if batchTotalDistance >= naiveTotalDistance {
		t.Fatalf("expected batchTotalDistance (%.2f) to be strictly less than naiveTotalDistance (%.2f)",
			batchTotalDistance, naiveTotalDistance)
	}
}

// TestBatchMatcher_RectangularPoolFallback tests that when there are more requests
// than available drivers (N > M), the rectangular Hungarian solver leaves the excess request
// unassigned (-1), triggering the fallback-within-fallback to naive nearest search so every
// request still receives at least one candidate.
func TestBatchMatcher_RectangularPoolFallback(t *testing.T) {
	ctx := context.Background()
	index := geoindex.NewGeoIndex()

	// 2 drivers available
	driver1Pos := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	driver2Pos := geospatial.Point{Lat: 37.7750, Lng: -122.4180}

	h1, _ := geospatial.Encode(driver1Pos.Lat, driver1Pos.Lng, geospatial.StandardPrecision)
	h2, _ := geospatial.Encode(driver2Pos.Lat, driver2Pos.Lng, geospatial.StandardPrecision)

	index.UpsertDriver("driver-1", h1, "available", driver1Pos.Lat, driver1Pos.Lng)
	index.UpsertDriver("driver-2", h2, "available", driver2Pos.Lat, driver2Pos.Lng)

	// 3 requests competing for 2 drivers
	reqs := []models.RideRequest{
		{RideID: "R1", RiderID: "u1", Pickup: geospatial.Point{Lat: 37.7748, Lng: -122.4190}},
		{RideID: "R2", RiderID: "u2", Pickup: geospatial.Point{Lat: 37.7751, Lng: -122.4185}},
		{RideID: "R3", RiderID: "u3", Pickup: geospatial.Point{Lat: 37.7745, Lng: -122.4200}},
	}

	batchMatcher := BatchMatcher{}
	candidatesMap, err := batchMatcher.FindMatches(ctx, reqs, index)
	if err != nil {
		t.Fatalf("FindMatches failed on rectangular batch: %v", err)
	}

	if len(candidatesMap) != len(reqs) {
		t.Fatalf("expected candidates for all %d requests, got %d", len(reqs), len(candidatesMap))
	}

	for _, req := range reqs {
		cands := candidatesMap[req.RideID]
		if len(cands) == 0 {
			t.Errorf("request %s received 0 candidates; expected at least 1 from fallback-within-fallback", req.RideID)
		}
	}
}

// TestBatchMatcher_NoDriversAvailable confirms ErrNoDriversAvailable is returned
// when the spatial pool is empty.
func TestBatchMatcher_NoDriversAvailable(t *testing.T) {
	ctx := context.Background()
	index := geoindex.NewGeoIndex() // completely empty index

	reqs := []models.RideRequest{
		{RideID: "R1", RiderID: "u1", Pickup: geospatial.Point{Lat: 37.7749, Lng: -122.4194}},
	}

	batchMatcher := BatchMatcher{}
	candidatesMap, err := batchMatcher.FindMatches(ctx, reqs, index)
	if !errors.Is(err, ErrNoDriversAvailable) {
		t.Fatalf("expected ErrNoDriversAvailable, got %v", err)
	}
	if len(candidatesMap) != 0 {
		t.Errorf("expected empty candidates map, got %d entries", len(candidatesMap))
	}
}

// TestBatchMatcher_ContextCancellation tests context deadline checks before and after solve.
func TestBatchMatcher_ContextCancellation(t *testing.T) {
	index := geoindex.NewGeoIndex()
	driverPos := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	h, _ := geospatial.Encode(driverPos.Lat, driverPos.Lng, geospatial.StandardPrecision)
	index.UpsertDriver("driver-1", h, "available", driverPos.Lat, driverPos.Lng)

	reqs := []models.RideRequest{
		{RideID: "R1", RiderID: "u1", Pickup: driverPos},
	}

	t.Run("context cancelled before call", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		batchMatcher := BatchMatcher{}
		_, err := batchMatcher.FindMatches(ctx, reqs, index)
		if !errors.Is(err, context.Canceled) {
			t.Errorf("expected context.Canceled, got %v", err)
		}
	})

	t.Run("context cancelled during solve", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())

		// Solver cancels context while executing
		batchMatcher := BatchMatcher{
			Solver: func(costMatrix [][]float64) ([]int, float64, error) {
				cancel()
				return []int{0}, 0.0, nil
			},
		}

		_, err := batchMatcher.FindMatches(ctx, reqs, index)
		if !errors.Is(err, context.Canceled) {
			t.Errorf("expected context.Canceled, got %v", err)
		}
	})
}
