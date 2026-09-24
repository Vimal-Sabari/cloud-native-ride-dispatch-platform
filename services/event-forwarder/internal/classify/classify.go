package classify

import (
	"strings"
)

// StreamRecord represents a simplified, unmarshaled DynamoDB stream record
// independent of any AWS SDK/Lambda types.
type StreamRecord struct {
	EventName string
	PK        string
	SK        string
	NewImage  map[string]interface{}
	OldImage  map[string]interface{}
}

// ClassifiedEvent represents the categorized domain event ready for SQS forwarding.
type ClassifiedEvent struct {
	QueueTarget string // "location-events" or "ride-request-events"
	EventType   string // "location-updated", "ride-requested", "ride-cancelled"
	Payload     map[string]interface{}
}

// Classify inspects a stream record and determines if and how it should be routed.
// It implements the following rules in strict order:
// a) record.SK == "LOCATION" AND (record.EventName == "INSERT" OR record.EventName == "MODIFY")
//
//	-> location-updated event (location-events queue)
//
// b) strings.HasPrefix(record.PK, "RIDE#") AND record.SK == "DETAILS" AND record.EventName == "INSERT" AND NewImage["state"] == "REQUESTED"
//
//	-> ride-requested event (ride-request-events queue)
//
// c) strings.HasPrefix(record.PK, "RIDE#") AND record.SK == "DETAILS" AND record.EventName == "MODIFY" AND NewImage["state"] == "CANCELLED" AND (OldImage["state"] == "REQUESTED" OR OldImage["state"] == "MATCHED")
//
//	-> ride-cancelled event (ride-request-events queue)
//
// d) Everything else -> (nil, false)
func Classify(record StreamRecord) (*ClassifiedEvent, bool) {
	// Rule a: Location updates
	if record.SK == "LOCATION" && (record.EventName == "INSERT" || record.EventName == "MODIFY") {
		if !strings.HasPrefix(record.PK, "DRIVER#") {
			return nil, false
		}
		driverID := strings.TrimPrefix(record.PK, "DRIVER#")
		if driverID == "" || record.NewImage == nil {
			return nil, false
		}

		gsi1pk, ok := record.NewImage["GSI1PK"].(string)
		if !ok || !strings.HasPrefix(gsi1pk, "GEOHASH#") {
			return nil, false
		}
		geohash := strings.TrimPrefix(gsi1pk, "GEOHASH#")

		status, ok := record.NewImage["status"].(string)
		if !ok {
			// Status may also be "Status"
			status, ok = record.NewImage["Status"].(string)
			if !ok {
				return nil, false
			}
		}

		lat, ok := getFloat(record.NewImage, "lat", "Lat")
		if !ok {
			return nil, false
		}

		lng, ok := getFloat(record.NewImage, "lng", "Lng")
		if !ok {
			return nil, false
		}

		return &ClassifiedEvent{
			QueueTarget: "location-events",
			EventType:   "location-updated",
			Payload: map[string]interface{}{
				"driverId": driverID,
				"geohash":  geohash,
				"status":   status,
				"lat":      lat,
				"lng":      lng,
			},
		}, true
	}

	// Rule b: Ride requested
	if strings.HasPrefix(record.PK, "RIDE#") && record.SK == "DETAILS" && record.EventName == "INSERT" {
		if record.NewImage == nil {
			return nil, false
		}
		state, ok := record.NewImage["state"].(string)
		if !ok || state != "REQUESTED" {
			return nil, false
		}

		rideID := strings.TrimPrefix(record.PK, "RIDE#")
		if rideID == "" {
			return nil, false
		}

		riderID, ok := record.NewImage["riderId"].(string)
		if !ok || riderID == "" {
			return nil, false
		}

		// Pickup coordinates can be nested map "pickup": {"lat": ..., "lng": ...}
		// or flat pickupLat / pickupLng
		pickup, ok := extractPoint(record.NewImage, "pickup", "pickupLat", "pickupLng")
		if !ok {
			return nil, false
		}

		payload := map[string]interface{}{
			"rideId":  rideID,
			"riderId": riderID,
			"pickup":  pickup,
		}

		return &ClassifiedEvent{
			QueueTarget: "ride-request-events",
			EventType:   "ride-requested",
			Payload:     payload,
		}, true
	}

	// Rule c: Ride cancelled
	if strings.HasPrefix(record.PK, "RIDE#") && record.SK == "DETAILS" && record.EventName == "MODIFY" {
		if record.NewImage == nil || record.OldImage == nil {
			return nil, false
		}
		newState, ok := record.NewImage["state"].(string)
		if !ok || newState != "CANCELLED" {
			return nil, false
		}
		oldState, ok := record.OldImage["state"].(string)
		if !ok || (oldState != "REQUESTED" && oldState != "MATCHED") {
			return nil, false
		}

		rideID := strings.TrimPrefix(record.PK, "RIDE#")
		if rideID == "" {
			return nil, false
		}

		return &ClassifiedEvent{
			QueueTarget: "ride-request-events",
			EventType:   "ride-cancelled",
			Payload: map[string]interface{}{
				"rideId": rideID,
			},
		}, true
	}

	// Rule d: Everything else
	return nil, false
}

func getFloat(m map[string]interface{}, keys ...string) (float64, bool) {
	for _, k := range keys {
		if val, exists := m[k]; exists {
			switch v := val.(type) {
			case float64:
				return v, true
			case float32:
				return float64(v), true
			case int:
				return float64(v), true
			case int64:
				return float64(v), true
			}
		}
	}
	return 0, false
}

func extractPoint(m map[string]interface{}, nestedKey, latKey, lngKey string) (map[string]interface{}, bool) {
	if nested, ok := m[nestedKey].(map[string]interface{}); ok {
		lat, okLat := getFloat(nested, "lat", "Lat")
		lng, okLng := getFloat(nested, "lng", "Lng")
		if okLat && okLng {
			return map[string]interface{}{
				"lat": lat,
				"lng": lng,
			}, true
		}
	}

	lat, okLat := getFloat(m, latKey)
	lng, okLng := getFloat(m, lngKey)
	if okLat && okLng {
		return map[string]interface{}{
			"lat": lat,
			"lng": lng,
		}, true
	}

	return nil, false
}
