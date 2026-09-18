package handler

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
	models "github.com/Vimal-Sabari/ride-dispatch-platform/shared/models/go"
)

// HandleUpdateStatus processes a driver availability status update ("available", "busy", "offline").
// It is intentionally framework-free (decoupled from APIGatewayProxyRequest).
//
// Architectural Decision — GSI1SK Consistency (Read-Then-Write):
// In our DynamoDB single-table design, GSI1 indexes drivers by geohash cell with
// GSI1SK = "DRIVER#" + status + "#" + driverID.
// Because a status update payload only carries the new status string (not coordinates),
// we must first read the existing record via GetItem on "DRIVER#<driverID>" / "LOCATION"
// to recover the driver's current coordinates. We then recompute the geohash and rewrite
// the record with the updated status folded into GSI1SK.
//
// Trade-off / Concurrency:
// A benign race condition exists if a location update and status update arrive concurrently
// for the same driver. In that rare window, one write might overwrite the other's latest field.
// For the platform's heartbeat cadence and status change frequency, this is an acceptable
// trade-off that avoids distributed locking mechanisms.
func HandleUpdateStatus(
	ctx context.Context,
	driverID string,
	req models.StatusUpdateRequest,
	deps DynamoWriter,
) (int, map[string]string, error) {
	if driverID == "" {
		return 400, map[string]string{"error": "driver id is required"}, nil
	}

	// Validate status against defined constants
	switch req.Status {
	case models.StatusAvailable, models.StatusBusy, models.StatusOffline:
		// valid
	default:
		return 400, map[string]string{"error": "invalid status"}, nil
	}

	// Read current item to recover existing Lat/Lng
	existing, err := deps.GetItem(ctx, "DRIVER#"+driverID, "LOCATION")
	if err != nil {
		log.Printf("HandleUpdateStatus: failed to get driver record for %s: %v", driverID, err)
		return 500, map[string]string{"error": "internal error"}, err
	}

	// Edge Case: A driver may update their availability status (e.g. toggling to "available")
	// before their app emits its initial GPS location heartbeat.
	// If no prior record exists, we explicitly default coordinates to (0.0, 0.0) ("Null Island")
	// so the status is retained and indexed without crashing. When the initial location
	// update arrives shortly thereafter, it will overwrite the coordinates while preserving
	// this status.
	lat := 0.0
	lng := 0.0

	if existing != nil {
		if val, ok := existing["Lat"].(*types.AttributeValueMemberN); ok {
			if parsed, parseErr := strconv.ParseFloat(val.Value, 64); parseErr == nil {
				lat = parsed
			}
		} else if val, ok := existing["lat"].(*types.AttributeValueMemberN); ok {
			if parsed, parseErr := strconv.ParseFloat(val.Value, 64); parseErr == nil {
				lat = parsed
			}
		}

		if val, ok := existing["Lng"].(*types.AttributeValueMemberN); ok {
			if parsed, parseErr := strconv.ParseFloat(val.Value, 64); parseErr == nil {
				lng = parsed
			}
		} else if val, ok := existing["lng"].(*types.AttributeValueMemberN); ok {
			if parsed, parseErr := strconv.ParseFloat(val.Value, 64); parseErr == nil {
				lng = parsed
			}
		}
	}

	// Recompute geohash from the (possibly-defaulted) lat/lng
	geohash, err := geospatial.Encode(lat, lng, geospatial.StandardPrecision)
	if err != nil {
		// Lat/Lng recovered from previous store or default (0,0) should always encode,
		// but check error defensively.
		log.Printf("HandleUpdateStatus: failed to encode geohash for %s: %v", driverID, err)
		return 500, map[string]string{"error": "internal error"}, err
	}

	now := time.Now().UTC()
	updatedAt := now.Format(time.RFC3339)
	expiresAt := now.Add(5 * time.Minute).Unix()

	item := map[string]types.AttributeValue{
		"PK":        &types.AttributeValueMemberS{Value: "DRIVER#" + driverID},
		"SK":        &types.AttributeValueMemberS{Value: "LOCATION"},
		"GSI1PK":    &types.AttributeValueMemberS{Value: "GEOHASH#" + geohash},
		"GSI1SK":    &types.AttributeValueMemberS{Value: "DRIVER#" + req.Status + "#" + driverID},
		"driverId":  &types.AttributeValueMemberS{Value: driverID},
		"Status":    &types.AttributeValueMemberS{Value: req.Status},
		"status":    &types.AttributeValueMemberS{Value: req.Status},
		"Lat":       &types.AttributeValueMemberN{Value: strconv.FormatFloat(lat, 'f', -1, 64)},
		"lat":       &types.AttributeValueMemberN{Value: strconv.FormatFloat(lat, 'f', -1, 64)},
		"Lng":       &types.AttributeValueMemberN{Value: strconv.FormatFloat(lng, 'f', -1, 64)},
		"lng":       &types.AttributeValueMemberN{Value: strconv.FormatFloat(lng, 'f', -1, 64)},
		"UpdatedAt": &types.AttributeValueMemberS{Value: updatedAt},
		"updatedAt": &types.AttributeValueMemberS{Value: updatedAt},
		"ExpiresAt": &types.AttributeValueMemberN{Value: strconv.FormatInt(expiresAt, 10)},
		"expiresAt": &types.AttributeValueMemberN{Value: strconv.FormatInt(expiresAt, 10)},
	}

	if err := deps.PutItem(ctx, item); err != nil {
		log.Printf("HandleUpdateStatus: failed to put status item for %s: %v", driverID, err)
		return 500, map[string]string{"error": "internal error"}, err
	}

	return 200, map[string]string{"status": "ok"}, nil
}
