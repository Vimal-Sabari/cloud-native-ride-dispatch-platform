package classify_test

import (
	"reflect"
	"testing"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/event-forwarder/internal/classify"
)

func TestClassify(t *testing.T) {
	tests := []struct {
		name          string
		record        classify.StreamRecord
		wantEvent     *classify.ClassifiedEvent
		wantForwarded bool
	}{
		{
			name: "Rule a: INSERT location record -> location-updated",
			record: classify.StreamRecord{
				EventName: "INSERT",
				PK:        "DRIVER#driver-101",
				SK:        "LOCATION",
				NewImage: map[string]interface{}{
					"GSI1PK": "GEOHASH#u4pruy",
					"GSI1SK": "DRIVER#available#driver-101",
					"status": "available",
					"lat":    37.7749,
					"lng":    -122.4194,
				},
			},
			wantForwarded: true,
			wantEvent: &classify.ClassifiedEvent{
				QueueTarget: "location-events",
				EventType:   "location-updated",
				Payload: map[string]interface{}{
					"driverId": "driver-101",
					"geohash":  "u4pruy",
					"status":   "available",
					"lat":      37.7749,
					"lng":      -122.4194,
				},
			},
		},
		{
			name: "Rule a: MODIFY location record with Status capital -> location-updated",
			record: classify.StreamRecord{
				EventName: "MODIFY",
				PK:        "DRIVER#driver-202",
				SK:        "LOCATION",
				NewImage: map[string]interface{}{
					"GSI1PK": "GEOHASH#9q8yy",
					"GSI1SK": "DRIVER#busy#driver-202",
					"Status": "busy",
					"Lat":    37.7833,
					"Lng":    -122.4167,
				},
			},
			wantForwarded: true,
			wantEvent: &classify.ClassifiedEvent{
				QueueTarget: "location-events",
				EventType:   "location-updated",
				Payload: map[string]interface{}{
					"driverId": "driver-202",
					"geohash":  "9q8yy",
					"status":   "busy",
					"lat":      37.7833,
					"lng":      -122.4167,
				},
			},
		},
		{
			name: "Rule b: INSERT ride details with state REQUESTED -> ride-requested",
			record: classify.StreamRecord{
				EventName: "INSERT",
				PK:        "RIDE#ride-999",
				SK:        "DETAILS",
				NewImage: map[string]interface{}{
					"state":   "REQUESTED",
					"riderId": "rider-123",
					"pickup": map[string]interface{}{
						"lat": 37.7749,
						"lng": -122.4194,
					},
				},
			},
			wantForwarded: true,
			wantEvent: &classify.ClassifiedEvent{
				QueueTarget: "ride-request-events",
				EventType:   "ride-requested",
				Payload: map[string]interface{}{
					"rideId":  "ride-999",
					"riderId": "rider-123",
					"pickup": map[string]interface{}{
						"lat": 37.7749,
						"lng": -122.4194,
					},
				},
			},
		},
		{
			name: "Rule c: MODIFY ride details transition REQUESTED -> CANCELLED -> ride-cancelled",
			record: classify.StreamRecord{
				EventName: "MODIFY",
				PK:        "RIDE#ride-555",
				SK:        "DETAILS",
				OldImage: map[string]interface{}{
					"state": "REQUESTED",
				},
				NewImage: map[string]interface{}{
					"state": "CANCELLED",
				},
			},
			wantForwarded: true,
			wantEvent: &classify.ClassifiedEvent{
				QueueTarget: "ride-request-events",
				EventType:   "ride-cancelled",
				Payload: map[string]interface{}{
					"rideId": "ride-555",
				},
			},
		},
		{
			name: "Rule c: MODIFY ride details transition MATCHED -> CANCELLED -> ride-cancelled",
			record: classify.StreamRecord{
				EventName: "MODIFY",
				PK:        "RIDE#ride-777",
				SK:        "DETAILS",
				OldImage: map[string]interface{}{
					"state": "MATCHED",
				},
				NewImage: map[string]interface{}{
					"state": "CANCELLED",
				},
			},
			wantForwarded: true,
			wantEvent: &classify.ClassifiedEvent{
				QueueTarget: "ride-request-events",
				EventType:   "ride-cancelled",
				Payload: map[string]interface{}{
					"rideId": "ride-777",
				},
			},
		},
		{
			name: "Negative: GSI3 pointer record (should NOT forward)",
			record: classify.StreamRecord{
				EventName: "INSERT",
				PK:        "DRIVER#driver-101",
				SK:        "ACTIVE_RIDE_POINTER",
				NewImage: map[string]interface{}{
					"rideId": "ride-123",
				},
			},
			wantForwarded: false,
			wantEvent:     nil,
		},
		{
			name: "Negative: REMOVE event on location record (should NOT forward)",
			record: classify.StreamRecord{
				EventName: "REMOVE",
				PK:        "DRIVER#driver-101",
				SK:        "LOCATION",
				OldImage: map[string]interface{}{
					"status": "available",
				},
			},
			wantForwarded: false,
			wantEvent:     nil,
		},
		{
			name: "Negative: Ride MODIFY REQUESTED -> MATCHED (should NOT forward to ride-cancelled)",
			record: classify.StreamRecord{
				EventName: "MODIFY",
				PK:        "RIDE#ride-101",
				SK:        "DETAILS",
				OldImage: map[string]interface{}{
					"state": "REQUESTED",
				},
				NewImage: map[string]interface{}{
					"state":    "MATCHED",
					"driverId": "driver-123",
				},
			},
			wantForwarded: false,
			wantEvent:     nil,
		},
		{
			name: "Negative: Malformed location record missing GSI1PK (should NOT panic, return false)",
			record: classify.StreamRecord{
				EventName: "INSERT",
				PK:        "DRIVER#driver-101",
				SK:        "LOCATION",
				NewImage: map[string]interface{}{
					"status": "available",
					"lat":    37.7749,
				},
			},
			wantForwarded: false,
			wantEvent:     nil,
		},
		{
			name: "Negative: Malformed ride record missing riderId (should NOT panic, return false)",
			record: classify.StreamRecord{
				EventName: "INSERT",
				PK:        "RIDE#ride-101",
				SK:        "DETAILS",
				NewImage: map[string]interface{}{
					"state": "REQUESTED",
				},
			},
			wantForwarded: false,
			wantEvent:     nil,
		},
		{
			name: "Negative: Nil images (should NOT panic)",
			record: classify.StreamRecord{
				EventName: "INSERT",
				PK:        "RIDE#ride-101",
				SK:        "DETAILS",
				NewImage:  nil,
			},
			wantForwarded: false,
			wantEvent:     nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotEvent, gotForwarded := classify.Classify(tt.record)
			if gotForwarded != tt.wantForwarded {
				t.Fatalf("Classify() gotForwarded = %v, want %v", gotForwarded, tt.wantForwarded)
			}
			if !reflect.DeepEqual(gotEvent, tt.wantEvent) {
				t.Errorf("Classify() gotEvent = %+v, want %+v", gotEvent, tt.wantEvent)
			}
		})
	}
}
