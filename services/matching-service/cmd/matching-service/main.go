package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	sqstypes "github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/assignment"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/geoindex"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/matcher"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/matching-service/internal/models"
	dynamoclient "github.com/Vimal-Sabari/ride-dispatch-platform/shared/dynamo-client/go"
	"github.com/Vimal-Sabari/ride-dispatch-platform/shared/geospatial"
)

// SQSMessageWrapper represents the outer event envelope forwarded by DynamoDB Streams forwarder.
type SQSMessageWrapper struct {
	EventType string          `json:"eventType"`
	Payload   json.RawMessage `json:"payload"`
}

// LocationUpdatedPayload represents the deserialized location-updated event payload.
type LocationUpdatedPayload struct {
	DriverID string  `json:"driverId"`
	Geohash  string  `json:"geohash"`
	Status   string  `json:"status"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
}

// RideRequestedPayload represents the deserialized ride-requested event payload.
type RideRequestedPayload struct {
	RideID  string `json:"rideId"`
	RiderID string `json:"riderId"`
	Pickup  struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	} `json:"pickup"`
}

// RideCancelledPayload represents the deserialized ride-cancelled event payload.
type RideCancelledPayload struct {
	RideID string `json:"rideId"`
}

func main() {
	// 1. Read and validate environment variables
	dynamoTableName := os.Getenv("DYNAMO_TABLE_NAME")
	if dynamoTableName == "" {
		dynamoTableName = os.Getenv("TABLE_NAME")
	}
	if dynamoTableName == "" {
		log.Fatalf("FATAL: Required environment variable DYNAMO_TABLE_NAME is missing")
	}

	dynamoEndpoint := os.Getenv("DYNAMO_ENDPOINT")
	if dynamoEndpoint == "" {
		dynamoEndpoint = os.Getenv("AWS_ENDPOINT_URL")
	}

	locationQueueURL := os.Getenv("LOCATION_EVENTS_QUEUE_URL")
	if locationQueueURL == "" {
		log.Fatalf("FATAL: Required environment variable LOCATION_EVENTS_QUEUE_URL is missing")
	}

	rideRequestQueueURL := os.Getenv("RIDE_REQUEST_EVENTS_QUEUE_URL")
	if rideRequestQueueURL == "" {
		log.Fatalf("FATAL: Required environment variable RIDE_REQUEST_EVENTS_QUEUE_URL is missing")
	}

	sqsEndpoint := os.Getenv("SQS_ENDPOINT")
	if sqsEndpoint == "" {
		sqsEndpoint = os.Getenv("AWS_ENDPOINT_URL")
	}

	tripServiceBaseURL := os.Getenv("TRIP_SERVICE_BASE_URL")
	if tripServiceBaseURL == "" {
		log.Fatalf("FATAL: Required environment variable TRIP_SERVICE_BASE_URL is missing")
	}

	internalAPIKey := os.Getenv("INTERNAL_API_KEY")
	if internalAPIKey == "" {
		log.Fatalf("FATAL: Required environment variable INTERNAL_API_KEY is missing")
	}

	pollWaitTimeSeconds := 20
	if pollWaitStr := os.Getenv("POLL_WAIT_TIME_SECONDS"); pollWaitStr != "" {
		if parsed, err := strconv.Atoi(pollWaitStr); err == nil && parsed >= 0 && parsed <= 20 {
			pollWaitTimeSeconds = parsed
		}
	}

	matchingStrategy := os.Getenv("MATCHING_STRATEGY")
	if matchingStrategy == "" {
		matchingStrategy = "naive"
	}

	batchWindowMs := 3000
	if v := os.Getenv("BATCH_WINDOW_MS"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			batchWindowMs = parsed
		}
	}

	maxBatchSize := 20
	if v := os.Getenv("MAX_BATCH_SIZE"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			maxBatchSize = parsed
		}
	}

	// 2. Set up root context with graceful cancellation on SIGINT/SIGTERM
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	// 3. Construct core components
	dynamoClient, err := dynamoclient.NewClient(ctx, dynamoTableName, dynamoEndpoint)
	if err != nil {
		log.Fatalf("FATAL: Failed to initialize DynamoDB client: %v", err)
	}

	sqsClient, err := newSQSClient(ctx, sqsEndpoint)
	if err != nil {
		log.Fatalf("FATAL: Failed to initialize SQS client: %v", err)
	}

	tripClient := assignment.NewHTTPTripServiceClient(tripServiceBaseURL, internalAPIKey)
	geoIndex := geoindex.NewGeoIndex()
	matchStrategy := matcher.NaiveNearestMatcher{}
	assigner := &assignment.Assigner{
		Dynamo:      dynamoClient,
		TripService: tripClient,
	}

	var batchWindow *matcher.Window
	if matchingStrategy == "batch" {
		batchMatcher := matcher.BatchMatcher{}
		batchWindow = matcher.NewWindow(
			time.Duration(batchWindowMs)*time.Millisecond,
			maxBatchSize,
			func(batch []models.RideRequest) {
				flushCtx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
				defer cancel()
				matcher.ProcessBatch(flushCtx, batch, geoIndex, batchMatcher, matchStrategy, assigner, os.Stdout)
			},
		)
		defer batchWindow.Stop()
	}

	// 4. Log startup banner
	log.Println("==================================================================")
	log.Println("Ride Dispatch Platform - Matching Service")
	log.Printf("DynamoDB Table:       %s", dynamoTableName)
	log.Printf("DynamoDB Endpoint:    %s", dynamoEndpoint)
	log.Printf("Location Queue:       %s", locationQueueURL)
	log.Printf("Ride Request Queue:   %s", rideRequestQueueURL)
	log.Printf("SQS Endpoint:         %s", sqsEndpoint)
	log.Printf("Trip Service Base:    %s", tripServiceBaseURL)
	log.Printf("Poll Wait Time:       %d seconds", pollWaitTimeSeconds)
	log.Printf("Matching Strategy:    %s", matchingStrategy)
	if matchingStrategy == "batch" {
		log.Printf("Batch Window:         %d ms", batchWindowMs)
		log.Printf("Max Batch Size:       %d", maxBatchSize)
	}
	log.Println("Matching Service daemon started successfully.")
	log.Println("==================================================================")

	var wg sync.WaitGroup

	// 5. Launch location-events polling loop
	wg.Add(1)
	go func() {
		defer wg.Done()
		pollLocationEvents(ctx, sqsClient, locationQueueURL, sqsEndpoint, pollWaitTimeSeconds, geoIndex)
	}()

	// 6. Launch ride-request-events polling loop
	wg.Add(1)
	go func() {
		defer wg.Done()
		pollRideRequestEvents(ctx, sqsClient, rideRequestQueueURL, sqsEndpoint, pollWaitTimeSeconds, geoIndex, matchStrategy, assigner, batchWindow)
	}()

	// 7. Wait for shutdown signal
	<-ctx.Done()
	log.Println("Matching Service: shutdown signal received; waiting for in-flight polling workers to complete...")

	wg.Wait()
	if batchWindow != nil {
		batchWindow.Stop()
	}
	log.Println("Matching Service: all worker loops exited cleanly. Process terminating.")
}

func pollLocationEvents(
	ctx context.Context,
	client *sqs.Client,
	queueURL string,
	endpoint string,
	waitTimeSeconds int,
	geoIndex *geoindex.GeoIndex,
) {
	effectiveURL := normalizeQueueURL(queueURL, endpoint)
	log.Printf("Worker [location-events]: polling started on %s", effectiveURL)

	for {
		select {
		case <-ctx.Done():
			log.Println("Worker [location-events]: exiting poll loop on context cancellation")
			return
		default:
		}

		resp, err := client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl:            aws.String(effectiveURL),
			WaitTimeSeconds:     int32(waitTimeSeconds),
			MaxNumberOfMessages: 10,
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("Worker [location-events]: error receiving SQS messages: %v (retrying in 2s)", err)
			time.Sleep(2 * time.Second)
			continue
		}

		for _, msg := range resp.Messages {
			if ctx.Err() != nil {
				return
			}
			processLocationMessage(ctx, client, effectiveURL, msg, geoIndex)
		}
	}
}

func processLocationMessage(
	ctx context.Context,
	client *sqs.Client,
	queueURL string,
	msg sqstypes.Message,
	geoIndex *geoindex.GeoIndex,
) {
	if msg.Body == nil {
		return
	}

	var wrapper SQSMessageWrapper
	if err := json.Unmarshal([]byte(*msg.Body), &wrapper); err != nil {
		log.Printf("Worker [location-events]: failed to unmarshal SQS envelope for message %s: %v (leaving for redrive)", aws.ToString(msg.MessageId), err)
		return
	}

	if wrapper.EventType != "location-updated" {
		log.Printf("Worker [location-events]: ignoring unexpected eventType %q in message %s; deleting", wrapper.EventType, aws.ToString(msg.MessageId))
		deleteSQSMessage(ctx, client, queueURL, msg.ReceiptHandle)
		return
	}

	var payload LocationUpdatedPayload
	if err := json.Unmarshal(wrapper.Payload, &payload); err != nil {
		log.Printf("Worker [location-events]: invalid location-updated payload in message %s: %v (leaving for redrive)", aws.ToString(msg.MessageId), err)
		return
	}

	if payload.DriverID == "" || payload.Geohash == "" {
		log.Printf("Worker [location-events]: malformed payload (missing driverId or geohash) in message %s (leaving for redrive)", aws.ToString(msg.MessageId))
		return
	}

	geoIndex.UpsertDriver(payload.DriverID, payload.Geohash, payload.Status, payload.Lat, payload.Lng)

	deleteSQSMessage(ctx, client, queueURL, msg.ReceiptHandle)
}

func pollRideRequestEvents(
	ctx context.Context,
	client *sqs.Client,
	queueURL string,
	endpoint string,
	waitTimeSeconds int,
	geoIndex *geoindex.GeoIndex,
	strategy matcher.MatchStrategy,
	assigner *assignment.Assigner,
	window *matcher.Window,
) {
	effectiveURL := normalizeQueueURL(queueURL, endpoint)
	log.Printf("Worker [ride-request-events]: polling started on %s", effectiveURL)

	for {
		select {
		case <-ctx.Done():
			log.Println("Worker [ride-request-events]: exiting poll loop on context cancellation")
			return
		default:
		}

		resp, err := client.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
			QueueUrl:            aws.String(effectiveURL),
			WaitTimeSeconds:     int32(waitTimeSeconds),
			MaxNumberOfMessages: 10,
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("Worker [ride-request-events]: error receiving SQS messages: %v (retrying in 2s)", err)
			time.Sleep(2 * time.Second)
			continue
		}

		for _, msg := range resp.Messages {
			if ctx.Err() != nil {
				return
			}
			processRideRequestMessage(ctx, client, effectiveURL, msg, geoIndex, strategy, assigner, window)
		}
	}
}

func processRideRequestMessage(
	ctx context.Context,
	client *sqs.Client,
	queueURL string,
	msg sqstypes.Message,
	geoIndex *geoindex.GeoIndex,
	strategy matcher.MatchStrategy,
	assigner *assignment.Assigner,
	window *matcher.Window,
) {
	if msg.Body == nil {
		return
	}

	var wrapper SQSMessageWrapper
	if err := json.Unmarshal([]byte(*msg.Body), &wrapper); err != nil {
		log.Printf("Worker [ride-request-events]: failed to unmarshal SQS envelope for message %s: %v (leaving for redrive)", aws.ToString(msg.MessageId), err)
		return
	}

	switch wrapper.EventType {
	case "ride-requested":
		var payload RideRequestedPayload
		if err := json.Unmarshal(wrapper.Payload, &payload); err != nil {
			log.Printf("Worker [ride-request-events]: invalid ride-requested payload in message %s: %v (leaving for redrive)", aws.ToString(msg.MessageId), err)
			return
		}

		if payload.RideID == "" || payload.RiderID == "" {
			log.Printf("Worker [ride-request-events]: malformed payload (missing rideId or riderId) in message %s (leaving for redrive)", aws.ToString(msg.MessageId))
			return
		}

		rideReq := models.RideRequest{
			RideID:  payload.RideID,
			RiderID: payload.RiderID,
			Pickup: geospatial.Point{
				Lat: payload.Pickup.Lat,
				Lng: payload.Pickup.Lng,
			},
		}

		if window != nil {
			// Batch Strategy Path:
			// Enqueue request into the in-memory batch window and immediately delete from SQS.
			// Architectural Note:
			// In batch mode, the Window itself — rather than SQS visibility timeout — holds the request
			// during the aggregation period. This prevents visibility timeout expiration and duplicate
			// redelivery while waiting for the batch window or size threshold to be reached.
			window.Add(rideReq)
			deleteSQSMessage(ctx, client, queueURL, msg.ReceiptHandle)
			return
		}

		// Naive Strategy Path (per-message immediate matching with structured metric logging):
		result, err := matcher.ExecuteNaiveMatch(ctx, rideReq, geoIndex, strategy, assigner, os.Stdout)
		if err != nil {
			log.Printf("Worker [ride-request-events]: match/assign error for ride %s: %v (leaving for redrive)", rideReq.RideID, err)
			return
		}

		if result.Assigned {
			log.Printf("Worker [ride-request-events]: assigned driver %s to ride %s", result.DriverID, rideReq.RideID)
		} else {
			log.Printf("Worker [ride-request-events]: ride %s remained unassigned", rideReq.RideID)
		}

		deleteSQSMessage(ctx, client, queueURL, msg.ReceiptHandle)

	case "ride-cancelled":
		var payload RideCancelledPayload
		_ = json.Unmarshal(wrapper.Payload, &payload)
		log.Printf("Worker [ride-request-events]: received ride-cancelled event for ride %s; Trip Service state machine enforces cancellation status", payload.RideID)
		deleteSQSMessage(ctx, client, queueURL, msg.ReceiptHandle)

	default:
		log.Printf("Worker [ride-request-events]: unknown eventType %q in message %s; deleting", wrapper.EventType, aws.ToString(msg.MessageId))
		deleteSQSMessage(ctx, client, queueURL, msg.ReceiptHandle)
	}
}

func deleteSQSMessage(ctx context.Context, client *sqs.Client, queueURL string, receiptHandle *string) {
	if receiptHandle == nil {
		return
	}
	_, err := client.DeleteMessage(ctx, &sqs.DeleteMessageInput{
		QueueUrl:      aws.String(queueURL),
		ReceiptHandle: receiptHandle,
	})
	if err != nil {
		log.Printf("WARN: failed to delete SQS message with handle %s: %v", aws.ToString(receiptHandle), err)
	}
}

func newSQSClient(ctx context.Context, endpoint string) (*sqs.Client, error) {
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = "us-east-1"
	}

	if endpoint != "" {
		cfg, err := config.LoadDefaultConfig(ctx,
			config.WithRegion(region),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("test", "test", "")),
		)
		if err != nil {
			return nil, fmt.Errorf("failed to load local aws config: %w", err)
		}

		return sqs.NewFromConfig(cfg, func(o *sqs.Options) {
			o.BaseEndpoint = aws.String(endpoint)
		}), nil
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load aws config: %w", err)
	}

	return sqs.NewFromConfig(cfg), nil
}

func normalizeQueueURL(raw string, endpoint string) string {
	if endpoint == "" {
		return raw
	}
	parsedRaw, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	parsedEp, err := url.Parse(endpoint)
	if err != nil {
		return raw
	}
	parsedRaw.Scheme = parsedEp.Scheme
	parsedRaw.Host = parsedEp.Host
	return parsedRaw.String()
}
