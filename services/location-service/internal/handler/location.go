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

// HandleUpdateLocation processes a driver location heartbeat update.
// It is intentionally framework-free (decoupled from APIGatewayProxyRequest).
//
// Architectural Decision — GSI1SK Consistency (Read-Then-Write):
// In our DynamoDB single-table schema, GSI1 indexes driver locations by spatial geohash,
// with GSI1SK = "DRIVER#" + status + "#" + driverID to allow single-query filtering
// of available drivers in a cell.
// Because a location update payload only conveys lat/lng coordinates, we must first
// perform a GetItem on "DRIVER#<driverID>" / "LOCATION" to recover the driver's current
// availability status (defaulting to "offline" if no record exists yet). We then write
// the new record with that status folded into GSI1SK.
//
// Trade-off / Concurrency:
// This read-then-write pattern has an acknowledged race condition: if concurrent location
// and status updates occur for the same driver at the same millisecond, one write could
// overwrite the other's status or location. Given driver heartbeat intervals (e.g. 5-10s)
// and user status changes, this is an extremely rare and benign trade-off accepted in
// exchange for avoiding distributed locking or multi-item transactions.
func HandleUpdateLocation(
	ctx context.Context,
	driverID string,
	req models.LocationUpdateRequest,
	deps DynamoWriter,
) (int, map[string]string, error) {
	if driverID == "" {
		return 400, map[string]string{"error": "driver id is required"}, nil
	}

	// Validate coordinates using geospatial.Encode at standard precision (5 characters).
	// Encode enforces lat in [-90, 90] and lng in [-180, 180].
	geohash, err := geospatial.Encode(req.Lat, req.Lng, geospatial.StandardPrecision)
	if err != nil {
		return 400, map[string]string{"error": err.Error()}, nil
	}

	// Read existing driver record to determine current availability status
	existing, err := deps.GetItem(ctx, "DRIVER#"+driverID, "LOCATION")
	if err != nil {
		log.Printf("HandleUpdateLocation: failed to get driver record for %s: %v", driverID, err)
		return 500, map[string]string{"error": "internal error"}, err
	}

	status := models.StatusOffline
	if existing != nil {
		if s, ok := existing["Status"].(*types.AttributeValueMemberS); ok && s.Value != "" {
			status = s.Value
		} else if s, ok := existing["status"].(*types.AttributeValueMemberS); ok && s.Value != "" {
			status = s.Value
		}
	}

	now := time.Now().UTC()
	updatedAt := now.Format(time.RFC3339)
	expiresAt := now.Add(5 * time.Minute).Unix()

	item := map[string]types.AttributeValue{
		"PK":        &types.AttributeValueMemberS{Value: "DRIVER#" + driverID},
		"SK":        &types.AttributeValueMemberS{Value: "LOCATION"},
		"GSI1PK":    &types.AttributeValueMemberS{Value: "GEOHASH#" + geohash},
		"GSI1SK":    &types.AttributeValueMemberS{Value: "DRIVER#" + status + "#" + driverID},
		"driverId":  &types.AttributeValueMemberS{Value: driverID},
		"Status":    &types.AttributeValueMemberS{Value: status},
		"status":    &types.AttributeValueMemberS{Value: status},
		"Lat":       &types.AttributeValueMemberN{Value: strconv.FormatFloat(req.Lat, 'f', -1, 64)},
		"lat":       &types.AttributeValueMemberN{Value: strconv.FormatFloat(req.Lat, 'f', -1, 64)},
		"Lng":       &types.AttributeValueMemberN{Value: strconv.FormatFloat(req.Lng, 'f', -1, 64)},
		"lng":       &types.AttributeValueMemberN{Value: strconv.FormatFloat(req.Lng, 'f', -1, 64)},
		"UpdatedAt": &types.AttributeValueMemberS{Value: updatedAt},
		"updatedAt": &types.AttributeValueMemberS{Value: updatedAt},
		"ExpiresAt": &types.AttributeValueMemberN{Value: strconv.FormatInt(expiresAt, 10)},
		"expiresAt": &types.AttributeValueMemberN{Value: strconv.FormatInt(expiresAt, 10)},
	}

	if err := deps.PutItem(ctx, item); err != nil {
		log.Printf("HandleUpdateLocation: failed to put location item for %s: %v", driverID, err)
		return 500, map[string]string{"error": "internal error"}, err
	}

	return 200, map[string]string{"status": "ok"}, nil
}
