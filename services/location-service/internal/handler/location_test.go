package handler_test

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/location-service/internal/handler"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
	models "github.com/Vimal-Sabari/ride-dispatch-platform/shared/models/go"
)

func TestHandleUpdateLocation(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name              string
		driverID          string
		req               models.LocationUpdateRequest
		setupFake         func(f *fakeDynamo)
		expectedStatus    int
		expectedErrorMsg  string
		expectPutCalled   bool
		assertWrittenItem func(t *testing.T, item map[string]types.AttributeValue)
	}{
		{
			name:     "valid coordinates with brand-new driver (defaults to offline)",
			driverID: "driver-101",
			req: models.LocationUpdateRequest{
				Lat: 37.7749,
				Lng: -122.4194,
			},
			setupFake: func(f *fakeDynamo) {
				// No prior record
			},
			expectedStatus:  200,
			expectPutCalled: true,
			assertWrittenItem: func(t *testing.T, item map[string]types.AttributeValue) {
				expectedHash, err := geospatial.Encode(37.7749, -122.4194, 5)
				if err != nil {
					t.Fatalf("unexpected encode err: %v", err)
				}

				if v, ok := item["PK"].(*types.AttributeValueMemberS); !ok || v.Value != "DRIVER#driver-101" {
					t.Errorf("expected PK 'DRIVER#driver-101', got %v", item["PK"])
				}
				if v, ok := item["SK"].(*types.AttributeValueMemberS); !ok || v.Value != "LOCATION" {
					t.Errorf("expected SK 'LOCATION', got %v", item["SK"])
				}
				if v, ok := item["GSI1PK"].(*types.AttributeValueMemberS); !ok || v.Value != "GEOHASH#"+expectedHash {
					t.Errorf("expected GSI1PK 'GEOHASH#%s', got %v", expectedHash, item["GSI1PK"])
				}
				if v, ok := item["GSI1SK"].(*types.AttributeValueMemberS); !ok || v.Value != "DRIVER#offline#driver-101" {
					t.Errorf("expected GSI1SK 'DRIVER#offline#driver-101', got %v", item["GSI1SK"])
				}
				if v, ok := item["Status"].(*types.AttributeValueMemberS); !ok || v.Value != models.StatusOffline {
					t.Errorf("expected Status 'offline', got %v", item["Status"])
				}

				// Check ExpiresAt is a valid Unix epoch timestamp ~5 minutes in the future
				expVal, ok := item["ExpiresAt"].(*types.AttributeValueMemberN)
				if !ok {
					t.Fatalf("expected ExpiresAt attribute as N, got %v", item["ExpiresAt"])
				}
				expSec, err := strconv.ParseInt(expVal.Value, 10, 64)
				if err != nil {
					t.Fatalf("failed to parse ExpiresAt: %v", err)
				}
				nowSec := time.Now().UTC().Unix()
				if expSec < nowSec+280 || expSec > nowSec+320 {
					t.Errorf("ExpiresAt %d not within expected 5-minute window from %d", expSec, nowSec)
				}
			},
		},
		{
			name:     "valid coordinates preserving existing busy status",
			driverID: "driver-202",
			req: models.LocationUpdateRequest{
				Lat: 40.7128,
				Lng: -74.0060,
			},
			setupFake: func(f *fakeDynamo) {
				f.setItem("DRIVER#driver-202", "LOCATION", map[string]types.AttributeValue{
					"PK":     &types.AttributeValueMemberS{Value: "DRIVER#driver-202"},
					"SK":     &types.AttributeValueMemberS{Value: "LOCATION"},
					"Status": &types.AttributeValueMemberS{Value: models.StatusBusy},
					"status": &types.AttributeValueMemberS{Value: models.StatusBusy},
				})
			},
			expectedStatus:  200,
			expectPutCalled: true,
			assertWrittenItem: func(t *testing.T, item map[string]types.AttributeValue) {
				if v, ok := item["GSI1SK"].(*types.AttributeValueMemberS); !ok || v.Value != "DRIVER#busy#driver-202" {
					t.Errorf("expected GSI1SK to preserve 'busy': 'DRIVER#busy#driver-202', got %v", item["GSI1SK"])
				}
				if v, ok := item["Status"].(*types.AttributeValueMemberS); !ok || v.Value != models.StatusBusy {
					t.Errorf("expected Status 'busy', got %v", item["Status"])
				}
			},
		},
		{
			name:     "valid coordinates preserving existing status from lowercase attribute",
			driverID: "driver-203",
			req: models.LocationUpdateRequest{
				Lat: 40.7128,
				Lng: -74.0060,
			},
			setupFake: func(f *fakeDynamo) {
				f.setItem("DRIVER#driver-203", "LOCATION", map[string]types.AttributeValue{
					"PK":     &types.AttributeValueMemberS{Value: "DRIVER#driver-203"},
					"SK":     &types.AttributeValueMemberS{Value: "LOCATION"},
					"status": &types.AttributeValueMemberS{Value: models.StatusAvailable},
				})
			},
			expectedStatus:  200,
			expectPutCalled: true,
			assertWrittenItem: func(t *testing.T, item map[string]types.AttributeValue) {
				if v, ok := item["GSI1SK"].(*types.AttributeValueMemberS); !ok || v.Value != "DRIVER#available#driver-203" {
					t.Errorf("expected GSI1SK 'DRIVER#available#driver-203', got %v", item["GSI1SK"])
				}
			},
		},
		{
			name:     "invalid latitude > 90 (91)",
			driverID: "driver-bad-lat-pos",
			req: models.LocationUpdateRequest{
				Lat: 91.0,
				Lng: 0.0,
			},
			setupFake:        func(f *fakeDynamo) {},
			expectedStatus:   400,
			expectPutCalled:  false,
			expectedErrorMsg: "geospatial: latitude 91.000000 out of range [-90, 90]",
		},
		{
			name:     "invalid latitude < -90 (-91)",
			driverID: "driver-bad-lat-neg",
			req: models.LocationUpdateRequest{
				Lat: -91.0,
				Lng: 0.0,
			},
			setupFake:        func(f *fakeDynamo) {},
			expectedStatus:   400,
			expectPutCalled:  false,
			expectedErrorMsg: "geospatial: latitude -91.000000 out of range [-90, 90]",
		},
		{
			name:     "invalid longitude > 180 (181)",
			driverID: "driver-bad-lng-pos",
			req: models.LocationUpdateRequest{
				Lat: 0.0,
				Lng: 181.0,
			},
			setupFake:        func(f *fakeDynamo) {},
			expectedStatus:   400,
			expectPutCalled:  false,
			expectedErrorMsg: "geospatial: longitude 181.000000 out of range [-180, 180]",
		},
		{
			name:     "invalid longitude < -180 (-181)",
			driverID: "driver-bad-lng-neg",
			req: models.LocationUpdateRequest{
				Lat: 0.0,
				Lng: -181.0,
			},
			setupFake:        func(f *fakeDynamo) {},
			expectedStatus:   400,
			expectPutCalled:  false,
			expectedErrorMsg: "geospatial: longitude -181.000000 out of range [-180, 180]",
		},
		{
			name:     "empty driver id",
			driverID: "",
			req: models.LocationUpdateRequest{
				Lat: 10.0,
				Lng: 20.0,
			},
			setupFake:        func(f *fakeDynamo) {},
			expectedStatus:   400,
			expectPutCalled:  false,
			expectedErrorMsg: "driver id is required",
		},
		{
			name:     "dynamodb GetItem internal error",
			driverID: "driver-err",
			req: models.LocationUpdateRequest{
				Lat: 10.0,
				Lng: 20.0,
			},
			setupFake: func(f *fakeDynamo) {
				f.getItemErr = errors.New("dynamo connection timed out")
			},
			expectedStatus:   500,
			expectPutCalled:  false,
			expectedErrorMsg: "internal error",
		},
		{
			name:     "dynamodb PutItem internal error",
			driverID: "driver-err",
			req: models.LocationUpdateRequest{
				Lat: 10.0,
				Lng: 20.0,
			},
			setupFake: func(f *fakeDynamo) {
				f.putItemErr = errors.New("dynamo write throttled")
			},
			expectedStatus:   500,
			expectPutCalled:  false,
			expectedErrorMsg: "internal error",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fake := newFakeDynamo()
			tc.setupFake(fake)

			code, body, err := handler.HandleUpdateLocation(ctx, tc.driverID, tc.req, fake)

			if code != tc.expectedStatus {
				t.Fatalf("expected status %d, got %d (body: %v, err: %v)", tc.expectedStatus, code, body, err)
			}

			if tc.expectedStatus == 200 {
				if err != nil {
					t.Fatalf("expected nil error on 200, got: %v", err)
				}
				if body["status"] != "ok" {
					t.Errorf("expected body status 'ok', got %v", body)
				}
			} else {
				if tc.expectedErrorMsg != "" && body["error"] != tc.expectedErrorMsg {
					t.Errorf("expected error message %q, got %q", tc.expectedErrorMsg, body["error"])
				}
			}

			if tc.expectPutCalled {
				if len(fake.putCalls) != 1 {
					t.Fatalf("expected exactly 1 PutItem call, got %d", len(fake.putCalls))
				}
				if tc.assertWrittenItem != nil {
					tc.assertWrittenItem(t, fake.putCalls[0])
				}
			} else {
				if len(fake.putCalls) != 0 {
					t.Errorf("expected 0 PutItem calls, got %d", len(fake.putCalls))
				}
			}
		})
	}
}
