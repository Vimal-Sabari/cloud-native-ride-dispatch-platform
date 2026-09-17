package geospatial

import (
	"errors"
)

// neighborOffset defines the coordinate delta multiplier for adjacent cells.
type neighborOffset struct {
	dy float64
	dx float64
}

// neighborOffsets defines the 8 adjacent directions in standard order:
// North, South, East, West, North-East, North-West, South-East, South-West.
var neighborOffsets = []neighborOffset{
	{dy: 1, dx: 0},   // N
	{dy: -1, dx: 0},  // S
	{dy: 0, dx: 1},   // E
	{dy: 0, dx: -1},  // W
	{dy: 1, dx: 1},   // NE
	{dy: 1, dx: -1},  // NW
	{dy: -1, dx: 1},  // SE
	{dy: -1, dx: -1}, // SW
}

// Neighbors returns the 8 adjacent geohashes (N, S, E, W, NE, NW, SE, SW)
// at the exact same precision as the input hash.
//
// Approach: Decode-Adjust-Reencode
// We calculate the neighbor cells by decoding the input hash to find the cell center
// (Lat, Lng) and its bounding box half-widths (LatError, LngError). The cell height
// is 2*LatError and width is 2*LngError. Stepping 2*LatError along latitude and
// 2*LngError along longitude places the target coordinate directly at the center
// of the adjacent cell.
//
// Boundary conditions:
//  1. Antimeridian wrapping: longitude is wrapped into [-180, 180] degrees.
//  2. Polar degeneracy: latitude is clamped to [-90, 90] degrees. At extreme latitudes
//     (near the poles), lines of longitude converge, leading to geographic degeneracy
//     where multiple compass directions may resolve to the polar cell.
func Neighbors(hash string) ([]string, error) {
	if len(hash) == 0 {
		return nil, errors.New("geospatial: empty geohash")
	}

	decoded, err := Decode(hash)
	if err != nil {
		return nil, err
	}

	precision := len(hash)
	deltaLat := 2.0 * decoded.LatError
	deltaLng := 2.0 * decoded.LngError

	neighbors := make([]string, 0, len(neighborOffsets))

	for _, offset := range neighborOffsets {
		targetLat := decoded.Lat + offset.dy*deltaLat
		targetLng := decoded.Lng + offset.dx*deltaLng

		// Wrap longitude across the 180° / -180° antimeridian
		for targetLng > 180.0 {
			targetLng -= 360.0
		}
		for targetLng < -180.0 {
			targetLng += 360.0
		}

		// Clamp latitude at the poles [-90, 90]
		if targetLat > 90.0 {
			targetLat = 90.0
		} else if targetLat < -90.0 {
			targetLat = -90.0
		}

		neighborHash, err := Encode(targetLat, targetLng, precision)
		if err != nil {
			return nil, err
		}

		neighbors = append(neighbors, neighborHash)
	}

	return neighbors, nil
}
