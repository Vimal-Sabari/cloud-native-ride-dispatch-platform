package forward

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/event-forwarder/internal/classify"
)

// SQSSender is a narrow interface representing SQS message publishing capability.
type SQSSender interface {
	SendMessage(ctx context.Context, queueURL string, body string) error
}

// QueueURLs holds the destination SQS queue URLs.
type QueueURLs struct {
	LocationEvents    string
	RideRequestEvents string
}

// OutgoingMessage encapsulates the serialized event format sent to SQS.
type OutgoingMessage struct {
	EventType string                 `json:"eventType"`
	Payload   map[string]interface{} `json:"payload"`
}

// Send serializes event as JSON and routes it to the designated SQS queue URL.
func Send(ctx context.Context, sender SQSSender, urls QueueURLs, event classify.ClassifiedEvent) error {
	var targetURL string
	switch event.QueueTarget {
	case "location-events":
		targetURL = urls.LocationEvents
	case "ride-request-events":
		targetURL = urls.RideRequestEvents
	default:
		return fmt.Errorf("forward: unknown queue target %q", event.QueueTarget)
	}

	if targetURL == "" {
		return fmt.Errorf("forward: queue URL for target %q is empty", event.QueueTarget)
	}

	msg := OutgoingMessage{
		EventType: event.EventType,
		Payload:   event.Payload,
	}

	bodyBytes, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("forward: failed to marshal message body: %w", err)
	}

	if err := sender.SendMessage(ctx, targetURL, string(bodyBytes)); err != nil {
		return fmt.Errorf("forward: failed to send message to queue %s: %w", targetURL, err)
	}

	return nil
}
