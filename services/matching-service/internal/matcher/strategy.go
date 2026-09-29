package matcher

import (
	"context"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
)

// MatchStrategy defines the contract for selecting and ranking potential driver candidates for a ride request.
//
// Architectural & Forward-Compatibility Design Note:
// FindMatch returns a SLICE of ranked candidates ([]models.MatchCandidate), rather than a single candidate.
// This is intentional and serves two core architectural purposes:
//  1. Fallback Candidates for Assignment Retry: The sequential claim-then-confirm assignment pipeline
//     evaluates candidate drivers in ranked order. If the nearest driver is concurrently claimed by
//     another rider or heartbeat transition, the pipeline immediately falls back to the next candidate
//     without re-executing full spatial search.
//  2. Batch & Auction Forward-Compatibility: This interface contract remains identical and directly usable
//     for future batch matchers and auction-based bipartite graph matching algorithms (Module 23)
//     without requiring API breakage or structural redesign.
type MatchStrategy interface {
	FindMatch(ctx context.Context, request models.RideRequest, index *geoindex.GeoIndex) ([]models.MatchCandidate, error)
}
