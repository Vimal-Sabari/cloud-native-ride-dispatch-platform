package assignment

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultHTTPTimeout defines the default request timeout for Trip Service confirmation calls.
const DefaultHTTPTimeout = 5 * time.Second

// HTTPTripServiceClient implements TripServiceClient over HTTP using internal shared-secret authentication.
type HTTPTripServiceClient struct {
	baseURL        string
	internalAPIKey string
	httpClient     *http.Client
}

// NewHTTPTripServiceClient initializes an HTTP client targeting Trip Service's internal endpoints.
func NewHTTPTripServiceClient(baseURL, internalAPIKey string) *HTTPTripServiceClient {
	return &HTTPTripServiceClient{
		baseURL:        strings.TrimRight(baseURL, "/"),
		internalAPIKey: internalAPIKey,
		httpClient: &http.Client{
			Timeout: DefaultHTTPTimeout,
		},
	}
}

type assignDriverPayload struct {
	DriverID string `json:"driverId"`
}

// AssignDriver sends an authenticated HTTP POST request to Trip Service to transition the ride
// state to MATCHED with the claimed driver.
func (c *HTTPTripServiceClient) AssignDriver(ctx context.Context, rideID, driverID string) error {
	reqURL := fmt.Sprintf("%s/internal/rides/%s/assign-driver", c.baseURL, url.PathEscape(rideID))

	payload := assignDriverPayload{
		DriverID: driverID,
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal assign driver payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("failed to create http request for %s: %w", reqURL, err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-api-key", c.internalAPIKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request to trip service failed: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("trip service returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	return nil
}
