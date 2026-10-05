package logging

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestEmitEMFMetric_StructureAndSiblings(t *testing.T) {
	var buf bytes.Buffer

	namespace := "RideDispatch/LocationService"
	dimensions := map[string]string{
		"Route": "update-location",
		"Env":   "test",
	}
	metrics := map[string]MetricDefinition{
		"RequestCount": {Value: 1.0, Unit: "Count"},
		"LatencyMs":    {Value: 45.2, Unit: "Milliseconds"},
	}

	EmitEMFMetric(namespace, dimensions, metrics, &buf)

	output := buf.String()
	if !strings.HasSuffix(output, "\n") {
		t.Errorf("expected trailing newline in EMF line output")
	}

	var root map[string]interface{}
	if err := json.Unmarshal([]byte(output), &root); err != nil {
		t.Fatalf("failed to parse EMF JSON: %v (raw: %s)", err, output)
	}

	// 1. Verify _aws metadata directive
	awsRaw, exists := root["_aws"]
	if !exists {
		t.Fatalf("missing _aws directive in EMF root object")
	}

	awsMap, ok := awsRaw.(map[string]interface{})
	if !ok {
		t.Fatalf("_aws is not an object")
	}

	ts, ok := awsMap["Timestamp"].(float64)
	if !ok || ts <= 0 {
		t.Errorf("expected positive millisecond Timestamp, got %v", awsMap["Timestamp"])
	}

	cwMetricsRaw, ok := awsMap["CloudWatchMetrics"].([]interface{})
	if !ok || len(cwMetricsRaw) != 1 {
		t.Fatalf("expected exactly 1 CloudWatchMetrics block, got %v", awsMap["CloudWatchMetrics"])
	}

	cwBlock, ok := cwMetricsRaw[0].(map[string]interface{})
	if !ok {
		t.Fatalf("CloudWatchMetrics[0] is not an object")
	}

	if cwBlock["Namespace"] != namespace {
		t.Errorf("expected Namespace=%s, got %v", namespace, cwBlock["Namespace"])
	}

	// Check dimensions array in metadata
	dimArrayRaw, ok := cwBlock["Dimensions"].([]interface{})
	if !ok || len(dimArrayRaw) != 1 {
		t.Fatalf("expected Dimensions with 1 dimension-set array, got %v", cwBlock["Dimensions"])
	}
	dimSet, ok := dimArrayRaw[0].([]interface{})
	if !ok || len(dimSet) != 2 {
		t.Fatalf("expected dimension set of length 2, got %v", dimArrayRaw[0])
	}
	// Sorted dimension keys: "Env", "Route"
	if dimSet[0] != "Env" || dimSet[1] != "Route" {
		t.Errorf("expected sorted dimension keys ['Env', 'Route'], got %v", dimSet)
	}

	// Check metrics array in metadata
	metricListRaw, ok := cwBlock["Metrics"].([]interface{})
	if !ok || len(metricListRaw) != 2 {
		t.Fatalf("expected 2 metric definitions in metadata, got %v", cwBlock["Metrics"])
	}

	// 2. CRITICAL DUAL STRUCTURE CHECK:
	// Verify top-level flat sibling fields for both dimensions and metric values
	if root["Route"] != "update-location" {
		t.Errorf("expected top-level sibling Route='update-location', got %v", root["Route"])
	}
	if root["Env"] != "test" {
		t.Errorf("expected top-level sibling Env='test', got %v", root["Env"])
	}
	if root["RequestCount"] != 1.0 {
		t.Errorf("expected top-level sibling RequestCount=1.0, got %v", root["RequestCount"])
	}
	if root["LatencyMs"] != 45.2 {
		t.Errorf("expected top-level sibling LatencyMs=45.2, got %v", root["LatencyMs"])
	}
}
