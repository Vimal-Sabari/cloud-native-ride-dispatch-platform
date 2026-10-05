package matcher

import (
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

// BuildCostMatrix computes a cost matrix of dimensions len(requests) x len(drivers),
// where each entry [i][j] represents the spherical Haversine distance in meters
// between request i's pickup point and driver j's current coordinate.
func BuildCostMatrix(requests []models.RideRequest, drivers []geoindex.DriverEntry) [][]float64 {
	if len(requests) == 0 {
		return [][]float64{}
	}

	matrix := make([][]float64, len(requests))
	numDrivers := len(drivers)

	for i, req := range requests {
		matrix[i] = make([]float64, numDrivers)
		for j, d := range drivers {
			matrix[i][j] = geospatial.HaversineDistanceMeters(
				req.Pickup,
				geospatial.Point{Lat: d.Lat, Lng: d.Lng},
			)
		}
	}

	return matrix
}
