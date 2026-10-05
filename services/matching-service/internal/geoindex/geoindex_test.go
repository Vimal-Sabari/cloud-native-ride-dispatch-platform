package geoindex

import (
	"fmt"
	"sync"
	"testing"

	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

func TestGeoIndex_BasicOperations(t *testing.T) {
	idx := NewGeoIndex()

	// 1. Initial lookup on empty index
	if _, found := idx.GetDriver("d1"); found {
		t.Fatalf("expected d1 not found in empty index")
	}

	// 2. Upsert a driver
	idx.UpsertDriver("d1", "9q8yy", "available", 37.7749, -122.4194)
	d1, found := idx.GetDriver("d1")
	if !found {
		t.Fatalf("expected d1 to be found")
	}
	if d1.DriverID != "d1" || d1.Geohash != "9q8yy" || d1.Status != "available" {
		t.Fatalf("unexpected d1 fields: %+v", d1)
	}

	// 3. Move driver to another cell: should be removed from old cell
	idx.UpsertDriver("d1", "9q8yz", "busy", 37.7750, -122.4190)
	d1Moved, found := idx.GetDriver("d1")
	if !found {
		t.Fatalf("expected d1 to be found after move")
	}
	if d1Moved.Geohash != "9q8yz" || d1Moved.Status != "busy" {
		t.Fatalf("expected d1 moved to 9q8yz with busy status, got %+v", d1Moved)
	}
	// Verify old cell no longer has d1
	if cell, exists := idx.cells["9q8yy"]; exists {
		if _, stillThere := cell["d1"]; stillThere {
			t.Fatalf("expected d1 to be deleted from old cell 9q8yy")
		}
	}

	// 4. Update status in-place without moving cell
	idx.UpsertDriver("d1", "9q8yz", "available", 37.7750, -122.4190)
	d1Updated, _ := idx.GetDriver("d1")
	if d1Updated.Status != "available" {
		t.Fatalf("expected status available, got %s", d1Updated.Status)
	}

	// 5. Remove driver
	idx.RemoveDriver("d1")
	if _, found := idx.GetDriver("d1"); found {
		t.Fatalf("expected d1 to be removed")
	}
	if _, exists := idx.cells["9q8yz"]; exists {
		t.Fatalf("expected empty cell to be cleaned up")
	}

	// 6. Removing non-existent driver should not panic
	idx.RemoveDriver("d999")
}

func TestGeoIndex_NearbyAvailableDrivers(t *testing.T) {
	idx := NewGeoIndex()

	centerPt := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	centerHash, err := geospatial.Encode(centerPt.Lat, centerPt.Lng, geospatial.StandardPrecision)
	if err != nil {
		t.Fatalf("failed to encode center hash: %v", err)
	}

	neighbors, err := geospatial.Neighbors(centerHash)
	if err != nil {
		t.Fatalf("failed to compute neighbors: %v", err)
	}

	// Driver 1: Available in center cell
	idx.UpsertDriver("d-center", centerHash, "available", 37.7749, -122.4194)

	// Driver 2: Available in neighbor 0
	idx.UpsertDriver("d-neighbor", neighbors[0], "available", 37.7800, -122.4200)

	// Driver 3: Busy in neighbor 1 (should NOT be returned)
	idx.UpsertDriver("d-busy", neighbors[1], "busy", 37.7850, -122.4250)

	// Driver 4: Offline in center cell (should NOT be returned)
	idx.UpsertDriver("d-offline", centerHash, "offline", 37.7740, -122.4190)

	// Driver 5: Available in a faraway cell (e.g. New York, "dr5reg") (should NOT be returned)
	idx.UpsertDriver("d-faraway", "dr5reg", "available", 40.7128, -74.0060)

	results, err := idx.NearbyAvailableDrivers(centerPt, geospatial.StandardPrecision)
	if err != nil {
		t.Fatalf("unexpected error from NearbyAvailableDrivers: %v", err)
	}

	if len(results) != 2 {
		t.Fatalf("expected 2 available drivers in 9-cell radius, got %d: %+v", len(results), results)
	}

	foundIDs := make(map[string]bool)
	for _, d := range results {
		foundIDs[d.DriverID] = true
	}

	if !foundIDs["d-center"] || !foundIDs["d-neighbor"] {
		t.Fatalf("expected d-center and d-neighbor in results, got: %+v", foundIDs)
	}
	if foundIDs["d-busy"] || foundIDs["d-offline"] || foundIDs["d-faraway"] {
		t.Fatalf("unwanted driver included in results: %+v", foundIDs)
	}
}

func TestGeoIndex_NearbyAvailableDrivers_InvalidPrecision(t *testing.T) {
	idx := NewGeoIndex()
	_, err := idx.NearbyAvailableDrivers(geospatial.Point{Lat: 37.7749, Lng: -122.4194}, 0)
	if err == nil {
		t.Fatalf("expected error for non-positive precision")
	}
}

func TestGeoIndex_ConcurrentAccessRace(t *testing.T) {
	idx := NewGeoIndex()
	const numGoroutines = 50
	var wg sync.WaitGroup

	// Concurrently upsert drivers
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			driverID := fmt.Sprintf("driver-%d", id)
			lat := 37.7 + float64(id)*0.001
			lng := -122.4 + float64(id)*0.001
			hash, _ := geospatial.Encode(lat, lng, 5)

			// Initial insert
			idx.UpsertDriver(driverID, hash, "available", lat, lng)

			// Relocate to another cell
			newHash, _ := geospatial.Encode(lat+0.01, lng+0.01, 5)
			idx.UpsertDriver(driverID, newHash, "busy", lat+0.01, lng+0.01)

			// Toggle availability
			idx.UpsertDriver(driverID, newHash, "available", lat+0.01, lng+0.01)
		}(i)
	}

	// Concurrently query nearby drivers while upserts are ongoing
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			pickup := geospatial.Point{Lat: 37.75, Lng: -122.45}
			_, _ = idx.NearbyAvailableDrivers(pickup, 5)
			_, _ = idx.GetDriver(fmt.Sprintf("driver-%d", id))
		}(i)
	}

	// Concurrently remove a subset
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			idx.RemoveDriver(fmt.Sprintf("driver-%d", id))
		}(i)
	}

	wg.Wait()
}

func TestGeoIndex_UpdateDriverStatus(t *testing.T) {
	idx := NewGeoIndex()
	lat, lng := 37.7749, -122.4194
	hash, _ := geospatial.Encode(lat, lng, 5)

	idx.UpsertDriver("driver-status-test", hash, "available", lat, lng)

	pickup := geospatial.Point{Lat: lat, Lng: lng}
	drivers, err := idx.NearbyAvailableDrivers(pickup, 5)
	if err != nil || len(drivers) != 1 {
		t.Fatalf("expected 1 available driver, got %d (err: %v)", len(drivers), err)
	}

	// Update status to busy
	idx.UpdateDriverStatus("driver-status-test", "busy")
	drivers, err = idx.NearbyAvailableDrivers(pickup, 5)
	if err != nil || len(drivers) != 0 {
		t.Fatalf("expected 0 available drivers after status update to busy, got %d", len(drivers))
	}

	// Revert status to available
	idx.UpdateDriverStatus("driver-status-test", "available")
	drivers, err = idx.NearbyAvailableDrivers(pickup, 5)
	if err != nil || len(drivers) != 1 {
		t.Fatalf("expected 1 available driver after status update to available, got %d", len(drivers))
	}
}
