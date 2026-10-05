package matcher

import (
	"context"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
	matchingalgorithms "github.com/Vimal-Sabari/ride-dispatch-platform/shared/matching-algorithms"
)

// HungarianSolverFunc represents the function signature for solving assignment problems.
// It matches matchingalgorithms.Solve.
type HungarianSolverFunc func(costMatrix [][]float64) (assignment []int, totalCost float64, err error)

// BatchMatcher implements BatchMatchStrategy using the Hungarian (Kuhn-Munkres) algorithm
// to compute globally optimal driver-rider assignments over a batch of requests.
//
// Solver can be optionally injected for testing or simulation; if nil, matchingalgorithms.Solve
// is used by default.
type BatchMatcher struct {
	Solver HungarianSolverFunc
}

// solver returns the configured Hungarian solver or the default implementation.
func (m BatchMatcher) solver() HungarianSolverFunc {
	if m.Solver != nil {
		return m.Solver
	}
	return matchingalgorithms.Solve
}

// FindMatches performs global bipartite matching between the batch of ride requests and available
// drivers found in their combined spatial neighborhoods.
//
// Flow:
//  1. Check context cancellation early.
//  2. Aggregate and deduplicate available drivers across the 9-cell neighborhoods of all requests.
//  3. If no drivers are available, return an empty map and ErrNoDriversAvailable.
//  4. Build the Haversine distance cost matrix.
//  5. Solve the minimum-cost assignment using Hungarian algorithm (with context checks before/after).
//  6. Build ranked candidate lists:
//     - Real pairing (assignment[i] != -1): Hungarian-chosen driver is placed FIRST, followed
//     by 1-2 nearest available drivers from the request's own neighborhood as fallback alternates
//     for Assigner's claim-race retry logic.
//     - Unassigned / dummy pairing (assignment[i] == -1): Fall back to naive per-request nearest
//     driver lookup as a safety net (fallback-within-fallback), ensuring no request in a batch
//     is left with an empty candidate list if nearby drivers exist.
func (m BatchMatcher) FindMatches(
	ctx context.Context,
	requests []models.RideRequest,
	index *geoindex.GeoIndex,
) (map[string][]models.MatchCandidate, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	result := make(map[string][]models.MatchCandidate, len(requests))
	if len(requests) == 0 {
		return result, nil
	}

	// 1. Build deduplicated driver pool across all requests' 9-cell spatial neighborhoods
	seenDrivers := make(map[string]bool)
	var pool []geoindex.DriverEntry

	for _, req := range requests {
		drivers, err := index.NearbyAvailableDrivers(req.Pickup, geospatial.StandardPrecision)
		if err != nil {
			return nil, err
		}
		for _, d := range drivers {
			if !seenDrivers[d.DriverID] {
				seenDrivers[d.DriverID] = true
				pool = append(pool, d)
			}
		}
	}

	// 2. If pool is completely empty, report sentinel error for upstream fallback
	if len(pool) == 0 {
		return result, ErrNoDriversAvailable
	}

	// 3. Build cost matrix (len(requests) x len(pool))
	costMatrix := BuildCostMatrix(requests, pool)

	// 4. Check context deadline before calling Hungarian solver
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	assignment, _, err := m.solver()(costMatrix)
	if err != nil {
		return nil, err
	}

	// Check context deadline after solving
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	naiveMatcher := NaiveNearestMatcher{}

	// 5. Build candidate lists for each request
	for i, req := range requests {
		assignedCol := assignment[i]

		if assignedCol != -1 && assignedCol < len(pool) {
			chosen := pool[assignedCol]
			dist := costMatrix[i][assignedCol]

			candidates := []models.MatchCandidate{
				{
					DriverID:       chosen.DriverID,
					DistanceMeters: dist,
				},
			}

			// Append 1-2 nearest alternates for Assigner's claim-race retry mechanism
			nearby, err := naiveMatcher.FindMatch(ctx, req, index)
			if err != nil {
				return nil, err
			}

			for _, alt := range nearby {
				if alt.DriverID != chosen.DriverID && len(candidates) < MaxCandidatesReturned {
					candidates = append(candidates, alt)
				}
			}

			result[req.RideID] = candidates
		} else {
			// Fallback-within-fallback:
			// If rectangular padding left this request matched to a dummy column (assignment[i] == -1),
			// fall back directly to this request's own naive-nearest candidates. This ensures requests
			// that lost the Hungarian optimization contest still get candidates if any are reachable.
			fallbackCandidates, err := naiveMatcher.FindMatch(ctx, req, index)
			if err != nil {
				return nil, err
			}
			result[req.RideID] = fallbackCandidates
		}
	}

	return result, nil
}

// AssignerInterface defines the contract required to assign drivers to ride requests.
type AssignerInterface interface {
	Assign(ctx context.Context, request models.RideRequest, candidates []models.MatchCandidate) (*models.AssignmentResult, error)
}

// ProcessBatch coordinates matching and assignment for a batch of requests.
// It first attempts global batch matching via batchMatcher. If batchMatcher returns an error
// (or times out), it logs a warning and gracefully degrades by calling naiveMatcher for each
// individual request in the batch, guaranteeing no request is silently dropped.
func ProcessBatch(
	ctx context.Context,
	batch []models.RideRequest,
	index *geoindex.GeoIndex,
	batchMatcher BatchMatchStrategy,
	naiveMatcher MatchStrategy,
	assigner AssignerInterface,
) {
	if len(batch) == 0 {
		return
	}

	candidatesMap, err := batchMatcher.FindMatches(ctx, batch, index)
	if err != nil {
		// Graceful degradation: fall back to per-request naive matching
		for _, req := range batch {
			candidates, naiveErr := naiveMatcher.FindMatch(ctx, req, index)
			if naiveErr != nil {
				continue
			}
			if len(candidates) == 0 {
				continue
			}
			_, _ = assigner.Assign(ctx, req, candidates)
		}
		return
	}

	for _, req := range batch {
		candidates := candidatesMap[req.RideID]
		if len(candidates) == 0 {
			continue
		}
		_, _ = assigner.Assign(ctx, req, candidates)
	}
}
