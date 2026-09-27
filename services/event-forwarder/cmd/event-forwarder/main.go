package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sqs"

	"github.com/Vimal-Sabari/ride-dispatch-platform/services/event-forwarder/internal/classify"
	"github.com/Vimal-Sabari/ride-dispatch-platform/services/event-forwarder/internal/forward"
)

// sqsClientWrapper implements forward.SQSSender over AWS SDK v2 SQS client.
type sqsClientWrapper struct {
	client *sqs.Client
}

func (w *sqsClientWrapper) SendMessage(ctx context.Context, queueURL string, body string) error {
	normalizedURL := normalizeQueueURL(queueURL)
	_, err := w.client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(normalizedURL),
		MessageBody: aws.String(body),
	})
	return err
}

// normalizeQueueURL rewrites the scheme and host of a queue URL to match AWS_ENDPOINT_URL
// if AWS_ENDPOINT_URL is configured (e.g. rewriting localhost:4566 to localstack:4566).
func normalizeQueueURL(raw string) string {
	endpoint := os.Getenv("AWS_ENDPOINT_URL")
	if endpoint == "" {
		return raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	configured, err := url.Parse(endpoint)
	if err != nil {
		return raw
	}
	parsed.Scheme = configured.Scheme
	parsed.Host = configured.Host
	return parsed.String()
}

type handler struct {
	sender forward.SQSSender
	urls   forward.QueueURLs
}

func newSQSSender(ctx context.Context, endpoint string) (forward.SQSSender, error) {
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
			return nil, fmt.Errorf("failed to load local config: %w", err)
		}

		client := sqs.NewFromConfig(cfg, func(o *sqs.Options) {
			o.BaseEndpoint = aws.String(endpoint)
		})
		return &sqsClientWrapper{client: client}, nil
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to load default config: %w", err)
	}

	return &sqsClientWrapper{client: sqs.NewFromConfig(cfg)}, nil
}

func (h *handler) Handle(ctx context.Context, e events.DynamoDBEvent) (events.DynamoDBEventResponse, error) {
	var failures []events.DynamoDBBatchItemFailure

	for _, record := range e.Records {
		streamRec := classify.ConvertRecord(record)
		classified, shouldForward := classify.Classify(streamRec)
		if !shouldForward {
			continue
		}

		if err := forward.Send(ctx, h.sender, h.urls, *classified); err != nil {
			log.Printf("ERROR: Failed to forward record EventID=%s EventName=%s PK=%s SK=%s: %v",
				record.EventID, record.EventName, streamRec.PK, streamRec.SK, err)
			failures = append(failures, events.DynamoDBBatchItemFailure{
				ItemIdentifier: record.EventID,
			})
		}
	}

	return events.DynamoDBEventResponse{
		BatchItemFailures: failures,
	}, nil
}

func main() {
	ctx := context.Background()

	endpoint := os.Getenv("AWS_ENDPOINT_URL")
	if endpoint == "" {
		endpoint = os.Getenv("LOCALSTACK_HOSTNAME")
		if endpoint != "" {
			endpoint = "http://" + endpoint + ":4566"
		}
	}

	locQueue := os.Getenv("LOCATION_EVENTS_QUEUE_URL")
	if locQueue == "" {
		locQueue = os.Getenv("DYNAMO_LOCATION_EVENTS_QUEUE_URL")
	}

	rideQueue := os.Getenv("RIDE_REQUEST_EVENTS_QUEUE_URL")
	if rideQueue == "" {
		rideQueue = os.Getenv("DYNAMO_RIDE_REQUEST_EVENTS_QUEUE_URL")
	}

	sender, err := newSQSSender(ctx, endpoint)
	if err != nil {
		log.Fatalf("FATAL: Failed to initialize SQS sender: %v", err)
	}

	h := &handler{
		sender: sender,
		urls: forward.QueueURLs{
			LocationEvents:    locQueue,
			RideRequestEvents: rideQueue,
		},
	}

	lambda.Start(h.Handle)
}
