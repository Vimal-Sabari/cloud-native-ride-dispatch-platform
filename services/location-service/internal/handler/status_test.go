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

func TestHandleUpdateStatus(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name              string
		driverID          string
		req               models.StatusUpdateRequest
		setupFake         func(f *fakeDynamo)
		expectedStatus    int
		expectedErrorMsg  string
		expectPutCalled   bool
		assertWrittenItem func(t *testing.T, item map[string]types.AttributeValue)
	}{
		{
			name:     "valid status transition to available with existing location",
			driverID: "driver-301",
			req: models.StatusUpdateRequest{
				Status: models.StatusAvailable,
			},
			setupFake: func(f *fakeDynamo) {
				f.setItem("DRIVER#driver-301", "LOCATION", map[string]types.AttributeValue{
					"PK":     &types.AttributeValueMemberS{Value: "DRIVER#driver-301"},
					"SK":     &types.AttributeValueMemberS{Value: "LOCATION"},
					"Lat":    &types.AttributeValueMemberN{Value: "37.7749"},
					"Lng":    &types.AttributeValueMemberN{Value: "-122.4194"},
					"Status": &types.AttributeValueMemberS{Value: models.StatusOffline},
				})
			},
			expectedStatus:  200,
			expectPutCalled: true,
			assertWrittenItem: func(t *testing.T, item map[string]types.AttributeValue) {
				expectedHash, err := geospatial.Encode(37.7749, -122.4194, 5)
				if err != nil {
					t.Fatalf("unexpected encode err: %v", err)
				}

				if v, ok := item["PK"].(*types.AttributeValueMemberS); !ok || v.Value != "DRIVER#driver-301" {
					t.Errorf("expected PK 'DRIVER#driver-301', got %v", item["PK"])
				}
				if v, ok := item["SK"].(*types.AttributeValueMemberS); !ok || v.Value != "LOCATION" {
					t.Errorf("expected SK 'LOCATION', got %v", item["SK"])
				}
				if v, ok := item["GSI1PK"].(*types.AttributeValueMemberS); !ok || v.Value != "GEOHASH#"+expectedHash {
					t.Errorf("expected GSI1PK 'GEOHASH#%s', got %v", expectedHash, item["GSI1PK"])
				}
				if v, ok := item["GSI1SK"].(*types.AttributeValueMemberS); !ok || v.Value != "DRIVER#available#driver-301" {
					t.Errorf("expected GSI1SK 'DRIVER#available#driver-301', got %v", item["GSI1SK"])
				}
				if v, ok := item["Status"].(*types.AttributeValueMemberS); !ok || v.Value != models.StatusAvailable {
					t.Errorf("expected Status 'available', got %v", item["Status"])
				}
				if v, ok := item["Lat"].(*types.AttributeValueMemberN); !ok || v.Value != "37.7749" {
					t.Errorf("expected Lat '37.7749', got %v", item["Lat"])
				}
				if v, ok := item["Lng"].(*types.AttributeValueMemberN); !ok || v.Value != "-122.4194" {
					t.Errorf("expected Lng '-122.4194', got %v", item["Lng"])
				}

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
					t.Errorf("ExpiresAt %d not within 5-minute window from %d", expSec, nowSec)
				}
			},
		},
		{
			name:     "valid status update with no prior location record (default 0.0, 0.0)",
			driverID: "driver-fresh",
			req: models.StatusUpdateRequest{
				Status: models.StatusBusy,
			},
			setupFake: func(f *fakeDynamo) {
				// No prior record
			},
			expectedStatus:  200,
			expectPutCalled: true,
			assertWrittenItem: func(t *testing.T, item map[string]types.AttributeValue) {
				expectedHash, err := geospatial.Encode(0.0, 0.0, 5)
				if err != nil {
					t.Fatalf("unexpected encode err: %v", err)
				}

				if v, ok := item["GSI1PK"].(*types.AttributeValueMemberS); !ok || v.Value != "GEOHASH#"+expectedHash {
					t.Errorf("expected GSI1PK 'GEOHASH#%s', got %v", expectedHash, item["GSI1PK"])
				}
				if v, ok := item["GSI1SK"].(*types.AttributeValueMemberS); !ok || v.Value != "DRIVER#busy#driver-fresh" {
					t.Errorf("expected GSI1SK 'DRIVER#busy#driver-fresh', got %v", item["GSI1SK"])
				}
				if v, ok := item["Lat"].(*types.AttributeValueMemberN); !ok || v.Value != "0" {
					t.Errorf("expected default Lat '0', got %v", item["Lat"])
				}
				if v, ok := item["Lng"].(*types.AttributeValueMemberN); !ok || v.Value != "0" {
					t.Errorf("expected default Lng '0', got %v", item["Lng"])
				}
			},
		},
		{
			name:     "valid status transition to offline",
			driverID: "driver-off",
			req: models.StatusUpdateRequest{
				Status: models.StatusOffline,
			},
			setupFake: func(f *fakeDynamo) {
				f.setItem("DRIVER#driver-off", "LOCATION", map[string]types.AttributeValue{
					"PK":     &types.AttributeValueMemberS{Value: "DRIVER#driver-off"},
					"SK":     &types.AttributeValueMemberS{Value: "LOCATION"},
					"Lat":    &types.AttributeValueMemberN{Value: "12.34"},
					"Lng":    &types.AttributeValueMemberN{Value: "56.78"},
					"Status": &types.AttributeValueMemberS{Value: models.StatusAvailable},
				})
			},
			expectedStatus:  200,
			expectPutCalled: true,
			assertWrittenItem: func(t *testing.T, item map[string]types.AttributeValue) {
				if v, ok := item["GSI1SK"].(*types.AttributeValueMemberS); !ok || v.Value != "DRIVER#offline#driver-off" {
					t.Errorf("expected GSI1SK 'DRIVER#offline#driver-off', got %v", item["GSI1SK"])
				}
				if v, ok := item["Status"].(*types.AttributeValueMemberS); !ok || v.Value != models.StatusOffline {
					t.Errorf("expected Status 'offline', got %v", item["Status"])
				}
			},
		},
		{
			name:     "valid status transition using lowercase lat/lng attributes from existing record",
			driverID: "driver-low-case",
			req: models.StatusUpdateRequest{
				Status: models.StatusAvailable,
			},
			setupFake: func(f *fakeDynamo) {
				f.setItem("DRIVER#driver-low-case", "LOCATION", map[string]types.AttributeValue{
					"PK":  &types.AttributeValueMemberS{Value: "DRIVER#driver-low-case"},
					"SK":  &types.AttributeValueMemberS{Value: "LOCATION"},
					"lat": &types.AttributeValueMemberN{Value: "10.0"},
					"lng": &types.AttributeValueMemberN{Value: "20.0"},
				})
			},
			expectedStatus:  200,
			expectPutCalled: true,
			assertWrittenItem: func(t *testing.T, item map[string]types.AttributeValue) {
				if v, ok := item["Lat"].(*types.AttributeValueMemberN); !ok || v.Value != "10" {
					t.Errorf("expected Lat '10', got %v", item["Lat"])
				}
			},
		},
		{
			name:     "corrupted non-numeric lat/lng in existing record falls back to 0.0, 0.0",
			driverID: "driver-corrupt-coord",
			req: models.StatusUpdateRequest{
				Status: models.StatusAvailable,
			},
			setupFake: func(f *fakeDynamo) {
				f.setItem("DRIVER#driver-corrupt-coord", "LOCATION", map[string]types.AttributeValue{
					"PK":  &types.AttributeValueMemberS{Value: "DRIVER#driver-corrupt-coord"},
					"SK":  &types.AttributeValueMemberS{Value: "LOCATION"},
					"Lat": &types.AttributeValueMemberN{Value: "not-a-number"},
					"Lng": &types.AttributeValueMemberN{Value: "not-a-number"},
					"lat": &types.AttributeValueMemberN{Value: "not-a-number"},
					"lng": &types.AttributeValueMemberN{Value: "not-a-number"},
				})
			},
			expectedStatus:  200,
			expectPutCalled: true,
			assertWrittenItem: func(t *testing.T, item map[string]types.AttributeValue) {
				if v, ok := item["Lat"].(*types.AttributeValueMemberN); !ok || v.Value != "0" {
					t.Errorf("expected Lat '0', got %v", item["Lat"])
				}
			},
		},
		{
			name:     "out-of-range coordinates stored in DynamoDB causes geohash encode failure",
			driverID: "driver-out-of-range",
			req: models.StatusUpdateRequest{
				Status: models.StatusAvailable,
			},
			setupFake: func(f *fakeDynamo) {
				f.setItem("DRIVER#driver-out-of-range", "LOCATION", map[string]types.AttributeValue{
					"PK":  &types.AttributeValueMemberS{Value: "DRIVER#driver-out-of-range"},
					"SK":  &types.AttributeValueMemberS{Value: "LOCATION"},
					"Lat": &types.AttributeValueMemberN{Value: "999.0"},
					"Lng": &types.AttributeValueMemberN{Value: "0.0"},
				})
			},
			expectedStatus:   500,
			expectPutCalled:  false,
			expectedErrorMsg: "internal error",
		},
		{
			name:     "invalid status string",
			driverID: "driver-bad-status",
			req: models.StatusUpdateRequest{
				Status: "UNKNOWN_STATUS",
			},
			setupFake:        func(f *fakeDynamo) {},
			expectedStatus:   400,
			expectPutCalled:  false,
			expectedErrorMsg: "invalid status",
		},
		{
			name:     "empty status string",
			driverID: "driver-empty-status",
			req: models.StatusUpdateRequest{
				Status: "",
			},
			setupFake:        func(f *fakeDynamo) {},
			expectedStatus:   400,
			expectPutCalled:  false,
			expectedErrorMsg: "invalid status",
		},
		{
			name:     "empty driver id",
			driverID: "",
			req: models.StatusUpdateRequest{
				Status: models.StatusAvailable,
			},
			setupFake:        func(f *fakeDynamo) {},
			expectedStatus:   400,
			expectPutCalled:  false,
			expectedErrorMsg: "driver id is required",
		},
		{
			name:     "dynamodb GetItem error",
			driverID: "driver-err",
			req: models.StatusUpdateRequest{
				Status: models.StatusAvailable,
			},
			setupFake: func(f *fakeDynamo) {
				f.getItemErr = errors.New("dynamo get failure")
			},
			expectedStatus:   500,
			expectPutCalled:  false,
			expectedErrorMsg: "internal error",
		},
		{
			name:     "dynamodb PutItem error",
			driverID: "driver-err",
			req: models.StatusUpdateRequest{
				Status: models.StatusAvailable,
			},
			setupFake: func(f *fakeDynamo) {
				f.putItemErr = errors.New("dynamo put failure")
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

			code, body, err := handler.HandleUpdateStatus(ctx, tc.driverID, tc.req, fake)

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
