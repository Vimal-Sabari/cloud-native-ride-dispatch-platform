package geoindex

import (
	"sync"

	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

// DriverEntry represents an in-memory snapshot of a driver's location and availability.
type DriverEntry struct {
	DriverID string
	Geohash  string
	Status   string
	Lat      float64
	Lng      float64
}

// GeoIndex provides an in-memory, thread-safe spatial index partitioned by geohash cells.
// It tracks driver locations with secondary driver-to-cell indexing to enable O(1) location
// updates and fast spatial queries across target cells and their adjacent neighbors.
type GeoIndex struct {
	mu      sync.RWMutex
	cells   map[string]map[string]DriverEntry // cells[geohash][driverID] = DriverEntry
	drivers map[string]string                 // driverID -> current geohash
}

// NewGeoIndex initializes an empty, concurrency-safe spatial index.
func NewGeoIndex() *GeoIndex {
	return &GeoIndex{
		cells:   make(map[string]map[string]DriverEntry),
		drivers: make(map[string]string),
	}
}

// UpsertDriver inserts or updates a driver's position and status under a write lock.
// If the driver already exists in a different geohash cell, they are removed from the old
// cell first (utilizing the secondary drivers index to avoid a full table scan), then inserted
// into the new cell.
func (idx *GeoIndex) UpsertDriver(driverID, geohash, status string, lat, lng float64) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	// Check if driver was previously indexed in a different cell
	if oldGeohash, exists := idx.drivers[driverID]; exists && oldGeohash != geohash {
		if cell, ok := idx.cells[oldGeohash]; ok {
			delete(cell, driverID)
			if len(cell) == 0 {
				delete(idx.cells, oldGeohash)
			}
		}
	}

	// Update secondary driver-to-geohash mapping
	idx.drivers[driverID] = geohash

	// Ensure destination cell exists
	cell, exists := idx.cells[geohash]
	if !exists {
		cell = make(map[string]DriverEntry)
		idx.cells[geohash] = cell
	}

	// Insert or overwrite driver entry in the target cell
	cell[driverID] = DriverEntry{
		DriverID: driverID,
		Geohash:  geohash,
		Status:   status,
		Lat:      lat,
		Lng:      lng,
	}
}

// RemoveDriver removes a driver completely from the index under a write lock.
func (idx *GeoIndex) RemoveDriver(driverID string) {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	oldGeohash, exists := idx.drivers[driverID]
	if !exists {
		return
	}

	if cell, ok := idx.cells[oldGeohash]; ok {
		delete(cell, driverID)
		if len(cell) == 0 {
			delete(idx.cells, oldGeohash)
		}
	}
	delete(idx.drivers, driverID)
}

// GetDriver retrieves a copy of the DriverEntry for a given driver ID, if present.
func (idx *GeoIndex) GetDriver(driverID string) (DriverEntry, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	geohash, exists := idx.drivers[driverID]
	if !exists {
		return DriverEntry{}, false
	}

	if cell, ok := idx.cells[geohash]; ok {
		entry, found := cell[driverID]
		return entry, found
	}

	return DriverEntry{}, false
}

// NearbyAvailableDrivers finds all available drivers in the pickup's geohash cell and its 8
// immediate neighbors (9 cells total) at the specified precision.
// Order of returned drivers is intentionally unspecified (the matcher strategy handles ranking).
func (idx *GeoIndex) NearbyAvailableDrivers(pickup geospatial.Point, precision int) ([]DriverEntry, error) {
	centerHash, err := geospatial.Encode(pickup.Lat, pickup.Lng, precision)
	if err != nil {
		return nil, err
	}

	neighbors, err := geospatial.Neighbors(centerHash)
	if err != nil {
		return nil, err
	}

	targetCells := append([]string{centerHash}, neighbors...)

	idx.mu.RLock()
	defer idx.mu.RUnlock()

	var availableDrivers []DriverEntry
	for _, cellHash := range targetCells {
		if cell, exists := idx.cells[cellHash]; exists {
			for _, entry := range cell {
				if entry.Status == "available" {
					availableDrivers = append(availableDrivers, entry)
				}
			}
		}
	}

	return availableDrivers, nil
}
