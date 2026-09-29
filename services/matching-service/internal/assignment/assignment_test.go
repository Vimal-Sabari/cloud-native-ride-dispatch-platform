package assignment

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
)

// fakeDynamoWriter implements DynamoWriter with mockable responses and call recording.
type fakeDynamoWriter struct {
	mu sync.Mutex

	// Pre-programmed items for GetItem (keyed by pk#sk)
	items map[string]map[string]types.AttributeValue
	// Optional error to return from GetItem
	getItemErr error

	// Pre-programmed sequence of (bool, error) for ConditionalPutItem
	conditionalResults []conditionalResult
	conditionalCalls   []conditionalCallRecord
}

type conditionalResult struct {
	success bool
	err     error
}

type conditionalCallRecord struct {
	item      map[string]types.AttributeValue
	condition string
}

func newFakeDynamoWriter() *fakeDynamoWriter {
	return &fakeDynamoWriter{
		items: make(map[string]map[string]types.AttributeValue),
	}
}

func (f *fakeDynamoWriter) PutItem(ctx context.Context, item map[string]types.AttributeValue) error {
	return nil
}

func (f *fakeDynamoWriter) GetItem(ctx context.Context, pk, sk string) (map[string]types.AttributeValue, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.getItemErr != nil {
		return nil, f.getItemErr
	}

	key := pk + "#" + sk
	if item, ok := f.items[key]; ok {
		return item, nil
	}
	return nil, nil
}

func (f *fakeDynamoWriter) ConditionalPutItem(ctx context.Context, item map[string]types.AttributeValue, conditionExpression string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.conditionalCalls = append(f.conditionalCalls, conditionalCallRecord{
		item:      item,
		condition: conditionExpression,
	})

	if len(f.conditionalResults) > 0 {
		res := f.conditionalResults[0]
		f.conditionalResults = f.conditionalResults[1:]
		return res.success, res.err
	}

	return true, nil
}

// fakeTripServiceClient implements TripServiceClient with controllable return errors.
type fakeTripServiceClient struct {
	mu            sync.Mutex
	assignedRides map[string]string // rideID -> driverID
	assignErr     error
	calls         []string
}

func newFakeTripServiceClient() *fakeTripServiceClient {
	return &fakeTripServiceClient{
		assignedRides: make(map[string]string),
	}
}

func (f *fakeTripServiceClient) AssignDriver(ctx context.Context, rideID, driverID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.calls = append(f.calls, fmt.Sprintf("%s:%s", rideID, driverID))

	if f.assignErr != nil {
		return f.assignErr
	}

	f.assignedRides[rideID] = driverID
	return nil
}

func sampleDriverItem(driverID, status string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK":       &types.AttributeValueMemberS{Value: "DRIVER#" + driverID},
		"SK":       &types.AttributeValueMemberS{Value: "LOCATION"},
		"Status":   &types.AttributeValueMemberS{Value: status},
		"status":   &types.AttributeValueMemberS{Value: status},
		"GSI1PK":   &types.AttributeValueMemberS{Value: "GEOHASH#9q8yy"},
		"GSI1SK":   &types.AttributeValueMemberS{Value: "DRIVER#" + status + "#" + driverID},
		"driverId": &types.AttributeValueMemberS{Value: driverID},
		"lat":      &types.AttributeValueMemberN{Value: "37.7749"},
		"lng":      &types.AttributeValueMemberN{Value: "-122.4194"},
	}
}

// Test 1: First candidate's claim succeeds, TripService call succeeds
// Assert Assigned: true with first candidate's driver ID.
func TestAssigner_SuccessFirstCandidate(t *testing.T) {
	fakeDdb := newFakeDynamoWriter()
	fakeDdb.items["DRIVER#driver-1#LOCATION"] = sampleDriverItem("driver-1", "available")
	fakeDdb.conditionalResults = []conditionalResult{{success: true, err: nil}}

	fakeTrip := newFakeTripServiceClient()

	assigner := NewAssigner(fakeDdb, fakeTrip)

	req := models.RideRequest{RideID: "ride-1", RiderID: "rider-1"}
	candidates := []models.MatchCandidate{
		{DriverID: "driver-1", DistanceMeters: 100},
		{DriverID: "driver-2", DistanceMeters: 200},
	}

	res, err := assigner.Assign(context.Background(), req, candidates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !res.Assigned {
		t.Fatalf("expected Assigned to be true")
	}
	if res.DriverID != "driver-1" {
		t.Fatalf("expected driver-1, got %s", res.DriverID)
	}

	if len(fakeTrip.calls) != 1 || fakeTrip.calls[0] != "ride-1:driver-1" {
		t.Fatalf("unexpected TripService calls: %+v", fakeTrip.calls)
	}

	// Verify DynamoDB claim call
	if len(fakeDdb.conditionalCalls) != 1 {
		t.Fatalf("expected 1 conditional call, got %d", len(fakeDdb.conditionalCalls))
	}
	claimCall := fakeDdb.conditionalCalls[0]
	if claimCall.condition != "#status = :available" {
		t.Errorf("expected claim condition '#status = :available', got '%s'", claimCall.condition)
	}
	if s, ok := claimCall.item["Status"].(*types.AttributeValueMemberS); !ok || s.Value != "busy" {
		t.Errorf("expected item Status to be set to busy")
	}
	if gsi1sk, ok := claimCall.item["GSI1SK"].(*types.AttributeValueMemberS); !ok || gsi1sk.Value != "DRIVER#busy#driver-1" {
		t.Errorf("expected GSI1SK updated to DRIVER#busy#driver-1, got %+v", claimCall.item["GSI1SK"])
	}
}

// Test 2: First candidate's claim FAILS (simulating race), second candidate's claim succeeds
// Assert Assigned: true with second candidate's driver ID.
func TestAssigner_FirstCandidateRaceLost_SecondSucceeds(t *testing.T) {
	fakeDdb := newFakeDynamoWriter()
	fakeDdb.items["DRIVER#driver-1#LOCATION"] = sampleDriverItem("driver-1", "available")
	fakeDdb.items["DRIVER#driver-2#LOCATION"] = sampleDriverItem("driver-2", "available")

	// First claim returns false (lost race), second returns true
	fakeDdb.conditionalResults = []conditionalResult{
		{success: false, err: nil},
		{success: true, err: nil},
	}

	fakeTrip := newFakeTripServiceClient()
	assigner := NewAssigner(fakeDdb, fakeTrip)

	req := models.RideRequest{RideID: "ride-1", RiderID: "rider-1"}
	candidates := []models.MatchCandidate{
		{DriverID: "driver-1", DistanceMeters: 50},
		{DriverID: "driver-2", DistanceMeters: 150},
	}

	res, err := assigner.Assign(context.Background(), req, candidates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !res.Assigned {
		t.Fatalf("expected Assigned to be true")
	}
	if res.DriverID != "driver-2" {
		t.Fatalf("expected driver-2 to be assigned, got %s", res.DriverID)
	}

	// TripService should only have been called for driver-2
	if len(fakeTrip.calls) != 1 || fakeTrip.calls[0] != "ride-1:driver-2" {
		t.Fatalf("expected TripService call only for driver-2, got %+v", fakeTrip.calls)
	}

	// Two claim attempts in DynamoDB
	if len(fakeDdb.conditionalCalls) != 2 {
		t.Fatalf("expected 2 conditional calls, got %d", len(fakeDdb.conditionalCalls))
	}
}

// Test 3: All candidates' claims fail
// Assert Assigned: false, no error.
func TestAssigner_AllCandidatesFail(t *testing.T) {
	fakeDdb := newFakeDynamoWriter()
	fakeDdb.items["DRIVER#driver-1#LOCATION"] = sampleDriverItem("driver-1", "available")
	fakeDdb.items["DRIVER#driver-2#LOCATION"] = sampleDriverItem("driver-2", "available")

	fakeDdb.conditionalResults = []conditionalResult{
		{success: false, err: nil},
		{success: false, err: nil},
	}

	fakeTrip := newFakeTripServiceClient()
	assigner := NewAssigner(fakeDdb, fakeTrip)

	req := models.RideRequest{RideID: "ride-1", RiderID: "rider-1"}
	candidates := []models.MatchCandidate{
		{DriverID: "driver-1", DistanceMeters: 50},
		{DriverID: "driver-2", DistanceMeters: 150},
	}

	res, err := assigner.Assign(context.Background(), req, candidates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if res.Assigned {
		t.Fatalf("expected Assigned to be false")
	}
	if res.DriverID != "" {
		t.Fatalf("expected empty DriverID, got %s", res.DriverID)
	}
	if len(fakeTrip.calls) != 0 {
		t.Fatalf("expected 0 TripService calls, got %d", len(fakeTrip.calls))
	}
}

// Test 4: First candidate's claim succeeds, but TripService call FAILS
// Assert:
// 1. Fake DynamoWriter recorded a SECOND ConditionalPutItem call (the revert attempt)
// 2. The revert condition asserts "#status = :busy"
// 3. Revert item sets Status back to "available"
// 4. Non-nil error wrapping original TripService error is returned.
func TestAssigner_TripServiceFails_RevertsClaim(t *testing.T) {
	fakeDdb := newFakeDynamoWriter()
	fakeDdb.items["DRIVER#driver-1#LOCATION"] = sampleDriverItem("driver-1", "available")

	// Call 1: Claim succeeds (true)
	// Call 2: Compensation revert succeeds (true)
	fakeDdb.conditionalResults = []conditionalResult{
		{success: true, err: nil},
		{success: true, err: nil},
	}

	tripErrExpected := errors.New("network timeout talking to trip service")
	fakeTrip := newFakeTripServiceClient()
	fakeTrip.assignErr = tripErrExpected

	assigner := NewAssigner(fakeDdb, fakeTrip)

	req := models.RideRequest{RideID: "ride-42", RiderID: "rider-99"}
	candidates := []models.MatchCandidate{
		{DriverID: "driver-1", DistanceMeters: 80},
		{DriverID: "driver-2", DistanceMeters: 120},
	}

	res, err := assigner.Assign(context.Background(), req, candidates)
	if err == nil {
		t.Fatalf("expected error from Assign when TripService fails")
	}
	if res != nil {
		t.Fatalf("expected nil result on error, got %+v", res)
	}

	// Verify error wraps the original TripService error
	if !errors.Is(err, tripErrExpected) {
		t.Fatalf("expected returned error to wrap tripErrExpected, got: %v", err)
	}

	// Verify exactly 2 conditional puts: 1 claim, 1 revert
	if len(fakeDdb.conditionalCalls) != 2 {
		t.Fatalf("expected exactly 2 conditional puts (claim and revert), got %d", len(fakeDdb.conditionalCalls))
	}

	claimCall := fakeDdb.conditionalCalls[0]
	if claimCall.condition != "#status = :available" {
		t.Errorf("claim condition expected '#status = :available', got '%s'", claimCall.condition)
	}

	revertCall := fakeDdb.conditionalCalls[1]
	if revertCall.condition != "#status = :busy" {
		t.Errorf("revert condition expected '#status = :busy', got '%s'", revertCall.condition)
	}

	// Verify reverted item has Status set to available
	if s, ok := revertCall.item["Status"].(*types.AttributeValueMemberS); !ok || s.Value != "available" {
		t.Errorf("revert item Status expected 'available', got %+v", revertCall.item["Status"])
	}
	if gsi1sk, ok := revertCall.item["GSI1SK"].(*types.AttributeValueMemberS); !ok || !strings.Contains(gsi1sk.Value, "available") {
		t.Errorf("revert item GSI1SK expected available, got %+v", revertCall.item["GSI1SK"])
	}
}

// Test 5: First candidate claim succeeds, TripService FAILS, AND the revert also fails
// Assert non-nil error still returned without panic.
func TestAssigner_TripServiceFails_RevertAlsoFails(t *testing.T) {
	fakeDdb := newFakeDynamoWriter()
	fakeDdb.items["DRIVER#driver-1#LOCATION"] = sampleDriverItem("driver-1", "available")

	// Call 1: Claim succeeds (true)
	// Call 2: Compensation revert FAILS (false, err)
	fakeDdb.conditionalResults = []conditionalResult{
		{success: true, err: nil},
		{success: false, err: errors.New("dynamodb unavailable during revert")},
	}

	tripErrExpected := errors.New("internal server error 500")
	fakeTrip := newFakeTripServiceClient()
	fakeTrip.assignErr = tripErrExpected

	assigner := NewAssigner(fakeDdb, fakeTrip)

	req := models.RideRequest{RideID: "ride-42", RiderID: "rider-99"}
	candidates := []models.MatchCandidate{
		{DriverID: "driver-1", DistanceMeters: 80},
	}

	res, err := assigner.Assign(context.Background(), req, candidates)
	if err == nil {
		t.Fatalf("expected error from Assign")
	}
	if res != nil {
		t.Fatalf("expected nil result on error")
	}
	if !errors.Is(err, tripErrExpected) {
		t.Fatalf("expected wrapped trip service error, got: %v", err)
	}
}

func TestAssigner_DriverNotFoundOrGetItemError(t *testing.T) {
	fakeDdb := newFakeDynamoWriter()
	// Driver 1: GetItem returns error
	fakeDdb.getItemErr = errors.New("ddb read failure")

	fakeTrip := newFakeTripServiceClient()
	assigner := NewAssigner(fakeDdb, fakeTrip)

	req := models.RideRequest{RideID: "ride-1", RiderID: "rider-1"}
	candidates := []models.MatchCandidate{{DriverID: "driver-1", DistanceMeters: 10}}

	res, err := assigner.Assign(context.Background(), req, candidates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Assigned {
		t.Fatalf("expected Assigned to be false")
	}
}

func TestAssigner_ContextCancelled(t *testing.T) {
	fakeDdb := newFakeDynamoWriter()
	fakeTrip := newFakeTripServiceClient()
	assigner := NewAssigner(fakeDdb, fakeTrip)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	req := models.RideRequest{RideID: "ride-1", RiderID: "rider-1"}
	candidates := []models.MatchCandidate{{DriverID: "driver-1", DistanceMeters: 10}}

	_, err := assigner.Assign(ctx, req, candidates)
	if err == nil {
		t.Fatalf("expected context cancellation error")
	}
}
