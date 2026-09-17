// Package geospatial provides pure, concurrency-safe geospatial calculations
// including Geohash encoding/decoding, Haversine great-circle distance computation,
// and adjacent cell neighbor lookups without external dependencies.
package geospatial

import (
	"errors"
	"fmt"
	"strings"
)

// Base32Alphabet defines the standard 32-character alphabet used by geohash.
// Note: characters 'a', 'i', 'l', and 'o' are excluded to prevent visual ambiguity.
const Base32Alphabet = "0123456789bcdefghjkmnpqrstuvwxyz"

// StandardPrecision is the project-standard geohash precision (5 characters, ~4.9km x 4.9km)
// per the architectural decision record (ADR).
const StandardPrecision = 5

// DecodedHash contains the decoded latitude and longitude coordinates along with
// the half-width error boundaries corresponding to the cell's precision.
type DecodedHash struct {
	Lat      float64
	Lng      float64
	LatError float64
	LngError float64
}

// alphabetMap provides O(1) character-to-index lookups during decoding.
var alphabetMap = func() map[rune]int {
	m := make(map[rune]int, len(Base32Alphabet))
	for i, r := range Base32Alphabet {
		m[r] = i
	}
	return m
}()

// Encode encodes a latitude and longitude into a geohash string of the specified precision.
// The precision parameter specifies the number of characters in the resulting base32 hash.
// Note: StandardPrecision (5) is the project default per architecture ADR, but callers
// must pass precision explicitly.
//
// Latitude must be in [-90, 90] and Longitude must be in [-180, 180]. Precision must be > 0.
func Encode(lat, lng float64, precision int) (string, error) {
	if lat < -90.0 || lat > 90.0 {
		return "", fmt.Errorf("geospatial: latitude %f out of range [-90, 90]", lat)
	}
	if lng < -180.0 || lng > 180.0 {
		return "", fmt.Errorf("geospatial: longitude %f out of range [-180, 180]", lng)
	}
	if precision <= 0 {
		return "", fmt.Errorf("geospatial: precision must be positive, got %d", precision)
	}

	latInterval := [2]float64{-90.0, 90.0}
	lngInterval := [2]float64{-180.0, 180.0}

	var sb strings.Builder
	sb.Grow(precision)

	bits := 0
	ch := 0
	isEven := true // Longitude bits occupy even positions, latitude bits occupy odd

	for sb.Len() < precision {
		if isEven {
			mid := (lngInterval[0] + lngInterval[1]) / 2.0
			if lng >= mid {
				ch = (ch << 1) | 1
				lngInterval[0] = mid
			} else {
				ch = ch << 1
				lngInterval[1] = mid
			}
		} else {
			mid := (latInterval[0] + latInterval[1]) / 2.0
			if lat >= mid {
				ch = (ch << 1) | 1
				latInterval[0] = mid
			} else {
				ch = ch << 1
				latInterval[1] = mid
			}
		}

		isEven = !isEven
		bits++

		if bits == 5 {
			sb.WriteByte(Base32Alphabet[ch])
			bits = 0
			ch = 0
		}
	}

	return sb.String(), nil
}

// Decode decodes a geohash string into latitude and longitude coordinates
// and their bounding error margins.
// Returns an error if the input string is empty or contains non-base32 characters.
func Decode(hash string) (DecodedHash, error) {
	if len(hash) == 0 {
		return DecodedHash{}, errors.New("geospatial: empty geohash")
	}

	latInterval := [2]float64{-90.0, 90.0}
	lngInterval := [2]float64{-180.0, 180.0}

	isEven := true

	for _, r := range strings.ToLower(hash) {
		val, ok := alphabetMap[r]
		if !ok {
			return DecodedHash{}, fmt.Errorf("geospatial: invalid character %q in geohash", r)
		}

		for mask := 16; mask > 0; mask >>= 1 {
			bit := (val & mask) != 0
			if isEven {
				mid := (lngInterval[0] + lngInterval[1]) / 2.0
				if bit {
					lngInterval[0] = mid
				} else {
					lngInterval[1] = mid
				}
			} else {
				mid := (latInterval[0] + latInterval[1]) / 2.0
				if bit {
					latInterval[0] = mid
				} else {
					latInterval[1] = mid
				}
			}
			isEven = !isEven
		}
	}

	lat := (latInterval[0] + latInterval[1]) / 2.0
	lng := (lngInterval[0] + lngInterval[1]) / 2.0
	latError := (latInterval[1] - latInterval[0]) / 2.0
	lngError := (lngInterval[1] - lngInterval[0]) / 2.0

	return DecodedHash{
		Lat:      lat,
		Lng:      lng,
		LatError: latError,
		LngError: lngError,
	}, nil
}
