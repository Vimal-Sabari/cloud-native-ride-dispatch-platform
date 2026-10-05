package models

import (
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

// RideRequest represents an inbound ride request requiring driver matching.
type RideRequest struct {
	RideID  string
	RiderID string
	Pickup  geospatial.Point
}

// MatchCandidate represents an available driver evaluated for a ride request,
// including their computed distance to the pickup coordinate.
type MatchCandidate struct {
	DriverID       string
	DistanceMeters float64
}

// AssignmentResult represents the outcome of an assignment attempt.
// If Assigned is false, DriverID is empty and ChosenDistanceMeters is 0,
// denoting that no candidate could be successfully claimed.
type AssignmentResult struct {
	Assigned             bool
	DriverID             string
	ChosenDistanceMeters float64
}
