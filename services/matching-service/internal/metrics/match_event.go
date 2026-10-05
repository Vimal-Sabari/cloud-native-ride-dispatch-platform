package metrics

import (
	"encoding/json"
	"fmt"
	"io"
	"time"
)

// MatchDecisionLog captures structured audit and comparison telemetry for driver matching decisions.
// It is emitted to stdout for A/B comparison analysis between naive and batch matching strategies.
type MatchDecisionLog struct {
	Strategy             string  `json:"strategy"`
	RideID               string  `json:"rideId"`
	CandidatesConsidered int     `json:"candidatesConsidered"`
	Assigned             bool    `json:"assigned"`
	ChosenDistanceMeters float64 `json:"chosenDistanceMeters"`
	DecisionDurationMs   int64   `json:"decisionDurationMs"`
	BatchSize            int     `json:"batchSize"`
	Timestamp            string  `json:"timestamp"`
	LogType              string  `json:"logType"`
}

// LogMatchDecision formats and writes a single MatchDecisionLog entry as newline-delimited JSON to w.
// If entry.LogType is empty, it defaults to "match_decision".
// If entry.Timestamp is empty, it defaults to current UTC time in RFC3339 format.
// Any JSON marshaling error is handled by writing a plain-text fallback error line rather than panicking.
func LogMatchDecision(w io.Writer, entry MatchDecisionLog) {
	if entry.LogType == "" {
		entry.LogType = "match_decision"
	}
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	data, err := json.Marshal(entry)
	if err != nil {
		_, _ = fmt.Fprintf(w, "ERROR: failed to marshal match decision log for ride %s: %v\n", entry.RideID, err)
		return
	}

	data = append(data, '\n')
	_, _ = w.Write(data)
}
