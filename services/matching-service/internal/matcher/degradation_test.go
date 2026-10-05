package matcher

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

// mockFailingBatchMatcher is a fake BatchMatchStrategy that always returns an error.
type mockFailingBatchMatcher struct {
	err error
}

func (m mockFailingBatchMatcher) FindMatches(ctx context.Context, requests []models.RideRequest, index *geoindex.GeoIndex) (map[string][]models.MatchCandidate, error) {
	return nil, m.err
}

// recordingAssigner tracks which requests and candidate lists were sent to Assign.
type recordingAssigner struct {
	mu          sync.Mutex
	assignedReq []models.RideRequest
	candidates  map[string][]models.MatchCandidate
}

func newRecordingAssigner() *recordingAssigner {
	return &recordingAssigner{
		candidates: make(map[string][]models.MatchCandidate),
	}
}

func (r *recordingAssigner) Assign(ctx context.Context, request models.RideRequest, candidates []models.MatchCandidate) (*models.AssignmentResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.assignedReq = append(r.assignedReq, request)
	r.candidates[request.RideID] = candidates

	if len(candidates) > 0 {
		return &models.AssignmentResult{
			Assigned: true,
			DriverID: candidates[0].DriverID,
		}, nil
	}
	return &models.AssignmentResult{
		Assigned: false,
	}, nil
}

// TestProcessBatch_GracefulDegradationOnBatchFailure tests that when BatchMatcher fails
// (e.g. timeout or internal solver error), ProcessBatch catches the error, logs degradation,
// and calls NaiveNearestMatcher individually for every request in the batch, guaranteeing
// zero dropped requests.
func TestProcessBatch_GracefulDegradationOnBatchFailure(t *testing.T) {
	ctx := context.Background()
	index := geoindex.NewGeoIndex()

	driverPos := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	h, err := geospatial.Encode(driverPos.Lat, driverPos.Lng, geospatial.StandardPrecision)
	if err != nil {
		t.Fatalf("failed to encode hash: %v", err)
	}
	index.UpsertDriver("driver-1", h, "available", driverPos.Lat, driverPos.Lng)

	batch := []models.RideRequest{
		{RideID: "ride-alpha", RiderID: "user-alpha", Pickup: driverPos},
		{RideID: "ride-beta", RiderID: "user-beta", Pickup: driverPos},
	}

	failingMatcher := mockFailingBatchMatcher{
		err: errors.New("simulated solver timeout or error"),
	}
	naiveMatcher := NaiveNearestMatcher{}
	assigner := newRecordingAssigner()

	// Execute batch processing with failing batch matcher
	ProcessBatch(ctx, batch, index, failingMatcher, naiveMatcher, assigner)

	// Assert fallback reached assigner for all requests in batch
	assigner.mu.Lock()
	defer assigner.mu.Unlock()

	if len(assigner.assignedReq) != len(batch) {
		t.Fatalf("expected %d requests assigned via graceful degradation, got %d", len(batch), len(assigner.assignedReq))
	}

	for _, req := range batch {
		cands, exists := assigner.candidates[req.RideID]
		if !exists {
			t.Errorf("request %s was not submitted to assigner", req.RideID)
		}
		if len(cands) == 0 {
			t.Errorf("request %s had 0 candidates from naive fallback", req.RideID)
		} else if cands[0].DriverID != "driver-1" {
			t.Errorf("request %s expected candidate driver-1, got %s", req.RideID, cands[0].DriverID)
		}
	}
}

// TestProcessBatch_SuccessPath tests standard successful batch processing and assignment.
func TestProcessBatch_SuccessPath(t *testing.T) {
	ctx := context.Background()
	index := geoindex.NewGeoIndex()

	driverPos := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	h, _ := geospatial.Encode(driverPos.Lat, driverPos.Lng, geospatial.StandardPrecision)
	index.UpsertDriver("driver-10", h, "available", driverPos.Lat, driverPos.Lng)

	batch := []models.RideRequest{
		{RideID: "ride-100", RiderID: "user-100", Pickup: driverPos},
	}

	batchMatcher := BatchMatcher{}
	naiveMatcher := NaiveNearestMatcher{}
	assigner := newRecordingAssigner()

	ProcessBatch(ctx, batch, index, batchMatcher, naiveMatcher, assigner)

	assigner.mu.Lock()
	defer assigner.mu.Unlock()

	if len(assigner.assignedReq) != 1 {
		t.Fatalf("expected 1 assigned request, got %d", len(assigner.assignedReq))
	}
	if assigner.assignedReq[0].RideID != "ride-100" {
		t.Errorf("expected ride-100, got %s", assigner.assignedReq[0].RideID)
	}
}
