package logging

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestLogger_BasicAndCorrelationID(t *testing.T) {
	var buf bytes.Buffer
	baseLogger := New("test-service", &buf)

	baseLogger.Info("hello world", map[string]interface{}{"foo": "bar"})

	var baseLog map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &baseLog); err != nil {
		t.Fatalf("failed to parse base log JSON: %v", err)
	}

	if baseLog["service"] != "test-service" {
		t.Errorf("expected service=test-service, got %v", baseLog["service"])
	}
	if baseLog["message"] != "hello world" {
		t.Errorf("expected message='hello world', got %v", baseLog["message"])
	}
	if baseLog["foo"] != "bar" {
		t.Errorf("expected foo=bar, got %v", baseLog["foo"])
	}
	if _, exists := baseLog["correlationId"]; exists {
		t.Errorf("unexpected correlationId in base log")
	}

	// Test child logger with correlation ID
	buf.Reset()
	childLogger := baseLogger.WithCorrelationID("req-999")
	childLogger.Info("child message", map[string]interface{}{"count": 42})

	var childLog map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &childLog); err != nil {
		t.Fatalf("failed to parse child log JSON: %v", err)
	}

	if childLog["service"] != "test-service" {
		t.Errorf("expected service=test-service, got %v", childLog["service"])
	}
	if childLog["correlationId"] != "req-999" {
		t.Errorf("expected correlationId=req-999, got %v", childLog["correlationId"])
	}
	if childLog["message"] != "child message" {
		t.Errorf("expected message='child message', got %v", childLog["message"])
	}
	if childLog["count"] != float64(42) {
		t.Errorf("expected count=42, got %v", childLog["count"])
	}
}

func TestLogger_LogLevelsAndError(t *testing.T) {
	var buf bytes.Buffer
	logger := New("test-service", &buf).WithCorrelationID("corr-123")

	// Warn
	buf.Reset()
	logger.Warn("warning message", map[string]interface{}{"warnKey": "warnVal"})
	var warnLog map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &warnLog); err != nil {
		t.Fatalf("failed to parse warn JSON: %v", err)
	}
	if warnLog["level"] != "warn" {
		t.Errorf("expected level=warn, got %v", warnLog["level"])
	}
	if warnLog["warnKey"] != "warnVal" {
		t.Errorf("expected warnKey=warnVal, got %v", warnLog["warnKey"])
	}

	// Error
	buf.Reset()
	testErr := errors.New("database connection refused")
	logger.Error("failed operation", testErr, map[string]interface{}{"retries": 3})
	var errLog map[string]interface{}
	if err := json.Unmarshal(buf.Bytes(), &errLog); err != nil {
		t.Fatalf("failed to parse error JSON: %v", err)
	}
	if errLog["level"] != "error" {
		t.Errorf("expected level=error, got %v", errLog["level"])
	}
	if errLog["error"] != "database connection refused" {
		t.Errorf("expected error field to match error string, got %v", errLog["error"])
	}
	if errLog["retries"] != float64(3) {
		t.Errorf("expected retries=3, got %v", errLog["retries"])
	}
	if !strings.HasSuffix(buf.String(), "\n") {
		t.Errorf("expected trailing newline in log output")
	}
}
