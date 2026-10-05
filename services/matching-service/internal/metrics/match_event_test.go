package metrics

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestLogMatchDecision_ValidEntry(t *testing.T) {
	var buf bytes.Buffer
	entry := MatchDecisionLog{
		Strategy:             "naive",
		RideID:               "ride-123",
		CandidatesConsidered: 3,
		Assigned:             true,
		ChosenDistanceMeters: 450.5,
		DecisionDurationMs:   12,
		BatchSize:            0,
	}

	LogMatchDecision(&buf, entry)

	output := buf.String()
	if !strings.HasSuffix(output, "\n") {
		t.Errorf("expected newline at the end of output, got: %q", output)
	}

	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(output), &parsed); err != nil {
		t.Fatalf("failed to parse emitted JSON: %v", err)
	}

	// Verify all fields are present and properly formatted
	if parsed["logType"] != "match_decision" {
		t.Errorf("expected logType = 'match_decision', got %v", parsed["logType"])
	}
	if parsed["strategy"] != "naive" {
		t.Errorf("expected strategy = 'naive', got %v", parsed["strategy"])
	}
	if parsed["rideId"] != "ride-123" {
		t.Errorf("expected rideId = 'ride-123', got %v", parsed["rideId"])
	}
	if parsed["candidatesConsidered"] != float64(3) {
		t.Errorf("expected candidatesConsidered = 3, got %v", parsed["candidatesConsidered"])
	}
	if parsed["assigned"] != true {
		t.Errorf("expected assigned = true, got %v", parsed["assigned"])
	}
	if parsed["chosenDistanceMeters"] != 450.5 {
		t.Errorf("expected chosenDistanceMeters = 450.5, got %v", parsed["chosenDistanceMeters"])
	}
	if parsed["decisionDurationMs"] != float64(12) {
		t.Errorf("expected decisionDurationMs = 12, got %v", parsed["decisionDurationMs"])
	}
	if parsed["batchSize"] != float64(0) {
		t.Errorf("expected batchSize = 0, got %v", parsed["batchSize"])
	}

	// Verify automatic UTC RFC3339 timestamp generation
	tsStr, ok := parsed["timestamp"].(string)
	if !ok || tsStr == "" {
		t.Fatalf("expected non-empty timestamp string, got %v", parsed["timestamp"])
	}
	if _, err := time.Parse(time.RFC3339, tsStr); err != nil {
		t.Errorf("timestamp %q is not valid RFC3339: %v", tsStr, err)
	}
}

func TestLogMatchDecision_CustomTimestampAndLogTypePreserved(t *testing.T) {
	var buf bytes.Buffer
	customTime := "2026-10-05T12:00:00Z"
	customType := "custom_match_decision"

	entry := MatchDecisionLog{
		Strategy:             "batch",
		RideID:               "ride-batch-1",
		CandidatesConsidered: 5,
		Assigned:             true,
		ChosenDistanceMeters: 780.2,
		DecisionDurationMs:   25,
		BatchSize:            10,
		Timestamp:            customTime,
		LogType:              customType,
	}

	LogMatchDecision(&buf, entry)

	var parsed MatchDecisionLog
	if err := json.Unmarshal(buf.Bytes(), &parsed); err != nil {
		t.Fatalf("failed to parse emitted JSON: %v", err)
	}

	if parsed.Timestamp != customTime {
		t.Errorf("expected preserved timestamp %q, got %q", customTime, parsed.Timestamp)
	}
	if parsed.LogType != customType {
		t.Errorf("expected preserved logType %q, got %q", customType, parsed.LogType)
	}
}

// Note on JSON Marshal Failure:
// MatchDecisionLog consists exclusively of standard Go primitive types (string, int, int64, float64, bool)
// with finite values. In Go's standard library `encoding/json`, a struct with only finite primitive fields
// cannot fail to marshal (unlike channels, complex numbers, cyclic pointers, or NaN/Inf floats).
// Error handling in LogMatchDecision is implemented defensively to guarantee zero service panics
// under any future struct extensions.
