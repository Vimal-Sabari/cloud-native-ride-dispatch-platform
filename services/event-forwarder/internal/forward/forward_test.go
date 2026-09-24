package forward_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/event-forwarder/internal/classify"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/event-forwarder/internal/forward"
)

type sentCall struct {
	QueueURL string
	Body     string
}

type fakeSQSSender struct {
	calls       []sentCall
	failOnQueue string
	failError   error
}

func (f *fakeSQSSender) SendMessage(ctx context.Context, queueURL string, body string) error {
	if f.failOnQueue != "" && queueURL == f.failOnQueue {
		return f.failError
	}
	f.calls = append(f.calls, sentCall{
		QueueURL: queueURL,
		Body:     body,
	})
	return nil
}

func TestSend_LocationUpdated(t *testing.T) {
	sender := &fakeSQSSender{}
	urls := forward.QueueURLs{
		LocationEvents:    "https://sqs.us-east-1.amazonaws.com/123456789012/location-events",
		RideRequestEvents: "https://sqs.us-east-1.amazonaws.com/123456789012/ride-request-events",
	}

	event := classify.ClassifiedEvent{
		QueueTarget: "location-events",
		EventType:   "location-updated",
		Payload: map[string]interface{}{
			"driverId": "driver-123",
			"geohash":  "u4pruy",
			"status":   "available",
			"lat":      37.7749,
			"lng":      -122.4194,
		},
	}

	err := forward.Send(context.Background(), sender, urls, event)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if len(sender.calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(sender.calls))
	}

	call := sender.calls[0]
	if call.QueueURL != urls.LocationEvents {
		t.Errorf("expected queue URL %s, got %s", urls.LocationEvents, call.QueueURL)
	}

	var parsed forward.OutgoingMessage
	if err := json.Unmarshal([]byte(call.Body), &parsed); err != nil {
		t.Fatalf("failed to unmarshal sent body: %v", err)
	}

	if parsed.EventType != "location-updated" {
		t.Errorf("expected EventType 'location-updated', got '%s'", parsed.EventType)
	}
	if parsed.Payload["driverId"] != "driver-123" {
		t.Errorf("expected driverId 'driver-123', got '%v'", parsed.Payload["driverId"])
	}
}

func TestSend_RideRequested(t *testing.T) {
	sender := &fakeSQSSender{}
	urls := forward.QueueURLs{
		LocationEvents:    "https://sqs.us-east-1.amazonaws.com/123456789012/location-events",
		RideRequestEvents: "https://sqs.us-east-1.amazonaws.com/123456789012/ride-request-events",
	}

	event := classify.ClassifiedEvent{
		QueueTarget: "ride-request-events",
		EventType:   "ride-requested",
		Payload: map[string]interface{}{
			"rideId":  "ride-999",
			"riderId": "rider-123",
		},
	}

	err := forward.Send(context.Background(), sender, urls, event)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if len(sender.calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(sender.calls))
	}

	call := sender.calls[0]
	if call.QueueURL != urls.RideRequestEvents {
		t.Errorf("expected queue URL %s, got %s", urls.RideRequestEvents, call.QueueURL)
	}

	var parsed forward.OutgoingMessage
	if err := json.Unmarshal([]byte(call.Body), &parsed); err != nil {
		t.Fatalf("failed to unmarshal sent body: %v", err)
	}
	if parsed.EventType != "ride-requested" {
		t.Errorf("expected EventType 'ride-requested', got '%s'", parsed.EventType)
	}
	if parsed.Payload["rideId"] != "ride-999" {
		t.Errorf("expected rideId 'ride-999', got '%v'", parsed.Payload["rideId"])
	}
}

func TestSend_FailurePropagation(t *testing.T) {
	expectedErr := errors.New("simulated SQS network error")
	sender := &fakeSQSSender{
		failOnQueue: "https://sqs.us-east-1.amazonaws.com/123456789012/location-events",
		failError:   expectedErr,
	}
	urls := forward.QueueURLs{
		LocationEvents:    "https://sqs.us-east-1.amazonaws.com/123456789012/location-events",
		RideRequestEvents: "https://sqs.us-east-1.amazonaws.com/123456789012/ride-request-events",
	}

	event := classify.ClassifiedEvent{
		QueueTarget: "location-events",
		EventType:   "location-updated",
		Payload:     map[string]interface{}{"driverId": "driver-1"},
	}

	err := forward.Send(context.Background(), sender, urls, event)
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	if !errors.Is(err, expectedErr) {
		// or strings.Contains
		if !errors.Is(err, expectedErr) && len(err.Error()) == 0 {
			t.Errorf("expected wrapped error containing %v, got %v", expectedErr, err)
		}
	}
}

func TestSend_UnknownQueueTarget(t *testing.T) {
	sender := &fakeSQSSender{}
	urls := forward.QueueURLs{
		LocationEvents: "url-1",
	}
	event := classify.ClassifiedEvent{
		QueueTarget: "unknown-queue",
		EventType:   "some-event",
	}

	err := forward.Send(context.Background(), sender, urls, event)
	if err == nil {
		t.Fatal("expected error for unknown queue target, got nil")
	}
}
