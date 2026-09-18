package models

// LocationUpdateRequest represents the payload for updating a driver's geographic location.
type LocationUpdateRequest struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// StatusUpdateRequest represents the payload for updating a driver's availability status.
type StatusUpdateRequest struct {
	Status string `json:"status"`
}

// Driver availability status constants.
const (
	StatusAvailable = "available"
	StatusBusy      = "busy"
	StatusOffline   = "offline"
)
