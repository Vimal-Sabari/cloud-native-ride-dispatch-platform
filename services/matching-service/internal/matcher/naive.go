package matcher

import (
	"context"
	"sort"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

// MaxCandidatesReturned defines the maximum number of fallback candidates selected by the naive matcher.
const MaxCandidatesReturned = 3

// NaiveNearestMatcher implements MatchStrategy by searching for available drivers in the 9-cell
// spatial neighborhood (precision 5, ~4.9km x 4.9km per cell), sorting them ascending by Haversine distance,
// and returning up to the top 3 candidates.
type NaiveNearestMatcher struct{}

// FindMatch locates nearby available drivers and ranks them nearest-first.
// Returns (nil, nil) if no available drivers are found in the vicinity.
func (m NaiveNearestMatcher) FindMatch(ctx context.Context, request models.RideRequest, index *geoindex.GeoIndex) ([]models.MatchCandidate, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	drivers, err := index.NearbyAvailableDrivers(request.Pickup, geospatial.StandardPrecision)
	if err != nil {
		return nil, err
	}

	if len(drivers) == 0 {
		return nil, nil
	}

	candidates := make([]models.MatchCandidate, 0, len(drivers))
	for _, driver := range drivers {
		dist := geospatial.HaversineDistanceMeters(
			request.Pickup,
			geospatial.Point{Lat: driver.Lat, Lng: driver.Lng},
		)
		candidates = append(candidates, models.MatchCandidate{
			DriverID:       driver.DriverID,
			DistanceMeters: dist,
		})
	}

	// Sort candidates ascending by spherical distance
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].DistanceMeters < candidates[j].DistanceMeters
	})

	if len(candidates) > MaxCandidatesReturned {
		candidates = candidates[:MaxCandidatesReturned]
	}

	return candidates, nil
}
