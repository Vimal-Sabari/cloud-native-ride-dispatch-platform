package matcher

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/metrics"
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
	mu            sync.Mutex
	assignedReq   []models.RideRequest
	candidates    map[string][]models.MatchCandidate
	failAllClaims bool
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

	if r.failAllClaims || len(candidates) == 0 {
		return &models.AssignmentResult{
			Assigned:             false,
			DriverID:             "",
			ChosenDistanceMeters: 0,
		}, nil
	}

	return &models.AssignmentResult{
		Assigned:             true,
		DriverID:             candidates[0].DriverID,
		ChosenDistanceMeters: candidates[0].DistanceMeters,
	}, nil
}

// parseLoggedLines parses newline-delimited JSON logs into a slice of MatchDecisionLog.
func parseLoggedLines(t *testing.T, buf *bytes.Buffer) []metrics.MatchDecisionLog {
	t.Helper()
	var entries []metrics.MatchDecisionLog
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var entry metrics.MatchDecisionLog
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("failed to parse log line %q: %v", line, err)
		}
		entries = append(entries, entry)
	}
	return entries
}

// TestExecuteNaiveMatch_Logging tests structured decision logging on the naive matching path.
func TestExecuteNaiveMatch_Logging(t *testing.T) {
	ctx := context.Background()
	index := geoindex.NewGeoIndex()

	driverPos := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	h, _ := geospatial.Encode(driverPos.Lat, driverPos.Lng, geospatial.StandardPrecision)
	index.UpsertDriver("driver-1", h, "available", driverPos.Lat, driverPos.Lng)
	index.UpsertDriver("driver-2", h, "available", 37.7760, -122.4194)

	naiveMatcher := NaiveNearestMatcher{}

	t.Run("successful assignment logs Assigned=true with non-zero distance", func(t *testing.T) {
		var logBuf bytes.Buffer
		assigner := newRecordingAssigner()
		req := models.RideRequest{RideID: "ride-success", RiderID: "u1", Pickup: driverPos}

		result, err := ExecuteNaiveMatch(ctx, req, index, naiveMatcher, assigner, &logBuf)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !result.Assigned {
			t.Fatalf("expected assignment to succeed")
		}

		logs := parseLoggedLines(t, &logBuf)
		if len(logs) != 1 {
			t.Fatalf("expected exactly 1 log entry, got %d", len(logs))
		}
		entry := logs[0]
		if entry.Strategy != "naive" {
			t.Errorf("expected Strategy=naive, got %s", entry.Strategy)
		}
		if entry.RideID != "ride-success" {
			t.Errorf("expected RideID=ride-success, got %s", entry.RideID)
		}
		if !entry.Assigned {
			t.Errorf("expected Assigned=true, got false")
		}
		if entry.CandidatesConsidered != 2 {
			t.Errorf("expected CandidatesConsidered=2, got %d", entry.CandidatesConsidered)
		}
		if entry.BatchSize != 0 {
			t.Errorf("expected BatchSize=0 for naive, got %d", entry.BatchSize)
		}
		if entry.LogType != "match_decision" {
			t.Errorf("expected LogType=match_decision, got %s", entry.LogType)
		}
	})

	t.Run("failed assignment when no drivers available logs Assigned=false, CandidatesConsidered=0", func(t *testing.T) {
		var logBuf bytes.Buffer
		emptyIndex := geoindex.NewGeoIndex()
		assigner := newRecordingAssigner()
		req := models.RideRequest{RideID: "ride-no-drivers", RiderID: "u2", Pickup: driverPos}

		result, err := ExecuteNaiveMatch(ctx, req, emptyIndex, naiveMatcher, assigner, &logBuf)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.Assigned {
			t.Fatalf("expected assignment to fail")
		}

		logs := parseLoggedLines(t, &logBuf)
		if len(logs) != 1 {
			t.Fatalf("expected 1 log entry, got %d", len(logs))
		}
		entry := logs[0]
		if entry.Assigned {
			t.Errorf("expected Assigned=false, got true")
		}
		if entry.CandidatesConsidered != 0 {
			t.Errorf("expected CandidatesConsidered=0, got %d", entry.CandidatesConsidered)
		}
		if entry.ChosenDistanceMeters != 0 {
			t.Errorf("expected ChosenDistanceMeters=0, got %f", entry.ChosenDistanceMeters)
		}
	})

	t.Run("failed assignment when all claims fail logs Assigned=false with candidates tried", func(t *testing.T) {
		var logBuf bytes.Buffer
		assigner := newRecordingAssigner()
		assigner.failAllClaims = true
		req := models.RideRequest{RideID: "ride-claims-fail", RiderID: "u3", Pickup: driverPos}

		result, err := ExecuteNaiveMatch(ctx, req, index, naiveMatcher, assigner, &logBuf)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.Assigned {
			t.Fatalf("expected assignment to fail")
		}

		logs := parseLoggedLines(t, &logBuf)
		if len(logs) != 1 {
			t.Fatalf("expected 1 log entry, got %d", len(logs))
		}
		entry := logs[0]
		if entry.Assigned {
			t.Errorf("expected Assigned=false, got true")
		}
		if entry.CandidatesConsidered != 2 {
			t.Errorf("expected CandidatesConsidered=2, got %d", entry.CandidatesConsidered)
		}
		if entry.ChosenDistanceMeters != 0 {
			t.Errorf("expected ChosenDistanceMeters=0, got %f", entry.ChosenDistanceMeters)
		}
	})
}

// TestProcessBatch_GracefulDegradationOnBatchFailure tests that when BatchMatcher fails
// (e.g. timeout or internal solver error), ProcessBatch catches the error, logs degradation,
// and calls NaiveNearestMatcher individually for every request in the batch, guaranteeing
// zero dropped requests and emitting logs.
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
	var logBuf bytes.Buffer

	// Execute batch processing with failing batch matcher
	ProcessBatch(ctx, batch, index, failingMatcher, naiveMatcher, assigner, &logBuf)

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

	// Verify degraded logs emitted per request
	logs := parseLoggedLines(t, &logBuf)
	if len(logs) != len(batch) {
		t.Fatalf("expected %d log lines, got %d", len(batch), len(logs))
	}
	for _, l := range logs {
		if l.Strategy != "naive" {
			t.Errorf("expected degraded logs to have Strategy=naive, got %s", l.Strategy)
		}
	}
}

// TestProcessBatch_SuccessPath tests standard successful batch processing, assignment, and structured logging.
func TestProcessBatch_SuccessPath(t *testing.T) {
	ctx := context.Background()
	index := geoindex.NewGeoIndex()

	driverPos := geospatial.Point{Lat: 37.7749, Lng: -122.4194}
	h, _ := geospatial.Encode(driverPos.Lat, driverPos.Lng, geospatial.StandardPrecision)
	index.UpsertDriver("driver-10", h, "available", driverPos.Lat, driverPos.Lng)
	index.UpsertDriver("driver-20", h, "available", 37.7760, -122.4194)

	batch := []models.RideRequest{
		{RideID: "ride-100", RiderID: "user-100", Pickup: driverPos},
		{RideID: "ride-200", RiderID: "user-200", Pickup: geospatial.Point{Lat: 37.7760, Lng: -122.4194}},
	}

	batchMatcher := BatchMatcher{}
	naiveMatcher := NaiveNearestMatcher{}
	assigner := newRecordingAssigner()
	var logBuf bytes.Buffer

	ProcessBatch(ctx, batch, index, batchMatcher, naiveMatcher, assigner, &logBuf)

	assigner.mu.Lock()
	defer assigner.mu.Unlock()

	if len(assigner.assignedReq) != len(batch) {
		t.Fatalf("expected %d assigned requests, got %d", len(batch), len(assigner.assignedReq))
	}

	logs := parseLoggedLines(t, &logBuf)
	if len(logs) != len(batch) {
		t.Fatalf("expected %d batch log entries, got %d", len(batch), len(logs))
	}

	for _, entry := range logs {
		if entry.Strategy != "batch" {
			t.Errorf("expected Strategy=batch, got %s", entry.Strategy)
		}
		if entry.BatchSize != len(batch) {
			t.Errorf("expected BatchSize=%d, got %d", len(batch), entry.BatchSize)
		}
		if !entry.Assigned {
			t.Errorf("expected Assigned=true, got false")
		}
		if entry.LogType != "match_decision" {
			t.Errorf("expected LogType=match_decision, got %s", entry.LogType)
		}
		if entry.CandidatesConsidered == 0 {
			t.Errorf("expected CandidatesConsidered > 0, got 0")
		}
	}
}
