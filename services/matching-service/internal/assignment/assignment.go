package assignment

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/logging/go"
)

// DynamoWriter defines the data access contract required by Assigner for optimistic driver lock acquisition.
type DynamoWriter interface {
	PutItem(ctx context.Context, item map[string]types.AttributeValue) error
	GetItem(ctx context.Context, pk, sk string) (map[string]types.AttributeValue, error)
	ConditionalPutItem(ctx context.Context, item map[string]types.AttributeValue, conditionExpression string) (bool, error)
}

// TripServiceClient defines the external contract for notifying Trip Service of a confirmed match.
type TripServiceClient interface {
	AssignDriver(ctx context.Context, rideID, driverID string) error
}

// Assigner orchestrates the two-phase claim-then-confirm driver assignment pipeline.
type Assigner struct {
	Dynamo        DynamoWriter
	TripService   TripServiceClient
	StatusUpdater DriverStatusUpdater
}

// DriverStatusUpdater allows Assigner to synchronize driver availability immediately with the in-memory spatial index.
type DriverStatusUpdater interface {
	UpdateDriverStatus(driverID, status string)
}

// NewAssigner creates a new Assigner instance.
func NewAssigner(dynamo DynamoWriter, tripService TripServiceClient) *Assigner {
	return &Assigner{
		Dynamo:      dynamo,
		TripService: tripService,
	}
}

// Assign iterates through ranked candidate drivers, attempting to claim each driver via an
// optimistic conditional write (Status: "available" -> "busy").
// Upon acquiring a driver claim, it confirms the assignment with Trip Service.
//
// Critical Correctness & Compensation Logic:
// If the claim succeeds in DynamoDB but the subsequent HTTP confirmation call to Trip Service
// fails, Assigner immediately attempts to REVERT the driver's status back to "available"
// via a second conditional write (conditioned on Status == "busy").
// If the revert succeeds, the driver is unlocked for future matches. If the revert also fails,
// an error is logged with full details for asynchronous reconciliation (Module 27).
// In either case, the original Trip Service error is returned so the caller can retry the match.
func (a *Assigner) Assign(ctx context.Context, request models.RideRequest, candidates []models.MatchCandidate) (*models.AssignmentResult, error) {
	logger := logging.New("matching-service").WithCorrelationID(request.RideID)

	for _, candidate := range candidates {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		pk := "DRIVER#" + candidate.DriverID
		sk := "LOCATION"

		// 1. Fetch current driver record
		item, err := a.Dynamo.GetItem(ctx, pk, sk)
		if err != nil {
			logger.Warn("Assigner: failed to fetch driver record; skipping candidate", map[string]interface{}{
				"driverId": candidate.DriverID,
				"error":    err.Error(),
			})
			continue
		}
		if len(item) == 0 {
			logger.Warn("Assigner: driver record not found; skipping candidate", map[string]interface{}{
				"driverId": candidate.DriverID,
			})
			continue
		}

		// Pre-filter: verify candidate driver status from database record
		driverStatus := ""
		if s, ok := item["status"].(*types.AttributeValueMemberS); ok && s.Value != "" {
			driverStatus = s.Value
		} else if s, ok := item["Status"].(*types.AttributeValueMemberS); ok && s.Value != "" {
			driverStatus = s.Value
		}
		if driverStatus != "" && driverStatus != "available" {
			logger.Info("Assigner: candidate driver is not available in database; skipping candidate", map[string]interface{}{
				"driverId": candidate.DriverID,
				"status":   driverStatus,
			})
			if a.StatusUpdater != nil {
				a.StatusUpdater.UpdateDriverStatus(candidate.DriverID, driverStatus)
			}
			continue
		}

		// 2. Build updated claim item with Status = "busy" and assigned ride tracking
		claimItem := make(map[string]types.AttributeValue, len(item)+6)
		for k, v := range item {
			claimItem[k] = v
		}
		claimItem["Status"] = &types.AttributeValueMemberS{Value: "busy"}
		claimItem["status"] = &types.AttributeValueMemberS{Value: "busy"}
		claimItem["assigned_ride_id"] = &types.AttributeValueMemberS{Value: request.RideID}
		claimItem["assignedRideId"] = &types.AttributeValueMemberS{Value: request.RideID}
		if _, ok := claimItem["GSI1SK"]; ok {
			claimItem["GSI1SK"] = &types.AttributeValueMemberS{
				Value: fmt.Sprintf("DRIVER#busy#%s", candidate.DriverID),
			}
		}
		now := time.Now().UTC().Format(time.RFC3339)
		claimItem["UpdatedAt"] = &types.AttributeValueMemberS{Value: now}
		claimItem["updatedAt"] = &types.AttributeValueMemberS{Value: now}

		// 3. Attempt optimistic claim
		claimed, err := a.Dynamo.ConditionalPutItem(ctx, claimItem, "#status = :available")
		if err != nil {
			logger.Warn("Assigner: error executing conditional claim; skipping candidate", map[string]interface{}{
				"driverId": candidate.DriverID,
				"error":    err.Error(),
			})
			continue
		}

		if !claimed {
			// Driver was concurrently claimed or status changed
			logger.Info("Assigner: driver claim lost race (conditional check failed); attempting next candidate", map[string]interface{}{
				"driverId": candidate.DriverID,
			})
			if a.StatusUpdater != nil {
				a.StatusUpdater.UpdateDriverStatus(candidate.DriverID, "busy")
			}
			continue
		}

		if a.StatusUpdater != nil {
			a.StatusUpdater.UpdateDriverStatus(candidate.DriverID, "busy")
		}

		logger.Info("Assigner: successfully claimed driver; notifying Trip Service", map[string]interface{}{
			"driverId": candidate.DriverID,
			"rideId":   request.RideID,
		})

		// 4. Confirm match with Trip Service (with retry for transient errors)
		var tripErr error
		const maxTripRetries = 2
		for attempt := 0; attempt <= maxTripRetries; attempt++ {
			tripErr = a.TripService.AssignDriver(ctx, request.RideID, candidate.DriverID)
			if tripErr == nil {
				break
			}
			if attempt < maxTripRetries {
				select {
				case <-ctx.Done():
					tripErr = ctx.Err()
					break
				case <-time.After(time.Duration(50*(1<<attempt)) * time.Millisecond):
				}
			}
		}

		if tripErr == nil {
			logger.Info("Assigner: driver assignment confirmed by Trip Service", map[string]interface{}{
				"driverId":       candidate.DriverID,
				"rideId":         request.RideID,
				"distanceMeters": candidate.DistanceMeters,
			})
			return &models.AssignmentResult{
				Assigned:             true,
				DriverID:             candidate.DriverID,
				ChosenDistanceMeters: candidate.DistanceMeters,
			}, nil
		}

		// 5. Confirmation failed: execute compensating transaction to revert claim
		logger.Warn("Assigner: TripService confirmation failed; attempting compensation revert", map[string]interface{}{
			"driverId": candidate.DriverID,
			"rideId":   request.RideID,
			"error":    tripErr.Error(),
		})

		reverted, revertErr := RevertDriverClaim(ctx, a.Dynamo, candidate.DriverID, "busy", claimItem)
		if revertErr != nil || !reverted {
			logger.Error("Assigner: failed to revert driver claim after TripService confirmation failure. Driver remains in busy state and requires reconciliation", revertErr, map[string]interface{}{
				"driverId": candidate.DriverID,
				"rideId":   request.RideID,
				"reverted": reverted,
			})
		} else {
			logger.Info("Assigner: successfully reverted driver back to available after TripService error", map[string]interface{}{
				"driverId": candidate.DriverID,
				"rideId":   request.RideID,
			})
			if a.StatusUpdater != nil {
				a.StatusUpdater.UpdateDriverStatus(candidate.DriverID, "available")
			}
		}

		return nil, fmt.Errorf("assign driver %s to ride %s failed in TripService: %w", candidate.DriverID, request.RideID, tripErr)
	}

	// All candidate claims failed (e.g. concurrent race conditions or no valid candidates)
	logger.Info("Assigner: all candidate claims failed; ride remained unassigned", map[string]interface{}{
		"rideId":          request.RideID,
		"candidatesCount": len(candidates),
	})
	return &models.AssignmentResult{
		Assigned: false,
		DriverID: "",
	}, nil
}

// RevertDriverClaim executes an optimistic compensating conditional write to revert a driver's
// status back to "available" if their current status matches expectedCurrentStatus (typically "busy").
// It preserves existing driver attributes (coordinates, geohash) while updating Status, GSI1SK, and UpdatedAt.
// Returns (true, nil) on successful revert, (false, nil) if conditional check failed, or (false, err) on DynamoDB error.
func RevertDriverClaim(ctx context.Context, dynamo DynamoWriter, driverID, expectedCurrentStatus string, baseItem map[string]types.AttributeValue) (bool, error) {
	item := baseItem
	if len(item) == 0 {
		pk := "DRIVER#" + driverID
		sk := "LOCATION"
		fetched, err := dynamo.GetItem(ctx, pk, sk)
		if err != nil {
			return false, fmt.Errorf("failed to fetch driver %s record for claim revert: %w", driverID, err)
		}
		if len(fetched) == 0 {
			return false, fmt.Errorf("driver %s record not found for claim revert", driverID)
		}
		item = fetched
	}

	revertItem := make(map[string]types.AttributeValue, len(item)+4)
	for k, v := range item {
		revertItem[k] = v
	}
	revertItem["Status"] = &types.AttributeValueMemberS{Value: "available"}
	revertItem["status"] = &types.AttributeValueMemberS{Value: "available"}
	delete(revertItem, "assignedRideId")
	delete(revertItem, "assigned_ride_id")
	if _, ok := revertItem["GSI1SK"]; ok {
		revertItem["GSI1SK"] = &types.AttributeValueMemberS{
			Value: fmt.Sprintf("DRIVER#available#%s", driverID),
		}
	}
	revertNow := time.Now().UTC().Format(time.RFC3339)
	revertItem["UpdatedAt"] = &types.AttributeValueMemberS{Value: revertNow}
	revertItem["updatedAt"] = &types.AttributeValueMemberS{Value: revertNow}

	condition := fmt.Sprintf("#status = :%s", expectedCurrentStatus)
	return dynamo.ConditionalPutItem(ctx, revertItem, condition)
}
