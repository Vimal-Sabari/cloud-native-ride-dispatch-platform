package geospatial

import (
	"math"
)

// EarthRadiusMeters is the standard mean radius of the Earth in meters.
const EarthRadiusMeters = 6371000.0

// Point represents a geographic coordinate pair in degrees.
type Point struct {
	Lat float64
	Lng float64
}

// degreesToRadians converts degrees to radians.
func degreesToRadians(d float64) float64 {
	return d * (math.Pi / 180.0)
}

// HaversineDistanceMeters calculates the great-circle distance between two geographic points
// using the Haversine formula on a spherical Earth with radius 6,371,000 meters.
func HaversineDistanceMeters(a, b Point) float64 {
	if a.Lat == b.Lat && a.Lng == b.Lng {
		return 0.0
	}

	lat1 := degreesToRadians(a.Lat)
	lat2 := degreesToRadians(b.Lat)
	deltaLat := degreesToRadians(b.Lat - a.Lat)
	deltaLng := degreesToRadians(b.Lng - a.Lng)

	sinHalfDeltaLat := math.Sin(deltaLat / 2.0)
	sinHalfDeltaLng := math.Sin(deltaLng / 2.0)

	h := sinHalfDeltaLat*sinHalfDeltaLat +
		math.Cos(lat1)*math.Cos(lat2)*sinHalfDeltaLng*sinHalfDeltaLng

	// Guard against precision issues where h slightly exceeds 1.0 or is below 0.0
	if h > 1.0 {
		h = 1.0
	} else if h < 0.0 {
		h = 0.0
	}

	c := 2.0 * math.Atan2(math.Sqrt(h), math.Sqrt(1.0-h))

	return EarthRadiusMeters * c
}
