package main

import (
	"context"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

type mockDynamoWriter struct {
	putCalls []map[string]types.AttributeValue
}

func (m *mockDynamoWriter) PutItem(ctx context.Context, item map[string]types.AttributeValue) error {
	m.putCalls = append(m.putCalls, item)
	return nil
}

func (m *mockDynamoWriter) GetItem(ctx context.Context, pk, sk string) (map[string]types.AttributeValue, error) {
	return nil, nil
}

func TestNewStatusHandler(t *testing.T) {
	ctx := context.Background()
	mock := &mockDynamoWriter{}
	handlerFn := newStatusHandler(mock)

	t.Run("missing driver id in path params", func(t *testing.T) {
		res, err := handlerFn(ctx, events.APIGatewayProxyRequest{
			PathParameters: nil,
			Body:           `{"status": "available"}`,
		})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if res.StatusCode != 400 || !strings.Contains(res.Body, "missing driver id") {
			t.Errorf("expected 400 missing driver id, got %d %s", res.StatusCode, res.Body)
		}
	})

	t.Run("invalid json request body", func(t *testing.T) {
		res, err := handlerFn(ctx, events.APIGatewayProxyRequest{
			PathParameters: map[string]string{"id": "driver-1"},
			Body:           `{not-json`,
		})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if res.StatusCode != 400 || !strings.Contains(res.Body, "invalid json request body") {
			t.Errorf("expected 400 invalid json, got %d %s", res.StatusCode, res.Body)
		}
	})

	t.Run("successful status update", func(t *testing.T) {
		res, err := handlerFn(ctx, events.APIGatewayProxyRequest{
			PathParameters: map[string]string{"id": "driver-1"},
			Body:           `{"status": "available"}`,
		})
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if res.StatusCode != 200 || !strings.Contains(res.Body, "ok") {
			t.Errorf("expected 200 ok, got %d %s", res.StatusCode, res.Body)
		}
	})

	t.Run("getClientFromEnv initializes client correctly", func(t *testing.T) {
		t.Setenv("DYNAMO_TABLE_NAME", "test-table")
		t.Setenv("DYNAMO_ENDPOINT", "http://localhost:4566")
		c, err := getClientFromEnv(ctx)
		if err != nil {
			t.Fatalf("unexpected err initializing client: %v", err)
		}
		if c == nil {
			t.Fatal("expected non-nil client")
		}
	})
}
