//go:build integration

package dynamoclient

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func getTestClient(t *testing.T) *Client {
	t.Helper()

	tableName := os.Getenv("DYNAMO_TABLE_NAME")
	if tableName == "" {
		tableName = "ride-dispatch-platform-local"
	}

	endpoint := os.Getenv("AWS_ENDPOINT_URL")
	if endpoint == "" {
		endpoint = "http://localhost:4566"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	client, err := NewClient(ctx, tableName, endpoint)
	if err != nil {
		t.Fatalf("failed to initialize test DynamoDB client: %v", err)
	}

	return client
}

func TestPutAndGetItem(t *testing.T) {
	client := getTestClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pk := fmt.Sprintf("TEST#PUT_GET#%d", time.Now().UnixNano())
	sk := "DATA"

	item := map[string]types.AttributeValue{
		"PK":   &types.AttributeValueMemberS{Value: pk},
		"SK":   &types.AttributeValueMemberS{Value: sk},
		"Name": &types.AttributeValueMemberS{Value: "Test Item"},
	}

	err := client.PutItem(ctx, item)
	if err != nil {
		t.Fatalf("PutItem failed: %v", err)
	}

	retrieved, err := client.GetItem(ctx, pk, sk)
	if err != nil {
		t.Fatalf("GetItem failed: %v", err)
	}
	if retrieved == nil {
		t.Fatalf("expected retrieved item, got nil")
	}

	nameVal, ok := retrieved["Name"].(*types.AttributeValueMemberS)
	if !ok || nameVal.Value != "Test Item" {
		t.Errorf("expected Name='Test Item', got %+v", retrieved["Name"])
	}
}

func TestGetItem_NotFound(t *testing.T) {
	client := getTestClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pk := fmt.Sprintf("NON_EXISTENT#%d", time.Now().UnixNano())
	sk := "NON_EXISTENT"

	item, err := client.GetItem(ctx, pk, sk)
	if err != nil {
		t.Fatalf("GetItem for non-existent item should not return error, got: %v", err)
	}
	if item != nil {
		t.Fatalf("expected nil item for non-existent key, got: %+v", item)
	}
}

func TestQuery_GSI1(t *testing.T) {
	client := getTestClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	gsi1PK := fmt.Sprintf("GEOHASH#TEST_%d", time.Now().UnixNano())

	// Insert 3 items sharing the same GSI1PK with distinct GSI1SK
	for i := 1; i <= 3; i++ {
		pk := fmt.Sprintf("DRIVER#TEST_%d_%d", time.Now().UnixNano(), i)
		sk := "LOCATION"
		gsi1SK := fmt.Sprintf("DRIVER#AVAILABLE#drv_%d", i)

		err := client.PutItem(ctx, map[string]types.AttributeValue{
			"PK":     &types.AttributeValueMemberS{Value: pk},
			"SK":     &types.AttributeValueMemberS{Value: sk},
			"GSI1PK": &types.AttributeValueMemberS{Value: gsi1PK},
			"GSI1SK": &types.AttributeValueMemberS{Value: gsi1SK},
		})
		if err != nil {
			t.Fatalf("PutItem for GSI item %d failed: %v", i, err)
		}
	}

	results, err := client.Query(ctx, QueryInput{
		IndexName:              "GSI1",
		KeyConditionExpression: "GSI1PK = :gsi1pk",
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":gsi1pk": &types.AttributeValueMemberS{Value: gsi1PK},
		},
	})
	if err != nil {
		t.Fatalf("Query GSI1 failed: %v", err)
	}

	if len(results) != 3 {
		t.Fatalf("expected 3 items from GSI1 query, got %d", len(results))
	}
}

func TestConditionalPutItem_SuccessAndFailure(t *testing.T) {
	client := getTestClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pk := fmt.Sprintf("TEST#COND_%d", time.Now().UnixNano())
	sk := "ASSIGNMENT"

	item := map[string]types.AttributeValue{
		"PK":     &types.AttributeValueMemberS{Value: pk},
		"SK":     &types.AttributeValueMemberS{Value: sk},
		"Status": &types.AttributeValueMemberS{Value: "ACTIVE"},
	}

	// 1. Initial Put on a fresh key with attribute_not_exists(PK) must succeed -> (true, nil)
	ok, err := client.ConditionalPutItem(ctx, item, "attribute_not_exists(PK)")
	if err != nil {
		t.Fatalf("first ConditionalPutItem failed with unexpected error: %v", err)
	}
	if !ok {
		t.Fatalf("expected first ConditionalPutItem to return true, got false")
	}

	// 2. Second Put on the same key with attribute_not_exists(PK) must fail condition -> (false, nil)
	okAgain, err := client.ConditionalPutItem(ctx, item, "attribute_not_exists(PK)")
	if err != nil {
		t.Fatalf("second ConditionalPutItem returned unexpected error instead of (false, nil): %v", err)
	}
	if okAgain {
		t.Fatalf("expected second ConditionalPutItem to return false, got true")
	}
}

func TestConditionalPutItem_ConcurrencyRace(t *testing.T) {
	client := getTestClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pk := fmt.Sprintf("RACE#DRIVER#%d", time.Now().UnixNano())
	sk := "ASSIGNMENT"

	startChan := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)

	type result struct {
		won bool
		err error
	}
	results := make([]result, 2)

	for i := 0; i < 2; i++ {
		go func(workerID int) {
			defer wg.Done()
			<-startChan // Wait for synchronized start signal

			workerItem := map[string]types.AttributeValue{
				"PK":       &types.AttributeValueMemberS{Value: pk},
				"SK":       &types.AttributeValueMemberS{Value: sk},
				"WorkerID": &types.AttributeValueMemberS{Value: fmt.Sprintf("worker-%d", workerID)},
			}

			won, err := client.ConditionalPutItem(ctx, workerItem, "attribute_not_exists(PK)")
			results[workerID] = result{won: won, err: err}
		}(i)
	}

	// Release both workers simultaneously
	close(startChan)
	wg.Wait()

	for i, res := range results {
		if res.err != nil {
			t.Fatalf("worker %d returned unexpected error: %v", i, res.err)
		}
	}

	winnerCount := 0
	loserCount := 0
	for _, res := range results {
		if res.won {
			winnerCount++
		} else {
			loserCount++
		}
	}

	if winnerCount != 1 || loserCount != 1 {
		t.Fatalf("concurrency race assertion failed: expected exactly 1 winner and 1 loser, got %d winners and %d losers",
			winnerCount, loserCount)
	}
}
