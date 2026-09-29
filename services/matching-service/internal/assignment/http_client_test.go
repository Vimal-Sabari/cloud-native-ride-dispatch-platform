package assignment

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPTripServiceClient_AssignDriver_Success(t *testing.T) {
	expectedAPIKey := "test-secret-internal-key-999"
	expectedRideID := "ride-abc-123"
	expectedDriverID := "driver-xyz-789"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 1. Assert Method
		if r.Method != http.MethodPost {
			t.Errorf("expected POST method, got %s", r.Method)
		}

		// 2. Assert Path
		expectedPath := "/internal/rides/" + expectedRideID + "/assign-driver"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}

		// 3. Assert Header
		if key := r.Header.Get("x-internal-api-key"); key != expectedAPIKey {
			t.Errorf("expected header x-internal-api-key=%s, got %s", expectedAPIKey, key)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", ct)
		}

		// 4. Assert Body
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("failed to read request body: %v", err)
		}
		var payload assignDriverPayload
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Errorf("failed to unmarshal payload: %v", err)
		}
		if payload.DriverID != expectedDriverID {
			t.Errorf("expected driverId=%s, got %s", expectedDriverID, payload.DriverID)
		}

		// Respond 200 OK
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","rideId":"` + expectedRideID + `"}`))
	}))
	defer server.Close()

	client := NewHTTPTripServiceClient(server.URL, expectedAPIKey)
	err := client.AssignDriver(context.Background(), expectedRideID, expectedDriverID)
	if err != nil {
		t.Fatalf("expected nil error on 200 OK, got: %v", err)
	}
}

func TestHTTPTripServiceClient_AssignDriver_Non2xxError(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
		body       string
	}{
		{
			name:       "InternalServerError500",
			statusCode: http.StatusInternalServerError,
			body:       `{"error":"database connection failed"}`,
		},
		{
			name:       "Unauthorized401",
			statusCode: http.StatusUnauthorized,
			body:       `{"error":"invalid internal api key"}`,
		},
		{
			name:       "Conflict409",
			statusCode: http.StatusConflict,
			body:       `{"error":"ride already cancelled"}`,
		},
		{
			name:       "NotFound404",
			statusCode: http.StatusNotFound,
			body:       `{"error":"ride not found"}`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			client := NewHTTPTripServiceClient(server.URL+"/", "secret") // test trailing slash trimming
			err := client.AssignDriver(context.Background(), "ride-1", "driver-1")
			if err == nil {
				t.Fatalf("expected error for status %d, got nil", tc.statusCode)
			}

			errMsg := err.Error()
			if !strings.Contains(errMsg, tc.body) {
				t.Errorf("expected error message to include response body %q, got %q", tc.body, errMsg)
			}
		})
	}
}

func TestHTTPTripServiceClient_AssignDriver_NetworkFailure(t *testing.T) {
	// Target an unreachable / closed server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	serverURL := server.URL
	server.Close() // close immediately to trigger connection refused

	client := NewHTTPTripServiceClient(serverURL, "secret")
	err := client.AssignDriver(context.Background(), "ride-1", "driver-1")
	if err == nil {
		t.Fatalf("expected network failure error, got nil")
	}
}
