package matcher

import (
	"context"
	"errors"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
)

// ErrNoDriversAvailable is returned when a batch matching evaluation finds no available
// drivers in the spatial neighborhood across all requests in the batch.
var ErrNoDriversAvailable = errors.New("no available drivers found in candidate pool")

// BatchMatchStrategy defines the contract for computing optimal assignments across
// a batch of concurrent ride requests simultaneously.
//
// Architectural Design Note:
// This interface is intentionally SEPARATE from Module 17's per-request MatchStrategy interface.
// A batch operation naturally evaluates many requests in a single global optimization pass
// (e.g. via the Hungarian algorithm or bipartite matching), rather than matching one request
// in isolation. However, BatchMatchStrategy is designed so its output — a map keyed by RideID
// containing ranked candidate slices (map[string][]models.MatchCandidate) — feeds the EXACT
// SAME downstream Assigner.Assign logic unchanged, maintaining strict compatibility and reuse
// of existing claim-race retry semantics.
type BatchMatchStrategy interface {
	FindMatches(ctx context.Context, requests []models.RideRequest, index *geoindex.GeoIndex) (map[string][]models.MatchCandidate, error)
}
